import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createShellPathService } from '@/runtime/index.ts';
import {
  isWorkspaceRegistered,
  normalizeWorkspaceRoot,
  readWorkspaceRegistry,
  registerWorkspace,
  unregisterWorkspace,
  workspaceRegistryPath,
} from '../../config/workspace-registry.ts';

function makeShellPaths() {
  const home = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-registry-'));
  const work = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-registry-work-'));
  return { shellPaths: createShellPathService({ workingDirectory: work, homeDirectory: home }), work, home };
}

describe('workspace-registry', () => {
  test('an unregistered workspace reads as not registered, no file created', () => {
    const { shellPaths, work } = makeShellPaths();
    expect(isWorkspaceRegistered(shellPaths, work)).toBe(false);
    expect(readWorkspaceRegistry(shellPaths).workspaces).toEqual([]);
  });

  test('register then is-registered then list round-trips', () => {
    const { shellPaths, work } = makeShellPaths();
    const result = registerWorkspace(shellPaths, work, { label: 'agent' });
    expect(result.alreadyRegistered).toBe(false);
    expect(result.record.root).toBe(normalizeWorkspaceRoot(work));
    expect(result.record.label).toBe('agent');

    expect(isWorkspaceRegistered(shellPaths, work)).toBe(true);
    const snapshot = readWorkspaceRegistry(shellPaths);
    expect(snapshot.workspaces).toHaveLength(1);
    expect(snapshot.workspaces[0]?.root).toBe(normalizeWorkspaceRoot(work));
  });

  test('registering the same root twice is idempotent and reports alreadyRegistered', () => {
    const { shellPaths, work } = makeShellPaths();
    registerWorkspace(shellPaths, work);
    const second = registerWorkspace(shellPaths, work, { label: 'ignored-on-repeat' });
    expect(second.alreadyRegistered).toBe(true);
    expect(readWorkspaceRegistry(shellPaths).workspaces).toHaveLength(1);
  });

  test('a trailing separator normalizes to the same registered root', () => {
    const { shellPaths, work } = makeShellPaths();
    registerWorkspace(shellPaths, work);
    expect(isWorkspaceRegistered(shellPaths, `${work}/`)).toBe(true);
  });

  test('unregister removes a registered root and is honest when nothing to remove', () => {
    const { shellPaths, work } = makeShellPaths();
    registerWorkspace(shellPaths, work);
    const removed = unregisterWorkspace(shellPaths, work);
    expect(removed.removed).toBe(true);
    expect(isWorkspaceRegistered(shellPaths, work)).toBe(false);

    const removedAgain = unregisterWorkspace(shellPaths, work);
    expect(removedAgain.removed).toBe(false);
  });

  test('registering distinct roots keeps both, unregistering one leaves the other', () => {
    const { shellPaths, work, home } = makeShellPaths();
    registerWorkspace(shellPaths, work);
    registerWorkspace(shellPaths, home);
    expect(readWorkspaceRegistry(shellPaths).workspaces).toHaveLength(2);

    unregisterWorkspace(shellPaths, work);
    expect(isWorkspaceRegistered(shellPaths, work)).toBe(false);
    expect(isWorkspaceRegistered(shellPaths, home)).toBe(true);
  });

  test('a malformed registry file on disk reads as empty rather than throwing', () => {
    const { shellPaths } = makeShellPaths();
    const path = workspaceRegistryPath(shellPaths);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'not json', 'utf-8');
    expect(readWorkspaceRegistry(shellPaths).workspaces).toEqual([]);
  });
});
