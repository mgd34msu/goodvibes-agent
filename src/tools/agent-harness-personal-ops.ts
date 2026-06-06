import { getOperatorContract } from '@pellux/goodvibes-sdk/contracts';
import type { CommandContext } from '../input/command-registry.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from '../input/agent-workspace-snapshot.ts';
import { previewHarnessText } from './agent-harness-text.ts';

export type PersonalOpsLaneId =
  | 'inbox'
  | 'calendar'
  | 'notes'
  | 'tasks'
  | 'reminders'
  | 'routines'
  | 'delivery';

type PersonalOpsStatus = 'ready' | 'partial' | 'needs-setup' | 'gap';
type PersonalOpsWorkflowStatus = 'ready' | 'attention' | 'needs-setup';

interface AgentHarnessPersonalOpsArgs {
  readonly laneId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
}

interface OperatorContractMethod {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly category?: string;
  readonly http?: {
    readonly method?: string;
    readonly path?: string;
  };
}

interface PersonalOpsLane {
  readonly id: PersonalOpsLaneId;
  readonly label: string;
  readonly status: PersonalOpsStatus;
  readonly outcome: string;
  readonly current: string;
  readonly next: string;
  readonly userRoute: string;
  readonly modelRoute: string;
  readonly signals: readonly string[];
  readonly methodIds?: readonly string[];
  readonly connectorSignals?: readonly PersonalOpsConnectorSignal[];
  readonly liveRecords?: readonly PersonalOpsLiveRecord[];
  readonly workflows?: readonly PersonalOpsWorkflow[];
}

interface PersonalOpsConnectorSignal {
  readonly id: string;
  readonly kind: 'mcp-server';
  readonly label: string;
  readonly status: 'ready' | 'attention';
  readonly summary: string;
  readonly modelRoute: string;
  readonly toolCount: number;
  readonly capabilityTags: readonly string[];
  readonly readTools?: readonly PersonalOpsConnectorTool[];
  readonly writeTools?: readonly PersonalOpsConnectorTool[];
}

interface PersonalOpsConnectorTool {
  readonly name: string;
  readonly qualifiedName?: string;
  readonly description?: string;
  readonly effect: 'read-only' | 'confirmed-effect';
  readonly capability: string;
  readonly schemaRoute?: string;
  readonly requiredFields?: readonly string[];
  readonly optionalFields?: readonly string[];
  readonly sampleInput?: Readonly<Record<string, unknown>>;
}

interface PersonalOpsLiveRecord {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly summary: string;
  readonly userRoute: string;
  readonly modelRoute: string;
  readonly tags?: readonly string[];
  readonly effect?: 'read-only' | 'confirmed-effect';
  readonly capability?: string;
  readonly qualifiedName?: string;
  readonly requiredFields?: readonly string[];
  readonly optionalFields?: readonly string[];
  readonly sampleInput?: Readonly<Record<string, unknown>>;
  readonly confirmationRequired?: boolean;
}

interface PersonalOpsWorkflow {
  readonly id: string;
  readonly label: string;
  readonly status: PersonalOpsWorkflowStatus;
  readonly summary: string;
  readonly next: string;
  readonly modelRoute: string;
  readonly inspectRoutes: readonly string[];
  readonly prerequisites: readonly string[];
  readonly runBoundary: string;
}

interface McpToolRecord {
  readonly qualifiedName?: string;
  readonly serverName: string;
  readonly toolName: string;
  readonly description?: string;
}

interface McpToolSchema {
  readonly inputSchema?: unknown;
}

interface McpSchemaSummary {
  readonly schemaRoute: string;
  readonly requiredFields: readonly string[];
  readonly optionalFields: readonly string[];
  readonly sampleInput: Readonly<Record<string, unknown>>;
}

