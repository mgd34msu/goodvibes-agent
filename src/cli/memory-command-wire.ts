/**
 * memory-command-wire.ts
 *
 * Split out of memory-command.ts to stay under the 800-line architecture cap.
 * Owns the CLI's wire-first path onto the memory spine (SDK 1.1.0) — see the CLI
 * ruling below for why this exists and what it deliberately does NOT cover.
 */
import type { MemoryReviewState } from '@pellux/goodvibes-sdk/platform/state';
import type { MemoryAccess } from '@pellux/goodvibes-sdk/platform/runtime/memory-spine';
import { assertNoSecretLikeMemoryText } from '../agent/memory-safety.ts';
import { formatAgentRecordReviewState } from '../agent/record-labels.ts';
import { createSpineConnectionResolver, createSpineRestProbe } from '../runtime/session-spine-rest-transport.ts';
import { createMemorySpineRestTransport } from '../runtime/memory-spine-rest-transport.ts';
import type { CliCommandOutput } from './types.ts';
import type { CliCommandRuntime } from './management.ts';
import {
  VALID_REVIEW_STATES,
  csvOption,
  failure,
  filterFromOptions,
  hasFlag,
  isReviewState,
  optionValue,
  optionalScope,
  parseConfidence,
  parseOptions,
  provenanceFromOptions,
  renderRecordList,
  requireClass,
  success,
  type MemoryListData,
  type MemorySearchData,
} from './memory-command.ts';

/**
 * CLI RULING (memory-spine adoption, SDK 1.1.0).
 *
 * The CLI is a one-shot process invoked by `goodvibes-agent memory ...` with no
 * lasting daemon context — it doesn't get to sit through a boot-time reachability
 * probe like the interactive runtime does. But the daemon's canonical store is
 * single-writer: if a daemon IS running and owns that store, this process opening
 * the same sqlite file underneath it and calling `store.save()` at the end (see
 * `withMemory` in memory-command.ts, unconditional in its `finally`) would race the
 * daemon's own writes and silently drop whichever side saved last. Staying
 * "local-direct always" would be safe ONLY if no daemon could ever be running
 * concurrently — which is not true for this product (Connected Host is the normal
 * mode, not the exception).
 *
 * So the honest resolution: for every subcommand that has a wire-covered
 * equivalent on `MemoryAccess` (add/honestSearch/get/updateReview/delete — see
 * memory-spine-rest-transport.ts), the CLI probes for a reachable daemon FIRST and,
 * when one answers, runs the ENTIRE command over the wire and never opens the local
 * store file at all. Only when the probe finds no daemon does it fall back to the
 * existing direct-local path.
 *
 * A real, stated gap: not every subcommand maps onto the wire's five-method
 * surface. `list`'s all-scope browse semantics, `show`'s links, `queue`, `promote`
 * (scope update), `link`, `export`/`import` (bulk bundle), and `vector` diagnostics
 * have no wire equivalent in this SDK version, so they always run local-direct —
 * even while a daemon is adopted and actively writing the same file. That is the
 * exact single-writer race this ruling exists to prevent, and it is NOT closed for
 * those subcommands; it is a known scope limit of the wire surface as shipped, not
 * a silent oversight. Closing it fully needs the SDK to grow wire routes for the
 * remaining registry operations — out of scope for this work order.
 */
const WIRE_STORE_LABEL = 'wire:connected-daemon';
const CLI_PROBE_TIMEOUT_MS = 800;

const WIRE_ELIGIBLE_SUBCOMMANDS = new Set([
  'list', 'ls',
  'add', 'create',
  'review',
  'stale',
  'contradict', 'contradicted',
  'delete', 'remove', 'rm',
]);

/** `search`/`find` is wire-eligible only for a literal query — `--semantic`/`--vector` has no wire equivalent (searchSemantic/vectorStats aren't part of MemoryAccess). */
function isWireEligibleMemorySubcommand(normalized: string, args: readonly string[]): boolean {
  if (WIRE_ELIGIBLE_SUBCOMMANDS.has(normalized)) return true;
  if (normalized === 'search' || normalized === 'find') {
    const options = parseOptions(args);
    return !(hasFlag(options, 'semantic') || hasFlag(options, 'vector'));
  }
  return false;
}

