import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type { MemoryRecord, MemoryRegistry } from '@pellux/goodvibes-sdk/platform/state';
import { getTierForContextWindow, getTierPromptSupplement } from '@pellux/goodvibes-sdk/platform/providers';
import type { ShellPathService } from '@/runtime/index.ts';
import { buildReviewedMemoryPrompt, isPromptActiveMemory, MIN_PROMPT_MEMORY_CONFIDENCE } from './memory-prompt.ts';
import { AgentPersonaRegistry, buildActivePersonaPrompt } from './persona-registry.ts';
import { buildProjectContextPrompt, discoverProjectContextFiles } from './project-context-files.ts';
import { AgentRoutineRegistry, buildEnabledRoutinesPrompt, evaluateAgentRoutineReadiness } from './routine-registry.ts';
import { AgentSkillRegistry, buildEnabledSkillsPrompt, evaluateAgentSkillBundleReadiness, evaluateAgentSkillReadiness } from './skill-registry.ts';
import { buildVibePrompt, discoverVibeFiles } from './vibe-file.ts';

export type PromptContextReceiptStatus = 'active' | 'attention' | 'empty' | 'unavailable';
export type PromptContextReceiptSource = 'turn' | 'follow_up' | 'manual';
export type PromptContextTurnOutcomeStatus = 'completed' | 'error' | 'cancelled';
export type PromptContextTurnTerminalEvent = 'TURN_COMPLETED' | 'TURN_ERROR' | 'TURN_CANCEL';

export interface PromptContextTurnOutcome {
  readonly turnId: string;
  readonly status: PromptContextTurnOutcomeStatus;
  readonly terminalEvent: PromptContextTurnTerminalEvent;
  readonly stopReason: string;
  readonly completedAt: number;
  readonly receiptIds: readonly string[];
  readonly detail?: string;
}

export interface PromptContextReceiptSegment {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly status: PromptContextReceiptStatus;
  readonly activeCount: number;
  readonly suppressedCount: number;
  readonly promptChars: number;
  readonly approxTokens: number;
  readonly selected?: readonly Record<string, unknown>[];
  readonly suppressed?: readonly Record<string, unknown>[];
  readonly note?: string;
}

export interface PromptContextReceiptDraft {
  readonly sessionId: string;
  readonly turnId: string | null;
  readonly source: PromptContextReceiptSource;
  readonly provider: string;
  readonly model: string;
  readonly contextWindow: number;
  readonly promptHash: string;
  readonly promptChars: number;
  readonly approxPromptTokens: number;
  readonly activeRecords: number;
  readonly suppressedRecords: number;
  readonly segments: readonly PromptContextReceiptSegment[];
}

export interface PromptContextReceipt extends PromptContextReceiptDraft {
  readonly receiptId: string;
  readonly createdAt: number;
  readonly sequence: number;
  readonly turnOutcome?: PromptContextTurnOutcome;
}

export interface RuntimePromptCompositionInput {
  readonly sessionId: string;
  readonly turnId?: string | null;
  readonly source?: PromptContextReceiptSource;
  readonly provider: string;
  readonly model: unknown;
  readonly contextWindow: number;
  readonly runtimePrompt: string;
  readonly operatorPolicy: string;
  readonly shellPaths: ShellPathService;
  readonly memoryRegistry: MemoryRegistry;
}

const RECEIPT_STORE_LIMIT = 200;
const OUTCOME_DETAIL_LIMIT = 240;

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function approxTokensForChars(chars: number): number {
  return Math.ceil(chars / 4);
}

function promptHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function compactOutcomeDetail(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.length > OUTCOME_DETAIL_LIMIT ? `${trimmed.slice(0, OUTCOME_DETAIL_LIMIT - 3)}...` : trimmed;
}

function joinPromptParts(...parts: Array<string | null | undefined>): string {
  return parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part)).join('\n\n');
}

