import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';

const AGENT_CONTEXT_TOOL_MODES = [
  'summary',
  'capabilities',
  'modes',
  'tools',
  'tool',
  'settings',
  'setting',
  'commands',
  'command',
  'workspace',
  'status',
] as const;

type AgentContextMode = typeof AGENT_CONTEXT_TOOL_MODES[number];

type AgentContextArgs = {
  readonly mode?: unknown;
  readonly query?: unknown;
  readonly target?: unknown;
  readonly toolName?: unknown;
  readonly command?: unknown;
  readonly commandName?: unknown;
  readonly key?: unknown;
  readonly category?: unknown;
  readonly prefix?: unknown;
  readonly includeHidden?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
};

const CONTEXT_TOOL_FALLBACK = {
  runtime: 'GoodVibes Agent',
  preferredTool: 'agent_harness',
  routes: {
    summary: 'agent_harness mode:"summary"',
    capabilities: 'goodvibes_context mode:"capabilities"',
    tools: 'agent_harness mode:"tools"',
    tool: 'agent_harness mode:"tool"',
    settings: 'agent_harness mode:"settings"',
    commands: 'agent_harness mode:"commands"',
    workspace: 'agent_harness mode:"workspace"',
    status: 'agent_harness mode:"connected_host_status"',
  },
};

export function wrapAgentContextToolForAgentPolicy(tool: Tool, registry?: ToolRegistry): void {
  tool.definition.description = 'Inspect GoodVibes Agent harness capabilities.';
  tool.definition.sideEffects = [];
  tool.definition.parameters = {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: [...AGENT_CONTEXT_TOOL_MODES] },
      query: { type: 'string' },
      target: { type: 'string' },
      toolName: { type: 'string' },
      command: { type: 'string' },
      commandName: { type: 'string' },
      key: { type: 'string' },
      category: { type: 'string' },
      prefix: { type: 'string' },
      includeHidden: { type: 'boolean' },
      includeParameters: { type: 'boolean' },
      limit: { type: 'number' },
    },
    additionalProperties: false,
  };
  tool.execute = async (rawArgs) => {
    const args = rawArgs as AgentContextArgs;
    const mode = readAgentContextMode(args.mode);
    if (mode === 'capabilities') return ok(buildAgentCapabilitiesContract(registry));

    const harnessMode = agentContextModeToHarnessMode(mode);
    const harnessTool = registry?.list().find((entry) => entry.definition.name === 'agent_harness');
    if (!harnessTool) {
      return ok({
        ...CONTEXT_TOOL_FALLBACK,
        status: 'agent_harness_not_registered_yet',
        requestedMode: mode,
        route: `agent_harness mode:"${harnessMode}"`,
      });
    }

    const harnessArgs = {
      mode: harnessMode,
      query: args.query,
      target: args.target,
      toolName: args.toolName,
      command: args.command,
      commandName: args.commandName,
      key: args.key,
      category: args.category,
      prefix: args.prefix,
      includeHidden: args.includeHidden,
      includeParameters: args.includeParameters,
      limit: args.limit,
    };
    const result = await harnessTool.execute(dropUndefined(harnessArgs));
    if (!result.success) return result;
    return ok({
      source: 'agent_harness',
      requestedMode: mode,
      route: `agent_harness mode:"${harnessMode}"`,
      result: parseToolOutput(result.output),
    });
  };
}

export const AGENT_CONTEXT_TOOL_COMPATIBILITY_MODES = AGENT_CONTEXT_TOOL_MODES;

function readAgentContextMode(value: unknown): AgentContextMode {
  return typeof value === 'string' && AGENT_CONTEXT_TOOL_MODES.includes(value as AgentContextMode)
    ? value as AgentContextMode
    : 'summary';
}

function agentContextModeToHarnessMode(mode: AgentContextMode): string {
  if (mode === 'modes') return 'modes';
  if (mode === 'tools') return 'tools';
  if (mode === 'tool') return 'tool';
  if (mode === 'settings') return 'settings';
  if (mode === 'setting') return 'get_setting';
  if (mode === 'commands') return 'commands';
  if (mode === 'command') return 'command';
  if (mode === 'workspace') return 'workspace';
  if (mode === 'status') return 'connected_host_status';
  return 'summary';
}

