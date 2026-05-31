import type {
  AgentWorkspace,
  AgentWorkspaceAction,
  AgentWorkspaceActionResult,
  AgentWorkspaceCategory,
  AgentWorkspaceRuntimeSnapshot,
} from '../input/agent-workspace.ts';
import type { Line } from '../types/grid.ts';
import { wrapText } from '../utils/terminal-width.ts';
import { GLYPHS } from './ui-primitives.ts';
import {
  getFullscreenWorkspaceMetrics,
  padDisplay,
  renderFullscreenWorkspace,
  stableWindow,
  WORKSPACE_PALETTE as PALETTE,
  type WorkspaceRow,
} from './fullscreen-workspace.ts';

function safetyColor(action: AgentWorkspaceAction): string {
  if (action.safety === 'safe') return PALETTE.good;
  if (action.safety === 'read-only') return PALETTE.info;
  if (action.safety === 'delegates') return PALETTE.warn;
  return PALETTE.bad;
}

function actionResultColor(result: AgentWorkspaceActionResult): string {
  if (result.kind === 'blocked' || result.kind === 'error') return PALETTE.bad;
  if (result.kind === 'dispatched') return PALETTE.info;
  if (result.kind === 'refreshed') return PALETTE.good;
  return PALETTE.muted;
}

function buildLeftRows(workspace: AgentWorkspace, height: number): WorkspaceRow[] {
  const rows: WorkspaceRow[] = [];
  let selectedRenderedIndex = 0;
  let lastGroup = '';

  workspace.categories.forEach((category, index) => {
    if (category.group !== lastGroup) {
      rows.push({ text: category.group, kind: 'group', bold: true });
      lastGroup = category.group;
    }
    const selected = index === workspace.selectedCategoryIndex;
    if (selected) selectedRenderedIndex = rows.length;
    const marker = selected ? GLYPHS.navigation.selected : ' ';
    rows.push({
      text: `  ${marker} ${category.label}`,
      selected: selected && workspace.focusPane === 'categories',
      kind: 'item',
      fg: selected ? PALETTE.text : PALETTE.muted,
      bold: selected,
    });
  });

  const visible = Math.max(1, height);
  const window = stableWindow(rows.length, selectedRenderedIndex, visible);
  const visibleRows = rows.slice(window.start, window.end);
  if (window.start > 0 && visibleRows.length > 0) {
    visibleRows[0] = { text: `${GLYPHS.navigation.moreAbove} ${window.start} more row(s) above`, kind: 'more', fg: PALETTE.dim, dim: true };
  }
  if (window.end < rows.length && visibleRows.length > 0) {
    visibleRows[visibleRows.length - 1] = { text: `${GLYPHS.navigation.moreBelow} ${rows.length - window.end} more row(s) below`, kind: 'more', fg: PALETTE.dim, dim: true };
  }
  while (visibleRows.length < height) visibleRows.push({ text: '', kind: 'empty' });
  return visibleRows.slice(0, height);
}

function actionCommand(action: AgentWorkspaceAction): string {
  return action.command ?? '(guidance)';
}

type ContextLine = { readonly text: string; readonly fg?: string; readonly bold?: boolean; readonly dim?: boolean };

