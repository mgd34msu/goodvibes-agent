import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { CommandContext, CommandRegistry } from '../input/command-registry.ts';
import { buildAgentArtifactBrowserToolArgs, buildAgentArtifactExportToolArgs, buildAgentArtifactPackageToolArgs, buildAgentArtifactPromoteKnowledgeToolArgs, buildAgentArtifactShowToolArgs } from '../input/agent-workspace-artifact-browser-editor.ts';
import { buildAgentDocumentReviewerReadinessToolArgs, buildAgentDocumentReviewPacketPresetRefreshToolArgs, buildAgentDocumentReviewPacketPresetToolArgs, buildAgentDocumentReviewPacketShareToolArgs, buildAgentDocumentReviewPacketWizardToolArgs } from '../input/agent-workspace-document-ops-editor.ts';
import { buildAgentDocumentToolArgs } from '../input/agent-workspace-document-editor.ts';
import { buildAgentWorkspaceCommandEditorSubmission, isAgentWorkspaceCommandEditorKind } from '../input/agent-workspace-command-editor.ts';
import { buildAgentModelCompareAnalyticsToolArgs, buildAgentModelCompareApplyToolArgs, buildAgentModelCompareExportToolArgs, buildAgentModelCompareHandoffDiffToolArgs, buildAgentModelCompareJudgmentToolArgs, buildAgentModelCompareReviewToolArgs, buildAgentModelCompareRouteDecisionToolArgs, buildAgentModelCompareToolArgs } from '../input/agent-workspace-model-compare-editor.ts';
import { buildAgentResearchReportToolArgs } from '../input/agent-workspace-research-report-editor.ts';
import { buildAgentResearchRunToolArgs } from '../input/agent-workspace-research-run-editor.ts';
import { buildAgentResearchSourceToolArgs } from '../input/agent-workspace-research-source-editor.ts';
import { importAgentWorkspaceTuiSettings, previewAgentWorkspaceTuiSettingsImport } from '../input/agent-workspace-settings.ts';
import { isAffirmative, splitList } from '../input/agent-workspace-editors.ts';
import { createAgentWorkspaceLearnedBehavior } from '../input/agent-workspace-learned-behavior.ts';
import type { AgentWorkspaceAction, AgentWorkspaceLocalEditor } from '../input/agent-workspace-types.ts';
import { agentOrchestrationCatalogStatus, agentOrchestrationSummary, describeAgentOrchestrationAgent } from './agent-harness-agent-orchestration.ts';
import { autonomyIntakeSummary } from './agent-harness-autonomy-intake.ts';
import { autonomyQueueCatalogStatus, autonomyQueueSummary, describeAutonomyQueueItem } from './agent-harness-autonomy-queue.ts';
import { channelReadinessCatalogStatus, describeHarnessChannel, describeHarnessChannelDeliveries, describeHarnessChannelSetupGuide, describeHarnessChannelTriage, listHarnessChannels } from './agent-harness-channel-metadata.ts';
import { blockedHarnessCliCommandTokens, describeHarnessCliCommand, listHarnessCliCommands, totalHarnessCliCommands } from './agent-harness-cli-metadata.ts';
import { describeHarnessCommand, listHarnessCommands, resolveHarnessCommandDetail, type CommandDetailLookup } from './agent-harness-command-catalog.ts';
import { describeLearningCandidate, learningCuratorCatalogStatus, learningCuratorSummary } from './agent-harness-learning-curator.ts';
import { delegationPostureCatalogStatus, delegationPostureSummary, describeHarnessDelegationRoute } from './agent-harness-delegation-posture.ts';
import { describeHarnessKeybinding, listHarnessKeybindings, listHarnessShortcuts, resetHarnessKeybinding, runHarnessKeybinding, setHarnessKeybinding, totalHarnessKeybindings, totalHarnessShortcuts } from './agent-harness-keybinding-metadata.ts';
import { describeHarnessMediaProvider, mediaPostureCatalogStatus, mediaPostureSummary } from './agent-harness-media-posture.ts';
import { describeHarnessNotificationTarget, listHarnessNotificationTargets, notificationTargetCatalogStatus } from './agent-harness-notification-metadata.ts';
import { describeHarnessPanel, listHarnessPanels, openHarnessPanel, totalHarnessPanels } from './agent-harness-panel-metadata.ts';
import { connectedHostStatusSummary } from './agent-harness-connected-host-status.ts';
import { backgroundProcessCatalogStatus, backgroundProcessSummary, describeBackgroundProcess, runBackgroundProcessAction } from './agent-harness-background-processes.ts';
import { describeDocumentOpsLane, documentOpsCatalogStatus, documentOpsSummary } from './agent-harness-document-ops.ts';
import { describeExecutionHistoryItem, executionHistoryCatalogStatus, executionHistorySummary } from './agent-harness-execution-history.ts';
import { describeHarnessExecutionRoute, executionPostureCatalogStatus, executionPostureSummary } from './agent-harness-execution-posture.ts';
import { fileRecoveryCatalogStatus, fileRecoverySummary, runFileRecovery } from './agent-harness-file-recovery.ts';
import { runLocalWorkspaceAction, runLocalWorkspaceEditorAction } from './agent-harness-local-operations.ts';
import { describeHarnessMcpServer, mcpServerCatalogStatus, mcpServerSummary } from './agent-harness-mcp-metadata.ts';
import { describeHarnessModelRoute, modelRoutingCatalogStatus, modelRoutingSummary, runLocalModelServerSmoke } from './agent-harness-model-routing.ts';
import { describeHarnessModelTool, listHarnessModelTools } from './agent-harness-model-tool-catalog.ts';
import { describeMemoryProvider, memoryPostureCatalogStatus, memoryPostureSummary } from './agent-harness-memory-posture.ts';
import { describeHarnessOperatorMethod, operatorMethodCatalogStatus, operatorMethodSummary } from './agent-harness-operator-methods.ts';
import { describePersonalOpsLane, personalOpsBriefingSummary, personalOpsCatalogStatus, personalOpsIntakeSummary, personalOpsQueueSummary, personalOpsSummary, runPersonalOpsRead } from './agent-harness-personal-ops.ts';
import { describeHarnessPairingRoute, pairingPostureCatalogStatus, pairingPostureSummary } from './agent-harness-pairing-posture.ts';
import { promptContextCatalogStatus, promptContextSummary } from './agent-harness-prompt-context.ts';
import { describeProjectContextFile, projectContextCatalogStatus, projectContextSummary } from './agent-harness-project-context.ts';
import { describeHarnessProviderAccount, providerAccountCatalogStatus, providerAccountSummary } from './agent-harness-provider-account-metadata.ts';
import { describeHarnessReleaseEvidenceArtifact, releaseEvidenceBundleStatus, releaseEvidenceSummary } from './agent-harness-release-evidence.ts';
import { describeHarnessReleaseReadinessItem, releaseReadinessInventoryStatus, releaseReadinessSummary } from './agent-harness-release-readiness.ts';
import { researchBriefingCatalogStatus, researchBriefingSummary } from './agent-harness-research-briefing.ts';
import { describeResearchRun, researchRunsCatalogStatus, researchRunsSummary } from './agent-harness-research-runs.ts';
import { researchWorkflowSummary } from './agent-harness-research-workflow.ts';
import { describeResearchSource, researchQueueCatalogStatus, researchQueueSummary } from './agent-harness-research-queue.ts';
import { describeHarnessSecurityFinding, describeHarnessSupportBundle, securityPostureCatalogStatus, securityPostureSummary, supportBundleCatalogStatus, supportBundleSummary } from './agent-harness-security-posture.ts';
import { describeHarnessSession, sessionCatalogStatus, sessionSummary } from './agent-harness-session-metadata.ts';
import { describeHarnessServiceEndpoint, servicePostureCatalogStatus, servicePostureSummary } from './agent-harness-service-posture.ts';
import { clearSetupCheckpoint, describeHarnessSetupItem, markSetupCheckpoint, provisionConnectedHostOperatorToken, runSetupInstallSmoke, setupCheckpointSummary, setupPostureCatalogStatus, setupPostureSummary } from './agent-harness-setup-posture.ts';
import { AGENT_HARNESS_MODES, AGENT_HARNESS_PARAMETER_PROPERTIES } from './agent-harness-tool-schema.ts';
import { describeHarnessMode, HARNESS_MODE_DESCRIPTORS, listHarnessModes, type AgentHarnessMode } from './agent-harness-mode-catalog.ts';
import { describeHarnessUiSurface, listHarnessUiSurfaces, openHarnessUiSurface, totalHarnessUiSurfaces } from './agent-harness-ui-surface-metadata.ts';
import { AGENT_WORKSPACE_CATEGORIES, allWorkspaceActions, buildWorkspaceEditorContext, createWorkspaceEditor, describeWorkspaceAction, describeWorkspaceCategory, describeWorkspaceEditor, listWorkspaceActions, resolveWorkspaceActionDetail } from './agent-harness-workspace-actions.ts';
import { describeWorkspaceEditorModelExecution } from './agent-harness-workspace-editor-execution.ts';
import { connectedHostSummary, describeConnectedHostCapability, settingsPolicySummary } from './agent-harness-metadata.ts';
import { countHarnessSettings, formatHarnessError, listHarnessSettings, resetHarnessSetting, resolveHarnessSetting, setHarnessSetting } from '../agent/harness-control.ts';
import { buildAssistantCockpitFromSummaries } from '../agent/assistant-cockpit.ts';
import { writeOnboardingCheckMarker, writeOnboardingCompletionMarker } from '../runtime/onboarding/index.ts';

