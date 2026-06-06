import type { ArtifactDescriptor } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { CommandContext } from '../input/command-registry.ts';
import { AGENT_WORKSPACE_CATEGORIES } from '../input/agent-workspace-categories.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from '../input/agent-workspace-snapshot.ts';
import { AgentDocumentRegistry, type AgentDocumentRecord } from '../agent/document-registry.ts';
import { previewHarnessText } from './agent-harness-text.ts';

export type DocumentOpsLaneId =
  | 'documents'
  | 'uploads'
  | 'exports'
  | 'reviewer_readiness'
  | 'source_library'
  | 'media_artifacts'
  | 'artifact_browser'
  | 'model_compare';

type DocumentOpsStatus = 'ready' | 'attention' | 'partial' | 'needs-setup' | 'gap';
type ReviewerReadinessStatus = 'ready' | 'attention' | 'needs-setup';
type ReviewerReadinessCheckStatus = 'pass' | 'attention' | 'needs-setup';

interface AgentHarnessDocumentOpsArgs {
  readonly laneId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
}

interface DocumentOpsLane {
  readonly id: DocumentOpsLaneId;
  readonly label: string;
  readonly status: DocumentOpsStatus;
  readonly outcome: string;
  readonly current: string;
  readonly next: string;
  readonly userRoute: string;
  readonly modelRoute: string;
  readonly signals: readonly string[];
  readonly actionIds: readonly string[];
  readonly reviewerReadiness?: ReviewerReadinessChecklist;
}

interface ReviewerReadinessChecklist {
  readonly status: ReviewerReadinessStatus;
  readonly next: string;
  readonly summary: {
    readonly documents: number;
    readonly openComments: number;
    readonly proposedSuggestions: number;
    readonly documentsMissingSourceArtifacts: number;
    readonly savedComparisons: number;
    readonly unrevealedComparisons: number;
    readonly hiddenJudgments: number;
    readonly revealedJudgments: number;
    readonly handoffsMissingRelatedArtifacts: number;
  };
  readonly checks: readonly ReviewerReadinessCheck[];
  readonly policy: string;
}

interface ReviewerReadinessCheck {
  readonly id: string;
  readonly label: string;
  readonly status: ReviewerReadinessCheckStatus;
  readonly count: number;
  readonly detail: string;
  readonly inspectRoute: string;
  readonly repairRoute?: string;
}

export type DocumentOpsLaneResolution =
  | { readonly status: 'found'; readonly lane: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

const LANE_IDS: readonly DocumentOpsLaneId[] = [
  'documents',
  'uploads',
  'exports',
  'reviewer_readiness',
  'source_library',
  'media_artifacts',
  'artifact_browser',
  'model_compare',
];

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function workspaceActionIds(): ReadonlySet<string> {
  return new Set(AGENT_WORKSPACE_CATEGORIES.flatMap((category) => category.actions.map((action) => action.id)));
}

function existingActions(ids: readonly string[], available: ReadonlySet<string>): readonly string[] {
  return ids.filter((id) => available.has(id));
}

function hasTool(context: CommandContext, toolName: string): boolean {
  return context.extensions.toolRegistry.has(toolName);
}

function statusRank(status: DocumentOpsStatus): number {
  if (status === 'attention') return 5;
  if (status === 'ready') return 4;
  if (status === 'partial') return 3;
  if (status === 'needs-setup') return 2;
  return 1;
}

function readMetadataString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readMetadataStringList(value: unknown): readonly string[] {
  if (typeof value === 'string') {
    return value.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
}

function artifactPurpose(artifact: ArtifactDescriptor): string {
  return readMetadataString(artifact.metadata.purpose);
}

function isModelCompareArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = artifactPurpose(artifact);
  if (purpose === 'agent-model-compare') return true;
  if (purpose) return false;
  return readMetadataString(artifact.filename).startsWith('blind-model-comparison-cmp_');
}

function isModelCompareJudgmentArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = artifactPurpose(artifact);
  if (purpose === 'agent-model-compare-judgment') return true;
  if (purpose) return false;
  return readMetadataString(artifact.filename).startsWith('blind-model-comparison-judgment-');
}

function isModelCompareHandoffArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = artifactPurpose(artifact);
  if (purpose === 'agent-model-compare-handoff') return true;
  if (purpose) return false;
  return readMetadataString(artifact.filename).startsWith('blind-model-comparison-handoff-');
}

function readDocuments(context: CommandContext): readonly AgentDocumentRecord[] {
  const shellPaths = context.workspace?.shellPaths;
  if (!shellPaths) return [];
  try {
    return AgentDocumentRegistry.fromShellPaths(shellPaths).list();
  } catch {
    return [];
  }
}

function readArtifacts(context: CommandContext): readonly ArtifactDescriptor[] {
  try {
    return context.platform.artifactStore?.list?.(100) ?? [];
  } catch {
    return [];
  }
}

