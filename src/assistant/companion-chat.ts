import { createHash } from 'node:crypto';
import type {
  CompanionChatMessage,
  OperatorMethodInput,
  OperatorMethodOutput,
} from '@pellux/goodvibes-sdk/contracts';
import {
  DaemonConnectionError,
  DaemonRequestError,
  type DaemonCompatibilityResult,
} from '../daemon/client.js';
import {
  CompanionSessionStore,
  type CompanionSessionRecovery,
  type CompanionSessionRecord,
} from '../store/companion-session.js';
import { isRecord } from '../types.js';
import type { ProviderModelSelection } from './provider-model.js';

export type CompanionChatErrorKind =
  | 'daemon_unavailable'
  | 'daemon_timeout'
  | 'auth_required'
  | 'version_mismatch'
  | 'session_not_found'
  | 'session_closed'
  | 'invalid_model_route'
  | 'no_model_configured'
  | 'no_provider_available'
  | 'rate_limited'
  | 'chat_session_create_failed'
  | 'chat_session_get_failed'
  | 'chat_session_update_failed'
  | 'chat_message_post_failed'
  | 'chat_messages_list_failed'
  | 'chat_timeout';

export class CompanionChatError extends Error {
  constructor(
    readonly kind: CompanionChatErrorKind,
    message: string,
    readonly causeError?: unknown,
  ) {
    super(message);
    this.name = 'CompanionChatError';
  }
}

export interface CompanionChatDaemonClient {
  checkCompatibility(): Promise<DaemonCompatibilityResult>;
  createCompanionChat(input: OperatorMethodInput<'companion.chat.sessions.create'>): Promise<OperatorMethodOutput<'companion.chat.sessions.create'>>;
  getCompanionChatSession(sessionId: string): Promise<OperatorMethodOutput<'companion.chat.sessions.get'>>;
  updateCompanionChatSession(
    sessionId: string,
    input: Omit<OperatorMethodInput<'companion.chat.sessions.update'>, 'sessionId'>,
  ): Promise<OperatorMethodOutput<'companion.chat.sessions.update'>>;
  postCompanionMessage(
    sessionId: string,
    content: string,
    metadata?: OperatorMethodInput<'companion.chat.messages.create'>['metadata'],
  ): Promise<OperatorMethodOutput<'companion.chat.messages.create'>>;
  listCompanionMessages(sessionId: string): Promise<readonly CompanionChatMessage[]>;
}

export interface CompanionChatCoordinatorOptions {
  readonly client: CompanionChatDaemonClient;
  readonly store?: CompanionSessionStore | undefined;
  readonly title: string;
  readonly providerModel: ProviderModelSelection;
  readonly timeoutMs: number;
  readonly pollIntervalMs?: number | undefined;
}

export interface CompanionChatStatus {
  readonly sessionId: string | null;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly modelRegistryKey?: string | undefined;
  readonly providerModelDisplay: string;
  readonly timeoutMs: number;
  readonly lastRecovery: CompanionSessionRecovery | null;
}

export interface CompanionChatTurnResult {
  readonly text: string;
  readonly sessionId: string;
  readonly recovered: boolean;
  readonly recovery: CompanionSessionRecovery | null;
}

interface EnsuredSession {
  readonly record: CompanionSessionRecord;
  readonly recovery: CompanionSessionRecovery | null;
}

interface WaitResult {
  readonly text: string;
  readonly recovery: CompanionSessionRecovery | null;
}

export class CompanionChatCoordinator {
  private readonly store: CompanionSessionStore;

  constructor(private readonly options: CompanionChatCoordinatorOptions) {
    this.store = options.store ?? new CompanionSessionStore();
  }

  status(): CompanionChatStatus {
    const active = this.store.active();
    return {
      sessionId: active?.sessionId ?? null,
      provider: this.options.providerModel.provider,
      model: this.options.providerModel.model,
      modelRegistryKey: this.options.providerModel.modelRegistryKey,
      providerModelDisplay: this.options.providerModel.display,
      timeoutMs: this.options.timeoutMs,
      lastRecovery: this.store.read().lastRecovery,
    };
  }

  async send(text: string, systemPrompt: string): Promise<CompanionChatTurnResult> {
    await this.assertCompatible();
    const ensured = await this.ensureSession(systemPrompt);
    const after = Date.now();
    const posted = await this.postMessage(ensured.record.sessionId, text, systemPrompt);
    const active = posted.recovery
      ? posted.record
      : ensured.record;
    const recovery = posted.recovery ?? ensured.recovery;
    const reply = await this.waitForAssistantMessage(active.sessionId, after, text, systemPrompt, recovery !== null);
    const finalRecovery = reply.recovery ?? recovery;
    return {
      text: reply.text,
      sessionId: reply.recovery?.newSessionId ?? active.sessionId,
      recovered: finalRecovery !== null,
      recovery: finalRecovery,
    };
  }

