import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { createRuntimeServices } from '../../runtime/services.ts';
import { createRuntimeStore } from '../../runtime/store/index.ts';

const roots: string[] = [];
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalOpenAiKey = process.env.OPENAI_KEY;

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  if (originalOpenAiApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  }
  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_KEY;
  } else {
    process.env.OPENAI_KEY = originalOpenAiKey;
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'gv-agent-provider-launch-'));
  roots.push(root);
  return root;
}

describe('provider registry launch tolerance', () => {
  test('runtime services launch without local OpenAI credentials', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_KEY;

    const root = makeRoot();
    const configManager = new ConfigManager({
      surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
      workingDir: root,
      homeDir: root,
      configDir: join(root, '.goodvibes', GOODVIBES_AGENT_SURFACE_ROOT),
    });
    const services = createRuntimeServices({
      runtimeBus: new RuntimeEventBus(),
      runtimeStore: createRuntimeStore(),
      configManager,
      workingDir: root,
      homeDirectory: root,
    });
    const provider = services.providerRegistry.get('openai');

    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(provider?.isConfigured?.()).toBe(false);
  });
});
