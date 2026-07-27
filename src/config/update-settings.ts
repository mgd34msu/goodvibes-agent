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
  /**
   * Keep checking for a newer release WHILE the agent runs, and install it at
   * an idle moment. Mirrors the daemon's `update.auto`. Default: true — a
   * long-running agent that only updated at launch went stale across every
   * release the person never restarted for.
   */
  readonly auto?: boolean;
  /** Minutes between periodic checks. Mirrors the daemon's `update.intervalMinutes`. Defaults to 60; clamped to [5, 1440]. */
  readonly intervalMinutes?: number;
  /** Seconds after start before the FIRST periodic check. Mirrors the daemon's `update.firstCheckSeconds`. Defaults to 30; clamped to [0, 3600]. */
  readonly firstCheckSeconds?: number;
}

const LAUNCH_CHECK_MIN_TIMEOUT_MS = 250;
const LAUNCH_CHECK_MAX_TIMEOUT_MS = 30_000;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 24 * 60;
const MAX_FIRST_CHECK_SECONDS = 60 * 60;

/** A number field is honored only when finite and non-negative; then clamped. */
function readClamped(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Read `update.*` from settings.json, validating and clamping the timeout. */
export function readUpdateSettings(configManager: Pick<ConfigManager, 'getRaw'>): UpdateSettings {
  const raw = configManager.getRaw() as unknown as RawRecord;
  const block = raw['update'];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return {};
  const src = block as RawRecord;
  const out: {
    autoUpdateAtLaunch?: boolean;
    launchCheckTimeoutMs?: number;
    auto?: boolean;
    intervalMinutes?: number;
    firstCheckSeconds?: number;
  } = {};
  if (typeof src['autoUpdateAtLaunch'] === 'boolean') out.autoUpdateAtLaunch = src['autoUpdateAtLaunch'];
  const timeout = src['launchCheckTimeoutMs'];
  if (typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0) {
    out.launchCheckTimeoutMs = Math.min(LAUNCH_CHECK_MAX_TIMEOUT_MS, Math.max(LAUNCH_CHECK_MIN_TIMEOUT_MS, Math.floor(timeout)));
  }
  if (typeof src['auto'] === 'boolean') out.auto = src['auto'];
  const interval = readClamped(src['intervalMinutes'], MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
  if (interval !== undefined) out.intervalMinutes = interval;
  const firstCheck = readClamped(src['firstCheckSeconds'], 0, MAX_FIRST_CHECK_SECONDS);
  if (firstCheck !== undefined) out.firstCheckSeconds = firstCheck;
  return out;
}
