import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import type { ShellPathService } from '@/runtime/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from './surface.ts';

/**
 * Registered-workspace registry (`checkpoints.*` enforcement surface).
 *
 * Owner ruling (2026-07-10): the agent's AUTOMATIC workspace checkpoints
 * (turn-end / lifecycle snapshots taken by the SDK's WorkspaceCheckpointManager,
 * see ../runtime/services.ts) are restricted to workspace roots the owner has
 * explicitly registered here. This is a simple, agent-local, user-scoped
 * registry — not a project registry and not a connected-host concept — kept
 * deliberately small: a JSON file listing the roots the owner has opted in,
 * with add/remove/list. No existing workspace/project registry was found
 * elsewhere in this codebase to reuse (see the registered-workspace-checkpoints
 * change notes); this is the first one.
 *
 * Stored user-scoped (via `shellPaths.resolveUserPath`, not project-scoped)
 * because the registry must answer "is THIS root registered" regardless of
 * which workspace root the agent happens to be running against right now —
 * the same shape as the setup-wizard checkpoint file (../agent/setup-wizard-checkpoint.ts).
 *
 * Roots are normalized with `path.resolve` and a trailing-separator strip, not
 * `fs.realpathSync` — registration should not require the directory to exist
 * yet, and exact-string matching after normalization is enough for the single
 * purpose this registry serves (a yes/no gate on automatic checkpoints).
 */

export interface RegisteredWorkspaceRecord {
  readonly root: string;
  readonly registeredAt: string;
  readonly label?: string;
}

export interface WorkspaceRegistrySnapshot {
  readonly path: string;
  readonly workspaces: readonly RegisteredWorkspaceRecord[];
}

export interface RegisterWorkspaceResult {
  readonly snapshot: WorkspaceRegistrySnapshot;
  readonly record: RegisteredWorkspaceRecord;
  readonly alreadyRegistered: boolean;
}

export interface UnregisterWorkspaceResult {
  readonly snapshot: WorkspaceRegistrySnapshot;
  readonly removed: boolean;
}

type WorkspaceRegistryShellPaths = Pick<ShellPathService, 'resolveUserPath'>;

const REGISTRY_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Exact-string normalization: absolute path, no trailing separator (except a bare filesystem root). */
export function normalizeWorkspaceRoot(root: string): string {
  const resolved = resolve(root);
  if (resolved.length > 1 && resolved.endsWith(sep)) return resolved.slice(0, -1);
  return resolved;
}

function parseRecord(value: unknown): RegisteredWorkspaceRecord | null {
  if (!isRecord(value)) return null;
  const root = readString(value.root);
  const registeredAt = readString(value.registeredAt);
  if (!root || !registeredAt || Number.isNaN(Date.parse(registeredAt))) return null;
  const label = readString(value.label);
  return {
    root: normalizeWorkspaceRoot(root),
    registeredAt,
    ...(label ? { label } : {}),
  };
}

export function workspaceRegistryPath(shellPaths: WorkspaceRegistryShellPaths): string {
  return shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'checkpoints', 'registered-workspaces.json');
}

/** Reads the registry. A missing or unparsable file reads as empty — never thrown. */
export function readWorkspaceRegistry(shellPaths: WorkspaceRegistryShellPaths): WorkspaceRegistrySnapshot {
  const path = workspaceRegistryPath(shellPaths);
  if (!existsSync(path)) return { path, workspaces: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    const list = isRecord(parsed) && Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
    const workspaces = list
      .map((entry) => parseRecord(entry))
      .filter((entry): entry is RegisteredWorkspaceRecord => entry !== null);
    return { path, workspaces };
  } catch {
    return { path, workspaces: [] };
  }
}

function writeWorkspaceRegistry(path: string, workspaces: readonly RegisteredWorkspaceRecord[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const payload = `${JSON.stringify({ version: REGISTRY_VERSION, workspaces }, null, 2)}\n`;
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, payload, 'utf-8');
  renameSync(tempPath, path);
}

/** Is `root` (any string form — normalized here) an explicitly registered workspace? */
export function isWorkspaceRegistered(shellPaths: WorkspaceRegistryShellPaths, root: string): boolean {
  const target = normalizeWorkspaceRoot(root);
  return readWorkspaceRegistry(shellPaths).workspaces.some((entry) => entry.root === target);
}

export function registerWorkspace(
  shellPaths: WorkspaceRegistryShellPaths,
  root: string,
  opts?: { readonly label?: string },
): RegisterWorkspaceResult {
  const target = normalizeWorkspaceRoot(root);
  const existing = readWorkspaceRegistry(shellPaths);
  const already = existing.workspaces.find((entry) => entry.root === target);
  if (already) {
    return { snapshot: existing, record: already, alreadyRegistered: true };
  }
  const record: RegisteredWorkspaceRecord = {
    root: target,
    registeredAt: new Date().toISOString(),
    ...(opts?.label?.trim() ? { label: opts.label.trim() } : {}),
  };
  const workspaces = [...existing.workspaces, record];
  writeWorkspaceRegistry(existing.path, workspaces);
  return { snapshot: { path: existing.path, workspaces }, record, alreadyRegistered: false };
}

export function unregisterWorkspace(shellPaths: WorkspaceRegistryShellPaths, root: string): UnregisterWorkspaceResult {
  const target = normalizeWorkspaceRoot(root);
  const existing = readWorkspaceRegistry(shellPaths);
  const workspaces = existing.workspaces.filter((entry) => entry.root !== target);
  const removed = workspaces.length !== existing.workspaces.length;
  if (removed) writeWorkspaceRegistry(existing.path, workspaces);
  return { snapshot: { path: existing.path, workspaces }, removed };
}
