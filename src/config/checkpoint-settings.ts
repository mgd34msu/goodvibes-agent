import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';

/**
 * Agent-local checkpoint guard settings (`checkpoints.*` namespace).
 *
 * The SDK's WorkspaceCheckpointManager exposes root/retention guard options that
 * decide which directory it is safe to snapshot and how the first sweep and
 * retention behave:
 *
 *   - `checkpoints.preferGitRoot` (boolean, SDK default true) — prefer the
 *     enclosing git repository's top level over the raw working directory.
 *   - `checkpoints.allowBroadRoot` (boolean, SDK default false) — opt in to
 *     snapshotting a broad root (filesystem root, home directory, ~/.goodvibes).
 *   - `checkpoints.allowLargeFirstSnapshot` (boolean, SDK default false) — opt
 *     in to a first snapshot whose full sweep exceeds `maxFirstSnapshotFiles`.
 *   - `checkpoints.maxFirstSnapshotFiles` (number, SDK default) — ceiling for
 *     the first-ever snapshot's file sweep.
 *   - `checkpoints.autoRetention` (boolean, SDK default true) — run a retention
 *     sweep automatically after each successful create and once at init.
 *
 * The shared SDK config schema (GoodVibesConfig) has no `checkpoints` category,
 * so these are read directly from a user-supplied `checkpoints` block in
 * settings.json. The SDK ConfigManager deep-merges loaded settings onto the
 * default config and preserves unknown top-level blocks, so a hand-added
 * `checkpoints` object survives to `getRaw()`. Only these five passthrough keys
 * are read here; each absent key falls back to the SDK manager's own default.
 *
 * settings.json example:
 *
 *   "checkpoints": {
 *     "preferGitRoot": true,
 *     "allowBroadRoot": false,
 *     "allowLargeFirstSnapshot": false,
 *     "maxFirstSnapshotFiles": 20000,
 *     "autoRetention": true
 *   }
 */
export interface CheckpointGuardSettings {
  readonly preferGitRoot?: boolean;
  readonly allowBroadRoot?: boolean;
  readonly allowLargeFirstSnapshot?: boolean;
  readonly maxFirstSnapshotFiles?: number;
  readonly autoRetention?: boolean;
}

/**
 * Read the `checkpoints.*` guard passthrough keys from the loaded config. Only
 * keys present with the right primitive type are returned; everything else is
 * omitted so the SDK manager applies its own default. `maxFirstSnapshotFiles`
 * must be a finite positive number to be accepted.
 */
export function readCheckpointGuardSettings(
  configManager: Pick<ConfigManager, 'getRaw'>,
): CheckpointGuardSettings {
  const raw = configManager.getRaw() as unknown as Record<string, unknown>;
  const block = raw.checkpoints;
  if (block === null || typeof block !== 'object' || Array.isArray(block)) return {};
  const cp = block as Record<string, unknown>;

  const out: {
    preferGitRoot?: boolean;
    allowBroadRoot?: boolean;
    allowLargeFirstSnapshot?: boolean;
    maxFirstSnapshotFiles?: number;
    autoRetention?: boolean;
  } = {};

  if (typeof cp.preferGitRoot === 'boolean') out.preferGitRoot = cp.preferGitRoot;
  if (typeof cp.allowBroadRoot === 'boolean') out.allowBroadRoot = cp.allowBroadRoot;
  if (typeof cp.allowLargeFirstSnapshot === 'boolean') out.allowLargeFirstSnapshot = cp.allowLargeFirstSnapshot;
  if (
    typeof cp.maxFirstSnapshotFiles === 'number'
    && Number.isFinite(cp.maxFirstSnapshotFiles)
    && cp.maxFirstSnapshotFiles > 0
  ) {
    out.maxFirstSnapshotFiles = cp.maxFirstSnapshotFiles;
  }
  if (typeof cp.autoRetention === 'boolean') out.autoRetention = cp.autoRetention;

  return out;
}
