import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import type { ShellPathService } from '@/runtime/index.ts';
import { logger, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import {
  WorkspaceRegistrationStore,
  type RegisterWorkspaceResult,
  resolveWorkspaceRegistration,
  normalizeWorkspaceRoot,
  probeWorktreeLink,
  type RegisteredWorkspaceRecord,
  type DeclinedWorkspaceRecord,
  type WorkspaceCoverageStatus,
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
 * CHECKPOINT-ELIGIBILITY BOUNDARY (owner ruling: the checkpoint boundary stays
 * EXPLICIT, never silently widened).
 *
 * The shared registration store is ONE file the whole platform reads and writes
 * (~/.goodvibes/control-plane/workspace-registrations.json). The TUI's first-open
 * self-recording writes a plain {@link RegisteredWorkspaceRecord} to it for any
 * directory a user merely opens — so "registered in the store" can no longer mean
 * "the owner opted this workspace into automatic checkpoints". The agent's
 * checkpoint boundary must therefore consume ONLY records the owner EXPLICITLY
 * registered for checkpoints, marked by `checkpointEligible === true`.
 *
 * The SDK is adding `origin` and `checkpointEligible` to its record schema this
 * round; until then the agent carries them as agent-local extra fields on the
 * SAME record objects (this is safe: the SDK store's read/validate passes each
 * record object through unchanged and its writes spread existing records
 * verbatim, so extra fields survive every SDK add/remove/decline; only a
 * newly-added record — a TUI self-record, or an agent add before it is stamped —
 * lacks the flag, which is exactly the intended "absent = not eligible").
 */
export const AGENT_EXPLICIT_REGISTRATION_ORIGIN = 'agent-explicit-registration';

/**
 * A registration record plus the agent-local checkpoint-eligibility fields.
 * `checkpointEligible` absent (or not strictly `true`) means NOT eligible.
 * `origin` records which flow wrote/stamped the record (provenance only).
 */
export interface AgentRegisteredWorkspaceRecord extends RegisteredWorkspaceRecord {
  readonly origin?: string;
  readonly checkpointEligible?: boolean;
}

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

function parseRegisteredRecord(value: unknown): AgentRegisteredWorkspaceRecord | null {
  if (!isRecord(value)) return null;
  const root = readString(value.root);
  const registeredAt = readString(value.registeredAt);
  if (!root || !registeredAt || Number.isNaN(Date.parse(registeredAt))) return null;
  const label = readString(value.label);
  const origin = readString(value.origin);
  return {
    root: normalizeWorkspaceRoot(root),
    registeredAt,
    ...(label ? { label } : {}),
    ...(origin ? { origin } : {}),
    // Strictly `true` only; any other value (including absent) is not eligible.
    ...(value.checkpointEligible === true ? { checkpointEligible: true } : {}),
  };
}

function parseDeclinedRecord(value: unknown): DeclinedWorkspaceRecord | null {
  if (!isRecord(value)) return null;
  const root = readString(value.root);
  const declinedAt = readString(value.declinedAt);
  if (!root || !declinedAt || Number.isNaN(Date.parse(declinedAt))) return null;
  return { root: normalizeWorkspaceRoot(root), declinedAt };
}

interface SharedRegistrationSnapshot {
  readonly workspaces: readonly AgentRegisteredWorkspaceRecord[];
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
      .filter((entry): entry is AgentRegisteredWorkspaceRecord => entry !== null);
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

/**
 * Resolve `path` against ONLY the checkpoint-eligible registrations — the
 * boundary the automatic/explicit checkpoint gate consumes. Identical to
 * {@link resolveWorkspaceRegistrationSync} except the registrations are filtered
 * to `checkpointEligible === true` first, so a plain TUI self-record (registered
 * in the shared store, but never explicitly opted into checkpoints) resolves as
 * NOT covered here even though the general resolver reports it registered.
 * Worktree-link inheritance still applies: a linked worktree of a checkpoint-
 * eligible main repo resolves covered.
 */
export function resolveCheckpointEligibilitySync(
  shellPaths: StoreShellPaths,
  path: string,
  git?: WorkspaceGitMetadata,
): WorkspaceResolution {
  const snapshot = readSharedWorkspaceRegistrationSnapshotSync(shellPaths);
  const eligible = snapshot.workspaces.filter((entry) => entry.checkpointEligible === true);
  const gitMeta = git ?? probeWorktreeLink(path);
  return resolveWorkspaceRegistration({
    path,
    git: gitMeta,
    registrations: eligible,
    declines: snapshot.declines,
  });
}

/**
 * Build a cheap, repeatable live checkpoint-eligibility checker for one fixed
 * workspace root. `probeWorktreeLink` (a `git` subprocess spawn) runs ONCE here,
 * since a long-running process's working directory and its git-worktree
 * relationship do not change mid-launch; every subsequent call only re-reads the
 * shared registration JSON file (a small synchronous fs read) — cheap enough to
 * call on every turn/agent-lifecycle event, unlike calling
 * `resolveCheckpointEligibilitySync` directly (which re-probes git every time).
 *
 * This is what makes registering a workspace mid-launch (an explicit
 * `goodvibes-agent workspaces register` that stamps `checkpointEligible`) take
 * effect on the very next automatic-checkpoint-eligible event in an
 * already-running process, without a restart: a caller that re-runs the returned
 * function on each event always reads current on-disk state. It consumes ONLY
 * checkpoint-eligible records, so a directory a TUI user merely opened never
 * silently becomes checkpoint-eligible to the agent.
 */
export function createWorkspaceRegistrationLiveChecker(
  shellPaths: StoreShellPaths,
  path: string,
): () => WorkspaceCoverageStatus {
  const git = probeWorktreeLink(path);
  return () => resolveCheckpointEligibilitySync(shellPaths, path, git).status;
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

interface RawSharedStoreDoc {
  readonly version: 1;
  readonly workspaces: unknown[];
  readonly declines: unknown[];
}

/**
 * Raw read of the shared store document that preserves EVERY field on EVERY
 * record verbatim — unlike {@link readSharedWorkspaceRegistrationSnapshotSync},
 * which strips each record to the known shape. Used by the eligibility-stamping
 * writers below so they never drop the SDK's own fields (or a future one) when
 * they rewrite the file. A missing/unparsable file reads as an empty document.
 */
function readSharedStoreRawDoc(path: string): RawSharedStoreDoc {
  if (!existsSync(path)) return { version: 1, workspaces: [], declines: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.workspaces)) {
      return { version: 1, workspaces: [], declines: [] };
    }
    return {
      version: 1,
      workspaces: parsed.workspaces,
      declines: Array.isArray(parsed.declines) ? parsed.declines : [],
    };
  } catch {
    return { version: 1, workspaces: [], declines: [] };
  }
}

/**
 * Stamp the shared-store record for `root` as checkpoint-eligible, with an
 * `origin` recording the flow that opted it in. A no-op when the record already
 * carries the same flag+origin, or when no record for `root` exists yet (callers
 * persist the record first, then stamp). Preserves every other record and field.
 */
function stampCheckpointEligibility(shellPaths: StoreShellPaths, root: string, origin: string): void {
  const path = sharedWorkspaceRegistrationStorePath(shellPaths);
  const target = normalizeWorkspaceRoot(root);
  const doc = readSharedStoreRawDoc(path);
  let changed = false;
  const workspaces = doc.workspaces.map((entry) => {
    if (!isRecord(entry)) return entry;
    if (normalizeWorkspaceRoot(readString(entry.root)) !== target) return entry;
    if (entry.checkpointEligible === true && entry.origin === origin) return entry;
    changed = true;
    return { ...entry, checkpointEligible: true, origin };
  });
  if (!changed) return;
  atomicWriteJson(path, { version: 1, workspaces, declines: doc.declines });
}

/**
 * The agent's EXPLICIT checkpoint-registration path: register `root` in the
 * shared store (the SDK's own root-guarded `add`), then stamp it
 * `checkpointEligible: true` with the agent-explicit origin. This is the ONLY
 * way a record becomes checkpoint-eligible at write time — a plain SDK `add`
 * (the TUI's first-open self-recording) never sets the flag, so opening a
 * directory in the TUI cannot widen the agent's checkpoint boundary. Returns the
 * SDK's register result unchanged so callers keep their existing messaging.
 */
export async function registerWorkspaceForCheckpoints(
  shellPaths: StoreShellPaths,
  root: string,
  opts?: { readonly label?: string },
): Promise<RegisterWorkspaceResult> {
  const store = createWorkspaceRegistrationStore(shellPaths);
  const result = await store.add(root, opts?.label ? { label: opts.label } : undefined);
  stampCheckpointEligibility(shellPaths, result.record.root, AGENT_EXPLICIT_REGISTRATION_ORIGIN);
  return result;
}

function checkpointEligibilityBackfillReceiptPath(shellPaths: StoreShellPaths): string {
  return shellPaths.resolveUserPath('control-plane', 'workspace-checkpoint-eligibility-backfill-receipt.json');
}

export interface CheckpointEligibilityBackfillResult {
  readonly sourcePath: string;
  readonly recordsStamped: number;
  readonly backfilledAt: string;
}

/**
 * One-time boot backfill that stamps `checkpointEligible: true` on the shared-
 * store records that came from the agent's OWN explicit registrations, so the
 * new eligibility boundary does not retroactively drop workspaces the owner had
 * already opted into checkpoints before this flag existed.
 *
 * The honest source of "which records were the agent's explicit list" is the
 * legacy per-user registry file (`<surface>/checkpoints/registered-workspaces.json`)
 * — written only by `workspaces register`, and never deleted by the migration
 * that imported it into the shared store. Every root in it is an explicit owner
 * opt-in, so the matching shared-store record is stamped eligible. This covers
 * both a fresh import (records just migrated in without the flag) and a machine
 * where the import already ran (the earlier commit that migrated the explicit
 * list into the shared store predates this flag).
 *
 * Receipt-gated so it runs once. A missing legacy file writes no receipt
 * (there is no explicit-list source to derive from, and nothing worth
 * remembering); records registered afresh through
 * {@link registerWorkspaceForCheckpoints} are already stamped at write time.
 * Returns null when nothing was backfilled this call.
 */
export function backfillCheckpointEligibilityIfNeeded(
  shellPaths: StoreShellPaths,
): CheckpointEligibilityBackfillResult | null {
  const receiptPath = checkpointEligibilityBackfillReceiptPath(shellPaths);
  if (existsSync(receiptPath)) return null;

  const legacyPath = legacyWorkspaceRegistryPath(shellPaths);
  if (!existsSync(legacyPath)) return null;

  const legacyRoots = new Set<string>();
  try {
    const parsed = JSON.parse(readFileSync(legacyPath, 'utf-8')) as unknown;
    const list = isRecord(parsed) && Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
    for (const entry of list) {
      if (!isRecord(entry)) continue;
      const root = readString(entry.root);
      if (root) legacyRoots.add(normalizeWorkspaceRoot(root));
    }
  } catch {
    // An unparsable legacy file yields no roots but still writes a receipt below
    // so this is never retried.
  }

  const sharedPath = sharedWorkspaceRegistrationStorePath(shellPaths);
  const doc = readSharedStoreRawDoc(sharedPath);
  let stamped = 0;
  const workspaces = doc.workspaces.map((entry) => {
    if (!isRecord(entry)) return entry;
    const root = normalizeWorkspaceRoot(readString(entry.root));
    if (!legacyRoots.has(root) || entry.checkpointEligible === true) return entry;
    stamped += 1;
    const existingOrigin = readString(entry.origin);
    return { ...entry, checkpointEligible: true, origin: existingOrigin || AGENT_EXPLICIT_REGISTRATION_ORIGIN };
  });
  if (stamped > 0) atomicWriteJson(sharedPath, { version: 1, workspaces, declines: doc.declines });

  const result: CheckpointEligibilityBackfillResult = {
    sourcePath: legacyPath,
    recordsStamped: stamped,
    backfilledAt: new Date().toISOString(),
  };
  atomicWriteJson(receiptPath, result);
  return result;
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
  // Accepting the first-start prompt is an EXPLICIT owner opt-in, so it goes
  // through registerWorkspaceForCheckpoints (registers AND stamps eligibility) —
  // not a plain store.add, which would register without making the workspace
  // checkpoint-eligible. Declining stays a plain decline.
  const outcome = accepted
    ? registerWorkspaceForCheckpoints(shellPaths, root)
    : createWorkspaceRegistrationStore(shellPaths).decline(root);
  void outcome.catch((error: unknown) => {
    logger.error('Failed to persist workspace registration prompt answer', { root, accepted, error: summarizeError(error) });
  });
}