function snapshotLines(category: AgentWorkspaceCategory, snapshot: AgentWorkspaceRuntimeSnapshot | null): ContextLine[] {
  if (!snapshot) return [{ text: 'Runtime context is not loaded yet.', fg: PALETTE.warn }];
  const base: ContextLine[] = [{ text: 'Live Agent Context', fg: PALETTE.title, bold: true }];
  if (category.id === 'home') {
    base.push(
      { text: `Chat route: ${snapshot.provider} / ${snapshot.modelDisplayName}`, fg: PALETTE.info },
      { text: `Session: ${snapshot.sessionId}`, fg: PALETTE.muted },
      { text: `Policy: ${snapshot.executionPolicy}; WRFC ${snapshot.wrfcPolicy}`, fg: PALETTE.good },
    );
  } else if (category.id === 'setup') {
    base.push(
      { text: `External daemon: ${snapshot.daemonBaseUrl}`, fg: PALETTE.info },
      { text: `Daemon ownership: ${snapshot.daemonOwnership}; Agent never starts or restarts it`, fg: PALETTE.good },
      { text: `Workspace: ${snapshot.workingDirectory}`, fg: PALETTE.muted },
      { text: `Home: ${snapshot.homeDirectory}`, fg: PALETTE.muted },
    );
  } else if (category.id === 'knowledge') {
    base.push(
      { text: `Route family: ${snapshot.knowledgeRoute}/{status,ask,search}`, fg: PALETTE.info },
      { text: `Isolation: ${snapshot.knowledgeIsolation}; no default Knowledge/Wiki or HomeGraph fallback`, fg: PALETTE.good },
      { text: 'Agent-owned content appears here only after explicit Agent knowledge ingestion.', fg: PALETTE.muted },
    );
  } else if (category.id === 'memory') {
    base.push(
      { text: `Session memories: ${snapshot.sessionMemoryCount}`, fg: PALETTE.info },
      { text: `Local routines: ${snapshot.localRoutineCount}; enabled: ${snapshot.enabledRoutineCount}`, fg: PALETTE.info },
      { text: `Local skills: ${snapshot.localSkillCount}; enabled: ${snapshot.enabledSkillCount}`, fg: PALETTE.info },
      { text: `Local personas: ${snapshot.localPersonaCount}; active: ${snapshot.activePersonaName}`, fg: PALETTE.info },
      { text: 'Durable memory, routines, skills, and personas remain Agent-local until shared registry contracts exist.', fg: PALETTE.good },
      { text: 'Secrets are rejected/redacted; store secret references instead of secret values.', fg: PALETTE.warn },
    );
  } else if (category.id === 'work') {
    base.push(
      { text: 'Work plan and approvals are read or explicitly confirmed through public operator routes.', fg: PALETTE.info },
      { text: 'This workspace does not approve, deny, cancel, or mutate requests by selection alone.', fg: PALETTE.good },
    );
  } else if (category.id === 'automation') {
    base.push(
      { text: 'Automation and schedules default to read-only observability.', fg: PALETTE.info },
      { text: 'Run/pause/resume/cancel/retry require exact explicit commands and confirmation.', fg: PALETTE.warn },
    );
  } else if (category.id === 'delegate') {
    base.push(
      { text: 'Build/fix/review work is handed to GoodVibes TUI/shared-session contracts.', fg: PALETTE.info },
      { text: `WRFC policy: ${snapshot.wrfcPolicy}`, fg: PALETTE.warn },
      { text: 'Agent does not spawn local Engineer/Reviewer/Tester roots.', fg: PALETTE.good },
    );
  }
  if (snapshot.warnings.length > 0) {
    base.push({ text: '', dim: true }, { text: 'Warnings', fg: PALETTE.warn, bold: true });
    for (const warning of snapshot.warnings) base.push({ text: warning, fg: PALETTE.warn });
  }
  return base;
}

function buildContextRows(workspace: AgentWorkspace, category: AgentWorkspaceCategory, action: AgentWorkspaceAction | null, width: number): WorkspaceRow[] {
  const lines: ContextLine[] = [
    { text: category.label, fg: PALETTE.title, bold: true },
    { text: category.summary, fg: PALETTE.subtitle },
    { text: '' },
    { text: category.detail, fg: PALETTE.text },
    { text: '' },
    ...snapshotLines(category, workspace.runtimeSnapshot),
  ];

  if (action) {
    lines.push(
      { text: '' },
      { text: `Selected: ${action.label}`, fg: PALETTE.title, bold: true },
      { text: action.detail, fg: PALETTE.text },
      { text: `Command: ${actionCommand(action)}`, fg: action.kind === 'command' ? PALETTE.info : PALETTE.muted },
      { text: `Safety: ${action.safety}`, fg: safetyColor(action) },
    );
  }

  if (workspace.lastActionResult) {
    lines.push(
      { text: '' },
      { text: 'Action Result', fg: PALETTE.title, bold: true },
      { text: workspace.lastActionResult.title, fg: actionResultColor(workspace.lastActionResult), bold: true },
      { text: workspace.lastActionResult.detail, fg: PALETTE.text },
    );
    if (workspace.lastActionResult.command) {
      lines.push({ text: `Command: ${workspace.lastActionResult.command}`, fg: PALETTE.muted });
    }
  }

  return lines.flatMap((entry): WorkspaceRow[] => {
    if (entry.text.length === 0) return [{ text: '', kind: 'empty', dim: true }];
    return wrapText(entry.text, Math.max(1, width)).map((text, index): WorkspaceRow => ({
      text,
      fg: entry.fg,
      bold: entry.bold && index === 0,
      dim: entry.dim,
    }));
  });
}

