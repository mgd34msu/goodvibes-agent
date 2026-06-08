import type {
  AgentWorkspace,
  AgentWorkspaceAction,
  AgentWorkspaceCategory,
  AgentWorkspaceLocalEditor,
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
import { actionResultColor, type AgentWorkspaceContextLine as ContextLine } from './agent-workspace-style.ts';
import { compactText, reviewerReadinessContextLines, snapshotLines } from './agent-workspace-context-lines.ts';

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
  if (action.kind === 'workspace') return 'open area';
  if (action.kind === 'editor') return action.editorKind ? `edit ${action.editorKind}` : 'edit form';
  if (action.kind === 'setting') return action.settingKey ? `setting ${action.settingKey}` : 'setting';
  if (action.kind === 'settings-import') return 'import GoodVibes settings';
  if (action.kind === 'setup-checkpoint') return action.setupCheckpointOperation ? `setup checkpoint ${action.setupCheckpointOperation}` : 'setup checkpoint';
  if (action.kind === 'model-picker') return action.modelPickerFlow === 'model' ? 'model picker' : 'provider/model picker';
  if (action.kind === 'settings-modal') return action.settingsTarget ? `settings ${action.settingsTarget}` : 'settings';
  if (action.kind === 'local-selection') return action.selectionDelta && action.selectionDelta < 0 ? 'select previous' : 'select next';
  if (action.kind === 'local-operation') return action.localOperation ?? '(local action)';
  if (action.kind === 'onboarding-complete') return 'apply and close';
  return action.command ?? '(guidance)';
}

function isOnboardingCategory(category: AgentWorkspaceCategory): boolean {
  return category.group === 'ONBOARDING';
}

function onboardingActionChange(workspace: AgentWorkspace, action: AgentWorkspaceAction): string {
  if (action.kind === 'setting') {
    return workspace.settingActionPreview(action) ?? 'Update setting';
  }
  if (action.kind === 'settings-import') return 'Import compatible GoodVibes preferences';
  if (action.kind === 'setup-checkpoint') {
    if (action.setupCheckpointOperation === 'show') return 'Show saved setup progress';
    if (action.setupCheckpointOperation === 'mark-current') return 'Save current setup progress';
    if (action.setupCheckpointOperation === 'clear') return 'Clear saved setup progress';
    return 'Review setup progress';
  }
  if (action.kind === 'model-picker') return action.modelPickerFlow === 'model' ? 'Choose a model' : 'Choose provider and model';
  if (action.kind === 'settings-modal') return 'Open settings';
  if (action.kind === 'workspace') return 'Open setup area';
  if (action.kind === 'editor') return 'Open guided form';
  if (action.kind === 'local-selection') return 'Move selection';
  if (action.kind === 'local-operation') return 'Apply selected library action';
  if (action.kind === 'onboarding-complete') return 'Save setup completion';
  if (action.safety === 'read-only') return 'Review readiness';
  if (action.safety === 'blocked') return 'Unavailable in this setup step';
  return 'Open option';
}

function actionChange(workspace: AgentWorkspace, category: AgentWorkspaceCategory, action: AgentWorkspaceAction): string {
  return isOnboardingCategory(category) ? onboardingActionChange(workspace, action) : actionCommand(action);
}

function actionMetaLine(workspace: AgentWorkspace, category: AgentWorkspaceCategory, action: AgentWorkspaceAction): ContextLine {
  const onboarding = isOnboardingCategory(category);
  return {
    text: `${onboarding ? 'Change' : 'Does'}: ${actionChange(workspace, category, action)}`,
    fg: action.safety === 'blocked' ? PALETTE.warn : !onboarding && action.kind === 'command' ? PALETTE.info : PALETTE.muted,
  };
}