function reviewerReadinessStatus(checks: readonly ReviewerReadinessCheck[]): ReviewerReadinessStatus {
  if (checks.some((check) => check.status === 'needs-setup')) return 'needs-setup';
  if (checks.some((check) => check.status === 'attention')) return 'attention';
  return 'ready';
}

function buildReviewerReadinessChecklist(
  context: CommandContext,
  options: {
    readonly documentsReady: boolean;
    readonly modelCompareReady: boolean;
    readonly artifactBrowserReady: boolean;
  },
): ReviewerReadinessChecklist {
  const documents = readDocuments(context);
  const reviewDocuments = documents.filter((document) => document.status !== 'archived');
  const openComments = reviewDocuments.reduce((total, document) => total + document.comments.filter((comment) => comment.status === 'open').length, 0);
  const proposedSuggestions = reviewDocuments.reduce((total, document) => total + document.suggestions.filter((suggestion) => suggestion.status === 'proposed').length, 0);
  const documentsMissingSourceArtifacts = reviewDocuments.filter((document) => document.attachments.length === 0 && !document.lastArtifactId).length;
  const artifacts = readArtifacts(context);
  const comparisons = artifacts.filter(isModelCompareArtifact);
  const judgments = artifacts.filter(isModelCompareJudgmentArtifact);
  const handoffs = artifacts.filter(isModelCompareHandoffArtifact);
  const revealedJudgments = judgments.filter((artifact) => (
    artifact.metadata.revealIncludedInJudgment === true
    && readMetadataString(artifact.metadata.winnerModel).length > 0
  ));
  const hiddenJudgments = judgments.filter((artifact) => (
    artifact.metadata.revealIncludedInJudgment !== true
    || readMetadataString(artifact.metadata.winnerModel).length === 0
  ));
  const revealedComparisonIds = new Set(revealedJudgments.map((artifact) => readMetadataString(artifact.metadata.comparisonId)).filter(Boolean));
  const unrevealedComparisons = comparisons.filter((artifact) => {
    const comparisonId = readMetadataString(artifact.metadata.comparisonId);
    return artifact.metadata.revealIncludedInTranscript !== true && (!comparisonId || !revealedComparisonIds.has(comparisonId));
  });
  const handoffsMissingRelatedArtifacts = handoffs.filter((artifact) => readMetadataStringList(artifact.metadata.relatedArtifactIds).length === 0).length;
  const comparisonSourceMissing = comparisons.filter((artifact) => (
    !readMetadataString(artifact.metadata.sourceArtifactId)
    && !readMetadataString(artifact.metadata.documentId)
  )).length;
  const missingSourceArtifacts = documentsMissingSourceArtifacts + comparisonSourceMissing;
  const firstOpenCommentDocument = reviewDocuments.find((document) => document.comments.some((comment) => comment.status === 'open'));
  const firstProposedSuggestionDocument = reviewDocuments.find((document) => document.suggestions.some((suggestion) => suggestion.status === 'proposed'));
  const firstUnrevealedComparison = unrevealedComparisons[0];
  const firstHiddenJudgment = hiddenJudgments[0];
  const firstRevealedJudgment = revealedJudgments[0];
  const firstHandoffMissingRelated = handoffs.find((artifact) => readMetadataStringList(artifact.metadata.relatedArtifactIds).length === 0);

  const checks: ReviewerReadinessCheck[] = [
    {
      id: 'review-tooling',
      label: 'Review tooling',
      status: options.documentsReady && options.modelCompareReady && options.artifactBrowserReady ? 'pass' : 'needs-setup',
      count: Number(options.documentsReady) + Number(options.modelCompareReady) + Number(options.artifactBrowserReady),
      detail: options.documentsReady && options.modelCompareReady && options.artifactBrowserReady
        ? 'Document, artifact, and blind comparison routes are available.'
        : 'Document, artifact, and blind comparison routes must be available before a reviewer-ready export can be trusted.',
      inspectRoute: 'agent_harness mode:"document_ops"',
      repairRoute: 'agent_harness mode:"workspace_actions" categoryId:"documents"',
    },
    {
      id: 'document-review-state',
      label: 'Document comments and suggestions',
      status: openComments + proposedSuggestions > 0 ? 'attention' : 'pass',
      count: openComments + proposedSuggestions,
      detail: openComments + proposedSuggestions > 0
        ? `${openComments} open comment(s) and ${proposedSuggestions} proposed suggestion(s) need a visible resolve, accept, or reject decision.`
        : 'No open document comments or proposed AI suggestions are waiting on reviewer action.',
      inspectRoute: firstOpenCommentDocument || firstProposedSuggestionDocument
        ? `agent_documents show documentId:"${firstOpenCommentDocument?.id ?? firstProposedSuggestionDocument?.id}" includeVersions:true`
        : 'agent_documents list',
      repairRoute: firstOpenCommentDocument
        ? `agent_documents resolveComment documentId:"${firstOpenCommentDocument.id}" commentId:"..." confirm:true explicitUserRequest:"..."`
        : firstProposedSuggestionDocument
          ? `agent_documents acceptSuggestion documentId:"${firstProposedSuggestionDocument.id}" suggestionId:"..." confirm:true explicitUserRequest:"..." or agent_documents rejectSuggestion documentId:"${firstProposedSuggestionDocument.id}" suggestionId:"..." confirm:true explicitUserRequest:"..."`
          : undefined,
    },
    {
      id: 'source-artifacts',
      label: 'Source artifacts',
      status: missingSourceArtifacts > 0 ? 'attention' : 'pass',
      count: missingSourceArtifacts,
      detail: missingSourceArtifacts > 0
        ? `${documentsMissingSourceArtifacts} document draft(s) and ${comparisonSourceMissing} comparison artifact(s) have no attached source artifact or document source marker.`
        : 'Document drafts and saved comparisons have source artifacts or explicit document/source markers where the current stores can verify them.',
      inspectRoute: 'agent_harness mode:"document_ops_lane" laneId:"artifact_browser"',
      repairRoute: missingSourceArtifacts > 0
        ? 'agent_documents attachArtifact documentId:"..." artifactId:"..." confirm:true explicitUserRequest:"..." or agent_model_compare handoff artifactId:"..." relatedArtifactIds:"..." confirm:true explicitUserRequest:"..."'
        : undefined,
    },
    {
      id: 'comparison-reveal',
      label: 'Blind comparison reveal',
      status: unrevealedComparisons.length + hiddenJudgments.length > 0 ? 'attention' : 'pass',
      count: unrevealedComparisons.length + hiddenJudgments.length,
      detail: unrevealedComparisons.length + hiddenJudgments.length > 0
        ? `${unrevealedComparisons.length} saved comparison(s) and ${hiddenJudgments.length} judgment(s) still hide winner identity before reviewer handoff.`
        : 'Saved comparison judgments with route-change implications are revealed, or no hidden comparison artifacts are pending.',
      inspectRoute: firstUnrevealedComparison
        ? `agent_model_compare review artifactId:"${firstUnrevealedComparison.id}"`
        : firstHiddenJudgment
          ? `agent_model_compare review artifactId:"${firstHiddenJudgment.id}"`
          : 'agent_model_compare review',
      repairRoute: firstUnrevealedComparison
        ? `agent_model_compare reveal artifactId:"${firstUnrevealedComparison.id}"`
        : firstHiddenJudgment
          ? `agent_model_compare judge artifactId:"${readMetadataString(firstHiddenJudgment.metadata.sourceArtifactId) || firstHiddenJudgment.id}" winnerBlindId:"${readMetadataString(firstHiddenJudgment.metadata.winnerBlindId) || '...'}" reveal:true confirm:true explicitUserRequest:"..."`
          : undefined,
    },
    {
      id: 'route-change-decision',
      label: 'Route-change decision',
      status: revealedJudgments.length > 0 ? 'attention' : 'pass',
      count: revealedJudgments.length,
      detail: revealedJudgments.length > 0
        ? `${revealedJudgments.length} revealed judgment(s) can drive a confirmed model route update, or the user can explicitly leave routing unchanged before archiving.`
        : 'No revealed model comparison judgment is waiting on an apply-or-leave-unchanged decision.',
      inspectRoute: firstRevealedJudgment
        ? `agent_model_compare review artifactId:"${firstRevealedJudgment.id}" reveal:true`
        : 'agent_harness mode:"model_routing"',
      repairRoute: firstRevealedJudgment
        ? `agent_model_compare apply artifactId:"${firstRevealedJudgment.id}" confirm:true explicitUserRequest:"..."`
        : undefined,
    },
    {
      id: 'handoff-archive-evidence',
      label: 'Reviewer handoff evidence',
      status: handoffsMissingRelatedArtifacts > 0 ? 'attention' : 'pass',
      count: handoffsMissingRelatedArtifacts,
      detail: handoffsMissingRelatedArtifacts > 0
        ? `${handoffsMissingRelatedArtifacts} reviewer handoff artifact(s) have no related evidence artifact ids before archive.`
        : 'Reviewer handoff artifacts include related evidence ids, or no reviewer handoff archive is pending.',
      inspectRoute: firstHandoffMissingRelated
        ? `agent_model_compare review artifactId:"${firstHandoffMissingRelated.id}"`
        : 'agent_model_compare review',
      repairRoute: firstHandoffMissingRelated
        ? `agent_model_compare handoff artifactId:"${readMetadataString(firstHandoffMissingRelated.metadata.sourceArtifactId) || firstHandoffMissingRelated.id}" relatedArtifactIds:"..." confirm:true explicitUserRequest:"..."`
        : undefined,
    },
  ];
  const status = reviewerReadinessStatus(checks);
  const firstAction = checks.find((check) => check.status === 'attention' || check.status === 'needs-setup');
  return {
    status,
    next: firstAction
      ? `${firstAction.label}: ${firstAction.detail}`
      : 'Export or archive reviewer packets through the returned confirmed document, artifact, or comparison routes.',
    summary: {
      documents: documents.length,
      openComments,
      proposedSuggestions,
      documentsMissingSourceArtifacts,
      savedComparisons: comparisons.length,
      unrevealedComparisons: unrevealedComparisons.length,
      hiddenJudgments: hiddenJudgments.length,
      revealedJudgments: revealedJudgments.length,
      handoffsMissingRelatedArtifacts,
    },
    checks,
    policy: 'Reviewer readiness is read-only. It flags unresolved review work and returns exact existing routes; document exports, comparison handoffs, archives, and model route updates still require explicit confirmation.',
  };
}

