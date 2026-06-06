import type { AgentWorkspaceActionResult, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export interface AgentModelCompareWorkspaceToolArgs {
  readonly mode: 'run';
  readonly prompt: string;
  readonly artifactId?: string;
  readonly modelRefs?: readonly string[];
  readonly candidateCount?: number;
  readonly rubric?: string;
  readonly systemPrompt?: string;
  readonly maxTokens?: number;
  readonly benchmarkKind?: string;
  readonly taskType?: string;
  readonly documentId?: string;
  readonly reveal?: boolean;
  readonly confirm: boolean;
  readonly explicitUserRequest: string;
}

export interface AgentModelCompareReviewWorkspaceToolArgs {
  readonly mode: 'review' | 'sideBySide';
  readonly comparisonId?: string;
  readonly artifactId?: string;
  readonly relatedArtifactIds?: readonly string[];
  readonly previewBytes?: number;
  readonly reveal?: boolean;
}

export interface AgentModelCompareJudgmentWorkspaceToolArgs {
  readonly mode: 'judge';
  readonly comparisonId?: string;
  readonly artifactId?: string;
  readonly winnerBlindId: string;
  readonly reasons: string;
  readonly notes?: string;
  readonly reveal?: boolean;
  readonly confirm: boolean;
  readonly explicitUserRequest: string;
}

export interface AgentModelCompareApplyWorkspaceToolArgs {
  readonly mode: 'apply';
  readonly artifactId: string;
  readonly confirm: boolean;
  readonly explicitUserRequest: string;
}

export interface AgentModelCompareExportWorkspaceToolArgs {
  readonly mode: 'export' | 'handoff' | 'handoffArchive';
  readonly artifactId: string;
  readonly relatedArtifactIds?: readonly string[];
  readonly reveal?: boolean;
  readonly confirm: boolean;
  readonly explicitUserRequest: string;
}

export interface AgentModelCompareAnalyticsWorkspaceToolArgs {
  readonly mode: 'analytics' | 'synthesis';
  readonly limit?: number;
  readonly includeReasons?: boolean;
  readonly benchmarkKind?: string;
  readonly taskType?: string;
  readonly documentId?: string;
}

function readList(value: string): readonly string[] {
  return value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
}

function readPositiveInteger(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1, Math.trunc(parsed));
}

function isAffirmative(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'yes' || normalized === 'true';
}

function compareExportMode(value: string): AgentModelCompareExportWorkspaceToolArgs['mode'] {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'handoff' || normalized === 'reviewerhandoff') return 'handoff';
  if (normalized === 'archive' || normalized === 'zip' || normalized === 'handoffarchive' || normalized === 'handoffzip') return 'handoffArchive';
  return 'export';
}

function quoteBlock(value: string): string {
  return value.trim() || '(blank)';
}

export function createAgentModelCompareEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'model-compare',
    mode: 'create',
    title: 'Run Blind Model Compare',
    selectedFieldIndex: 0,
    message: 'Run one prompt against two to four selectable models and save a local JSON review artifact. Leave models blank to auto-select candidates. Type yes on the final field to confirm.',
    fields: [
      { id: 'prompt', label: 'Prompt', value: '', required: true, multiline: true, hint: 'Exact prompt sent identically to every candidate model. Ctrl-J inserts a new line.' },
      { id: 'artifactId', label: 'Source artifact', value: '', required: false, multiline: false, hint: 'Optional saved text artifact id to include identically in the candidate prompt.' },
      { id: 'modelRefs', label: 'Models', value: '', required: false, multiline: true, hint: 'Optional registry keys or model ids, separated by commas or new lines. Blank auto-selects.' },
      { id: 'candidateCount', label: 'Auto count', value: '2', required: false, multiline: false, hint: 'Used only when Models is blank. 2 to 4.' },
      { id: 'rubric', label: 'Rubric', value: '', required: false, multiline: true, hint: 'Optional judging rubric shown with blinded results.' },
      { id: 'systemPrompt', label: 'System prompt', value: '', required: false, multiline: true, hint: 'Optional system prompt sent identically to every candidate.' },
      { id: 'maxTokens', label: 'Max tokens', value: '2048', required: false, multiline: false, hint: 'Per-candidate output cap. Defaults to 2048.' },
      { id: 'benchmarkKind', label: 'Benchmark tag', value: '', required: false, multiline: false, hint: 'Optional benchmark tag for filtered analytics.' },
      { id: 'taskType', label: 'Task type', value: '', required: false, multiline: false, hint: 'Optional tag such as writing, research, code-review, or benchmark.' },
      { id: 'documentId', label: 'Document id', value: '', required: false, multiline: false, hint: 'Optional document id tag. Source document exports can fill this automatically.' },
      { id: 'reveal', label: 'Reveal now', value: 'no', required: false, multiline: false, hint: 'yes/no. Blank or no keeps model identities hidden until reveal.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run a token-spending model comparison and save the local review artifact.' },
    ],
  };
}

export function createAgentLocalModelBenchmarkEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'local-model-benchmark',
    mode: 'create',
    title: 'Run Local Model Benchmark',
    selectedFieldIndex: 0,
    message: 'Run the local-route benchmark with the first-class blind comparison tool and save a tagged local review artifact. Enter a local model route plus a baseline route, then type yes on the final field.',
    fields: [
      {
        id: 'prompt',
        label: 'Prompt',
        value: [
          'Benchmark this local route on one practical task:',
          '1. summarize the current project goal in five bullets,',
          '2. identify one likely setup risk,',
          '3. propose one next action with a command or route.',
        ].join(' '),
        required: true,
        multiline: true,
        hint: 'Exact benchmark prompt sent identically to every candidate model. Ctrl-J inserts a new line.',
      },
      { id: 'artifactId', label: 'Source artifact', value: '', required: false, multiline: false, hint: 'Optional saved text artifact id to include identically in the benchmark prompt.' },
      { id: 'modelRefs', label: 'Models', value: '', required: false, multiline: true, hint: 'Recommended: local route first, then current/baseline route. Registry keys or model ids, separated by commas or new lines.' },
      { id: 'candidateCount', label: 'Auto count', value: '2', required: false, multiline: false, hint: 'Used only when Models is blank. 2 to 4.' },
      { id: 'rubric', label: 'Rubric', value: 'Prefer fast first useful output, correct project context, concrete setup-risk identification, and one actionable next route or command.', required: false, multiline: true, hint: 'Judging rubric shown with blinded benchmark results.' },
      { id: 'systemPrompt', label: 'System prompt', value: '', required: false, multiline: true, hint: 'Optional system prompt sent identically to every candidate.' },
      { id: 'maxTokens', label: 'Max tokens', value: '1024', required: false, multiline: false, hint: 'Per-candidate output cap. Defaults to 1024 for this benchmark.' },
      { id: 'benchmarkKind', label: 'Benchmark tag', value: 'local-model-route', required: false, multiline: false, hint: 'Keeps the saved comparison visible in local model benchmark history.' },
      { id: 'taskType', label: 'Task type', value: 'local-model-route', required: false, multiline: false, hint: 'Tags the saved judgment trend for filtered analytics.' },
      { id: 'reveal', label: 'Reveal now', value: 'no', required: false, multiline: false, hint: 'yes/no. Blank or no keeps model identities hidden until reveal.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to spend model tokens and save the local benchmark artifact.' },
    ],
  };
}

export function createAgentModelCompareReviewEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'model-compare-review',
    mode: 'create',
    title: 'Review Saved Compare',
    selectedFieldIndex: 0,
    message: 'Review saved blind model comparison artifacts, or render a side-by-side reviewer view with related document/artifact ids. Leave ids blank to list recent saved comparisons.',
    fields: [
      { id: 'view', label: 'View', value: 'review', required: false, multiline: false, hint: 'review or sideBySide. Side-by-side compares related artifact excerpts with saved comparison evidence.' },
      { id: 'artifactId', label: 'Artifact id', value: '', required: false, multiline: false, hint: 'Saved artifact id such as artifact-123. Blank lists recent saved comparisons.' },
      { id: 'comparisonId', label: 'Comparison id', value: '', required: false, multiline: false, hint: 'Comparison id such as cmp_... if known. Artifact id is usually easier.' },
      { id: 'relatedArtifactIds', label: 'Related artifacts', value: '', required: false, multiline: true, hint: 'For sideBySide: document export, archive, or artifact ids, separated by commas or new lines.' },
      { id: 'previewBytes', label: 'Preview bytes', value: '2000', required: false, multiline: false, hint: 'For sideBySide: max bytes per related artifact preview, 200 to 10000.' },
      { id: 'reveal', label: 'Reveal', value: 'no', required: false, multiline: false, hint: 'yes/no. No keeps identities hidden and renders the blind review board.' },
    ],
  };
}

export function createAgentModelCompareJudgmentEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'model-compare-judge',
    mode: 'create',
    title: 'Save Compare Judgment',
    selectedFieldIndex: 0,
    message: 'Save the winning candidate and reasons as a local judgment artifact. This does not change the selected model.',
    fields: [
      { id: 'artifactId', label: 'Artifact id', value: '', required: false, multiline: false, hint: 'Saved comparison artifact id such as artifact-123.' },
      { id: 'comparisonId', label: 'Comparison id', value: '', required: false, multiline: false, hint: 'Comparison id such as cmp_... if known.' },
      { id: 'winnerBlindId', label: 'Winner', value: '', required: true, multiline: false, hint: 'Candidate label, such as A or Candidate B.' },
      { id: 'reasons', label: 'Reasons', value: '', required: true, multiline: true, hint: 'Why this candidate won. Ctrl-J inserts a new line.' },
      { id: 'notes', label: 'Notes', value: '', required: false, multiline: true, hint: 'Optional risks, follow-ups, or rubric notes.' },
      { id: 'reveal', label: 'Reveal in judgment', value: 'no', required: false, multiline: false, hint: 'yes/no. Yes includes model identity for later route update.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to save this judgment artifact.' },
    ],
  };
}

export function createAgentModelCompareApplyEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'model-compare-apply',
    mode: 'create',
    title: 'Apply Compare Winner',
    selectedFieldIndex: 0,
    message: 'Apply a revealed saved judgment artifact to the main Agent model route. This changes provider.model after confirmation.',
    fields: [
      { id: 'artifactId', label: 'Judgment artifact id', value: '', required: true, multiline: false, hint: 'Saved revealed judgment artifact id such as artifact-123.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to change the selected Agent model.' },
    ],
  };
}

export function createAgentModelCompareExportEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'model-compare-export',
    mode: 'create',
    title: 'Export Compare Report/Handoff',
    selectedFieldIndex: 0,
    message: 'Export a saved comparison or judgment as a markdown report, create a reviewer handoff with related document/artifact ids, or archive a saved handoff as one ZIP artifact. This does not change the selected model.',
    fields: [
      { id: 'reportKind', label: 'Kind', value: 'report', required: false, multiline: false, hint: 'report, handoff, or archive. Archive expects a saved handoff artifact id and creates one ZIP artifact.' },
      { id: 'artifactId', label: 'Artifact id', value: '', required: true, multiline: false, hint: 'Saved comparison/judgment artifact for report or handoff; saved handoff artifact for archive.' },
      { id: 'relatedArtifactIds', label: 'Related artifacts', value: '', required: false, multiline: true, hint: 'For handoff: document export, archive, or artifact ids, separated by commas or new lines.' },
      { id: 'reveal', label: 'Reveal in export', value: 'no', required: false, multiline: false, hint: 'yes/no. For comparison artifacts, yes includes model identities. Judgment artifacts use their saved reveal state.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to create the local report, handoff, or ZIP archive artifact.' },
    ],
  };
}

export function createAgentModelCompareAnalyticsEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'model-compare-analytics',
    mode: 'create',
    title: 'Compare Analytics/Synthesis',
    selectedFieldIndex: 0,
    message: 'Summarize or synthesize saved blind comparison judgments by winner, model, blind slot, themes, task type, document id, benchmark tag, and recent reasons. This is read-only.',
    fields: [
      { id: 'view', label: 'View', value: 'analytics', required: false, multiline: false, hint: 'analytics or synthesis. Synthesis groups saved judgment themes across sessions.' },
      { id: 'limit', label: 'Judgment limit', value: '20', required: false, multiline: false, hint: 'Maximum saved judgment artifacts to inspect. Defaults to 20.' },
      { id: 'benchmarkKind', label: 'Benchmark tag', value: '', required: false, multiline: false, hint: 'Optional filter, such as local-model-route.' },
      { id: 'taskType', label: 'Task type', value: '', required: false, multiline: false, hint: 'Optional filter, such as writing, research, code-review, or local-model-route.' },
      { id: 'documentId', label: 'Document id', value: '', required: false, multiline: false, hint: 'Optional filter for judgments tied to one Agent document id.' },
      { id: 'includeReasons', label: 'Include reasons', value: 'yes', required: false, multiline: false, hint: 'yes/no. Yes includes short reason and note excerpts in the recent-judgments list.' },
    ],
  };
}