/** Probes for a reachable connected daemon and, only when one answers, returns the wire MemoryAccess. Returns null (never throws) so the caller can fall back to local. */
async function resolveWireMemoryAccess(runtime: CliCommandRuntime): Promise<MemoryAccess | null> {
  const resolveConnection = createSpineConnectionResolver(runtime.configManager, runtime.homeDirectory);
  const probe = createSpineRestProbe({ resolveConnection, probeTimeoutMs: CLI_PROBE_TIMEOUT_MS });
  const reachable = await probe();
  if (!reachable) return null;
  return createMemorySpineRestTransport({ resolveConnection });
}

async function handleListWire(runtime: CliCommandRuntime, memorySpine: MemoryAccess, args: readonly string[]): Promise<CliCommandOutput> {
  const options = parseOptions(args);
  const positionalClass = options.positionals[0];
  const filter = filterFromOptions(options, 50);
  if (positionalClass !== undefined) filter.cls = requireClass(positionalClass);
  const { records } = await memorySpine.honestSearch(filter);
  const data: MemoryListData = { path: WIRE_STORE_LABEL, records, filter };
  return success(runtime, 'agent.memory.list', data, renderRecordList('Agent memory', WIRE_STORE_LABEL, records));
}

async function handleSearchWire(runtime: CliCommandRuntime, memorySpine: MemoryAccess, args: readonly string[]): Promise<CliCommandOutput> {
  const options = parseOptions(args);
  const query = options.positionals.join(' ').trim();
  if (!query) return failure(runtime, 'invalid_memory_command', 'Usage: goodvibes-agent memory search <query> [--semantic] [--cls <class>] [--scope <scope>] [--limit <n>]', 2);
  const filter = filterFromOptions(options, 20);
  filter.query = query;
  const { records } = await memorySpine.honestSearch(filter);
  const data: MemorySearchData = { path: WIRE_STORE_LABEL, records, filter, semantic: false, semanticResults: [] };
  return success(runtime, 'agent.memory.search', data, renderRecordList(`Agent memory matching "${query}"`, WIRE_STORE_LABEL, records));
}

async function handleAddWire(runtime: CliCommandRuntime, memorySpine: MemoryAccess, args: readonly string[]): Promise<CliCommandOutput> {
  const options = parseOptions(args);
  const [classRaw, ...summaryParts] = options.positionals;
  const cls = requireClass(classRaw);
  const summary = summaryParts.join(' ').trim();
  if (!summary) return failure(runtime, 'invalid_memory_command', 'Usage: goodvibes-agent memory add <class> <summary> [--scope <scope>] [--detail <text>] [--tags a,b]', 2);
  const detail = optionValue(options, 'detail');
  const tags = csvOption(options, 'tags');
  assertNoSecretLikeMemoryText([summary, detail ?? '', ...(tags ?? [])]);
  const reviewState = optionValue(options, 'review-state');
  if (reviewState !== undefined && !isReviewState(reviewState)) {
    return failure(runtime, 'invalid_memory_command', `Invalid review state "${reviewState}". Valid values ${VALID_REVIEW_STATES.join(', ')}`, 2);
  }
  const record = await memorySpine.add({
    scope: optionalScope(optionValue(options, 'scope')) ?? 'project',
    cls,
    summary,
    detail,
    tags: tags === undefined ? undefined : [...tags],
    provenance: [...provenanceFromOptions(options)],
    review: {
      state: reviewState,
      confidence: parseConfidence(optionValue(options, 'confidence')),
      reviewedBy: optionValue(options, 'by'),
    },
  });
  return success(runtime, 'agent.memory.add', record, [
    'Agent memory added',
    `  id ${record.id}`,
  ].join('\n'));
}

