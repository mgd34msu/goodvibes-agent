import type { AgentWorkspaceActionResult, AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import type { AgentWorkspaceOperationsCommandEditorKind } from './agent-workspace-operations-command-editors.ts';
import { isAgentWorkspaceOperationsCommandEditorKind } from './agent-workspace-operations-command-editors.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

function isAffirmative(value: string): boolean {
  return /^(y|yes|true)$/i.test(value.trim());
}

function optionalNoteArgs(value: string): string {
  const trimmed = value.trim();
  return trimmed ? ` --note ${quoteSlashCommandArg(trimmed)}` : '';
}

function optionalRememberArgs(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return isAffirmative(trimmed) ? ' --remember' : ' --no-remember';
}

function unconfirmed(editor: AgentWorkspaceLocalEditor, message: string): AgentWorkspaceOperationsCommandEditorSubmission {
  return {
    kind: 'editor',
    editor: { ...editor, message },
    status: message,
  };
}

export type AgentWorkspaceOperationsCommandEditorSubmission =
  | {
    readonly kind: 'editor';
    readonly editor: AgentWorkspaceLocalEditor;
    readonly status: string;
    readonly actionResult?: AgentWorkspaceActionResult;
  }
  | {
    readonly kind: 'dispatch';
    readonly command: string;
    readonly status: string;
    readonly actionResult: AgentWorkspaceActionResult;
  };

export function isAgentWorkspaceOperationsCommandSubmissionKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceOperationsCommandEditorKind {
  return isAgentWorkspaceOperationsCommandEditorKind(kind);
}

export function buildAgentWorkspaceOperationsCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
): AgentWorkspaceOperationsCommandEditorSubmission {
  if (editor.kind === 'plan-seed') {
    const command = `/plan ${quoteSlashCommandArg(readField('goal'))}`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening planning goal seeding.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening planning goal seeding',
        detail: 'The workspace handed a concrete planning goal to the shell-owned command router without creating coding-role Agent jobs.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'plan-approve') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Planning approval not confirmed. Type yes, then press Enter.');
    return {
      kind: 'dispatch',
      command: '/plan approve --yes',
      status: 'Opening planning approval.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening planning approval',
        detail: 'The workspace handed confirmed planning approval to the shell-owned command router.',
        command: '/plan approve --yes',
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'plan-override') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Planning strategy override not confirmed. Type yes, then press Enter.');
    const command = `/plan override ${quoteSlashCommandArg(readField('strategy'))} --yes`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening planning strategy override.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening planning strategy override',
        detail: 'The workspace handed a confirmed planning strategy override to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'plan-clear') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Planning clear not confirmed. Type yes, then press Enter.');
    return {
      kind: 'dispatch',
      command: '/plan clear --yes',
      status: 'Opening planning clear.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening planning clear',
        detail: 'The workspace handed confirmed planning-state clearing to the shell-owned command router.',
        command: '/plan clear --yes',
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'approval-approve' || editor.kind === 'approval-deny' || editor.kind === 'approval-cancel') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Approval action not confirmed. Type yes, then press Enter.');
    const verb = editor.kind.replace('approval-', '');
    const command = `/approval ${verb} ${quoteSlashCommandArg(readField('approvalId'))}${optionalNoteArgs(readField('note'))}${optionalRememberArgs(readField('remember'))} --yes`;
    const title = `${verb[0]?.toUpperCase() ?? ''}${verb.slice(1)} approval`;
    return {
      kind: 'dispatch',
      command,
      status: `${title}.`,
      actionResult: {
        kind: 'dispatched',
        title,
        detail: 'The workspace handed an explicit confirmed approval action to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (
    editor.kind === 'automation-job-run'
    || editor.kind === 'automation-job-pause'
    || editor.kind === 'automation-job-resume'
    || editor.kind === 'automation-run-cancel'
    || editor.kind === 'automation-run-retry'
    || editor.kind === 'schedule-run'
  ) {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Automation action not confirmed. Type yes, then press Enter.');
    const command = editor.kind === 'automation-job-run'
      ? `/automation job run ${quoteSlashCommandArg(readField('jobId'))} --yes`
      : editor.kind === 'automation-job-pause'
        ? `/automation job pause ${quoteSlashCommandArg(readField('jobId'))} --yes`
        : editor.kind === 'automation-job-resume'
          ? `/automation job resume ${quoteSlashCommandArg(readField('jobId'))} --yes`
          : editor.kind === 'automation-run-cancel'
            ? `/automation run cancel ${quoteSlashCommandArg(readField('runId'))} --yes`
            : editor.kind === 'automation-run-retry'
              ? `/automation run retry ${quoteSlashCommandArg(readField('runId'))} --yes`
              : `/automation schedule run ${quoteSlashCommandArg(readField('scheduleId'))} --yes`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening confirmed automation action.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening confirmed automation action',
        detail: 'The workspace handed an explicit connected-host automation action to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'routine-receipt' || editor.kind === 'schedule-receipt') {
    const routine = editor.kind === 'routine-receipt';
    const command = `/${routine ? 'routines' : 'schedule'} receipt ${quoteSlashCommandArg(readField('receiptId'))}`;
    const title = routine ? 'Opening routine receipt' : 'Opening schedule receipt';
    return {
      kind: 'dispatch',
      command,
      status: `${title}.`,
      actionResult: {
        kind: 'dispatched',
        title,
        detail: routine
          ? 'The workspace handed read-only routine receipt inspection to the shell-owned command router.'
          : 'The workspace handed read-only schedule receipt inspection to the shell-owned command router.',
        command,
        safety: 'read-only',
      },
    };
  }
  const plan = editor.kind === 'plan-show';
  const approval = editor.kind === 'approval-review';
  const command = plan
    ? `/plan show ${quoteSlashCommandArg(readField('planId'))}`
    : approval
      ? `/approval review ${quoteSlashCommandArg(readField('kind'))}`
      : `/health repair ${quoteSlashCommandArg(readField('domain'))}`;
  const title = plan ? 'Opening saved plan' : approval ? 'Opening approval review' : 'Opening health repair guidance';
  return {
    kind: 'dispatch',
    command,
    status: `${title}.`,
    actionResult: {
      kind: 'dispatched',
      title,
      detail: plan
        ? 'The workspace handed read-only saved-plan inspection to the shell-owned command router.'
        : approval
          ? 'The workspace handed read-only approval class review to the shell-owned command router.'
          : 'The workspace handed read-only health repair guidance to the shell-owned command router.',
      command,
      safety: 'read-only',
    },
  };
}
