import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { MemoryRecord, MemoryRegistry } from '@pellux/goodvibes-sdk/platform/state';
import type { ShellPathService } from '@/runtime/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';
import type { CommandContext } from '../input/command-registry.ts';
import { AgentPersonaRegistry, type AgentPersonaRecord } from '../agent/persona-registry.ts';
import { AgentRoutineRegistry, type AgentRoutineRecord } from '../agent/routine-registry.ts';
import { AgentSkillRegistry, type AgentSkillRecord } from '../agent/skill-registry.ts';
import {
  resolveLearningConsolidationCandidate,
  type LearningCandidate,
  type LearningConsolidationFields,
} from './agent-harness-learning-curator.ts';

type AgentLearningConsolidationMode = 'preview' | 'merge' | 'stale' | 'delete' | 'rollback' | 'receipts';
type AgentLearningConsolidationDomain = 'memory' | 'persona' | 'skill' | 'routine';
type AgentLearningConsolidationWriteMode = 'merge' | 'stale' | 'delete' | 'rollback';

interface AgentLearningConsolidationToolArgs {
  readonly mode?: unknown;
  readonly candidateId?: unknown;
  readonly query?: unknown;
  readonly receiptId?: unknown;
  readonly limit?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

interface LearningConsolidationReceipt {
  readonly id: string;
  readonly createdAt: string;
  readonly domain: AgentLearningConsolidationDomain;
  readonly candidateId: string;
  readonly phase: AgentLearningConsolidationWriteMode;
  readonly explicitUserRequest: string;
  readonly survivorId: string;
  readonly duplicateIds: readonly string[];
  readonly beforeSurvivor?: Record<string, unknown>;
  readonly beforeDuplicates: readonly Record<string, unknown>[];
}

interface LearningConsolidationReceiptFile {
  readonly version: 1;
  readonly receipts: readonly LearningConsolidationReceipt[];
}

const MODES: readonly AgentLearningConsolidationMode[] = ['preview', 'merge', 'stale', 'delete', 'rollback', 'receipts'];
const WRITE_MODES = new Set<AgentLearningConsolidationMode>(['merge', 'stale', 'delete', 'rollback']);
const RECEIPT_LIMIT = 100;

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readMode(value: unknown): AgentLearningConsolidationMode {
  return typeof value === 'string' && MODES.includes(value as AgentLearningConsolidationMode)
    ? value as AgentLearningConsolidationMode
    : 'preview';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(RECEIPT_LIMIT, Math.trunc(parsed)));
}

function output(value: unknown): { readonly success: true; readonly output: string } {
  return { success: true, output: JSON.stringify(value, null, 2) };
}

function failure(error: string): { readonly success: false; readonly error: string } {
  return { success: false, error };
}

function requireConfirmedWrite(args: AgentLearningConsolidationToolArgs, mode: AgentLearningConsolidationWriteMode): string {
  const explicitUserRequest = readString(args.explicitUserRequest);
  if (!explicitUserRequest) throw new Error(`${mode} requires explicitUserRequest with the user's exact request or a short faithful summary.`);
  if (args.confirm !== true) throw new Error(`${mode} requires confirm:true after an explicit user request.`);
  return explicitUserRequest;
}

function isDomain(value: string): value is AgentLearningConsolidationDomain {
  return value === 'memory' || value === 'persona' || value === 'skill' || value === 'routine';
}

function receiptPath(shellPaths: ShellPathService): string {
  return shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'learning', 'consolidation-receipts.json');
}