function modelLabel(model: unknown): string {
  if (typeof model === 'string' && model.trim()) return model.trim();
  if (typeof model === 'object' && model !== null) {
    const candidate = model as { readonly registryKey?: unknown; readonly id?: unknown; readonly modelId?: unknown };
    for (const value of [candidate.registryKey, candidate.id, candidate.modelId]) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return 'unknown';
}

function statusFor(active: number, suppressed: number): PromptContextReceiptStatus {
  if (suppressed > 0) return 'attention';
  if (active > 0) return 'active';
  return 'empty';
}

function memorySort(left: MemoryRecord, right: MemoryRecord): number {
  if (right.confidence !== left.confidence) return right.confidence - left.confidence;
  return right.updatedAt - left.updatedAt;
}

function receiptSegment(input: Omit<PromptContextReceiptSegment, 'approxTokens'> & { readonly promptText?: string }): PromptContextReceiptSegment {
  const promptChars = input.promptText?.length ?? input.promptChars;
  return {
    id: input.id,
    label: input.label,
    order: input.order,
    status: input.status,
    activeCount: input.activeCount,
    suppressedCount: input.suppressedCount,
    promptChars,
    approxTokens: input.promptText === undefined ? approxTokensForChars(promptChars) : approxTokens(input.promptText),
    ...(input.selected ? { selected: input.selected } : {}),
    ...(input.suppressed ? { suppressed: input.suppressed } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
}

function buildRuntimePromptReceiptSegments(input: RuntimePromptCompositionInput): readonly PromptContextReceiptSegment[] {
  const vibe = discoverVibeFiles(input.shellPaths);
  const vibePrompt = buildVibePrompt(input.shellPaths) ?? '';
  const projectContext = discoverProjectContextFiles(input.shellPaths);
  const projectContextPrompt = buildProjectContextPrompt(input.shellPaths) ?? '';
  const memoryRecords = input.memoryRegistry.getAll();
  const activeMemory = memoryRecords.filter(isPromptActiveMemory).sort(memorySort).slice(0, 10);
  const activeMemoryIds = new Set(activeMemory.map((record) => record.id));
  const suppressedMemory = memoryRecords.filter((record) => !activeMemoryIds.has(record.id));
  const memoryPrompt = buildReviewedMemoryPrompt(input.memoryRegistry) ?? '';
  const routineSnapshot = AgentRoutineRegistry.fromShellPaths(input.shellPaths).snapshot();
  const activeRoutines = routineSnapshot.enabledRoutines.filter((routine) => routine.reviewState === 'reviewed' && evaluateAgentRoutineReadiness(routine).ready);
  const suppressedRoutines = routineSnapshot.enabledRoutines.filter((routine) => !activeRoutines.some((active) => active.id === routine.id));
  const routinePrompt = buildEnabledRoutinesPrompt(input.shellPaths) ?? '';
  const skillSnapshot = AgentSkillRegistry.fromShellPaths(input.shellPaths).snapshot();
  const activeBundles = skillSnapshot.enabledBundles.filter((bundle) => {
    if (bundle.reviewState !== 'reviewed') return false;
    const readiness = evaluateAgentSkillBundleReadiness(bundle, skillSnapshot.skills);
    return readiness.ready && readiness.includedSkills.every((skill) => skill.reviewState === 'reviewed');
  });
  const activeSkillIds = new Set([
    ...skillSnapshot.enabledSkills.map((skill) => skill.id),
    ...activeBundles.flatMap((bundle) => bundle.skillIds),
  ]);
  const activeSkills = skillSnapshot.skills.filter((skill) => activeSkillIds.has(skill.id) && skill.reviewState === 'reviewed' && evaluateAgentSkillReadiness(skill).ready);
  const candidateSkillIds = new Set([
    ...skillSnapshot.enabledSkills.map((skill) => skill.id),
    ...skillSnapshot.enabledBundles.flatMap((bundle) => bundle.skillIds),
  ]);
  const suppressedSkills = skillSnapshot.skills.filter((skill) => candidateSkillIds.has(skill.id) && !activeSkills.some((active) => active.id === skill.id));
  const suppressedBundles = skillSnapshot.enabledBundles.filter((bundle) => !activeBundles.some((active) => active.id === bundle.id));
  const skillPrompt = buildEnabledSkillsPrompt(input.shellPaths) ?? '';
  const personaSnapshot = AgentPersonaRegistry.fromShellPaths(input.shellPaths).snapshot();
  const activePersona = personaSnapshot.activePersona;
  const personaPrompt = buildActivePersonaPrompt(input.shellPaths) ?? '';
  const tier = getTierForContextWindow(input.contextWindow);
  const tierPrompt = getTierPromptSupplement(tier);

  return [
    receiptSegment({
      id: 'base_system_prompt',
      label: 'Base system prompt',
      order: 1,
      status: input.runtimePrompt ? 'active' : 'empty',
      activeCount: input.runtimePrompt ? 1 : 0,
      suppressedCount: 0,
      promptChars: input.runtimePrompt.length,
      promptText: input.runtimePrompt,
    }),
    receiptSegment({
      id: 'vibe',
      label: 'VIBE.md personality',
      order: 2,
      status: statusFor(vibe.files.length, vibe.blocked.length + vibe.files.filter((file) => file.truncated).length),
      activeCount: vibe.files.length,
      suppressedCount: vibe.blocked.length,
      promptChars: vibePrompt.length,
      promptText: vibePrompt,
      selected: vibe.files.map((file) => ({ path: file.path, scope: file.scope, truncated: file.truncated })),
      suppressed: vibe.blocked.map((file) => ({ path: file.path, scope: file.scope, reason: file.reason })),
    }),
    receiptSegment({
      id: 'project_context',
      label: 'Project context files',
      order: 3,
      status: statusFor(projectContext.files.length, projectContext.blocked.length + projectContext.files.filter((file) => file.truncated).length),
      activeCount: projectContext.files.length,
      suppressedCount: projectContext.blocked.length,
      promptChars: projectContextPrompt.length,
      promptText: projectContextPrompt,
      selected: projectContext.files.map((file) => ({ id: file.id, source: file.source, scope: file.scope, truncated: file.truncated })),
      suppressed: projectContext.blocked.map((file) => ({ id: file.id, source: file.source, reason: file.reason })),
    }),
    receiptSegment({
      id: 'operator_policy',
      label: 'GoodVibes Agent operator policy',
      order: 4,
      status: input.operatorPolicy ? 'active' : 'empty',
      activeCount: input.operatorPolicy ? 1 : 0,
      suppressedCount: 0,
      promptChars: input.operatorPolicy.length,
      promptText: input.operatorPolicy,
    }),
    receiptSegment({
      id: 'memory',
      label: 'Reviewed memory',
      order: 5,
      status: statusFor(activeMemory.length, suppressedMemory.length),
      activeCount: activeMemory.length,
      suppressedCount: suppressedMemory.length,
      promptChars: memoryPrompt.length,
      promptText: memoryPrompt,
      selected: activeMemory.map((record) => ({ id: record.id, scope: record.scope, class: record.cls, confidence: record.confidence })),
      suppressed: suppressedMemory.slice(0, 12).map((record) => ({
        id: record.id,
        reviewState: record.reviewState,
        confidence: record.confidence,
        reason: record.reviewState !== 'reviewed'
          ? 'not reviewed'
          : record.confidence < MIN_PROMPT_MEMORY_CONFIDENCE
            ? `confidence below ${MIN_PROMPT_MEMORY_CONFIDENCE}`
            : 'outside prompt limit',
      })),
    }),
    receiptSegment({
      id: 'routines',
      label: 'Reviewed setup-ready routines',
      order: 6,
      status: statusFor(activeRoutines.length, suppressedRoutines.length),
      activeCount: activeRoutines.length,
      suppressedCount: suppressedRoutines.length,
      promptChars: routinePrompt.length,
      promptText: routinePrompt,
      selected: activeRoutines.map((routine) => ({ id: routine.id, name: routine.name })),
      suppressed: suppressedRoutines.slice(0, 12).map((routine) => ({
        id: routine.id,
        reviewState: routine.reviewState,
        missingRequirements: evaluateAgentRoutineReadiness(routine).missing.length,
      })),
    }),
    receiptSegment({
      id: 'skills',
      label: 'Reviewed setup-ready skills and bundles',
      order: 7,
      status: statusFor(activeSkills.length + activeBundles.length, suppressedSkills.length + suppressedBundles.length),
      activeCount: activeSkills.length + activeBundles.length,
      suppressedCount: suppressedSkills.length + suppressedBundles.length,
      promptChars: skillPrompt.length,
      promptText: skillPrompt,
      selected: [
        ...activeBundles.map((bundle) => ({ id: bundle.id, domain: 'skill_bundle', name: bundle.name })),
        ...activeSkills.map((skill) => ({ id: skill.id, domain: 'skill', name: skill.name })),
      ],
      suppressed: [
        ...suppressedBundles.slice(0, 6).map((bundle) => ({ id: bundle.id, domain: 'skill_bundle', reviewState: bundle.reviewState })),
        ...suppressedSkills.slice(0, 12).map((skill) => ({
          id: skill.id,
          domain: 'skill',
          reviewState: skill.reviewState,
          missingRequirements: evaluateAgentSkillReadiness(skill).missing.length,
        })),
      ],
    }),
    receiptSegment({
      id: 'persona',
      label: 'Active persona',
      order: 8,
      status: activePersona && activePersona.reviewState !== 'reviewed' ? 'attention' : activePersona ? 'active' : 'empty',
      activeCount: activePersona?.reviewState === 'reviewed' ? 1 : 0,
      suppressedCount: activePersona && activePersona.reviewState !== 'reviewed' ? 1 : 0,
      promptChars: personaPrompt.length,
      promptText: personaPrompt,
      selected: activePersona?.reviewState === 'reviewed' ? [{ id: activePersona.id, name: activePersona.name }] : [],
      suppressed: activePersona && activePersona.reviewState !== 'reviewed' ? [{ id: activePersona.id, name: activePersona.name, reviewState: activePersona.reviewState }] : [],
    }),
    receiptSegment({
      id: 'context_window_supplement',
      label: 'Context-window supplement',
      order: 9,
      status: tierPrompt ? 'active' : 'empty',
      activeCount: tierPrompt ? 1 : 0,
      suppressedCount: 0,
      promptChars: tierPrompt.length,
      promptText: tierPrompt,
      note: `Model ${modelLabel(input.model)} has context window ${input.contextWindow}; tier ${tier}.`,
    }),
  ];
}

export function composeRuntimePromptWithReceipt(input: RuntimePromptCompositionInput): { readonly prompt: string; readonly receipt: PromptContextReceiptDraft } {
  const currentModel = modelLabel(input.model);
  const tier = getTierForContextWindow(input.contextWindow);
  const supplement = getTierPromptSupplement(tier);
  const prompt = joinPromptParts(
    input.runtimePrompt,
    buildVibePrompt(input.shellPaths),
    buildProjectContextPrompt(input.shellPaths),
    input.operatorPolicy,
    buildReviewedMemoryPrompt(input.memoryRegistry),
    buildEnabledRoutinesPrompt(input.shellPaths),
    buildEnabledSkillsPrompt(input.shellPaths),
    buildActivePersonaPrompt(input.shellPaths),
    supplement,
  );
  const segments = buildRuntimePromptReceiptSegments(input);
  const activeRecords = segments.reduce((total, segment) => total + segment.activeCount, 0);
  const suppressedRecords = segments.reduce((total, segment) => total + segment.suppressedCount, 0);
  return {
    prompt,
    receipt: {
      sessionId: input.sessionId,
      turnId: input.turnId ?? null,
      source: input.source ?? 'turn',
      provider: input.provider,
      model: currentModel,
      contextWindow: input.contextWindow,
      promptHash: promptHash(prompt),
      promptChars: prompt.length,
      approxPromptTokens: approxTokens(prompt),
      activeRecords,
      suppressedRecords,
      segments,
    },
  };
}

function isReceipt(value: unknown): value is PromptContextReceipt {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { readonly receiptId?: unknown; readonly createdAt?: unknown; readonly sequence?: unknown };
  return typeof candidate.receiptId === 'string' && typeof candidate.createdAt === 'number' && typeof candidate.sequence === 'number';
}

function isTurnOutcome(value: unknown): value is PromptContextTurnOutcome {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    readonly turnId?: unknown;
    readonly status?: unknown;
    readonly terminalEvent?: unknown;
    readonly stopReason?: unknown;
    readonly completedAt?: unknown;
    readonly receiptIds?: unknown;
  };
  return typeof candidate.turnId === 'string'
    && (candidate.status === 'completed' || candidate.status === 'error' || candidate.status === 'cancelled')
    && (candidate.terminalEvent === 'TURN_COMPLETED' || candidate.terminalEvent === 'TURN_ERROR' || candidate.terminalEvent === 'TURN_CANCEL')
    && typeof candidate.stopReason === 'string'
    && typeof candidate.completedAt === 'number'
    && Array.isArray(candidate.receiptIds);
}

function parseReceiptLine(line: string): { readonly receipt?: PromptContextReceipt; readonly outcome?: PromptContextTurnOutcome } | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (isReceipt(parsed)) return { receipt: parsed };
    if (parsed && typeof parsed === 'object') {
      const candidate = parsed as { readonly kind?: unknown; readonly receipt?: unknown; readonly outcome?: unknown };
      if (candidate.kind === 'receipt' && isReceipt(candidate.receipt)) return { receipt: candidate.receipt };
      if (candidate.kind === 'turn_outcome' && isTurnOutcome(candidate.outcome)) return { outcome: candidate.outcome };
    }
    return null;
  } catch {
    return null;
  }
}

