import type { CommandContext } from '../input/command-registry.ts';
import { AgentResearchRunRegistry, type AgentResearchRunRecord } from '../agent/research-run-registry.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from '../input/agent-workspace-snapshot.ts';
import type { AgentWorkspaceLocalLibraryItem } from '../input/agent-workspace-types.ts';
import type { WorkPlanItem } from '../work-plans/work-plan-store.ts';
import { previewHarnessText } from './agent-harness-text.ts';
import { agentHarnessVibeHealth } from './agent-harness-vibe-health.ts';

type LearningCandidateStatus =
  | 'needs-review'
  | 'needs-setup'
  | 'needs-consolidation'
  | 'low-confidence'
  | 'proposal-ready'
  | 'ready-to-promote'
  | 'ready';
type LocalLearningCandidateDomain = 'memory' | 'note' | 'persona' | 'skill' | 'skill_bundle' | 'routine';
type LearningCandidateDomain = LocalLearningCandidateDomain | 'work_plan' | 'research_run' | 'session' | 'capture' | 'vibe';
type LearningProposalTarget = 'memory' | 'skill' | 'routine' | 'persona';
type VibeCandidateKind = 'blocked' | 'truncated';

interface SessionInfoLike {
  readonly name: string;
  readonly title?: string;
  readonly model?: string;
  readonly provider?: string;
  readonly timestamp?: number;
  readonly messageCount?: number;
  readonly filePath?: string;
}

interface SessionManagerLike {
  readonly list?: () => readonly SessionInfoLike[];
  readonly load?: (name: string) => { readonly meta?: { readonly title?: string }; readonly messages?: readonly unknown[] };
}

interface AgentHarnessLearningCuratorArgs {
  readonly candidateId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

interface LearningScores {
  readonly usefulness: number;
  readonly freshness: number;
  readonly sourceQuality: number;
  readonly risk: number;
}

export interface LearningConsolidationDiff {
  readonly field: string;
  readonly survivor: string;
  readonly duplicates: readonly string[];
  readonly merged: string;
}

export interface LearningConsolidationFields {
  readonly detail?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly triggers?: readonly string[];
}

export interface LearningConsolidationPlan {
  readonly survivorId: string;
  readonly duplicateIds: readonly string[];
  readonly sharedKey: string;
  readonly diffs: readonly LearningConsolidationDiff[];
  readonly updateFields?: LearningConsolidationFields;
  readonly rollbackFields: LearningConsolidationFields;
  readonly updateRoute?: string;
  readonly staleRoutes: readonly string[];
  readonly deleteRoutes: readonly string[];
  readonly rollbackRoutes: readonly string[];
}

export interface LearningCandidate {
  readonly id: string;
  readonly label: string;
  readonly domain: LearningCandidateDomain;
  readonly recordId: string | null;
  readonly status: LearningCandidateStatus;
  readonly priority: number;
  readonly reason: string;
  readonly next: string;
  readonly scores: LearningScores;
  readonly reviewState?: string;
  readonly enabled?: boolean;
  readonly active?: boolean;
  readonly confidence?: number;
  readonly proposalTarget?: LearningProposalTarget;
  readonly proposalFields?: Readonly<Record<string, string>>;
  readonly missingRequirements?: readonly string[];
  readonly inspectRoute: string;
  readonly modelRoute: string;
  readonly reviewRoute?: string;
  readonly staleRoute?: string;
  readonly updateRoute?: string;
  readonly createRoute?: string;
  readonly deleteRoute?: string;
  readonly cleanupRoutes?: readonly string[];
  readonly rollbackRoutes?: readonly string[];
  readonly consolidation?: LearningConsolidationPlan;
}

interface LearningConsolidationBatchCandidate {
  readonly candidateId: string;
  readonly label: string;
  readonly domain: LearningCandidateDomain;
  readonly survivorId: string;
  readonly duplicateCount: number;
  readonly duplicateIds?: readonly string[];
  readonly diffFields: readonly string[];
  readonly detailRoute: string;
  readonly applyRoute: string;
  readonly mergeRoute: string;
  readonly stalePhaseRoute: string;
  readonly deletePhaseRoute: string;
  readonly updateRoute?: string;
  readonly staleRoute?: string;
  readonly deleteRoute?: string;
  readonly staleRoutes?: readonly string[];
  readonly deleteRoutes?: readonly string[];
  readonly rollbackRoutes?: readonly string[];
}

interface LearningConsolidationBatchPlan {
  readonly status: 'ready';
  readonly candidates: number;
  readonly duplicateRecords: number;
  readonly domains: readonly Record<string, unknown>[];
  readonly routes: Record<string, string>;
  readonly phases: readonly Record<string, unknown>[];
  readonly topCandidates: readonly LearningConsolidationBatchCandidate[];
  readonly policy: string;
}

interface LearningPromptPlan {
  readonly status: 'ready' | 'attention' | 'empty';
  readonly promptActiveCount: number;
  readonly suppressedCount: number;
  readonly proposalCount: number;
  readonly consolidationCount: number;
  readonly promptActiveRecords: readonly Record<string, unknown>[];
  readonly reviewFirst: readonly Record<string, unknown>[];
  readonly proposalQueue: readonly Record<string, unknown>[];
  readonly consolidationQueue: readonly Record<string, unknown>[];
  readonly suppressed: Record<string, number>;
  readonly orderingRules: readonly string[];
  readonly routes: Record<string, string>;
  readonly policy: string;
}

export type LearningCandidateResolution =
  | { readonly status: 'found'; readonly candidate: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, Math.trunc(parsed)));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isReviewed(item: AgentWorkspaceLocalLibraryItem): boolean {
  return item.reviewState === 'reviewed';
}

function missingRequirementCount(item: AgentWorkspaceLocalLibraryItem): number {
  return item.missingRequirementCount ?? 0;
}

function itemUsefulness(item: AgentWorkspaceLocalLibraryItem): number {
  const triggerSignal = Math.min(20, item.triggers.length * 5);
  const tagSignal = Math.min(10, item.tags.length * 2);
  const usageSignal = (item.enabled ? 15 : 0) + (item.active ? 15 : 0) + Math.min(20, (item.startCount ?? 0) * 4);
  const confidenceSignal = item.confidence === undefined ? 10 : Math.max(0, Math.min(20, item.confidence / 5));
  return clampScore(35 + triggerSignal + tagSignal + usageSignal + confidenceSignal);
}

function itemFreshness(item: AgentWorkspaceLocalLibraryItem): number {
  if (item.reviewState === 'stale') return 15;
  if (item.reviewState === 'fresh') return 55;
  return missingRequirementCount(item) > 0 ? 70 : 92;
}

function itemSourceQuality(item: AgentWorkspaceLocalLibraryItem): number {
  const source = item.source.toLowerCase();
  const base = source.includes('workspace') || source.includes('import') ? 72 : source.includes('agent') ? 68 : 60;
  return clampScore(base + (isReviewed(item) ? 12 : 0) + Math.min(12, item.tags.length * 2));
}

function itemRisk(item: AgentWorkspaceLocalLibraryItem): number {
  const reviewRisk = item.reviewState === 'stale' ? 60 : item.reviewState === 'fresh' ? 35 : 10;
  const injectionRisk = item.enabled || item.active ? 20 : 0;
  const setupRisk = Math.min(30, missingRequirementCount(item) * 10);
  const confidenceRisk = item.confidence === undefined ? 0 : Math.max(0, 70 - item.confidence);
  return clampScore(reviewRisk + injectionRisk + setupRisk + confidenceRisk);
}

function scoresForItem(item: AgentWorkspaceLocalLibraryItem): LearningScores {
  return {
    usefulness: itemUsefulness(item),
    freshness: itemFreshness(item),
    sourceQuality: itemSourceQuality(item),
    risk: itemRisk(item),
  };
}

function routeDomain(domain: LocalLearningCandidateDomain): string {
  return domain;
}

function localRegistryRoute(domain: LocalLearningCandidateDomain, action: string, id: string): string {
  return `agent_local_registry domain:"${routeDomain(domain)}" action:"${action}" id:"${id}"`;
}

function localRegistryModelRoute(domain: LocalLearningCandidateDomain): string {
  return `agent_local_registry domain:"${routeDomain(domain)}" action:"get"`;
}

function routeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function routeList(values: readonly string[]): string {
  return `[${values.map((value) => `"${routeValue(value)}"`).join(',')}]`;
}