function searchText(lane: DocumentOpsLane): string {
  return [
    lane.id,
    lane.label,
    lane.status,
    lane.outcome,
    lane.current,
    lane.next,
    lane.userRoute,
    lane.modelRoute,
    lane.signals.join('\n'),
    lane.actionIds.join('\n'),
    lane.reviewerReadiness ? [
      lane.reviewerReadiness.status,
      lane.reviewerReadiness.next,
      lane.reviewerReadiness.policy,
      lane.reviewerReadiness.checks.map((check) => [
        check.id,
        check.label,
        check.status,
        check.detail,
        check.inspectRoute,
        check.repairRoute ?? '',
      ].join(' ')).join('\n'),
    ].join('\n') : '',
  ].join('\n').toLowerCase();
}

function describeReviewerReadinessCheck(check: ReviewerReadinessCheck, includeParameters: boolean): Record<string, unknown> {
  return {
    id: check.id,
    label: check.label,
    status: check.status,
    count: check.count,
    detail: previewHarnessText(check.detail, includeParameters ? 180 : 96),
    inspectRoute: previewHarnessText(check.inspectRoute, includeParameters ? 180 : 96),
    ...(check.repairRoute ? { repairRoute: previewHarnessText(check.repairRoute, includeParameters ? 240 : 120) } : {}),
  };
}

