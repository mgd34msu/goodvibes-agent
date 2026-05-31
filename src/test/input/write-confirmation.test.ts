import { describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { ProfileManager } from '@pellux/goodvibes-sdk/platform/profiles';
import { evalCommand } from '../../input/commands/eval.ts';
import { registerOperatorRuntimeCommands } from '../../input/commands/operator-runtime.ts';
import { registerReplayRuntimeCommands } from '../../input/commands/replay-runtime.ts';
import { registerSessionContentCommands } from '../../input/commands/session-content.ts';
import { registerSessionWorkflowCommands } from '../../input/commands/session-workflow.ts';
import type { ShellModeManagerService } from '../../runtime/index.ts';

function makeShellPaths(root: string) {
  return {
    workingDirectory: root,
    homeDirectory: root,
    resolveProjectPath: (...parts: string[]) => join(root, '.goodvibes', ...parts),
    resolveUserPath: (...parts: string[]) => join(root, '.goodvibes', ...parts),
    resolveWorkspacePath: (...parts: string[]) => resolve(root, ...parts),
    isWithinWorkingDirectory: (path: string) => path.startsWith(root),
  };
}

function baseContext(root: string, out: string[]): CommandContext {
  return {
    session: {} as never,
    provider: {} as never,
    workspace: { shellPaths: makeShellPaths(root) } as never,
    platform: {} as never,
    ops: {} as never,
    extensions: {} as never,
    renderRequest: () => {},
    print: (text: string) => out.push(text),
    exit: () => {},
  } as CommandContext;
}

describe('write/export command confirmation', () => {
  test('conversation export requires --yes before writing a transcript file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-export-confirm-'));
    try {
      const registry = new CommandRegistry();
      registerSessionContentCommands(registry);
      const out: string[] = [];
      const ctx = {
        ...baseContext(root, out),
        session: {
          conversationManager: {
            title: 'Exported Session',
            toJSON: () => ({ messages: [{ role: 'user', content: 'hello' }] }),
          },
          runtime: {
            model: 'gpt-test',
            provider: 'provider-test',
            sessionId: 'session-export-test',
          },
        },
      } as unknown as CommandContext;
      const target = join(root, 'conversation.md');

      await registry.get('export')!.handler([target], ctx);
      expect(existsSync(target)).toBe(false);
      expect(out.join('\n')).toContain('Refusing to export conversation');

      out.length = 0;
      await registry.get('export')!.handler([target, '--yes'], ctx);
      expect(existsSync(target)).toBe(true);
      expect(readFileSync(target, 'utf-8')).toContain('hello');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('replay export requires --yes before invoking replay engine export', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-replay-confirm-'));
    try {
      const registry = new CommandRegistry();
      registerReplayRuntimeCommands(registry);
      const out: string[] = [];
      const replayExport = mock(async (_path: string) => {});
      const ctx = {
        ...baseContext(root, out),
        platform: {
          replayEngine: {
            getSnapshot: () => ({
              status: 'loaded',
              runId: 'run-1',
              totalRevisions: 2,
              mismatches: [],
            }),
            export: replayExport,
          },
        },
      } as unknown as CommandContext;

      await registry.get('replay')!.handler(['export', 'report.json'], ctx);
      expect(replayExport).toHaveBeenCalledTimes(0);
      expect(out.join('\n')).toContain('Refusing to export replay run');

      out.length = 0;
      await registry.get('replay')!.handler(['export', 'report.json', '--yes'], ctx);
      expect(replayExport).toHaveBeenCalledTimes(1);
      expect(out.join('\n')).toContain('Report export started');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('eval run and gate require --yes before model-costing execution', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-eval-confirm-'));
    try {
      const out: string[] = [];
      const ctx = baseContext(root, out);
      const baselinePath = join(root, 'baseline.json');

      await evalCommand.handler(['run', 'core-performance'], ctx);
      expect(out.join('\n')).toContain('Refusing to run eval suite core-performance without --yes');

      out.length = 0;
      await evalCommand.handler(['gate', 'core-performance', baselinePath], ctx);

      expect(existsSync(baselinePath)).toBe(false);
      expect(out.join('\n')).toContain('Refusing to run eval gate core-performance without --yes');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('session and memory deletes require --yes before mutating local state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-delete-confirm-'));
    try {
      const registry = new CommandRegistry();
      registerSessionWorkflowCommands(registry);
      registerSessionContentCommands(registry);
      const out: string[] = [];
      let deletedSession = '';
      let removedMemory = '';
      const ctx = {
        ...baseContext(root, out),
        session: {
          runtime: {
            sessionId: 'active-session',
            model: 'gpt-test',
            provider: 'provider-test',
          },
          sessionManager: {
            list: () => [{
              name: 'saved-session',
              title: 'Saved Session',
              timestamp: Date.now(),
              messageCount: 1,
              filePath: join(root, 'saved-session.jsonl'),
            }],
            delete: (name: string) => {
              deletedSession = name;
            },
          },
          conversationManager: {},
          sessionMemoryStore: {
            remove: (id: string) => {
              removedMemory = id;
              return true;
            },
          },
        },
      } as unknown as CommandContext;

      await registry.get('session')!.handler(['delete', 'saved-session'], ctx);
      expect(deletedSession).toBe('');
      expect(out.join('\n')).toContain('Refusing to delete saved session saved-session without --yes');

      out.length = 0;
      await registry.get('session')!.handler(['delete', 'saved-session', '--yes'], ctx);
      expect(deletedSession).toBe('saved-session');

      out.length = 0;
      await registry.get('memory')!.handler(['remove', 'mem-1'], ctx);
      expect(removedMemory).toBe('');
      expect(out.join('\n')).toContain('Refusing to remove session memory mem-1 without --yes');

      out.length = 0;
      await registry.get('memory')!.handler(['remove', 'mem-1', '--yes'], ctx);
      expect(removedMemory).toBe('mem-1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('template save and delete require --yes before writing template state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-template-confirm-'));
    try {
      const registry = new CommandRegistry();
      registerSessionContentCommands(registry);
      const out: string[] = [];
      const ctx = {
        ...baseContext(root, out),
        session: {
          conversationManager: {
            getLastUserMessage: () => 'template body',
          },
        },
      } as unknown as CommandContext;

      await registry.get('template')!.handler(['save', 'demo'], ctx);
      expect(out.join('\n')).toContain('Refusing to save prompt template demo without --yes');

      out.length = 0;
      await registry.get('template')!.handler(['save', 'demo', '--yes'], ctx);
      expect(out.join('\n')).toContain('Template saved: demo');

      out.length = 0;
      await registry.get('template')!.handler(['delete', 'demo'], ctx);
      expect(out.join('\n')).toContain('Refusing to delete prompt template demo without --yes');

      out.length = 0;
      await registry.get('template')!.handler(['delete', 'demo', '--yes'], ctx);
      expect(out.join('\n')).toContain('Template deleted: demo');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('profile save and delete commands require --yes before writing profile state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-profile-confirm-'));
    try {
      const registry = new CommandRegistry();
      registerOperatorRuntimeCommands(registry);
      const out: string[] = [];
      const profileManager = new ProfileManager(join(root, 'profiles'));
      const configManager = new ConfigManager({
        surfaceRoot: 'agent',
        workingDir: root,
        homeDir: root,
        configDir: join(root, '.goodvibes', 'agent'),
      });
      const ctx = {
        ...baseContext(root, out),
        platform: {
          configManager,
        },
        workspace: {
          profileManager,
          shellPaths: makeShellPaths(root),
        },
      } as unknown as CommandContext;

      await registry.get('profiles')!.handler(['save', 'demo'], ctx);
      expect(profileManager.list()).toHaveLength(0);
      expect(out.join('\n')).toContain('Refusing to save config profile demo without --yes');

      out.length = 0;
      await registry.get('profiles')!.handler(['save', 'demo', '--yes'], ctx);
      expect(profileManager.list().some((profile) => profile.name === 'demo')).toBe(true);

      out.length = 0;
      await registry.get('profiles')!.handler(['delete', 'demo'], ctx);
      expect(profileManager.list().some((profile) => profile.name === 'demo')).toBe(true);
      expect(out.join('\n')).toContain('Refusing to delete config profile demo without --yes');

      out.length = 0;
      await registry.get('profiles')!.handler(['delete', 'demo', '--yes'], ctx);
      expect(profileManager.list().some((profile) => profile.name === 'demo')).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('mode preset and domain overrides require --yes before writing interaction state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-mode-confirm-'));
    try {
      const registry = new CommandRegistry();
      registerOperatorRuntimeCommands(registry);
      const out: string[] = [];
      const setMode = mock((mode: Parameters<ShellModeManagerService['setHITLMode']>[0]) => mode);
      const setDomainVerbosity = mock((
        domain: Parameters<ShellModeManagerService['setDomainVerbosity']>[0],
        verbosity: Parameters<ShellModeManagerService['setDomainVerbosity']>[1],
      ) => `${domain}:${verbosity}`);
      const preset: ReturnType<ShellModeManagerService['getHITLPreset']> = {
        name: 'balanced',
        description: 'Balanced interaction mode',
        defaultDomainVerbosity: 'normal',
        quietWhileTyping: true,
        batchWindowMs: 500,
      };
      const modeManager: ShellModeManagerService = {
        getHITLMode: () => 'balanced',
        getHITLPreset: () => preset,
        listHITLPresets: () => [preset],
        setHITLMode: setMode,
        setDomainVerbosity,
        getDomainOverrides: () => ({}),
      };
      const configManager = new ConfigManager({
        surfaceRoot: 'agent',
        workingDir: root,
        homeDir: root,
        configDir: join(root, '.goodvibes', 'agent'),
      });
      const ctx = {
        ...baseContext(root, out),
        platform: { configManager },
        ops: { modeManager },
      } as unknown as CommandContext;

      await registry.get('mode')!.handler(['quiet'], ctx);
      expect(setMode).toHaveBeenCalledTimes(0);
      expect(out.join('\n')).toContain('Refusing to set HITL mode to quiet without --yes');

      out.length = 0;
      await registry.get('mode')!.handler(['quiet', '--yes'], ctx);
      expect(setMode).toHaveBeenCalledWith('quiet');
      expect(out.join('\n')).toContain('HITL mode set to: balanced');

      out.length = 0;
      await registry.get('mode')!.handler(['set-domain', 'automation', 'minimal'], ctx);
      expect(setDomainVerbosity).toHaveBeenCalledTimes(0);
      expect(out.join('\n')).toContain('Refusing to set HITL verbosity for automation without --yes');

      out.length = 0;
      await registry.get('mode')!.handler(['set-domain', 'automation', 'minimal', '--yes'], ctx);
      expect(setDomainVerbosity).toHaveBeenCalledWith('automation', 'minimal');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
