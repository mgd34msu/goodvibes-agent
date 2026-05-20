import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type {
  CompanionChatMessage,
  CompanionChatSession,
  OperatorMethodInput,
  OperatorMethodOutput,
} from '@pellux/goodvibes-sdk/contracts';
import { CompanionChatCoordinator, CompanionChatError, type CompanionChatDaemonClient } from '../src/assistant/companion-chat.js';
import { resolveProviderModel } from '../src/assistant/provider-model.js';
import type { AgentConfig } from '../src/config.js';
import { DaemonRequestError, type DaemonCompatibilityResult } from '../src/daemon/client.js';
import { CompanionSessionStore } from '../src/store/companion-session.js';

let previousHome: string | undefined;
let testHome = '';

beforeEach(async () => {
  previousHome = process.env.GOODVIBES_AGENT_HOME;
  testHome = await mkdtemp(join(tmpdir(), 'goodvibes-agent-chat-'));
  process.env.GOODVIBES_AGENT_HOME = testHome;
});

afterEach(async () => {
  if (previousHome === undefined) {
    delete process.env.GOODVIBES_AGENT_HOME;
  } else {
    process.env.GOODVIBES_AGENT_HOME = previousHome;
  }
  await rm(testHome, { recursive: true, force: true });
});

describe('companion chat coordinator', () => {
  test('reuses a durable companion session across turns', async () => {
    const client = new FakeCompanionClient();
    const coordinator = createCoordinator(client);

    const first = await coordinator.send('hello', 'system prompt');
    const second = await coordinator.send('continue', 'system prompt');

    expect(first.sessionId).toBe(second.sessionId);
    expect(client.createInputs).toHaveLength(1);
    expect(client.postedMessages.map((message) => message.sessionId)).toEqual([first.sessionId, first.sessionId]);
  });

  test('splits provider row from raw model id for session creation only', async () => {
    const client = new FakeCompanionClient();
    const coordinator = createCoordinator(client, {
      provider: 'openai-subscriber',
      model: 'openai:gpt-5.5',
    });

    await coordinator.send('hello', 'system prompt');

    expect(client.createInputs[0]?.provider).toBe('openai-subscriber');
    expect(client.createInputs[0]?.model).toBe('gpt-5.5');
    expect(client.postedMessages[0]?.metadata).toEqual({ originProduct: 'goodvibes-agent' });
  });

  test('recovers visibly when the stored companion session is missing', async () => {
    const client = new FakeCompanionClient();
    const store = new CompanionSessionStore();
    store.save({
      sessionId: 'missing-session',
      title: 'GoodVibes Agent',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      systemPromptHash: 'stale',
    });
    client.missingSessionIds.add('missing-session');
    const coordinator = createCoordinator(client, {}, store);

    const result = await coordinator.send('hello after recovery', 'system prompt');

    expect(result.recovered).toBe(true);
    expect(result.recovery?.previousSessionId).toBe('missing-session');
    expect(result.recovery?.newSessionId).toBe(result.sessionId);
    expect(result.text).toContain(result.sessionId);
  });

  test('times out with a useful chat_timeout error', async () => {
    const client = new FakeCompanionClient();
    client.autoReply = false;
    const coordinator = createCoordinator(client, {}, new CompanionSessionStore(), 5);

    await expect(coordinator.send('no reply expected', 'system prompt')).rejects.toMatchObject({
      kind: 'chat_timeout',
    });
    try {
      await coordinator.send('no reply expected', 'system prompt');
    } catch (error) {
      expect(error).toBeInstanceOf(CompanionChatError);
      expect(error instanceof CompanionChatError ? error.message : '').toContain('Timed out');
    }
  });

  test('does not hide post failures behind fallback chat routes', async () => {
    const client = new FakeCompanionClient();
    client.failPost = true;
    const coordinator = createCoordinator(client);

    await expect(coordinator.send('hello', 'system prompt')).rejects.toMatchObject({
      kind: 'chat_message_post_failed',
    });
    expect(client.postedMessages).toHaveLength(0);
  });
});

function createCoordinator(
  client: CompanionChatDaemonClient,
  overrides: Partial<Pick<AgentConfig, 'provider' | 'model'>> = {},
  store = new CompanionSessionStore(),
  timeoutMs = 250,
): CompanionChatCoordinator {
  const config: AgentConfig = {
    baseUrl: 'http://127.0.0.1:3421',
    surfaceKind: 'goodvibes-agent',
    surfaceId: 'goodvibes-agent-test',
    defaultChatTitle: 'GoodVibes Agent',
    companionTimeoutMs: timeoutMs,
    autoRemember: true,
    autoDelegateBuildRequests: true,
    ...overrides,
  };
  return new CompanionChatCoordinator({
    client,
    store,
    title: config.defaultChatTitle,
    providerModel: resolveProviderModel(config),
    timeoutMs,
    pollIntervalMs: 1,
  });
}

