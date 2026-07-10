import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import type { ShellPathService } from '@/runtime/index.ts';
import { logger, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import {
  WorkspaceRegistrationStore,
  resolveWorkspaceRegistration,
  normalizeWorkspaceRoot,
  probeWorktreeLink,
  type RegisteredWorkspaceRecord,
  type DeclinedWorkspaceRecord,
  type WorkspaceGitMetadata,
  type WorkspaceResolution,
} from '@pellux/goodvibes-sdk/platform/workspace';
import { GOODVIBES_AGENT_SURFACE_ROOT } from './surface.ts';

export { normalizeWorkspaceRoot } from '@pellux/goodvibes-sdk/platform/workspace';
export type {
  DeclinedWorkspaceRecord,
  RegisteredWorkspaceRecord,
  WorkspaceCoverageStatus,
  WorkspaceResolution,
} from '@pellux/goodvibes-sdk/platform/workspace';

/**
 * Shared registered-workspace registry (SDK 1.6.1 platform/workspace/registration),
 * the successor to this fork's local per-user JSON registry
 * (superseded ../config/workspace-registry.ts, deleted).
 *
 * MIGRATION. The local registry's record shape (`{ root, registeredAt, label? }`)
 * is field-identical to the shared store's `RegisteredWorkspaceRecord`, so a local
 * file migrates in as a straight import — see migrateLegacyWorkspaceRegistryIfNeeded.
 *
 * WHY A SYNCHRONOUS RESOLVER EXISTS ALONGSIDE THE ASYNC STORE. The SDK's
 * WorkspaceRegistrationStore is Promise-based (it persists through
 * PersistentStore). createRuntimeServices() (../runtime/services.ts) is
 * synchronous by design — every consumer (the CLI, the TUI bootstrap, every
 * test file) calls it synchronously — and the automatic-checkpoint decision
 * (whether to pass runtimeBus to WorkspaceCheckpointManager) must be made AT
 * construction time, not after an async read resolves later. So this module
 * also ships a synchronous snapshot read + the SDK's PURE resolver
 * (resolveWorkspaceRegistration, no disk/git I/O) for that one call site;
 * every other consumer (the workspaces CLI, a future interactive prompt) goes
 * through the real async store below, the single source of truth for writes.
 * Both read the exact same on-disk file, so there is only ever one registry.
 */

export type StoreShellPaths = Pick<ShellPathService, 'resolveUserPath' | 'homeDirectory'>;

/** Path of the shared store's JSON document — the SAME path the SDK's registerGatewayVerbGroups uses internally to construct its own store instance. */
export function sharedWorkspaceRegistrationStorePath(shellPaths: StoreShellPaths): string {
  return shellPaths.resolveUserPath('control-plane', 'workspace-registrations.json');
}

/** Construct a store instance over the shared file — for callers that can go async (CLI commands, interactive prompts). */
export function createWorkspaceRegistrationStore(shellPaths: StoreShellPaths): WorkspaceRegistrationStore {
  return new WorkspaceRegistrationStore({
    path: sharedWorkspaceRegistrationStorePath(shellPaths),
    homeDir: shellPaths.homeDirectory,
    daemonStateDir: shellPaths.resolveUserPath(),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseRegisteredRecord(value: unknown): RegisteredWorkspaceRecord | null {
  if (!isRecord(value)) return null;
  const root = readString(value.root);
  const registeredAt = readString(value.registeredAt);
  if (!root || !registeredAt || Number.isNaN(Date.parse(registeredAt))) return null;
  const label = readString(value.label);
  return { root: normalizeWorkspaceRoot(root), registeredAt, ...(label ? { label } : {}) };
}

function parseDeclinedRecord(value: unknown): DeclinedWorkspaceRecord | null {
  if (!isRecord(value)) return null;
  const root = readString(value.root);
  const declinedAt = readString(value.declinedAt);
  if (!root || !declinedAt || Number.isNaN(Date.parse(declinedAt))) return null;
  return { root: normalizeWorkspaceRoot(root), declinedAt };
}

interface SharedRegistrationSnapshot {
  readonly workspaces: readonly RegisteredWorkspaceRecord[];
  readonly declines: readonly DeclinedWorkspaceRecord[];
}

/**
 * Synchronous read of the shared store's on-disk JSON, mirroring the store's
 * own validate() logic exactly (version 1, workspaces[], declines[]). A
 * missing or unparsable file reads as empty — never throws.
 */
export function readSharedWorkspaceRegistrationSnapshotSync(shellPaths: StoreShellPaths): SharedRegistrationSnapshot {
  const path = sharedWorkspaceRegistrationStorePath(shellPaths);
  if (!existsSync(path)) return { workspaces: [], declines: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.workspaces)) {
      return { workspaces: [], declines: [] };
    }
    const workspaces = parsed.workspaces
      .map(parseRegisteredRecord)
      .filter((entry): entry is RegisteredWorkspaceRecord => entry !== null);
    const declineList = Array.isArray(parsed.declines) ? parsed.declines : [];
    const declines = declineList
      .map(parseDeclinedRecord)
      .filter((entry): entry is DeclinedWorkspaceRecord => entry !== null);
    return { workspaces, declines };
  } catch {
    return { workspaces: [], declines: [] };
  }
}

/**
 * Resolve `path` against the shared registration store SYNCHRONOUSLY: a direct
 * on-disk read plus the SDK's pure resolveWorkspaceRegistration. `git` defaults
 * to a real worktree-link probe (probeWorktreeLink spawns `git`), so a linked
 * orchestration worktree of a registered repo resolves as covered without any
 * extra wiring — the worktree-link inheritance the shared store provides.
 * Callers that already have git metadata (or want to avoid the spawn, e.g. in
 * a pure unit test) can pass it explicitly.
 */
export function resolveWorkspaceRegistrationSync(
  shellPaths: StoreShellPaths,
  path: string,
  git?: WorkspaceGitMetadata,
): WorkspaceResolution {
  const snapshot = readSharedWorkspaceRegistrationSnapshotSync(shellPaths);
  const gitMeta = git ?? probeWorktreeLink(path);
  return resolveWorkspaceRegistration({
    path,
    git: gitMeta,
    registrations: snapshot.workspaces,
    declines: snapshot.declines,
  });
}

// ---------------------------------------------------------------------------
// One-time migration: local per-user registry -> shared store
// ---------------------------------------------------------------------------

function legacyWorkspaceRegistryPath(shellPaths: StoreShellPaths): string {
  return shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'checkpoints', 'registered-workspaces.json');
}

function migrationReceiptPath(shellPaths: StoreShellPaths): string {
  return shellPaths.resolveUserPath('control-plane', 'workspace-registration-migration-receipt.json');
}

function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, path);
}

