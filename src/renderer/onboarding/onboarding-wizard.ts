import type { Line } from '../../types/grid.ts';
import { getDisplayWidth, truncateDisplay, wrapText } from '../../utils/terminal-width.ts';
import {
  getFullscreenWorkspaceMetrics,
  renderFullscreenWorkspace,
  stableWindow,
  WORKSPACE_PALETTE as PALETTE,
  type WorkspaceRow,
} from './onboarding-workspace.ts';
import { GLYPHS } from '../ui-primitives.ts';
import {
  type OnboardingWizardController,
  type OnboardingWizardFieldDefinition,
  type OnboardingWizardStepDefinition,
} from '../../input/onboarding/onboarding-wizard.ts';

type RenderedFieldRow =
  | { readonly kind: 'empty' }
  | { readonly kind: 'moreAbove'; readonly text: string }
  | { readonly kind: 'moreBelow'; readonly text: string }
  | {
      readonly kind: 'field';
      readonly field: OnboardingWizardFieldDefinition;
      readonly absoluteIndex: number;
    };

function modeLabel(mode: OnboardingWizardController['mode']): string {
  if (mode === 'edit') return 'Edit existing';
  if (mode === 'reopen') return 'Reopen review';
  return 'New setup';
}

function changedScreensLabel(wizard: OnboardingWizardController): string {
  if (wizard.dirtyStepCount === 0) return 'no changes';
  if (wizard.dirtyStepCount === 1) return '1 changed screen';
  return `${wizard.dirtyStepCount} changed screens`;
}

function stepGlyph(
  wizard: OnboardingWizardController,
  step: OnboardingWizardStepDefinition,
  stepIndex: number,
): { readonly glyph: string; readonly fg: string } {
  if (stepIndex === wizard.stepIndex) return { glyph: GLYPHS.navigation.selected, fg: PALETTE.info };

  const total = wizard.getStepFieldCount(stepIndex);
  const completed = wizard.getCompletedFieldCount(stepIndex);
  if (wizard.isStepDirty(stepIndex)) return { glyph: GLYPHS.status.review, fg: PALETTE.warn };
  if (total > 0 && completed === total) return { glyph: GLYPHS.status.success, fg: PALETTE.good };
  return { glyph: GLYPHS.status.pending, fg: PALETTE.muted };
}

function fieldRowPrefix(
  wizard: OnboardingWizardController,
  field: OnboardingWizardFieldDefinition,
  selected: boolean,
): string {
  if (selected) return `${GLYPHS.navigation.selected} `;
  if (wizard.isFieldDirty(field.id)) return `${GLYPHS.status.skipped} `;
  if (field.kind === 'checklist') return (wizard.getFieldValue(field) as boolean) ? `${GLYPHS.status.success} ` : '□ ';
  if (field.kind === 'acknowledgement') return (wizard.getFieldValue(field) as boolean) ? `${GLYPHS.status.success} ` : '□ ';
  if (field.kind === 'action') return `${GLYPHS.navigation.next} `;
  if (field.kind === 'radio') return `${GLYPHS.status.active} `;
  return '  ';
}

function fieldColor(
  wizard: OnboardingWizardController,
  field: OnboardingWizardFieldDefinition,
  selected: boolean,
): string {
  if (selected) return PALETTE.text;
  if (field.kind === 'status' || field.kind === 'modelPicker') return PALETTE.info;
  if (field.kind === 'masked') return PALETTE.warn;
  if (field.kind === 'acknowledgement') return (wizard.getFieldValue(field) as boolean) ? PALETTE.good : PALETTE.warn;
  if (field.kind === 'checklist') return (wizard.getFieldValue(field) as boolean) ? PALETTE.good : PALETTE.muted;
  if (wizard.getFieldValueLabel(field) === 'Missing') return PALETTE.warn;
  return PALETTE.text;
}

function formatEditingValue(value: string, multiline: boolean): string {
  if (!multiline) return value;
  const lines = value.split(/\r?\n/);
  if (lines.length <= 1) return value;
  const preview = lines[lines.length - 1] ?? '';
  return `${preview} (${lines.length} lines)`;
}

