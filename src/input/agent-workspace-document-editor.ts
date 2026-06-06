import type { AgentWorkspaceActionResult, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export interface AgentDocumentWorkspaceToolArgs {
  readonly mode: 'list' | 'show' | 'create' | 'update' | 'review' | 'comment' | 'resolveComment' | 'export' | 'insertArtifact';
  readonly documentId?: string;
  readonly artifactId?: string;
  readonly commentId?: string;
  readonly comment?: string;
  readonly query?: string;
  readonly title?: string;
  readonly body?: string;
  readonly tags?: readonly string[];
  readonly status?: string;
  readonly placement?: string;
  readonly sectionTitle?: string;
  readonly includeContent?: boolean;
  readonly changeSummary?: string;
  readonly includeVersions?: boolean;
  readonly limit?: number;
  readonly confirm?: true;
  readonly explicitUserRequest?: string;
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

function readPositiveInteger(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(1, Math.trunc(parsed));
}

export function createAgentDocumentBrowseEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'document-browse',
    mode: 'create',
    title: 'Browse Documents',
    selectedFieldIndex: 0,
    message: 'List Agent-owned markdown drafts with version counts, status, tags, and last exported artifact id.',
    fields: [
      { id: 'query', label: 'Search', value: '', required: false, multiline: false, hint: 'Optional search across id, title, body, status, tags, and artifact id.' },
      { id: 'limit', label: 'Limit', value: '20', required: false, multiline: false, hint: 'Maximum document rows to return. Defaults to 20.' },
    ],
  };
}

export function createAgentDocumentShowEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'document-show',
    mode: 'create',
    title: 'Show Document',
    selectedFieldIndex: 0,
    message: 'Inspect one Agent-owned document draft and its version history.',
    fields: [
      { id: 'documentId', label: 'Document id', value: '', required: true, multiline: false, hint: 'Document id or exact title.' },
      { id: 'includeVersions', label: 'Include versions', value: 'yes', required: false, multiline: false, hint: 'yes/no. Yes includes version summaries.' },
    ],
  };
}

export function createAgentDocumentCreateEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'document-create',
    mode: 'create',
    title: 'Create Document Draft',
    selectedFieldIndex: 0,
    message: 'Create an Agent-owned markdown draft with an initial version. Type yes on the final field to save.',
    fields: [
      { id: 'title', label: 'Title', value: '', required: true, multiline: false, hint: 'Short document title.' },
      { id: 'body', label: 'Markdown body', value: '', required: true, multiline: true, hint: 'Document body. Ctrl-J inserts a new line.' },
      { id: 'tags', label: 'Tags', value: 'document', required: false, multiline: false, hint: 'Comma-separated optional tags.' },
      { id: 'changeSummary', label: 'Version note', value: 'Initial draft.', required: false, multiline: false, hint: 'Short note for version history.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to create this Agent document draft.' },
    ],
  };
}

export function createAgentDocumentUpdateEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'document-update',
    mode: 'create',
    title: 'Revise Document Draft',
    selectedFieldIndex: 0,
    message: 'Revise an Agent-owned markdown draft and append a new version. Leave optional fields blank to keep existing values.',
    fields: [
      { id: 'documentId', label: 'Document id', value: '', required: true, multiline: false, hint: 'Document id or exact title to revise.' },
      { id: 'title', label: 'Title', value: '', required: false, multiline: false, hint: 'Optional replacement title.' },
      { id: 'body', label: 'Markdown body', value: '', required: false, multiline: true, hint: 'Optional replacement body. Ctrl-J inserts a new line.' },
      { id: 'tags', label: 'Tags', value: '', required: false, multiline: false, hint: 'Optional replacement comma-separated tags.' },
      { id: 'status', label: 'Status', value: '', required: false, multiline: false, hint: 'Optional draft, reviewed, or archived.' },
      { id: 'changeSummary', label: 'Version note', value: 'Updated draft.', required: false, multiline: false, hint: 'Short note for version history.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to save a new document version.' },
    ],
  };
}

export function createAgentDocumentReviewEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'document-review',
    mode: 'create',
    title: 'Mark Document Reviewed',
    selectedFieldIndex: 0,
    message: 'Mark one Agent-owned document draft as reviewed and append a version history note.',
    fields: [
      { id: 'documentId', label: 'Document id', value: '', required: true, multiline: false, hint: 'Document id or exact title.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to mark this document reviewed.' },
    ],
  };
}

