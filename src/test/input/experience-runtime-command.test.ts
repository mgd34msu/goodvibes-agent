import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerExperienceRuntimeCommands } from '../../input/commands/experience-runtime.ts';
import { registerHealthRuntimeCommands } from '../../input/commands/health-runtime.ts';
import { registerLocalRuntimeCommands } from '../../input/commands/local-runtime.ts';
import { registerProviderAccountsRuntimeCommands } from '../../input/commands/provider-accounts-runtime.ts';

function makeContext(out: string[], opened: string[]): CommandContext {
  return {
    print: (text: string) => { out.push(text); },
    showPanel: (panelId: string) => { opened.push(panelId); },
  } as unknown as CommandContext;
}

describe('experience runtime commands', () => {
  test('approval open is guidance-only in Agent and does not open copied panels', async () => {
    const registry = new CommandRegistry();
    registerExperienceRuntimeCommands(registry);
    const command = registry.get('approval');
    expect(command).toEqual(expect.objectContaining({
      name: 'approval',
      handler: expect.any(Function),
    }));
    const out: string[] = [];
    const opened: string[] = [];

    await command!.handler(['open'], makeContext(out, opened));

    expect(opened).toEqual([]);
    expect(out.join('\n')).toContain('Open Agent Workspace -> Work -> Review approvals');
    expect(out.join('\n')).toContain('or run /approval matrix');
  });

  test('approval matrix remains a read-only transcript summary', async () => {
    const registry = new CommandRegistry();
    registerExperienceRuntimeCommands(registry);
    const command = registry.get('approval');
    expect(command).toEqual(expect.objectContaining({
      name: 'approval',
      handler: expect.any(Function),
    }));
    const out: string[] = [];

    await command!.handler(['matrix'], makeContext(out, []));

    expect(out.join('\n')).toContain('Approval Matrix');
    expect(out.join('\n')).toContain('delegate');
  });

  test('accounts open is guidance-only in Agent and does not open copied panels', async () => {
    const registry = new CommandRegistry();
    registerProviderAccountsRuntimeCommands(registry);
    const command = registry.get('accounts');
    expect(command).toEqual(expect.objectContaining({
      name: 'accounts',
      handler: expect.any(Function),
    }));
    const out: string[] = [];
    const opened: string[] = [];

    await command!.handler(['open'], makeContext(out, opened));

    expect(opened).toEqual([]);
    expect(out.join('\n')).toContain('Open Agent Workspace -> Setup -> Provider accounts');
    expect(out.join('\n')).toContain('or run /accounts review');
  });

  test('health open is guidance-only in Agent before read-model requirements', async () => {
    const registry = new CommandRegistry();
    registerHealthRuntimeCommands(registry);
    const command = registry.get('health');
    expect(command).toEqual(expect.objectContaining({
      name: 'health',
      handler: expect.any(Function),
    }));
    const out: string[] = [];

    await command!.handler(['open'], makeContext(out, []));

    expect(out.join('\n')).toContain('Open Agent Workspace -> Home -> Review health');
    expect(out.join('\n')).toContain('or run /health review');
  });

  test('health command with unavailable service stub prints plain-language error', async () => {
    const registry = new CommandRegistry();
    registerHealthRuntimeCommands(registry);
    const command = registry.get('health');
    const out: string[] = [];
    const context = {
      print: (text: string) => { out.push(text); },
      platform: {
        configManager: {
          get: () => null,
        },
        readModels: {
          session: {
            getSnapshot: () => { throw new Error('session service unavailable'); },
          },
          remote: {
            getSnapshot: () => ({
              supervisor: { sessions: [], activeConnections: 0, degradedConnections: 0 },
            }),
          },
        },
      },
    } as unknown as CommandContext;

    // The review subcommand calls requireReadModels which will reach session.getSnapshot
    // via requireProviderApi — simulate a require* helper that throws
    const contextThrows = {
      print: (text: string) => { out.push(text); },
      platform: {},
    } as unknown as CommandContext;

    await command!.handler(['review'], contextThrows);

    const output = out.join('\n');
    // Should have caught the error and printed a plain-language message, not thrown
    expect(output).toContain('Health command failed');
  });

  test('voice bundle inspect with missing file prints File not found', async () => {
    const registry = new CommandRegistry();
    registerExperienceRuntimeCommands(registry);
    const command = registry.get('voice');
    const out: string[] = [];
    const context = {
      print: (text: string) => { out.push(text); },
      platform: {
        configManager: {
          get: () => null,
        },
      },
      session: { runtime: { sessionId: 'test' } },
      extensions: {},
      clients: {},
    } as unknown as CommandContext;

    const contextWithShell = {
      ...context,
      workspace: {
        shellPaths: {
          resolveWorkspacePath: (p: string) => p,
        },
      },
    } as unknown as CommandContext;

    // Use a path that definitely does not exist
    await command!.handler(['bundle', 'inspect', '/tmp/gv-nonexistent-bundle-xyz.json'], contextWithShell);

    expect(out.join('\n')).toContain('File not found');
  });

  test('voice bundle inspect with malformed JSON prints could not read voice bundle', async () => {
    const registry = new CommandRegistry();
    registerExperienceRuntimeCommands(registry);
    const command = registry.get('voice');
    const out: string[] = [];
    const tmpDir = mkdtempSync(join(tmpdir(), 'gv-voice-test-'));
    const bundlePath = join(tmpDir, 'bad-bundle.json');
    writeFileSync(bundlePath, 'not valid json {{{');

    const context = {
      print: (text: string) => { out.push(text); },
      platform: {
        configManager: { get: () => null },
      },
      session: { runtime: { sessionId: 'test' } },
      workspace: { shellPaths: { resolveWorkspacePath: (p: string) => p } },
      clients: {},
    } as unknown as CommandContext;

    await command!.handler(['bundle', 'inspect', bundlePath], context);

    expect(out.join('\n')).toContain('could not read voice bundle');
  });

  test('unpin works with modelId when model was pinned by registryKey', async () => {
    const registry = new CommandRegistry();
    registerLocalRuntimeCommands(registry);
    const command = registry.get('unpin');
    const out: string[] = [];
    const unpinnedKeys: string[] = [];
    const context = {
      print: (text: string) => { out.push(text); },
      session: { runtime: { sessionId: 'test' } },
      platform: { configManager: { get: () => null } },
      extensions: {},
      clients: {},
      provider: {
        providerRegistry: {
          listProviders: () => [],
        },
      },
      ops: {},
    } as unknown as CommandContext;

    const contextWithApi = {
      ...context,
      clients: {
        providerApi: {
          getFavorites: async () => ({
            pinned: [
              { registryKey: 'anthropic:claude-sonnet-4-5', modelId: 'claude-sonnet-4-5' },
            ],
          }),
          unpinModel: async (key: string) => { unpinnedKeys.push(key); },
        },
      },
    } as unknown as CommandContext;

    // Unpin by short modelId (not registryKey)
    await command!.handler(['claude-sonnet-4-5'], contextWithApi);

    expect(unpinnedKeys).toEqual(['anthropic:claude-sonnet-4-5']);
    expect(out.join('\n')).toContain('Unpinned');
  });

  test('health remote repair guidance uses remote build-host wording', async () => {
    const registry = new CommandRegistry();
    registerHealthRuntimeCommands(registry);
    const command = registry.get('health');
    expect(command).toEqual(expect.objectContaining({
      name: 'health',
      handler: expect.any(Function),
    }));
    const out: string[] = [];
    const context = {
      print: (text: string) => { out.push(text); },
      platform: {
        readModels: {
          remote: {
            getSnapshot: () => ({
              supervisor: {
                sessions: [],
                activeConnections: 0,
                degradedConnections: 0,
              },
            }),
          },
        },
      },
    } as unknown as CommandContext;

    await command!.handler(['remote'], context);

    const text = out.join('\n');
    expect(text).toContain('repair remote build-host state outside Agent');
    expect(text).not.toContain('repair remote runner state');
    expect(text).not.toContain('repair remote worker state');
  });

  test('health memory reports the honest unavailable state (no fabricated governor snapshot)', async () => {
    const registry = new CommandRegistry();
    registerHealthRuntimeCommands(registry);
    const command = registry.get('health');
    const out: string[] = [];
    const context = {
      print: (text: string) => { out.push(text); },
      platform: { readModels: {} },
    } as unknown as CommandContext;

    await command!.handler(['memory'], context);

    const text = out.join('\n');
    expect(text).toContain('Health Review Memory');
    expect(text).toContain('available: no');
    expect(text).toContain('ops.memory.get has no registered handler');
    expect(text).not.toMatch(/tier:|budgetMb|rssMb/);
  });

  test('health repair memory names the domain and its unavailable-repair reason', async () => {
    const registry = new CommandRegistry();
    registerHealthRuntimeCommands(registry);
    const command = registry.get('health');
    const out: string[] = [];
    const context = {
      print: (text: string) => { out.push(text); },
      platform: { readModels: {} },
    } as unknown as CommandContext;

    await command!.handler(['repair', 'memory'], context);

    const text = out.join('\n');
    expect(text).toContain('domain memory');
    expect(text).toContain('no local repair action exists');
  });

  test('voice status reports the real managed local-voice runtime state', async () => {
    const registry = new CommandRegistry();
    registerExperienceRuntimeCommands(registry);
    const command = registry.get('voice');
    const out: string[] = [];
    const context = {
      print: (text: string) => { out.push(text); },
      platform: {
        configManager: { get: () => null },
        voiceSetup: {
          status: () => ({
            platform: 'linux',
            state: 'not-provisioned',
            tts: { engine: 'piper', binaryPresent: false, voicePresent: false, binaryPath: '', modelPath: '' },
            stt: { engine: 'whisper.cpp', supported: true, state: 'not-provisioned', binaryPresent: false, modelPresent: false, binaryPath: '', modelPath: '', reason: '' },
            offerBytes: 62_000_000,
          }),
        },
      },
      workspace: { shellPaths: { resolveWorkspacePath: (p: string) => p } },
      session: { runtime: { sessionId: 'test' } },
      clients: {},
    } as unknown as CommandContext;

    await command!.handler(['status'], context);

    const text = out.join('\n');
    expect(text).toContain('Managed Local-Voice Status');
    expect(text).toContain('platform: linux');
    expect(text).toContain('state: not provisioned');
    expect(text).toContain('install size ~59 MB');
  });

  test('voice setup without --yes refuses and names the confirmation usage', async () => {
    const registry = new CommandRegistry();
    registerExperienceRuntimeCommands(registry);
    const command = registry.get('voice');
    const out: string[] = [];
    let installCalled = false;
    const context = {
      print: (text: string) => { out.push(text); },
      platform: {
        configManager: { get: () => null },
        voiceSetup: { install: async () => { installCalled = true; throw new Error('must not be called'); } },
      },
      workspace: { shellPaths: { resolveWorkspacePath: (p: string) => p } },
      session: { runtime: { sessionId: 'test' } },
      clients: {},
    } as unknown as CommandContext;

    await command!.handler(['setup'], context);

    expect(installCalled).toBe(false);
    expect(out.join('\n')).toContain('Refusing to install the managed local-voice runtime');
    expect(out.join('\n')).toContain('/voice setup --yes');
  });

  test('voice setup --yes runs the one-act install and prints per-component progress plus the final receipt', async () => {
    const registry = new CommandRegistry();
    registerExperienceRuntimeCommands(registry);
    const command = registry.get('voice');
    const out: string[] = [];
    const context = {
      print: (text: string) => { out.push(text); },
      platform: {
        configManager: { get: () => null },
        voiceSetup: {
          install: async () => ({
            provisioned: true,
            platform: 'linux',
            tts: { engine: 'piper', state: 'provisioned', binaryPath: '/managed/piper', modelPath: '/managed/voice.onnx' },
            // Honest terminal state for STT where goodvibes has not yet published a pinned
            // bundle for this platform — not a fabricated success.
            stt: { engine: 'whisper.cpp', state: 'unsupported-platform', reason: 'no pinned whisper.cpp bundle published for this platform yet' },
            components: [
              { id: 'piper-engine', state: 'installed', bytes: 12_000_000 },
              { id: 'piper-voice', state: 'installed', bytes: 47_000_000 },
              { id: 'whisper-engine', state: 'skipped', error: 'no pinned bundle for this platform' },
            ],
            configured: {
              set: [{ key: 'voice.local.tts.binary', value: '/managed/piper' }],
              skipped: [{ key: 'voice.local.tts.binary', reason: 'already set by the user' }],
            },
          }),
        },
      },
      workspace: { shellPaths: { resolveWorkspacePath: (p: string) => p } },
      session: { runtime: { sessionId: 'test' } },
      clients: {},
    } as unknown as CommandContext;

    await command!.handler(['setup', '--yes'], context);
    // The install runs fire-and-forget so the prompt is never blocked on a
    // multi-hundred-MB download; let its .then() callback flush before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const text = out.join('\n');
    expect(text).toContain('Installing managed local-voice runtime');
    expect(text).toContain('Managed Local-Voice Setup');
    expect(text).toContain('piper-engine: installed');
    expect(text).toContain('piper-voice: installed');
    expect(text).toContain('whisper-engine: skipped (no pinned bundle for this platform)');
    expect(text).toContain('stt (whisper.cpp): unsupported platform (no pinned whisper.cpp bundle published for this platform yet)');
    expect(text).toContain('result: voice.local.* configured');
    expect(text).toContain('set voice.local.tts.binary = /managed/piper');
    expect(text).toContain('skipped voice.local.tts.binary (already set by the user)');
  });
});