function fieldHint(
  wizard: OnboardingWizardController,
  field: OnboardingWizardFieldDefinition,
  selected: boolean,
): string {
  if (
    selected
    && wizard.isEditingTextField()
    && wizard.editingFieldId === field.id
    && (field.kind === 'text' || field.kind === 'masked')
  ) {
    const rawValue = wizard.editBuffer.length > 0 ? wizard.editBuffer : field.placeholder;
    const editingValue = field.kind === 'masked' && wizard.editBuffer.length > 0
      ? '•'.repeat(Math.min(12, Math.max(4, wizard.editBuffer.length)))
      : formatEditingValue(rawValue, field.kind === 'text' && field.multiline === true);
    return `Editing: ${editingValue}${GLYPHS.surface.cursor}`;
  }

  if (selected && field.kind === 'modelPicker') return `${field.hint} Press Enter to open picker.`;
  if (selected && field.kind === 'text') {
    return field.multiline === true
      ? `${field.hint} Press Enter to edit; Ctrl-J inserts a new line.`
      : `${field.hint} Press Enter to edit inline.`;
  }
  if (selected && field.kind === 'masked') return `${field.hint} Press Enter to edit inline.`;
  return field.hint;
}

function selectedFieldText(wizard: OnboardingWizardController): {
  readonly title: string;
  readonly hint: string;
} {
  if (wizard.isEditingTextField() && wizard.editingFieldId !== null) {
    const editingField = wizard.getFieldById(wizard.editingFieldId);
    if (editingField) {
      return {
        title: `Editing: ${editingField.label}`,
        hint: fieldHint(wizard, editingField, true),
      };
    }
  }

  const field = wizard.getSelectedField();
  if (!field) return { title: 'Selected: none', hint: 'No selectable row is active on this screen.' };

  return {
    title: `Selected: ${field.label} [${wizard.getFieldValueLabel(field)}]`,
    hint: fieldHint(wizard, field, true),
  };
}

function footerText(wizard: OnboardingWizardController): string {
  if (wizard.isEditingTextField()) {
    return wizard.isEditingMultilineTextField()
      ? 'Controls: [Enter] save · [Ctrl-J] new line · [Esc] cancel · [Backspace] delete · [Del/Ctrl+U] clear'
      : 'Controls: [Enter] save · [Esc] cancel · [Backspace] delete · [Del/Ctrl+U] clear';
  }

  return 'Controls: [Enter] toggle/open · [Esc] close · [Tab/Shift+Tab] screen · [Up/Down] move · [Del/Ctrl+U] clear';
}

function controlsText(wizard: OnboardingWizardController): string {
  if (wizard.isEditingTextField()) {
    return wizard.isEditingMultilineTextField()
      ? 'Controls: Enter saves, Ctrl-J inserts a line, Esc cancels, Backspace deletes, Del clears.'
      : 'Controls: Enter saves, Esc cancels, Backspace deletes, Del clears.';
  }

  return 'Controls: Enter selects, Del clears, Tab moves.';
}

function buildFieldRows(
  wizard: OnboardingWizardController,
  visibleFields: number,
  capacity: number,
): readonly RenderedFieldRow[] {
  wizard.ensureSelectionVisible(visibleFields);
  const fields = wizard.currentStep.fields;
  const rows: RenderedFieldRow[] = [];
  if (fields.length === 0 || capacity <= 0) return rows;

  const allRows: RenderedFieldRow[] = [];
  fields.forEach((field, absoluteIndex) => {
    const spacerRows = Math.max(0, field.spacerBeforeRows ?? 0);
    for (let index = 0; index < spacerRows; index += 1) allRows.push({ kind: 'empty' });
    allRows.push({ kind: 'field', field, absoluteIndex });
  });

  const selectedFieldIndex = wizard.getSelectedFieldIndex();
  const selectedRowIndex = Math.max(0, allRows.findIndex((row) => row.kind === 'field' && row.absoluteIndex === selectedFieldIndex));
  const scrollFieldIndex = wizard.scrollOffsets[wizard.stepIndex] ?? 0;
  const scrollRowIndex = allRows.findIndex((row) => row.kind === 'field' && row.absoluteIndex === scrollFieldIndex);
  const maxStart = Math.max(0, allRows.length - capacity);
  let start = Math.max(0, Math.min(scrollRowIndex >= 0 ? scrollRowIndex : 0, maxStart));

  if (selectedRowIndex < start) start = selectedRowIndex;
  if (selectedRowIndex >= start + capacity) start = selectedRowIndex - capacity + 1;
  start = Math.max(0, Math.min(start, maxStart));

  if (capacity > 1 && start > 0 && selectedRowIndex === start) start = Math.max(0, start - 1);
  if (capacity > 1 && start + capacity < allRows.length && selectedRowIndex === start + capacity - 1) {
    start = Math.min(maxStart, start + 1);
  }

  rows.push(...allRows.slice(start, start + capacity));
  const firstVisibleRow = rows[0];
  if (
    start > 0
    && rows.length > 0
    && !(firstVisibleRow?.kind === 'field' && firstVisibleRow.absoluteIndex === selectedFieldIndex)
  ) {
    rows[0] = { kind: 'moreAbove', text: `${GLYPHS.navigation.moreAbove} ${start} more above` };
  }

  const hiddenBelow = Math.max(0, allRows.length - (start + capacity));
  const lastVisibleRow = rows[rows.length - 1];
  if (
    hiddenBelow > 0
    && rows.length > 0
    && !(lastVisibleRow?.kind === 'field' && lastVisibleRow.absoluteIndex === selectedFieldIndex)
  ) {
    rows[rows.length - 1] = { kind: 'moreBelow', text: `${GLYPHS.navigation.moreBelow} ${hiddenBelow} more below` };
  }

  while (rows.length < capacity) rows.push({ kind: 'empty' });
  return rows.slice(0, capacity);
}