export function createAgentDocumentCommentEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'document-comment',
    mode: 'create',
    title: 'Add Document Comment',
    selectedFieldIndex: 0,
    message: 'Add one review comment to an Agent-owned document draft. Comments do not change the document body or append a content version.',
    fields: [
      { id: 'documentId', label: 'Document id', value: '', required: true, multiline: false, hint: 'Document id or exact title.' },
      { id: 'comment', label: 'Comment', value: '', required: true, multiline: true, hint: 'Review note or requested change. Ctrl-J inserts a new line.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to add this document comment.' },
    ],
  };
}

export function createAgentDocumentResolveCommentEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'document-resolve-comment',
    mode: 'create',
    title: 'Resolve Document Comment',
    selectedFieldIndex: 0,
    message: 'Resolve one review comment on an Agent-owned document draft without changing the document body.',
    fields: [
      { id: 'documentId', label: 'Document id', value: '', required: true, multiline: false, hint: 'Document id or exact title.' },
      { id: 'commentId', label: 'Comment id', value: '', required: true, multiline: false, hint: 'Comment id such as c1.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to resolve this document comment.' },
    ],
  };
}

export function createAgentDocumentExportEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'document-export',
    mode: 'create',
    title: 'Export Document Artifact',
    selectedFieldIndex: 0,
    message: 'Export one Agent-owned markdown draft as a saved artifact with document id and version metadata.',
    fields: [
      { id: 'documentId', label: 'Document id', value: '', required: true, multiline: false, hint: 'Document id or exact title to export.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to export this document as an artifact.' },
    ],
  };
}

export function createAgentDocumentInsertArtifactEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'document-insert-artifact',
    mode: 'create',
    title: 'Insert Artifact in Document',
    selectedFieldIndex: 0,
    message: 'Insert one saved artifact into an Agent-owned markdown draft as a new version. Text artifacts insert bounded content; binary artifacts insert a safe reference block.',
    fields: [
      { id: 'documentId', label: 'Document id', value: '', required: true, multiline: false, hint: 'Document id or exact title to revise.' },
      { id: 'artifactId', label: 'Artifact id', value: '', required: true, multiline: false, hint: 'Saved artifact id such as artifact-123.' },
      { id: 'placement', label: 'Placement', value: 'append', required: false, multiline: false, hint: 'append, prepend, or replace. Defaults to append.' },
      { id: 'sectionTitle', label: 'Section title', value: '', required: false, multiline: false, hint: 'Optional markdown heading for inserted artifact content.' },
      { id: 'includeContent', label: 'Include text', value: 'yes', required: false, multiline: false, hint: 'yes/no. Yes inserts bounded text for text-like artifacts. Binary artifacts always insert a reference.' },
      { id: 'changeSummary', label: 'Version note', value: 'Inserted saved artifact.', required: false, multiline: false, hint: 'Short note for version history.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to save a new document version with this artifact.' },
    ],
  };
}