export function buildAgentModelCompareToolArgs(
  readField: AgentWorkspaceFieldReader,
  explicitUserRequest: string,
): AgentModelCompareWorkspaceToolArgs {
  const prompt = readField('prompt').trim();
  const artifactId = readField('artifactId').trim();
  const modelRefs = readList(readField('modelRefs'));
  const candidateCount = readPositiveInteger(readField('candidateCount'));
  const rubric = readField('rubric').trim();
  const systemPrompt = readField('systemPrompt').trim();
  const maxTokens = readPositiveInteger(readField('maxTokens'));
  const benchmarkKind = readField('benchmarkKind').trim();
  const taskType = readField('taskType').trim();
  const documentId = readField('documentId').trim();
  const reveal = isAffirmative(readField('reveal'));

  return {
    mode: 'run',
    prompt,
    ...(artifactId ? { artifactId } : {}),
    ...(modelRefs.length > 0 ? { modelRefs } : {}),
    ...(candidateCount !== null ? { candidateCount } : {}),
    ...(rubric ? { rubric } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(maxTokens !== null ? { maxTokens } : {}),
    ...(benchmarkKind ? { benchmarkKind } : {}),
    ...(taskType ? { taskType } : {}),
    ...(documentId ? { documentId } : {}),
    reveal,
    confirm: true,
    explicitUserRequest,
  };
}

export function buildAgentModelCompareReviewToolArgs(
  readField: AgentWorkspaceFieldReader,
): AgentModelCompareReviewWorkspaceToolArgs {
  const mode = readField('view').trim() === 'sideBySide' ? 'sideBySide' : 'review';
  const artifactId = readField('artifactId').trim();
  const comparisonId = readField('comparisonId').trim();
  const relatedArtifactIds = readList(readField('relatedArtifactIds'));
  const previewBytes = readPositiveInteger(readField('previewBytes'));
  const reveal = isAffirmative(readField('reveal'));
  return {
    mode,
    ...(artifactId ? { artifactId } : {}),
    ...(comparisonId ? { comparisonId } : {}),
    ...(relatedArtifactIds.length > 0 ? { relatedArtifactIds } : {}),
    ...(previewBytes !== null ? { previewBytes } : {}),
    reveal,
  };
}

export function buildAgentModelCompareJudgmentToolArgs(
  readField: AgentWorkspaceFieldReader,
  explicitUserRequest: string,
): AgentModelCompareJudgmentWorkspaceToolArgs {
  const artifactId = readField('artifactId').trim();
  const comparisonId = readField('comparisonId').trim();
  const notes = readField('notes').trim();
  return {
    mode: 'judge',
    ...(artifactId ? { artifactId } : {}),
    ...(comparisonId ? { comparisonId } : {}),
    winnerBlindId: readField('winnerBlindId').trim(),
    reasons: readField('reasons').trim(),
    ...(notes ? { notes } : {}),
    reveal: isAffirmative(readField('reveal')),
    confirm: true,
    explicitUserRequest,
  };
}

export function buildAgentModelCompareApplyToolArgs(
  readField: AgentWorkspaceFieldReader,
  explicitUserRequest: string,
): AgentModelCompareApplyWorkspaceToolArgs {
  return {
    mode: 'apply',
    artifactId: readField('artifactId').trim(),
    confirm: true,
    explicitUserRequest,
  };
}

export function buildAgentModelCompareExportToolArgs(
  readField: AgentWorkspaceFieldReader,
  explicitUserRequest: string,
): AgentModelCompareExportWorkspaceToolArgs {
  const mode = compareExportMode(readField('reportKind'));
  const relatedArtifactIds = readList(readField('relatedArtifactIds'));
  return {
    mode,
    artifactId: readField('artifactId').trim(),
    ...(relatedArtifactIds.length > 0 ? { relatedArtifactIds } : {}),
    reveal: isAffirmative(readField('reveal')),
    confirm: true,
    explicitUserRequest,
  };
}

export function buildAgentModelCompareAnalyticsToolArgs(
  readField: AgentWorkspaceFieldReader,
): AgentModelCompareAnalyticsWorkspaceToolArgs {
  const view = readField('view').trim().toLowerCase();
  const limit = readPositiveInteger(readField('limit'));
  const benchmarkKind = readField('benchmarkKind').trim();
  const taskType = readField('taskType').trim();
  const documentId = readField('documentId').trim();
  return {
    mode: view === 'synthesis' ? 'synthesis' : 'analytics',
    ...(limit !== null ? { limit } : {}),
    ...(benchmarkKind ? { benchmarkKind } : {}),
    ...(taskType ? { taskType } : {}),
    ...(documentId ? { documentId } : {}),
    includeReasons: isAffirmative(readField('includeReasons')),
  };
}

export function buildAgentModelComparePromptSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
  promptDispatchAvailable: boolean,
): {
  readonly kind: 'editor';
  readonly editor: AgentWorkspaceLocalEditor;
  readonly status: string;
  readonly actionResult: AgentWorkspaceActionResult;
} | {
  readonly kind: 'prompt';
  readonly prompt: string;
  readonly status: string;
  readonly actionResult: AgentWorkspaceActionResult;
} {
  if (!isAffirmative(readField('confirm'))) {
    return {
      kind: 'editor',
      editor: {
        ...editor,
        selectedFieldIndex: Math.max(0, editor.fields.findIndex((field) => field.id === 'confirm')),
        message: 'Model comparison not confirmed. Type yes, then press Enter.',
      },
      status: 'Model comparison not confirmed.',
      actionResult: {
        kind: 'error',
        title: 'Model comparison not confirmed',
        detail: 'Type yes on the confirmation field before spending model tokens.',
        safety: 'safe',
      },
    };
  }
  if (!promptDispatchAvailable) {
    return {
      kind: 'editor',
      editor: {
        ...editor,
        message: 'Prompt dispatch is unavailable in this runtime. Use agent_harness mode:"run_workspace_action" with this editor schema.',
      },
      status: 'Prompt dispatch unavailable.',
      actionResult: {
        kind: 'error',
        title: 'Prompt dispatch unavailable',
        detail: 'This runtime cannot submit the comparison request from the workspace form.',
        safety: 'safe',
      },
    };
  }

  const modelRefs = readList(readField('modelRefs'));
  const artifactId = readField('artifactId').trim();
  const candidateCount = readPositiveInteger(readField('candidateCount')) ?? 2;
  const reveal = isAffirmative(readField('reveal'));
  const rubric = readField('rubric').trim();
  const systemPrompt = readField('systemPrompt').trim();
  const maxTokens = readPositiveInteger(readField('maxTokens')) ?? 2048;
  const benchmarkKind = readField('benchmarkKind').trim();
  const taskType = readField('taskType').trim();
  const documentId = readField('documentId').trim();
  const explicitUserRequest = 'Run the blind model comparison from the Agent workspace form.';
  const prompt = [
    'Run a blind model comparison with the `agent_model_compare` tool.',
    'Use confirm:true because this workspace form was explicitly confirmed by the user.',
    `Use explicitUserRequest: ${JSON.stringify(explicitUserRequest)}.`,
    '',
    'Candidate prompt:',
    quoteBlock(readField('prompt')),
    '',
    artifactId ? `Source artifact id: ${artifactId}.` : 'Source artifact id: none.',
    '',
    modelRefs.length > 0
      ? `Candidate models: ${modelRefs.join(', ')}.`
      : `Candidate models: auto-select ${candidateCount} selectable models.`,
    rubric ? `Rubric: ${rubric}` : 'Rubric: none.',
    systemPrompt ? `System prompt: ${systemPrompt}` : 'System prompt: none.',
    `Max tokens per candidate: ${maxTokens}.`,
    benchmarkKind ? `Benchmark kind: ${benchmarkKind}.` : 'Benchmark kind: none.',
    taskType ? `Task type: ${taskType}.` : 'Task type: none.',
    documentId ? `Document id: ${documentId}.` : 'Document id: none.',
    `Reveal identities immediately: ${reveal ? 'yes' : 'no'}.`,
    'Do not change the selected model after the comparison unless the user asks for that route update separately.',
  ].join('\n');

  return {
    kind: 'prompt',
    prompt,
    status: 'Submitting blind model comparison request.',
    actionResult: {
      kind: 'guidance',
      title: 'Blind model comparison',
      detail: 'Submitted a confirmed request to run the first-class model comparison tool.',
      safety: 'safe',
    },
  };
}

export function buildAgentModelCompareReviewPromptSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
  promptDispatchAvailable: boolean,
): {
  readonly kind: 'editor';
  readonly editor: AgentWorkspaceLocalEditor;
  readonly status: string;
  readonly actionResult: AgentWorkspaceActionResult;
} | {
  readonly kind: 'prompt';
  readonly prompt: string;
  readonly status: string;
  readonly actionResult: AgentWorkspaceActionResult;
} {
  if (!promptDispatchAvailable) {
    return {
      kind: 'editor',
      editor: {
        ...editor,
        message: 'Prompt dispatch is unavailable in this runtime. Use agent_harness mode:"run_workspace_action" with this editor schema.',
      },
      status: 'Prompt dispatch unavailable.',
      actionResult: {
        kind: 'error',
        title: 'Prompt dispatch unavailable',
        detail: 'This runtime cannot submit the comparison review request from the workspace form.',
        safety: 'read-only',
      },
    };
  }

  const mode = readField('view').trim() === 'sideBySide' ? 'sideBySide' : 'review';
  const artifactId = readField('artifactId').trim();
  const comparisonId = readField('comparisonId').trim();
  const relatedArtifactIds = readList(readField('relatedArtifactIds'));
  const previewBytes = readPositiveInteger(readField('previewBytes')) ?? 2000;
  const reveal = isAffirmative(readField('reveal'));
  const prompt = [
    mode === 'sideBySide'
      ? 'Render a side-by-side reviewer view for a saved blind model comparison with the `agent_model_compare` tool.'
      : 'Review a saved blind model comparison with the `agent_model_compare` tool.',
    `Use mode:"${mode}".`,
    artifactId ? `Use artifactId: ${JSON.stringify(artifactId)}.` : 'No artifactId was provided.',
    comparisonId ? `Use comparisonId: ${JSON.stringify(comparisonId)}.` : 'No comparisonId was provided.',
    relatedArtifactIds.length > 0 ? `Related artifact ids: ${relatedArtifactIds.join(', ')}.` : 'Related artifact ids: none.',
    `Preview bytes: ${previewBytes}.`,
    `Reveal identities in the review: ${reveal ? 'yes' : 'no'}.`,
    'If no ids were provided, list recent saved comparison artifacts.',
    'Do not change the selected model after the review unless the user asks for that route update separately.',
  ].join('\n');

  return {
    kind: 'prompt',
    prompt,
    status: `Submitting saved comparison ${mode} request.`,
    actionResult: {
      kind: 'guidance',
      title: mode === 'sideBySide' ? 'Side-by-side compare review' : 'Saved comparison review',
      detail: mode === 'sideBySide'
        ? 'Submitted a read-only request to compare related artifact excerpts with saved comparison evidence.'
        : 'Submitted a read-only request to review saved blind comparison artifacts.',
      safety: 'read-only',
    },
  };
}

export function buildAgentModelCompareJudgmentPromptSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
  promptDispatchAvailable: boolean,
): {
  readonly kind: 'editor';
  readonly editor: AgentWorkspaceLocalEditor;
  readonly status: string;
  readonly actionResult: AgentWorkspaceActionResult;
} | {
  readonly kind: 'prompt';
  readonly prompt: string;
  readonly status: string;
  readonly actionResult: AgentWorkspaceActionResult;
} {
  if (!isAffirmative(readField('confirm'))) {
    return {
      kind: 'editor',
      editor: {
        ...editor,
        selectedFieldIndex: Math.max(0, editor.fields.findIndex((field) => field.id === 'confirm')),
        message: 'Judgment not confirmed. Type yes, then press Enter.',
      },
      status: 'Judgment not confirmed.',
      actionResult: {
        kind: 'error',
        title: 'Judgment not confirmed',
        detail: 'Type yes on the confirmation field before saving the judgment artifact.',
        safety: 'safe',
      },
    };
  }
  if (!promptDispatchAvailable) {
    return {
      kind: 'editor',
      editor: {
        ...editor,
        message: 'Prompt dispatch is unavailable in this runtime. Use agent_harness mode:"run_workspace_action" with this editor schema.',
      },
      status: 'Prompt dispatch unavailable.',
      actionResult: {
        kind: 'error',
        title: 'Prompt dispatch unavailable',
        detail: 'This runtime cannot submit the comparison judgment request from the workspace form.',
        safety: 'safe',
      },
    };
  }

  const artifactId = readField('artifactId').trim();
  const comparisonId = readField('comparisonId').trim();
  const winnerBlindId = readField('winnerBlindId').trim();
  const reasons = readField('reasons').trim();
  const notes = readField('notes').trim();
  const reveal = isAffirmative(readField('reveal'));
  const explicitUserRequest = 'Save the blind model comparison judgment from the Agent workspace form.';
  const prompt = [
    'Save a blind model comparison judgment with the `agent_model_compare` tool.',
    'Use confirm:true because this workspace form was explicitly confirmed by the user.',
    `Use explicitUserRequest: ${JSON.stringify(explicitUserRequest)}.`,
    artifactId ? `Use artifactId: ${JSON.stringify(artifactId)}.` : 'No artifactId was provided.',
    comparisonId ? `Use comparisonId: ${JSON.stringify(comparisonId)}.` : 'No comparisonId was provided.',
    `Winner blind id: ${winnerBlindId || '(missing)'}.`,
    `Reasons: ${reasons || '(missing)'}.`,
    notes ? `Notes: ${notes}.` : 'Notes: none.',
    `Reveal model identity in judgment: ${reveal ? 'yes' : 'no'}.`,
    'Do not change the selected model after saving the judgment unless the user asks for that route update separately.',
  ].join('\n');

  return {
    kind: 'prompt',
    prompt,
    status: 'Submitting saved comparison judgment request.',
    actionResult: {
      kind: 'guidance',
      title: 'Saved comparison judgment',
      detail: 'Submitted a confirmed request to save a local comparison judgment artifact.',
      safety: 'safe',
    },
  };
}

export function buildAgentModelCompareApplyPromptSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
  promptDispatchAvailable: boolean,
): {
  readonly kind: 'editor';
  readonly editor: AgentWorkspaceLocalEditor;
  readonly status: string;
  readonly actionResult: AgentWorkspaceActionResult;
} | {
  readonly kind: 'prompt';
  readonly prompt: string;
  readonly status: string;
  readonly actionResult: AgentWorkspaceActionResult;
} {
  if (!isAffirmative(readField('confirm'))) {
    return {
      kind: 'editor',
      editor: {
        ...editor,
        selectedFieldIndex: Math.max(0, editor.fields.findIndex((field) => field.id === 'confirm')),
        message: 'Route update not confirmed. Type yes, then press Enter.',
      },
      status: 'Route update not confirmed.',
      actionResult: {
        kind: 'error',
        title: 'Route update not confirmed',
        detail: 'Type yes on the confirmation field before applying the winning model route.',
        safety: 'safe',
      },
    };
  }
  if (!promptDispatchAvailable) {
    return {
      kind: 'editor',
      editor: {
        ...editor,
        message: 'Prompt dispatch is unavailable in this runtime. Use agent_harness mode:"run_workspace_action" with this editor schema.',
      },
      status: 'Prompt dispatch unavailable.',
      actionResult: {
        kind: 'error',
        title: 'Prompt dispatch unavailable',
        detail: 'This runtime cannot submit the comparison route update request from the workspace form.',
        safety: 'safe',
      },
    };
  }

  const artifactId = readField('artifactId').trim();
  const explicitUserRequest = 'Apply the revealed blind model comparison judgment from the Agent workspace form.';
  const prompt = [
    'Apply a revealed blind model comparison judgment with the `agent_model_compare` tool.',
    'Use mode:"apply" and confirm:true because this workspace form was explicitly confirmed by the user.',
    `Use explicitUserRequest: ${JSON.stringify(explicitUserRequest)}.`,
    artifactId ? `Use artifactId: ${JSON.stringify(artifactId)}.` : 'No artifactId was provided.',
    'Only proceed if the judgment artifact includes a revealed winner model.',
  ].join('\n');

  return {
    kind: 'prompt',
    prompt,
    status: 'Submitting comparison route update request.',
    actionResult: {
      kind: 'guidance',
      title: 'Apply compare winner',
      detail: 'Submitted a confirmed request to apply a revealed comparison judgment to the selected model route.',
      safety: 'safe',
    },
  };
}

export function buildAgentModelCompareExportPromptSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
  promptDispatchAvailable: boolean,
): {
  readonly kind: 'editor';
  readonly editor: AgentWorkspaceLocalEditor;
  readonly status: string;
  readonly actionResult: AgentWorkspaceActionResult;
} | {
  readonly kind: 'prompt';
  readonly prompt: string;
  readonly status: string;
  readonly actionResult: AgentWorkspaceActionResult;
} {
  if (!isAffirmative(readField('confirm'))) {
    return {
      kind: 'editor',
      editor: {
        ...editor,
        selectedFieldIndex: Math.max(0, editor.fields.findIndex((field) => field.id === 'confirm')),
        message: 'Export not confirmed. Type yes, then press Enter.',
      },
      status: 'Export not confirmed.',
      actionResult: {
        kind: 'error',
        title: 'Export not confirmed',
        detail: 'Type yes on the confirmation field before creating the markdown report artifact.',
        safety: 'safe',
      },
    };
  }
  if (!promptDispatchAvailable) {
    return {
      kind: 'editor',
      editor: {
        ...editor,
        message: 'Prompt dispatch is unavailable in this runtime. Use agent_harness mode:"run_workspace_action" with this editor schema.',
      },
      status: 'Prompt dispatch unavailable.',
      actionResult: {
        kind: 'error',
        title: 'Prompt dispatch unavailable',
        detail: 'This runtime cannot submit the comparison export request from the workspace form.',
        safety: 'safe',
      },
    };
  }

  const mode = compareExportMode(readField('reportKind'));
  const artifactId = readField('artifactId').trim();
  const relatedArtifactIds = readList(readField('relatedArtifactIds'));
  const reveal = isAffirmative(readField('reveal'));
  const explicitUserRequest = mode === 'handoff'
    ? 'Create a reviewer handoff from the saved blind model comparison artifact in the Agent workspace form.'
    : mode === 'handoffArchive'
      ? 'Create a reviewer handoff ZIP archive from the saved blind model comparison handoff artifact in the Agent workspace form.'
      : 'Export the saved blind model comparison artifact from the Agent workspace form.';
  const prompt = [
    mode === 'handoff'
      ? 'Create a reviewer handoff for a saved blind model comparison or judgment artifact with the `agent_model_compare` tool.'
      : mode === 'handoffArchive'
        ? 'Create a ZIP archive artifact from a saved blind model comparison reviewer handoff with the `agent_model_compare` tool.'
        : 'Export a saved blind model comparison or judgment artifact with the `agent_model_compare` tool.',
    `Use mode:"${mode}" and confirm:true because this workspace form was explicitly confirmed by the user.`,
    `Use explicitUserRequest: ${JSON.stringify(explicitUserRequest)}.`,
    artifactId ? `Use artifactId: ${JSON.stringify(artifactId)}.` : 'No artifactId was provided.',
    relatedArtifactIds.length > 0 ? `Related artifact ids: ${relatedArtifactIds.join(', ')}.` : 'Related artifact ids: none.',
    `Reveal model identities in comparison exports: ${reveal ? 'yes' : 'no'}.`,
    mode === 'handoffArchive'
      ? 'Create one local ZIP artifact, keep the original handoff/source/evidence artifacts, and do not change model routing.'
      : 'Create one local markdown artifact and do not change model routing.',
  ].join('\n');

  return {
    kind: 'prompt',
    prompt,
    status: `Submitting comparison ${mode} request.`,
    actionResult: {
      kind: 'guidance',
      title: mode === 'handoff'
        ? 'Compare reviewer handoff'
        : mode === 'handoffArchive'
          ? 'Archive reviewer handoff'
          : 'Export compare report',
      detail: mode === 'handoff'
        ? 'Submitted a confirmed request to create a reviewer handoff from saved comparison evidence.'
        : mode === 'handoffArchive'
          ? 'Submitted a confirmed request to create a ZIP archive artifact from a saved reviewer handoff.'
          : 'Submitted a confirmed request to export a saved comparison or judgment as markdown.',
      safety: 'safe',
    },
  };
}

export function buildAgentModelCompareAnalyticsPromptSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
  promptDispatchAvailable: boolean,
): {
  readonly kind: 'editor';
  readonly editor: AgentWorkspaceLocalEditor;
  readonly status: string;
  readonly actionResult: AgentWorkspaceActionResult;
} | {
  readonly kind: 'prompt';
  readonly prompt: string;
  readonly status: string;
  readonly actionResult: AgentWorkspaceActionResult;
} {
  if (!promptDispatchAvailable) {
    return {
      kind: 'editor',
      editor: {
        ...editor,
        message: 'Prompt dispatch is unavailable in this runtime. Use agent_harness mode:"run_workspace_action" with this editor schema.',
      },
      status: 'Prompt dispatch unavailable.',
      actionResult: {
        kind: 'error',
        title: 'Prompt dispatch unavailable',
        detail: 'This runtime cannot submit the comparison analytics/synthesis request from the workspace form.',
        safety: 'read-only',
      },
    };
  }

  const mode = readField('view').trim().toLowerCase() === 'synthesis' ? 'synthesis' : 'analytics';
  const limit = readPositiveInteger(readField('limit')) ?? 20;
  const benchmarkKind = readField('benchmarkKind').trim();
  const taskType = readField('taskType').trim();
  const documentId = readField('documentId').trim();
  const includeReasons = isAffirmative(readField('includeReasons'));
  const prompt = [
    'Review saved blind model comparison judgments with the `agent_model_compare` tool.',
    `Use mode:"${mode}".`,
    `Judgment limit: ${limit}.`,
    benchmarkKind ? `Benchmark kind filter: ${benchmarkKind}.` : 'Benchmark kind filter: none.',
    taskType ? `Task type filter: ${taskType}.` : 'Task type filter: none.',
    documentId ? `Document id filter: ${documentId}.` : 'Document id filter: none.',
    `Include reason excerpts: ${includeReasons ? 'yes' : 'no'}.`,
    'This is read-only and must not change model routing.',
  ].join('\n');

  return {
    kind: 'prompt',
    prompt,
    status: `Submitting comparison ${mode} request.`,
    actionResult: {
      kind: 'guidance',
      title: mode === 'synthesis' ? 'Compare synthesis' : 'Compare analytics',
      detail: `Submitted a read-only request to ${mode === 'synthesis' ? 'synthesize' : 'summarize'} saved comparison judgments.`,
      safety: 'read-only',
    },
  };
}
