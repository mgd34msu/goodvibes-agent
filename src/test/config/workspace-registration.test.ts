import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShellPathService } from '@/runtime/index.ts';
import {
  answerWorkspaceRegistrationPrompt,
  createWorkspaceRegistrationStore,
  isBroadWorkspaceRoot,
  migrateLegacyWorkspaceRegistryIfNeeded,
  normalizeWorkspaceRoot,
  resolveWorkspaceRegistrationSync,
  sharedWorkspaceRegistrationStorePath,
} from '../../config/workspace-registration.ts';

function makeShellPaths() {
  const home = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-registration-'));
  const work = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-registration-work-'));
  return { shellPaths: createShellPathService({ workingDirectory: work, homeDirectory: home }), work, home };
}

function legacyRegistryPath(home: string): string {
  return join(home, '.goodvibes', 'agent', 'checkpoints', 'registered-workspaces.json');
}

describe('workspace-registration: shared store resolution', () => {
  test('an unregistered workspace resolves as unknown, no shared file created', () => {
    const { shellPaths, work } = makeShellPaths();
    const resolution = resolveWorkspaceRegistrationSync(shellPaths, work, {});
    expect(resolution.status).toBe('unknown');
    expect(resolution.coveredBy).toBeNull();
    expect(existsSync(sharedWorkspaceRegistrationStorePath(shellPaths))).toBe(false);
  });

  test('registering via the async store makes the sync resolver report covered', async () => {
    const { shellPaths, work } = makeShellPaths();
    const store = createWorkspaceRegistrationStore(shellPaths);
    const result = await store.add(work);
    expect(result.alreadyRegistered).toBe(false);
    expect(result.record.root).toBe(normalizeWorkspaceRoot(work));

    const resolution = resolveWorkspaceRegistrationSync(shellPaths, work, {});
    expect(resolution.status).toBe('covered');
    expect(resolution.coveredBy).toBe(normalizeWorkspaceRoot(work));
  });

  test('coverage flows down a registered root\'s subtree', async () => {
    const { shellPaths, work } = makeShellPaths();
    const store = createWorkspaceRegistrationStore(shellPaths);
    await store.add(work);

    const nested = join(work, 'packages', 'app');
    const resolution = resolveWorkspaceRegistrationSync(shellPaths, nested, {});
    expect(resolution.status).toBe('covered');
    expect(resolution.coveredBy).toBe(normalizeWorkspaceRoot(work));
  });

  test('worktree-link inheritance: a linked worktree outside the registered subtree still resolves covered', async () => {
    const { shellPaths, work } = makeShellPaths();
    const store = createWorkspaceRegistrationStore(shellPaths);
    await store.add(work);

    const siblingWorktree = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-registration-worktree-'));
    // Outside `work`'s subtree entirely, so a plain path-ancestry check would
    // miss it — only the injected worktree-link git metadata makes it resolve.
    const resolution = resolveWorkspaceRegistrationSync(shellPaths, siblingWorktree, {
      mainWorktreeRoot: work,
    });
    expect(resolution.status).toBe('covered');
    expect(resolution.viaWorktreeLink).toBe(true);
    expect(resolution.coveredBy).toBe(normalizeWorkspaceRoot(work));
  });

  test('a declined root is remembered subtree-scoped and does not silently re-register', async () => {
    const { shellPaths, work } = makeShellPaths();
    const store = createWorkspaceRegistrationStore(shellPaths);
    await store.decline(work);

    const resolution = resolveWorkspaceRegistrationSync(shellPaths, work, {});
    expect(resolution.status).toBe('declined');
    expect(resolution.declinedRoot).toBe(normalizeWorkspaceRoot(work));
  });
});

