import type { AgentWorkspaceActionResult, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export interface AgentDocumentReviewerReadinessToolArgs {
  readonly mode: 'document_ops_lane';
  readonly laneId: 'reviewer_readiness';
  readonly includeParameters: boolean;
}

export function createAgentDocumentReviewerReadinessEditor(): AgentWorkspaceLocalEditor {
  return {
    kind: 'document-reviewer-readiness',
    mode: 'create',
    title: 'Review Readiness Preflight',
    selectedFieldIndex: 0,
    message: 'Inspect unresolved document comments, proposed suggestions, missing source artifacts, unrevealed comparisons, route-change decisions, and reviewer handoff evidence before export, archive, or route update.',
    fields: [
      { id: 'scope', label: 'Scope', value: 'documents-and-compare', required: false, multiline: false, hint: 'Read-only preflight for Document Ops reviewer readiness.' },
      { id: 'includeRoutes', label: 'Repair routes', value: 'yes', required: false, multiline: false, hint: 'yes/no. Yes includes exact inspect and repair routes for the next action.' },
    ],
  };
}

function isAffirmative(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'yes' || normalized === 'true';
}

export function buildAgentDocumentReviewerReadinessToolArgs(
  readField: AgentWorkspaceFieldReader,
): AgentDocumentReviewerReadinessToolArgs {
  return {
    mode: 'document_ops_lane',
    laneId: 'reviewer_readiness',
    includeParameters: isAffirmative(readField('includeRoutes')),
  };
}

export function buildAgentDocumentReviewerReadinessPromptSubmission(
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
        detail: 'This runtime cannot submit the reviewer-readiness preflight from the workspace form.',
        safety: 'read-only',
      },
    };
  }

  const includeRoutes = isAffirmative(readField('includeRoutes'));
  return {
    kind: 'prompt',
    prompt: [
      'Inspect Document Ops reviewer readiness with the `agent_harness` tool.',
      'Use mode:"document_ops_lane" and laneId:"reviewer_readiness".',
      `Include exact repair routes: ${includeRoutes ? 'yes' : 'no'}.`,
      'Do not export, archive, reveal, apply a route update, or mutate a document from this preflight.',
    ].join('\n'),
    status: 'Submitting reviewer-readiness preflight.',
    actionResult: {
      kind: 'guidance',
      title: 'Review readiness preflight',
      detail: 'Submitted a read-only Document Ops readiness check before export, handoff archive, or route update.',
      safety: 'read-only',
    },
  };
}
