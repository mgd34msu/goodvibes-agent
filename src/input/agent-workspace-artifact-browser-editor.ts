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

export interface AgentArtifactKnowledgePromotionWorkspaceToolArgs {
  readonly sourceKind: 'artifact';
  readonly artifactId: string;
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly folderPath?: string;
  readonly connectorId?: string;
  readonly confirm: true;
  readonly explicitUserRequest: string;
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

function splitList(value: string): readonly string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
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

export function createAgentArtifactPromoteKnowledgeEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'artifact-promote-knowledge',
    mode: 'create',
    title: 'Promote Artifact to Knowledge',
    selectedFieldIndex: 0,
    message: 'Promote one reviewed saved artifact into isolated Agent Knowledge by id. This writes only through the Agent Knowledge artifact ingest route.',
    fields: [
      { id: 'artifactId', label: 'Artifact id', value: '', required: true, multiline: false, hint: 'Saved artifact id to ingest into Agent Knowledge.' },
      { id: 'title', label: 'Title', value: '', required: false, multiline: false, hint: 'Optional source title for Agent Knowledge.' },
      { id: 'tags', label: 'Tags', value: 'artifact', required: false, multiline: false, hint: 'Comma-separated optional tags.' },
      { id: 'folderPath', label: 'Folder', value: '', required: false, multiline: false, hint: 'Optional Agent Knowledge folder path.' },
      { id: 'connectorId', label: 'Connector id', value: 'goodvibes-agent-artifact-browser', required: false, multiline: false, hint: 'Optional connector id for provenance. Default is goodvibes-agent-artifact-browser.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to ingest this artifact into isolated Agent Knowledge.' },
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

export function buildAgentArtifactPromoteKnowledgeToolArgs(
  readField: AgentWorkspaceFieldReader,
  explicitUserRequest: string,
): AgentArtifactKnowledgePromotionWorkspaceToolArgs {
  const title = readField('title').trim();
  const folderPath = readField('folderPath').trim();
  const connectorId = readField('connectorId').trim();
  const tags = splitList(readField('tags'));
  return {
    sourceKind: 'artifact',
    artifactId: readField('artifactId').trim(),
    ...(title ? { title } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(folderPath ? { folderPath } : {}),
    ...(connectorId ? { connectorId } : {}),
    confirm: true,
    explicitUserRequest,
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

export function buildAgentArtifactPromoteKnowledgePromptSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
  promptDispatchAvailable: boolean,
): {
  readonly kind: 'editor';
  readonly editor: AgentWorkspaceLocalEditor;
  readonly status: string;
  readonly actionResult?: AgentWorkspaceActionResult;
} | {
  readonly kind: 'prompt';
  readonly prompt: string;
  readonly status: string;
  readonly actionResult: AgentWorkspaceActionResult;
} {
  if (!isAffirmative(readField('confirm'))) {
    return {
      kind: 'editor',
      editor: { ...editor, message: 'Type yes to confirm artifact ingest into isolated Agent Knowledge.' },
      status: 'Artifact Knowledge promotion not confirmed.',
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
        detail: 'This runtime cannot submit artifact Knowledge promotion from the workspace form.',
        safety: 'safe',
      },
    };
  }

  const args = buildAgentArtifactPromoteKnowledgeToolArgs(
    readField,
    'Promote a reviewed saved Agent artifact into isolated Agent Knowledge.',
  );
  const prompt = [
    'Promote one reviewed saved Agent artifact into isolated Agent Knowledge.',
    'Use the `agent_knowledge_ingest` tool with these arguments:',
    `sourceKind: ${JSON.stringify(args.sourceKind)}`,
    `artifactId: ${JSON.stringify(args.artifactId)}`,
    args.title ? `title: ${JSON.stringify(args.title)}` : 'title: none',
    args.tags && args.tags.length > 0 ? `tags: ${JSON.stringify(args.tags)}` : 'tags: none',
    args.folderPath ? `folderPath: ${JSON.stringify(args.folderPath)}` : 'folderPath: none',
    args.connectorId ? `connectorId: ${JSON.stringify(args.connectorId)}` : 'connectorId: default',
    'confirm: true',
    `explicitUserRequest: ${JSON.stringify(args.explicitUserRequest)}`,
    'Policy: isolated Agent Knowledge only; no default knowledge, no alternate knowledge segment, and no artifact deletion.',
  ].join('\n');

  return {
    kind: 'prompt',
    prompt,
    status: 'Submitting artifact Knowledge promotion request.',
    actionResult: {
      kind: 'guidance',
      title: 'Artifact Knowledge promotion',
      detail: 'Submitted a confirmed request to ingest one saved artifact into isolated Agent Knowledge.',
      safety: 'safe',
    },
  };
}