function pushWrapped(
  rows: WorkspaceRow[],
  text: string,
  width: number,
  options: Partial<WorkspaceRow> = {},
): void {
  if (text.length === 0) {
    rows.push({ text: '', kind: 'empty' });
    return;
  }
  for (const line of wrapText(text, Math.max(1, width))) {
    rows.push({ text: line, ...options });
  }
}

function buildStepRows(wizard: OnboardingWizardController, height: number): WorkspaceRow[] {
  const rendered = wizard.steps.map((step, stepIndex): WorkspaceRow => {
    const selected = stepIndex === wizard.stepIndex;
    const state = stepGlyph(wizard, step, stepIndex);
    const completion = `${wizard.getCompletedFieldCount(stepIndex)}/${wizard.getStepFieldCount(stepIndex)}`;
    return {
      text: `${state.glyph} ${stepIndex + 1}. ${step.shortLabel} ${completion}`,
      selected,
      kind: 'item',
      fg: state.fg,
      bold: selected,
    };
  });

  const visible = Math.max(1, height);
  const window = stableWindow(rendered.length, wizard.stepIndex, visible);
  const rows = rendered.slice(window.start, window.end);
  if (window.start > 0 && rows.length > 0) {
    rows[0] = { text: `${GLYPHS.navigation.moreAbove} ${window.start} more step(s) above`, kind: 'more', fg: PALETTE.dim, dim: true };
  }
  if (window.end < rendered.length && rows.length > 0) {
    rows[rows.length - 1] = { text: `${GLYPHS.navigation.moreBelow} ${rendered.length - window.end} more step(s) below`, kind: 'more', fg: PALETTE.dim, dim: true };
  }
  while (rows.length < height) rows.push({ text: '', kind: 'empty' });
  return rows.slice(0, height);
}