function parseReceipt(value: unknown): LearningConsolidationReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = readString(record.id);
  const createdAt = readString(record.createdAt);
  const domain = readString(record.domain);
  const candidateId = readString(record.candidateId);
  const phase = readString(record.phase);
  const explicitUserRequest = readString(record.explicitUserRequest);
  const survivorId = readString(record.survivorId);
  const duplicateIds = Array.isArray(record.duplicateIds)
    ? record.duplicateIds.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const beforeDuplicates = Array.isArray(record.beforeDuplicates)
    ? record.beforeDuplicates.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    : [];
  if (
    !id
    || !createdAt
    || !isDomain(domain)
    || !candidateId
    || !['merge', 'stale', 'delete', 'rollback'].includes(phase)
    || !explicitUserRequest
    || !survivorId
  ) return null;
  const beforeSurvivor = typeof record.beforeSurvivor === 'object' && record.beforeSurvivor !== null && !Array.isArray(record.beforeSurvivor)
    ? record.beforeSurvivor as Record<string, unknown>
    : undefined;
  return {
    id,
    createdAt,
    domain,
    candidateId,
    phase: phase as AgentLearningConsolidationWriteMode,
    explicitUserRequest,
    survivorId,
    duplicateIds,
    ...(beforeSurvivor ? { beforeSurvivor } : {}),
    beforeDuplicates,
  };
}

function readReceiptFile(shellPaths: ShellPathService): LearningConsolidationReceiptFile {
  const path = receiptPath(shellPaths);
  if (!existsSync(path)) return { version: 1, receipts: [] };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { version: 1, receipts: [] };
    const receipts = Array.isArray((parsed as Record<string, unknown>).receipts)
      ? ((parsed as Record<string, unknown>).receipts as unknown[]).map(parseReceipt).filter((entry): entry is LearningConsolidationReceipt => entry !== null)
      : [];
    return { version: 1, receipts };
  } catch {
    return { version: 1, receipts: [] };
  }
}

function writeReceipt(shellPaths: ShellPathService, receipt: LearningConsolidationReceipt): void {
  const path = receiptPath(shellPaths);
  const current = readReceiptFile(shellPaths).receipts;
  const next: LearningConsolidationReceiptFile = {
    version: 1,
    receipts: [receipt, ...current.filter((entry) => entry.id !== receipt.id)].slice(0, RECEIPT_LIMIT),
  };
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  renameSync(tmpPath, path);
}

function receiptId(candidate: LearningCandidate, phase: AgentLearningConsolidationWriteMode): string {
  const slug = candidate.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'candidate';
  return `lcon-${phase}-${Date.now().toString(36)}-${slug}`;
}

function minimalContext(shellPaths: ShellPathService, memoryRegistry: MemoryRegistry): CommandContext {
  return {
    workspace: { shellPaths },
    clients: { agentKnowledgeApi: { memory: memoryRegistry } },
  } as unknown as CommandContext;
}