function candidateBase(
  domain: LocalLearningCandidateDomain,
  item: AgentWorkspaceLocalLibraryItem,
  status: LearningCandidateStatus,
  priority: number,
  reason: string,
  next: string,
): LearningCandidate {
  const missingRequirements = item.missingRequirements ?? [];
  return {
    id: `${domain}:${item.id}:${status}`,
    label: item.name,
    domain,
    recordId: item.id,
    status,
    priority: clampScore(priority),
    reason,
    next,
    scores: scoresForItem(item),
    reviewState: item.reviewState,
    ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
    ...(item.active === undefined ? {} : { active: item.active }),
    ...(item.confidence === undefined ? {} : { confidence: item.confidence }),
    ...(missingRequirements.length === 0 ? {} : { missingRequirements }),
    inspectRoute: localRegistryRoute(domain, 'get', item.id),
    modelRoute: localRegistryModelRoute(domain),
    reviewRoute: localRegistryRoute(domain, 'review', item.id),
    staleRoute: `${localRegistryRoute(domain, 'stale', item.id)} reason:"..."`,
    deleteRoute: `${localRegistryRoute(domain, 'delete', item.id)} confirm:true explicitUserRequest:"..."`,
  };
}

const CONSOLIDATION_DOMAINS: readonly LocalLearningCandidateDomain[] = ['memory', 'persona', 'skill', 'routine'];

function normalizeDuplicateKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function duplicateKeySlug(value: string): string {
  return normalizeDuplicateKey(value).replace(/\s+/g, '-').slice(0, 52) || 'duplicate';
}

function uniqueText(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function itemConsolidationScore(item: AgentWorkspaceLocalLibraryItem): number {
  const scores = scoresForItem(item);
  const reviewSignal = isReviewed(item) ? 26 : item.reviewState === 'fresh' ? 10 : 0;
  const usageSignal = (item.enabled ? 12 : 0) + (item.active ? 16 : 0) + Math.min(12, (item.startCount ?? 0) * 3);
  const confidenceSignal = item.confidence === undefined ? 0 : item.confidence / 4;
  return scores.usefulness + scores.freshness + scores.sourceQuality - scores.risk + reviewSignal + usageSignal + confidenceSignal;
}

function chooseConsolidationSurvivor(items: readonly AgentWorkspaceLocalLibraryItem[]): AgentWorkspaceLocalLibraryItem {
  return [...items].sort((left, right) => {
    const byScore = itemConsolidationScore(right) - itemConsolidationScore(left);
    if (byScore !== 0) return byScore;
    const byReview = (isReviewed(right) ? 1 : 0) - (isReviewed(left) ? 1 : 0);
    if (byReview !== 0) return byReview;
    return left.id.localeCompare(right.id);
  })[0]!;
}

function mergeableDescription(domain: LocalLearningCandidateDomain, item: AgentWorkspaceLocalLibraryItem): string {
  if (domain === 'memory') {
    const fallback = item.scope && item.cls ? `${item.scope}/${item.cls}` : '';
    return item.description === fallback ? '' : item.description;
  }
  return item.description;
}

function mergedDescription(
  domain: LocalLearningCandidateDomain,
  survivor: AgentWorkspaceLocalLibraryItem,
  duplicates: readonly AgentWorkspaceLocalLibraryItem[],
): string {
  const descriptions = uniqueText([survivor, ...duplicates].map((item) => mergeableDescription(domain, item)));
  if (descriptions.length === 0) return '';
  return previewHarnessText(descriptions.join('\n\n'), 900);
}

function mergedTags(items: readonly AgentWorkspaceLocalLibraryItem[]): readonly string[] {
  return uniqueSorted(items.flatMap((item) => item.tags));
}

function mergedTriggers(items: readonly AgentWorkspaceLocalLibraryItem[]): readonly string[] {
  return uniqueSorted(items.flatMap((item) => item.triggers));
}

function updateFieldsForConsolidation(
  domain: LocalLearningCandidateDomain,
  survivor: AgentWorkspaceLocalLibraryItem,
  duplicates: readonly AgentWorkspaceLocalLibraryItem[],
): LearningConsolidationFields | undefined {
  const all = [survivor, ...duplicates];
  const tags = mergedTags(all);
  const triggers = mergedTriggers(all);
  const description = mergedDescription(domain, survivor, duplicates);
  if (domain === 'memory') {
    const fields: LearningConsolidationFields = {
      ...(description ? { detail: description } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    };
    return Object.keys(fields).length > 0 ? fields : undefined;
  }
  const fields: LearningConsolidationFields = {
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(triggers.length > 0 ? { triggers } : {}),
  };
  return Object.keys(fields).length > 0 ? fields : undefined;
}

function rollbackFieldsForConsolidation(
  domain: LocalLearningCandidateDomain,
  survivor: AgentWorkspaceLocalLibraryItem,
): LearningConsolidationFields {
  const description = mergeableDescription(domain, survivor);
  if (domain === 'memory') {
    return {
      ...(description ? { detail: description } : {}),
      tags: survivor.tags,
    };
  }
  return {
    ...(description ? { description } : {}),
    tags: survivor.tags,
    triggers: survivor.triggers,
  };
}

function consolidationDiff(
  field: string,
  survivor: string,
  duplicateValues: readonly string[],
  merged: string,
): LearningConsolidationDiff | null {
  const duplicates = uniqueText(duplicateValues);
  if (duplicates.length === 0 && !merged) return null;
  const normalizedSurvivor = survivor.trim().toLowerCase();
  const differs = duplicates.some((value) => value.trim().toLowerCase() !== normalizedSurvivor)
    || merged.trim().toLowerCase() !== normalizedSurvivor;
  if (!differs) return null;
  return {
    field,
    survivor: survivor || '(empty)',
    duplicates,
    merged: merged || '(empty)',
  };
}

function consolidationDiffs(
  domain: LocalLearningCandidateDomain,
  survivor: AgentWorkspaceLocalLibraryItem,
  duplicates: readonly AgentWorkspaceLocalLibraryItem[],
): readonly LearningConsolidationDiff[] {
  const all = [survivor, ...duplicates];
  const tags = mergedTags(all).join(', ');
  const triggers = mergedTriggers(all).join(', ');
  return [
    consolidationDiff('name', survivor.name, duplicates.map((item) => item.name), survivor.name),
    consolidationDiff('description', mergeableDescription(domain, survivor), duplicates.map((item) => mergeableDescription(domain, item)), mergedDescription(domain, survivor, duplicates)),
    consolidationDiff('tags', survivor.tags.join(', '), duplicates.map((item) => item.tags.join(', ')), tags),
    domain === 'memory' ? null : consolidationDiff('triggers', survivor.triggers.join(', '), duplicates.map((item) => item.triggers.join(', ')), triggers),
  ].filter((diff): diff is LearningConsolidationDiff => diff !== null);
}

function updateRouteForConsolidation(
  domain: LocalLearningCandidateDomain,
  survivor: AgentWorkspaceLocalLibraryItem,
  duplicates: readonly AgentWorkspaceLocalLibraryItem[],
): string | undefined {
  const updateFields = updateFieldsForConsolidation(domain, survivor, duplicates);
  if (!updateFields) return undefined;
  const fields: string[] = [];
  if (domain === 'memory') {
    if (updateFields.detail) fields.push(`detail:"${routeValue(updateFields.detail)}"`);
    if (updateFields.tags && updateFields.tags.length > 0) fields.push(`tags:${routeList(updateFields.tags)}`);
  } else {
    if (updateFields.description) fields.push(`description:"${routeValue(updateFields.description)}"`);
    if (updateFields.tags && updateFields.tags.length > 0) fields.push(`tags:${routeList(updateFields.tags)}`);
    if (updateFields.triggers && updateFields.triggers.length > 0) fields.push(`triggers:${routeList(updateFields.triggers)}`);
  }
  if (fields.length === 0) return undefined;
  return [
    localRegistryRoute(domain, 'update', survivor.id),
    ...fields,
    'provenance:"learning-curator-consolidation"',
  ].join(' ');
}

function rollbackUpdateRouteForConsolidation(domain: LocalLearningCandidateDomain, survivor: AgentWorkspaceLocalLibraryItem): string {
  const rollbackFields = rollbackFieldsForConsolidation(domain, survivor);
  const fields: string[] = [];
  if (domain === 'memory') {
    if (rollbackFields.detail) fields.push(`detail:"${routeValue(rollbackFields.detail)}"`);
    fields.push(`tags:${routeList(rollbackFields.tags ?? [])}`);
  } else {
    if (rollbackFields.description) fields.push(`description:"${routeValue(rollbackFields.description)}"`);
    fields.push(`tags:${routeList(rollbackFields.tags ?? [])}`);
    fields.push(`triggers:${routeList(rollbackFields.triggers ?? [])}`);
  }
  return [
    localRegistryRoute(domain, 'update', survivor.id),
    ...fields,
    'provenance:"rollback-learning-curator-consolidation"',
  ].join(' ');
}

function consolidationProposalFields(plan: LearningConsolidationPlan): Readonly<Record<string, string>> {
  return {
    survivorId: plan.survivorId,
    duplicateIds: plan.duplicateIds.join(','),
    visibleDiff: plan.diffs.length > 0
      ? plan.diffs.map((diff) => `${diff.field}: keep [${diff.survivor}], merge [${diff.merged}]`).join('\n')
      : 'Visible metadata matches; inspect record bodies before marking duplicates stale.',
    staleFirst: plan.staleRoutes.join('\n'),
    rollback: plan.rollbackRoutes.join('\n'),
  };
}

function consolidationCandidate(
  domain: LocalLearningCandidateDomain,
  key: string,
  items: readonly AgentWorkspaceLocalLibraryItem[],
): LearningCandidate | null {
  if (items.length < 2) return null;
  const survivor = chooseConsolidationSurvivor(items);
  const duplicates = items.filter((item) => item.id !== survivor.id);
  if (duplicates.length === 0) return null;
  const updateRoute = updateRouteForConsolidation(domain, survivor, duplicates);
  const updateFields = updateFieldsForConsolidation(domain, survivor, duplicates);
  const rollbackFields = rollbackFieldsForConsolidation(domain, survivor);
  const staleRoutes = duplicates.map((item) => `${localRegistryRoute(domain, 'stale', item.id)} reason:"Duplicate of ${routeValue(survivor.id)}; staged by learning curator consolidation."`);
  const deleteRoutes = duplicates.map((item) => `${localRegistryRoute(domain, 'delete', item.id)} confirm:true explicitUserRequest:"Delete duplicate ${routeValue(domain)} ${routeValue(item.id)} after reviewed consolidation."`);
  const rollbackRoutes = [
    ...(updateRoute ? [rollbackUpdateRouteForConsolidation(domain, survivor)] : []),
    ...duplicates.map((item) => localRegistryRoute(domain, 'review', item.id)),
  ];
  const diffs = consolidationDiffs(domain, survivor, duplicates);
  const plan: LearningConsolidationPlan = {
    survivorId: survivor.id,
    duplicateIds: duplicates.map((item) => item.id),
    sharedKey: key,
    diffs,
    ...(updateFields ? { updateFields } : {}),
    rollbackFields,
    ...(updateRoute ? { updateRoute } : {}),
    staleRoutes,
    deleteRoutes,
    rollbackRoutes,
  };
  const enabledDuplicateCount = duplicates.filter((item) => item.enabled || item.active).length;
  return {
    id: `consolidation:${domain}:${duplicateKeySlug(key)}`,
    label: `Consolidate duplicate ${domain}: ${survivor.name}`,
    domain,
    recordId: survivor.id,
    status: 'needs-consolidation',
    priority: clampScore(72 + Math.min(16, duplicates.length * 4) + enabledDuplicateCount * 5),
    reason: `${items.length} Agent-local ${domain} records share the same normalized name.`,
    next: 'Inspect every record, update the survivor with merged visible fields, mark duplicates stale first, then delete only after explicit review.',
    scores: {
      usefulness: clampScore(64 + Math.min(18, items.length * 4)),
      freshness: Math.max(...items.map(itemFreshness)),
      sourceQuality: Math.max(...items.map(itemSourceQuality)),
      risk: clampScore(34 + enabledDuplicateCount * 12 + Math.min(18, duplicates.length * 4)),
    },
    reviewState: survivor.reviewState,
    ...(survivor.enabled === undefined ? {} : { enabled: survivor.enabled }),
    ...(survivor.active === undefined ? {} : { active: survivor.active }),
    ...(survivor.confidence === undefined ? {} : { confidence: survivor.confidence }),
    proposalFields: consolidationProposalFields(plan),
    consolidation: plan,
    inspectRoute: localRegistryRoute(domain, 'get', survivor.id),
    modelRoute: 'memory action:"curator" query:"consolidation"',
    reviewRoute: localRegistryRoute(domain, 'review', survivor.id),
    ...(staleRoutes[0] ? { staleRoute: staleRoutes[0] } : {}),
    ...(updateRoute ? { updateRoute } : {}),
    ...(deleteRoutes[0] ? { deleteRoute: deleteRoutes[0] } : {}),
    cleanupRoutes: staleRoutes,
    rollbackRoutes,
  };
}

function consolidationCandidatesForDomain(
  domain: LocalLearningCandidateDomain,
  items: readonly AgentWorkspaceLocalLibraryItem[],
): readonly LearningCandidate[] {
  if (!CONSOLIDATION_DOMAINS.includes(domain)) return [];
  const groups = new Map<string, AgentWorkspaceLocalLibraryItem[]>();
  for (const item of items) {
    const key = normalizeDuplicateKey(item.name);
    if (key.length < 4) continue;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()].flatMap(([key, group]) => {
    const candidate = consolidationCandidate(domain, key, group);
    return candidate ? [candidate] : [];
  });
}

function captureCandidate(): LearningCandidate {
  return {
    id: 'capture:reviewed-lesson',
    label: 'Capture reviewed lesson',
    domain: 'capture',
    recordId: null,
    status: 'ready',
    priority: 30,
    reason: 'No urgent local-learning review candidates are present.',
    next: 'After a repeated workflow, useful preference, or durable lesson appears, capture it as a local memory, skill, routine, or persona for review.',
    scores: { usefulness: 55, freshness: 85, sourceQuality: 60, risk: 10 },
    inspectRoute: 'agent_harness mode:"workspace_action" actionId:"learned-behavior"',
    modelRoute: 'agent_harness mode:"workspace_actions" query:"learned behavior"',
    createRoute: 'agent_harness mode:"run_workspace_action" actionId:"learned-behavior" confirm:true explicitUserRequest:"..."',
  };
}

function stableVibeIdSuffix(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52) || 'vibe';
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 31) + value.charCodeAt(index)) >>> 0;
  }
  return `${slug}-${hash.toString(36)}`;
}

