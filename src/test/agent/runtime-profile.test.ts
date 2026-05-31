import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertValidAgentRuntimeProfileId,
  createAgentRuntimeProfile,
  deleteAgentRuntimeProfile,
  getAgentRuntimeProfilesRoot,
  listAgentRuntimeProfiles,
  normalizeAgentRuntimeProfileId,
  resolveAgentRuntimeProfileHome,
} from '../../agent/runtime-profile.ts';

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'goodvibes-agent-profile-home-'));
}

describe('Agent runtime profiles', () => {
  test('normalizes profile names into stable launch ids', () => {
    expect(normalizeAgentRuntimeProfileId('Household Ops')).toBe('household-ops');
    expect(normalizeAgentRuntimeProfileId('  ops.prod  ')).toBe('ops.prod');
  });

  test('rejects path traversal and empty profile names', () => {
    expect(() => assertValidAgentRuntimeProfileId('../default')).toThrow('path traversal');
    expect(() => assertValidAgentRuntimeProfileId('!!!')).toThrow('Agent profile names');
  });

  test('resolves isolated profile home below the Agent profile root', () => {
    const home = makeHome();
    const resolved = resolveAgentRuntimeProfileHome(home, 'Household Ops');
    expect(resolved.id).toBe('household-ops');
    expect(resolved.homeDirectory).toBe(join(getAgentRuntimeProfilesRoot(home), 'household-ops'));
  });

  test('creates, lists, and deletes isolated profile homes', () => {
    const home = makeHome();
    const created = createAgentRuntimeProfile(home, 'Household');
    expect(created.id).toBe('household');
    expect(existsSync(created.homeDirectory)).toBe(true);

    const profiles = listAgentRuntimeProfiles(home);
    expect(profiles.map((profile) => profile.id)).toEqual(['household']);
    expect(typeof profiles[0]?.createdAt).toBe('string');

    expect(deleteAgentRuntimeProfile(home, 'household')).toBe(true);
    expect(deleteAgentRuntimeProfile(home, 'household')).toBe(false);
    expect(listAgentRuntimeProfiles(home)).toEqual([]);
  });
});