function buildContextRows(wizard: OnboardingWizardController, width: number): WorkspaceRow[] {
  const step = wizard.currentStep;
  const selected = selectedFieldText(wizard);
  const rows: WorkspaceRow[] = [
    { text: step.title, fg: PALETTE.title, bold: true },
  ];
  const pushSummaryRows = () => {
    rows.push({ text: 'Summary', fg: PALETTE.subtitle, bold: true });
    rows.push({ text: step.summaryTitle, fg: PALETTE.info, bold: true });
    for (const line of step.summaryLines.slice(0, 4)) {
      pushWrapped(rows, line, width, { fg: PALETTE.text });
    }
    rows.push({
      text: `Fields ${wizard.getCompletedFieldCount(wizard.stepIndex)}/${wizard.getStepFieldCount(wizard.stepIndex)} complete · ${changedScreensLabel(wizard)}`,
      fg: wizard.dirtyStepCount > 0 ? PALETTE.warn : PALETTE.muted,
    });
  };
  const pushSelectedRows = () => {
    rows.push({ text: selected.title, fg: PALETTE.info, bold: true });
    pushWrapped(rows, selected.hint, width, { fg: PALETTE.text });
    pushWrapped(rows, controlsText(wizard), width, { fg: PALETTE.info });
  };

  pushWrapped(rows, step.description, width, { fg: PALETTE.text });
  rows.push({ text: '', kind: 'empty' });

  if (wizard.isEditingTextField()) {
    pushSelectedRows();
    rows.push({ text: '', kind: 'empty' });
    pushSummaryRows();
  } else {
    pushSummaryRows();
    rows.push({ text: '', kind: 'empty' });
    pushSelectedRows();
  }

  if (wizard.hydrationPending || wizard.hydrationError !== null || wizard.applyFeedback !== null) {
    rows.push({ text: '', kind: 'empty' });
  }
  if (wizard.hydrationPending) {
    rows.push({ text: 'Loading current settings...', fg: PALETTE.info, bold: true });
  }
  if (wizard.hydrationError !== null) {
    pushWrapped(rows, `Current settings could not load: ${wizard.hydrationError}`, width, { fg: PALETTE.bad, bold: true });
  }
  if (wizard.applyFeedback !== null) {
    const feedbackColor = wizard.applyFeedback.severity === 'error'
      ? PALETTE.bad
      : wizard.applyFeedback.severity === 'warning'
        ? PALETTE.warn
        : PALETTE.info;
    rows.push({ text: wizard.applyFeedback.title, fg: feedbackColor, bold: true });
    pushWrapped(rows, wizard.applyFeedback.summary, width, { fg: PALETTE.text });
    for (const message of wizard.applyFeedback.messages) {
      pushWrapped(rows, message, width, { fg: PALETTE.muted });
    }
  }

  return rows;
}

function formatFieldRowText(wizard: OnboardingWizardController, field: OnboardingWizardFieldDefinition, selected: boolean, width: number): string {
  const badge = `[${wizard.getFieldValueLabel(field)}]`;
  const badgeWidth = getDisplayWidth(badge);
  const labelWidth = Math.max(1, width - badgeWidth - 2);
  const label = truncateDisplay(`${fieldRowPrefix(wizard, field, selected)}${field.label}`, labelWidth);
  return `${label}${' '.repeat(Math.max(1, width - getDisplayWidth(label) - badgeWidth))}${badge}`;
}

function buildControlRows(wizard: OnboardingWizardController, width: number, height: number): WorkspaceRow[] {
  const visibleFields = Math.max(1, height);
  const fieldRows = buildFieldRows(wizard, visibleFields, height);
  const rows = fieldRows.map((row): WorkspaceRow => {
    if (row.kind === 'empty') return { text: '', kind: 'empty' };
    if (row.kind === 'moreAbove' || row.kind === 'moreBelow') {
      return { text: row.text, kind: 'more', fg: PALETTE.dim, dim: true };
    }

    const selected = row.absoluteIndex === wizard.getSelectedFieldIndex();
    return {
      text: formatFieldRowText(wizard, row.field, selected, width),
      selected,
      kind: 'item',
      fg: fieldColor(wizard, row.field, selected),
      bold: selected || row.field.kind === 'action',
    };
  });

  while (rows.length < height) rows.push({ text: '', kind: 'empty' });
  return rows.slice(0, height);
}

export function renderOnboardingWizard(
  wizard: OnboardingWizardController,
  width: number,
  viewportHeight: number,
): Line[] {
  const layoutOptions = {
    width,
    height: viewportHeight,
    leftWidth: width < 90 ? undefined : 30,
    contextRatio: 0.42,
    minContextRows: 8,
  };
  const metrics = getFullscreenWorkspaceMetrics(layoutOptions);

  return renderFullscreenWorkspace({
    width,
    height: viewportHeight,
    title: 'GoodVibes Agent / Onboarding Wizard',
    stateLabel: `${modeLabel(wizard.mode)} · ${wizard.stepIndex + 1}/${wizard.steps.length} · ${changedScreensLabel(wizard)}`,
    leftHeader: 'Steps',
    mainHeader: wizard.currentStep.title,
    leftRows: buildStepRows(wizard, metrics.bodyRows),
    contextRows: buildContextRows(wizard, metrics.contextWidth),
    controlRows: buildControlRows(wizard, metrics.contextWidth, metrics.controlRows),
    footer: footerText(wizard),
    leftWidth: layoutOptions.leftWidth,
    contextRatio: layoutOptions.contextRatio,
    minContextRows: layoutOptions.minContextRows,
  });
}
