import type { CommandContext } from '../input/command-registry.ts';
import { AGENT_WORKSPACE_CATEGORIES } from '../input/agent-workspace-categories.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from '../input/agent-workspace-snapshot.ts';
import { previewHarnessText } from './agent-harness-text.ts';

export type DocumentOpsLaneId =
  | 'documents'
  | 'uploads'
  | 'exports'
  | 'source_library'
  | 'media_artifacts'
  | 'artifact_browser'
  | 'model_compare';

type DocumentOpsStatus = 'ready' | 'partial' | 'needs-setup' | 'gap';

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
}

export type DocumentOpsLaneResolution =
  | { readonly status: 'found'; readonly lane: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

const LANE_IDS: readonly DocumentOpsLaneId[] = [
  'documents',
  'uploads',
  'exports',
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
  if (status === 'ready') return 4;
  if (status === 'partial') return 3;
  if (status === 'needs-setup') return 2;
  return 1;
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
  ].join('\n').toLowerCase();
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
    'document-export-conversation',
    'document-export-session',
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
    'artifact-browse',
    'artifact-show',
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
  const artifactBrowserReady = hasTool(context, 'agent_artifacts')
    && Boolean(context.platform.artifactStore?.list)
    && Boolean(context.platform.artifactStore?.readContent)
    && artifactBrowserActions.includes('artifact-browse')
    && artifactBrowserActions.includes('artifact-show');

  return [
    {
      id: 'documents',
      label: 'Documents',
      status: 'partial',
      outcome: 'Draft, revise, and export user-facing documents without leaving the Agent conversation.',
      current: 'Agent can draft and revise documents in the main conversation and export transcript/session artifacts, but there is no dedicated markdown editor, version history, or document artifact workspace yet.',
      next: 'Build a real document editor with versions, comments, export targets, and reusable artifact ids.',
      userRoute: 'Agent Workspace -> Documents & Compare -> Draft document',
      modelRoute: 'agent_harness mode:"workspace_actions" categoryId:"documents"',
      signals: [
        `Chat route ${snapshot.provider} / ${snapshot.modelDisplayName}`,
        `${exportActions.length} export action(s) available`,
        'Dedicated document editor: gap',
      ],
      actionIds: existingActions(['document-draft-chat', 'document-export-conversation', 'document-export-session'], available),
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
      outcome: 'Turn conversation and saved-session output into local files the user can keep or reuse.',
      current: `${exportActions.length} conversation/session export action(s) are reachable.`,
      next: 'Add document-native export once the editor exists; keep current transcript/session exports visible and confirmed.',
      userRoute: 'Agent Workspace -> Documents & Compare -> Export',
      modelRoute: 'agent_harness mode:"workspace_actions" query:"export conversation session"',
      signals: [
        `${exportActions.length} export action(s)`,
        `Session ${snapshot.sessionId}`,
      ],
      actionIds: exportActions,
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
        ? 'Agent has a unified read-only artifact browser with filters, redacted metadata, and bounded text previews over the SDK artifact store.'
        : 'Artifacts are real and visible in transcript, source, session, and media routes, but the unified browser is not fully wired in this runtime.',
      next: artifactBrowserReady
        ? 'Add reuse actions on top of the browser once document editing and artifact selection targets exist.'
        : 'Wire agent_artifacts and browse/show workspace actions over the SDK artifact store.',
      userRoute: 'Agent Workspace -> Artifacts -> Browse artifacts',
      modelRoute: artifactBrowserReady ? 'agent_artifacts' : 'agent_harness mode:"workspace_actions" categoryId:"artifacts"',
      signals: [
        `${uploadActions.length + exportActions.length + mediaActions.length} related artifact action(s)`,
        `Artifact browser tool: ${hasTool(context, 'agent_artifacts') ? 'available' : 'gap'}`,
        `Artifact list/read store: ${context.platform.artifactStore?.list && context.platform.artifactStore?.readContent ? 'available' : 'gap'}`,
      ],
      actionIds: artifactBrowserActions,
    },
    {
      id: 'model_compare',
      label: 'Blind Model Compare',
      status: modelCompareReady ? 'partial' : 'gap',
      outcome: 'Run the same prompt across multiple models, hide model identities while judging, save a judgment, then apply the revealed winner only after confirmation.',
      current: modelCompareReady
        ? 'Agent has a confirmed blind comparison runner with selectable or auto-selected candidates, identical prompt delivery, rubric capture, delayed reveal, durable JSON comparison artifacts, read-only saved review boards, confirmed saved judgment artifacts, saved preference analytics, markdown report export, and a separate confirmed winner route update.'
        : 'Model routing and model catalog inspection exist, but Agent does not have a blind side-by-side comparison runner or saved comparison artifacts.',
      next: modelCompareReady
        ? 'Build dedicated document editing and cross-session synthesis around saved comparison, judgment, analytics, export, and route-update artifacts.'
        : 'Implement a blind compare runner with selectable candidate models, identical prompt/context, rubric capture, delayed reveal, export, and route update handoff.',
      userRoute: 'Agent Workspace -> Documents & Compare -> Run blind compare',
      modelRoute: modelCompareReady ? 'agent_model_compare' : 'agent_harness mode:"model_routing"',
      signals: [
        `Current model ${snapshot.provider} / ${snapshot.modelDisplayName}`,
        `Blind compare runner: ${modelCompareReady ? 'available' : 'gap'}`,
        `Saved comparison artifact: ${modelCompareReady && context.platform.artifactStore ? 'available' : 'gap'}`,
        `Saved review board: ${modelCompareActions.includes('document-review-compare') ? 'available' : 'gap'}`,
        `Saved judgment artifact: ${modelCompareActions.includes('document-judge-compare') ? 'available' : 'gap'}`,
        `Saved preference analytics: ${modelCompareActions.includes('document-compare-analytics') ? 'available' : 'gap'}`,
        `Winner route update: ${modelCompareActions.includes('document-apply-compare') ? 'available' : 'gap'}`,
        `Markdown export: ${modelCompareActions.includes('document-export-compare') ? 'available' : 'gap'}`,
      ],
      actionIds: modelCompareActions,
    },
  ];
}

function nextActions(lanes: readonly DocumentOpsLane[]): readonly string[] {
  const urgent = lanes
    .filter((lane) => lane.status === 'gap' || lane.status === 'needs-setup')
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
  }, { ready: 0, partial: 0, 'needs-setup': 0, gap: 0 });
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
  return {
    lanes: lanes.map((lane) => describeLane(lane, includeParameters)),
    returned: lanes.length,
    total: lanes.length,
    policy: 'Document Ops unifies documents, uploads, exports, sources, media artifacts, artifact browsing, and model comparison. Dedicated document editing remains an explicit gap until a real workflow exists.',
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