function resolveCandidate(
  shellPaths: ShellPathService,
  memoryRegistry: MemoryRegistry,
  args: AgentLearningConsolidationToolArgs,
): LearningCandidate {
  const input = readString(args.candidateId) || readString(args.query);
  const resolved = resolveLearningConsolidationCandidate(minimalContext(shellPaths, memoryRegistry), input);
  if (resolved.status === 'found') return resolved.candidate;
  if (resolved.status === 'ambiguous') {
    throw new Error(`Ambiguous learning consolidation candidate ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
  }
  throw new Error(resolved.usage);
}

function domainForCandidate(candidate: LearningCandidate): AgentLearningConsolidationDomain {
  const domain = String(candidate.domain);
  if (!isDomain(domain)) throw new Error(`Candidate ${candidate.id} is not an applyable consolidation domain.`);
  return domain;
}

function cloneRecord(record: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

function getRecord(
  shellPaths: ShellPathService,
  memoryRegistry: MemoryRegistry,
  domain: AgentLearningConsolidationDomain,
  id: string,
): MemoryRecord | AgentPersonaRecord | AgentSkillRecord | AgentRoutineRecord {
  if (domain === 'memory') {
    const record = memoryRegistry.get(id);
    if (!record) throw new Error(`Unknown Agent-local memory ${id}`);
    return record;
  }
  if (domain === 'persona') {
    const record = AgentPersonaRegistry.fromShellPaths(shellPaths).get(id);
    if (!record) throw new Error(`Unknown Agent-local persona ${id}`);
    return record;
  }
  if (domain === 'skill') {
    const record = AgentSkillRegistry.fromShellPaths(shellPaths).get(id);
    if (!record) throw new Error(`Unknown Agent-local skill ${id}`);
    return record;
  }
  const record = AgentRoutineRegistry.fromShellPaths(shellPaths).get(id);
  if (!record) throw new Error(`Unknown Agent-local routine ${id}`);
  return record;
}

function updateSurvivor(
  shellPaths: ShellPathService,
  memoryRegistry: MemoryRegistry,
  domain: AgentLearningConsolidationDomain,
  survivorId: string,
  fields: LearningConsolidationFields,
): Record<string, unknown> {
  if (domain === 'memory') {
    const record = memoryRegistry.update(survivorId, {
      ...(fields.detail === undefined ? {} : { detail: fields.detail }),
      ...(fields.tags === undefined ? {} : { tags: [...fields.tags] }),
    });
    if (!record) throw new Error(`Unknown Agent-local memory ${survivorId}`);
    return cloneRecord(record);
  }
  if (domain === 'persona') {
    const record = AgentPersonaRegistry.fromShellPaths(shellPaths).update(survivorId, {
      ...(fields.description === undefined ? {} : { description: fields.description }),
      ...(fields.tags === undefined ? {} : { tags: [...fields.tags] }),
      ...(fields.triggers === undefined ? {} : { triggers: [...fields.triggers] }),
      provenance: 'learning-curator-consolidation',
    });
    return cloneRecord(record);
  }
  if (domain === 'skill') {
    const record = AgentSkillRegistry.fromShellPaths(shellPaths).update(survivorId, {
      ...(fields.description === undefined ? {} : { description: fields.description }),
      ...(fields.tags === undefined ? {} : { tags: [...fields.tags] }),
      ...(fields.triggers === undefined ? {} : { triggers: [...fields.triggers] }),
      provenance: 'learning-curator-consolidation',
    });
    return cloneRecord(record);
  }
  const record = AgentRoutineRegistry.fromShellPaths(shellPaths).update(survivorId, {
    ...(fields.description === undefined ? {} : { description: fields.description }),
    ...(fields.tags === undefined ? {} : { tags: [...fields.tags] }),
    ...(fields.triggers === undefined ? {} : { triggers: [...fields.triggers] }),
    provenance: 'learning-curator-consolidation',
  });
  return cloneRecord(record);
}

function markDuplicateStale(
  shellPaths: ShellPathService,
  memoryRegistry: MemoryRegistry,
  domain: AgentLearningConsolidationDomain,
  duplicateId: string,
  survivorId: string,
): Record<string, unknown> {
  const reason = `Duplicate of ${survivorId}; staged by learning curator consolidation.`;
  if (domain === 'memory') {
    const record = memoryRegistry.review(duplicateId, { state: 'stale', staleReason: reason, reviewedBy: 'agent' });
    if (!record) throw new Error(`Unknown Agent-local memory ${duplicateId}`);
    return cloneRecord(record);
  }
  if (domain === 'persona') return cloneRecord(AgentPersonaRegistry.fromShellPaths(shellPaths).markStale(duplicateId, reason));
  if (domain === 'skill') return cloneRecord(AgentSkillRegistry.fromShellPaths(shellPaths).markStale(duplicateId, reason));
  return cloneRecord(AgentRoutineRegistry.fromShellPaths(shellPaths).markStale(duplicateId, reason));
}

function deleteDuplicate(
  shellPaths: ShellPathService,
  memoryRegistry: MemoryRegistry,
  domain: AgentLearningConsolidationDomain,
  duplicateId: string,
): void {
  if (domain === 'memory') {
    if (!memoryRegistry.delete(duplicateId)) throw new Error(`Unknown Agent-local memory ${duplicateId}`);
    return;
  }
  if (domain === 'persona') {
    AgentPersonaRegistry.fromShellPaths(shellPaths).deletePersona(duplicateId);
    return;
  }
  if (domain === 'skill') {
    AgentSkillRegistry.fromShellPaths(shellPaths).deleteSkill(duplicateId);
    return;
  }
  AgentRoutineRegistry.fromShellPaths(shellPaths).deleteRoutine(duplicateId);
}

function arrayField(snapshot: Record<string, unknown>, key: string): string[] {
  const value = snapshot[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function stringField(snapshot: Record<string, unknown>, key: string): string | undefined {
  const value = snapshot[key];
  return typeof value === 'string' ? value : undefined;
}

function restoreReviewState(
  shellPaths: ShellPathService,
  memoryRegistry: MemoryRegistry,
  domain: AgentLearningConsolidationDomain,
  id: string,
  snapshot: Record<string, unknown>,
): void {
  const reviewState = stringField(snapshot, 'reviewState') ?? 'fresh';
  const staleReason = stringField(snapshot, 'staleReason') ?? 'Restored by learning curator rollback.';
  if (domain === 'memory') {
    const confidence = typeof snapshot.confidence === 'number' ? snapshot.confidence : undefined;
    memoryRegistry.review(id, { state: reviewState === 'stale' || reviewState === 'reviewed' || reviewState === 'contradicted' ? reviewState : 'fresh', confidence, staleReason, reviewedBy: 'agent' });
    return;
  }
  if (reviewState === 'reviewed') {
    if (domain === 'persona') AgentPersonaRegistry.fromShellPaths(shellPaths).markReviewed(id);
    else if (domain === 'skill') AgentSkillRegistry.fromShellPaths(shellPaths).markReviewed(id);
    else AgentRoutineRegistry.fromShellPaths(shellPaths).markReviewed(id);
    return;
  }
  if (reviewState === 'stale') {
    if (domain === 'persona') AgentPersonaRegistry.fromShellPaths(shellPaths).markStale(id, staleReason);
    else if (domain === 'skill') AgentSkillRegistry.fromShellPaths(shellPaths).markStale(id, staleReason);
    else AgentRoutineRegistry.fromShellPaths(shellPaths).markStale(id, staleReason);
    return;
  }
  if (domain === 'persona') {
    AgentPersonaRegistry.fromShellPaths(shellPaths).update(id, {
      description: stringField(snapshot, 'description'),
      body: stringField(snapshot, 'body'),
      tags: arrayField(snapshot, 'tags'),
      triggers: arrayField(snapshot, 'triggers'),
      provenance: 'rollback-learning-curator-consolidation',
    });
  } else if (domain === 'skill') {
    AgentSkillRegistry.fromShellPaths(shellPaths).update(id, {
      description: stringField(snapshot, 'description'),
      procedure: stringField(snapshot, 'procedure'),
      tags: arrayField(snapshot, 'tags'),
      triggers: arrayField(snapshot, 'triggers'),
      provenance: 'rollback-learning-curator-consolidation',
    });
  } else {
    AgentRoutineRegistry.fromShellPaths(shellPaths).update(id, {
      description: stringField(snapshot, 'description'),
      steps: stringField(snapshot, 'steps'),
      tags: arrayField(snapshot, 'tags'),
      triggers: arrayField(snapshot, 'triggers'),
      provenance: 'rollback-learning-curator-consolidation',
    });
  }
}

function restoreSurvivor(
  shellPaths: ShellPathService,
  memoryRegistry: MemoryRegistry,
  receipt: LearningConsolidationReceipt,
): Record<string, unknown> {
  const snapshot = receipt.beforeSurvivor;
  if (!snapshot) throw new Error(`Receipt ${receipt.id} has no survivor snapshot.`);
  if (receipt.domain === 'memory') {
    const record = memoryRegistry.update(receipt.survivorId, {
      detail: stringField(snapshot, 'detail') ?? '',
      tags: arrayField(snapshot, 'tags'),
    });
    if (!record) throw new Error(`Unknown Agent-local memory ${receipt.survivorId}`);
    restoreReviewState(shellPaths, memoryRegistry, receipt.domain, receipt.survivorId, snapshot);
    return cloneRecord(memoryRegistry.get(receipt.survivorId));
  }
  updateSurvivor(shellPaths, memoryRegistry, receipt.domain, receipt.survivorId, {
    description: stringField(snapshot, 'description') ?? '',
    tags: arrayField(snapshot, 'tags'),
    triggers: arrayField(snapshot, 'triggers'),
  });
  restoreReviewState(shellPaths, memoryRegistry, receipt.domain, receipt.survivorId, snapshot);
  return cloneRecord(getRecord(shellPaths, memoryRegistry, receipt.domain, receipt.survivorId));
}

function receiptSummary(receipt: LearningConsolidationReceipt): Record<string, unknown> {
  return {
    receiptId: receipt.id,
    createdAt: receipt.createdAt,
    domain: receipt.domain,
    candidateId: receipt.candidateId,
    phase: receipt.phase,
    survivorId: receipt.survivorId,
    duplicateIds: receipt.duplicateIds,
    rollbackRoute: receipt.phase === 'delete'
      ? null
      : `agent_learning_consolidation mode:"rollback" receiptId:"${receipt.id}" confirm:true explicitUserRequest:"..."`,
  };
}

function previewCandidate(candidate: LearningCandidate): Record<string, unknown> {
  const plan = candidate.consolidation;
  if (!plan) throw new Error(`Candidate ${candidate.id} is not a duplicate consolidation candidate.`);
  return {
    status: 'preview',
    candidateId: candidate.id,
    label: candidate.label,
    domain: candidate.domain,
    survivorId: plan.survivorId,
    duplicateIds: plan.duplicateIds,
    diffFields: plan.diffs.map((diff) => diff.field),
    diffs: plan.diffs,
    updateFields: plan.updateFields ?? null,
    phases: [
      {
        id: 'merge',
        route: `agent_learning_consolidation mode:"merge" candidateId:"${candidate.id}" confirm:true explicitUserRequest:"..."`,
        effect: 'Update the survivor with merged visible fields and write a rollback receipt.',
      },
      {
        id: 'stale',
        route: `agent_learning_consolidation mode:"stale" candidateId:"${candidate.id}" confirm:true explicitUserRequest:"..."`,
        effect: 'Mark duplicates stale before deletion and write a rollback receipt.',
      },
      {
        id: 'delete',
        route: `agent_learning_consolidation mode:"delete" candidateId:"${candidate.id}" confirm:true explicitUserRequest:"..."`,
        effect: 'Delete only duplicates that are already stale. Exact-id rollback is not automatic after delete.',
      },
    ],
    inspectRoute: `memory action:"candidate" candidateId:"${candidate.id}"`,
    policy: 'Preview is read-only. Merge, stale, delete, and rollback each require confirm:true plus explicitUserRequest.',
  };
}

function applyMerge(
  shellPaths: ShellPathService,
  memoryRegistry: MemoryRegistry,
  candidate: LearningCandidate,
  explicitUserRequest: string,
): Record<string, unknown> {
  const domain = domainForCandidate(candidate);
  const plan = candidate.consolidation;
  if (!plan?.updateFields) throw new Error(`Candidate ${candidate.id} has no survivor merge fields.`);
  const beforeSurvivor = cloneRecord(getRecord(shellPaths, memoryRegistry, domain, plan.survivorId));
  const afterSurvivor = updateSurvivor(shellPaths, memoryRegistry, domain, plan.survivorId, plan.updateFields);
  const receipt: LearningConsolidationReceipt = {
    id: receiptId(candidate, 'merge'),
    createdAt: new Date().toISOString(),
    domain,
    candidateId: candidate.id,
    phase: 'merge',
    explicitUserRequest,
    survivorId: plan.survivorId,
    duplicateIds: plan.duplicateIds,
    beforeSurvivor,
    beforeDuplicates: [],
  };
  writeReceipt(shellPaths, receipt);
  return {
    status: 'applied',
    phase: 'merge',
    candidateId: candidate.id,
    survivorId: plan.survivorId,
    receipt: receiptSummary(receipt),
    afterSurvivor,
    next: 'Inspect the survivor, then run the stale phase only if the merged fields are correct.',
  };
}

function applyStale(
  shellPaths: ShellPathService,
  memoryRegistry: MemoryRegistry,
  candidate: LearningCandidate,
  explicitUserRequest: string,
): Record<string, unknown> {
  const domain = domainForCandidate(candidate);
  const plan = candidate.consolidation;
  if (!plan) throw new Error(`Candidate ${candidate.id} is not a duplicate consolidation candidate.`);
  const beforeDuplicates = plan.duplicateIds.map((id) => cloneRecord(getRecord(shellPaths, memoryRegistry, domain, id)));
  const afterDuplicates = plan.duplicateIds.map((id) => markDuplicateStale(shellPaths, memoryRegistry, domain, id, plan.survivorId));
  const receipt: LearningConsolidationReceipt = {
    id: receiptId(candidate, 'stale'),
    createdAt: new Date().toISOString(),
    domain,
    candidateId: candidate.id,
    phase: 'stale',
    explicitUserRequest,
    survivorId: plan.survivorId,
    duplicateIds: plan.duplicateIds,
    beforeDuplicates,
  };
  writeReceipt(shellPaths, receipt);
  return {
    status: 'applied',
    phase: 'stale',
    candidateId: candidate.id,
    survivorId: plan.survivorId,
    duplicateIds: plan.duplicateIds,
    receipt: receiptSummary(receipt),
    afterDuplicates,
    next: 'Re-run the curator and delete only if the user confirms the stale duplicates are no longer needed.',
  };
}

function applyDelete(
  shellPaths: ShellPathService,
  memoryRegistry: MemoryRegistry,
  candidate: LearningCandidate,
  explicitUserRequest: string,
): Record<string, unknown> {
  const domain = domainForCandidate(candidate);
  const plan = candidate.consolidation;
  if (!plan) throw new Error(`Candidate ${candidate.id} is not a duplicate consolidation candidate.`);
  const beforeDuplicates = plan.duplicateIds.map((id) => cloneRecord(getRecord(shellPaths, memoryRegistry, domain, id)));
  const unstaled = beforeDuplicates.filter((record) => record.reviewState !== 'stale').map((record) => String(record.id ?? '(unknown)'));
  if (unstaled.length > 0) {
    throw new Error(`Delete refused. Stage duplicates stale first: ${unstaled.join(', ')}.`);
  }
  if (domain === 'skill') {
    const bundles = AgentSkillRegistry.fromShellPaths(shellPaths).snapshot().bundles;
    const references = plan.duplicateIds.flatMap((duplicateId) => (
      bundles
        .filter((bundle) => bundle.skillIds.includes(duplicateId))
        .map((bundle) => `${duplicateId} in ${bundle.id}`)
    ));
    if (references.length > 0) {
      throw new Error(`Delete refused. Duplicate skill records are still referenced by bundles: ${references.join(', ')}. Inspect or update bundles before deleting.`);
    }
  }
  for (const id of plan.duplicateIds) deleteDuplicate(shellPaths, memoryRegistry, domain, id);
  const receipt: LearningConsolidationReceipt = {
    id: receiptId(candidate, 'delete'),
    createdAt: new Date().toISOString(),
    domain,
    candidateId: candidate.id,
    phase: 'delete',
    explicitUserRequest,
    survivorId: plan.survivorId,
    duplicateIds: plan.duplicateIds,
    beforeDuplicates,
  };
  writeReceipt(shellPaths, receipt);
  return {
    status: 'applied',
    phase: 'delete',
    candidateId: candidate.id,
    survivorId: plan.survivorId,
    deletedDuplicateIds: plan.duplicateIds,
    receipt: receiptSummary(receipt),
    next: 'Deletion is intentionally last. The receipt stores the deleted record snapshots, but exact-id automatic rollback is not available after delete.',
  };
}

function findReceipt(shellPaths: ShellPathService, args: AgentLearningConsolidationToolArgs): LearningConsolidationReceipt {
  const receiptIdArg = readString(args.receiptId);
  const candidateId = readString(args.candidateId);
  const receipts = readReceiptFile(shellPaths).receipts;
  const receipt = receiptIdArg
    ? receipts.find((entry) => entry.id === receiptIdArg)
    : receipts.find((entry) => entry.candidateId === candidateId && entry.phase !== 'delete');
  if (!receipt) throw new Error(receiptIdArg ? `Unknown learning consolidation receipt ${receiptIdArg}` : 'rollback requires receiptId or candidateId with a non-delete receipt.');
  return receipt;
}

function applyRollback(
  shellPaths: ShellPathService,
  memoryRegistry: MemoryRegistry,
  args: AgentLearningConsolidationToolArgs,
): Record<string, unknown> {
  const receipt = findReceipt(shellPaths, args);
  if (receipt.phase === 'delete') {
    throw new Error(`Receipt ${receipt.id} is from a delete phase. Automatic exact-id rollback is unavailable after delete; inspect the receipt snapshots and recreate records only if the user asks.`);
  }
  if (receipt.phase === 'merge') {
    return {
      status: 'applied',
      phase: 'rollback',
      rollbackOf: receiptSummary(receipt),
      restoredSurvivor: restoreSurvivor(shellPaths, memoryRegistry, receipt),
      next: 'Re-run the learning curator and inspect the candidate before applying another consolidation phase.',
    };
  }
  for (const snapshot of receipt.beforeDuplicates) {
    const id = stringField(snapshot, 'id');
    if (!id) continue;
    restoreReviewState(shellPaths, memoryRegistry, receipt.domain, id, snapshot);
  }
  return {
    status: 'applied',
    phase: 'rollback',
    rollbackOf: receiptSummary(receipt),
    restoredDuplicateIds: receipt.beforeDuplicates.map((snapshot) => stringField(snapshot, 'id')).filter(Boolean),
    next: 'Re-run the learning curator and inspect the candidate before applying another consolidation phase.',
  };
}

export function createAgentLearningConsolidationTool(shellPaths: ShellPathService, memoryRegistry: MemoryRegistry): Tool {
  return {
    definition: {
      name: 'agent_learning_consolidation',
      description: 'Preview or apply one confirmed local duplicate learning phase.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: [...MODES],
            description: 'preview, merge, stale, delete, rollback, or receipts.',
          },
          candidateId: {
            type: 'string',
            description: 'Learning curator duplicate-consolidation candidate id.',
          },
          query: {
            type: 'string',
            description: 'Candidate search text when candidateId is unknown.',
          },
          receiptId: {
            type: 'string',
            description: 'Receipt id for rollback.',
          },
          limit: {
            type: 'number',
            description: 'Receipt list limit.',
          },
          confirm: {
            type: 'boolean',
            description: 'Required true for merge, stale, delete, and rollback.',
          },
          explicitUserRequest: {
            type: 'string',
            description: 'Exact user request or faithful short summary authorizing the phase.',
          },
        },
        required: ['mode'],
        additionalProperties: false,
      },
      sideEffects: ['state'],
    },
    execute: async (rawArgs: unknown) => {
      try {
        const args = rawArgs as AgentLearningConsolidationToolArgs;
        const mode = readMode(args.mode);
        if (mode === 'receipts') {
          return output({
            status: 'receipts',
            path: receiptPath(shellPaths),
            receipts: readReceiptFile(shellPaths).receipts.slice(0, readLimit(args.limit, 20)).map(receiptSummary),
          });
        }
        if (mode === 'rollback') {
          requireConfirmedWrite(args, mode);
          return output(applyRollback(shellPaths, memoryRegistry, args));
        }
        const candidate = resolveCandidate(shellPaths, memoryRegistry, args);
        if (mode === 'preview') return output(previewCandidate(candidate));
        if (!WRITE_MODES.has(mode)) return failure(`Unknown mode. Valid values ${MODES.join(', ')}.`);
        const explicitUserRequest = requireConfirmedWrite(args, mode);
        if (mode === 'merge') return output(applyMerge(shellPaths, memoryRegistry, candidate, explicitUserRequest));
        if (mode === 'stale') return output(applyStale(shellPaths, memoryRegistry, candidate, explicitUserRequest));
        return output(applyDelete(shellPaths, memoryRegistry, candidate, explicitUserRequest));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function registerAgentLearningConsolidationTool(
  registry: ToolRegistry,
  shellPaths: ShellPathService,
  memoryRegistry: MemoryRegistry,
): void {
  registry.register(createAgentLearningConsolidationTool(shellPaths, memoryRegistry));
}