function buildAgentCapabilitiesContract(registry?: ToolRegistry): Record<string, unknown> {
  const availableTools = new Set(safeToolNames(registry));
  const has = (name: string) => availableTools.has(name);
  const optionalTool = (name: string) => has(name) ? name : `${name} (not registered)`;

  return {
    runtime: 'GoodVibes Agent',
    answerStyle: 'Answer user capability questions from this contract. Do not dump inventory counts.',
    currentContract: {
      autonomy: 'User-directed operator agent. It can inspect, plan, edit, run tools, and perform confirmed effects; it is not an unrestricted background account-creation or self-expansion agent.',
      confirmations: 'External sends, reminders, media generation, settings writes, slash-command execution, workspace actions, packet preset saves, and operator actions require an explicit user request plus confirm:true where the tool requires it.',
      secrets: 'Do not reveal raw secrets. Use configured secret refs, provider accounts, and channel readiness routes.',
    },
    canDoNow: [
      {
        area: 'Project and computer work',
        can: 'Read, search, analyze, edit, and write workspace files; run bounded shell commands; inspect diffs and project structure; recover recent file edit/write snapshots.',
        tools: ['read', 'find', 'analyze', 'inspect', 'edit', 'write', 'exec'].filter(has),
        inspect: 'agent_harness mode:"execution_posture"',
      },
      {
        area: 'Web research',
        can: has('web_search')
          ? 'Plan multi-step research with a read-only route plan, search the web with bounded evidence, inspect URLs, capture candidate sources in a local review queue, and summarize sourced findings in the main conversation.'
          : 'Web research is not available until the web_search tool is registered.',
        tools: [optionalTool('agent_harness'), optionalTool('web_search'), optionalTool('fetch'), optionalTool('agent_research_runs'), optionalTool('agent_research_sources'), optionalTool('agent_research_report')],
        inspect: 'agent_harness mode:"research_workflow" query:"<research request>"',
      },
      {
        area: 'Harness operation',
        can: 'Discover and use harness modes, slash commands, workspace actions, settings, panels, UI surfaces, keybindings, and model tools.',
        tools: [optionalTool('agent_harness'), 'goodvibes_context'],
        inspect: 'agent_harness mode:"modes" query:"capability"',
      },
      {
        area: 'Memory and knowledge',
        can: 'Use Agent-local memory, notes, personas, skills, routines, prompt-context inspection, memory/vector posture, learning curator review/proposal queues, confirmed duplicate-consolidation phase helpers, work plans, and isolated Agent Knowledge ask/search/ingest routes.',
        tools: [optionalTool('agent_harness'), optionalTool('agent_local_registry'), optionalTool('agent_learning_consolidation'), optionalTool('agent_work_plan'), optionalTool('agent_knowledge'), optionalTool('agent_knowledge_ingest')],
        inspect: 'agent_harness mode:"prompt_context", mode:"memory_posture", or mode:"learning_curator"',
      },
      {
        area: 'Personal operations',
        can: 'Turn inbox, agenda, task, reminder, note, routine, or delivery requests into the safest visible lane, route, required fields, and confirmation boundary, then inspect the broader operations map without inventing missing connectors.',
        tools: [optionalTool('agent_harness'), optionalTool('agent_local_registry'), optionalTool('agent_work_plan'), optionalTool('schedule'), optionalTool('agent_autonomy_schedule'), optionalTool('agent_reminder_schedule'), optionalTool('agent_schedule_edit'), optionalTool('agent_channel_send')],
        inspect: 'agent_harness mode:"personal_ops_intake" query:"<personal request>" or mode:"personal_ops"',
      },
      {
      area: 'Documents and artifacts',
      can: 'Create, revise, version, review, comment on, suggest changes to, attach or insert saved artifacts into, export Agent document drafts with reviewer appendices, inspect reviewer-readiness preflight, save reusable review packet presets, and share confirmed reviewer packet archive references; browse saved artifacts; track visible research run checkpoints; capture and review research source queues; save sourced research report artifacts; promote reviewed artifacts into isolated Agent Knowledge; handle uploads, source checks, generated media artifacts, and run confirmed blind model comparisons from prompts or saved text artifacts with durable review, side-by-side views, section-jump reviewer handoff diffs, judgment, task/document/benchmark-filtered analytics/synthesis, reviewer handoff, handoff archive with matching route-decision receipt evidence, route-update actions, and leave-unchanged route-decision receipts.',
      tools: [optionalTool('agent_harness'), optionalTool('agent_documents'), optionalTool('agent_review_packet_presets'), optionalTool('agent_review_packet_share'), optionalTool('agent_artifacts'), optionalTool('agent_knowledge'), optionalTool('agent_knowledge_ingest'), optionalTool('agent_media_generate'), optionalTool('agent_model_compare'), optionalTool('agent_research_runs'), optionalTool('agent_research_sources'), optionalTool('agent_research_report')],
        inspect: 'agent_harness mode:"document_ops"',
      },
      {
        area: 'Configured services and messages',
        can: 'Inspect configured channel readiness, visible autonomy queue, and send one confirmed message/notification/reminder/media request or create/edit one confirmed autonomous schedule through configured targets.',
        tools: [optionalTool('agent_channel_send'), optionalTool('agent_notify'), optionalTool('schedule'), optionalTool('agent_autonomy_schedule'), optionalTool('agent_reminder_schedule'), optionalTool('agent_schedule_edit'), optionalTool('agent_media_generate')],
        inspect: 'agent_harness mode:"channels", mode:"notifications", or mode:"autonomy_queue"',
      },
      {
        area: 'Provider and setup work',
        can: 'Inspect provider accounts, subscriptions, model routing, hardware-scored local model cookbook setup plans, confirmed benchmark action routes, setup posture, service posture, connected-host status, and GoodVibes settings import; apply supported settings changes when explicitly requested.',
        tools: [optionalTool('setup'), optionalTool('agent_harness'), optionalTool('import_goodvibes_settings')],
        inspect: 'setup action:"status"; use agent_harness mode:"provider_accounts", mode:"model_routing", or mode:"settings" for detailed catalogs',
      },
    ],
    needsSetupOrIntegration: [
      'Email inbox triage and replies are not a built-in advertised Agent tool in this package; they require a configured plugin, MCP server, or channel/service connector that exposes inbox and send/reply actions.',
      'New third-party service signup/account creation is not a built-in autonomous flow. The Agent can help fill instructions and run explicit tools, but it should not use local personal information to create accounts without a user-owned integration and confirmation path.',
      'Long-running autonomous operation requires an explicit schedule, routine, automation, research run, or connected-host route visible in the autonomy queue. The main conversation does not silently create hidden background jobs.',
      'New capabilities can come from installed plugins, MCP servers, configured services, or code changes; the Agent should inspect what is installed before claiming a capability exists.',
    ],
    commonRoutes: {
      findCapability: 'agent_harness mode:"modes" query:"<task>"',
      executionPosture: 'agent_harness mode:"execution_posture"; inspect one route with mode:"execution_route"; use terminal command:"..." background:true confirm:true explicitUserRequest:"..." for visible tracked long-running commands and process action:"list|poll|log|wait|kill|write" to manage them; inspect lower-level background_processes/background_process/run_background_process routes when route detail is needed; inspect recent activity cards and records with mode:"execution_history"; prefer local read/edit/exec for the current workspace, delegation for isolation/parallel/remote',
      fileRecovery: 'agent_harness mode:"file_recovery"; apply one snapshot with mode:"run_file_recovery" recoveryAction:"undo|redo" confirm:true explicitUserRequest:"..."',
      personalOps: 'agent_harness mode:"personal_ops_intake" query:"<personal request>"; use schedule action:"list|create|remind|edit|run|pause|resume|delete" for connected schedules/reminders after explicit confirmation; agent_harness mode:"personal_ops"; inspect one lane with mode:"personal_ops_lane"',
      promptContext: 'agent_harness mode:"prompt_context"; add includeParameters:true only when bounded prompt previews are needed',
      memoryPosture: 'agent_harness mode:"memory_posture"; inspect one embedding or external-memory provider with mode:"memory_provider"; write/rebuild/change routes stay confirmed',
      autonomyIntake: 'agent_harness mode:"autonomy_intake" query:"<ongoing work request>"; use returned route and missing fields before creating background work',
      autonomyQueue: 'agent_harness mode:"autonomy_queue"; inspect one card with mode:"autonomy_queue_item"; use returned live records/log tails when present',
      setup: 'setup action:"status"; inspect one row with action:"item" setupItemId:"..."; use action:"checkpoint"; confirmed effects use action:"save_checkpoint|clear_checkpoint|token|smoke|finish|import_settings" confirm:true explicitUserRequest:"..."',
      settingsImport: 'import_goodvibes_settings action:"preview"; apply with action:"apply" confirm:true explicitUserRequest:"..." after user approval; workspace action route remains available for visible form parity',
      learningCurator: 'agent_harness mode:"learning_curator"; inspect one card with mode:"learning_candidate"; apply duplicate phases with agent_learning_consolidation mode:"preview|merge|stale|delete|rollback"',
      documentOps: 'agent_harness mode:"document_ops"; inspect one lane with mode:"document_ops_lane"',
      documents: 'agent_documents mode:"list"; show with documentId; confirmed create/update/review/comment/resolveComment/suggest/acceptSuggestion/rejectSuggestion/attachArtifact/insertArtifact/export with confirm:true',
      reviewPacketPresets: 'agent_review_packet_presets mode:"list"; show with artifactId to check missing/superseded ids and reuse routes; refresh stale presets with mode:"refresh" confirm:true explicitUserRequest:"..."; save reusable packet defaults with mode:"save" confirm:true explicitUserRequest:"..."',
      reviewPacketShare: 'agent_review_packet_share archiveArtifactId:"..." channel:"..." confirm:true explicitUserRequest:"..."; sends a plain-text archive reference only',
      artifacts: 'agent_artifacts mode:"list"; inspect with mode:"show"; export one with mode:"export"; package selected ids with mode:"package" or mode:"archive"; promote reviewed artifact ids with agent_knowledge_ingest sourceKind:"artifact"',
      researchWorkflow: 'agent_harness mode:"research_workflow" query:"<research request>"; returns visible-run, source, report, browser/fetch, and Knowledge routes without running them',
      researchRuns: 'agent_harness mode:"research_runs"; create/checkpoint/pause/resume/cancel/complete visible run state and log tails with agent_research_runs; no hidden background work starts from the ledger',
      researchSources: 'agent_harness mode:"research_queue"; capture/review and report source bundles with agent_research_sources; no Knowledge ingest occurs unless agent_knowledge_ingest is called separately',
      researchReports: 'agent_research_report with reviewed sources, citation coverage repair metadata, optional requireCitationCoverage:true, confirm:true, and explicitUserRequest',
      localModelCookbook: 'agent_harness mode:"model_routing" query:"local"; inspect hardware fit with mode:"model_route" modelRouteId:"local-model-cookbook"',
      listTools: 'agent_harness mode:"tools" query:"<task>"',
      inspectTool: 'agent_harness mode:"tool" toolName:"<tool>"',
      listCommands: 'agent_harness mode:"commands" query:"<task>"',
      runCommand: 'agent_harness mode:"run_command" command:"/<command> ..." confirm:true explicitUserRequest:"..."',
      listWorkspaceActions: 'agent_harness mode:"workspace_actions" query:"<task>"',
      runWorkspaceAction: 'agent_harness mode:"run_workspace_action" actionId:"<id>" confirm:true explicitUserRequest:"..."',
      inspectSettings: 'agent_harness mode:"settings" query:"<setting>"',
      setSetting: 'agent_harness mode:"set_setting" key:"<key>" value:<value> confirm:true explicitUserRequest:"..."',
      webResearch: `multi-step: agent_harness mode:"research_workflow" query:"<research request>"; single-shot: ${has('web_search') ? 'web_search query:"<research request>" verbosity:"evidence" maxResults:10 evidenceTopN:3' : 'web_search not registered'}`,
      channels: 'agent_harness mode:"channels"; send with agent_channel_send only after explicit user request',
    },
    registeredModelTools: safeToolNames(registry),
  };
}

function safeToolNames(registry?: ToolRegistry): readonly string[] {
  try {
    return registry?.getToolDefinitions().map((tool) => tool.name).sort((a, b) => a.localeCompare(b)) ?? [];
  } catch {
    return [];
  }
}

function dropUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function parseToolOutput(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function ok(value: unknown): { readonly success: true; readonly output: string } {
  return { success: true, output: JSON.stringify(value, null, 2) };
}