function vibeStatusRoute(): string {
  return 'vibe action:"status"';
}

function vibeCommandInspectRoute(): string {
  return 'vibe action:"status"';
}

function vibeCandidate(
  kind: VibeCandidateKind,
  path: string,
  scope: string,
  reason: string,
): LearningCandidate {
  const isBlocked = kind === 'blocked';
  return {
    id: `vibe:${kind}:${stableVibeIdSuffix(path)}`,
    label: `${isBlocked ? 'Blocked' : 'Truncated'} ${scope} VIBE.md`,
    domain: 'vibe',
    recordId: path,
    status: isBlocked ? 'needs-setup' : 'needs-review',
    priority: isBlocked ? 88 : 72,
    reason,
    next: isBlocked
      ? 'Inspect /vibe status, edit or remove blocked content, then rerun status before relying on personality instructions.'
      : 'Inspect /vibe status and shorten the file if omitted personality instructions matter for this user.',
    scores: {
      usefulness: 75,
      freshness: isBlocked ? 45 : 58,
      sourceQuality: scope === 'project' ? 76 : 70,
      risk: isBlocked ? 86 : 58,
    },
    ...(isBlocked ? { missingRequirements: ['VIBE.md file is not loaded into the prompt until the blocked content is repaired.'] } : {}),
    proposalFields: {
      path,
      scope,
      kind,
      reason: previewHarnessText(reason, 220),
      statusRoute: vibeStatusRoute(),
    },
    inspectRoute: vibeStatusRoute(),
    modelRoute: 'memory action:"curator" query:"vibe"',
    reviewRoute: vibeCommandInspectRoute(),
    createRoute: 'vibe action:"init" scope:"project" confirm:true explicitUserRequest:"Create or refresh the project VIBE.md starter."',
  };
}

function vibeHealthCandidates(context: CommandContext): readonly LearningCandidate[] {
  const health = agentHarnessVibeHealth(context);
  return [
    ...health.blockedFiles.map((file) => vibeCandidate('blocked', file.path, file.scope, file.reason)),
    ...health.files
      .filter((file) => file.truncated)
      .map((file) => vibeCandidate(
        'truncated',
        file.path,
        file.scope,
        'VIBE.md was loaded, but only the first safe prompt budget was applied.',
      )),
  ];
}

function noteProposalTarget(item: AgentWorkspaceLocalLibraryItem): LearningProposalTarget | null {
  const tags = item.tags.map((tag) => tag.toLowerCase());
  const text = [item.name, item.description, ...tags].join('\n').toLowerCase();
  if (tags.some((tag) => ['memory', 'fact', 'decision', 'constraint', 'risk', 'pattern', 'incident', 'architecture', 'ownership'].includes(tag))) return 'memory';
  if (tags.some((tag) => ['routine', 'workflow', 'runbook', 'process'].includes(tag))) return 'routine';
  if (tags.some((tag) => ['persona', 'style', 'preference', 'tone'].includes(tag))) return 'persona';
  if (tags.some((tag) => ['skill', 'procedure', 'lesson', 'learned', 'howto'].includes(tag))) return 'skill';
  if (/\b(memory|remember|fact|decision|constraint|risk|incident|pattern|architecture|ownership)\b/.test(text)) return 'memory';
  if (/\b(repeat|routine|workflow|every time|checklist|runbook)\b/.test(text)) return 'routine';
  if (/\b(style|tone|preference|respond|answer)\b/.test(text)) return 'persona';
  if (/\b(lesson|procedure|steps|how to|when asked)\b/.test(text)) return 'skill';
  return null;
}

