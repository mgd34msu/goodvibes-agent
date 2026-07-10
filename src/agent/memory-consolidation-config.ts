import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';

/**
 * Agent-local idle-time memory consolidation settings (`learning.consolidation.*`
 * namespace). Off by default — the consolidation job only runs when a user has
 * explicitly enabled it, mirroring the checkpoint-guard passthrough idiom
 * (checkpoint-settings.ts): the shared SDK config schema has no
 * `learning.consolidation` category, so these are read directly from a
 * user-supplied `learning` block that the ConfigManager deep-merge preserves to
 * `getRaw()`.
 *
 * The job reviews already-stored memory records when the agent is genuinely idle
 * (no active turn) and no sooner than `intervalMs` since its last run. It only
 * performs reversible housekeeping (merge duplicates into a survivor, mark the
 * losers stale, decay never-referenced records) and records everything requiring
 * a NEW standing memory or a destructive delete as a PROPOSAL routed to the
 * existing confirmation-gated path — it never silently writes a new memory or
 * deletes a record. Every run leaves a visible receipt.
 *
 * settings.json example:
 *
 *   "learning": {
 *     "consolidation": {
 *       "enabled": false,
 *       "intervalMs": 21600000,
 *       "minIdleMs": 0,
 *       "maxMergesPerRun": 10,
 *       "maxDecaysPerRun": 20,
 *       "maxProposalsPerRun": 20,
 *       "decayAgeDays": 45,
 *       "decayConfidenceStep": 10,
 *       "archiveConfidenceFloor": 40
 *     }
 *   }
 */
export interface ResolvedMemoryConsolidationConfig {
  /** Master switch. When false the job never runs. Default false. */
  readonly enabled: boolean;
  /** Minimum time between runs, in ms. Default 6 hours. Doubles as the schedule cadence. */
  readonly intervalMs: number;
  /** Minimum continuous idle time required before a run, in ms. Default 0. */
  readonly minIdleMs: number;
  /** Max duplicate groups merged in one run. Default 10. */
  readonly maxMergesPerRun: number;
  /** Max records decayed/archived in one run. Default 20. */
  readonly maxDecaysPerRun: number;
  /** Max proposals emitted in one run. Default 20. */
  readonly maxProposalsPerRun: number;
  /** Active records older than this (by updatedAt) become decay candidates. Default 45 days. */
  readonly decayAgeDays: number;
  /** Confidence points removed from a never-referenced decaying record per run. Default 10. */
  readonly decayConfidenceStep: number;
  /** A decaying record whose confidence would fall to/below this is archived (marked stale). Default 40. */
  readonly archiveConfidenceFloor: number;
}

export const DEFAULT_MEMORY_CONSOLIDATION_CONFIG: ResolvedMemoryConsolidationConfig = {
  enabled: false,
  intervalMs: 6 * 60 * 60 * 1000,
  minIdleMs: 0,
  maxMergesPerRun: 10,
  maxDecaysPerRun: 20,
  maxProposalsPerRun: 20,
  decayAgeDays: 45,
  decayConfidenceStep: 10,
  archiveConfidenceFloor: 40,
};

function readBoolean(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readPositive(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readNonNegative(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Resolve the effective consolidation config from a user-supplied
 * `learning.consolidation` block, falling back to
 * DEFAULT_MEMORY_CONSOLIDATION_CONFIG for every absent or wrong-typed key.
 */
export function resolveMemoryConsolidationConfig(
  configManager: Pick<ConfigManager, 'getRaw'>,
): ResolvedMemoryConsolidationConfig {
  const raw = configManager.getRaw() as unknown as Record<string, unknown>;
  const learning = raw.learning;
  if (learning === null || typeof learning !== 'object' || Array.isArray(learning)) {
    return DEFAULT_MEMORY_CONSOLIDATION_CONFIG;
  }
  const block = (learning as Record<string, unknown>).consolidation;
  if (block === null || typeof block !== 'object' || Array.isArray(block)) {
    return DEFAULT_MEMORY_CONSOLIDATION_CONFIG;
  }
  const c = block as Record<string, unknown>;
  const d = DEFAULT_MEMORY_CONSOLIDATION_CONFIG;
  return {
    enabled: readBoolean(c, 'enabled', d.enabled),
    intervalMs: readPositive(c, 'intervalMs', d.intervalMs),
    minIdleMs: readNonNegative(c, 'minIdleMs', d.minIdleMs),
    maxMergesPerRun: readPositive(c, 'maxMergesPerRun', d.maxMergesPerRun),
    maxDecaysPerRun: readPositive(c, 'maxDecaysPerRun', d.maxDecaysPerRun),
    maxProposalsPerRun: readPositive(c, 'maxProposalsPerRun', d.maxProposalsPerRun),
    decayAgeDays: readPositive(c, 'decayAgeDays', d.decayAgeDays),
    decayConfidenceStep: readPositive(c, 'decayConfidenceStep', d.decayConfidenceStep),
    archiveConfidenceFloor: readNonNegative(c, 'archiveConfidenceFloor', d.archiveConfidenceFloor),
  };
}