  private async assertCompatible(): Promise<void> {
    let compatibility: DaemonCompatibilityResult;
    try {
      compatibility = await this.options.client.checkCompatibility();
    } catch (error) {
      throw classifyCompanionError('chat_session_create_failed', error);
    }
    if (!compatibility.ok) {
      throw new CompanionChatError('version_mismatch', compatibility.reason);
    }
  }

  private async ensureSession(systemPrompt: string): Promise<EnsuredSession> {
    const active = this.store.active();
    const promptHash = hashPrompt(systemPrompt);
    if (!active || !this.routingMatches(active)) {
      return { record: await this.createSession(systemPrompt, promptHash), recovery: null };
    }

    try {
      await this.options.client.getCompanionChatSession(active.sessionId);
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw classifyCompanionError('chat_session_get_failed', error);
      const record = await this.createSession(systemPrompt, promptHash);
      return {
        record,
        recovery: this.store.recordRecovery(active.sessionId, record),
      };
    }

    if (active.title !== this.options.title || active.systemPromptHash !== promptHash) {
      try {
        await this.options.client.updateCompanionChatSession(active.sessionId, {
          title: this.options.title,
          systemPrompt,
        });
      } catch (error) {
        if (!isSessionNotFoundError(error)) throw classifyCompanionError('chat_session_update_failed', error);
        const record = await this.createSession(systemPrompt, promptHash);
        return {
          record,
          recovery: this.store.recordRecovery(active.sessionId, record),
        };
      }
      return {
        record: this.store.save({ ...active, title: this.options.title, systemPromptHash: promptHash, updatedAt: Date.now() }),
        recovery: null,
      };
    }

    return { record: active, recovery: null };
  }

  private async createSession(systemPrompt: string, systemPromptHash: string): Promise<CompanionSessionRecord> {
    const input: OperatorMethodInput<'companion.chat.sessions.create'> = {
      title: this.options.title,
      systemPrompt,
      ...optionalRouting(this.options.providerModel),
    };
    let created: OperatorMethodOutput<'companion.chat.sessions.create'>;
    try {
      created = await this.options.client.createCompanionChat(input);
    } catch (error) {
      throw classifyCompanionError('chat_session_create_failed', error);
    }
    const now = Date.now();
    return this.store.save({
      sessionId: created.sessionId,
      title: this.options.title,
      provider: this.options.providerModel.provider,
      model: this.options.providerModel.model,
      modelRegistryKey: this.options.providerModel.modelRegistryKey,
      systemPromptHash,
      createdAt: now,
      updatedAt: now,
    });
  }

  private async postMessage(sessionId: string, text: string, systemPrompt: string): Promise<EnsuredSession> {
    try {
      await this.options.client.postCompanionMessage(sessionId, text, {
        originProduct: 'goodvibes-agent',
      });
      const active = this.store.active();
      if (!active) throw new CompanionChatError('chat_message_post_failed', 'Companion chat session disappeared after posting.');
      return { record: active, recovery: null };
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw classifyCompanionError('chat_message_post_failed', error);
      const previousSessionId = sessionId;
      const record = await this.createSession(systemPrompt, hashPrompt(systemPrompt));
      try {
        await this.options.client.postCompanionMessage(record.sessionId, text, {
          originProduct: 'goodvibes-agent',
          recoveredFromSessionId: previousSessionId,
        });
      } catch (postError) {
        throw classifyCompanionError('chat_message_post_failed', postError);
      }
      return {
        record,
        recovery: this.store.recordRecovery(previousSessionId, record),
      };
    }
  }