interface AgentHarnessToolArgs {
  readonly mode?: unknown;
  readonly query?: unknown;
  readonly command?: unknown;
  readonly cliCommand?: unknown;
  readonly commandName?: unknown;
  readonly args?: unknown;
  readonly channelId?: unknown;
  readonly notificationTargetId?: unknown;
  readonly providerId?: unknown;
  readonly mcpServerId?: unknown;
  readonly setupItemId?: unknown;
  readonly contextFileId?: unknown;
  readonly receiptId?: unknown;
  readonly turnId?: unknown;
  readonly outcomeStatus?: unknown;
  readonly modelRouteId?: unknown;
  readonly executionRouteId?: unknown;
  readonly executionRecordId?: unknown;
  readonly processId?: unknown;
  readonly processSessionId?: unknown;
  readonly processAction?: unknown;
  readonly action?: unknown;
  readonly recoveryAction?: unknown;
  readonly laneId?: unknown;
  readonly queueItemId?: unknown;
  readonly candidateId?: unknown;
  readonly sourceId?: unknown;
  readonly runId?: unknown;
  readonly pairingRouteId?: unknown;
  readonly delegationRouteId?: unknown;
  readonly findingId?: unknown;
  readonly bundlePath?: unknown;
  readonly mediaProviderId?: unknown;
  readonly sessionId?: unknown;
  readonly session_id?: unknown;
  readonly categoryId?: unknown;
  readonly panelId?: unknown;
  readonly actionId?: unknown;
  readonly recordId?: unknown;
  readonly fields?: unknown;
  readonly combo?: unknown;
  readonly combos?: unknown;
  readonly surfaceId?: unknown;
  readonly key?: unknown;
  readonly value?: unknown;
  readonly cwd?: unknown;
  readonly timeoutMs?: unknown;
  readonly pty?: unknown;
  readonly data?: unknown;
  readonly target?: unknown;
  readonly artifactId?: unknown;
  readonly itemId?: unknown;
  readonly methodId?: unknown;
  readonly endpointId?: unknown;
  readonly capabilityId?: unknown;
  readonly toolName?: unknown;
  readonly agentId?: unknown;
  readonly category?: unknown;
  readonly prefix?: unknown;
  readonly includeHidden?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
  readonly pane?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

interface AgentHarnessToolDeps {
  readonly commandRegistry: CommandRegistry;
  readonly commandContext: CommandContext;
  readonly toolRegistry: ToolRegistry;
}

function isMode(value: unknown): value is AgentHarnessMode {
  return typeof value === 'string' && AGENT_HARNESS_MODES.includes(value as AgentHarnessMode);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function settingLookupArgs(args: AgentHarnessToolArgs) {
  return {
    key: readString(args.key) || undefined,
    target: readString(args.target) || undefined,
    query: readString(args.query) || undefined,
    category: readString(args.category) || undefined,
    prefix: readString(args.prefix) || undefined,
    includeHidden: args.includeHidden === true,
  };
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function readFieldMap(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry === 'string' ? entry : String(entry)]));
}

function output(value: unknown): { readonly success: true; readonly output: string } {
  return {
    success: true,
    output: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  };
}

function error(message: string): { readonly success: false; readonly error: string } { return { success: false, error: message }; }

function harnessModeIdsByKind(kind: AgentHarnessModeGuideKind): readonly AgentHarnessMode[] {
  return HARNESS_MODE_DESCRIPTORS
    .filter((descriptor) => descriptor.kind === kind)
    .map((descriptor) => descriptor.id);
}

type AgentHarnessModeGuideKind = typeof HARNESS_MODE_DESCRIPTORS[number]['kind'];

function compactHarnessModeGuide(): Record<string, unknown> {
  return {
    start: ['summary', 'modes', 'mode'],
    discover: harnessModeIdsByKind('discover'),
    inspect: harnessModeIdsByKind('inspect'),
    effects: harnessModeIdsByKind('effect'),
    aliases: harnessModeIdsByKind('alias'),
    pattern: 'Use query|target for search, exact ids for inspect modes, and confirm:true plus explicitUserRequest for effects.',
  };
}

function detailedHarnessModelAccessGuide(): Record<string, string> {
  return {
    cliCommands: 'Prefer workspace action:"cli_commands|cli_command" for CLI discovery. Lower-level cli command modes remain available.',
    panels: 'Prefer workspace action:"panels|panel|open_panel"; visible navigation needs confirm:true and explicitUserRequest.',
    uiSurfaces: 'Prefer workspace action:"surfaces|surface|open" for visible UI and computer action:"browser|open_browser" for browser/PWA. Lower-level UI modes remain available.',
    shortcuts: 'Prefer workspace action:"shortcuts|keybindings|keybinding|run_keybinding|set_keybinding|reset_keybinding"; effects need confirmation.',
    slashCommands: 'Prefer workspace action:"commands|command|run_command"; slash-command execution needs confirmation.',
    channels: 'Prefer channels action:"status|channel|setup|triage|deliveries"; deliver with agent_channel_send and confirmation. Lower-level channel harness modes remain available for detail.',
    notifications: 'List mode:"notifications"; inspect mode:"notification_target"; deliver with agent_notify and confirmation.',
    providerAccounts: 'Prefer models action:"providers|provider" for account and subscription posture. Lower-level mode:"provider_accounts" and mode:"provider_account" remain available; auth changes stay confirmed workspace/command flows.',
    mcpServers: 'List mode:"mcp_servers"; inspect mode:"mcp_server"; trust/server changes stay confirmed workspace/command flows.',
    setupPosture: 'Prefer setup action:"status|item|checkpoint|token|smoke|finish"; lower-level setup_* modes remain available for detailed harness inspection.',
    projectContext: 'Prefer context action:"files|file"; lower-level project_context modes remain available for detail. Context files are read-only and secret-scanned.',
    promptContext: 'Prefer context action:"prompt|receipts|receipt" for prompt composition, selected/suppressed records, token budget, and prompt receipt outcomes.',
    agentOrchestration: 'List mode:"agent_orchestration" for managed plan and closeout cards; dispatch approved plan items with agent_work_plan action:"dispatch_agents"; inspect mode:"agent_orchestration_agent"; spawn/message/wait/cancel stay on first-class agent.',
    modelRouting: 'Prefer models action:"status|local|route|smoke" for model choice, local cookbook, route inspection, and confirmed local server checks. Lower-level mode:"model_routing", mode:"model_route", and mode:"run_local_model_smoke" remain available; changes stay visible.',
    executionPosture: 'Prefer execution action:"status|route"; use local read/edit/exec when current workspace is sufficient, delegation for isolation/parallel/remote.',
    backgroundProcesses: 'Use execution action:"processes|process" to inspect tracked local commands, terminal background:true to start visible tracked commands, and process action:list|poll|log|wait|kill|write to manage them. Lower-level background_* modes remain for compatibility. process action:"capabilities" probes SDK/daemon interactive contracts; write dispatches only when a safe ProcessManager stdin method exists and is explicitly confirmed; PTY/sudo stay typed-contract or foreground-only boundaries.',
    executionHistory: 'Prefer execution action:"history|record" for activity cards and records; use returned verification, supervision, and recovery routes.',
    fileRecovery: 'Prefer execution action:"recovery"; apply local file undo/redo snapshots with mode:"run_file_recovery" and confirmation.',
    personalOps: 'Prefer personal_ops action:"briefing|status|queue|intake|lane|read"; lower-level modes personal_ops_briefing/personal_ops/personal_ops_queue/personal_ops_intake/personal_ops_lane/run_personal_ops_read remain available for harness inspection.',
    memoryPosture: 'Prefer memory action:"status|provider|curator|candidate|list|search|get"; memory writes, vector rebuilds, and embedding-provider changes stay on confirmed existing routes.',
    autonomyQueue: 'Prefer autonomy action:"intake|queue|item" for ongoing work and visible autonomous work; lower-level autonomy_* modes remain available for detail. Effects stay confirmed on the owning route.',
    learningCurator: 'Prefer memory action:"curator|candidate"; writes stay on reviewed Agent-local routes.',
    researchWorkflow: 'Prefer research action:"briefing" for the current next-action queue, action:"plan" for deep-research route planning, action:"search" for bounded public source candidates, and action:"runner" for browser-runner readiness; lower-level mode:"research_workflow" sequences visible run, web/fetch or browser posture, source queue, report, and Knowledge promotion routes.',
    researchRuns: 'Prefer research action:"runs|run"; lower-level mode:"research_runs" and mode:"research_run" inspect run posture; checkpoint/cancel/complete stays confirmed.',
    researchQueue: 'Prefer research action:"sources|source|bundle|reports|report_artifact"; lower-level research modes inspect source posture; capture/review/report/ingest stay confirmed.',
    documentOps: 'List mode:"document_ops"; inspect mode:"document_ops_lane"; browse saved artifacts with agent_artifacts; use returned routes for documents, review packet wizard, reviewer readiness, uploads, exports, source checks, artifacts, and blind compare.',
    pairingPosture: 'Prefer device action:"status|capability" for device maps. Lower-level mode:"pairing_posture" and mode:"pairing_route" remain available; raw token/QR and pairing effects stay visible user flows.',
    delegationPosture: 'Prefer delegation action:"status|routes|route"; delegated submission stays confirmed visible flow.',
    securityPosture: 'List mode:"security_posture"; inspect mode:"security_finding"; mutate only through confirmed security routes.',
    supportBundles: 'List mode:"support_bundles"; inspect mode:"support_bundle"; export/import stays confirmation-gated.',
    mediaPosture: 'Prefer device action:"voice|provider" for voice/media posture. Lower-level mode:"media_posture" and mode:"media_provider" remain available; generate with agent_media_generate and confirmation.',
    sessions: 'List mode:"sessions"; inspect mode:"session"; save/resume/export/delete stays visible confirmed flow.',
    workspace: 'Prefer workspace action:"status|actions|action|run|surfaces|surface|open|commands|command|run_command"; includeParameters:true inlines editor schemas.',
    settings: 'Prefer settings action:"list|get|set|reset|import"; list accepts category|prefix|query|includeHidden:true; lower-level settings modes remain for compatibility.',
    tools: 'List mode:"tools" with query|limit|includeParameters:true; inspect mode:"tool" with toolName|target|query.',
    modeCatalog: 'Search mode:"modes" with query|target; inspect one contract with mode:"mode" target:"...".',
    releaseEvidence: 'Operator/audit: list mode:"release_evidence"; inspect mode:"release_evidence_artifact"; includeParameters:true inlines artifact detail.',
    releaseReadiness: 'Operator/audit: list mode:"release_readiness"; inspect mode:"release_readiness_item"; includeParameters:true inlines item detail.',
    operatorMethods: 'Prefer host action:"methods|method"; lower-level mode:"operator_methods|operator_method" remains for detail. Run exact daemon methods with agent_operator_method; write/admin routes require confirmation.',
    servicePosture: 'Prefer host action:"services|service"; lower-level mode:"service_posture|service_endpoint" remains for probes and redacted log tail.',
    connectedHost: 'Prefer host action:"capabilities|capability"; lower-level mode:"connected_host|connected_host_capability" remains for route-family detail.',
    connectedHostStatus: 'Prefer host action:"status" for host reachability, token posture, and Knowledge readiness.',
    daemon: 'Daemon aliases route to host action:"capabilities|status"; use agent_operator_method for exact confirmed contract calls.',
  };
}