async function handleReviewWire(runtime: CliCommandRuntime, memorySpine: MemoryAccess, args: readonly string[]): Promise<CliCommandOutput> {
  const options = parseOptions(args);
  const [id, stateRaw] = options.positionals;
  if (!id || !stateRaw || !isReviewState(stateRaw)) {
    return failure(runtime, 'invalid_memory_command', `Usage: goodvibes-agent memory review <id> <${VALID_REVIEW_STATES.join('|')}> [--confidence <0-100>]`, 2);
  }
  const record = await memorySpine.updateReview(id, {
    state: stateRaw,
    confidence: parseConfidence(optionValue(options, 'confidence')),
    reviewedBy: optionValue(options, 'by') ?? 'operator',
    staleReason: optionValue(options, 'reason'),
  });
  if (!record) return failure(runtime, 'memory_not_found', `Memory record not found ${id}`, 1);
  return success(runtime, 'agent.memory.review', record, [
    'Agent memory reviewed',
    `  id ${record.id}`,
    `  review ${formatAgentRecordReviewState(record.reviewState)}`,
    `  confidence ${record.confidence}%`,
  ].join('\n'));
}

async function handleReviewShortcutWire(
  runtime: CliCommandRuntime,
  memorySpine: MemoryAccess,
  state: Extract<MemoryReviewState, 'stale' | 'contradicted'>,
  args: readonly string[],
): Promise<CliCommandOutput> {
  const [id, ...reasonParts] = args;
  if (!id || reasonParts.length === 0) {
    return failure(runtime, 'invalid_memory_command', `Usage: goodvibes-agent memory ${state === 'stale' ? 'stale' : 'contradict'} <id> <reason>`, 2);
  }
  const record = await memorySpine.updateReview(id, {
    state,
    reviewedBy: 'operator',
    staleReason: reasonParts.join(' '),
  });
  if (!record) return failure(runtime, 'memory_not_found', `Memory record not found ${id}`, 1);
  return success(runtime, `agent.memory.${state}`, record, [
    `Agent memory marked ${state}`,
    `  id ${record.id}`,
  ].join('\n'));
}

async function handleDeleteWire(runtime: CliCommandRuntime, memorySpine: MemoryAccess, args: readonly string[]): Promise<CliCommandOutput> {
  const options = parseOptions(args);
  const id = options.positionals[0];
  if (!id) return failure(runtime, 'invalid_memory_command', 'Usage: goodvibes-agent memory delete <id> --yes', 2);
  if (!hasFlag(options, 'yes')) return failure(runtime, 'confirmation_required', `Refusing to delete memory record ${id} without --yes.`, 2);
  if (!(await memorySpine.delete(id))) return failure(runtime, 'memory_not_found', `Memory record not found ${id}`, 1);
  return success(runtime, 'agent.memory.delete', { id }, [
    `Agent memory deleted: ${id}`,
    `  id ${id}`,
  ].join('\n'));
}

/**
 * Runs a wire-eligible subcommand over the memory spine when a daemon is reachable.
 * Returns null (never a failure output) when the subcommand has no wire path, or
 * when the probe finds no daemon — either way the caller falls through to the
 * existing local-direct path unchanged. Once a wire call is actually in flight, a
 * failure surfaces honestly (thrown, caught by handleMemoryCommand's try/catch) —
 * it never silently retries against the local file after starting a wire attempt.
 */
export async function tryWireMemoryCommand(
  runtime: CliCommandRuntime,
  normalized: string,
  rest: readonly string[],
): Promise<CliCommandOutput | null> {
  if (!isWireEligibleMemorySubcommand(normalized, rest)) return null;
  const memorySpine = await resolveWireMemoryAccess(runtime);
  if (!memorySpine) return null;
  if (normalized === 'list' || normalized === 'ls') return handleListWire(runtime, memorySpine, rest);
  if (normalized === 'search' || normalized === 'find') return handleSearchWire(runtime, memorySpine, rest);
  if (normalized === 'add' || normalized === 'create') return handleAddWire(runtime, memorySpine, rest);
  if (normalized === 'review') return handleReviewWire(runtime, memorySpine, rest);
  if (normalized === 'stale') return handleReviewShortcutWire(runtime, memorySpine, 'stale', rest);
  if (normalized === 'contradict' || normalized === 'contradicted') return handleReviewShortcutWire(runtime, memorySpine, 'contradicted', rest);
  if (normalized === 'delete' || normalized === 'remove' || normalized === 'rm') return handleDeleteWire(runtime, memorySpine, rest);
  return null;
}
