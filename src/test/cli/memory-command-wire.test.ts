/**
 * The `goodvibes-agent memory` CLI in BOTH modes:
 *  - daemon up: a real DaemonServer (bootDaemon-style, reserved port, never a real
 *    ~/.goodvibes) is reachable, so wire-eligible subcommands route over the wire
 *    and the record lands in the DAEMON's own store, never the CLI's local file.
 *  - daemon down: proven by the existing memory-command.test.ts fixtures (fetch
 *    mocked to fail, exercising the local-direct fallback) — this file focuses on
 *    the "up" half plus one direct side-by-side proof that the SAME CLI command,
 *    run against the two different fixtures, lands in two different stores.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager as SdkConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { DaemonServer } from '@pellux/goodvibes-sdk/platform/daemon';
import { UserAuthManager } from '@pellux/goodvibes-sdk/platform/security';
import { resolveCanonicalMemoryDbPath, MemoryEmbeddingProviderRegistry, MemoryRegistry, MemoryStore } from '@pellux/goodvibes-sdk/platform/state';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { createFeatureFlagManager } from '@/runtime/index.ts';
import { createRuntimeServices, type RuntimeServices } from '../../runtime/services.ts';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import { ConfigManager } from '../../config/index.ts';
import { handleGoodVibesCliCommand, parseGoodVibesCli } from '../../cli/index.ts';

const TEST_TOKEN = 'memory-cli-wire-token-321';

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to reserve test port')));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function createUserAuth(homeDir: string): UserAuthManager {
  return new UserAuthManager({
    bootstrapFilePath: join(homeDir, 'auth-users.json'),
    bootstrapCredentialPath: join(homeDir, 'auth-bootstrap.txt'),
    users: [{ username: 'admin', passwordHash: UserAuthManager.hashPassword('admin'), roles: ['admin'] }],
  });
}

async function runCli(args: readonly string[], workingDir: string, homeDirectory: string): Promise<{ readonly exitCode: number; readonly output: string }> {
  const output: string[] = [];
  const originalLog = console.log;
  try {
    console.log = (value?: unknown) => { output.push(String(value)); };
    const result = await handleGoodVibesCliCommand({
      cli: parseGoodVibesCli(args),
      configManager: new ConfigManager({ workingDir, homeDir: homeDirectory, surfaceRoot: 'agent' }),
      workingDirectory: workingDir,
      homeDirectory,
    });
    return { exitCode: result.exitCode, output: output.join('\n') };
  } finally {
    console.log = originalLog;
  }
}

describe('memory CLI — daemon up routes over the wire', () => {
  let root: string;
  let workingDir: string;
  let homeDir: string;
  let daemon: DaemonServer;
  let daemonServices: RuntimeServices;
  let port: number;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'gv-memory-cli-wire-'));
    workingDir = join(root, 'workspace');
    homeDir = join(root, 'home');
    mkdirSync(workingDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });

    const daemonHomeDir = join(root, 'daemon-home');
    const daemonWorkingDir = join(root, 'daemon-workspace');
    mkdirSync(daemonHomeDir, { recursive: true });
    mkdirSync(daemonWorkingDir, { recursive: true });
    port = await reservePort();
    daemonServices = createRuntimeServices({
      runtimeStore: createRuntimeStore(),
      runtimeBus: new RuntimeEventBus(),
      configManager: new SdkConfigManager({ surfaceRoot: 'tui', configDir: join(daemonHomeDir, '.goodvibes', 'tui'), workingDir: daemonWorkingDir, homeDir: daemonHomeDir }),
      workingDir: daemonWorkingDir,
      homeDirectory: daemonHomeDir,
      featureFlags: createFeatureFlagManager(),
      getConversationTitle: () => 'memory-cli-wire-daemon',
    });
    daemon = new DaemonServer({ port, host: '127.0.0.1', runtimeServices: daemonServices, userAuth: createUserAuth(daemonHomeDir) });
    daemon.enable({ daemon: true }, TEST_TOKEN);
    await daemon.start();

    // Point the CLI's connection resolver (createSpineConnectionResolver reads
    // configManager + the connected-host token path under homeDirectory) at this
    // real daemon — the CLI process itself has no lasting config store, so this
    // has to be a fresh ConfigManager written to the same configDir the CLI will
    // construct in runCli().
    const cliConfigManager = new ConfigManager({ workingDir, homeDir, surfaceRoot: 'agent' });
    cliConfigManager.set('controlPlane.host', '127.0.0.1');
    cliConfigManager.set('controlPlane.port', port);
    mkdirSync(join(homeDir, '.goodvibes', 'daemon'), { recursive: true });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(homeDir, '.goodvibes', 'daemon', 'operator-tokens.json'), JSON.stringify({ token: TEST_TOKEN }));
  });

  afterEach(async () => {
    await daemon?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  test('memory add reaches the DAEMON store, not the CLI\'s local canonical file', async () => {
    const created = await runCli(['memory', 'add', 'fact', 'CLI wire-added fact', '--scope', 'project', '--json'], workingDir, homeDir);
    expect(created.exitCode).toBe(0);
    const parsed = JSON.parse(created.output) as { readonly kind: string; readonly data: { readonly id: string; readonly summary: string } };
    expect(parsed.kind).toBe('agent.memory.add');
    expect(parsed.data.summary).toBe('CLI wire-added fact');

    // Reached the daemon's own store...
    expect(daemonServices.memoryRegistry.get(parsed.data.id)?.summary).toBe('CLI wire-added fact');

    // ...and never touched the CLI's own local canonical store file (opening it
    // directly here to check, exactly like withMemory would have).
    const localDbPath = resolveCanonicalMemoryDbPath(homeDir);
    const embeddingRegistry = new MemoryEmbeddingProviderRegistry({ configManager: new ConfigManager({ workingDir, homeDir, surfaceRoot: 'agent' }) });
    const localStore = new MemoryStore(localDbPath, { embeddingRegistry });
    await localStore.init();
    const localRegistry = new MemoryRegistry(localStore);
    try {
      expect(localRegistry.getAll()).toHaveLength(0);
    } finally {
      localStore.close();
    }
  });

  test('memory review and memory delete also route over the wire against the daemon record', async () => {
    const created = await runCli(['memory', 'add', 'fact', 'reviewable wire fact', '--json'], workingDir, homeDir);
    const id = (JSON.parse(created.output) as { readonly data: { readonly id: string } }).data.id;

    const reviewed = await runCli(['memory', 'review', id, 'reviewed', '--confidence', '91'], workingDir, homeDir);
    expect(reviewed.exitCode).toBe(0);
    expect(daemonServices.memoryRegistry.get(id)?.reviewState).toBe('reviewed');
    expect(daemonServices.memoryRegistry.get(id)?.confidence).toBe(91);

    const deleted = await runCli(['memory', 'delete', id, '--yes'], workingDir, homeDir);
    expect(deleted.exitCode).toBe(0);
    expect(daemonServices.memoryRegistry.get(id)).toBeNull();
  });
});