function requireConfirmedAction(args: AgentHarnessToolArgs, action: string): string | null {
  const explicitUserRequest = readString(args.explicitUserRequest);
  if (!explicitUserRequest) return `${action} requires explicitUserRequest with the user's exact request or a short faithful summary.`;
  if (args.confirm !== true) return `${action} requires confirm:true after an explicit user request.`;
  return null;
}

function invocationArgsFromLookup(lookup: CommandDetailLookup): readonly string[] {
  return lookup.resolvedBy === 'description' ? [] : lookup.parsedArgs;
}

function safeCommandDisplay(name: string): string {
  return `/${name}`;
}

async function runCommand(deps: AgentHarnessToolDeps, args: AgentHarnessToolArgs): Promise<{ readonly success: boolean; readonly output?: string; readonly error?: string }> {
  const confirmationError = requireConfirmedAction(args, 'Slash command invocation');
  if (confirmationError) return error(confirmationError);
  const resolved = resolveHarnessCommandDetail(deps.commandRegistry, args);
  if (resolved?.status === 'ambiguous') {
    return error(`Ambiguous slash command ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
  }
  if (!resolved) return error('run_command requires a valid command, commandName, target, or query. Use mode:"commands" to inspect available commands.');

  const printed: string[] = [];
  const toolContext: CommandContext = {
    ...deps.commandContext,
    print: (text: string) => {
      printed.push(text);
    },
    renderRequest: () => {},
    executeCommand: async (name: string, commandArgs: string[]) => {
      return deps.commandRegistry.execute(name, commandArgs, toolContext);
    },
  };
  const commandArgs = invocationArgsFromLookup(resolved.lookup);
  const handled = await deps.commandRegistry.execute(resolved.command.name, [...commandArgs], toolContext);
  if (!handled) return error(`Unknown slash command /${resolved.command.name}.`);
  return output([
    `Command ${safeCommandDisplay(resolved.command.name)} completed.`,
    `Resolved by ${resolved.lookup.source} ${resolved.lookup.resolvedBy}.`,
    printed.length > 0 ? printed.join('\n') : '(no text output)',
  ].join('\n'));
}

function fieldReader(editor: AgentWorkspaceLocalEditor, fields: Readonly<Record<string, string>>): (fieldId: string) => string {
  return (fieldId: string) => fields[fieldId] ?? editor.fields.find((field) => field.id === fieldId)?.value ?? '';
}

function missingRequiredEditorFields(editor: AgentWorkspaceLocalEditor, fields: Readonly<Record<string, string>>): readonly string[] {
  const readField = fieldReader(editor, fields);
  return editor.fields
    .filter((field) => field.required && !readField(field.id).trim())
    .map((field) => field.id);
}

async function runWorkspaceEditorAction(
  deps: AgentHarnessToolDeps,
  action: AgentWorkspaceAction,
  editor: AgentWorkspaceLocalEditor,
  args: AgentHarnessToolArgs,
): Promise<{ readonly success: boolean; readonly output?: string; readonly error?: string }> {
  const fields = readFieldMap(args.fields);
  const missing = missingRequiredEditorFields(editor, fields);
  if (missing.length > 0) {
    return output({
      status: 'missing_required_fields',
      missing,
      action: action.id,
      editor: describeWorkspaceEditor(editor),
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'learned-behavior') {
    const confirmationError = requireConfirmedAction(args, 'Workspace learned-behavior capture');
    if (confirmationError) return error(confirmationError);
    const shellPaths = deps.commandContext.workspace.shellPaths;
    if (!shellPaths) return error('Agent shell paths are unavailable.');
    const readField = fieldReader(editor, fields);
    const target = readField('target').trim().toLowerCase();
    if (target !== 'skill' && target !== 'routine' && target !== 'persona') {
      return error('learned-behavior target must be skill, routine, or persona.');
    }
    const created = createAgentWorkspaceLearnedBehavior(shellPaths, {
      target,
      name: readField('name'),
      description: readField('description'),
      notes: readField('notes'),
      tags: splitList(readField('tags')),
      triggers: splitList(readField('triggers')),
      enable: isAffirmative(readField('enable')),
    });
    return output({
      status: 'created',
      kind: created.kind,
      id: created.id,
      name: created.name,
      policy: 'Agent-local behavior only; no connected-host mutation, default knowledge write, or delegated job was created.',
    });
  }

  if (editor.kind === 'profile') {
    const readField = fieldReader(editor, fields);
    const name = readField('name');
    const template = readField('template');
    const parts = ['/agent-profile', 'create', name];
    if (template.trim() && template.trim().toLowerCase() !== 'none') parts.push('--template', template);
    parts.push('--yes');
    return runCommand(deps, {
      ...args,
      command: parts.map((part, index) => index < 2 || part.startsWith('--') ? part : JSON.stringify(part)).join(' '),
    });
  }

  if (editor.kind === 'artifact-browser') {
    const artifactsToolArgs = buildAgentArtifactBrowserToolArgs(fieldReader(editor, fields));
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-artifact-browser',
      'agent_artifacts',
      artifactsToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_artifacts',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'artifact-show') {
    const artifactToolArgs = buildAgentArtifactShowToolArgs(fieldReader(editor, fields));
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-artifact-show',
      'agent_artifacts',
      artifactToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_artifacts',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'artifact-export-file') {
    const confirmationError = requireConfirmedAction(args, 'Workspace artifact export');
    if (confirmationError) return error(confirmationError);
    const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before exporting the artifact to a workspace file.',
      });
    }
    const artifactToolArgs = buildAgentArtifactExportToolArgs(
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Export a reviewed saved Agent artifact to a workspace file.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-artifact-export',
      'agent_artifacts',
      artifactToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_artifacts',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'artifact-export-package') {
    const confirmationError = requireConfirmedAction(args, 'Workspace artifact package export');
    if (confirmationError) return error(confirmationError);
    const readField = fieldReader(editor, fields);
    const formConfirmation = readField('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before exporting the selected artifacts to a package output.',
      });
    }
    const packageFormat = readField('packageFormat').trim().toLowerCase();
    const defaultRequest = packageFormat === 'zip' || packageFormat === 'archive'
      ? 'Export reviewed saved Agent artifacts to a workspace ZIP archive.'
      : 'Export reviewed saved Agent artifacts to a workspace package directory.';
    const artifactToolArgs = buildAgentArtifactPackageToolArgs(
      readField,
      readString(args.explicitUserRequest) || defaultRequest,
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-artifact-package-export',
      'agent_artifacts',
      artifactToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_artifacts',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'artifact-promote-knowledge') {
    const confirmationError = requireConfirmedAction(args, 'Workspace artifact Knowledge promotion');
    if (confirmationError) return error(confirmationError);
    const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before ingesting the artifact into Agent Knowledge.',
      });
    }
    const ingestToolArgs = buildAgentArtifactPromoteKnowledgeToolArgs(
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Promote a reviewed saved Agent artifact into isolated Agent Knowledge.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-artifact-promote-knowledge',
      'agent_knowledge_ingest',
      ingestToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_knowledge_ingest',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'research-report') {
    const confirmationError = requireConfirmedAction(args, 'Workspace research report artifact save');
    if (confirmationError) return error(confirmationError);
    const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before saving the sourced research report artifact.',
      });
    }
    const researchToolArgs = buildAgentResearchReportToolArgs(
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Save a reviewed source-grounded research report as an Agent artifact.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-research-report',
      'agent_research_report',
      researchToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_research_report',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'research-run') {
    const confirmationError = requireConfirmedAction(args, 'Workspace research run creation');
    if (confirmationError) return error(confirmationError);
    const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before creating the visible local research run.',
      });
    }
    const runToolArgs = buildAgentResearchRunToolArgs(
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Create one visible checkpointable local research run.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-research-run',
      'agent_research_runs',
      runToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_research_runs',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'research-source') {
    const confirmationError = requireConfirmedAction(args, 'Workspace research source queue add');
    if (confirmationError) return error(confirmationError);
    const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before adding the source to the local research queue.',
      });
    }
    const sourceToolArgs = buildAgentResearchSourceToolArgs(
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Add one source to the project-local research queue.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-research-source',
      'agent_research_sources',
      sourceToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_research_sources',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (
    editor.kind === 'document-browse'
    || editor.kind === 'document-show'
    || editor.kind === 'document-create'
    || editor.kind === 'document-update'
    || editor.kind === 'document-review'
    || editor.kind === 'document-comment'
    || editor.kind === 'document-resolve-comment'
    || editor.kind === 'document-suggest'
    || editor.kind === 'document-accept-suggestion'
    || editor.kind === 'document-reject-suggestion'
    || editor.kind === 'document-insert-artifact'
    || editor.kind === 'document-attach-artifact'
    || editor.kind === 'document-export'
  ) {
    const isMutation = editor.kind !== 'document-browse' && editor.kind !== 'document-show';
    if (isMutation) {
      const confirmationError = requireConfirmedAction(args, 'Workspace Agent document action');
      if (confirmationError) return error(confirmationError);
      const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
      if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
        return output({
          status: 'not_confirmed',
          action: action.id,
          editor: describeWorkspaceEditor(editor),
          modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
          note: 'Type yes in the editor confirmation field before changing Agent document drafts.',
        });
      }
    }
    const documentToolArgs = buildAgentDocumentToolArgs(
      editor,
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Run the Agent document workspace action.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-document',
      'agent_documents',
      documentToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_documents',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'document-reviewer-readiness') {
    const readinessArgs = buildAgentDocumentReviewerReadinessToolArgs(fieldReader(editor, fields));
    const resolved = describeDocumentOpsLane(deps.commandContext, readinessArgs);
    if (resolved.status !== 'found') {
      return error(resolved.status === 'ambiguous'
        ? `Ambiguous Document Ops lane reviewer_readiness. Candidates: ${JSON.stringify(resolved.candidates)}`
        : resolved.usage);
    }
    return output({
      status: 'executed_harness_lane',
      action: action.id,
      tool: 'agent_harness',
      output: resolved.lane,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }
  if (editor.kind === 'document-review-packet-wizard') {
    const wizardArgs = buildAgentDocumentReviewPacketWizardToolArgs(fieldReader(editor, fields));
    const resolved = describeDocumentOpsLane(deps.commandContext, wizardArgs);
    if (resolved.status !== 'found') {
      return error(resolved.status === 'ambiguous'
        ? `Ambiguous Document Ops lane review_packet_wizard. Candidates: ${JSON.stringify(resolved.candidates)}`
        : resolved.usage);
    }
    return output({
      status: 'executed_harness_lane',
      action: action.id,
      tool: 'agent_harness',
      output: resolved.lane,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }
  if (editor.kind === 'document-review-packet-preset') {
    const confirmationError = requireConfirmedAction(args, 'Workspace review packet preset save');
    if (confirmationError) return error(confirmationError);
    const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before saving a review packet preset artifact.',
      });
    }
    const presetArgs = buildAgentDocumentReviewPacketPresetToolArgs(
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Save the current Document Ops review packet preset from an Agent workspace action.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-review-packet-preset',
      'agent_review_packet_presets',
      presetArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_review_packet_presets',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }
  if (editor.kind === 'document-review-packet-preset-refresh') {
    const confirmationError = requireConfirmedAction(args, 'Workspace review packet preset refresh');
    if (confirmationError) return error(confirmationError);
    const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before refreshing a review packet preset artifact.',
      });
    }
    const presetArgs = buildAgentDocumentReviewPacketPresetRefreshToolArgs(
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Refresh the Document Ops review packet preset from an Agent workspace action.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-review-packet-preset-refresh',
      'agent_review_packet_presets',
      presetArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_review_packet_presets',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }
  if (editor.kind === 'document-review-packet-share') {
    const confirmationError = requireConfirmedAction(args, 'Workspace review packet share');
    if (confirmationError) return error(confirmationError);
    const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before sharing a review packet archive reference.',
      });
    }
    const shareArgs = buildAgentDocumentReviewPacketShareToolArgs(
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Share the Document Ops review packet archive from an Agent workspace action.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-review-packet-share',
      'agent_review_packet_share',
      shareArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_review_packet_share',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'model-compare' || editor.kind === 'local-model-benchmark') {
    const confirmationError = requireConfirmedAction(args, 'Workspace blind model comparison');
    if (confirmationError) return error(confirmationError);
    const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before spending model tokens.',
      });
    }
    const compareToolArgs = buildAgentModelCompareToolArgs(
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Run the blind model comparison from an Agent workspace action.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-model-compare',
      'agent_model_compare',
      compareToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_model_compare',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'model-compare-review') {
    const reviewToolArgs = buildAgentModelCompareReviewToolArgs(fieldReader(editor, fields));
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-model-compare-review',
      'agent_model_compare',
      reviewToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_model_compare',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'model-compare-handoff-diff') {
    const handoffDiffArgs = buildAgentModelCompareHandoffDiffToolArgs(fieldReader(editor, fields));
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-model-compare-handoff-diff',
      'agent_model_compare',
      handoffDiffArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_model_compare',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'model-compare-judge') {
    const confirmationError = requireConfirmedAction(args, 'Workspace comparison judgment');
    if (confirmationError) return error(confirmationError);
    const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before saving the judgment artifact.',
      });
    }
    const judgmentToolArgs = buildAgentModelCompareJudgmentToolArgs(
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Save the blind model comparison judgment from an Agent workspace action.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-model-compare-judge',
      'agent_model_compare',
      judgmentToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_model_compare',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'model-compare-apply') {
    const confirmationError = requireConfirmedAction(args, 'Workspace comparison route update');
    if (confirmationError) return error(confirmationError);
    const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before applying the winning model route.',
      });
    }
    const applyToolArgs = buildAgentModelCompareApplyToolArgs(
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Apply the revealed blind model comparison judgment from an Agent workspace action.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-model-compare-apply',
      'agent_model_compare',
      applyToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_model_compare',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'model-compare-route-decision') {
    const confirmationError = requireConfirmedAction(args, 'Workspace comparison route decision');
    if (confirmationError) return error(confirmationError);
    const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before saving the route-decision receipt.',
      });
    }
    const routeDecisionToolArgs = buildAgentModelCompareRouteDecisionToolArgs(
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Record a leave-unchanged blind model comparison route decision from an Agent workspace action.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-model-compare-route-decision',
      'agent_model_compare',
      routeDecisionToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_model_compare',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'model-compare-export') {
    const confirmationError = requireConfirmedAction(args, 'Workspace comparison export');
    if (confirmationError) return error(confirmationError);
    const formConfirmation = fieldReader(editor, fields)('confirm').trim().toLowerCase();
    if (formConfirmation !== 'yes' && formConfirmation !== 'true') {
      return output({
        status: 'not_confirmed',
        action: action.id,
        editor: describeWorkspaceEditor(editor),
        modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
        note: 'Type yes in the editor confirmation field before creating the markdown report artifact.',
      });
    }
    const exportToolArgs = buildAgentModelCompareExportToolArgs(
      fieldReader(editor, fields),
      readString(args.explicitUserRequest) || 'Export the saved blind model comparison artifact from an Agent workspace action.',
    );
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-model-compare-export',
      'agent_model_compare',
      exportToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_model_compare',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (editor.kind === 'model-compare-analytics') {
    const analyticsToolArgs = buildAgentModelCompareAnalyticsToolArgs(fieldReader(editor, fields));
    const result = await deps.toolRegistry.execute(
      'agent-harness-workspace-model-compare-analytics',
      'agent_model_compare',
      analyticsToolArgs as unknown as Record<string, unknown>,
    );
    return output({
      status: result.success ? 'executed_model_tool' : 'model_tool_failed',
      action: action.id,
      tool: 'agent_model_compare',
      output: result.output ?? null,
      error: result.error ?? null,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  if (!isAgentWorkspaceCommandEditorKind(editor.kind)) {
    if (
      editor.kind === 'memory'
      || editor.kind === 'note'
      || editor.kind === 'persona'
      || editor.kind === 'skill'
      || editor.kind === 'routine'
    ) {
      return runLocalWorkspaceEditorAction(deps, editor, args);
    }
    return output({
      status: 'model_tool_required',
      action: action.id,
      editor: describeWorkspaceEditor(editor),
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
    });
  }

  const submission = buildAgentWorkspaceCommandEditorSubmission(
    editor,
    fieldReader(editor, fields),
    true,
    true,
  );
  if (submission.kind === 'editor') {
    return output({
      status: submission.status,
      action: action.id,
      editor: describeWorkspaceEditor(submission.editor),
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
      actionResult: submission.actionResult ?? null,
    });
  }
  if (submission.kind === 'prompt') {
    return output({
      status: submission.status,
      action: action.id,
      prompt: submission.prompt,
      actionResult: submission.actionResult,
      modelExecution: describeWorkspaceEditorModelExecution(editor.kind),
      note: 'This workspace action submits a normal main-conversation prompt in the TUI. In model-tool context, use the returned prompt as the conversation task instead of creating a hidden nested turn.',
    });
  }
  return runCommand(deps, {
    ...args,
    command: submission.command,
  });
}

async function runWorkspaceAction(
  deps: AgentHarnessToolDeps,
  args: AgentHarnessToolArgs,
): Promise<{ readonly success: boolean; readonly output?: string; readonly error?: string }> {
  const resolved = resolveWorkspaceActionDetail(args);
  if (resolved?.status === 'ambiguous') return error(`Ambiguous Agent workspace action ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
  if (!resolved) return error('run_workspace_action requires a valid actionId, command, target, or query. Use mode:"workspace_actions" to inspect available actions.');
  const { category, action, lookup } = resolved;

  if (action.safety === 'blocked') {
    return error(`Workspace action ${action.id} is blocked in Agent: ${action.detail}`);
  }
  if (action.kind === 'guidance') {
    const editorContext = buildWorkspaceEditorContext(deps.commandContext, args);
    return output({
      status: 'guidance',
      action: describeWorkspaceAction(category, action, { includeEditor: true, editorContext, lookup }),
    });
  }
  if (action.kind === 'workspace' && action.targetCategoryId) {
    const target = AGENT_WORKSPACE_CATEGORIES.find((entry) => entry.id === action.targetCategoryId);
    return output({
      status: 'workspace_target',
      action: describeWorkspaceAction(category, action, { lookup }),
      targetCategory: target ? describeWorkspaceCategory(target) : action.targetCategoryId,
      targetActions: target ? target.actions.map((entry) => describeWorkspaceAction(target, entry)).slice(0, 40) : [],
    });
  }
  if (action.kind === 'command' && action.command) {
    if (/<[^>\s]+(?:\s+[^>]*)?>/.test(action.command)) {
      return output({
        status: 'needs_concrete_command',
        action: describeWorkspaceAction(category, action, { lookup }),
        note: 'This workspace action is a command template. Provide concrete values with mode:"run_command" once the exact command is known.',
      });
    }
    return runCommand(deps, { ...args, command: action.command });
  }
  if (action.kind === 'settings-import') {
    const preview = previewAgentWorkspaceTuiSettingsImport(deps.commandContext);
    if (!preview) return error('GoodVibes settings import is unavailable in this runtime.');
    if (args.confirm !== true) {
      return output({
        status: 'confirmation_required',
        action: describeWorkspaceAction(category, action, { lookup }),
        preview,
        next: 'Run with confirm:true and explicitUserRequest after the user asks to import these settings.',
      });
    }
    const explicitUserRequest = readString(args.explicitUserRequest);
    if (!explicitUserRequest) {
      return error('GoodVibes settings import requires explicitUserRequest when confirm is true.');
    }
    const outcome = await importAgentWorkspaceTuiSettings(deps.commandContext);
    return output({
      status: outcome.status,
      action: describeWorkspaceAction(category, action, { lookup }),
      preview,
      actionResult: outcome.result,
      runtimeSnapshot: outcome.runtimeSnapshot,
      policy: {
        effect: 'state',
        confirmation: 'confirmed',
        explicitUserRequest,
        boundary: 'Applied only Agent-owned settings and subscription state from GoodVibes TUI sources.',
      },
    });
  }
  if (action.kind === 'setup-checkpoint') {
    const operation = action.setupCheckpointOperation ?? 'show';
    if (operation === 'show') {
      return output({
        status: 'checkpoint_inspected',
        action: describeWorkspaceAction(category, action, { lookup }),
        checkpoint: await setupCheckpointSummary(deps.commandContext),
      });
    }
    const confirmationError = requireConfirmedAction(args, operation === 'clear' ? 'Setup wizard checkpoint clear' : 'Setup wizard checkpoint save');
    if (confirmationError) return error(confirmationError);
    const result = operation === 'clear'
      ? clearSetupCheckpoint(deps.commandContext, args)
      : await markSetupCheckpoint(deps.commandContext, args);
    return output({
      status: 'checkpoint_action_completed',
      action: describeWorkspaceAction(category, action, { lookup }),
      result,
    });
  }
  if (action.kind === 'editor' && action.editorKind) {
    const editor = createWorkspaceEditor(action.editorKind, buildWorkspaceEditorContext(deps.commandContext, args));
    if (!editor) return error(`No workspace editor route exists for ${action.editorKind}.`);
    return runWorkspaceEditorAction(deps, action, editor, args);
  }
  if (action.kind === 'local-selection' || action.kind === 'local-operation') {
    return runLocalWorkspaceAction(deps, action, args);
  }
  if (action.kind === 'onboarding-complete') {
    const confirmationError = requireConfirmedAction(args, 'Onboarding completion');
    if (confirmationError) return error(confirmationError);
    const explicitUserRequest = readString(args.explicitUserRequest);
    if (!explicitUserRequest) return error('Onboarding completion requires explicitUserRequest when confirm is true.');
    const shellPaths = deps.commandContext.workspace?.shellPaths;
    if (!shellPaths) return error('Onboarding completion requires Agent shell paths.');
    const marker = { scope: 'user', source: 'wizard', mode: 'new', workspaceRoot: shellPaths.workingDirectory } as const;
    const checkMarker = writeOnboardingCheckMarker(shellPaths, marker);
    const completionMarker = writeOnboardingCompletionMarker(shellPaths, marker);
    return output({
      status: 'onboarding_completed',
      action: describeWorkspaceAction(category, action, { lookup }),
      explicitUserRequest,
      checkMarker: {
        exists: checkMarker.exists,
        path: checkMarker.path,
        updatedAt: checkMarker.payload?.updatedAt ?? null,
        source: checkMarker.payload?.source ?? null,
        mode: checkMarker.payload?.mode ?? null,
      },
      completionMarker: {
        exists: completionMarker.exists,
        path: completionMarker.path,
        updatedAt: completionMarker.payload?.updatedAt ?? null,
        source: completionMarker.payload?.source ?? null,
        mode: completionMarker.payload?.mode ?? null,
      },
      routes: {
        inspectSetup: 'setup action:"status" includeParameters:true',
      },
      policy: {
        effect: 'confirmed-onboarding-marker-write',
        boundary: 'Writes only the user onboarding check and completion markers. It does not mutate provider credentials, connected-host state, channels, schedules, or local behavior.',
      },
    });
  }
  const editorContext = buildWorkspaceEditorContext(deps.commandContext, args);
  return output({
    status: 'no_direct_effect',
    action: describeWorkspaceAction(category, action, { includeEditor: true, editorContext, lookup }),
  });
}

export function createAgentHarnessTool(deps: AgentHarnessToolDeps): Tool {
  return {
    definition: {
      name: 'agent_harness',
      description: 'Inspect or operate GoodVibes Agent harness surfaces.',
      parameters: {
        type: 'object',
        properties: AGENT_HARNESS_PARAMETER_PROPERTIES,
        required: ['mode'],
        additionalProperties: false,
      },
      sideEffects: ['state'],
      concurrency: 'serial',
    },
    execute: async (rawArgs) => {
      const args = rawArgs as AgentHarnessToolArgs;
      if (!isMode(args.mode)) return error(`Unknown agent_harness mode: ${String(args.mode)}`);
      try {
        if (args.mode === 'summary') {
          const channelReadiness = channelReadinessCatalogStatus(deps.commandContext);
          const notificationTargets = notificationTargetCatalogStatus(deps.commandContext);
          const providerAccounts = await providerAccountCatalogStatus(deps.commandContext).catch((err) => ({
            modes: ['provider_accounts', 'provider_account'],
            status: 'unavailable',
            error: formatHarnessError(err),
          }));
          const mcpServers = mcpServerCatalogStatus(deps.commandContext);
          const setupPosture = await setupPostureCatalogStatus(deps.commandContext).catch((err) => ({
            modes: ['setup_posture', 'setup_item', 'setup_checkpoint', 'mark_setup_checkpoint', 'clear_setup_checkpoint', 'provision_connected_host_token', 'run_setup_smoke'],
            status: 'unavailable',
            error: formatHarnessError(err),
          }));
          const projectContext = projectContextCatalogStatus(deps.commandContext);
          const promptContext = promptContextCatalogStatus(deps.commandContext);
          const agentOrchestration = agentOrchestrationCatalogStatus(deps.commandContext, deps.toolRegistry);
          const modelRouting = await modelRoutingCatalogStatus(deps.commandContext).catch((err) => ({
            modes: ['model_routing', 'model_route'],
            status: 'unavailable',
            error: formatHarnessError(err),
          }));
          const executionPosture = executionPostureCatalogStatus(deps.commandContext, deps.toolRegistry);
          const backgroundProcesses = backgroundProcessCatalogStatus(deps.commandContext);
          const executionHistory = executionHistoryCatalogStatus(deps.commandContext);
          const fileRecovery = fileRecoveryCatalogStatus(deps.commandContext);
          const personalOps = personalOpsCatalogStatus(deps.commandContext);
          const memoryPosture = await memoryPostureCatalogStatus(deps.commandContext).catch((err) => ({
            modes: ['memory_posture', 'memory_provider'],
            status: 'unavailable',
            error: formatHarnessError(err),
          }));
          const autonomyQueue = autonomyQueueCatalogStatus(deps.commandContext);
          const learningCurator = learningCuratorCatalogStatus(deps.commandContext);
          const researchBriefing = researchBriefingCatalogStatus(deps.commandContext);
          const researchRuns = researchRunsCatalogStatus(deps.commandContext);
          const researchQueue = researchQueueCatalogStatus(deps.commandContext);
          const documentOps = documentOpsCatalogStatus(deps.commandContext);
          const pairingPosture = pairingPostureCatalogStatus(deps.commandContext);
          const delegationPosture = delegationPostureCatalogStatus(deps.commandContext);
          const securityPosture = securityPostureCatalogStatus(deps.commandContext);
          const supportBundles = supportBundleCatalogStatus();
          const mediaPosture = mediaPostureCatalogStatus(deps.commandContext);
          const sessions = sessionCatalogStatus(deps.commandContext);
          const releaseEvidence = releaseEvidenceBundleStatus();
          const releaseReadiness = releaseReadinessInventoryStatus();
          const operatorMethods = operatorMethodCatalogStatus();
          const servicePosture = servicePostureCatalogStatus();
          const connectedHost = connectedHostSummary(deps.commandContext, deps.toolRegistry, {
            includeParameters: args.includeParameters === true,
          });
          return output({
            assistant: buildAssistantCockpitFromSummaries({
              setupPosture,
              projectContext,
              agentOrchestration,
              modelRouting,
              executionPosture,
              backgroundProcesses,
              personalOps,
              autonomyQueue,
              researchRuns,
              documentOps,
              securityPosture,
            }),
            harnessModes: HARNESS_MODE_DESCRIPTORS.length,
            cliCommands: totalHarnessCliCommands(),
            blockedCliCommandTokens: blockedHarnessCliCommandTokens(),
            panels: totalHarnessPanels(deps.commandContext),
            uiSurfaces: totalHarnessUiSurfaces(),
            shortcuts: totalHarnessShortcuts(deps.commandContext),
            keybindings: totalHarnessKeybindings(deps.commandContext),
            commands: deps.commandRegistry.list().length,
            channelReadiness,
            notificationTargets,
            providerAccounts,
            mcpServers,
            setupPosture,
            projectContext,
            promptContext,
            agentOrchestration,
            modelRouting,
            executionPosture,
            backgroundProcesses,
            executionHistory,
            fileRecovery,
            personalOps,
            memoryPosture,
            autonomyQueue,
            learningCurator,
            researchBriefing,
            researchRuns,
            researchQueue,
            documentOps,
            pairingPosture,
            delegationPosture,
            securityPosture,
            supportBundles,
            mediaPosture,
            sessions,
            settings: deps.commandContext.platform.configManager.getSchema().length,
            workspaceCategories: AGENT_WORKSPACE_CATEGORIES.length,
            workspaceActions: allWorkspaceActions().length,
            tools: deps.toolRegistry.getToolDefinitions().length,
            releaseEvidence,
            releaseReadiness,
            operatorMethods,
            servicePosture,
            modeGuide: compactHarnessModeGuide(),
            ...(args.includeParameters === true ? { modelAccess: detailedHarnessModelAccessGuide() } : {}),
            settingsPolicy: settingsPolicySummary(),
            connectedHost,
          });
        }
        if (args.mode === 'modes') return output(listHarnessModes(args));
        if (args.mode === 'mode') {
          const mode = describeHarnessMode(args);
          if (mode.status === 'ambiguous') return error(`Ambiguous harness mode ${String(mode.input)}. Candidates: ${JSON.stringify(mode.candidates)}`);
          if (mode.status === 'missing_lookup') return error(String(mode.usage));
          return output(mode.mode);
        }
        if (args.mode === 'cli_commands') {
          const commands = listHarnessCliCommands(args);
          return output({
            commands,
            returned: commands.length,
            total: totalHarnessCliCommands(),
            blockedTokens: blockedHarnessCliCommandTokens(),
            policy: 'CLI modes are read-only discovery. Use first-class model tools, workspace actions, settings modes, or confirmed slash-command mirrors for in-process operation.',
          });
        }
        if (args.mode === 'cli_command') {
          return output(describeHarnessCliCommand(args));
        }
        if (args.mode === 'panels') {
          const panels = listHarnessPanels(deps.commandContext, args);
          return output({
            panels,
            returned: panels.length,
            total: totalHarnessPanels(deps.commandContext),
            policy: 'Panel modes expose Agent/TUI operator view catalog and open state. open_panel is confirmation-gated and routes through the current Agent operator surface.',
          });
        }
        if (args.mode === 'panel') {
          const panel = describeHarnessPanel(deps.commandContext, args);
          return panel ? output(panel) : error(`Unknown panel ${readString(args.panelId || args.target || args.query) || '<missing>'}.`);
        }
        if (args.mode === 'open_panel') {
          const confirmationError = requireConfirmedAction(args, 'Panel routing');
          if (confirmationError) return error(confirmationError);
          return output(openHarnessPanel(deps.commandContext, args));
        }
        if (args.mode === 'ui_surfaces') {
          const surfaces = listHarnessUiSurfaces(deps.commandContext, args);
          return output({ surfaces, returned: surfaces.length, total: totalHarnessUiSurfaces() });
        }
        if (args.mode === 'ui_surface') {
          const surface = describeHarnessUiSurface(deps.commandContext, args);
          return surface ? output(surface) : error(`Unknown UI surface ${readString(args.surfaceId || args.query || args.target) || '<missing>'}.`);
        }
        if (args.mode === 'open_ui_surface') {
          const confirmationError = requireConfirmedAction(args, 'UI surface routing');
          if (confirmationError) return error(confirmationError);
          return output(await openHarnessUiSurface(deps.commandContext, args));
        }
        if (args.mode === 'shortcuts') return output(listHarnessShortcuts(deps.commandContext, args));
        if (args.mode === 'keybindings') return output(listHarnessKeybindings(deps.commandContext, args));
        if (args.mode === 'keybinding') {
          const binding = describeHarnessKeybinding(deps.commandContext, args);
          return binding ? output(binding) : error(`Unknown keybinding action ${readString(args.actionId || args.target || args.key || args.query) || '<missing>'}.`);
        }
        if (args.mode === 'set_keybinding') {
          const confirmationError = requireConfirmedAction(args, 'Keybinding mutation');
          return confirmationError ? error(confirmationError) : output(setHarnessKeybinding(deps.commandContext, args));
        }
        if (args.mode === 'reset_keybinding') {
          const confirmationError = requireConfirmedAction(args, 'Keybinding reset');
          return confirmationError ? error(confirmationError) : output(resetHarnessKeybinding(deps.commandContext, args));
        }
        if (args.mode === 'run_keybinding') {
          const confirmationError = requireConfirmedAction(args, 'Keybinding action');
          return confirmationError ? error(confirmationError) : output(runHarnessKeybinding(deps.commandContext, args));
        }
        if (args.mode === 'commands') {
          const commands = listHarnessCommands(deps.commandRegistry, args);
          return output({ commands, returned: commands.length, total: deps.commandRegistry.list().length });
        }
        if (args.mode === 'command') {
          const detail = describeHarnessCommand(deps.commandRegistry, args);
          const query = readString(args.command || args.commandName || args.target || args.query);
          return detail
            ? output(detail)
            : error(`Unknown slash command ${query || '<missing>'}. Use mode:"commands" to inspect available commands.`);
        }
        if (args.mode === 'run_command') return runCommand(deps, args);
        if (args.mode === 'channels') return output(listHarnessChannels(deps.commandContext, args));
        if (args.mode === 'channel') {
          const resolved = describeHarnessChannel(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.channel);
          if (resolved.status === 'ambiguous') return error(`Ambiguous channel ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'channel_setup_guide') {
          const resolved = describeHarnessChannelSetupGuide(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.guide);
          if (resolved.status === 'ambiguous') return error(`Ambiguous channel setup guide target ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'channel_triage') return output(await describeHarnessChannelTriage(deps.commandContext, args));
        if (args.mode === 'channel_deliveries') return output(describeHarnessChannelDeliveries(deps.commandContext, args));
        if (args.mode === 'notifications') return output(listHarnessNotificationTargets(deps.commandContext, args));
        if (args.mode === 'notification_target') {
          const resolved = describeHarnessNotificationTarget(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.target);
          if (resolved.status === 'ambiguous') return error(`Ambiguous notification target ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'provider_accounts') return output(await providerAccountSummary(deps.commandContext, args));
        if (args.mode === 'provider_account') {
          const resolved = await describeHarnessProviderAccount(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.account);
          if (resolved.status === 'ambiguous') return error(`Ambiguous provider account ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'mcp_servers') return output(await mcpServerSummary(deps.commandContext, args));
        if (args.mode === 'mcp_server') {
          const resolved = await describeHarnessMcpServer(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.server);
          if (resolved.status === 'ambiguous') return error(`Ambiguous MCP server ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'setup_posture') return output(await setupPostureSummary(deps.commandContext, args));
        if (args.mode === 'setup_item') {
          const resolved = await describeHarnessSetupItem(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.item);
          if (resolved.status === 'ambiguous') return error(`Ambiguous setup item ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'setup_checkpoint') return output(await setupCheckpointSummary(deps.commandContext));
        if (args.mode === 'mark_setup_checkpoint') {
          const confirmationError = requireConfirmedAction(args, 'Setup wizard checkpoint save');
          if (confirmationError) return error(confirmationError);
          return output(await markSetupCheckpoint(deps.commandContext, args));
        }
        if (args.mode === 'clear_setup_checkpoint') {
          const confirmationError = requireConfirmedAction(args, 'Setup wizard checkpoint clear');
          if (confirmationError) return error(confirmationError);
          return output(clearSetupCheckpoint(deps.commandContext, args));
        }
        if (args.mode === 'project_context') return output(projectContextSummary(deps.commandContext, args));
        if (args.mode === 'project_context_file') {
          const resolved = describeProjectContextFile(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.file);
          if (resolved.status === 'ambiguous') return error(`Ambiguous project context file ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'prompt_context') return output(promptContextSummary(deps.commandContext, args));
        if (args.mode === 'agent_orchestration') return output(agentOrchestrationSummary(deps.commandContext, deps.toolRegistry, args));
        if (args.mode === 'agent_orchestration_agent') {
          const resolved = describeAgentOrchestrationAgent(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.agent);
          if (resolved.status === 'ambiguous') return error(`Ambiguous visible Agent ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'provision_connected_host_token') {
          const confirmationError = requireConfirmedAction(args, 'Connected-host token provisioning');
          if (confirmationError) return error(confirmationError);
          const setupItemId = readString(args.setupItemId);
          if (setupItemId && setupItemId !== 'connected-host-auth') {
            return error('provision_connected_host_token supports setupItemId:"connected-host-auth" only.');
          }
          return output(provisionConnectedHostOperatorToken(deps.commandContext, args));
        }
        if (args.mode === 'run_setup_smoke') {
          const confirmationError = requireConfirmedAction(args, 'Setup smoke');
          if (confirmationError) return error(confirmationError);
          const setupItemId = readString(args.setupItemId);
          if (setupItemId && setupItemId !== 'install-smoke') return error('run_setup_smoke currently supports setupItemId:"install-smoke" only.');
          return output(await runSetupInstallSmoke(deps.commandContext, args));
        }
        if (args.mode === 'model_routing') return output(await modelRoutingSummary(deps.commandContext, args));
        if (args.mode === 'model_route') {
          const resolved = await describeHarnessModelRoute(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.route);
          if (resolved.status === 'ambiguous') return error(`Ambiguous model route ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'run_local_model_smoke') {
          const confirmationError = requireConfirmedAction(args, 'Local model smoke');
          return confirmationError ? error(confirmationError) : output(await runLocalModelServerSmoke(deps.commandContext, args));
        }
        if (args.mode === 'execution_posture') return output(executionPostureSummary(deps.commandContext, deps.toolRegistry, args));
        if (args.mode === 'execution_route') {
          const resolved = describeHarnessExecutionRoute(deps.commandContext, deps.toolRegistry, args);
          if (resolved.status === 'found') return output(resolved.route);
          if (resolved.status === 'ambiguous') return error(`Ambiguous execution route ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'background_processes') return output(backgroundProcessSummary(deps.commandContext, args));
        if (args.mode === 'background_process') {
          const resolved = describeBackgroundProcess(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.process);
          if (resolved.status === 'ambiguous') return error(`Ambiguous background process ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'run_background_process') return output(await runBackgroundProcessAction(deps.commandContext, args));
        if (args.mode === 'execution_history') return output(executionHistorySummary(deps.commandContext, args));
        if (args.mode === 'execution_history_item') {
          const resolved = describeExecutionHistoryItem(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.record);
          if (resolved.status === 'ambiguous') return error(`Ambiguous execution history record ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'file_recovery') return output(fileRecoverySummary(deps.commandContext, args));
        if (args.mode === 'run_file_recovery') {
          const confirmationError = requireConfirmedAction(args, 'File recovery');
          return confirmationError ? error(confirmationError) : output(runFileRecovery(deps.commandContext, args));
        }
        if (args.mode === 'personal_ops_briefing') return output(await personalOpsBriefingSummary(deps.commandContext, args));
        if (args.mode === 'personal_ops') return output(await personalOpsSummary(deps.commandContext, args));
        if (args.mode === 'personal_ops_queue') return output(await personalOpsQueueSummary(deps.commandContext, args));
        if (args.mode === 'personal_ops_intake') return output(await personalOpsIntakeSummary(deps.commandContext, args));
        if (args.mode === 'personal_ops_lane') {
          const resolved = await describePersonalOpsLane(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.lane);
          if (resolved.status === 'ambiguous') return error(`Ambiguous Personal Ops lane ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'run_personal_ops_read') return output(await runPersonalOpsRead(deps.commandContext, args));
        if (args.mode === 'memory_posture') return output(await memoryPostureSummary(deps.commandContext, args));
        if (args.mode === 'memory_provider') {
          const resolved = await describeMemoryProvider(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.provider);
          if (resolved.status === 'ambiguous') return error(`Ambiguous memory provider ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'autonomy_intake') return output(autonomyIntakeSummary(deps.commandContext, args));
        if (args.mode === 'autonomy_queue') return output(autonomyQueueSummary(deps.commandContext, args));
        if (args.mode === 'autonomy_queue_item') {
          const resolved = describeAutonomyQueueItem(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.item);
          if (resolved.status === 'ambiguous') return error(`Ambiguous autonomy queue item ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'learning_curator') return output(learningCuratorSummary(deps.commandContext, args));
        if (args.mode === 'learning_candidate') {
          const resolved = describeLearningCandidate(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.candidate);
          if (resolved.status === 'ambiguous') return error(`Ambiguous learning candidate ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'research_briefing') return output(researchBriefingSummary(deps.commandContext, args));
        if (args.mode === 'research_workflow') return output(researchWorkflowSummary(deps.commandContext, args));
        if (args.mode === 'research_runs') return output(researchRunsSummary(deps.commandContext, args));
        if (args.mode === 'research_run') {
          const resolved = describeResearchRun(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.run);
          if (resolved.status === 'ambiguous') return error(`Ambiguous research run ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'research_queue') return output(researchQueueSummary(deps.commandContext, args));
        if (args.mode === 'research_source') {
          const resolved = describeResearchSource(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.source);
          if (resolved.status === 'ambiguous') return error(`Ambiguous research source ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'document_ops') return output(documentOpsSummary(deps.commandContext, args));
        if (args.mode === 'document_ops_lane') {
          const resolved = describeDocumentOpsLane(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.lane);
          if (resolved.status === 'ambiguous') return error(`Ambiguous Document Ops lane ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'pairing_posture') return output(pairingPostureSummary(deps.commandContext, args));
        if (args.mode === 'pairing_route') {
          const resolved = describeHarnessPairingRoute(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.route);
          if (resolved.status === 'ambiguous') return error(`Ambiguous pairing route ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'delegation_posture') return output(delegationPostureSummary(deps.commandContext, args));
        if (args.mode === 'delegation_route') {
          const resolved = describeHarnessDelegationRoute(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.route);
          if (resolved.status === 'ambiguous') return error(`Ambiguous delegation route ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'security_posture') return output(await securityPostureSummary(deps.commandContext, args));
        if (args.mode === 'security_finding') {
          const resolved = describeHarnessSecurityFinding(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.finding);
          if (resolved.status === 'ambiguous') return error(`Ambiguous security finding ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'support_bundles') return output(supportBundleSummary(args));
        if (args.mode === 'support_bundle') {
          const resolved = describeHarnessSupportBundle(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.bundle);
          return error(resolved.usage);
        }
        if (args.mode === 'media_posture') return output(await mediaPostureSummary(deps.commandContext, args));
        if (args.mode === 'media_provider') {
          const resolved = await describeHarnessMediaProvider(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.provider);
          if (resolved.status === 'ambiguous') return error(`Ambiguous media provider ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'sessions') return output(sessionSummary(deps.commandContext, args));
        if (args.mode === 'session') {
          const resolved = describeHarnessSession(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.session);
          if (resolved.status === 'ambiguous') return error(`Ambiguous session ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'settings') {
          const filters = {
            category: readString(args.category) || undefined,
            prefix: readString(args.prefix) || undefined,
            query: readString(args.query) || undefined,
            includeHidden: args.includeHidden === true,
            limit: readLimit(args.limit, 500),
          };
          const settings = listHarnessSettings(deps.commandContext.platform.configManager, {
            ...filters,
          }, {
            includeParameters: args.includeParameters === true,
          });
          const total = countHarnessSettings(deps.commandContext.platform.configManager, filters);
          return output({ settings, returned: settings.length, total, policy: settingsPolicySummary() });
        }
        if (args.mode === 'get_setting') {
          const setting = resolveHarnessSetting(deps.commandContext.platform.configManager, settingLookupArgs(args));
          if (setting?.status === 'found') return output(setting.setting);
          if (setting?.status === 'ambiguous') {
            return error(`Ambiguous setting ${setting.input}. Candidates: ${JSON.stringify(setting.candidates)}`);
          }
          return error(`Unknown setting ${readString(args.key || args.target || args.query) || '<missing>'}. Use mode:"settings" to inspect available settings.`);
        }
        if (args.mode === 'set_setting') {
          const confirmationError = requireConfirmedAction(args, 'Setting mutation');
          if (confirmationError) return error(confirmationError);
          if (args.value === undefined) return error('set_setting requires value.');
          const setting = resolveHarnessSetting(deps.commandContext.platform.configManager, settingLookupArgs(args));
          if (setting?.status === 'ambiguous') {
            return error(`Ambiguous setting ${setting.input}. Candidates: ${JSON.stringify(setting.candidates)}`);
          }
          if (setting?.status !== 'found') {
            return error(`Unknown setting ${readString(args.key || args.target || args.query) || '<missing>'}. Use mode:"settings" to inspect available settings.`);
          }
          const result = await setHarnessSetting(
            deps.commandContext.platform.configManager,
            deps.commandContext.platform.secretsManager,
            setting.setting.key,
            args.value,
          );
          return output({ ...result, lookup: setting.lookup });
        }
        if (args.mode === 'reset_setting') {
          const confirmationError = requireConfirmedAction(args, 'Setting reset');
          if (confirmationError) return error(confirmationError);
          const setting = resolveHarnessSetting(deps.commandContext.platform.configManager, settingLookupArgs(args));
          if (setting?.status === 'ambiguous') {
            return error(`Ambiguous setting ${setting.input}. Candidates: ${JSON.stringify(setting.candidates)}`);
          }
          if (setting?.status !== 'found') {
            return error(`Unknown setting ${readString(args.key || args.target || args.query) || '<missing>'}. Use mode:"settings" to inspect available settings.`);
          }
          const result = await resetHarnessSetting(
            deps.commandContext.platform.configManager,
            deps.commandContext.platform.secretsManager,
            setting.setting.key,
          );
          return output({ ...result, lookup: setting.lookup });
        }
        if (args.mode === 'workspace' || args.mode === 'workspace_categories') {
          return output({
            categories: AGENT_WORKSPACE_CATEGORIES.map(describeWorkspaceCategory),
            actions: allWorkspaceActions().length,
          });
        }
        if (args.mode === 'workspace_actions') {
          const actions = listWorkspaceActions(deps.commandContext, args);
          return output({ actions, returned: actions.length, total: allWorkspaceActions().length });
        }
        if (args.mode === 'workspace_action') {
          const resolved = resolveWorkspaceActionDetail(args);
          const editorContext = buildWorkspaceEditorContext(deps.commandContext, args);
          if (resolved?.status === 'found') {
            return output(describeWorkspaceAction(resolved.category, resolved.action, { includeEditor: true, editorContext, lookup: resolved.lookup }));
          }
          if (resolved?.status === 'ambiguous') {
            return error(`Ambiguous Agent workspace action ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          }
          return error(`Unknown Agent workspace action ${readString(args.actionId || args.command || args.target || args.query) || '<missing>'}. Use mode:"workspace_actions" to inspect available actions.`);
        }
        if (args.mode === 'run_workspace_action') return runWorkspaceAction(deps, args);
        if (args.mode === 'tools') {
          const tools = listHarnessModelTools(deps.toolRegistry, args);
          return output({ tools, returned: tools.length, total: deps.toolRegistry.getToolDefinitions().length });
        }
        if (args.mode === 'tool') {
          const query = readString(args.toolName || args.target || args.query);
          const resolved = describeHarnessModelTool(deps.toolRegistry, args);
          if (resolved?.status === 'found') return output(resolved.tool);
          if (resolved?.status === 'ambiguous') return error(`Ambiguous model tool ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(`Unknown model tool ${query || '<missing>'}. Use mode:"tools" to inspect available model tools.`);
        }
        if (args.mode === 'release_evidence') return output(releaseEvidenceSummary(args));
        if (args.mode === 'release_evidence_artifact') {
          const resolved = describeHarnessReleaseEvidenceArtifact(args);
          if (resolved.status === 'found') return output(resolved);
          if (resolved.status === 'ambiguous') return error(`Ambiguous release evidence artifact ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          if (resolved.status === 'missing_lookup') return error(resolved.usage ?? 'release_evidence_artifact requires artifactId, target, or query.');
          return error(`Unknown release evidence artifact ${readString(args.artifactId || args.target || args.query) || '<missing>'}. Use mode:"release_evidence" to inspect available artifacts.`);
        }
        if (args.mode === 'release_readiness') return output(releaseReadinessSummary(args));
        if (args.mode === 'release_readiness_item') {
          const resolved = describeHarnessReleaseReadinessItem(args);
          if (resolved.status === 'found') return output(resolved);
          if (resolved.status === 'ambiguous') return error(`Ambiguous release readiness item ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          if (resolved.status === 'unavailable') return output(resolved);
          if (resolved.status === 'missing_lookup') return error(resolved.usage ?? 'release_readiness_item requires itemId, target, or query.');
          return error(`Unknown release readiness item ${readString(args.itemId || args.target || args.query) || '<missing>'}. Use mode:"release_readiness" to inspect available items.`);
        }
        if (args.mode === 'operator_methods') return output(operatorMethodSummary(args));
        if (args.mode === 'operator_method') {
          const resolved = describeHarnessOperatorMethod(args);
          if (resolved.status === 'found') return output(resolved.method);
          if (resolved.status === 'ambiguous') return error(`Ambiguous operator method ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'service_posture') return output(await servicePostureSummary(deps.commandContext, args));
        if (args.mode === 'service_endpoint') {
          const resolved = await describeHarnessServiceEndpoint(deps.commandContext, args);
          if (resolved.status === 'found') return output(resolved.endpoint);
          if (resolved.status === 'ambiguous') return error(`Ambiguous service endpoint ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(resolved.usage);
        }
        if (args.mode === 'connected_host' || args.mode === 'daemon') {
          return output(connectedHostSummary(deps.commandContext, deps.toolRegistry, {
            includeParameters: args.includeParameters === true,
          }));
        }
        if (args.mode === 'connected_host_capability') {
          const query = readString(args.capabilityId || args.target || args.query);
          const resolved = describeConnectedHostCapability(deps.toolRegistry, query);
          if (resolved?.status === 'found') return output(resolved.detail);
          if (resolved?.status === 'ambiguous') return error(`Ambiguous connected-host capability ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
          return error(`Unknown connected-host capability ${query || '<missing>'}. Use mode:"connected_host" to inspect allowed and blocked capability ids.`);
        }
        if (args.mode === 'connected_host_status' || args.mode === 'daemon_status') {
          return output(await connectedHostStatusSummary(deps.commandContext, deps.toolRegistry, {
            includeParameters: args.includeParameters === true,
          }));
        }
        return error(`Unhandled agent_harness mode: ${args.mode}`);
      } catch (err) {
        return error(formatHarnessError(err));
      }
    },
  };
}

export function registerAgentHarnessTool(
  registry: ToolRegistry,
  commandRegistry: CommandRegistry,
  commandContext: CommandContext,
): void {
  registry.register(createAgentHarnessTool({ commandRegistry, commandContext, toolRegistry: registry }));
}