  private async waitForAssistantMessage(
    sessionId: string,
    afterEpochMs: number,
    originalText: string,
    systemPrompt: string,
    alreadyRecovered: boolean,
  ): Promise<WaitResult> {
    const started = Date.now();
    while (Date.now() - started < this.options.timeoutMs) {
      let messages: readonly CompanionChatMessage[];
      try {
        messages = await this.options.client.listCompanionMessages(sessionId);
      } catch (error) {
        if (!alreadyRecovered && isSessionNotFoundError(error)) {
          const record = await this.createSession(systemPrompt, hashPrompt(systemPrompt));
          const recovery = this.store.recordRecovery(sessionId, record);
          try {
            await this.options.client.postCompanionMessage(record.sessionId, originalText, {
              originProduct: 'goodvibes-agent',
              recoveredFromSessionId: sessionId,
            });
          } catch (postError) {
            throw classifyCompanionError('chat_message_post_failed', postError);
          }
          const result = await this.waitForAssistantMessage(record.sessionId, Date.now(), originalText, systemPrompt, true);
          return { ...result, recovery: result.recovery ?? recovery };
        }
        throw classifyCompanionError('chat_messages_list_failed', error);
      }
      const assistant = [...messages].reverse().find((message) => (
        message.role === 'assistant'
        && message.createdAt >= afterEpochMs
        && message.content.trim()
      ));
      if (assistant) return { text: assistant.content, recovery: null };
      await sleep(this.options.pollIntervalMs ?? 750);
    }
    throw new CompanionChatError(
      'chat_timeout',
      `Timed out after ${this.options.timeoutMs}ms waiting for assistant reply in companion chat session ${sessionId}.`,
    );
  }

  private routingMatches(record: CompanionSessionRecord): boolean {
    return record.provider === this.options.providerModel.provider
      && record.model === this.options.providerModel.model
      && record.modelRegistryKey === this.options.providerModel.modelRegistryKey;
  }
}

function optionalRouting(selection: ProviderModelSelection): Pick<OperatorMethodInput<'companion.chat.sessions.create'>, 'provider' | 'model'> {
  return {
    ...(selection.provider ? { provider: selection.provider } : {}),
    ...(selection.model ? { model: selection.model } : {}),
  };
}

function classifyCompanionError(fallback: CompanionChatErrorKind, error: unknown): CompanionChatError {
  if (error instanceof CompanionChatError) return error;
  const contractKind = classifyContractError(error);
  if (contractKind) {
    return new CompanionChatError(contractKind, error instanceof Error ? error.message : String(error), error);
  }
  if (error instanceof DaemonRequestError && error.kind === 'auth_required') {
    return new CompanionChatError('auth_required', error.message, error);
  }
  if (error instanceof DaemonConnectionError) {
    return new CompanionChatError(classifyDaemonConnectionKind(error.kind), error.message, error);
  }
  if (isSessionNotFoundError(error)) {
    return new CompanionChatError('session_not_found', 'Companion chat session was not found by the daemon.', error);
  }
  if (error instanceof Error) return new CompanionChatError(fallback, error.message, error);
  return new CompanionChatError(fallback, String(error), error);
}

function classifyDaemonConnectionKind(kind: DaemonConnectionError['kind']): CompanionChatErrorKind {
  if (kind === 'daemon_timeout') return 'daemon_timeout';
  return 'daemon_unavailable';
}

function classifyContractError(error: unknown): CompanionChatErrorKind | null {
  const text = daemonErrorText(error);
  if (/\bSESSION_NOT_FOUND\b|session[_ -]?not[_ -]?found/i.test(text)) return 'session_not_found';
  if (/\bSESSION_CLOSED\b|session[_ -]?closed/i.test(text)) return 'session_closed';
  if (/\bINVALID_MODEL_ROUTE\b|invalid[_ -]?model[_ -]?route/i.test(text)) return 'invalid_model_route';
  if (/\bNO_MODEL_CONFIGURED\b|no[_ -]?model[_ -]?configured/i.test(text)) return 'no_model_configured';
  if (/\bNO_PROVIDER_AVAILABLE\b|no[_ -]?provider[_ -]?available/i.test(text)) return 'no_provider_available';
  if (/\bRATE_LIMIT|rate[_ -]?limit|too many requests/i.test(text)) return 'rate_limited';
  return null;
}

function daemonErrorText(error: unknown): string {
  if (error instanceof DaemonRequestError) return `${error.message} ${JSON.stringify(error.body)}`;
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
}

export function isSessionNotFoundError(error: unknown): boolean {
  if (error instanceof DaemonRequestError) {
    return bodyMentionsSessionNotFound(error.body) || bodyMentionsSessionNotFound(error.message);
  }
  return bodyMentionsSessionNotFound(error);
}

function bodyMentionsSessionNotFound(value: unknown): boolean {
  if (typeof value === 'string') return /SESSION_NOT_FOUND|session[_ -]?not[_ -]?found/i.test(value);
  if (!isRecord(value)) return false;
  for (const key of ['code', 'kind', 'error', 'message']) {
    const field = value[key];
    if (typeof field === 'string' && /SESSION_NOT_FOUND|session[_ -]?not[_ -]?found/i.test(field)) return true;
    if (isRecord(field) && bodyMentionsSessionNotFound(field)) return true;
  }
  return false;
}

function hashPrompt(systemPrompt: string): string {
  return createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
