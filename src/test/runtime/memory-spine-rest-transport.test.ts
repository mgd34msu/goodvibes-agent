/**
 * The memory-spine REST transport (memory-spine-rest-transport.ts) against a REAL
 * daemon — a live DaemonServer bound to a reserved ephemeral port (port 0), never
 * a fixed port and never the developer's real ~/.goodvibes. Proves the wire
 * actually round-trips through the daemon's own memoryRegistry (not a mock), that
 * the honest-search envelope survives the wire faithfully (recall honesty
 * passthrough), that 404 folds to null instead of throwing, and that a stopped
 * daemon makes every op reject (the honest-failure contract — never a silent
 * local fallback from inside the transport itself).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { DaemonServer } from '@pellux/goodvibes-sdk/platform/daemon';
import { UserAuthManager } from '@pellux/goodvibes-sdk/platform/security';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { createFeatureFlagManager } from '@/runtime/index.ts';
import { createRuntimeServices, type RuntimeServices } from '../../runtime/services.ts';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import { createMemorySpineRestTransport } from '../../runtime/memory-spine-rest-transport.ts';
import type { SessionRegistrationConnection } from '../../agent/session-registration.ts';

const TEST_TOKEN = 'memory-spine-transport-token-xyz789';

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
    users: [{
      username: 'admin',
      passwordHash: UserAuthManager.hashPassword('admin'),
      roles: ['admin'],
    }],
  });
}

describe('memory-spine REST transport against a real daemon', () => {
  let daemon: DaemonServer;
  let daemonServices: RuntimeServices;
  let tempRoot: string;
  let port: number;
  let connection: SessionRegistrationConnection;

  beforeEach(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'gv-memory-spine-transport-'));
    const workingDir = join(tempRoot, 'workspace');
    const homeDir = join(tempRoot, 'home');
    mkdirSync(workingDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    port = await reservePort();
    daemonServices = createRuntimeServices({
      runtimeStore: createRuntimeStore(),
      runtimeBus: new RuntimeEventBus(),
      configManager: new ConfigManager({ surfaceRoot: 'tui', configDir: join(homeDir, '.goodvibes', 'tui'), workingDir, homeDir }),
      workingDir,
      homeDirectory: homeDir,
      featureFlags: createFeatureFlagManager(),
      getConversationTitle: () => 'memory-spine-transport-test',
    });
    daemon = new DaemonServer({ port, host: '127.0.0.1', runtimeServices: daemonServices, userAuth: createUserAuth(homeDir) });
    daemon.enable({ daemon: true }, TEST_TOKEN);
    await daemon.start();
    connection = { baseUrl: `http://127.0.0.1:${port}`, token: TEST_TOKEN };
  });

  afterEach(async () => {
    await daemon?.stop();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('add() round-trips through the wire into the DAEMON-owned store', async () => {
    const transport = createMemorySpineRestTransport({ resolveConnection: () => connection });
    const record = await transport.add({ cls: 'fact', scope: 'project', summary: 'wire-added fact' });
    expect(record.summary).toBe('wire-added fact');
    expect(record.confidence).toBe(60); // the store's own baseline, per MemoryStore.add()

    // Proves this genuinely reached the daemon's own store, not a client-side echo.
    const direct = daemonServices.memoryRegistry.get(record.id);
    expect(direct?.summary).toBe('wire-added fact');
  });

  test('get() folds an unknown id to null instead of throwing (honest 404, not a transport failure)', async () => {
    const transport = createMemorySpineRestTransport({ resolveConnection: () => connection });
    await expect(transport.get('mem_does_not_exist')).resolves.toBeNull();
  });

  test('get() returns the real record for a known id', async () => {
    const transport = createMemorySpineRestTransport({ resolveConnection: () => connection });
    const added = await transport.add({ cls: 'fact', scope: 'project', summary: 'fetch me back' });
    const fetched = await transport.get(added.id);
    expect(fetched?.id).toBe(added.id);
    expect(fetched?.summary).toBe('fetch me back');
  });

  test('updateReview() round-trips a review patch and returns null for an unknown id', async () => {
    const transport = createMemorySpineRestTransport({ resolveConnection: () => connection });
    const added = await transport.add({ cls: 'fact', scope: 'project', summary: 'needs review' });
    const reviewed = await transport.updateReview(added.id, { state: 'reviewed', confidence: 92, reviewedBy: 'wire-test' });
    expect(reviewed?.reviewState).toBe('reviewed');
    expect(reviewed?.confidence).toBe(92);
    expect(daemonServices.memoryRegistry.get(added.id)?.reviewState).toBe('reviewed');

    await expect(transport.updateReview('mem_missing', { state: 'stale' })).resolves.toBeNull();
  });

  test('delete() removes the record from the daemon store and returns an honest boolean', async () => {
    const transport = createMemorySpineRestTransport({ resolveConnection: () => connection });
    const added = await transport.add({ cls: 'fact', scope: 'project', summary: 'delete me' });
    await expect(transport.delete(added.id)).resolves.toBe(true);
    expect(daemonServices.memoryRegistry.get(added.id)).toBeNull();
    // A second delete of the same (now-gone) id is honestly false, never a phantom success.
    await expect(transport.delete(added.id)).resolves.toBe(false);
  });

  test('honestSearch() recall-filters flagged and sub-floor records and reports exact exclusion counts — the honesty envelope survives the wire', async () => {
    const transport = createMemorySpineRestTransport({ resolveConnection: () => connection });
    const clean = await transport.add({ cls: 'fact', scope: 'project', summary: 'clean eligible fact', review: { confidence: 80 } });
    const belowFloor = await transport.add({ cls: 'fact', scope: 'project', summary: 'below floor fact', review: { confidence: 40 } });
    const stale = await transport.add({ cls: 'fact', scope: 'project', summary: 'stale fact', review: { confidence: 95 } });
    await transport.updateReview(stale.id, { state: 'stale', staleReason: 'superseded' });

    const result = await transport.honestSearch({}, { recall: true });
    expect(result.recallFiltered).toBe(true);
    expect(result.totalBeforeRecallFilter).toBe(3);
    expect(result.excludedBelowFloorCount).toBe(1);
    expect(result.excludedFlaggedCount).toBe(1);
    expect(result.records.map((r) => r.id)).toEqual([clean.id]);
    expect(result.records.map((r) => r.id)).not.toContain(belowFloor.id);
    expect(result.records.map((r) => r.id)).not.toContain(stale.id);
    // Literal mode (no semantic requested) — matches runHonestMemorySearch's contract exactly.
    expect(result.mode).toBe('literal');
    expect(result.requestedSemantic).toBe(false);
    expect(result.indexUnavailableReason).toBeNull();

    // Without recall, nothing is filtered — a review/browse caller sees everything.
    const browse = await transport.honestSearch({});
    expect(browse.recallFiltered).toBe(false);
    expect(browse.records).toHaveLength(3);
  });

  test('a missing operator token rejects rather than silently degrading', async () => {
    const transport = createMemorySpineRestTransport({ resolveConnection: () => ({ baseUrl: connection.baseUrl, token: null }) });
    await expect(transport.add({ cls: 'fact', summary: 'no token' })).rejects.toThrow(/operator token/);
  });

  test('every op rejects once the daemon has stopped — the honest-failure contract (no silent local fallback inside the transport)', async () => {
    const transport = createMemorySpineRestTransport({ resolveConnection: () => connection, timeoutMs: 500 });
    await daemon.stop();
    await expect(transport.add({ cls: 'fact', summary: 'daemon is down' })).rejects.toThrow();
    await expect(transport.get('any-id')).rejects.toThrow();
    await expect(transport.honestSearch({})).rejects.toThrow();
  });
});