function describeReviewerReadiness(checklist: ReviewerReadinessChecklist, includeParameters: boolean): Record<string, unknown> {
  return {
    status: checklist.status,
    next: previewHarnessText(checklist.next, includeParameters ? 220 : 120),
    summary: checklist.summary,
    checks: checklist.checks
      .slice(0, includeParameters ? checklist.checks.length : 4)
      .map((check) => describeReviewerReadinessCheck(check, includeParameters)),
    policy: previewHarnessText(checklist.policy, includeParameters ? 220 : 120),
  };
}

function describeLane(lane: DocumentOpsLane, includeParameters: boolean): Record<string, unknown> {
  return {
    id: lane.id,
    label: lane.label,
    status: lane.status,
    outcome: lane.outcome,
    current: lane.current,
    next: lane.next,
    userRoute: previewHarnessText(lane.userRoute, 96),
    modelRoute: previewHarnessText(lane.modelRoute, 96),
    signals: lane.signals,
    ...(lane.reviewerReadiness ? { reviewerReadiness: describeReviewerReadiness(lane.reviewerReadiness, includeParameters) } : {}),
    ...(includeParameters ? {
      routes: {
        user: lane.userRoute,
        model: lane.modelRoute,
      },
      actionIds: lane.actionIds,
      safety: 'Document writes, file ingest, export, media generation, model comparison, and model changes stay explicit user-visible actions. Blind model comparison spends tokens only through confirmed agent_model_compare runs.',
    } : {}),
  };
}

