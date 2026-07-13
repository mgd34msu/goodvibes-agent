/**
 * `update.*` — launch-time self-update behavior.
 *
 * The SDK owns settings.json's typed schema, but its loader deep-merges user
 * JSON over the defaults and keeps unknown top-level namespaces through
 * `getRaw()` (the same passthrough contract checkpoint-settings.ts documents),
 * so the agent keeps its own `update` namespace in the same file and reads it
 * back here.
 *
 * The reader hand-validates each field and returns a PARTIAL object holding
 * only the keys the user actually set to a well-typed value — a missing or
 * malformed block degrades to "use the built-in defaults", never a crash. The
 * defaults themselves live in the consumer (src/cli/launch-auto-update.ts):
 * the feature defaults ON for binary installs, per the recorded owner
 * directive that clients update on start, and `update.autoUpdateAtLaunch:
 * false` is the explicit, persisted off switch.
 */
import type { ConfigManager } from './index.ts';

type RawRecord = Record<string, unknown>;

export interface UpdateSettings {
  /** Check for a newer release at launch and install it before starting. Default: true. */
  readonly autoUpdateAtLaunch?: boolean;
  /** How long the launch-time version check may take before it is skipped. Defaults to 2500; clamped to [250, 30000]. */
  readonly launchCheckTimeoutMs?: number;
}

const LAUNCH_CHECK_MIN_TIMEOUT_MS = 250;
const LAUNCH_CHECK_MAX_TIMEOUT_MS = 30_000;

/** Read `update.*` from settings.json, validating and clamping the timeout. */
export function readUpdateSettings(configManager: Pick<ConfigManager, 'getRaw'>): UpdateSettings {
  const raw = configManager.getRaw() as unknown as RawRecord;
  const block = raw['update'];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return {};
  const src = block as RawRecord;
  const out: { autoUpdateAtLaunch?: boolean; launchCheckTimeoutMs?: number } = {};
  if (typeof src['autoUpdateAtLaunch'] === 'boolean') out.autoUpdateAtLaunch = src['autoUpdateAtLaunch'];
  const timeout = src['launchCheckTimeoutMs'];
  if (typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0) {
    out.launchCheckTimeoutMs = Math.min(LAUNCH_CHECK_MAX_TIMEOUT_MS, Math.max(LAUNCH_CHECK_MIN_TIMEOUT_MS, Math.floor(timeout)));
  }
  return out;
}