function buildActionRows(workspace: AgentWorkspace, width: number, height: number): WorkspaceRow[] {
  const rows: WorkspaceRow[] = [];
  const labelWidth = Math.min(28, Math.max(16, Math.floor(width * 0.30)));
  const safetyWidth = 10;
  const commandWidth = Math.max(10, width - labelWidth - safetyWidth - 9);
  rows.push({
    text: `  ${padDisplay('Action', labelWidth)}  ${padDisplay('Safety', safetyWidth)}  ${padDisplay('Command', commandWidth)}`,
    fg: PALETTE.muted,
    bold: true,
  });

  const actions = workspace.actions;
  const visible = Math.max(1, height - 2);
  const window = stableWindow(actions.length, workspace.selectedActionIndex, visible);
  if (window.start > 0) rows.push({ text: `${GLYPHS.navigation.moreAbove} ${window.start} more action(s) above`, kind: 'more', fg: PALETTE.dim, dim: true });

  for (let index = window.start; index < window.end; index += 1) {
    const action = actions[index]!;
    const selected = index === workspace.selectedActionIndex;
    const marker = selected ? GLYPHS.navigation.selected : ' ';
    rows.push({
      text: `${marker} ${padDisplay(action.label, labelWidth)}  ${padDisplay(action.safety, safetyWidth)}  ${padDisplay(actionCommand(action), commandWidth)}`,
      selected: selected && workspace.focusPane === 'actions',
      fg: safetyColor(action),
      bold: selected,
    });
  }

  if (window.end < actions.length) rows.push({ text: `${GLYPHS.navigation.moreBelow} ${actions.length - window.end} more action(s) below`, kind: 'more', fg: PALETTE.dim, dim: true });
  rows.push({ text: '' });
  rows.push({ text: `Status: ${workspace.status}`, fg: PALETTE.muted });
  if (workspace.lastActionResult) {
    rows.push({ text: '' });
    rows.push({ text: `Action Result: ${workspace.lastActionResult.title}`, fg: actionResultColor(workspace.lastActionResult), bold: true });
    for (const line of wrapText(workspace.lastActionResult.detail, Math.max(1, width - 2))) {
      rows.push({ text: `  ${line}`, fg: PALETTE.text });
    }
    if (workspace.lastActionResult.command) {
      rows.push({ text: `  Command: ${workspace.lastActionResult.command}`, fg: PALETTE.muted });
    }
  }

  while (rows.length < height) rows.push({ text: '', kind: 'empty' });
  return rows.slice(0, height);
}

function footerText(workspace: AgentWorkspace): string {
  const focus = workspace.focusPane === 'categories' ? 'categories' : 'actions';
  return `Agent workspace · focus ${focus} · Up/Down navigate · Left/Right pane · Enter open/action · R refresh · Esc close`;
}

export function renderAgentWorkspace(workspace: AgentWorkspace, width: number, height: number): Line[] {
  const metrics = getFullscreenWorkspaceMetrics({ width, height, leftWidth: width < 90 ? undefined : 30, contextRatio: 0.48, minContextRows: 8 });
  const category = workspace.selectedCategory;
  const action = workspace.selectedAction;

  return renderFullscreenWorkspace({
    width,
    height,
    title: 'GoodVibes Agent / Operator Workspace',
    stateLabel: workspace.focusPane === 'categories' ? 'Categories' : 'Actions',
    leftHeader: 'Operator Areas',
    mainHeader: `${category.label} · ${category.actions.length} action(s)`,
    leftRows: buildLeftRows(workspace, metrics.bodyRows),
    contextRows: buildContextRows(workspace, category, action, metrics.contextWidth),
    controlRows: buildActionRows(workspace, metrics.contextWidth, metrics.controlRows),
    footer: footerText(workspace),
  });
}
