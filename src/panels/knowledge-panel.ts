import type { Line } from '../types/grid.ts';
import { ScrollableListPanel } from './scrollable-list-panel.ts';
import { type ConfirmState, handleConfirmInput, renderConfirmLines } from './confirm-state.ts';
import type { MemoryClass, MemoryRecord, MemoryRegistry, MemoryReviewState } from '@pellux/goodvibes-sdk/platform/state';
import type { KnowledgeStatus } from '@pellux/goodvibes-sdk/platform/knowledge';
import {
  buildBodyText,
  buildGuidanceLine,
  buildKeyValueLine,
  buildPanelLine,
  buildPanelWorkspace,
  DEFAULT_PANEL_PALETTE,
} from './polish.ts';

export interface AgentKnowledgePanelService {
  readonly getStatus: () => Promise<KnowledgeStatus & { readonly note?: string }>;
}

function summarize(records: MemoryRecord[], cls: MemoryClass): MemoryRecord[] {
  return records.filter((record) => record.cls === cls).slice(0, 3);
}

const C = {
  ...DEFAULT_PANEL_PALETTE,
  header: '#94a3b8',
  headerBg: '#1e293b',
} as const;

function reviewStateColor(state: MemoryReviewState): string {
  switch (state) {
    case 'reviewed':
      return C.good;
    case 'stale':
      return C.warn;
    case 'contradicted':
      return C.bad;
    case 'fresh':
    default:
      return C.info;
  }
}

function formatConfidence(confidence: number): string {
  return `${confidence.toString().padStart(3, ' ')}%`;
}

export class KnowledgePanel extends ScrollableListPanel<MemoryRecord> {
  private readonly registry: MemoryRegistry;
  private readonly agentKnowledgeService: AgentKnowledgePanelService | null;
  private unsubscribe?: () => void;
  private records: MemoryRecord[] = [];
  private agentKnowledgeStatus: (KnowledgeStatus & { readonly note?: string }) | null = null;
  private agentKnowledgeError: string | null = null;
  private agentKnowledgeLoading = false;
  // I1: confirm for destructive review-state mutations
  private confirm: ConfirmState<{ id: string; action: 'stale' | 'contradicted' }> | null = null;

  public constructor(registry: MemoryRegistry, agentKnowledgeService: AgentKnowledgePanelService | null = null) {
    super('knowledge', 'Knowledge', 'K', 'agent');
    this.registry = registry;
    this.agentKnowledgeService = agentKnowledgeService;
  }

  public override onActivate(): void {
    super.onActivate();
    this.refresh();
    this.refreshAgentKnowledgeStatus();
    this.unsubscribe = this.registry.subscribe(() => {
      this.refresh();
      this.markDirty();
    });
  }

  public override onDeactivate(): void {
    super.onDeactivate();
  }

  public override onDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  // ---------------------------------------------------------------------------
  // ScrollableListPanel implementation
  // ---------------------------------------------------------------------------

  protected getItems(): readonly MemoryRecord[] {
    return this.records;
  }

  protected renderItem(record: MemoryRecord, index: number, selected: boolean, width: number): Line {
    const bg = selected ? C.selectBg : undefined;
    return buildPanelLine(width, [
      ['  ', C.label, bg],
      [record.reviewState.padEnd(13), reviewStateColor(record.reviewState), bg],
      [` ${formatConfidence(record.confidence)} `, C.value, bg],
      [record.summary.slice(0, Math.max(0, width - 26)), C.value, bg],
    ]);
  }

