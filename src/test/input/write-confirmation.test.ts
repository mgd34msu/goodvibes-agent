import { describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { evalCommand } from '../../input/commands/eval.ts';
import { registerReplayRuntimeCommands } from '../../input/commands/replay-runtime.ts';
import { registerSessionContentCommands } from '../../input/commands/session-content.ts';

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

  test('eval gate does not create a missing baseline without --save-baseline --yes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-eval-confirm-'));
    try {
      const out: string[] = [];
      const ctx = baseContext(root, out);
      const baselinePath = join(root, 'baseline.json');

      await evalCommand.handler(['gate', 'core-performance', baselinePath], ctx);

      expect(existsSync(baselinePath)).toBe(false);
      expect(out.join('\n')).toContain('Refusing to create missing eval baseline without --yes');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