export interface PromptContextTurnOutcomeInput {
  readonly turnId: string;
  readonly status: PromptContextTurnOutcomeStatus;
  readonly terminalEvent: PromptContextTurnTerminalEvent;
  readonly stopReason: string;
  readonly completedAt?: number;
  readonly detail?: string;
}

export class AgentPromptContextReceiptStore {
  private readonly receipts: PromptContextReceipt[] = [];
  private sequence = 0;

  public constructor(
    private readonly receiptPath?: string,
    private readonly limit = RECEIPT_STORE_LIMIT,
  ) {
    this.load();
  }

  public record(draft: PromptContextReceiptDraft): PromptContextReceipt {
    const sequence = this.sequence + 1;
    this.sequence = sequence;
    const createdAt = Date.now();
    const receipt: PromptContextReceipt = {
      ...draft,
      receiptId: `promptctx-${createdAt.toString(36)}-${sequence.toString(36)}`,
      createdAt,
      sequence,
    };
    this.receipts.unshift(receipt);
    this.trim();
    this.append(receipt);
    return receipt;
  }

  public latest(): PromptContextReceipt | null {
    return this.receipts[0] ?? null;
  }

  public list(limit = 20): readonly PromptContextReceipt[] {
    return this.receipts.slice(0, Math.max(1, Math.min(this.limit, Math.trunc(limit))));
  }