function editorContextLines(editor: AgentWorkspaceLocalEditor, snapshot: AgentWorkspaceRuntimeSnapshot | null): ContextLine[] {
  const selected = editor.fields[editor.selectedFieldIndex];
  const lines: ContextLine[] = [
    { text: editor.title, fg: PALETTE.title, bold: true },
    { text: compactText(editor.message), fg: editor.message.includes('required') || editor.message.includes('cannot') || editor.message.includes('Cannot') ? PALETTE.warn : PALETTE.info },
    { text: 'Enter next/save; Ctrl-J newline; Esc cancel.', fg: PALETTE.muted },
  ];
  if (selected) {
    lines.push(
      { text: `Editing: ${selected.label}${selected.required ? ' (required)' : ''}`, fg: PALETTE.title, bold: true },
      { text: compactText(selected.hint), fg: PALETTE.muted },
    );
  }
  lines.push(...reviewerReadinessContextLines(editor, snapshot));
  if (editor.kind === 'model-compare-handoff-diff') {
    const left = editor.fields.find((field) => field.id === 'leftArtifactId')?.value.trim();
    const right = editor.fields.find((field) => field.id === 'rightArtifactId')?.value.trim();
    lines.push(
      { text: 'Split view: compare left and right reviewer handoff artifacts without changing model routing.', fg: PALETTE.good },
      { text: 'Section jumps: all, metadata, policy, related, comparison.', fg: PALETTE.info },
      left && right
        ? { text: `Current diff: ${left} -> ${right}.`, fg: PALETTE.good }
        : { text: 'No complete handoff pair selected; submitting lists recent saved handoffs.', fg: PALETTE.info },
    );
    if (snapshot?.recentReviewerHandoffArtifacts.length) {
      const choices = snapshot.recentReviewerHandoffArtifacts
        .slice(0, 4)
        .map((artifact) => `${artifact.id} (${artifact.sourceKind}; related ${artifact.relatedArtifactCount})`)
        .join(', ');
      lines.push({ text: `Recent choices: ${choices}.`, fg: PALETTE.muted });
    }
  } else if (editor.kind === 'document-reviewer-readiness') {
    lines.push(
      { text: 'Preflight checks: comments, suggestions, source artifacts, comparison reveal, route decisions, handoff evidence.', fg: PALETTE.info },
      { text: 'Use before export, handoff archive, or applying a comparison winner.', fg: PALETTE.good },
    );
  }
  return lines;
}