export interface WorkspaceRegistrationMigrationResult {
  readonly sourcePath: string;
  readonly recordsMigrated: number;
  readonly recordsAlreadyPresent: number;
  readonly migratedAt: string;
}

/**
 * Migrate the local per-user registry into the shared store, exactly once.
 *
 * Runs synchronously (see this module's doc comment on why). Idempotent via a
 * receipt file: once written, later calls (any process, any startup) return
 * null immediately without touching either file again — even if the legacy
 * file is still present, and even if an owner later unregisters a migrated
 * root through the new store (a migrated-then-removed root must not come back
 * on the next start). A missing legacy file is not an error and writes no
 * receipt (nothing happened worth remembering); an unparsable legacy file
 * migrates zero records but still writes a receipt so it is never retried.
 *
 * Returns null when nothing was migrated this call (already migrated, or no
 * legacy file); a caller logs only a real migration.
 */
export function migrateLegacyWorkspaceRegistryIfNeeded(
  shellPaths: StoreShellPaths,
): WorkspaceRegistrationMigrationResult | null {
  const receiptPath = migrationReceiptPath(shellPaths);
  if (existsSync(receiptPath)) return null;

  const legacyPath = legacyWorkspaceRegistryPath(shellPaths);
  if (!existsSync(legacyPath)) return null;

  let legacyRecords: RegisteredWorkspaceRecord[] = [];
  try {
    const parsed = JSON.parse(readFileSync(legacyPath, 'utf-8')) as unknown;
    const list = isRecord(parsed) && Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
    legacyRecords = list
      .map(parseRegisteredRecord)
      .filter((entry): entry is RegisteredWorkspaceRecord => entry !== null);
  } catch {
    legacyRecords = [];
  }

  const sharedPath = sharedWorkspaceRegistrationStorePath(shellPaths);
  const existing = readSharedWorkspaceRegistrationSnapshotSync(shellPaths);
  const existingRoots = new Set(existing.workspaces.map((entry) => entry.root));
  const merged = [...existing.workspaces];
  let migrated = 0;
  let alreadyPresent = 0;
  for (const record of legacyRecords) {
    if (existingRoots.has(record.root)) {
      alreadyPresent += 1;
      continue;
    }
    existingRoots.add(record.root);
    merged.push(record);
    migrated += 1;
  }

  if (migrated > 0) {
    atomicWriteJson(sharedPath, { version: 1, workspaces: merged, declines: existing.declines });
  }

  const result: WorkspaceRegistrationMigrationResult = {
    sourcePath: legacyPath,
    recordsMigrated: migrated,
    recordsAlreadyPresent: alreadyPresent,
    migratedAt: new Date().toISOString(),
  };
  atomicWriteJson(receiptPath, result);
  return result;
}

// ---------------------------------------------------------------------------
// First-start registration prompt support
// ---------------------------------------------------------------------------

function canonicalPath(path: string): string {
  try {
    return existsSync(path) ? realpathSync(path) : resolve(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Would the shared store refuse to register `root` as too broad? Mirrors the
 * SDK's broadRootReason (checkpoint/root-guard.ts — not part of the public
 * platform/workspace export, so replicated here at the same single-purpose
 * level as this module's other store-internal-logic mirrors) closely enough
 * for a PRE-registration "would this be refused?" check. Used only to decide
 * whether to OFFER registration in the first-start prompt; the store's own
 * add() remains the authoritative guard at write time, never bypassed here.
 */
export function isBroadWorkspaceRoot(shellPaths: StoreShellPaths, root: string): boolean {
  const canonicalRoot = canonicalPath(root);
  if (parse(canonicalRoot).root === canonicalRoot) return true;
  if (canonicalRoot === canonicalPath(shellPaths.homeDirectory)) return true;
  if (canonicalRoot === canonicalPath(shellPaths.resolveUserPath())) return true;
  return false;
}

/**
 * Resolve a first-start registration prompt's answer against the shared
 * store: fire-and-forget (the caller is a keypress handler, not an async
 * context) but never a silent failure — a write error is logged, not lost.
 */
export function answerWorkspaceRegistrationPrompt(shellPaths: StoreShellPaths, root: string, accepted: boolean): void {
  const store = createWorkspaceRegistrationStore(shellPaths);
  const outcome = accepted ? store.add(root) : store.decline(root);
  void outcome.catch((error: unknown) => {
    logger.error('Failed to persist workspace registration prompt answer', { root, accepted, error: summarizeError(error) });
  });
}
