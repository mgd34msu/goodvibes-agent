import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentRuntimeProfileResolution {
  readonly id: string;
  readonly homeDirectory: string;
}

export interface AgentRuntimeProfileInfo extends AgentRuntimeProfileResolution {
  readonly createdAt: string | null;
}

export interface AgentRuntimeProfileCommandResult {
  readonly ok: boolean;
  readonly kind:
    | 'agent.profiles.list'
    | 'agent.profiles.show'
    | 'agent.profiles.create'
    | 'agent.profiles.delete'
    | 'agent.profiles.error';
  readonly data?: {
    readonly profiles?: readonly AgentRuntimeProfileInfo[];
    readonly profile?: AgentRuntimeProfileInfo;
    readonly nextCommand?: string;
  };
  readonly error?: string;
}

const PROFILE_CREATED_FILE = 'profile.json';
const PROFILE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export function normalizeAgentRuntimeProfileId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .replace(/[-_]{2,}/g, '-');
}

export function assertValidAgentRuntimeProfileId(value: string): string {
  const raw = value.trim();
  if (raw.includes('..') || raw.includes('/') || raw.includes('\\')) {
    throw new Error('Agent profile names cannot contain path traversal sequences.');
  }
  const normalized = normalizeAgentRuntimeProfileId(value);
  if (!PROFILE_ID_PATTERN.test(normalized)) {
    throw new Error('Agent profile names must normalize to 1-64 lowercase letters, numbers, dots, underscores, or dashes.');
  }
  return normalized;
}

export function getAgentRuntimeProfilesRoot(baseHomeDirectory: string): string {
  return join(baseHomeDirectory, '.goodvibes', 'agent', 'profile-homes');
}

export function resolveAgentRuntimeProfileHome(baseHomeDirectory: string, profileName: string): AgentRuntimeProfileResolution {
  const id = assertValidAgentRuntimeProfileId(profileName);
  return {
    id,
    homeDirectory: join(getAgentRuntimeProfilesRoot(baseHomeDirectory), id),
  };
}

function readProfileCreatedAt(homeDirectory: string): string | null {
  const path = join(homeDirectory, PROFILE_CREATED_FILE);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    if (raw && typeof raw === 'object' && typeof raw.createdAt === 'string') return raw.createdAt;
  } catch {
    return null;
  }
  return null;
}

function buildProfileInfo(baseHomeDirectory: string, id: string): AgentRuntimeProfileInfo {
  const { homeDirectory } = resolveAgentRuntimeProfileHome(baseHomeDirectory, id);
  return {
    id,
    homeDirectory,
    createdAt: readProfileCreatedAt(homeDirectory),
  };
}

export function listAgentRuntimeProfiles(baseHomeDirectory: string): readonly AgentRuntimeProfileInfo[] {
  const root = getAgentRuntimeProfilesRoot(baseHomeDirectory);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((entry) => PROFILE_ID_PATTERN.test(entry) && !entry.includes('..'))
    .filter((entry) => {
      try {
        return statSync(join(root, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => buildProfileInfo(baseHomeDirectory, entry));
}

export function createAgentRuntimeProfile(baseHomeDirectory: string, profileName: string): AgentRuntimeProfileInfo {
  const resolution = resolveAgentRuntimeProfileHome(baseHomeDirectory, profileName);
  mkdirSync(resolution.homeDirectory, { recursive: true });
  const createdAt = new Date().toISOString();
  writeFileSync(
    join(resolution.homeDirectory, PROFILE_CREATED_FILE),
    `${JSON.stringify({ id: resolution.id, createdAt }, null, 2)}\n`,
    'utf-8',
  );
  return { ...resolution, createdAt };
}

export function deleteAgentRuntimeProfile(baseHomeDirectory: string, profileName: string): boolean {
  const resolution = resolveAgentRuntimeProfileHome(baseHomeDirectory, profileName);
  if (!existsSync(resolution.homeDirectory)) return false;
  rmSync(resolution.homeDirectory, { recursive: true, force: true });
  return true;
}