function buildContextRows(workspace: AgentWorkspace, category: AgentWorkspaceCategory, action: AgentWorkspaceAction | null, width: number): WorkspaceRow[] {
  const lines: ContextLine[] = [
    { text: category.label, fg: PALETTE.title, bold: true },
    { text: category.summary, fg: PALETTE.subtitle },
    ...(workspace.actionSearchActive ? [
      { text: 'Action Search', fg: PALETTE.title, bold: true },
      {
        text: workspace.actionSearchQuery.length > 0
          ? `Query: ${workspace.actionSearchQuery} (${workspace.actionSearchResults.length} result${workspace.actionSearchResults.length === 1 ? '' : 's'})`
          : 'Type to search every Agent workspace action.',
        fg: workspace.actionSearchQuery.length > 0 && workspace.actionSearchResults.length === 0 ? PALETTE.warn : PALETTE.info,
      },
      { text: 'Enter opens; Esc clears.', fg: PALETTE.muted },
    ] satisfies ContextLine[] : []),
    ...(workspace.localEditor ? editorContextLines(workspace.localEditor, workspace.runtimeSnapshot) : []),
  ];

  const selectedActionLines: ContextLine[] = action
    ? [
      { text: `Selected: ${action.label}`, fg: PALETTE.title, bold: true },
      actionMetaLine(workspace, category, action),
    ]
    : [];
  const snapshotContextLines = snapshotLines(workspace, category, workspace.runtimeSnapshot);
  lines.push(...selectedActionLines, ...snapshotContextLines);

  const onboarding = isOnboardingCategory(category);
  if (workspace.lastActionResult) {
    lines.push(
      { text: onboarding ? 'Result' : 'Action Result', fg: PALETTE.title, bold: true },
      { text: workspace.lastActionResult.title, fg: actionResultColor(workspace.lastActionResult), bold: true },
      { text: compactText(workspace.lastActionResult.detail), fg: PALETTE.text },
    );
    if (!onboarding && workspace.lastActionResult.command) {
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

function buildEditorRows(editor: AgentWorkspaceLocalEditor, width: number, height: number): WorkspaceRow[] {
  const rows: WorkspaceRow[] = [
    { text: editor.title, fg: PALETTE.title, bold: true },
    { text: editor.message, fg: PALETTE.info },
    { text: '' },
  ];
  const footerRows: WorkspaceRow[] = [
    { text: '' },
    { text: 'Enter next/save · Up/Down field · Backspace edit · Ctrl-J newline · Esc cancel', fg: PALETTE.muted },
  ];
  const visibleFields = Math.max(1, Math.floor(Math.max(1, height - rows.length - footerRows.length) / 3));
  const window = stableWindow(editor.fields.length, editor.selectedFieldIndex, visibleFields);
  if (window.start > 0) rows.push({ text: `${GLYPHS.navigation.moreAbove} ${window.start} more field(s) above`, kind: 'more', fg: PALETTE.dim, dim: true });
  for (let index = window.start; index < window.end; index += 1) {
    rows.push(...buildEditorFieldRows(editor, index, width));
  }
  if (window.end < editor.fields.length) rows.push({ text: `${GLYPHS.navigation.moreBelow} ${editor.fields.length - window.end} more field(s) below`, kind: 'more', fg: PALETTE.dim, dim: true });
  rows.push(...footerRows);
  while (rows.length < height) rows.push({ text: '', kind: 'empty' });
  return rows.slice(0, height);
}

function buildEditorFieldRows(editor: AgentWorkspaceLocalEditor, index: number, width: number): WorkspaceRow[] {
  const field = editor.fields[index]!;
  const selected = index === editor.selectedFieldIndex;
  const marker = selected ? GLYPHS.navigation.selected : ' ';
  const required = field.required ? ' *' : '';
  const value = field.value.length > 0
    ? field.redact ? '*'.repeat(Math.min(12, Math.max(6, Array.from(field.value).length))) : field.value
    : '(empty)';
  const color = selected ? PALETTE.text : field.value.length > 0 ? PALETTE.info : PALETTE.muted;
  const rows: WorkspaceRow[] = [{
    text: `${marker} ${field.label}${required}`,
    selected,
    fg: color,
    bold: selected,
  }];
  const valueLines = value.split('\n');
  for (const valueLine of valueLines.slice(0, 4)) {
    for (const wrapped of wrapText(`  ${valueLine}`, Math.max(1, width - 2))) {
      rows.push({ text: wrapped, fg: field.value.length > 0 ? PALETTE.text : PALETTE.dim, dim: field.value.length === 0 });
    }
  }
  if (valueLines.length > 4) rows.push({ text: `  ${valueLines.length - 4} more line(s)`, fg: PALETTE.dim, dim: true });
  rows.push({ text: `  ${field.hint}`, fg: PALETTE.dim, dim: true });
  return rows;
}

function buildActionRows(workspace: AgentWorkspace, width: number, height: number): WorkspaceRow[] {
  if (workspace.localEditor) return buildEditorRows(workspace.localEditor, width, height);
  const category = workspace.selectedActionCategory;
  const onboarding = isOnboardingCategory(category);
  const rows: WorkspaceRow[] = [];
  const labelWidth = Math.min(34, Math.max(18, Math.floor(width * 0.38)));
  const commandWidth = Math.max(10, width - labelWidth - 6);
  if (workspace.actionSearchActive) {
    rows.push({
      text: `  Search: ${workspace.actionSearchQuery || '(type to filter actions)'}`,
      fg: workspace.actionSearchQuery.length > 0 && workspace.actions.length === 0 ? PALETTE.warn : PALETTE.info,
      bold: true,
    });
  }
  rows.push({
    text: `  ${padDisplay(workspace.actionSearchActive ? 'Result' : onboarding ? 'Option' : 'Action', labelWidth)}  ${padDisplay(onboarding ? 'Change' : 'Does', commandWidth)}`,
    fg: PALETTE.muted,
    bold: true,
  });

  const actions = workspace.actions;
  const visible = Math.max(1, height - (workspace.actionSearchActive ? 3 : 2));
  const window = stableWindow(actions.length, workspace.selectedActionIndex, visible);
  if (window.start > 0) rows.push({ text: `${GLYPHS.navigation.moreAbove} ${window.start} more action(s) above`, kind: 'more', fg: PALETTE.dim, dim: true });

  for (let index = window.start; index < window.end; index += 1) {
    const action = actions[index]!;
    const selected = index === workspace.selectedActionIndex;
    const searchResult = workspace.actionSearchActive ? workspace.actionSearchResults[index] : null;
    const actionCategory = searchResult?.category ?? category;
    const label = searchResult ? `${searchResult.category.label} / ${action.label}` : action.label;
    const marker = selected ? GLYPHS.navigation.selected : ' ';
    rows.push({
      text: `${marker} ${padDisplay(label, labelWidth)}  ${padDisplay(actionChange(workspace, actionCategory, action), commandWidth)}`,
      selected: selected && workspace.focusPane === 'actions',
      fg: action.safety === 'blocked' ? PALETTE.warn : selected ? PALETTE.text : PALETTE.info,
      bold: selected,
    });
  }

  if (window.end < actions.length) rows.push({ text: `${GLYPHS.navigation.moreBelow} ${actions.length - window.end} more action(s) below`, kind: 'more', fg: PALETTE.dim, dim: true });
  rows.push({ text: '' });
  rows.push({ text: `Status: ${workspace.status}`, fg: PALETTE.muted });
  if (workspace.lastActionResult) {
    rows.push({ text: '' });
    rows.push({ text: `${onboarding ? 'Result' : 'Action Result'}: ${workspace.lastActionResult.title}`, fg: actionResultColor(workspace.lastActionResult), bold: true });
    for (const line of wrapText(workspace.lastActionResult.detail, Math.max(1, width - 2))) {
      rows.push({ text: `  ${line}`, fg: PALETTE.text });
    }
    if (!onboarding && workspace.lastActionResult.command) {
      rows.push({ text: `  Command: ${workspace.lastActionResult.command}`, fg: PALETTE.muted });
    }
  }

  while (rows.length < height) rows.push({ text: '', kind: 'empty' });
  return rows.slice(0, height);
}

function footerText(workspace: AgentWorkspace): string {
  if (workspace.localEditor) {
    return `Agent workspace · editing ${workspace.localEditor.kind} · Enter next/save · Ctrl-J newline · Esc cancel`;
  }
  if (workspace.actionSearchActive) {
    return 'Agent workspace · action search · type filter · Up/Down results · Enter open · Esc clear';
  }
  const focus = workspace.focusPane === 'categories' ? 'categories' : 'actions';
  return `Agent workspace · ${focus} · / search · Up/Down · Left/Right · Ctrl+[/] area · Enter open/action · R refresh · Esc close`;
}

export function renderAgentWorkspace(workspace: AgentWorkspace, width: number, height: number): Line[] {
  const category = workspace.selectedActionCategory;
  const action = workspace.selectedAction;
  const layoutOptions = {
    width,
    height,
    leftWidth: width < 90 ? undefined : 30,
    contextRatio: 0.4,
    minContextRows: 10,
  };
  const metrics = getFullscreenWorkspaceMetrics(layoutOptions);

  return renderFullscreenWorkspace({
    width,
    height,
    title: 'GoodVibes Agent / Operator Workspace',
    stateLabel: workspace.localEditor ? 'Editor' : workspace.actionSearchActive ? 'Search' : workspace.focusPane === 'categories' ? 'Categories' : 'Actions',
    leftHeader: 'Operator Areas',
    mainHeader: workspace.actionSearchActive
      ? `Search actions · ${workspace.actions.length} result(s)`
      : `${category.label} · ${workspace.actions.length} action(s)`,
    leftRows: buildLeftRows(workspace, metrics.bodyRows),
    contextRows: buildContextRows(workspace, category, action, metrics.contextWidth),
    controlRows: buildActionRows(workspace, metrics.contextWidth, metrics.controlRows),
    footer: footerText(workspace),
    leftWidth: layoutOptions.leftWidth,
    contextRatio: layoutOptions.contextRatio,
    minContextRows: layoutOptions.minContextRows,
  });
}
