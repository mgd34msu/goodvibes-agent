import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AgentConfig } from '../src/config.js';
import { createAgentRuntimeServices } from '../src/runtime/services.js';

const config: AgentConfig = {
  baseUrl: 'http://127.0.0.1:3421',
  surfaceKind: 'goodvibes-agent',
  surfaceId: 'runtime-test',
  defaultChatTitle: 'GoodVibes Agent',
  companionTimeoutMs: 90_000,
  autoRemember: true,
  autoDelegateBuildRequests: true,
};

let previousHome: string | undefined;
let testHome = '';

beforeEach(async () => {
  previousHome = process.env.GOODVIBES_AGENT_HOME;
  testHome = await mkdtemp(join(tmpdir(), 'goodvibes-agent-runtime-'));
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

describe('assistant runtime local lifecycle', () => {
  test('secret policy blocks before automatic memory capture', async () => {
    const services = createAgentRuntimeServices(config);
    const reply = await services.assistant.handleUserText('remember my api key is abc123');

    expect(reply.text).toContain('I need approval');
    expect(services.memory.list()).toHaveLength(0);
  });

  test('ordinary chat text cannot trigger daemon mutations', async () => {
    const services = createAgentRuntimeServices({ ...config, baseUrl: 'http://127.0.0.1:1' });
    const reply = await services.assistant.handleUserText('run automation job job-1');

    expect(reply.text).toContain('I need approval');
    expect(reply.text).toContain('Daemon mutation routes require an explicit user command');
  });

  test('slash commands manage active local skills and personas', async () => {
    const services = createAgentRuntimeServices(config);
    services.skills.create({ name: 'weekly-plan', description: 'Plan the week.' });
    services.personas.create({ name: 'travel', description: 'Travel mode.' });

    const skillReply = await services.assistant.handleUserText('/skills enable weekly-plan');
    const personaReply = await services.assistant.handleUserText('/personas use travel');
    const active = services.assistant.activeProfile();

    expect(skillReply.text).toContain('Enabled skill weekly-plan');
    expect(personaReply.text).toContain('Using persona travel');
    expect(active.skills.map((skill) => skill.name)).toContain('weekly-plan');
    expect(active.persona.name).toBe('travel');
  });
});