describe('workspace-registration: legacy registry migration', () => {
  test('no legacy file: migration is a no-op, no receipt written', () => {
    const { shellPaths, home } = makeShellPaths();
    const result = migrateLegacyWorkspaceRegistryIfNeeded(shellPaths);
    expect(result).toBeNull();
    expect(existsSync(join(home, '.goodvibes', 'control-plane', 'workspace-registration-migration-receipt.json'))).toBe(false);
  });

  test('a legacy file with records migrates once into the shared store and writes a receipt', async () => {
    const { shellPaths, work, home } = makeShellPaths();
    const legacyPath = legacyRegistryPath(home);
    mkdirSync(join(home, '.goodvibes', 'agent', 'checkpoints'), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({
      version: 1,
      workspaces: [{ root: work, registeredAt: '2026-01-01T00:00:00.000Z', label: 'legacy' }],
    }));

    const result = migrateLegacyWorkspaceRegistryIfNeeded(shellPaths);
    expect(result).not.toBeNull();
    expect(result?.recordsMigrated).toBe(1);
    expect(result?.recordsAlreadyPresent).toBe(0);

    const store = createWorkspaceRegistrationStore(shellPaths);
    const snapshot = await store.snapshot();
    expect(snapshot.workspaces).toHaveLength(1);
    expect(snapshot.workspaces[0]?.root).toBe(normalizeWorkspaceRoot(work));
    expect(snapshot.workspaces[0]?.label).toBe('legacy');
    // Original registeredAt is preserved, not overwritten with "now".
    expect(snapshot.workspaces[0]?.registeredAt).toBe('2026-01-01T00:00:00.000Z');
  });

  test('a second migration call is a no-op even though the legacy file is still present', () => {
    const { shellPaths, work, home } = makeShellPaths();
    const legacyPath = legacyRegistryPath(home);
    mkdirSync(join(home, '.goodvibes', 'agent', 'checkpoints'), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({
      version: 1,
      workspaces: [{ root: work, registeredAt: '2026-01-01T00:00:00.000Z' }],
    }));

    const first = migrateLegacyWorkspaceRegistryIfNeeded(shellPaths);
    expect(first?.recordsMigrated).toBe(1);

    const second = migrateLegacyWorkspaceRegistryIfNeeded(shellPaths);
    expect(second).toBeNull();
  });

  test('a migrated-then-unregistered root does not come back on a later startup', async () => {
    const { shellPaths, work, home } = makeShellPaths();
    const legacyPath = legacyRegistryPath(home);
    mkdirSync(join(home, '.goodvibes', 'agent', 'checkpoints'), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({
      version: 1,
      workspaces: [{ root: work, registeredAt: '2026-01-01T00:00:00.000Z' }],
    }));

    migrateLegacyWorkspaceRegistryIfNeeded(shellPaths);
    const store = createWorkspaceRegistrationStore(shellPaths);
    await store.remove(work);

    // Migration must not re-run and re-add `work` on this later "startup".
    const second = migrateLegacyWorkspaceRegistryIfNeeded(shellPaths);
    expect(second).toBeNull();
    const resolution = resolveWorkspaceRegistrationSync(shellPaths, work, {});
    expect(resolution.status).toBe('unknown');
  });

  test('records already present in the shared store are counted, not duplicated', async () => {
    const { shellPaths, work, home } = makeShellPaths();
    const store = createWorkspaceRegistrationStore(shellPaths);
    await store.add(work);

    const legacyPath = legacyRegistryPath(home);
    mkdirSync(join(home, '.goodvibes', 'agent', 'checkpoints'), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({
      version: 1,
      workspaces: [{ root: work, registeredAt: '2026-01-01T00:00:00.000Z' }],
    }));

    const result = migrateLegacyWorkspaceRegistryIfNeeded(shellPaths);
    expect(result?.recordsMigrated).toBe(0);
    expect(result?.recordsAlreadyPresent).toBe(1);
    const snapshot = await store.snapshot();
    expect(snapshot.workspaces).toHaveLength(1);
  });

  test('a malformed legacy file migrates zero records but still writes a receipt (never retried)', () => {
    const { shellPaths, home } = makeShellPaths();
    const legacyPath = legacyRegistryPath(home);
    mkdirSync(join(home, '.goodvibes', 'agent', 'checkpoints'), { recursive: true });
    writeFileSync(legacyPath, 'not json');

    const result = migrateLegacyWorkspaceRegistryIfNeeded(shellPaths);
    expect(result?.recordsMigrated).toBe(0);
    expect(existsSync(join(home, '.goodvibes', 'control-plane', 'workspace-registration-migration-receipt.json'))).toBe(true);

    const second = migrateLegacyWorkspaceRegistryIfNeeded(shellPaths);
    expect(second).toBeNull();
  });
});

describe('workspace-registration: first-start prompt support', () => {
  test('isBroadWorkspaceRoot refuses the home directory', () => {
    const { shellPaths, home } = makeShellPaths();
    expect(isBroadWorkspaceRoot(shellPaths, home)).toBe(true);
  });

  test('isBroadWorkspaceRoot refuses the filesystem root', () => {
    const { shellPaths } = makeShellPaths();
    expect(isBroadWorkspaceRoot(shellPaths, '/')).toBe(true);
  });

  test('isBroadWorkspaceRoot refuses the daemon state directory (~/.goodvibes)', () => {
    const { shellPaths, home } = makeShellPaths();
    expect(isBroadWorkspaceRoot(shellPaths, join(home, '.goodvibes'))).toBe(true);
  });

  test('isBroadWorkspaceRoot allows an ordinary project directory', () => {
    const { shellPaths, work } = makeShellPaths();
    expect(isBroadWorkspaceRoot(shellPaths, work)).toBe(false);
  });

  test('answerWorkspaceRegistrationPrompt(accepted:true) registers the root', async () => {
    const { shellPaths, work } = makeShellPaths();
    answerWorkspaceRegistrationPrompt(shellPaths, work, true);
    const store = createWorkspaceRegistrationStore(shellPaths);
    const resolved = await pollUntilResolved(store, work, 'covered');
    expect(resolved).toBe(true);
  });

  test('answerWorkspaceRegistrationPrompt(accepted:false) declines the root', async () => {
    const { shellPaths, work } = makeShellPaths();
    answerWorkspaceRegistrationPrompt(shellPaths, work, false);
    const store = createWorkspaceRegistrationStore(shellPaths);
    const resolved = await pollUntilResolved(store, work, 'declined');
    expect(resolved).toBe(true);
  });
});

async function pollUntilResolved(
  store: ReturnType<typeof createWorkspaceRegistrationStore>,
  path: string,
  status: 'covered' | 'declined',
  timeoutMs = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await store.resolve(path)).status === status) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}