  public get(receiptId: string): PromptContextReceipt | null {
    return this.receipts.find((receipt) => receipt.receiptId === receiptId) ?? null;
  }

  public count(): number {
    return this.receipts.length;
  }

  public recordTurnOutcome(input: PromptContextTurnOutcomeInput): PromptContextTurnOutcome | null {
    const turnId = input.turnId.trim();
    if (!turnId) return null;
    const detail = compactOutcomeDetail(input.detail);
    const matchingReceiptIds = this.receipts
      .filter((receipt) => receipt.turnId === turnId)
      .map((receipt) => receipt.receiptId);
    const outcome: PromptContextTurnOutcome = {
      turnId,
      status: input.status,
      terminalEvent: input.terminalEvent,
      stopReason: input.stopReason,
      completedAt: input.completedAt ?? Date.now(),
      receiptIds: matchingReceiptIds,
      ...(detail ? { detail } : {}),
    };
    this.applyTurnOutcome(outcome);
    this.appendTurnOutcome(outcome);
    return outcome;
  }

  private append(receipt: PromptContextReceipt): void {
    if (!this.receiptPath) return;
    mkdirSync(dirname(this.receiptPath), { recursive: true });
    appendFileSync(this.receiptPath, `${JSON.stringify(receipt)}\n`, 'utf-8');
  }

