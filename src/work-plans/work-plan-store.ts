import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { logger, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';

export const WORK_PLAN_STATUSES = [
  'pending',
  'in_progress',
  'blocked',
  'done',
  'failed',
  'cancelled',
] as const;

export type WorkPlanItemStatus = typeof WORK_PLAN_STATUSES[number];

/**
 * Statuses that end an item's life. ONLY these are ever aged out or capped —
 * pending / in_progress / blocked / failed items are work the user still has
 * open, and open work is never expired out from under them. `failed` is
 * deliberately excluded: a failed item is usually retried, not finished.
 */
const WORK_PLAN_TERMINAL_STATUSES: readonly WorkPlanItemStatus[] = ['done', 'cancelled'];
/**
 * Count cap on terminal items. clearCompleted() is a manual action most people
 * never run, so finished items otherwise accumulate for the life of the project.
 * 100 keeps a long, browsable "what we finished" tail while bounding the file.
 */
const WORK_PLAN_TERMINAL_ITEM_LIMIT = 100;
/**
 * Age TTL on terminal items, measured from completedAt (falling back to
 * updatedAt). 30 days is well past the point where a finished checklist line is
 * still useful in the live plan, and matches the "recent work" window the plan
 * surface is read for. Applied together with the count cap: a terminal item must
 * survive BOTH.
 */
const WORK_PLAN_TERMINAL_ITEM_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** What a plan read had to recover from or reclaim — the disclosure record. */
export interface WorkPlanMaintenance {
  readonly path: string;
  /** How the last read had to degrade, if at all. */
  readonly recovered: 'none' | 'unreadable' | 'empty-file' | 'quarantined' | 'quarantine-failed';
  /** Terminal items dropped because they aged past the TTL. */
  readonly expiredItems: number;
  /** Terminal items dropped because they fell outside the count cap. */
  readonly overflowItems: number;
  /** Items still in the plan after the sweep. */
  readonly keptItems: number;
  /** Bytes of the file that was quarantined, when one was. */
  readonly quarantinedBytes?: number;
}

function isTerminalItem(item: WorkPlanItem): boolean {
  return WORK_PLAN_TERMINAL_STATUSES.includes(item.status);
}

function terminalItemTime(item: WorkPlanItem): number {
  return item.completedAt ?? item.updatedAt;
}

export interface WorkPlanLinkTargets {
  readonly agentId?: string;
  readonly wrfcId?: string;
  readonly taskId?: string;
  readonly sessionId?: string;
}

export interface WorkPlanItem {
  readonly id: string;
  readonly title: string;
  readonly status: WorkPlanItemStatus;
  readonly owner?: string;
  readonly source?: string;
  readonly notes?: string;
  readonly linked?: WorkPlanLinkTargets;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number;
}

export interface WorkPlan {
  readonly id: string;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly title: string;
  readonly items: readonly WorkPlanItem[];
  readonly activeItemId?: string;
  readonly source?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkPlanStoreOptions {
  readonly homeDirectory: string;
  readonly projectId: string;
  readonly projectRoot: string;
}

export interface AddWorkPlanItemOptions {
  readonly status?: WorkPlanItemStatus;
  readonly owner?: string;
  readonly source?: string;
  readonly notes?: string;
  readonly linked?: WorkPlanLinkTargets;
}

export interface UpdateWorkPlanItemPatch {
  readonly title?: string;
  readonly status?: WorkPlanItemStatus;
  readonly owner?: string | null;
  readonly source?: string | null;
  readonly notes?: string | null;
  readonly linked?: WorkPlanLinkTargets | null;
}

function nowMs(): number {
  return Date.now();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isWorkPlanStatus(value: unknown): value is WorkPlanItemStatus {
  return typeof value === 'string' && WORK_PLAN_STATUSES.includes(value as WorkPlanItemStatus);
}

function safeFileId(projectId: string, projectRoot: string): string {
  const normalized = projectId.trim() || 'project';
  const safe = normalized.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  if (safe.length > 0 && safe.length <= 96) return safe;
  const hash = createHash('sha256').update(`${projectId}\0${projectRoot}`).digest('hex').slice(0, 16);
  return `${safe.slice(0, 80) || 'project'}-${hash}`;
}

function createPlanId(projectId: string, projectRoot: string): string {
  const hash = createHash('sha256').update(`${projectId}\0${projectRoot}`).digest('hex').slice(0, 12);
  return `wp-${hash}`;
}

function createItemId(): string {
  return `wpi-${randomUUID().slice(0, 8)}`;
}

function normalizeLinked(value: unknown): WorkPlanLinkTargets | undefined {
  if (!isObject(value)) return undefined;
  const agentId = readString(value.agentId);
  const wrfcId = readString(value.wrfcId);
  const taskId = readString(value.taskId);
  const sessionId = readString(value.sessionId);
  const linked: WorkPlanLinkTargets = {
    ...(agentId ? { agentId } : {}),
    ...(wrfcId ? { wrfcId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
  return Object.keys(linked).length > 0 ? linked : undefined;
}

function normalizeItem(value: unknown, fallbackCreatedAt: number): WorkPlanItem | null {
  if (!isObject(value)) return null;
  const title = readString(value.title);
  if (!title) return null;
  const status = isWorkPlanStatus(value.status) ? value.status : 'pending';
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : fallbackCreatedAt;
  const updatedAt = typeof value.updatedAt === 'number' ? value.updatedAt : createdAt;
  const completedAt = typeof value.completedAt === 'number' ? value.completedAt : undefined;
  const owner = readString(value.owner);
  const source = readString(value.source);
  const notes = readString(value.notes);
  const linked = normalizeLinked(value.linked);
  return {
    id: readString(value.id) ?? createItemId(),
    title,
    status,
    ...(owner ? { owner } : {}),
    ...(source ? { source } : {}),
    ...(notes ? { notes } : {}),
    ...(linked ? { linked } : {}),
    createdAt,
    updatedAt,
    ...(completedAt !== undefined ? { completedAt } : {}),
  };
}

function formatStatus(status: WorkPlanItemStatus): string {
  return status.replace(/_/g, ' ');
}

export function nextWorkPlanStatus(status: WorkPlanItemStatus): WorkPlanItemStatus {
  switch (status) {
    case 'pending':
      return 'in_progress';
    case 'in_progress':
      return 'done';
    case 'done':
      return 'pending';
    case 'blocked':
    case 'failed':
    case 'cancelled':
      return 'pending';
  }
}

export class WorkPlanStore {
  readonly filePath: string;
  private lastMaintenanceSummary: WorkPlanMaintenance | null = null;

  constructor(private readonly options: WorkPlanStoreOptions) {
    const fileName = `${safeFileId(options.projectId, options.projectRoot)}.json`;
    this.filePath = join(options.homeDirectory, '.goodvibes', GOODVIBES_AGENT_SURFACE_ROOT, 'work-plans', fileName);
  }

  getActivePlan(): WorkPlan {
    return this.readPlan();
  }

  listItems(): readonly WorkPlanItem[] {
    return this.getActivePlan().items;
  }

  addItem(title: string, options: AddWorkPlanItemOptions = {}): WorkPlanItem {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new Error('Work plan item title is required.');
    const plan = this.readPlan();
    const time = nowMs();
    const item: WorkPlanItem = {
      id: createItemId(),
      title: normalizedTitle,
      status: options.status ?? 'pending',
      ...(options.owner ? { owner: options.owner } : {}),
      ...(options.source ? { source: options.source } : {}),
      ...(options.notes ? { notes: options.notes } : {}),
      ...(options.linked ? { linked: options.linked } : {}),
      createdAt: time,
      updatedAt: time,
      ...(options.status === 'done' ? { completedAt: time } : {}),
    };
    this.writePlan({
      ...plan,
      items: [...plan.items, item],
      activeItemId: item.id,
      updatedAt: time,
    });
    return item;
  }

  updateItem(idOrPrefix: string, patch: UpdateWorkPlanItemPatch): WorkPlanItem {
    const plan = this.readPlan();
    const item = this.resolveItem(plan, idOrPrefix);
    const time = nowMs();
    const nextStatus = patch.status ?? item.status;
    const next: WorkPlanItem = this.pruneItem({
      ...item,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      status: nextStatus,
      ...(patch.owner !== undefined ? { owner: patch.owner || undefined } : {}),
      ...(patch.source !== undefined ? { source: patch.source || undefined } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes || undefined } : {}),
      ...(patch.linked !== undefined ? { linked: patch.linked || undefined } : {}),
      updatedAt: time,
      ...(nextStatus === 'done' ? { completedAt: item.completedAt ?? time } : { completedAt: undefined }),
    });
    if (!next.title) throw new Error('Work plan item title is required.');
    this.writePlan({
      ...plan,
      items: plan.items.map((candidate) => candidate.id === item.id ? next : candidate),
      activeItemId: next.id,
      updatedAt: time,
    });
    return next;
  }

  setItemStatus(idOrPrefix: string, status: WorkPlanItemStatus): WorkPlanItem {
    return this.updateItem(idOrPrefix, { status });
  }

  cycleItemStatus(idOrPrefix: string): WorkPlanItem {
    const item = this.resolveItem(this.readPlan(), idOrPrefix);
    return this.setItemStatus(item.id, nextWorkPlanStatus(item.status));
  }

  removeItem(idOrPrefix: string): WorkPlanItem {
    const plan = this.readPlan();
    const item = this.resolveItem(plan, idOrPrefix);
    const time = nowMs();
    const remaining = plan.items.filter((candidate) => candidate.id !== item.id);
    this.writePlan({
      ...plan,
      items: remaining,
      activeItemId: remaining[0]?.id,
      updatedAt: time,
    });
    return item;
  }

  clearCompleted(): number {
    const plan = this.readPlan();
    const remaining = plan.items.filter((item) => item.status !== 'done' && item.status !== 'cancelled');
    const removed = plan.items.length - remaining.length;
    if (removed === 0) return 0;
    this.writePlan({
      ...plan,
      items: remaining,
      activeItemId: remaining[0]?.id,
      updatedAt: nowMs(),
    });
    return removed;
  }

  toMarkdown(plan: WorkPlan = this.readPlan()): string {
    const lines = [
      `# ${plan.title}`,
      '',
      `Project: ${plan.projectRoot}`,
      `Project ID: ${plan.projectId}`,
      `Updated: ${new Date(plan.updatedAt).toISOString()}`,
      '',
    ];
    if (plan.items.length === 0) {
      lines.push('No work plan items recorded.');
      return lines.join('\n');
    }
    for (const item of plan.items) {
      const marker = item.status === 'done' ? 'x' : ' ';
      const suffix = item.status === 'pending' ? '' : ` (${formatStatus(item.status)})`;
      lines.push(`- [${marker}] ${item.title}${suffix}`);
      if (item.owner) lines.push(`  - Owner: ${item.owner}`);
      if (item.source) lines.push(`  - Source: ${item.source}`);
      if (item.notes) lines.push(`  - Notes: ${item.notes}`);
    }
    return lines.join('\n');
  }

  /**
   * Read the stored plan, then sweep terminal items past either bound.
   *
   * Existence is never treated as validity: the file a crash left behind may be
   * zero-byte or half-written, so the body is parsed and shape-checked, and any
   * failure degrades to an empty plan with the bad file preserved aside rather
   * than throwing out of every public method.
   */
  private readPlan(): WorkPlan {
    return this.reapTerminalItems(this.readStoredPlan());
  }

  /** The last read's recovery/reclaim disclosure record, or null when none has run. */
  lastMaintenance(): WorkPlanMaintenance | null {
    return this.lastMaintenanceSummary;
  }

  /**
   * Drop terminal (done/cancelled) items past the age TTL or the count cap, and
   * persist + disclose when anything was actually dropped. Open work is never
   * touched. A second call drops nothing and writes nothing, so the sweep is
   * idempotent and safe to run from more than one process.
   */
  private reapTerminalItems(plan: WorkPlan): WorkPlan {
    const now = nowMs();
    const terminal = plan.items.filter(isTerminalItem);
    const fresh = terminal.filter((item) => now - terminalItemTime(item) <= WORK_PLAN_TERMINAL_ITEM_MAX_AGE_MS);
    const keptTerminal = [...fresh]
      .sort((left, right) => terminalItemTime(left) - terminalItemTime(right))
      .slice(-WORK_PLAN_TERMINAL_ITEM_LIMIT);
    const expiredItems = terminal.length - fresh.length;
    const overflowItems = fresh.length - keptTerminal.length;
    if (expiredItems === 0 && overflowItems === 0) {
      this.lastMaintenanceSummary = {
        path: this.filePath,
        recovered: this.lastMaintenanceSummary?.recovered ?? 'none',
        expiredItems: 0,
        overflowItems: 0,
        keptItems: plan.items.length,
        ...(this.lastMaintenanceSummary?.quarantinedBytes !== undefined ? { quarantinedBytes: this.lastMaintenanceSummary.quarantinedBytes } : {}),
      };
      return plan;
    }
    const keptIds = new Set(keptTerminal.map((item) => item.id));
    const items = plan.items.filter((item) => !isTerminalItem(item) || keptIds.has(item.id));
    const swept: WorkPlan = {
      ...plan,
      items,
      ...(plan.activeItemId && items.some((item) => item.id === plan.activeItemId) ? { activeItemId: plan.activeItemId } : {}),
    };
    const next: WorkPlan = plan.activeItemId && !items.some((item) => item.id === plan.activeItemId)
      ? { ...swept, activeItemId: items[0]?.id }
      : swept;
    this.writePlan(next);
    this.lastMaintenanceSummary = {
      path: this.filePath,
      recovered: this.lastMaintenanceSummary?.recovered ?? 'none',
      expiredItems,
      overflowItems,
      keptItems: items.length,
    };
    logger.info('Work plan finished items reclaimed', {
      path: this.filePath,
      expiredItems,
      overflowItems,
      keptItems: items.length,
    });
    return next;
  }

  private readStoredPlan(): WorkPlan {
    if (!existsSync(this.filePath)) return this.createEmptyPlan();
    let raw = '';
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (error) {
      this.noteRecovery('unreadable');
      logger.warn('Work plan could not be read; continuing with an empty plan', {
        path: this.filePath,
        error: summarizeError(error),
      });
      return this.createEmptyPlan();
    }
    if (!raw.trim()) {
      this.noteRecovery('empty-file');
      logger.warn('Work plan file is empty (torn or interrupted write); continuing with an empty plan', {
        path: this.filePath,
        bytes: Buffer.byteLength(raw, 'utf8'),
      });
      return this.createEmptyPlan();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      this.quarantine(Buffer.byteLength(raw, 'utf8'), summarizeError(error));
      return this.createEmptyPlan();
    }
    if (!isObject(parsed)) {
      this.quarantine(Buffer.byteLength(raw, 'utf8'), 'work plan file is not a JSON object');
      return this.createEmptyPlan();
    }
    const time = nowMs();
    const createdAt = typeof parsed.createdAt === 'number' ? parsed.createdAt : time;
    const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : createdAt;
    const items = Array.isArray(parsed.items)
      ? parsed.items.map((item) => normalizeItem(item, createdAt)).filter((item): item is WorkPlanItem => item !== null)
      : [];
    const activeItemId = readString(parsed.activeItemId);
    const source = readString(parsed.source);
    return {
      id: readString(parsed.id) ?? createPlanId(this.options.projectId, this.options.projectRoot),
      projectId: readString(parsed.projectId) ?? this.options.projectId,
      projectRoot: readString(parsed.projectRoot) ?? this.options.projectRoot,
      title: readString(parsed.title) ?? 'Work Plan',
      items,
      ...(activeItemId && items.some((item) => item.id === activeItemId) ? { activeItemId } : {}),
      ...(source ? { source } : {}),
      createdAt,
      updatedAt,
    };
  }

  private noteRecovery(recovered: WorkPlanMaintenance['recovered'], quarantinedBytes?: number): void {
    this.lastMaintenanceSummary = {
      path: this.filePath,
      recovered,
      expiredItems: 0,
      overflowItems: 0,
      keptItems: 0,
      ...(quarantinedBytes !== undefined ? { quarantinedBytes } : {}),
    };
  }

  /**
   * Preserve an unreadable plan file instead of discarding the user's work: it is
   * renamed to a single fixed `.corrupt` slot, which is overwritten each time so
   * the quarantine itself cannot accumulate. The reason is logged with byte
   * counts and paths only — never the file's contents.
   */
  private quarantine(bytes: number, reason: string): void {
    const quarantinePath = `${this.filePath}.corrupt`;
    let preserved = false;
    try {
      renameSync(this.filePath, quarantinePath);
      preserved = true;
    } catch {
      preserved = false;
    }
    this.noteRecovery(preserved ? 'quarantined' : 'quarantine-failed', bytes);
    logger.error('Work plan file was unreadable; continuing with an empty plan', {
      path: this.filePath,
      bytes,
      preserved,
      ...(preserved ? { quarantinePath } : {}),
      reason,
    });
  }

  private createEmptyPlan(): WorkPlan {
    const time = nowMs();
    return {
      id: createPlanId(this.options.projectId, this.options.projectRoot),
      projectId: this.options.projectId,
      projectRoot: this.options.projectRoot,
      title: 'Work Plan',
      items: [],
      source: 'tui',
      createdAt: time,
      updatedAt: time,
    };
  }

  private writePlan(plan: WorkPlan): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }

  private resolveItem(plan: WorkPlan, idOrPrefix: string): WorkPlanItem {
    const needle = idOrPrefix.trim();
    if (!needle) throw new Error('Work plan item id is required.');
    const exact = plan.items.find((item) => item.id === needle);
    if (exact) return exact;
    const matches = plan.items.filter((item) => item.id.startsWith(needle));
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new Error(`Work plan item id "${needle}" is ambiguous: ${matches.map((item) => item.id).join(', ')}`);
    }
    throw new Error(`Work plan item not found: ${needle}`);
  }

  private pruneItem(item: WorkPlanItem & {
    owner?: string | undefined;
    source?: string | undefined;
    notes?: string | undefined;
    linked?: WorkPlanLinkTargets | undefined;
    completedAt?: number | undefined;
  }): WorkPlanItem {
    return {
      id: item.id,
      title: item.title,
      status: item.status,
      ...(item.owner ? { owner: item.owner } : {}),
      ...(item.source ? { source: item.source } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
      ...(item.linked ? { linked: item.linked } : {}),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ...(item.completedAt !== undefined ? { completedAt: item.completedAt } : {}),
    };
  }
}