function buildLanes(context: CommandContext): readonly DocumentOpsLane[] {
  const snapshot = buildAgentWorkspaceRuntimeSnapshot(context);
  const available = workspaceActionIds();
  const documentActions = existingActions([
    'document-browse-drafts',
    'document-show-draft',
    'document-create-draft',
    'document-revise-draft',
    'document-review-draft',
    'document-comment-draft',
    'document-resolve-comment',
    'document-suggest-draft',
    'document-accept-suggestion',
    'document-reject-suggestion',
    'document-insert-artifact',
    'document-attach-artifact',
    'document-export-draft',
    'document-draft-chat',
  ], available);
  const uploadActions = existingActions([
    'artifact-attach-image',
    'artifact-paste',
    'artifact-ingest-file',
    'artifact-ingest-url-list',
    'artifact-import-bookmarks',
    'artifact-browser-history',
    'document-attach-image',
    'document-paste',
    'document-ingest-file',
  ], available);
  const exportActions = existingActions([
    'artifact-export-conversation',
    'artifact-session-export',
    'conversation-export-current',
    'conversation-session-export',
    'document-export-draft',
    'document-export-artifact-file',
    'document-export-artifact-package',
    'document-export-conversation',
    'document-export-session',
    'artifact-export-file',
    'artifact-export-package',
  ], available);
  const sourceActions = existingActions([
    'artifact-source-library',
    'artifact-show-source',
    'research-knowledge-search',
    'research-knowledge-ask',
    'document-sources',
    'document-show-source',
  ], available);
  const mediaActions = existingActions([
    'artifact-media-providers',
    'artifact-generate-media',
    'media-providers',
    'media-generate',
    'document-media-providers',
    'document-generate-media',
  ], available);
  const artifactBrowserActions = existingActions([
    'document-browse-artifacts',
    'document-show-artifact',
    'document-export-artifact-file',
    'document-export-artifact-package',
    'document-promote-artifact',
    'artifact-browse',
    'artifact-show',
    'artifact-export-file',
    'artifact-export-package',
    'artifact-promote-knowledge',
    'artifact-insert-document',
    'artifact-attach-document',
    'document-artifacts',
    'artifact-flow',
    'artifact-show-source',
  ], available);
  const modelCompareActions = existingActions([
    'document-run-compare',
    'document-review-compare',
    'document-judge-compare',
    'document-compare-analytics',
    'document-apply-compare',
    'document-export-compare',
    'artifact-review-compare',
    'artifact-judge-compare',
    'artifact-compare-analytics',
    'artifact-apply-compare',
    'artifact-export-compare',
    'document-model-routing',
    'account-main-model',
  ], available);
  const modelCompareReady = hasTool(context, 'agent_model_compare') && modelCompareActions.includes('document-run-compare');
  const documentsReady = hasTool(context, 'agent_documents')
    && documentActions.includes('document-browse-drafts')
    && documentActions.includes('document-show-draft')
    && documentActions.includes('document-create-draft')
    && documentActions.includes('document-revise-draft')
    && documentActions.includes('document-comment-draft')
    && documentActions.includes('document-resolve-comment')
    && documentActions.includes('document-suggest-draft')
    && documentActions.includes('document-accept-suggestion')
    && documentActions.includes('document-reject-suggestion')
    && documentActions.includes('document-insert-artifact')
    && documentActions.includes('document-attach-artifact')
    && documentActions.includes('document-export-draft');
  const artifactBrowserReady = hasTool(context, 'agent_artifacts')
    && hasTool(context, 'agent_knowledge_ingest')
    && Boolean(context.platform.artifactStore?.list)
    && Boolean(context.platform.artifactStore?.readContent)
    && artifactBrowserActions.includes('artifact-browse')
    && artifactBrowserActions.includes('artifact-show')
    && artifactBrowserActions.includes('artifact-export-file')
    && artifactBrowserActions.includes('artifact-export-package')
    && artifactBrowserActions.includes('artifact-promote-knowledge');
  const reviewerReadiness = buildReviewerReadinessChecklist(context, {
    documentsReady,
    modelCompareReady,
    artifactBrowserReady,
  });

  return [
    {
      id: 'documents',
      label: 'Documents',
      status: documentsReady ? 'ready' : 'partial',
      outcome: 'Draft, revise, and export user-facing documents without leaving the Agent conversation.',
      current: documentsReady
        ? 'Agent has project-scoped markdown document drafts with version history, review status, review comments, AI suggestion review, read-only inspection, confirmed artifact attachment, confirmed artifact insertion, and confirmed artifact export with reviewer-ready comment and suggestion appendices.'
        : 'Agent can draft and revise documents in the main conversation and export transcript/session artifacts, but the dedicated markdown draft tool is not fully wired.',
      next: documentsReady
        ? 'Use versioned drafts, comments, suggestions, artifact reuse, artifact packages or ZIP archives, and artifact-backed comparison as one document workflow.'
        : 'Wire agent_documents plus browse/show/create/revise/review/export workspace actions.',
      userRoute: 'Agent Workspace -> Documents & Compare -> Create document draft',
      modelRoute: documentsReady ? 'agent_documents' : 'agent_harness mode:"workspace_actions" categoryId:"documents"',
      signals: [
        `Chat route ${snapshot.provider} / ${snapshot.modelDisplayName}`,
        `Document draft tool: ${hasTool(context, 'agent_documents') ? 'available' : 'gap'}`,
        `${documentActions.length} document draft action(s)`,
        `${exportActions.length} export action(s) available`,
        documentsReady ? 'Versioned markdown drafts: available' : 'Versioned markdown drafts: gap',
        documentActions.includes('document-comment-draft') ? 'Review comments: available' : 'Review comments: gap',
        documentActions.includes('document-suggest-draft') ? 'AI suggestion review: available' : 'AI suggestion review: not wired',
        documentActions.includes('document-attach-artifact') ? 'Artifact-to-document attachment: available' : 'Artifact-to-document attachment: gap',
        documentActions.includes('document-insert-artifact') ? 'Artifact-to-document insert: available' : 'Artifact-to-document insert: gap',
      ],
      actionIds: documentActions,
    },
    {
      id: 'uploads',
      label: 'Uploads',
      status: uploadActions.length >= 4 ? 'ready' : uploadActions.length > 0 ? 'partial' : 'gap',
      outcome: 'Attach, paste, or ingest files and URLs through explicit user-visible routes.',
      current: `${uploadActions.length} upload/ingest action(s) are reachable from the workspace.`,
      next: uploadActions.length > 0
        ? 'Use attach, paste, or reviewed source ingest depending on whether the file is prompt context or durable Agent Knowledge.'
        : 'Wire upload, paste, and file ingest actions before exposing this as ready.',
      userRoute: 'Agent Workspace -> Documents & Compare -> Attach or ingest',
      modelRoute: 'agent_harness mode:"workspace_actions" query:"upload file ingest"',
      signals: [
        `${uploadActions.length} upload/ingest action(s)`,
        `Artifact max ${Math.round(snapshot.artifactMaxBytes / (1024 * 1024))} MB`,
      ],
      actionIds: uploadActions,
    },
    {
      id: 'exports',
      label: 'Exports',
      status: exportActions.length >= 2 ? 'ready' : exportActions.length > 0 ? 'partial' : 'gap',
      outcome: 'Turn conversations, sessions, documents, and saved artifacts into local files the user can keep or reuse.',
      current: `${exportActions.length} export action(s) are reachable for conversation, session, document, comparison, and saved artifact output.`,
      next: 'Keep transcript, session, document, comparison, and artifact exports visible, explicit, and reusable from one place.',
      userRoute: 'Agent Workspace -> Documents & Compare -> Export',
      modelRoute: 'agent_harness mode:"workspace_actions" query:"export artifact"',
      signals: [
        `${exportActions.length} export action(s)`,
        `Session ${snapshot.sessionId}`,
      ],
      actionIds: exportActions,
    },
    {
      id: 'reviewer_readiness',
      label: 'Reviewer Readiness',
      status: reviewerReadiness.status === 'ready' ? 'ready' : reviewerReadiness.status === 'attention' ? 'attention' : 'needs-setup',
      outcome: 'Know what must be resolved before exporting, handing off, archiving, or applying comparison-backed route changes.',
      current: `${reviewerReadiness.summary.documents} document draft(s), ${reviewerReadiness.summary.openComments} open comment(s), ${reviewerReadiness.summary.proposedSuggestions} proposed suggestion(s), ${reviewerReadiness.summary.savedComparisons} saved comparison(s), ${reviewerReadiness.summary.revealedJudgments} revealed judgment(s).`,
      next: reviewerReadiness.next,
      userRoute: 'Agent Workspace -> Documents & Compare -> Readiness map',
      modelRoute: 'agent_harness mode:"document_ops_lane" laneId:"reviewer_readiness"',
      signals: [
        `Reviewer readiness ${reviewerReadiness.status}`,
        `Open comments ${reviewerReadiness.summary.openComments}`,
        `Proposed suggestions ${reviewerReadiness.summary.proposedSuggestions}`,
        `Missing source artifacts ${reviewerReadiness.summary.documentsMissingSourceArtifacts}`,
        `Unrevealed comparisons ${reviewerReadiness.summary.unrevealedComparisons}`,
        `Hidden judgments ${reviewerReadiness.summary.hiddenJudgments}`,
        `Route decisions ${reviewerReadiness.summary.revealedJudgments}`,
        `Handoffs missing related evidence ${reviewerReadiness.summary.handoffsMissingRelatedArtifacts}`,
      ],
      actionIds: [
        ...documentActions.filter((id) => [
          'document-show-draft',
          'document-resolve-comment',
          'document-accept-suggestion',
          'document-reject-suggestion',
          'document-attach-artifact',
          'document-export-draft',
        ].includes(id)),
        ...modelCompareActions.filter((id) => [
          'document-review-compare',
          'document-judge-compare',
          'document-apply-compare',
          'document-export-compare',
        ].includes(id)),
        ...artifactBrowserActions.filter((id) => [
          'artifact-browse',
          'artifact-show',
          'artifact-export-package',
        ].includes(id)),
      ],
      reviewerReadiness,
    },
    {
      id: 'source_library',
      label: 'Sources',
      status: sourceActions.length >= 2 ? 'ready' : sourceActions.length > 0 ? 'partial' : 'gap',
      outcome: 'Inspect source-backed records before citing, summarizing, or promoting knowledge.',
      current: `${sourceActions.length} source lookup/search action(s) are reachable through isolated Agent Knowledge.`,
      next: 'Use source search/show for citation checks; ingest reviewed files or URLs only through explicit source actions.',
      userRoute: 'Agent Workspace -> Documents & Compare -> Sources',
      modelRoute: 'agent_harness mode:"workspace_actions" query:"Agent Knowledge sources"',
      signals: [
        `Knowledge route ${snapshot.knowledgeRoute}`,
        `Knowledge isolation ${snapshot.knowledgeIsolation}`,
      ],
      actionIds: sourceActions,
    },
    {
      id: 'media_artifacts',
      label: 'Media Artifacts',
      status: snapshot.mediaGenerationProviderCount > 0 ? 'ready' : mediaActions.length > 0 ? 'needs-setup' : 'gap',
      outcome: 'Generate image or video artifacts through configured providers and keep generated bytes out of the transcript.',
      current: `${snapshot.voiceMediaReadiness.readyMediaProviderCount}/${snapshot.mediaProviderCount} media provider(s) ready; ${snapshot.mediaGenerationProviderCount} generation provider(s).`,
      next: snapshot.mediaGenerationProviderCount > 0
        ? 'Use confirmed media generation when the user asks for a concrete artifact.'
        : 'Configure a media generation provider before claiming generated media is ready.',
      userRoute: 'Agent Workspace -> Documents & Compare -> Generate media',
      modelRoute: 'agent_media_generate',
      signals: [
        `${mediaActions.length} media action(s)`,
        `${snapshot.mediaGenerationProviderCount} generation provider(s)`,
      ],
      actionIds: mediaActions,
    },
    {
      id: 'artifact_browser',
      label: 'Artifact Browser',
      status: artifactBrowserReady ? 'ready' : artifactBrowserActions.length > 0 ? 'partial' : 'gap',
      outcome: 'Find and reuse uploaded, exported, generated, and source-backed artifacts from one place.',
      current: artifactBrowserReady
        ? 'Agent has a unified artifact browser with filters, redacted metadata, bounded text previews, confirmed artifact export-to-file, confirmed multi-artifact package export and ZIP archive export, confirmed artifact-to-Knowledge promotion, confirmed artifact-to-document attachment, and confirmed artifact-to-document insertion over the SDK artifact store.'
        : 'Artifacts are real and visible in transcript, source, session, and media routes, but the unified browser is not fully wired in this runtime.',
      next: artifactBrowserReady
        ? 'Use package or ZIP archive exports across document, upload, generated media, session, comparison, and Knowledge artifacts.'
        : 'Wire agent_artifacts and browse/show workspace actions over the SDK artifact store.',
      userRoute: 'Agent Workspace -> Artifacts -> Browse artifacts, Export package, or Promote to Knowledge',
      modelRoute: artifactBrowserReady ? 'agent_artifacts + agent_knowledge_ingest' : 'agent_harness mode:"workspace_actions" categoryId:"artifacts"',
      signals: [
        `${uploadActions.length + exportActions.length + mediaActions.length} related artifact action(s)`,
        `Artifact browser tool: ${hasTool(context, 'agent_artifacts') ? 'available' : 'gap'}`,
        `Knowledge ingest tool: ${hasTool(context, 'agent_knowledge_ingest') ? 'available' : 'gap'}`,
        `Artifact list/read store: ${context.platform.artifactStore?.list && context.platform.artifactStore?.readContent ? 'available' : 'gap'}`,
        `Artifact export action: ${artifactBrowserActions.includes('artifact-export-file') ? 'available' : 'gap'}`,
        `Artifact package export action: ${artifactBrowserActions.includes('artifact-export-package') ? 'available' : 'gap'}`,
        `Knowledge promotion action: ${artifactBrowserActions.includes('artifact-promote-knowledge') ? 'available' : 'gap'}`,
        `Document attachment action: ${artifactBrowserActions.includes('artifact-attach-document') ? 'available' : 'gap'}`,
        `Document insertion action: ${artifactBrowserActions.includes('artifact-insert-document') ? 'available' : 'gap'}`,
      ],
      actionIds: artifactBrowserActions,
    },
    {
      id: 'model_compare',
      label: 'Blind Model Compare',
      status: modelCompareReady ? 'partial' : 'gap',
      outcome: 'Run the same prompt across multiple models, hide model identities while judging, save a judgment, then apply the revealed winner only after confirmation.',
      current: modelCompareReady
        ? 'Agent has a confirmed blind comparison runner with selectable or auto-selected candidates, identical prompt or saved text artifact delivery, rubric capture, delayed reveal, durable JSON comparison artifacts, read-only saved review boards, side-by-side reviewer views, confirmed saved judgment artifacts, task/document/benchmark-filtered preference analytics/synthesis, markdown report export, reviewer handoff artifacts, one-click reviewer handoff ZIP archives with source evidence, and a separate confirmed winner route update.'
        : 'Model routing and model catalog inspection exist, but Agent does not have a blind side-by-side comparison runner or saved comparison artifacts.',
      next: modelCompareReady
        ? 'Use cross-session synthesis and reviewer handoff ZIP archives around saved comparison, judgment, export, route-update, and source-artifact reuse artifacts.'
        : 'Implement a blind compare runner with selectable candidate models, identical prompt/context, rubric capture, delayed reveal, export, and route update handoff.',
      userRoute: 'Agent Workspace -> Documents & Compare -> Run blind compare',
      modelRoute: modelCompareReady ? 'agent_model_compare' : 'agent_harness mode:"model_routing"',
      signals: [
        `Current model ${snapshot.provider} / ${snapshot.modelDisplayName}`,
        `Blind compare runner: ${modelCompareReady ? 'available' : 'gap'}`,
        `Saved comparison artifact: ${modelCompareReady && context.platform.artifactStore ? 'available' : 'gap'}`,
        `Artifact-to-compare reuse: ${modelCompareActions.includes('document-run-compare') ? 'available' : 'gap'}`,
        `Saved review board/side-by-side view: ${modelCompareActions.includes('document-review-compare') ? 'available' : 'gap'}`,
        `Saved judgment artifact: ${modelCompareActions.includes('document-judge-compare') ? 'available' : 'gap'}`,
        `Saved preference analytics/synthesis with task/document/benchmark filters: ${modelCompareActions.includes('document-compare-analytics') ? 'available' : 'gap'}`,
        `Winner route update: ${modelCompareActions.includes('document-apply-compare') ? 'available' : 'gap'}`,
        `Markdown export/handoff/archive: ${modelCompareActions.includes('document-export-compare') ? 'available' : 'gap'}`,
      ],
      actionIds: modelCompareActions,
    },
  ];
}