export type PersonalOpsLaneResolution =
  | { readonly status: 'found'; readonly lane: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

const LANE_IDS: readonly PersonalOpsLaneId[] = ['inbox', 'calendar', 'notes', 'tasks', 'reminders', 'routines', 'delivery'];

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function operatorContractMethods(): readonly OperatorContractMethod[] {
  const contract = getOperatorContract();
  const methods = Array.isArray(contract.operator?.methods)
    ? contract.operator.methods as OperatorContractMethod[]
    : [];
  return methods.filter((method) => method.id);
}

function methodSearchText(method: OperatorContractMethod): string {
  return [
    method.id,
    method.title,
    method.description,
    method.category,
    method.http?.method,
    method.http?.path,
  ].filter(Boolean).join('\n').toLowerCase();
}

function methodIdsMatching(tokens: readonly string[]): readonly string[] {
  if (tokens.length === 0) return [];
  return operatorContractMethods()
    .filter((method) => {
      const text = methodSearchText(method);
      return tokens.some((token) => text.includes(token));
    })
    .map((method) => method.id)
    .sort((left, right) => left.localeCompare(right));
}

function mcpServerRecords(context: CommandContext): readonly {
  readonly name: string;
  readonly connected: boolean;
  readonly trustMode: string;
  readonly role: string;
  readonly schemaFreshness: string;
  readonly allowedHosts: readonly string[];
}[] {
  const api = context.clients?.mcpApi ?? context.extensions?.mcpRegistry;
  if (!api || typeof api.listServerSecurity !== 'function') return [];
  try {
    return api.listServerSecurity();
  } catch {
    return [];
  }
}

async function mcpToolRecords(context: CommandContext): Promise<readonly McpToolRecord[]> {
  const api = context.clients?.mcpApi ?? context.extensions?.mcpRegistry;
  if (!api || typeof (api as { readonly listAllTools?: unknown }).listAllTools !== 'function') return [];
  try {
    return await (api as { listAllTools: () => Promise<readonly McpToolRecord[]> }).listAllTools();
  } catch {
    return [];
  }
}

function mcpSchemaReader(context: CommandContext): ((qualifiedName: string) => Promise<McpToolSchema | null>) | null {
  const api = context.clients?.mcpApi ?? context.extensions?.mcpRegistry;
  if (!api || typeof (api as { readonly getToolSchema?: unknown }).getToolSchema !== 'function') return null;
  return (qualifiedName) => (api as { getToolSchema: (qualifiedName: string) => Promise<McpToolSchema | null> }).getToolSchema(qualifiedName);
}

function qualifiedToolName(tool: McpToolRecord): string {
  return tool.qualifiedName ?? `mcp:${tool.serverName}:${tool.toolName}`;
}

function isPersonalOpsTool(tool: McpToolRecord): boolean {
  return /(mail|email|gmail|imap|smtp|inbox|message|thread|calendar|caldav|agenda|event|freebusy|availability|meeting)/i.test([
    tool.serverName,
    tool.toolName,
    tool.description ?? '',
  ].join(' '));
}

function schemaObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function schemaRequiredFields(schema: Record<string, unknown>): readonly string[] {
  const required = schema.required;
  if (!Array.isArray(required)) return [];
  return required.filter((field): field is string => typeof field === 'string').sort((left, right) => left.localeCompare(right));
}

function schemaOptionalFields(schema: Record<string, unknown>, requiredFields: readonly string[]): readonly string[] {
  const properties = schemaObject(schema.properties);
  if (!properties) return [];
  const required = new Set(requiredFields);
  return Object.keys(properties).filter((field) => !required.has(field)).sort((left, right) => left.localeCompare(right));
}

function sampleFieldValue(field: string, capability: string, effect: PersonalOpsConnectorTool['effect']): unknown {
  const normalized = field.toLowerCase();
  if (/(limit|max|count|page|size)/.test(normalized)) return 10;
  if (/(dry|preview)/.test(normalized)) return effect === 'confirmed-effect';
  if (/(unread|important|include)/.test(normalized)) return true;
  if (/(start|from|after|time_min|timemin|begin)/.test(normalized)) return capability.startsWith('calendar') ? '<start-iso>' : '<since>';
  if (/(end|to|before|time_max|timemax|until)/.test(normalized)) return capability.startsWith('calendar') ? '<end-iso>' : '<until>';
  if (/(thread|message|mail|email).*id|id$/.test(normalized)) return capability.startsWith('calendar') ? '<event-id>' : '<message-or-thread-id>';
  if (/(event).*id|calendar.*id/.test(normalized)) return '<calendar-or-event-id>';
  if (/(query|search|q|filter)/.test(normalized)) return capability.startsWith('calendar') ? 'today' : 'is:unread newer_than:7d';
  if (/(mailbox|folder|label)/.test(normalized)) return capability.startsWith('calendar') ? '<calendar-name>' : '<mailbox-or-label>';
  if (/(calendar|account|profile)/.test(normalized)) return '<account-or-calendar>';
  if (/(subject|title|summary)/.test(normalized)) return '<reviewed subject>';
  if (/(body|text|message|content|reply|draft|description|note)/.test(normalized)) return '<reviewed draft text>';
  if (/(attendee|participant|invitee)/.test(normalized)) return ['<attendee@example.com>'];
  return `<${field}>`;
}

function sampleInputForFields(
  requiredFields: readonly string[],
  optionalFields: readonly string[],
  capability: string,
  effect: PersonalOpsConnectorTool['effect'],
): Readonly<Record<string, unknown>> {
  const fields = [...requiredFields, ...optionalFields.slice(0, Math.max(0, 4 - requiredFields.length))];
  const sample: Record<string, unknown> = {};
  for (const field of fields) sample[field] = sampleFieldValue(field, capability, effect);
  return sample;
}

function summarizeInputSchema(
  qualifiedName: string,
  inputSchema: unknown,
  capability: string,
  effect: PersonalOpsConnectorTool['effect'],
): McpSchemaSummary | null {
  const schema = schemaObject(inputSchema);
  if (!schema) return null;
  const requiredFields = schemaRequiredFields(schema);
  const optionalFields = schemaOptionalFields(schema, requiredFields);
  return {
    schemaRoute: `mcp schema qualifiedName:"${qualifiedName}"`,
    requiredFields,
    optionalFields,
    sampleInput: sampleInputForFields(requiredFields, optionalFields, capability, effect),
  };
}

async function mcpToolSchemas(
  context: CommandContext,
  tools: readonly McpToolRecord[],
): Promise<ReadonlyMap<string, McpToolSchema>> {
  const readSchema = mcpSchemaReader(context);
  if (!readSchema) return new Map();
  const schemas = new Map<string, McpToolSchema>();
  const candidates = tools.filter(isPersonalOpsTool).slice(0, 50);
  for (const tool of candidates) {
    const qualifiedName = qualifiedToolName(tool);
    try {
      const schema = await readSchema(qualifiedName);
      if (schema) schemas.set(qualifiedName, schema);
    } catch {
      // Schema lookup is best-effort. Personal Ops must keep connector readiness usable even when one MCP server fails schema expansion.
    }
  }
  return schemas;
}

function toolsByServer(tools: readonly McpToolRecord[]): ReadonlyMap<string, readonly McpToolRecord[]> {
  const grouped = new Map<string, McpToolRecord[]>();
  for (const tool of tools) {
    const entries = grouped.get(tool.serverName) ?? [];
    entries.push(tool);
    grouped.set(tool.serverName, entries);
  }
  return grouped;
}

function mcpServerSearchText(server: ReturnType<typeof mcpServerRecords>[number]): string {
  return [
    server.name,
    server.connected ? 'connected' : 'disconnected',
    server.trustMode,
    server.role,
    server.schemaFreshness,
    ...server.allowedHosts,
  ].join('\n').toLowerCase();
}

function toolCapability(tool: McpToolRecord, lane: 'inbox' | 'calendar'): PersonalOpsConnectorTool | null {
  const text = [tool.toolName, tool.description ?? ''].join(' ').toLowerCase();
  const record = (effect: PersonalOpsConnectorTool['effect'], capability: string): PersonalOpsConnectorTool => ({
    name: tool.toolName,
    qualifiedName: qualifiedToolName(tool),
    ...(tool.description ? { description: tool.description } : {}),
    effect,
    capability,
  });
  if (lane === 'inbox') {
    if (/(send|reply|draft|compose|archive|label|delete|trash|mark|move)/.test(text)) {
      return record('confirmed-effect', 'inbox-write');
    }
    if (/(mail|email|gmail|imap|smtp|inbox|message|thread)/.test(text) && /(list|search|get|read|fetch|find|unread|query)/.test(text)) {
      return record('read-only', 'inbox-read');
    }
  } else {
    if (/(create|update|edit|delete|cancel|invite|rsvp|move|reschedule)/.test(text)) {
      return record('confirmed-effect', 'calendar-write');
    }
    if (/(calendar|caldav|agenda|event|freebusy|availability|meeting)/.test(text) && /(list|search|get|read|fetch|find|query|window|upcoming)/.test(text)) {
      return record('read-only', 'calendar-read');
    }
  }
  return null;
}

function connectorToolSummary(tools: readonly McpToolRecord[], lane: 'inbox' | 'calendar'): {
  readonly readTools: readonly PersonalOpsConnectorTool[];
  readonly writeTools: readonly PersonalOpsConnectorTool[];
  readonly capabilityTags: readonly string[];
} {
  const classified = tools
    .map((tool) => toolCapability(tool, lane))
    .filter((tool): tool is PersonalOpsConnectorTool => tool !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
  const readTools = classified.filter((tool) => tool.effect === 'read-only');
  const writeTools = classified.filter((tool) => tool.effect === 'confirmed-effect');
  const capabilityTags = [...new Set(classified.map((tool) => tool.capability))].sort((left, right) => left.localeCompare(right));
  return { readTools, writeTools, capabilityTags };
}

function enrichConnectorToolsWithSchemas(
  tools: readonly PersonalOpsConnectorTool[],
  schemasByQualifiedName: ReadonlyMap<string, McpToolSchema>,
): readonly PersonalOpsConnectorTool[] {
  return tools.map((tool) => {
    if (!tool.qualifiedName) return tool;
    const schema = schemasByQualifiedName.get(tool.qualifiedName);
    const summary = summarizeInputSchema(tool.qualifiedName, schema?.inputSchema, tool.capability, tool.effect);
    if (!summary) return tool;
    return {
      ...tool,
      schemaRoute: summary.schemaRoute,
      requiredFields: summary.requiredFields,
      optionalFields: summary.optionalFields,
      sampleInput: summary.sampleInput,
    };
  });
}

function connectorSignalsMatching(
  context: CommandContext,
  tokens: readonly string[],
  options: {
    readonly lane: 'inbox' | 'calendar';
    readonly toolsByServer: ReadonlyMap<string, readonly McpToolRecord[]>;
    readonly schemasByQualifiedName: ReadonlyMap<string, McpToolSchema>;
  },
): readonly PersonalOpsConnectorSignal[] {
  if (tokens.length === 0) return [];
  return mcpServerRecords(context)
    .filter((server) => {
      const text = mcpServerSearchText(server);
      return tokens.some((token) => text.includes(token));
    })
    .map((server) => {
      const ready = server.connected && server.schemaFreshness === 'fresh' && server.trustMode !== 'blocked';
      const serverTools = options.toolsByServer.get(server.name) ?? [];
      const toolSummary = connectorToolSummary(serverTools, options.lane);
      const readTools = enrichConnectorToolsWithSchemas(toolSummary.readTools, options.schemasByQualifiedName);
      const writeTools = enrichConnectorToolsWithSchemas(toolSummary.writeTools, options.schemasByQualifiedName);
      return {
        id: `mcp:${server.name}`,
        kind: 'mcp-server' as const,
        label: server.name,
        status: ready ? 'ready' as const : 'attention' as const,
        summary: [
          `${server.connected ? 'connected' : 'disconnected'} ${server.trustMode} ${server.schemaFreshness}`,
          serverTools.length > 0 ? `${serverTools.length} tool(s)` : '',
          toolSummary.capabilityTags.length > 0 ? toolSummary.capabilityTags.join(', ') : '',
        ].filter(Boolean).join('; '),
        modelRoute: `agent_harness mode:"mcp_server" mcpServerId:"${server.name}"`,
        toolCount: serverTools.length,
        capabilityTags: toolSummary.capabilityTags,
        ...(readTools.length > 0 ? { readTools: readTools.slice(0, 8) } : {}),
        ...(writeTools.length > 0 ? { writeTools: writeTools.slice(0, 8) } : {}),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function connectorReady(signals: readonly PersonalOpsConnectorSignal[]): boolean {
  return signals.some((signal) => signal.status === 'ready');
}

function connectorToolCount(signals: readonly PersonalOpsConnectorSignal[], effect: PersonalOpsConnectorTool['effect']): number {
  return signals.reduce((total, signal) => total + (effect === 'read-only' ? signal.readTools?.length ?? 0 : signal.writeTools?.length ?? 0), 0);
}

function workflowStatus(methodIds: readonly string[], connectors: readonly PersonalOpsConnectorSignal[]): PersonalOpsWorkflowStatus {
  if (methodIds.length > 0 || connectorReady(connectors)) return 'ready';
  if (connectors.length > 0) return 'attention';
  return 'needs-setup';
}

function workflowModelRoute(
  methodQuery: string,
  connectors: readonly PersonalOpsConnectorSignal[],
): string {
  const readyConnector = connectors.find((signal) => signal.status === 'ready') ?? connectors[0];
  if (readyConnector) return readyConnector.modelRoute;
  return `agent_harness mode:"operator_methods" query:"${methodQuery}"`;
}

function workflowInspectRoutes(methodIds: readonly string[], connectors: readonly PersonalOpsConnectorSignal[], fallbackQuery: string): readonly string[] {
  const connectorRoutes = connectors.map((signal) => signal.modelRoute);
  const methodRoutes = methodIds.slice(0, 6).map((methodId) => `agent_harness mode:"operator_method" methodId:"${methodId}"`);
  const routes = [...connectorRoutes, ...methodRoutes];
  return routes.length > 0 ? routes : [`agent_harness mode:"personal_ops_lane" laneId:"${fallbackQuery}"`];
}

function inboxWorkflows(methodIds: readonly string[], connectors: readonly PersonalOpsConnectorSignal[]): readonly PersonalOpsWorkflow[] {
  const status = workflowStatus(methodIds, connectors);
  const inspectRoutes = workflowInspectRoutes(methodIds, connectors, 'inbox');
  const modelRoute = workflowModelRoute('email', connectors);
  const readToolCount = connectorToolCount(connectors, 'read-only');
  const writeToolCount = connectorToolCount(connectors, 'confirmed-effect');
  const setupPrerequisite = status === 'needs-setup'
    ? ['Install or configure an email-capable daemon method, MCP server, or plugin first.']
    : status === 'attention'
      ? ['Review connector trust/schema freshness before reading inbox data.']
      : [
        'Inspect the exact connector or daemon method schema before selecting inbox actions.',
        readToolCount > 0
          ? `${readToolCount} classified read-only inbox tool(s) are available.`
          : 'No classified read-only inbox tools were returned; inspect the connector schema before claiming live inbox access.',
      ];
  return [
    {
      id: 'inbox-triage-briefing',
      label: 'Inbox triage briefing',
      status,
      summary: 'Summarize unread or high-priority inbound messages without sending mail.',
      next: status === 'ready'
        ? 'Inspect the connector/method, list candidate messages, then summarize priorities and risks in the main conversation.'
        : 'Finish email connector setup before attempting inbox triage.',
      modelRoute,
      inspectRoutes,
      prerequisites: setupPrerequisite,
      runBoundary: 'Read/list/search can run only through the reviewed connector or daemon method; sends and mutations require explicit confirmation.',
    },
    {
      id: 'inbox-draft-reply',
      label: 'Draft reply review',
      status,
      summary: 'Draft replies for selected messages while keeping send as a separate confirmed action.',
      next: status === 'ready'
        ? 'Read the selected thread through the connector, draft in chat, then ask for confirmation before any send route.'
        : 'Finish email connector setup before drafting from live threads.',
      modelRoute,
      inspectRoutes,
      prerequisites: [
        ...setupPrerequisite,
        'The user must identify the account, mailbox, or message selection.',
        writeToolCount > 0
          ? `${writeToolCount} write-like inbox tool(s) require explicit confirmation before send, label, archive, delete, or move effects.`
          : 'No write-like inbox tools were classified; keep sending and mailbox mutation out of scope until a connector route is inspected.',
      ],
      runBoundary: 'Drafting is conversation output; sending or labeling stays on the connector/tool route with confirmation.',
    },
  ];
}

function calendarWorkflows(methodIds: readonly string[], connectors: readonly PersonalOpsConnectorSignal[]): readonly PersonalOpsWorkflow[] {
  const status = workflowStatus(methodIds, connectors);
  const inspectRoutes = workflowInspectRoutes(methodIds, connectors, 'calendar');
  const modelRoute = workflowModelRoute('calendar', connectors);
  const readToolCount = connectorToolCount(connectors, 'read-only');
  const writeToolCount = connectorToolCount(connectors, 'confirmed-effect');
  const setupPrerequisite = status === 'needs-setup'
    ? ['Install or configure a calendar-capable daemon method, CalDAV MCP server, or plugin first.']
    : status === 'attention'
      ? ['Review connector trust/schema freshness before reading calendar data.']
      : [
        'Inspect the exact connector or daemon method schema before selecting agenda actions.',
        readToolCount > 0
          ? `${readToolCount} classified read-only calendar tool(s) are available.`
          : 'No classified read-only calendar tools were returned; inspect the connector schema before claiming live agenda access.',
      ];
  return [
    {
      id: 'calendar-agenda-briefing',
      label: 'Agenda briefing',
      status,
      summary: 'Read upcoming events and prepare a concise day or week briefing.',
      next: status === 'ready'
        ? 'Inspect the connector/method, fetch the requested window, then summarize agenda context and prep items.'
        : 'Finish calendar connector setup before attempting agenda briefing.',
      modelRoute,
      inspectRoutes,
      prerequisites: [...setupPrerequisite, 'The user must provide a date range or accept a bounded default window.'],
      runBoundary: 'Calendar reads can run only through reviewed connector/method routes; event edits require explicit confirmation.',
    },
    {
      id: 'calendar-conflict-scan',
      label: 'Conflict scan',
      status,
      summary: 'Detect overlapping events or prep gaps and offer reminders instead of editing the calendar silently.',
      next: status === 'ready'
        ? 'Inspect the agenda source, scan the requested window, then propose reminders or follow-ups for confirmation.'
        : 'Finish calendar connector setup before scanning conflicts.',
      modelRoute,
      inspectRoutes,
      prerequisites: [
        ...setupPrerequisite,
        'The user must provide a calendar/account scope if more than one exists.',
        writeToolCount > 0
          ? `${writeToolCount} write-like calendar tool(s) require explicit confirmation before event create, edit, delete, RSVP, or reschedule effects.`
          : 'No write-like calendar tools were classified; keep event mutation out of scope until a connector route is inspected.',
      ],
      runBoundary: 'Conflict findings are advisory; reminders use agent_reminder_schedule and calendar edits use confirmed connector actions.',
    },
  ];
}

function laneStatusRank(status: PersonalOpsStatus): number {
  if (status === 'ready') return 4;
  if (status === 'partial') return 3;
  if (status === 'needs-setup') return 2;
  return 1;
}

function searchText(lane: PersonalOpsLane): string {
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
    lane.connectorSignals?.flatMap((signal) => [
      signal.id,
      signal.label,
      signal.status,
      signal.summary,
      signal.modelRoute,
      String(signal.toolCount),
      signal.capabilityTags.join('\n'),
      signal.readTools?.map((tool) => `${tool.name} ${tool.description ?? ''} ${tool.capability}`).join('\n') ?? '',
      signal.writeTools?.map((tool) => `${tool.name} ${tool.description ?? ''} ${tool.capability}`).join('\n') ?? '',
    ]).join('\n') ?? '',
    lane.workflows?.flatMap((workflow) => [
      workflow.id,
      workflow.label,
      workflow.status,
      workflow.summary,
      workflow.next,
      workflow.modelRoute,
      workflow.inspectRoutes.join('\n'),
      workflow.prerequisites.join('\n'),
      workflow.runBoundary,
    ]).join('\n') ?? '',
    lane.liveRecords?.flatMap((record) => [
      record.id,
      record.label,
      record.status,
      record.summary,
      record.userRoute,
      record.modelRoute,
      record.tags?.join('\n') ?? '',
    ]).join('\n') ?? '',
  ].join('\n').toLowerCase();
}

function describeLiveRecord(record: PersonalOpsLiveRecord, includeParameters: boolean): Record<string, unknown> {
  return {
    id: record.id,
    label: record.label,
    status: record.status,
    summary: previewHarnessText(record.summary, includeParameters ? 180 : 96),
    userRoute: previewHarnessText(record.userRoute, includeParameters ? 140 : 96),
    modelRoute: previewHarnessText(record.modelRoute, includeParameters ? 140 : 96),
    ...(record.tags && record.tags.length > 0 ? { tags: record.tags.slice(0, includeParameters ? 12 : 4) } : {}),
    ...(includeParameters && record.effect ? { effect: record.effect } : {}),
    ...(includeParameters && record.capability ? { capability: record.capability } : {}),
    ...(includeParameters && record.qualifiedName ? { qualifiedName: record.qualifiedName } : {}),
    ...(includeParameters && record.requiredFields ? { requiredFields: record.requiredFields } : {}),
    ...(includeParameters && record.optionalFields ? { optionalFields: record.optionalFields.slice(0, 12) } : {}),
    ...(includeParameters && record.sampleInput ? { sampleInput: record.sampleInput } : {}),
    ...(includeParameters && typeof record.confirmationRequired === 'boolean' ? { confirmationRequired: record.confirmationRequired } : {}),
  };
}

function describeConnectorSignal(signal: PersonalOpsConnectorSignal, includeParameters: boolean): Record<string, unknown> {
  return {
    id: signal.id,
    kind: signal.kind,
    label: signal.label,
    status: signal.status,
    summary: previewHarnessText(signal.summary, includeParameters ? 180 : 96),
    modelRoute: previewHarnessText(signal.modelRoute, includeParameters ? 140 : 96),
    toolCount: signal.toolCount,
    ...(signal.capabilityTags.length > 0 ? { capabilityTags: signal.capabilityTags } : {}),
    ...(includeParameters && signal.readTools && signal.readTools.length > 0 ? { readTools: signal.readTools } : {}),
    ...(includeParameters && signal.writeTools && signal.writeTools.length > 0 ? { writeTools: signal.writeTools } : {}),
  };
}

function describeWorkflow(workflow: PersonalOpsWorkflow, includeParameters: boolean): Record<string, unknown> {
  return {
    id: workflow.id,
    label: workflow.label,
    status: workflow.status,
    summary: previewHarnessText(workflow.summary, includeParameters ? 180 : 96),
    next: previewHarnessText(workflow.next, includeParameters ? 180 : 96),
    modelRoute: previewHarnessText(workflow.modelRoute, 96),
    ...(includeParameters ? {
      inspectRoutes: workflow.inspectRoutes,
      prerequisites: workflow.prerequisites,
      runBoundary: workflow.runBoundary,
    } : {}),
  };
}

function describeLane(lane: PersonalOpsLane, includeParameters: boolean): Record<string, unknown> {
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
    ...(lane.connectorSignals && lane.connectorSignals.length > 0 ? { connectorSignals: lane.connectorSignals.slice(0, includeParameters ? 8 : 3).map((signal) => describeConnectorSignal(signal, includeParameters)) } : {}),
    ...(lane.workflows && lane.workflows.length > 0 ? { workflows: lane.workflows.slice(0, includeParameters ? 8 : 3).map((workflow) => describeWorkflow(workflow, includeParameters)) } : {}),
    ...(lane.liveRecords && lane.liveRecords.length > 0 ? { liveRecords: lane.liveRecords.slice(0, includeParameters ? 8 : 3).map((record) => describeLiveRecord(record, includeParameters)) } : {}),
    ...(includeParameters ? {
      routes: {
        user: lane.userRoute,
        model: lane.modelRoute,
      },
      methodIds: lane.methodIds ?? [],
      safety: 'Writes, sends, schedules, and operator calls require explicit user request and confirmation through the owning tool.',
    } : {}),
  };
}

function localRecord(domain: 'note' | 'routine', item: ReturnType<typeof buildAgentWorkspaceRuntimeSnapshot>['localNotes'][number]): PersonalOpsLiveRecord {
  return {
    id: item.id,
    label: item.name,
    status: item.reviewState,
    summary: item.description,
    userRoute: domain === 'note' ? 'Agent Workspace -> Notes' : 'Agent Workspace -> Routines',
    modelRoute: `agent_local_registry domain:"${domain}" action:"get" id:"${item.id}"`,
    tags: item.tags,
  };
}

function routineReceiptRecord(receipt: ReturnType<typeof buildAgentWorkspaceRuntimeSnapshot>['latestRoutineScheduleReceipt']): PersonalOpsLiveRecord | null {
  if (!receipt) return null;
  return {
    id: receipt.id,
    label: receipt.scheduleName,
    status: receipt.status,
    summary: `${receipt.routineName} -> ${receipt.scheduleKind} ${receipt.scheduleValue}`,
    userRoute: 'Agent Workspace -> Personal Ops -> Routine schedule receipts',
    modelRoute: 'agent_harness mode:"autonomy_queue_item" queueItemId:"routine-schedule-promotions"',
  };
}

function channelRecords(snapshot: ReturnType<typeof buildAgentWorkspaceRuntimeSnapshot>): readonly PersonalOpsLiveRecord[] {
  return snapshot.channels.map((channel) => ({
    id: channel.id,
    label: channel.label,
    status: channel.setupState,
    summary: `${channel.delivery}; ${channel.riskLabel}. ${channel.nextStep}`,
    userRoute: 'Agent Workspace -> Channels',
    modelRoute: `agent_harness mode:"channel" channelId:"${channel.id}"`,
    tags: [channel.risk, channel.delivery],
  }));
}

function connectorRecords(signals: readonly PersonalOpsConnectorSignal[], laneLabel: string): readonly PersonalOpsLiveRecord[] {
  return signals.flatMap((signal) => {
    const summaryRecord: PersonalOpsLiveRecord = {
      id: signal.id,
      label: `${laneLabel} connector: ${signal.label}`,
      status: signal.status,
      summary: [
        signal.summary,
        signal.capabilityTags.length > 0 ? `capabilities ${signal.capabilityTags.join(', ')}` : '',
      ].filter(Boolean).join('; '),
      userRoute: 'Agent Workspace -> Tools & MCP',
      modelRoute: signal.modelRoute,
      tags: ['connector', signal.kind, ...signal.capabilityTags],
    };
    const operationTools = [...(signal.readTools ?? []), ...(signal.writeTools ?? [])];
    const operationRecords: PersonalOpsLiveRecord[] = operationTools
      .slice(0, 8)
      .map((tool) => ({
        id: tool.qualifiedName ?? `${signal.id}:${tool.name}`,
        label: `${laneLabel} ${tool.effect === 'read-only' ? 'read' : 'confirmed action'}: ${tool.name}`,
        status: signal.status,
        summary: [
          `${tool.effect === 'read-only' ? 'Read-only' : 'Write-like'} ${tool.capability} MCP route.`,
          tool.requiredFields && tool.requiredFields.length > 0 ? `required fields ${tool.requiredFields.join(', ')}` : 'schema fields unknown until inspected',
          tool.description ?? '',
        ].filter(Boolean).join(' '),
        userRoute: 'Agent Workspace -> Tools & MCP -> Tool schema',
        modelRoute: tool.schemaRoute ?? signal.modelRoute,
        tags: ['connector-operation', signal.kind, tool.capability, tool.effect],
        effect: tool.effect,
        capability: tool.capability,
        ...(tool.qualifiedName ? { qualifiedName: tool.qualifiedName } : {}),
        ...(tool.requiredFields ? { requiredFields: tool.requiredFields } : {}),
        ...(tool.optionalFields ? { optionalFields: tool.optionalFields } : {}),
        ...(tool.sampleInput ? { sampleInput: tool.sampleInput } : {}),
        confirmationRequired: tool.effect === 'confirmed-effect',
      }));
    return [summaryRecord, ...operationRecords];
  });
}

function buildLanes(
  context: CommandContext,
  options: {
    readonly toolsByServer?: ReadonlyMap<string, readonly McpToolRecord[]>;
    readonly schemasByQualifiedName?: ReadonlyMap<string, McpToolSchema>;
  } = {},
): readonly PersonalOpsLane[] {
  const snapshot = buildAgentWorkspaceRuntimeSnapshot(context);
  const emailMethods = methodIdsMatching(['email', 'mail', 'imap', 'smtp']);
  const calendarMethods = methodIdsMatching(['calendar', 'caldav', 'agenda']);
  const toolsByName = options.toolsByServer ?? new Map<string, readonly McpToolRecord[]>();
  const schemasByQualifiedName = options.schemasByQualifiedName ?? new Map<string, McpToolSchema>();
  const emailConnectors = connectorSignalsMatching(context, ['email', 'mail', 'imap', 'smtp', 'gmail'], { lane: 'inbox', toolsByServer: toolsByName, schemasByQualifiedName });
  const calendarConnectors = connectorSignalsMatching(context, ['calendar', 'caldav', 'agenda'], { lane: 'calendar', toolsByServer: toolsByName, schemasByQualifiedName });
  const taskMethods = methodIdsMatching(['task', 'work-plan', 'workplan']);
  const scheduleMethods = methodIdsMatching(['schedule', 'reminder']);
  const readyChannels = snapshot.channels.filter((channel) => channel.ready).length;
  const enabledChannels = snapshot.channels.filter((channel) => channel.enabled).length;
  const configuredTargets = snapshot.channels.filter((channel) => channel.defaultTarget === 'configured').length;
  const scheduleReadyRoutines = snapshot.localRoutines.filter((routine) => (
    routine.enabled === true
    && routine.reviewState === 'reviewed'
    && (routine.missingRequirementCount ?? 0) === 0
  )).length;

  return [
    {
      id: 'inbox',
      label: 'Inbox',
      status: emailMethods.length > 0 || emailConnectors.length > 0 ? 'partial' : 'gap',
      outcome: 'Triage inbound email or message inboxes, summarize threads, draft replies, and send only after confirmation.',
      current: emailMethods.length > 0
        ? 'The daemon contract exposes email-like methods; Personal Ops workflow cards now guide inbox triage and draft boundaries around exact methods.'
        : emailConnectors.length > 0
          ? 'A configured MCP connector looks email-capable; Personal Ops workflow cards now guide inbox triage, schema-derived operation records, and draft boundaries around its exact tools.'
        : 'No email/IMAP/SMTP methods are present in the current GoodVibes SDK operator contract.',
      next: emailMethods.length > 0
        ? 'Use the inbox workflow cards to inspect exact methods, read selected threads, summarize priorities, and keep send as a separate confirmation.'
        : emailConnectors.length > 0
          ? 'Use the inbox workflow cards and operation records to inspect matching MCP connector schemas, then route triage only through reviewed connector actions.'
        : 'Install or build an email connector/MCP/plugin, then expose triage and draft-reply actions here.',
      userRoute: 'Agent Workspace -> Personal Ops -> Channels or connector setup',
      modelRoute: emailConnectors.length > 0 ? 'agent_harness mode:"mcp_servers" query:"email"' : 'agent_harness mode:"operator_methods" query:"email"',
      signals: [
        `${emailMethods.length} email-like daemon method(s)`,
        `${emailConnectors.length} email-like MCP connector(s)`,
        `${readyChannels}/${snapshot.channels.length} channel(s) ready for delivery`,
      ],
      methodIds: emailMethods,
      connectorSignals: emailConnectors,
      workflows: inboxWorkflows(emailMethods, emailConnectors),
      liveRecords: connectorRecords(emailConnectors, 'Inbox'),
    },
    {
      id: 'calendar',
      label: 'Calendar',
      status: calendarMethods.length > 0 || calendarConnectors.length > 0 ? 'partial' : 'gap',
      outcome: 'Read agenda context, identify conflicts, prepare briefings, and create reminders for calendar-driven work.',
      current: calendarMethods.length > 0
        ? 'The daemon contract exposes calendar-like methods; Personal Ops workflow cards now guide agenda briefing and conflict-scan boundaries.'
        : calendarConnectors.length > 0
          ? 'A configured MCP connector looks calendar-capable; Personal Ops workflow cards now guide agenda briefing, schema-derived operation records, and conflict-scan boundaries around its exact tools.'
        : 'No calendar/CalDAV/agenda methods are present in the current GoodVibes SDK operator contract.',
      next: calendarMethods.length > 0
        ? 'Use the calendar workflow cards to inspect exact methods, fetch a bounded agenda window, and propose reminders or follow-ups.'
        : calendarConnectors.length > 0
          ? 'Use the calendar workflow cards and operation records to inspect matching MCP connector schemas, then route agenda work only through reviewed connector actions.'
        : 'Add a CalDAV/calendar connector and route agenda briefing, conflicts, and reminders through this lane.',
      userRoute: 'Agent Workspace -> Personal Ops -> Create reminder',
      modelRoute: calendarConnectors.length > 0 ? 'agent_harness mode:"mcp_servers" query:"calendar"' : 'agent_harness mode:"operator_methods" query:"calendar"',
      signals: [
        `${calendarMethods.length} calendar-like daemon method(s)`,
        `${calendarConnectors.length} calendar-like MCP connector(s)`,
        `${scheduleMethods.length} schedule/reminder method(s) available for follow-up`,
      ],
      methodIds: calendarMethods,
      connectorSignals: calendarConnectors,
      workflows: calendarWorkflows(calendarMethods, calendarConnectors),
      liveRecords: connectorRecords(calendarConnectors, 'Calendar'),
    },
    {
      id: 'notes',
      label: 'Notes',
      status: 'ready',
      outcome: 'Capture working context, source triage, decisions, and handoff notes without polluting durable memory.',
      current: `Agent-local notes are available: ${snapshot.localNoteCount} note(s), ${snapshot.localNoteReviewQueueCount} needing review.`,
      next: snapshot.localNoteCount > 0
        ? 'Review or promote selected notes into memory, skills, routines, or Agent Knowledge when useful.'
        : 'Create a note from the Personal Ops or Notes workspace when the next decision or source needs tracking.',
      userRoute: 'Agent Workspace -> Personal Ops -> Create note',
      modelRoute: 'agent_local_registry domain:"notes" action:"create"',
      signals: [
        `${snapshot.localNoteCount} local note(s)`,
        `${snapshot.localNoteReviewQueueCount} note(s) in review queue`,
      ],
      liveRecords: snapshot.localNotes.slice(0, 5).map((note) => localRecord('note', note)),
    },
    {
      id: 'tasks',
      label: 'Tasks',
      status: taskMethods.length > 0 ? 'ready' : 'partial',
      outcome: 'Track user-visible work items, inspect host task state, and update work plan status without hidden jobs.',
      current: `Agent has work-plan actions and ${taskMethods.length} task/work-plan daemon method(s) in the SDK contract.`,
      next: 'Use work plans for user-visible task tracking; inspect runtime host tasks separately before mutating anything.',
      userRoute: 'Agent Workspace -> Personal Ops -> Add work item',
      modelRoute: 'agent_work_plan action:"add"',
      signals: [
        `${taskMethods.length} task/work-plan daemon method(s)`,
        'Work plan add/show/status/delete actions are available',
      ],
      methodIds: taskMethods,
    },
    {
      id: 'reminders',
      label: 'Reminders',
      status: scheduleMethods.length > 0 ? 'ready' : 'partial',
      outcome: 'Turn a user request into a visible reminder or autonomous schedule with delivery target and cancellation path.',
      current: `Reminder and autonomous schedule creation are available through Agent tools; ${scheduleMethods.length} schedule/reminder daemon method(s) are discoverable.`,
      next: 'Create one confirmed reminder or autonomous schedule with title, time, scope, delivery target, success criteria, and explicit user request.',
      userRoute: 'Agent Workspace -> Personal Ops -> Create reminder',
      modelRoute: 'agent_reminder_schedule or agent_autonomy_schedule',
      signals: [
        `${scheduleMethods.length} schedule/reminder daemon method(s)`,
        `${configuredTargets} configured delivery target(s)`,
      ],
      methodIds: scheduleMethods,
    },
    {
      id: 'routines',
      label: 'Routines',
      status: scheduleReadyRoutines > 0 ? 'ready' : snapshot.localRoutineCount > 0 ? 'partial' : 'needs-setup',
      outcome: 'Reuse repeatable local workflows and promote reviewed routines to connected schedules only when useful.',
      current: `${snapshot.localRoutineCount} routine(s), ${snapshot.enabledRoutineCount} enabled, ${scheduleReadyRoutines} schedule-ready, ${snapshot.routineScheduleReceiptCount} promotion receipt(s).`,
      next: scheduleReadyRoutines > 0
        ? 'Promote a reviewed routine to a connected schedule when the user asks for recurrence.'
        : 'Create or review a routine, resolve setup gaps, then promote only with explicit schedule confirmation.',
      userRoute: 'Agent Workspace -> Personal Ops -> Routine library',
      modelRoute: 'agent_harness mode:"workspace_actions" categoryId:"routines"',
      signals: [
        `${scheduleReadyRoutines} schedule-ready routine(s)`,
        `${snapshot.failedRoutineScheduleReceiptCount} failed promotion receipt(s)`,
      ],
      liveRecords: [
        ...snapshot.localRoutines.slice(0, 5).map((routine) => localRecord('routine', routine)),
        ...[routineReceiptRecord(snapshot.latestRoutineScheduleReceipt)].filter((record): record is PersonalOpsLiveRecord => record !== null),
      ],
    },
    {
      id: 'delivery',
      label: 'Delivery',
      status: readyChannels > 0 ? 'ready' : enabledChannels > 0 ? 'needs-setup' : 'partial',
      outcome: 'Reach the user through configured channels and send messages or notifications only after explicit confirmation.',
      current: `${readyChannels}/${snapshot.channels.length} channel(s) ready, ${enabledChannels} enabled, ${configuredTargets} configured default target(s).`,
      next: readyChannels > 0
        ? 'Use confirmed channel send or notification tools when the user asks for delivery.'
        : 'Enable and configure one delivery channel so personal-ops reminders and summaries can reach the user.',
      userRoute: 'Agent Workspace -> Personal Ops -> Channels',
      modelRoute: 'agent_harness mode:"channels"',
      signals: [
        `${readyChannels} ready channel(s)`,
        `${configuredTargets} configured default target(s)`,
      ],
      liveRecords: channelRecords(snapshot),
    },
  ];
}

function nextActions(lanes: readonly PersonalOpsLane[]): readonly string[] {
  const urgent = lanes
    .filter((lane) => lane.status === 'gap' || lane.status === 'needs-setup')
    .map((lane) => `${lane.label}: ${lane.next}`);
  const partial = lanes
    .filter((lane) => lane.status === 'partial')
    .map((lane) => `${lane.label}: ${lane.next}`);
  return [...urgent, ...partial].slice(0, 5);
}

export function personalOpsCatalogStatus(context: CommandContext): Record<string, unknown> {
  const lanes = buildLanes(context);
  const workflows = lanes.flatMap((lane) => lane.workflows ?? []);
  const counts = lanes.reduce<Record<PersonalOpsStatus, number>>((acc, lane) => {
    acc[lane.status] += 1;
    return acc;
  }, { ready: 0, partial: 0, 'needs-setup': 0, gap: 0 });
  return {
    modes: ['personal_ops', 'personal_ops_lane'],
    lanes: lanes.length,
    ...counts,
    workflows: workflows.length,
    readyWorkflows: workflows.filter((workflow) => workflow.status === 'ready').length,
    attentionWorkflows: workflows.filter((workflow) => workflow.status === 'attention').length,
    setupWorkflows: workflows.filter((workflow) => workflow.status === 'needs-setup').length,
    bestReadyStatus: lanes.reduce((best, lane) => Math.max(best, laneStatusRank(lane.status)), 0),
  };
}

export async function personalOpsSummary(context: CommandContext, args: AgentHarnessPersonalOpsArgs): Promise<Record<string, unknown>> {
  const includeParameters = args.includeParameters === true;
  const tools = includeParameters ? await mcpToolRecords(context) : [];
  const schemasByQualifiedName = includeParameters ? await mcpToolSchemas(context, tools) : new Map<string, McpToolSchema>();
  const lanes = buildLanes(context, {
    toolsByServer: toolsByServer(tools),
    schemasByQualifiedName,
  });
  const workflows = lanes.flatMap((lane) => lane.workflows ?? []);
  return {
    lanes: lanes.map((lane) => describeLane(lane, includeParameters)),
    returned: lanes.length,
    total: lanes.length,
    workflowSummary: {
      workflows: workflows.length,
      ready: workflows.filter((workflow) => workflow.status === 'ready').length,
      attention: workflows.filter((workflow) => workflow.status === 'attention').length,
      needsSetup: workflows.filter((workflow) => workflow.status === 'needs-setup').length,
    },
    policy: 'Personal Ops unifies inbox, agenda, notes, tasks, reminders, routines, and delivery. Lanes include live records when Agent owns them and schema-derived connector operation records when MCP schemas are available. Missing email/calendar connectors, messages, and events are reported as setup/data gaps, not faked.',
    nextActions: nextActions(lanes),
  };
}

export async function describePersonalOpsLane(context: CommandContext, args: AgentHarnessPersonalOpsArgs): Promise<PersonalOpsLaneResolution> {
  const laneId = readString(args.laneId);
  const target = readString(args.target);
  const query = readString(args.query);
  const input = laneId || target || query;
  if (!input) {
    return {
      status: 'missing_lookup',
      usage: `personal_ops_lane requires laneId, target, or query. Lane ids: ${LANE_IDS.join(', ')}.`,
    };
  }
  const normalized = input.toLowerCase();
  const tools = await mcpToolRecords(context);
  const lanes = buildLanes(context, { toolsByServer: toolsByServer(tools), schemasByQualifiedName: await mcpToolSchemas(context, tools) });
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
    usage: `Unknown Personal Ops lane ${input}. Lane ids: ${LANE_IDS.join(', ')}.`,
  };
}