function proposalSubject(target: LearningProposalTarget): string {
  return target === 'memory' ? 'durable memory' : `reusable ${target} behavior`;
}

function noteBehaviorProposalCandidate(item: AgentWorkspaceLocalLibraryItem): LearningCandidate | null {
  if (!isReviewed(item)) return null;
  const target = noteProposalTarget(item);
  if (!target) return null;
  const actionId = target === 'memory'
    ? 'notes-to-memory'
    : target === 'skill'
    ? 'notes-to-skill'
    : target === 'routine'
      ? 'notes-to-routine'
      : 'notes-to-persona';
  const label = `${item.name} -> ${target}`;
  return {
    id: `note-proposal:${target}:${item.id}`,
    label,
    domain: 'note',
    recordId: item.id,
    status: 'proposal-ready',
    priority: target === 'routine' ? 64 : target === 'memory' ? 62 : 60,
    reason: `Reviewed note looks like ${proposalSubject(target)}.`,
    next: `Preview the selected-note ${target} promotion, then save it only if the user wants this durable context.`,
    scores: {
      usefulness: clampScore(itemUsefulness(item) + 8),
      freshness: itemFreshness(item),
      sourceQuality: itemSourceQuality(item),
      risk: 24,
    },
    reviewState: item.reviewState,
    proposalTarget: target,
    inspectRoute: localRegistryRoute('note', 'get', item.id),
    modelRoute: `agent_harness mode:"workspace_action" actionId:"${actionId}"`,
    createRoute: `agent_harness mode:"run_workspace_action" actionId:"${actionId}" recordId:"${item.id}" confirm:true explicitUserRequest:"..."`,
  };
}

function workPlanProposalTarget(item: WorkPlanItem): LearningProposalTarget | null {
  const text = [item.title, item.notes ?? '', item.source ?? '', item.owner ?? ''].join('\n').toLowerCase();
  if (/\b(memory|remember|fact|decision|constraint|risk|incident|pattern|architecture|ownership)\b/.test(text)) return 'memory';
  if (/\b(style|tone|preference|respond|answer|voice|persona)\b/.test(text)) return 'persona';
  if (/\b(repeat|routine|workflow|every time|checklist|runbook|process|before release|after release)\b/.test(text)) return 'routine';
  if (/\b(lesson|procedure|steps|how to|when asked|debug|fix|review|test|release|deploy|triage)\b/.test(text)) return 'skill';
  return null;
}

function inferMemoryClass(text: string): string {
  const normalized = text.toLowerCase();
  if (/\bdecision|decided|choose|selected\b/.test(normalized)) return 'decision';
  if (/\bconstraint|must|never|always|required\b/.test(normalized)) return 'constraint';
  if (/\brisk|hazard|regression\b/.test(normalized)) return 'risk';
  if (/\bincident|outage|failure\b/.test(normalized)) return 'incident';
  if (/\bpattern|repeat|recurring\b/.test(normalized)) return 'pattern';
  if (/\barchitecture|design|system\b/.test(normalized)) return 'architecture';
  if (/\bowner|ownership|responsible\b/.test(normalized)) return 'ownership';
  if (/\brunbook|checklist\b/.test(normalized)) return 'runbook';
  return 'fact';
}

function completedWorkFreshness(item: WorkPlanItem): number {
  if (!item.completedAt) return 70;
  const ageDays = Math.max(0, (Date.now() - item.completedAt) / (24 * 60 * 60 * 1000));
  return clampScore(96 - Math.min(45, ageDays * 3));
}

function completedIsoFreshness(iso: string | undefined): number {
  if (!iso) return 70;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return 70;
  const ageDays = Math.max(0, (Date.now() - parsed) / (24 * 60 * 60 * 1000));
  return clampScore(96 - Math.min(45, ageDays * 3));
}