function nextActions(lanes: readonly DocumentOpsLane[]): readonly string[] {
  const urgent = lanes
    .filter((lane) => lane.status === 'gap' || lane.status === 'needs-setup' || lane.status === 'attention')
    .map((lane) => `${lane.label}: ${lane.next}`);
  const partial = lanes
    .filter((lane) => lane.status === 'partial')
    .map((lane) => `${lane.label}: ${lane.next}`);
  return [...urgent, ...partial].slice(0, 5);
}

export function documentOpsCatalogStatus(context: CommandContext): Record<string, unknown> {
  const lanes = buildLanes(context);
  const counts = lanes.reduce<Record<DocumentOpsStatus, number>>((acc, lane) => {
    acc[lane.status] += 1;
    return acc;
  }, { ready: 0, attention: 0, partial: 0, 'needs-setup': 0, gap: 0 });
  return {
    modes: ['document_ops', 'document_ops_lane'],
    lanes: lanes.length,
    ...counts,
    bestReadyStatus: lanes.reduce((best, lane) => Math.max(best, statusRank(lane.status)), 0),
  };
}

export function documentOpsSummary(context: CommandContext, args: AgentHarnessDocumentOpsArgs): Record<string, unknown> {
  const includeParameters = args.includeParameters === true;
  const lanes = buildLanes(context);
  const reviewerReadiness = lanes.find((lane) => lane.id === 'reviewer_readiness')?.reviewerReadiness;
  return {
    lanes: lanes.map((lane) => describeLane(lane, includeParameters)),
    returned: lanes.length,
    total: lanes.length,
    ...(reviewerReadiness ? { reviewerReadiness: describeReviewerReadiness(reviewerReadiness, includeParameters) } : {}),
    policy: 'Document Ops unifies versioned document drafts, reviewer-readiness checks, review comments, AI suggestion review, uploads, exports, sources, media artifacts, artifact browsing, artifact-to-Knowledge promotion, and model comparison.',
    nextActions: nextActions(lanes),
  };
}

export function describeDocumentOpsLane(context: CommandContext, args: AgentHarnessDocumentOpsArgs): DocumentOpsLaneResolution {
  const laneId = readString(args.laneId);
  const target = readString(args.target);
  const query = readString(args.query);
  const input = laneId || target || query;
  if (!input) {
    return {
      status: 'missing_lookup',
      usage: `document_ops_lane requires laneId, target, or query. Lane ids: ${LANE_IDS.join(', ')}.`,
    };
  }
  const normalized = input.toLowerCase();
  const lanes = buildLanes(context);
  const exact = lanes.find((lane) => lane.id === normalized);
  if (exact) return { status: 'found', lane: describeLane(exact, true) };
  const matches = lanes.filter((lane) => searchText(lane).includes(normalized));
  if (matches.length === 1) return { status: 'found', lane: describeLane(matches[0]!, true) };
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      input,
      candidates: matches.map((lane) => ({
        laneId: lane.id,
        label: lane.label,
        status: lane.status,
        modelRoute: lane.modelRoute,
      })),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown Document Ops lane ${input}. Lane ids: ${LANE_IDS.join(', ')}.`,
  };
}
