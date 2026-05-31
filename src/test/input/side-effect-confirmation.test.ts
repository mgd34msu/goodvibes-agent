import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerNotifyRuntimeCommands } from '../../input/commands/notify-runtime.ts';
import { registerPlatformServicesRuntimeCommands } from '../../input/commands/platform-services-runtime.ts';

function makeShellPaths(root: string) {
  return {
    workingDirectory: root,
    homeDirectory: root,
    resolveProjectPath: (...parts: string[]) => join(root, '.goodvibes', ...parts),
    resolveUserPath: (...parts: string[]) => join(root, '.goodvibes', ...parts),
    resolveWorkspacePath: (...parts: string[]) => join(root, ...parts),
    isWithinWorkingDirectory: (path: string) => path.startsWith(root),
  };
}

interface SideEffectCalls {
  secretDeletes: number;
  notificationConfigWrites: number;
  notificationUrlWrites: number;
  notificationTests: number;
}

function makeCalls(): SideEffectCalls {
  return {
    secretDeletes: 0,
    notificationConfigWrites: 0,
    notificationUrlWrites: 0,
    notificationTests: 0,
  };
}

function makeContext(root: string, out: string[], calls: SideEffectCalls): CommandContext {
  const shellPaths = makeShellPaths(root);
  const configManager = {
    getCategory: () => ({ webhookUrls: ['https://ntfy.sh/goodvibes-agent-test'] }),
    mergeCategory: () => {
      calls.notificationConfigWrites += 1;
    },
  };
  const secretsManager = {
    inspect: async () => ({
      policy: 'encrypted',
      secureKeys: 1,
      plaintextKeys: 0,
      locations: [],
      warnings: [],
    }),
    list: async () => ['OPENAI_API_KEY'],
    listDetailed: async () => [{ key: 'OPENAI_API_KEY', source: 'goodvibes' }],
    delete: async () => {
      calls.secretDeletes += 1;
    },
  };
  const webhookNotifier = {
    setUrls: () => {
      calls.notificationUrlWrites += 1;
    },
    test: async () => {
      calls.notificationTests += 1;
      return [{ ok: true, url: 'https://ntfy.sh/goodvibes-agent-test' }];
    },
  };

  return {
    session: {} as never,
    provider: {} as never,
    workspace: { shellPaths } as never,
    platform: {
      configManager,
      secretsManager,
      webhookNotifier,
    } as never,
    ops: {} as never,
    extensions: {} as never,
    renderRequest: () => {},
    print: (text: string) => out.push(text),
    exit: () => {},
  } as CommandContext;
}

describe('side-effecting slash command confirmation', () => {
  test('storage delete requires --yes before deleting a secret', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-side-effects-'));
    try {
      const registry = new CommandRegistry();
      registerPlatformServicesRuntimeCommands(registry);
      const out: string[] = [];
      const calls = makeCalls();
      const ctx = makeContext(root, out, calls);

      await registry.get('storage')!.handler(['delete', 'OPENAI_API_KEY'], ctx);

      expect(calls.secretDeletes).toBe(0);
      expect(out.join('\n')).toContain('Refusing to delete secure storage key OPENAI_API_KEY without --yes');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('storage delete proceeds only with --yes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-side-effects-'));
    try {
      const registry = new CommandRegistry();
      registerPlatformServicesRuntimeCommands(registry);
      const out: string[] = [];
      const calls = makeCalls();
      const ctx = makeContext(root, out, calls);

      await registry.get('storage')!.handler(['delete', 'OPENAI_API_KEY', '--yes'], ctx);

      expect(calls.secretDeletes).toBe(1);
      expect(out.join('\n')).toContain('Deleted secure storage key OPENAI_API_KEY');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('notify mutation and network test commands require --yes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-side-effects-'));
    try {
      const registry = new CommandRegistry();
      registerNotifyRuntimeCommands(registry);
      const out: string[] = [];
      const calls = makeCalls();
      const ctx = makeContext(root, out, calls);

      await registry.get('notify')!.handler(['add', 'https://ntfy.sh/new-topic'], ctx);
      await registry.get('notify')!.handler(['remove', 'https://ntfy.sh/goodvibes-agent-test'], ctx);
      await registry.get('notify')!.handler(['clear'], ctx);
      await registry.get('notify')!.handler(['test'], ctx);

      expect(calls.notificationConfigWrites).toBe(0);
      expect(calls.notificationUrlWrites).toBe(0);
      expect(calls.notificationTests).toBe(0);
      expect(out.join('\n')).toContain('without --yes');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