interface PostedMessage {
  readonly sessionId: string;
  readonly content: string;
  readonly metadata: OperatorMethodInput<'companion.chat.messages.create'>['metadata'];
}

class FakeCompanionClient implements CompanionChatDaemonClient {
  autoReply = true;
  failPost = false;
  readonly missingSessionIds = new Set<string>();
  readonly createInputs: OperatorMethodInput<'companion.chat.sessions.create'>[] = [];
  readonly postedMessages: PostedMessage[] = [];
  private readonly sessions = new Map<string, {
    readonly session: CompanionChatSession;
    readonly messages: CompanionChatMessage[];
  }>();
  private nextSessionNumber = 1;
  private nextMessageNumber = 1;

  async checkCompatibility(): Promise<DaemonCompatibilityResult> {
    return {
      ok: true,
      daemonVersion: '0.33.30',
      expectedVersion: '0.33.30',
      status: { status: 'running', version: '0.33.30' },
      reason: 'ok',
    };
  }

  async createCompanionChat(
    input: OperatorMethodInput<'companion.chat.sessions.create'>,
  ): Promise<OperatorMethodOutput<'companion.chat.sessions.create'>> {
    this.createInputs.push(input);
    const sessionId = `chat-${this.nextSessionNumber}`;
    this.nextSessionNumber += 1;
    const now = Date.now();
    const session: CompanionChatSession = {
      id: sessionId,
      kind: 'companion-chat',
      title: input.title ?? 'GoodVibes Agent',
      model: input.model ?? null,
      provider: input.provider ?? null,
      systemPrompt: input.systemPrompt ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      messageCount: 0,
    };
    this.sessions.set(sessionId, { session, messages: [] });
    return { sessionId, createdAt: now, session };
  }

  async getCompanionChatSession(sessionId: string): Promise<OperatorMethodOutput<'companion.chat.sessions.get'>> {
    const entry = this.requireSession(sessionId);
    return { session: entry.session, messages: entry.messages };
  }

  async updateCompanionChatSession(
    sessionId: string,
    input: Omit<OperatorMethodInput<'companion.chat.sessions.update'>, 'sessionId'>,
  ): Promise<OperatorMethodOutput<'companion.chat.sessions.update'>> {
    const entry = this.requireSession(sessionId);
    const session: CompanionChatSession = {
      ...entry.session,
      title: optionalString(input.title) ?? entry.session.title,
      model: optionalString(input.model) ?? entry.session.model,
      provider: optionalString(input.provider) ?? entry.session.provider,
      systemPrompt: input.systemPrompt === null ? null : optionalString(input.systemPrompt) ?? entry.session.systemPrompt,
      updatedAt: Date.now(),
    };
    this.sessions.set(sessionId, { session, messages: entry.messages });
    return { session };
  }

  async postCompanionMessage(
    sessionId: string,
    content: string,
    metadata?: OperatorMethodInput<'companion.chat.messages.create'>['metadata'],
  ): Promise<OperatorMethodOutput<'companion.chat.messages.create'>> {
    if (this.failPost) throw new Error('post failed');
    const entry = this.requireSession(sessionId);
    this.postedMessages.push({ sessionId, content, metadata });
    entry.messages.push(this.message(sessionId, 'user', content));
    if (this.autoReply) entry.messages.push(this.message(sessionId, 'assistant', `reply from ${sessionId}`));
    return { messageId: `msg-${this.nextMessageNumber}` };
  }

  async listCompanionMessages(sessionId: string): Promise<readonly CompanionChatMessage[]> {
    return this.requireSession(sessionId).messages;
  }

  private requireSession(sessionId: string): {
    readonly session: CompanionChatSession;
    readonly messages: CompanionChatMessage[];
  } {
    if (this.missingSessionIds.has(sessionId)) {
      throw new DaemonRequestError('session not found', 404, { code: 'SESSION_NOT_FOUND' });
    }
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new DaemonRequestError('session not found', 404, { code: 'SESSION_NOT_FOUND' });
    return entry;
  }

  private message(sessionId: string, role: CompanionChatMessage['role'], content: string): CompanionChatMessage {
    const id = `msg-${this.nextMessageNumber}`;
    this.nextMessageNumber += 1;
    return {
      id,
      sessionId,
      role,
      content,
      createdAt: Date.now() + this.nextMessageNumber,
    };
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