  protected override getPalette() { return C; }
  protected override getEmptyStateMessage() { return 'No Agent Knowledge sources or local memory review records'; }
  protected override getEmptyStateActions() {
    return [
      { command: '/knowledge status', summary: 'inspect the isolated Agent Knowledge store' },
      { command: '/knowledge ingest-url <url> --yes', summary: 'ingest source-backed material into Agent Knowledge only' },
      { command: '/knowledge queue', summary: 'review Agent Knowledge issues' },
      { command: '/recall add fact <summary>', summary: 'capture a local non-secret memory record when appropriate' },
    ];
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  public handleInput(key: string): boolean {
    // I1: y/n confirm for stale/contradict
    if (this.confirm) {
      const result = handleConfirmInput(this.confirm, key);
      if (result === 'confirmed') {
        const { id, action } = this.confirm.subject;
        this.confirm = null;
        const selected = this.records.find((r) => r.id === id);
        if (selected) {
          try {
            if (action === 'stale') {
              this.registry.review(id, {
                state: 'stale',
                confidence: Math.min(selected.confidence, 40),
                reviewedBy: 'operator',
                staleReason: 'marked stale from the knowledge panel',
              });
            } else {
              this.registry.review(id, {
                state: 'contradicted',
                confidence: 0,
                reviewedBy: 'operator',
                staleReason: 'marked contradicted from the knowledge panel',
              });
            }
          } catch (e) {
            // I2: surface async failure
            this.setError(`Review update failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        this.refresh();
        this.markDirty();
        return true;
      }
      if (result === 'cancelled') {
        this.confirm = null;
        this.markDirty();
        return true;
      }
      if (result === 'absorbed') return true;
    }

    // I2: auto-clear error on next keypress (inherited via super.handleInput)
    if (this.records.length === 0) return super.handleInput(key);

    const selected = this.records[this.selectedIndex];

    if (key === 'Enter' || key === 'return' || key === 'r') {
      if (!selected) return false;
      this.registry.review(selected.id, {
        state: 'reviewed',
        confidence: Math.max(selected.confidence, 85),
        reviewedBy: 'operator',
      });
      this.refresh();
      this.markDirty();
      return true;
    }
    if (key === 's') {
      if (!selected) return false;
      // I1: prompt confirm before marking stale
      this.confirm = { subject: { id: selected.id, action: 'stale' }, label: selected.summary.slice(0, 40) };
      this.markDirty();
      return true;
    }
    if (key === 'c') {
      if (!selected) return false;
      // I1: prompt confirm before marking contradicted
      this.confirm = { subject: { id: selected.id, action: 'contradicted' }, label: selected.summary.slice(0, 40) };
      this.markDirty();
      return true;
    }
    if (key === 'f') {
      if (!selected) return false;
      this.registry.review(selected.id, {
        state: 'fresh',
        confidence: Math.max(selected.confidence, 60),
        reviewedBy: 'operator',
      });
      this.refresh();
      this.markDirty();
      return true;
    }

    // Normalize arrow keys to base class format
    if (key === 'ArrowUp') return super.handleInput('up');
    if (key === 'ArrowDown') return super.handleInput('down');
    return super.handleInput(key);
  }

  private refresh(): void {
    const queue = this.registry.reviewQueue(24);
    this.records = queue.length > 0 ? queue : this.registry.search({ limit: 24 });
    this.clampSelection();
  }

  private refreshAgentKnowledgeStatus(): void {
    if (!this.agentKnowledgeService || this.agentKnowledgeLoading) return;
    this.agentKnowledgeLoading = true;
    this.agentKnowledgeError = null;
    this.agentKnowledgeService.getStatus()
      .then((status) => {
        this.agentKnowledgeStatus = status;
        this.agentKnowledgeError = null;
      })
      .catch((error: unknown) => {
        this.agentKnowledgeError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        this.agentKnowledgeLoading = false;
        this.markDirty();
      });
  }

  private buildAgentKnowledgeHeader(width: number): Line[] {
    const lines: Line[] = [
      buildPanelLine(width, [[' Agent Knowledge Segment', C.label]]),
      buildPanelLine(width, [
        ['  route ', C.label],
        ['/api/goodvibes-agent/knowledge/*', C.info],
        ['  isolated: no default Knowledge/Wiki or HomeGraph fallback', C.dim],
      ]),
    ];
    if (this.agentKnowledgeLoading && !this.agentKnowledgeStatus) {
      lines.push(buildPanelLine(width, [['  loading isolated Agent Knowledge status...', C.dim]]));
    } else if (this.agentKnowledgeStatus) {
      const status = this.agentKnowledgeStatus;
      lines.push(buildKeyValueLine(width, [
        { label: 'Ready', value: status.ready ? 'yes' : 'no', valueColor: status.ready ? C.good : C.warn },
        { label: 'Sources', value: String(status.sourceCount), valueColor: status.sourceCount > 0 ? C.info : C.dim },
        { label: 'Nodes', value: String(status.nodeCount), valueColor: status.nodeCount > 0 ? C.info : C.dim },
        { label: 'Issues', value: String(status.issueCount), valueColor: status.issueCount > 0 ? C.warn : C.good },
      ], C));
      const note = status.note ? `  note: ${status.note}` : '';
      lines.push(buildPanelLine(width, [['  storage: ', C.label], [status.storagePath, C.dim], [note, C.dim]]));
    } else {
      lines.push(buildPanelLine(width, [['  status: not loaded; /knowledge status uses the same isolated route.', C.dim]]));
    }
    if (this.agentKnowledgeError) {
      lines.push(...buildBodyText(width, `Agent Knowledge status warning: ${this.agentKnowledgeError}`, C, C.warn));
    }
    lines.push(buildPanelLine(width, [
      ['  actions ', C.label],
      ['/knowledge status', C.value],
      [' | ', C.dim],
      ['/knowledge ingest-url <url> --yes', C.value],
      [' | ', C.dim],
      ['/knowledge search <query>', C.value],
      [' | ', C.dim],
      ['/knowledge queue', C.value],
    ]));
    return lines;
  }

  public render(width: number, height: number): Line[] {
    this.clampSelection();

    // I1: show confirm dialog in place of normal content
    if (this.confirm) {
      return buildPanelWorkspace(width, height, {
        title: 'Knowledge Control Room',
        intro: '',
        sections: [{ title: 'Confirmation', lines: renderConfirmLines(width, this.confirm) }],
        footerLines: [buildPanelLine(width, [['  y confirm  n / Esc cancel', C.dim]])],
        palette: C,
      });
    }

    if (this.records.length === 0) this.refresh();

    const intro = 'Isolated Agent Knowledge plus local non-secret memory review. This surface never falls back to default Knowledge/Wiki or HomeGraph.';
    const records = this.registry.search({ limit: 200 });
    const agentKnowledgeHeader = this.buildAgentKnowledgeHeader(width);

    if (records.length === 0) {
      return this.renderList(width, height, {
        title: 'Knowledge Control Room',
        header: agentKnowledgeHeader,
        footer: [buildPanelLine(width, [[' Review keys: Up/Down move  r/Enter review  s stale  c contradicted  f fresh', C.dim]])],
      });
    }

    const queue = this.registry.reviewQueue(24);
    const byClass = new Map<MemoryClass, number>();
    const byReview = new Map<MemoryReviewState, number>();
    const byScope = new Map<string, number>();
    for (const record of records) {
      byClass.set(record.cls, (byClass.get(record.cls) ?? 0) + 1);
      byReview.set(record.reviewState, (byReview.get(record.reviewState) ?? 0) + 1);
      byScope.set(record.scope, (byScope.get(record.scope) ?? 0) + 1);
    }

    const classLines: Line[] = [
      buildPanelLine(width, [
        [' facts ', C.label], [String(byClass.get('fact') ?? 0), C.good],
        ['  risks ', C.label], [String(byClass.get('risk') ?? 0), (byClass.get('risk') ?? 0) > 0 ? C.warn : C.good],
        ['  runbooks ', C.label], [String(byClass.get('runbook') ?? 0), C.info],
        ['  architecture ', C.label], [String(byClass.get('architecture') ?? 0), C.info],
        ['  incidents ', C.label], [String(byClass.get('incident') ?? 0), (byClass.get('incident') ?? 0) > 0 ? C.bad : C.good],
      ]),
      buildPanelLine(width, [
        [' decisions ', C.label], [String(byClass.get('decision') ?? 0), C.value],
        ['  constraints ', C.label], [String(byClass.get('constraint') ?? 0), C.value],
        ['  ownership ', C.label], [String(byClass.get('ownership') ?? 0), C.value],
        ['  patterns ', C.label], [String(byClass.get('pattern') ?? 0), C.value],
        ['  total ', C.label], [String(records.length), C.value],
      ]),
    ];

    const reviewLines: Line[] = [
      buildPanelLine(width, [
        [' reviewed ', C.label], [String(byReview.get('reviewed') ?? 0), C.good],
        ['  fresh ', C.label], [String(byReview.get('fresh') ?? 0), C.info],
        ['  stale ', C.label], [String(byReview.get('stale') ?? 0), C.warn],
        ['  contradicted ', C.label], [String(byReview.get('contradicted') ?? 0), C.bad],
        ['  Review Queue ', C.label], [String(queue.length), queue.length > 0 ? C.warn : C.good],
      ]),
      buildPanelLine(width, [
        [' session ', C.label], [String(byScope.get('session') ?? 0), C.info],
        ['  project ', C.label], [String(byScope.get('project') ?? 0), C.value],
        ['  team ', C.label], [String(byScope.get('team') ?? 0), C.good],
      ]),
      buildGuidanceLine(width, '/recall review', 'work the stale and contradicted queue from the command surface', C),
    ];

    const recentSummaryLines: Line[] = [];
    for (const [title, items, color] of [
      ['Recent Risks', summarize(records, 'risk'), C.warn],
      ['Runbooks', summarize(records, 'runbook'), C.info],
      ['Architecture Notes', summarize(records, 'architecture'), C.info],
      ['Recent Incidents', summarize(records, 'incident'), C.bad],
    ] as const) {
      if (recentSummaryLines.length > 0) {
        recentSummaryLines.push(buildPanelLine(width, [['', C.dim]]));
      }
      recentSummaryLines.push(buildPanelLine(width, [[` ${title}`, C.label]]));
      if (items.length === 0) {
        recentSummaryLines.push(buildPanelLine(width, [['  none recorded', C.dim]]));
        continue;
      }
      for (const item of items) {
        recentSummaryLines.push(buildPanelLine(width, [
          ['  ', C.label],
          [item.summary.slice(0, Math.max(0, width - 2)), color],
        ]));
      }
    }

    const selectedRecord = this.records[this.selectedIndex];
    const selectedLines: Line[] = [];
    if (selectedRecord) {
      selectedLines.push(buildPanelLine(width, [['  Selected', C.label]]));
      selectedLines.push(buildKeyValueLine(width, [
        { label: 'Class', value: selectedRecord.cls, valueColor: C.value },
        { label: 'Scope', value: selectedRecord.scope, valueColor: C.info },
        { label: 'Review', value: selectedRecord.reviewState, valueColor: reviewStateColor(selectedRecord.reviewState) },
        { label: 'Confidence', value: formatConfidence(selectedRecord.confidence), valueColor: C.value },
      ], C));
      selectedLines.push(...buildBodyText(width, `Summary: ${selectedRecord.summary}`, C, C.value));
      if (selectedRecord.detail) selectedLines.push(...buildBodyText(width, `Detail: ${selectedRecord.detail}`, C, C.dim));
      if (selectedRecord.provenance.length) {
        selectedLines.push(...buildBodyText(
          width,
          `Provenance: ${selectedRecord.provenance.map((p) => `${p.kind}:${p.ref}`).join(', ')}`,
          C,
          C.dim,
        ));
      }
      if (selectedRecord.staleReason) {
        selectedLines.push(...buildBodyText(
          width,
          `Stale reason: ${selectedRecord.staleReason}`,
          C,
          selectedRecord.reviewState === 'contradicted' ? C.bad : C.warn,
        ));
      }
      if (selectedRecord.reviewedAt) {
        selectedLines.push(buildPanelLine(width, [
          ['  Reviewed: ', C.label],
          [new Date(selectedRecord.reviewedAt).toLocaleString(), C.dim],
        ]));
        if (selectedRecord.reviewedBy) {
          selectedLines.push(buildPanelLine(width, [
            ['  Reviewer: ', C.label],
            [selectedRecord.reviewedBy, C.dim],
          ]));
        }
      }
    }

    return this.renderList(width, height, {
      title: 'Knowledge Control Room',
      header: [...agentKnowledgeHeader, ...classLines, ...reviewLines],
      footer: [
        buildPanelLine(width, [['  Up/Down move  r/Enter reviewed  s stale  c contradicted  f fresh', C.dim]]),
        ...(selectedLines.length > 0 ? selectedLines : []),
        ...recentSummaryLines,
      ],
    });
  }
}