export function buildAgentDocumentToolArgs(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
  explicitUserRequest: string,
): AgentDocumentWorkspaceToolArgs {
  const documentId = readField('documentId').trim();
  const title = readField('title').trim();
  const body = readField('body').trim();
  const tags = splitList(readField('tags'));
  const changeSummary = readField('changeSummary').trim();
  if (editor.kind === 'document-browse') {
    const query = readField('query').trim();
    const limit = readPositiveInteger(readField('limit'));
    return {
      mode: 'list',
      ...(query ? { query } : {}),
      ...(limit ? { limit } : {}),
    };
  }
  if (editor.kind === 'document-show') {
    return {
      mode: 'show',
      documentId,
      includeVersions: isAffirmative(readField('includeVersions')),
    };
  }
  if (editor.kind === 'document-create') {
    return {
      mode: 'create',
      title,
      body,
      ...(tags.length > 0 ? { tags } : {}),
      ...(changeSummary ? { changeSummary } : {}),
      confirm: true,
      explicitUserRequest,
    };
  }
  if (editor.kind === 'document-update') {
    const status = readField('status').trim();
    return {
      mode: 'update',
      documentId,
      ...(title ? { title } : {}),
      ...(body ? { body } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(status ? { status } : {}),
      ...(changeSummary ? { changeSummary } : {}),
      confirm: true,
      explicitUserRequest,
    };
  }
  if (editor.kind === 'document-review') {
    return {
      mode: 'review',
      documentId,
      confirm: true,
      explicitUserRequest,
    };
  }
  if (editor.kind === 'document-comment') {
    return {
      mode: 'comment',
      documentId,
      comment: readField('comment').trim(),
      confirm: true,
      explicitUserRequest,
    };
  }
  if (editor.kind === 'document-resolve-comment') {
    return {
      mode: 'resolveComment',
      documentId,
      commentId: readField('commentId').trim(),
      confirm: true,
      explicitUserRequest,
    };
  }
  if (editor.kind === 'document-insert-artifact') {
    const placement = readField('placement').trim();
    const sectionTitle = readField('sectionTitle').trim();
    return {
      mode: 'insertArtifact',
      documentId,
      artifactId: readField('artifactId').trim(),
      ...(placement ? { placement } : {}),
      ...(sectionTitle ? { sectionTitle } : {}),
      includeContent: isAffirmative(readField('includeContent')),
      ...(changeSummary ? { changeSummary } : {}),
      confirm: true,
      explicitUserRequest,
    };
  }
  return {
    mode: 'export',
    documentId,
    confirm: true,
    explicitUserRequest,
  };
}

export function buildAgentDocumentPromptSubmission(
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
  const mutation = editor.kind === 'document-create'
    || editor.kind === 'document-update'
    || editor.kind === 'document-review'
    || editor.kind === 'document-comment'
    || editor.kind === 'document-resolve-comment'
    || editor.kind === 'document-insert-artifact'
    || editor.kind === 'document-export';
  if (mutation && !isAffirmative(readField('confirm'))) {
    return {
      kind: 'editor',
      editor: { ...editor, message: 'Type yes to confirm this Agent document action.' },
      status: 'Agent document action not confirmed.',
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
        detail: 'This runtime cannot submit the document request from the workspace form.',
        safety: mutation ? 'safe' : 'read-only',
      },
    };
  }

  const args = buildAgentDocumentToolArgs(
    editor,
    readField,
    `Run the Agent document workspace action ${editor.title}.`,
  );
  const prompt = [
    'Use the `agent_documents` tool for this Agent document workspace request.',
    `mode: ${JSON.stringify(args.mode)}`,
    args.documentId ? `documentId: ${JSON.stringify(args.documentId)}` : 'documentId: none',
    args.artifactId ? `artifactId: ${JSON.stringify(args.artifactId)}` : 'artifactId: none',
    args.commentId ? `commentId: ${JSON.stringify(args.commentId)}` : 'commentId: none',
    args.comment ? `comment: ${JSON.stringify(args.comment)}` : 'comment: none',
    args.query ? `query: ${JSON.stringify(args.query)}` : 'query: none',
    args.title ? `title: ${JSON.stringify(args.title)}` : 'title: none',
    args.body ? `body: ${JSON.stringify(args.body)}` : 'body: none',
    args.tags && args.tags.length > 0 ? `tags: ${JSON.stringify(args.tags)}` : 'tags: none',
    args.status ? `status: ${JSON.stringify(args.status)}` : 'status: none',
    args.placement ? `placement: ${JSON.stringify(args.placement)}` : 'placement: none',
    args.sectionTitle ? `sectionTitle: ${JSON.stringify(args.sectionTitle)}` : 'sectionTitle: none',
    args.changeSummary ? `changeSummary: ${JSON.stringify(args.changeSummary)}` : 'changeSummary: none',
    typeof args.limit === 'number' ? `limit: ${args.limit}` : 'limit: default',
    typeof args.includeVersions === 'boolean' ? `includeVersions: ${args.includeVersions ? 'true' : 'false'}` : 'includeVersions: default',
    typeof args.includeContent === 'boolean' ? `includeContent: ${args.includeContent ? 'true' : 'false'}` : 'includeContent: default',
    args.confirm ? 'confirm: true' : 'confirm: not required',
    args.explicitUserRequest ? `explicitUserRequest: ${JSON.stringify(args.explicitUserRequest)}` : 'explicitUserRequest: not required',
    'Policy: Agent-owned document drafts only; no default knowledge write and no artifact export unless mode is export.',
  ].join('\n');

  return {
    kind: 'prompt',
    prompt,
    status: 'Submitting Agent document request.',
    actionResult: {
      kind: 'guidance',
      title: editor.title,
      detail: 'Submitted an Agent document request through the first-class document tool.',
      safety: mutation ? 'safe' : 'read-only',
    },
  };
}
