import type { AgentWorkspaceActionResult, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export interface AgentModelCompareWorkspaceToolArgs {
  readonly mode: 'run';
  readonly prompt: string;
  readonly modelRefs?: readonly string[];
  readonly candidateCount?: number;
  readonly rubric?: string;
  readonly systemPrompt?: string;
  readonly maxTokens?: number;
  readonly reveal?: boolean;
  readonly confirm: boolean;
  readonly explicitUserRequest: string;
}

export interface AgentModelCompareReviewWorkspaceToolArgs {
  readonly mode: 'review';
  readonly comparisonId?: string;
  readonly artifactId?: string;
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
      { id: 'modelRefs', label: 'Models', value: '', required: false, multiline: true, hint: 'Optional registry keys or model ids, separated by commas or new lines. Blank auto-selects.' },
      { id: 'candidateCount', label: 'Auto count', value: '2', required: false, multiline: false, hint: 'Used only when Models is blank. 2 to 4.' },
      { id: 'rubric', label: 'Rubric', value: '', required: false, multiline: true, hint: 'Optional judging rubric shown with blinded results.' },
      { id: 'systemPrompt', label: 'System prompt', value: '', required: false, multiline: true, hint: 'Optional system prompt sent identically to every candidate.' },
      { id: 'maxTokens', label: 'Max tokens', value: '2048', required: false, multiline: false, hint: 'Per-candidate output cap. Defaults to 2048.' },
      { id: 'reveal', label: 'Reveal now', value: 'no', required: false, multiline: false, hint: 'yes/no. Blank or no keeps model identities hidden until reveal.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run a token-spending model comparison and save the local review artifact.' },
    ],
  };
}

export function createAgentModelCompareReviewEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'model-compare-review',
    mode: 'create',
    title: 'Review Saved Compare',
    selectedFieldIndex: 0,
    message: 'Review saved blind model comparison artifacts. Leave ids blank to list recent saved comparisons; set Reveal to yes only after judging.',
    fields: [
      { id: 'artifactId', label: 'Artifact id', value: '', required: false, multiline: false, hint: 'Saved artifact id such as artifact-123. Blank lists recent saved comparisons.' },
      { id: 'comparisonId', label: 'Comparison id', value: '', required: false, multiline: false, hint: 'Comparison id such as cmp_... if known. Artifact id is usually easier.' },
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

export function buildAgentModelCompareToolArgs(
  readField: AgentWorkspaceFieldReader,
  explicitUserRequest: string,
): AgentModelCompareWorkspaceToolArgs {
  const prompt = readField('prompt').trim();
  const modelRefs = readList(readField('modelRefs'));
  const candidateCount = readPositiveInteger(readField('candidateCount'));
  const rubric = readField('rubric').trim();
  const systemPrompt = readField('systemPrompt').trim();
  const maxTokens = readPositiveInteger(readField('maxTokens'));
  const reveal = isAffirmative(readField('reveal'));

  return {
    mode: 'run',
    prompt,
    ...(modelRefs.length > 0 ? { modelRefs } : {}),
    ...(candidateCount !== null ? { candidateCount } : {}),
    ...(rubric ? { rubric } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(maxTokens !== null ? { maxTokens } : {}),
    reveal,
    confirm: true,
    explicitUserRequest,
  };
}

export function buildAgentModelCompareReviewToolArgs(
  readField: AgentWorkspaceFieldReader,
): AgentModelCompareReviewWorkspaceToolArgs {
  const artifactId = readField('artifactId').trim();
  const comparisonId = readField('comparisonId').trim();
  const reveal = isAffirmative(readField('reveal'));
  return {
    mode: 'review',
    ...(artifactId ? { artifactId } : {}),
    ...(comparisonId ? { comparisonId } : {}),
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
  const candidateCount = readPositiveInteger(readField('candidateCount')) ?? 2;
  const reveal = isAffirmative(readField('reveal'));
  const rubric = readField('rubric').trim();
  const systemPrompt = readField('systemPrompt').trim();
  const maxTokens = readPositiveInteger(readField('maxTokens')) ?? 2048;
  const explicitUserRequest = 'Run the blind model comparison from the Agent workspace form.';
  const prompt = [
    'Run a blind model comparison with the `agent_model_compare` tool.',
    'Use confirm:true because this workspace form was explicitly confirmed by the user.',
    `Use explicitUserRequest: ${JSON.stringify(explicitUserRequest)}.`,
    '',
    'Candidate prompt:',
    quoteBlock(readField('prompt')),
    '',
    modelRefs.length > 0
      ? `Candidate models: ${modelRefs.join(', ')}.`
      : `Candidate models: auto-select ${candidateCount} selectable models.`,
    rubric ? `Rubric: ${rubric}` : 'Rubric: none.',
    systemPrompt ? `System prompt: ${systemPrompt}` : 'System prompt: none.',
    `Max tokens per candidate: ${maxTokens}.`,
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

  const artifactId = readField('artifactId').trim();
  const comparisonId = readField('comparisonId').trim();
  const reveal = isAffirmative(readField('reveal'));
  const prompt = [
    'Review a saved blind model comparison with the `agent_model_compare` tool.',
    artifactId ? `Use artifactId: ${JSON.stringify(artifactId)}.` : 'No artifactId was provided.',
    comparisonId ? `Use comparisonId: ${JSON.stringify(comparisonId)}.` : 'No comparisonId was provided.',
    `Reveal identities in the review: ${reveal ? 'yes' : 'no'}.`,
    'If no ids were provided, list recent saved comparison artifacts.',
    'Do not change the selected model after the review unless the user asks for that route update separately.',
  ].join('\n');

  return {
    kind: 'prompt',
    prompt,
    status: 'Submitting saved comparison review request.',
    actionResult: {
      kind: 'guidance',
      title: 'Saved comparison review',
      detail: 'Submitted a read-only request to review saved blind comparison artifacts.',
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
