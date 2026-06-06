import type { AgentWorkspaceActionResult, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export interface AgentArtifactBrowserWorkspaceToolArgs {
  readonly mode: 'list' | 'show';
  readonly artifactId?: string;
  readonly query?: string;
  readonly kind?: string;
  readonly mimeType?: string;
  readonly purpose?: string;
  readonly source?: string;
  readonly limit?: number;
  readonly includeContent?: boolean;
  readonly previewBytes?: number;
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

export function createAgentArtifactBrowserEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'artifact-browser',
    mode: 'create',
    title: 'Browse Artifacts',
    selectedFieldIndex: 0,
    message: 'List saved uploads, exports, generated media, source artifacts, and comparison artifacts from the shared Agent artifact store. This is read-only.',
    fields: [
      { id: 'query', label: 'Search', value: '', required: false, multiline: false, hint: 'Optional search across id, filename, MIME type, source, sha256, and redacted metadata.' },
      { id: 'kind', label: 'Kind', value: '', required: false, multiline: false, hint: 'Optional exact kind: file, image, audio, video, document, archive, or data.' },
      { id: 'mimeType', label: 'MIME type', value: '', required: false, multiline: false, hint: 'Optional MIME substring such as markdown, json, image, or pdf.' },
      { id: 'purpose', label: 'Purpose', value: '', required: false, multiline: false, hint: 'Optional artifact metadata purpose such as agent-model-compare.' },
      { id: 'source', label: 'Source', value: '', required: false, multiline: false, hint: 'Optional source URI or metadata source filter.' },
      { id: 'limit', label: 'Limit', value: '25', required: false, multiline: false, hint: 'Maximum rows to return. Defaults to 25.' },
    ],
  };
}

export function createAgentArtifactShowEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'artifact-show',
    mode: 'create',
    title: 'Show Artifact',
    selectedFieldIndex: 0,
    message: 'Inspect one saved artifact by id. Content preview is bounded and text-only; binary bytes and base64 stay out of the transcript.',
    fields: [
      { id: 'artifactId', label: 'Artifact id', value: '', required: true, multiline: false, hint: 'Saved artifact id such as artifact-123.' },
      { id: 'includeContent', label: 'Preview content', value: 'yes', required: false, multiline: false, hint: 'yes/no. Yes includes a bounded preview for text-like artifacts.' },
      { id: 'previewBytes', label: 'Preview bytes', value: '2048', required: false, multiline: false, hint: 'Maximum text bytes to preview. Defaults to 2048.' },
    ],
  };
}

export function buildAgentArtifactBrowserToolArgs(
  readField: AgentWorkspaceFieldReader,
): AgentArtifactBrowserWorkspaceToolArgs {
  const limit = readPositiveInteger(readField('limit'));
  const query = readField('query').trim();
  const kind = readField('kind').trim();
  const mimeType = readField('mimeType').trim();
  const purpose = readField('purpose').trim();
  const source = readField('source').trim();
  return {
    mode: 'list',
    ...(query ? { query } : {}),
    ...(kind ? { kind } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(purpose ? { purpose } : {}),
    ...(source ? { source } : {}),
    ...(limit !== null ? { limit } : {}),
  };
}

export function buildAgentArtifactShowToolArgs(
  readField: AgentWorkspaceFieldReader,
): AgentArtifactBrowserWorkspaceToolArgs {
  const previewBytes = readPositiveInteger(readField('previewBytes'));
  return {
    mode: 'show',
    artifactId: readField('artifactId').trim(),
    includeContent: isAffirmative(readField('includeContent')),
    ...(previewBytes !== null ? { previewBytes } : {}),
  };
}

export function buildAgentArtifactBrowserPromptSubmission(
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
        detail: 'This runtime cannot submit the artifact browser request from the workspace form.',
        safety: 'read-only',
      },
    };
  }

  const args = editor.kind === 'artifact-show'
    ? buildAgentArtifactShowToolArgs(readField)
    : buildAgentArtifactBrowserToolArgs(readField);
  const prompt = [
    editor.kind === 'artifact-show'
      ? 'Show one saved Agent artifact with the `agent_artifacts` tool.'
      : 'Browse saved Agent artifacts with the `agent_artifacts` tool.',
    `Use mode: ${JSON.stringify(args.mode)}.`,
    args.artifactId ? `Artifact id: ${JSON.stringify(args.artifactId)}.` : 'Artifact id: none.',
    args.query ? `Search query: ${JSON.stringify(args.query)}.` : 'Search query: none.',
    args.kind ? `Kind filter: ${JSON.stringify(args.kind)}.` : 'Kind filter: none.',
    args.mimeType ? `MIME filter: ${JSON.stringify(args.mimeType)}.` : 'MIME filter: none.',
    args.purpose ? `Purpose filter: ${JSON.stringify(args.purpose)}.` : 'Purpose filter: none.',
    args.source ? `Source filter: ${JSON.stringify(args.source)}.` : 'Source filter: none.',
    typeof args.limit === 'number' ? `Limit: ${args.limit}.` : 'Limit: default.',
    args.mode === 'show' ? `Preview content: ${args.includeContent ? 'yes' : 'no'}.` : 'Preview content: list metadata only.',
    'This is read-only. Do not delete, publish, or inline binary/base64 artifact bytes.',
  ].join('\n');

  return {
    kind: 'prompt',
    prompt,
    status: editor.kind === 'artifact-show' ? 'Submitting artifact inspection request.' : 'Submitting artifact browser request.',
    actionResult: {
      kind: 'guidance',
      title: editor.kind === 'artifact-show' ? 'Artifact inspection' : 'Artifact browser',
      detail: 'Submitted a read-only request to inspect saved Agent artifacts.',
      safety: 'read-only',
    },
  };
}
