import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '../../config/index.ts';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import { createRuntimeServices, type RuntimeServices } from '../../runtime/services.ts';

describe('Agent memory storage path', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function makeRuntimeServices(): {
    readonly services: RuntimeServices;
    readonly workingDir: string;
    readonly homeDir: string;
  } {
    root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-memory-path-'));
    const workingDir = join(root, 'workspace');
    const homeDir = join(root, 'home');
    mkdirSync(workingDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    const configManager = new ConfigManager({
      surfaceRoot: 'agent',
      workingDir,
      homeDir,
      configDir: join(homeDir, '.goodvibes', 'agent'),
    });
    return {
      services: createRuntimeServices({
        runtimeBus: new RuntimeEventBus(),
        runtimeStore: createRuntimeStore(),
        configManager,
        workingDir,
        homeDirectory: homeDir,
      }),
      workingDir,
      homeDir,
    };
  }

  test('runtime memory store is Agent-home owned instead of workspace owned', async () => {
    const { services, workingDir, homeDir } = makeRuntimeServices();
    const homeMemoryPath = join(homeDir, '.goodvibes', 'agent', 'memory.sqlite');
    const workspaceMemoryPath = join(workingDir, '.goodvibes', 'agent', 'memory.sqlite');

    try {
      await services.memoryStore.init();
      await services.memoryRegistry.add({
        cls: 'fact',
        scope: 'project',
        summary: 'Agent memory follows the Agent home/profile.',
      });
      await services.memoryStore.save();
    } finally {
      services.memoryStore.close();
      services.providerRegistry.stopWatching();
    }

    expect(existsSync(homeMemoryPath)).toBe(true);
    expect(existsSync(workspaceMemoryPath)).toBe(false);
  });
});