  private appendTurnOutcome(outcome: PromptContextTurnOutcome): void {
    if (!this.receiptPath) return;
    mkdirSync(dirname(this.receiptPath), { recursive: true });
    appendFileSync(this.receiptPath, `${JSON.stringify({ kind: 'turn_outcome', outcome })}\n`, 'utf-8');
  }

  private load(): void {
    if (!this.receiptPath || !existsSync(this.receiptPath)) return;
    const lines = readFileSync(this.receiptPath, 'utf-8').split('\n').filter(Boolean);
    const parsed = lines.map(parseReceiptLine).filter((entry): entry is NonNullable<ReturnType<typeof parseReceiptLine>> => Boolean(entry));
    const receipts = parsed.map((entry) => entry.receipt).filter((receipt): receipt is PromptContextReceipt => Boolean(receipt));
    const outcomes = parsed.map((entry) => entry.outcome).filter((outcome): outcome is PromptContextTurnOutcome => Boolean(outcome));
    const recentReceipts = receipts.slice(-this.limit);
    for (const outcome of outcomes) {
      for (const [index, receipt] of recentReceipts.entries()) {
        if (receipt.turnId === outcome.turnId || outcome.receiptIds.includes(receipt.receiptId)) {
          recentReceipts[index] = { ...receipt, turnOutcome: outcome };
        }
      }
    }
    this.receipts.push(...recentReceipts.reverse());
    this.sequence = this.receipts.reduce((max, receipt) => Math.max(max, receipt.sequence), 0);
    this.trim();
  }

  private applyTurnOutcome(outcome: PromptContextTurnOutcome): void {
    for (const [index, receipt] of this.receipts.entries()) {
      if (receipt.turnId === outcome.turnId || outcome.receiptIds.includes(receipt.receiptId)) {
        this.receipts[index] = { ...receipt, turnOutcome: outcome };
      }
    }
  }

  private trim(): void {
    this.receipts.splice(this.limit);
  }
}