function completedTimestampFreshness(timestamp: number | undefined): number {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) return 70;
  const ageDays = Math.max(0, (Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  return clampScore(96 - Math.min(45, ageDays * 3));
}

function completedWorkDetail(item: WorkPlanItem, notes: string): string {
  return [
    `Completed work: ${item.title}`,
    item.owner ? `Owner: ${item.owner}` : '',
    item.source ? `Source: ${item.source}` : '',
    '',
    notes,
  ].filter(Boolean).join('\n');
}

function workPlanCompletionCandidate(item: WorkPlanItem): LearningCandidate | null {
  if (item.status !== 'done') return null;
  const target = workPlanProposalTarget(item);
  if (!target) return null;
  const notes = item.notes?.trim() || `Completed work item: ${item.title}`;
  const name = previewHarnessText(item.title, 80);
  const description = target === 'memory'
    ? `Durable memory learned from completed work: ${name}`
    : target === 'routine'
    ? `Repeatable workflow learned from completed work: ${name}`
    : target === 'persona'
      ? `Operating preference learned from completed work: ${name}`
      : `Reusable skill learned from completed work: ${name}`;
  const detail = completedWorkDetail(item, notes);
  return {
    id: `work-plan-proposal:${target}:${item.id}`,
    label: `${item.title} -> ${target}`,
    domain: 'work_plan',
    recordId: item.id,
    status: 'proposal-ready',
    priority: target === 'routine' ? 62 : target === 'memory' ? 60 : 58,
    reason: `Completed work item looks like ${proposalSubject(target)}.`,
    next: `Review the completed work notes, then capture this as Agent-local ${target} only if the user wants it reused.`,
    scores: {
      usefulness: clampScore(62 + Math.min(18, notes.length / 12)),
      freshness: completedWorkFreshness(item),
      sourceQuality: item.source ? 72 : 64,
      risk: 28,
    },
    proposalTarget: target,
    proposalFields: target === 'memory' ? {
      cls: inferMemoryClass(`${item.title}\n${notes}`),
      scope: 'project',
      summary: previewHarnessText(item.title, 140),
      detail,
      tags: 'learned,completed-work,memory',
      confidence: '80',
    } : {
      target,
      name,
      description: previewHarnessText(description, 140),
      notes: detail,
      triggers: target === 'routine' ? 'workflow, checklist' : target === 'persona' ? 'preference' : 'lesson, procedure',
      tags: `learned,completed-work,${target}`,
      enable: 'yes',
    },
    inspectRoute: `agent_work_plan action:"get" id:"${item.id}"`,
    modelRoute: 'agent_work_plan action:"get"',
    createRoute: target === 'memory'
      ? 'agent_harness mode:"run_workspace_action" actionId:"memory-create" confirm:true explicitUserRequest:"..."'
      : 'agent_harness mode:"run_workspace_action" actionId:"learned-behavior" confirm:true explicitUserRequest:"..."',
  };
}

function researchRunProposalTarget(run: AgentResearchRunRecord): LearningProposalTarget | null {
  const text = [
    run.title,
    run.question,
    run.goal,
    run.note ?? '',
    run.reportArtifactId ?? '',
    ...run.plan,
    ...run.nextSteps,
    ...run.sourceIds,
    ...run.checkpoints.map((checkpoint) => checkpoint.note),
  ].join('\n').toLowerCase();
  if (/\b(memory|remember|fact|decision|constraint|risk|incident|pattern|architecture|ownership)\b/.test(text)) return 'memory';
  if (/\b(style|tone|preference|respond|answer|voice|persona)\b/.test(text)) return 'persona';
  if (/\b(repeat|routine|workflow|every time|checklist|runbook|process|before report|after report)\b/.test(text)) return 'routine';
  if (/\b(lesson|procedure|steps|how to|when asked|research|source|citation|report|credibility|synthesize)\b/.test(text)) return 'skill';
  return null;
}

function researchRunDetail(run: AgentResearchRunRecord): string {
  return [
    `Completed research run: ${run.title}`,
    `Question: ${run.question}`,
    `Goal: ${run.goal}`,
    run.reportArtifactId ? `Report artifact: ${run.reportArtifactId}` : '',
    run.sourceIds.length > 0 ? `Sources: ${run.sourceIds.join(', ')}` : '',
    '',
    run.note ? `Completion note: ${run.note}` : '',
    run.plan.length > 0 ? `Plan:\n${run.plan.map((step) => `- ${step}`).join('\n')}` : '',
    run.checkpoints.length > 0 ? `Recent checkpoints:\n${run.checkpoints.slice(-3).map((checkpoint) => `- ${checkpoint.note}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

function researchRunCompletionCandidate(run: AgentResearchRunRecord): LearningCandidate | null {
  if (run.status !== 'completed') return null;
  const target = researchRunProposalTarget(run);
  if (!target) return null;
  const name = previewHarnessText(run.title, 80);
  const detail = researchRunDetail(run);
  const description = target === 'memory'
    ? `Durable memory learned from completed research: ${name}`
    : target === 'routine'
      ? `Repeatable research workflow learned from completed run: ${name}`
      : target === 'persona'
        ? `Operating preference learned from completed research: ${name}`
        : `Reusable research skill learned from completed run: ${name}`;
  return {
    id: `research-run-proposal:${target}:${run.id}`,
    label: `${run.title} -> ${target}`,
    domain: 'research_run',
    recordId: run.id,
    status: 'proposal-ready',
    priority: target === 'memory' ? 57 : 55,
    reason: `Completed research run looks like ${proposalSubject(target)}.`,
    next: `Review the run ledger and report artifact, then capture this as Agent-local ${target} only if it should guide future work.`,
    scores: {
      usefulness: clampScore(60 + Math.min(16, run.sourceIds.length * 3) + Math.min(10, run.checkpoints.length * 2)),
      freshness: completedIsoFreshness(run.completedAt),
      sourceQuality: run.reportArtifactId ? 78 : run.sourceIds.length > 0 ? 70 : 62,
      risk: target === 'memory' ? 32 : 30,
    },
    proposalTarget: target,
    proposalFields: target === 'memory' ? {
      cls: inferMemoryClass(`${run.title}\n${run.note ?? ''}\n${run.goal}`),
      scope: 'project',
      summary: previewHarnessText(run.note || run.title, 140),
      detail,
      tags: 'learned,research-run,memory',
      confidence: run.reportArtifactId ? '82' : '76',
    } : {
      target,
      name,
      description: previewHarnessText(description, 140),
      notes: detail,
      triggers: target === 'routine' ? 'research, report, workflow' : target === 'persona' ? 'research preference' : 'research, sources, report',
      tags: `learned,research-run,${target}`,
      enable: 'yes',
    },
    inspectRoute: `agent_harness mode:"research_run" runId:"${run.id}"`,
    modelRoute: 'agent_harness mode:"research_run"',
    createRoute: target === 'memory'
      ? 'agent_harness mode:"run_workspace_action" actionId:"memory-create" confirm:true explicitUserRequest:"..."'
      : 'agent_harness mode:"run_workspace_action" actionId:"learned-behavior" confirm:true explicitUserRequest:"..."',
  };
}

function extractMessageText(message: unknown): string {
  if (typeof message === 'string') return message;
  if (typeof message !== 'object' || message === null) return '';
  const record = message as Record<string, unknown>;
  const content = record.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part !== 'object' || part === null) return '';
      const partRecord = part as Record<string, unknown>;
      return typeof partRecord.text === 'string' ? partRecord.text : '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

function sessionLoadedText(manager: SessionManagerLike, session: SessionInfoLike): string {
  if (typeof manager.load !== 'function') return '';
  try {
    const loaded = manager.load(session.name);
    const metaTitle = loaded.meta?.title ?? '';
    const messageText = (loaded.messages ?? []).map(extractMessageText).filter(Boolean).slice(-8).join('\n');
    return [metaTitle, messageText].filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

function sessionProposalTarget(text: string): LearningProposalTarget | null {
  const normalized = text.toLowerCase();
  if (/\b(memory|remember|fact|decision|constraint|risk|incident|pattern|architecture|ownership)\b/.test(normalized)) return 'memory';
  if (/\b(style|tone|preference|respond|answer|voice|persona)\b/.test(normalized)) return 'persona';
  if (/\b(repeat|routine|workflow|every time|checklist|runbook|process)\b/.test(normalized)) return 'routine';
  if (/\b(lesson|procedure|steps|how to|when asked|debug|fix|review|test|release|deploy|triage|research|source|citation|report)\b/.test(normalized)) return 'skill';
  return null;
}

function sessionDetail(session: SessionInfoLike, loadedText: string): string {
  return [
    `Saved session: ${session.title || session.name}`,
    `Session id: ${session.name}`,
    session.model ? `Model: ${session.model}` : '',
    session.provider ? `Provider: ${session.provider}` : '',
    session.messageCount ? `Messages: ${session.messageCount}` : '',
    '',
    loadedText ? `Relevant transcript:\n${previewHarnessText(loadedText, 1200)}` : 'Transcript unavailable from the session manager; inspect the session before capturing durable context.',
  ].filter(Boolean).join('\n');
}

function sessionCompletionCandidate(manager: SessionManagerLike, session: SessionInfoLike): LearningCandidate | null {
  if (!session.name) return null;
  const loadedText = sessionLoadedText(manager, session);
  const text = [session.title ?? '', session.name, loadedText].join('\n');
  const target = sessionProposalTarget(text);
  if (!target) return null;
  const labelBase = session.title || session.name;
  const detail = sessionDetail(session, loadedText);
  const description = target === 'memory'
    ? `Durable memory learned from saved session: ${previewHarnessText(labelBase, 80)}`
    : target === 'routine'
      ? `Repeatable workflow learned from saved session: ${previewHarnessText(labelBase, 80)}`
      : target === 'persona'
        ? `Operating preference learned from saved session: ${previewHarnessText(labelBase, 80)}`
        : `Reusable skill learned from saved session: ${previewHarnessText(labelBase, 80)}`;
  return {
    id: `session-proposal:${target}:${session.name}`,
    label: `${labelBase} -> ${target}`,
    domain: 'session',
    recordId: session.name,
    status: 'proposal-ready',
    priority: target === 'memory' ? 54 : 52,
    reason: `Saved session looks like ${proposalSubject(target)}.`,
    next: `Inspect the saved session transcript, then capture this as Agent-local ${target} only if it should guide future work.`,
    scores: {
      usefulness: clampScore(52 + Math.min(18, (session.messageCount ?? 0) / 2) + (loadedText ? 8 : 0)),
      freshness: completedTimestampFreshness(session.timestamp),
      sourceQuality: loadedText ? 68 : 58,
      risk: loadedText ? 34 : 42,
    },
    proposalTarget: target,
    proposalFields: target === 'memory' ? {
      cls: inferMemoryClass(text),
      scope: 'project',
      summary: previewHarnessText(loadedText || labelBase, 140),
      detail,
      tags: 'learned,saved-session,memory',
      confidence: loadedText ? '76' : '68',
    } : {
      target,
      name: previewHarnessText(labelBase, 80),
      description: previewHarnessText(description, 140),
      notes: detail,
      triggers: target === 'routine' ? 'session, workflow' : target === 'persona' ? 'session preference' : 'session, lesson',
      tags: `learned,saved-session,${target}`,
      enable: 'yes',
    },
    inspectRoute: `sessions action:"get" sessionId:"${session.name}"`,
    modelRoute: 'sessions action:"get"',
    createRoute: target === 'memory'
      ? 'agent_harness mode:"run_workspace_action" actionId:"memory-create" confirm:true explicitUserRequest:"..."'
      : 'agent_harness mode:"run_workspace_action" actionId:"learned-behavior" confirm:true explicitUserRequest:"..."',
  };
}

function notePromotionCandidate(item: AgentWorkspaceLocalLibraryItem): LearningCandidate | null {
  if (!isReviewed(item) || !item.description.includes('Origin URL')) return null;
  return {
    id: `note-promote:${item.id}`,
    label: item.name,
    domain: 'note',
    recordId: item.id,
    status: 'ready-to-promote',
    priority: 52,
    reason: 'Reviewed note appears to have a source URL that may belong in isolated Agent Knowledge.',
    next: 'Promote only if the source is durable, useful later, and the user wants it in Agent Knowledge.',
    scores: {
      usefulness: itemUsefulness(item),
      freshness: itemFreshness(item),
      sourceQuality: clampScore(itemSourceQuality(item) + 8),
      risk: 18,
    },
    reviewState: item.reviewState,
    inspectRoute: localRegistryRoute('note', 'get', item.id),
    modelRoute: localRegistryModelRoute('note'),
    createRoute: 'agent_harness mode:"workspace_action" actionId:"notes-to-knowledge"',
  };
}

function candidatesForItem(domain: LocalLearningCandidateDomain, item: AgentWorkspaceLocalLibraryItem): LearningCandidate[] {
  const candidates: LearningCandidate[] = [];
  const missing = missingRequirementCount(item);
  if (missing > 0 && (domain === 'skill' || domain === 'skill_bundle' || domain === 'routine')) {
    candidates.push(candidateBase(
      domain,
      item,
      'needs-setup',
      item.enabled ? 88 : 68,
      `${missing} setup requirement(s) are missing.`,
      'Resolve setup requirements before enabling, scheduling, or relying on this behavior.',
    ));
  }
  if (item.confidence !== undefined && item.confidence < 70) {
    candidates.push(candidateBase(
      domain,
      item,
      'low-confidence',
      78 - Math.floor(item.confidence / 5),
      `Confidence is ${item.confidence}%, below the durable-memory threshold.`,
      'Review, update confidence, or mark stale before using this memory as prompt context.',
    ));
  }
  if (!isReviewed(item)) {
    const enabledOrActive = item.enabled === true || item.active === true;
    candidates.push(candidateBase(
      domain,
      item,
      'needs-review',
      item.reviewState === 'stale' ? 92 : enabledOrActive ? 88 : 74,
      item.reviewState === 'stale'
        ? 'Record is stale and should not silently guide the assistant.'
        : enabledOrActive
          ? 'Record can influence the assistant but is not reviewed.'
          : 'Record is fresh and waiting for review.',
      'Inspect provenance and content, then review it, revise it, or mark it stale.',
    ));
  }
  if (domain === 'note') {
    const behaviorProposal = noteBehaviorProposalCandidate(item);
    if (behaviorProposal) candidates.push(behaviorProposal);
    const promotion = notePromotionCandidate(item);
    if (promotion) candidates.push(promotion);
  }
  return candidates;
}

function workPlanCompletionCandidates(context: CommandContext): readonly LearningCandidate[] {
  try {
    return (context.workspace?.workPlanStore?.listItems?.() ?? [])
      .flatMap((item) => {
        const candidate = workPlanCompletionCandidate(item);
        return candidate ? [candidate] : [];
      });
  } catch {
    return [];
  }
}

function researchRunCompletionCandidates(context: CommandContext): readonly LearningCandidate[] {
  const shellPaths = context.workspace?.shellPaths;
  if (!shellPaths) return [];
  try {
    return AgentResearchRunRegistry.fromShellPaths(shellPaths)
      .snapshot()
      .completed
      .flatMap((run) => {
        const candidate = researchRunCompletionCandidate(run);
        return candidate ? [candidate] : [];
      });
  } catch {
    return [];
  }
}

function sessionCompletionCandidates(context: CommandContext): readonly LearningCandidate[] {
  const manager = context.session?.sessionManager as SessionManagerLike | undefined;
  if (typeof manager?.list !== 'function') return [];
  try {
    return manager.list()
      .filter((session) => session.name !== context.session?.runtime?.sessionId)
      .flatMap((session) => {
        const candidate = sessionCompletionCandidate(manager, session);
        return candidate ? [candidate] : [];
      });
  } catch {
    return [];
  }
}

function candidateSearchText(candidate: LearningCandidate): string {
  return [
    candidate.id,
    candidate.label,
    candidate.domain,
    candidate.recordId ?? '',
    candidate.status,
    candidate.reason,
    candidate.next,
    candidate.reviewState ?? '',
    candidate.missingRequirements?.join('\n') ?? '',
    candidate.proposalTarget ?? '',
    Object.values(candidate.proposalFields ?? {}).join('\n'),
    candidate.consolidation ? JSON.stringify(candidate.consolidation) : '',
    candidate.inspectRoute,
    candidate.modelRoute,
  ].join('\n').toLowerCase();
}

function buildLearningCandidates(context: CommandContext): readonly LearningCandidate[] {
  const snapshot = buildAgentWorkspaceRuntimeSnapshot(context);
  const candidates = [
    ...snapshot.localMemories.flatMap((item) => candidatesForItem('memory', item)),
    ...snapshot.localNotes.flatMap((item) => candidatesForItem('note', item)),
    ...snapshot.localPersonas.flatMap((item) => candidatesForItem('persona', item)),
    ...snapshot.localSkills.flatMap((item) => candidatesForItem('skill', item)),
    ...snapshot.localSkillBundles.flatMap((item) => candidatesForItem('skill_bundle', item)),
    ...snapshot.localRoutines.flatMap((item) => candidatesForItem('routine', item)),
    ...consolidationCandidatesForDomain('memory', snapshot.localMemories),
    ...consolidationCandidatesForDomain('persona', snapshot.localPersonas),
    ...consolidationCandidatesForDomain('skill', snapshot.localSkills),
    ...consolidationCandidatesForDomain('routine', snapshot.localRoutines),
    ...workPlanCompletionCandidates(context),
    ...researchRunCompletionCandidates(context),
    ...sessionCompletionCandidates(context),
    ...vibeHealthCandidates(context),
  ];
  if (candidates.length === 0) candidates.push(captureCandidate());
  return candidates.sort((left, right) => right.priority - left.priority || left.label.localeCompare(right.label));
}

function describeCandidate(candidate: LearningCandidate, includeParameters: boolean, lookup?: Record<string, unknown>): Record<string, unknown> {
  return {
    candidateId: candidate.id,
    label: candidate.label,
    domain: candidate.domain,
    recordId: candidate.recordId,
    status: candidate.status,
    priority: candidate.priority,
    reason: previewHarnessText(candidate.reason, includeParameters ? 180 : 96),
    next: previewHarnessText(candidate.next, includeParameters ? 180 : 96),
    scores: candidate.scores,
    ...(candidate.reviewState ? { reviewState: candidate.reviewState } : {}),
    ...(candidate.enabled === undefined ? {} : { enabled: candidate.enabled }),
    ...(candidate.active === undefined ? {} : { active: candidate.active }),
    ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }),
    ...(candidate.proposalTarget === undefined ? {} : { proposalTarget: candidate.proposalTarget }),
    ...(includeParameters && candidate.proposalFields ? { proposalFields: candidate.proposalFields } : {}),
    ...(candidate.missingRequirements ? { missingRequirements: candidate.missingRequirements } : {}),
    modelRoute: candidate.modelRoute,
    inspectRoute: candidate.inspectRoute,
    ...(candidate.reviewRoute ? { reviewRoute: candidate.reviewRoute } : {}),
    ...(candidate.staleRoute ? { staleRoute: candidate.staleRoute } : {}),
    ...(candidate.updateRoute ? { updateRoute: candidate.updateRoute } : {}),
    ...(candidate.createRoute ? { createRoute: candidate.createRoute } : {}),
    ...(candidate.deleteRoute ? { deleteRoute: candidate.deleteRoute } : {}),
    ...(includeParameters && candidate.cleanupRoutes ? { cleanupRoutes: candidate.cleanupRoutes } : {}),
    ...(includeParameters && candidate.rollbackRoutes ? { rollbackRoutes: candidate.rollbackRoutes } : {}),
    ...(includeParameters && candidate.consolidation ? { consolidation: candidate.consolidation } : {}),
    ...(lookup ? { lookup } : {}),
    ...(includeParameters ? {
      routes: {
        inspect: candidate.inspectRoute,
        model: candidate.modelRoute,
        review: candidate.reviewRoute ?? null,
        stale: candidate.staleRoute ?? null,
        update: candidate.updateRoute ?? null,
        apply: candidate.consolidation ? `agent_learning_consolidation mode=preview candidateId:"${routeValue(candidate.id)}"` : null,
        merge: candidate.consolidation ? `agent_learning_consolidation mode=merge candidateId:"${routeValue(candidate.id)}" confirm:true explicitUserRequest:"..."` : null,
        stalePhase: candidate.consolidation ? `agent_learning_consolidation mode=stale candidateId:"${routeValue(candidate.id)}" confirm:true explicitUserRequest:"..."` : null,
        deletePhase: candidate.consolidation ? `agent_learning_consolidation mode=delete candidateId:"${routeValue(candidate.id)}" confirm:true explicitUserRequest:"..."` : null,
        create: candidate.createRoute ?? null,
        delete: candidate.deleteRoute ?? null,
      },
      policy: 'Learning curator rows are read-only. VIBE.md personality issues route to existing /vibe inspection/init/import commands. Duplicate consolidation phases use agent_learning_consolidation with confirmation, while create, review, promote, enable, schedule, and non-batch local effects stay on existing confirmed routes.',
    } : {}),
  };
}

function learningConsolidationBatchPlan(
  candidates: readonly LearningCandidate[],
  includeParameters: boolean,
): LearningConsolidationBatchPlan | undefined {
  const consolidationCandidates = candidates.filter((candidate) => candidate.consolidation !== undefined);
  if (consolidationCandidates.length === 0) return undefined;
  const domainCounts = new Map<string, { candidates: number; duplicateRecords: number }>();
  for (const candidate of consolidationCandidates) {
    const duplicateRecords = candidate.consolidation?.duplicateIds.length ?? 0;
    const current = domainCounts.get(candidate.domain) ?? { candidates: 0, duplicateRecords: 0 };
    current.candidates += 1;
    current.duplicateRecords += duplicateRecords;
    domainCounts.set(candidate.domain, current);
  }
  const domains = [...domainCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([domain, counts]) => ({ domain, ...counts }));
  const topCandidates = consolidationCandidates.slice(0, 8).map((candidate) => {
    const consolidation = candidate.consolidation!;
    return {
      candidateId: candidate.id,
      label: candidate.label,
      domain: candidate.domain,
      survivorId: consolidation.survivorId,
      duplicateCount: consolidation.duplicateIds.length,
      ...(includeParameters ? { duplicateIds: consolidation.duplicateIds } : {}),
      diffFields: consolidation.diffs.map((diff) => diff.field),
      detailRoute: `memory action:"candidate" candidateId:"${routeValue(candidate.id)}"`,
      ...(candidate.updateRoute ? { updateRoute: candidate.updateRoute } : {}),
      applyRoute: `agent_learning_consolidation mode=preview candidateId:"${routeValue(candidate.id)}"`,
      mergeRoute: `agent_learning_consolidation mode=merge candidateId:"${routeValue(candidate.id)}" confirm:true explicitUserRequest:"..."`,
      stalePhaseRoute: `agent_learning_consolidation mode=stale candidateId:"${routeValue(candidate.id)}" confirm:true explicitUserRequest:"..."`,
      deletePhaseRoute: `agent_learning_consolidation mode=delete candidateId:"${routeValue(candidate.id)}" confirm:true explicitUserRequest:"..."`,
      ...(candidate.staleRoute ? { staleRoute: candidate.staleRoute } : {}),
      ...(candidate.deleteRoute ? { deleteRoute: candidate.deleteRoute } : {}),
      ...(includeParameters ? {
        staleRoutes: consolidation.staleRoutes,
        deleteRoutes: consolidation.deleteRoutes,
        rollbackRoutes: consolidation.rollbackRoutes,
      } : {}),
    };
  });
  return {
    status: 'ready',
    candidates: consolidationCandidates.length,
    duplicateRecords: consolidationCandidates.reduce((total, candidate) => total + (candidate.consolidation?.duplicateIds.length ?? 0), 0),
    domains,
    routes: {
      reviewQueue: 'memory action:"curator" query:"consolidation" includeParameters:true',
      candidateDetail: 'memory action:"candidate" candidateId:"<candidateId>"',
      survivorRecord: 'agent_local_registry domain:"<domain>" action:"get" id:"<survivorId>"',
    },
    phases: [
      {
        id: 'inspect',
        label: 'Inspect every duplicate group',
        goal: 'Open the candidate detail and survivor/duplicate records before changing durable context.',
        route: 'memory action:"curator" query:"consolidation" includeParameters:true',
      },
      {
        id: 'merge-survivor',
        label: 'Merge visible survivor fields',
        goal: 'Apply the survivor update route only when the visible diffs preserve useful names, descriptions, tags, and triggers.',
        route: 'Use each topCandidates[].mergeRoute after explicit approval.',
      },
      {
        id: 'stale-duplicates',
        label: 'Stage duplicates as stale',
        goal: 'Mark duplicates stale before deleting them so rollback remains one reviewed route away.',
        route: 'Use each topCandidates[].stalePhaseRoute after explicit approval.',
      },
      {
        id: 'verify',
        label: 'Verify prompt impact and rollback',
        goal: 'Re-run the curator, check the survivor, and keep rollback routes visible until the user accepts the result.',
        route: 'memory action:"curator" query:"consolidation" includeParameters:true',
      },
      {
        id: 'delete-after-approval',
        label: 'Delete only after explicit approval',
        goal: 'Use delete routes only after the user confirms the stale duplicates are no longer needed.',
        route: 'Use each topCandidates[].deletePhaseRoute only after the stale phase has already run.',
      },
    ],
    topCandidates,
    policy: 'This is an ordered review plan. Use agent_learning_consolidation to preview or apply one confirmed candidate phase; low-level Agent-local routes remain visible for inspection and recovery.',
  };
}

function nextActions(candidates: readonly LearningCandidate[]): readonly string[] {
  return candidates
    .filter((candidate) => candidate.status !== 'ready')
    .slice(0, 5)
    .map((candidate) => `${candidate.label}: ${candidate.next}`);
}

function promptPlanCandidate(candidate: LearningCandidate, includeParameters: boolean): Record<string, unknown> {
  return {
    candidateId: candidate.id,
    label: candidate.label,
    domain: candidate.domain,
    status: candidate.status,
    priority: candidate.priority,
    scores: candidate.scores,
    reason: previewHarnessText(candidate.reason, includeParameters ? 160 : 96),
    next: previewHarnessText(candidate.next, includeParameters ? 160 : 96),
    inspectRoute: candidate.inspectRoute,
    ...(candidate.reviewRoute ? { reviewRoute: candidate.reviewRoute } : {}),
    ...(candidate.createRoute ? { createRoute: candidate.createRoute } : {}),
    ...(candidate.updateRoute ? { updateRoute: candidate.updateRoute } : {}),
  };
}

function promptRecordPriority(item: AgentWorkspaceLocalLibraryItem): number {
  const scores = scoresForItem(item);
  return clampScore((scores.usefulness * 0.35) + (scores.freshness * 0.25) + (scores.sourceQuality * 0.30) - (scores.risk * 0.25));
}

function isPromptEligibleRecord(domain: LocalLearningCandidateDomain, item: AgentWorkspaceLocalLibraryItem): boolean {
  if (!isReviewed(item)) return false;
  if (domain === 'memory') return (item.confidence ?? 100) >= 70;
  if (domain === 'persona') return item.active === true;
  if (domain === 'skill' || domain === 'skill_bundle' || domain === 'routine') {
    return item.enabled === true && missingRequirementCount(item) === 0;
  }
  return false;
}

function promptRecordEntry(domain: LocalLearningCandidateDomain, item: AgentWorkspaceLocalLibraryItem, includeParameters: boolean): Record<string, unknown> {
  return {
    id: `${domain}:${item.id}`,
    label: item.name,
    domain,
    recordId: item.id,
    priority: promptRecordPriority(item),
    scores: scoresForItem(item),
    reason: domain === 'memory'
      ? 'Reviewed high-confidence memory is eligible for prompt recall.'
      : domain === 'persona'
        ? 'Reviewed active persona is eligible for prompt personality context.'
        : 'Reviewed, enabled, setup-ready behavior is eligible for prompt context.',
    inspectRoute: localRegistryRoute(domain, 'get', item.id),
    ...(includeParameters ? {
      reviewState: item.reviewState,
      confidence: item.confidence ?? null,
      enabled: item.enabled ?? null,
      active: item.active ?? null,
      missingRequirementCount: missingRequirementCount(item),
      tags: item.tags,
    } : {}),
  };
}

function promptEligibleRecords(context: CommandContext, includeParameters: boolean): readonly Record<string, unknown>[] {
  const snapshot = buildAgentWorkspaceRuntimeSnapshot(context);
  const records = [
    ...snapshot.localMemories
      .filter((item) => isPromptEligibleRecord('memory', item))
      .map((item) => promptRecordEntry('memory', item, includeParameters)),
    ...snapshot.localPersonas
      .filter((item) => isPromptEligibleRecord('persona', item))
      .map((item) => promptRecordEntry('persona', item, includeParameters)),
    ...snapshot.localSkills
      .filter((item) => isPromptEligibleRecord('skill', item))
      .map((item) => promptRecordEntry('skill', item, includeParameters)),
    ...snapshot.localSkillBundles
      .filter((item) => isPromptEligibleRecord('skill_bundle', item))
      .map((item) => promptRecordEntry('skill_bundle', item, includeParameters)),
    ...snapshot.localRoutines
      .filter((item) => isPromptEligibleRecord('routine', item))
      .map((item) => promptRecordEntry('routine', item, includeParameters)),
  ];
  return records.sort((left, right) => {
    const leftPriority = typeof left.priority === 'number' ? left.priority : 0;
    const rightPriority = typeof right.priority === 'number' ? right.priority : 0;
    if (rightPriority !== leftPriority) return rightPriority - leftPriority;
    return String(left.label ?? '').localeCompare(String(right.label ?? ''));
  });
}

function learningPromptPlan(context: CommandContext, candidates: readonly LearningCandidate[], includeParameters: boolean): LearningPromptPlan {
  const promptActiveRecords = promptEligibleRecords(context, includeParameters);
  const reviewFirstCandidates = candidates.filter((candidate) => (
    candidate.status === 'needs-review'
    || candidate.status === 'low-confidence'
    || candidate.status === 'needs-setup'
    || candidate.status === 'needs-consolidation'
  ));
  const proposalCandidates = candidates.filter((candidate) => candidate.status === 'proposal-ready' || candidate.status === 'ready-to-promote');
  const consolidationCandidates = candidates.filter((candidate) => candidate.status === 'needs-consolidation');
  const suppressed = {
    needsReview: candidates.filter((candidate) => candidate.status === 'needs-review').length,
    needsSetup: candidates.filter((candidate) => candidate.status === 'needs-setup').length,
    lowConfidence: candidates.filter((candidate) => candidate.status === 'low-confidence').length,
    personalityIssues: candidates.filter((candidate) => candidate.domain === 'vibe').length,
    needsConsolidation: consolidationCandidates.length,
  };
  const suppressedCount = Object.values(suppressed).reduce((total, count) => total + count, 0);
  const status = promptActiveRecords.length === 0 && candidates.length === 0
    ? 'empty'
    : suppressedCount > 0 || proposalCandidates.length > 0
      ? 'attention'
      : 'ready';
  return {
    status,
    promptActiveCount: promptActiveRecords.length,
    suppressedCount,
    proposalCount: proposalCandidates.length,
    consolidationCount: consolidationCandidates.length,
    promptActiveRecords: promptActiveRecords.slice(0, includeParameters ? 12 : 5),
    reviewFirst: reviewFirstCandidates.slice(0, includeParameters ? 10 : 5).map((candidate) => promptPlanCandidate(candidate, includeParameters)),
    proposalQueue: proposalCandidates.slice(0, includeParameters ? 10 : 5).map((candidate) => promptPlanCandidate(candidate, includeParameters)),
    consolidationQueue: consolidationCandidates.slice(0, includeParameters ? 8 : 3).map((candidate) => promptPlanCandidate(candidate, includeParameters)),
    suppressed,
    orderingRules: [
      'Prompt context stays limited to reviewed high-confidence memory and reviewed setup-ready enabled behavior.',
      'Usefulness, freshness, source-quality, and risk scores drive review priority before durable context expands.',
      'Low-confidence, stale, setup-blocked, unreviewed, blocked VIBE.md, and duplicate records stay suppressed until reviewed or repaired.',
      'Proposals from notes, completed work, completed research, and saved sessions require explicit create or promotion routes before they can guide the assistant.',
    ],
    routes: {
      memoryPosture: 'memory action:"status"',
      curator: 'memory action:"curator" includeParameters:true',
      candidate: 'memory action:"candidate" candidateId:"<candidateId>"',
      consolidation: 'agent_learning_consolidation mode=preview candidateId:"<candidateId>"',
    },
    policy: 'This prompt plan is read-only. It explains what can guide the assistant now, what remains suppressed, and which reviewed route should run before any durable memory, skill, routine, persona, or consolidation change.',
  };
}

export function learningCuratorCatalogStatus(context: CommandContext): Record<string, unknown> {
  const candidates = buildLearningCandidates(context);
  return {
    modes: ['learning_curator', 'learning_candidate'],
    candidates: candidates.length,
    needsReview: candidates.filter((candidate) => candidate.status === 'needs-review').length,
    needsSetup: candidates.filter((candidate) => candidate.status === 'needs-setup').length,
    needsConsolidation: candidates.filter((candidate) => candidate.status === 'needs-consolidation').length,
    lowConfidence: candidates.filter((candidate) => candidate.status === 'low-confidence').length,
    proposedBehavior: candidates.filter((candidate) => candidate.status === 'proposal-ready').length,
    personalityIssues: candidates.filter((candidate) => candidate.domain === 'vibe').length,
    readyToPromote: candidates.filter((candidate) => candidate.status === 'ready-to-promote').length,
    readOnly: true,
  };
}

export function learningCuratorSummary(context: CommandContext, args: AgentHarnessLearningCuratorArgs): Record<string, unknown> {
  const includeParameters = args.includeParameters === true;
  const query = readString(args.query).toLowerCase();
  const limit = readLimit(args.limit, 100);
  const all = buildLearningCandidates(context);
  const filtered = all.filter((candidate) => !query || candidateSearchText(candidate).includes(query));
  const consolidationBatch = learningConsolidationBatchPlan(all, includeParameters);
  return {
    summary: {
      candidates: all.length,
      needsReview: all.filter((candidate) => candidate.status === 'needs-review').length,
      needsSetup: all.filter((candidate) => candidate.status === 'needs-setup').length,
      needsConsolidation: all.filter((candidate) => candidate.status === 'needs-consolidation').length,
      lowConfidence: all.filter((candidate) => candidate.status === 'low-confidence').length,
      proposedBehavior: all.filter((candidate) => candidate.status === 'proposal-ready').length,
      personalityIssues: all.filter((candidate) => candidate.domain === 'vibe').length,
      readyToPromote: all.filter((candidate) => candidate.status === 'ready-to-promote').length,
      ready: all.filter((candidate) => candidate.status === 'ready').length,
    },
    promptPlan: learningPromptPlan(context, all, includeParameters),
    candidates: filtered.slice(0, limit).map((candidate) => describeCandidate(candidate, includeParameters)),
    ...(consolidationBatch ? { consolidationBatch } : {}),
    returned: Math.min(filtered.length, limit),
    total: all.length,
    nextActions: nextActions(all),
    policy: 'Learning curator is read-only. Proposed memory and behavior changes use reviewed notes, completed work-plan items, completed research runs, saved sessions, VIBE.md personality health cards, duplicate consolidation, and existing confirmed capture routes; durable context still requires provenance, review, rollback via stale/delete routes, and explicit user intent for writes or promotion.',
  };
}

export type LearningConsolidationCandidateResolution =
  | { readonly status: 'found'; readonly candidate: LearningCandidate }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Pick<LearningCandidate, 'id' | 'label' | 'status' | 'priority'>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

export function resolveLearningConsolidationCandidate(context: CommandContext, input: string): LearningConsolidationCandidateResolution {
  const lookup = input.trim();
  if (!lookup) {
    return {
      status: 'missing_lookup',
      usage: 'candidateId or query is required. Use memory action:"curator" query:"consolidation" to inspect candidate ids.',
    };
  }
  const candidates = buildLearningCandidates(context).filter((candidate) => candidate.consolidation !== undefined);
  const normalized = lookup.toLowerCase();
  const exact = candidates.find((candidate) => candidate.id === lookup)
    ?? candidates.find((candidate) => candidate.id.toLowerCase() === normalized);
  if (exact) return { status: 'found', candidate: exact };
  const matches = candidates.filter((candidate) => candidateSearchText(candidate).includes(normalized));
  if (matches.length === 1) return { status: 'found', candidate: matches[0]! };
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup,
      candidates: matches.slice(0, 8).map((candidate) => ({
        id: candidate.id,
        label: candidate.label,
        status: candidate.status,
        priority: candidate.priority,
      })),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown duplicate-consolidation candidate ${lookup}. Use memory action:"curator" query:"consolidation" to inspect candidate ids.`,
  };
}

export function describeLearningCandidate(context: CommandContext, args: AgentHarnessLearningCuratorArgs): LearningCandidateResolution {
  const candidateId = readString(args.candidateId);
  const target = readString(args.target);
  const query = readString(args.query);
  const input = candidateId || target || query;
  if (!input) {
    return {
      status: 'missing_lookup',
      usage: 'memory action:"candidate" requires candidateId, target, or query. Use memory action:"curator" to inspect candidate ids.',
    };
  }
  const normalized = input.toLowerCase();
  const candidates = buildLearningCandidates(context);
  const exact = candidates.find((candidate) => candidate.id === input);
  if (exact) return { status: 'found', candidate: describeCandidate(exact, true, { source: candidateId ? 'candidateId' : target ? 'target' : 'query', input, resolvedBy: 'id' }) };
  const insensitive = candidates.find((candidate) => candidate.id.toLowerCase() === normalized);
  if (insensitive) return { status: 'found', candidate: describeCandidate(insensitive, true, { source: candidateId ? 'candidateId' : target ? 'target' : 'query', input, resolvedBy: 'case-insensitive-id' }) };
  const matches = candidates.filter((candidate) => candidateSearchText(candidate).includes(normalized));
  if (matches.length === 1) return { status: 'found', candidate: describeCandidate(matches[0]!, true, { source: candidateId ? 'candidateId' : target ? 'target' : 'query', input, resolvedBy: 'search' }) };
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      input,
      candidates: matches.slice(0, 8).map((candidate) => ({
        candidateId: candidate.id,
        label: candidate.label,
        status: candidate.status,
        priority: candidate.priority,
        modelRoute: candidate.modelRoute,
      })),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown learning candidate ${input}. Use memory action:"curator" to inspect candidate ids.`,
  };
}
