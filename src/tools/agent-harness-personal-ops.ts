import { getOperatorContract } from '@pellux/goodvibes-sdk/contracts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import type { ArtifactDescriptor } from '@pellux/goodvibes-sdk/platform/artifacts';
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
type PersonalOpsBriefingStatus = 'ready' | 'attention' | 'needs-setup';

interface AgentHarnessPersonalOpsArgs {
  readonly laneId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
  readonly recordId?: unknown;
  readonly fields?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
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
  readonly artifactId?: string;
  readonly reviewRecordCount?: number;
  readonly reviewLabels?: readonly string[];
  readonly sourceTool?: string;
  readonly followUpRoutes?: readonly PersonalOpsFollowUpRoute[];
  readonly freshness?: PersonalOpsRecordFreshness;
}

interface PersonalOpsFollowUpRoute {
  readonly id: string;
  readonly label: string;
  readonly effect: 'read-only' | 'confirmed-effect';
  readonly modelRoute: string;
  readonly requiresConfirmation: boolean;
  readonly policy: string;
}

interface PersonalOpsRecordFreshness {
  readonly status:
    | 'fresh-provider-route-ready'
    | 'saved-review-refreshable'
    | 'connector-attention'
    | 'provider-contract-missing'
    | 'source-tool-missing';
  readonly source: 'connector-read' | 'saved-review-artifact';
  readonly sourceTool?: string;
  readonly lastReviewedAt?: string;
  readonly refreshRoute?: string;
  readonly requiredFields?: readonly string[];
  readonly sampleInput?: Readonly<Record<string, unknown>>;
  readonly policy: string;
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

interface PersonalOpsIntakeCandidate {
  readonly id: string;
  readonly label: string;
  readonly laneId: PersonalOpsLaneId;
  readonly status: PersonalOpsWorkflowStatus;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly why: string;
  readonly modelRoute: string;
  readonly inspectRoutes: readonly string[];
  readonly requiresConfirmation: boolean;
  readonly safetyBoundary: string;
  readonly nextSteps: readonly string[];
  readonly workflowId?: string;
  readonly operation?: Record<string, unknown>;
  readonly followUpOperation?: Record<string, unknown>;
  readonly executionPlan?: readonly PersonalOpsExecutionStep[];
  readonly requiredFields?: readonly string[];
  readonly missingFields?: readonly string[];
  readonly userQuestion?: string;
}

interface PersonalOpsExecutionStep {
  readonly id: string;
  readonly label: string;
  readonly routeKind: 'connector-read' | 'local-compose' | 'connector-confirmed-effect' | 'setup';
  readonly effect: 'read-only' | 'local-only' | 'confirmed-effect' | 'setup';
  readonly requiresConfirmation: boolean;
  readonly modelRoute: string;
  readonly status: PersonalOpsWorkflowStatus;
  readonly policy: string;
  readonly connectorId?: string;
  readonly connectorStatus?: PersonalOpsConnectorSignal['status'];
  readonly qualifiedName?: string;
  readonly schemaRoute?: string;
  readonly requiredFields?: readonly string[];
  readonly sampleInput?: Readonly<Record<string, unknown>>;
}

export type PersonalOpsLaneResolution =
  | { readonly status: 'found'; readonly lane: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

export type PersonalOpsReadRunResult =
  | { readonly status: 'missing_lookup'; readonly usage: string; readonly examples: readonly string[] }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | Record<string, unknown>;

const LANE_IDS: readonly PersonalOpsLaneId[] = ['inbox', 'calendar', 'notes', 'tasks', 'reminders', 'routines', 'delivery'];
const PERSONAL_OPS_READ_CONTROL_FIELDS = new Set(['saveReviewCards', 'saveReview', 'artifactTitle']);

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(12, Math.trunc(parsed)));
}

function hasAny(text: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => text.includes(token));
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

function mcpToolCaller(context: CommandContext): ((qualifiedName: string, input: Readonly<Record<string, unknown>>) => Promise<unknown>) | null {
  const api = context.clients?.mcpApi ?? context.extensions?.mcpRegistry;
  if (!api || typeof (api as { readonly callTool?: unknown }).callTool !== 'function') return null;
  return (qualifiedName, input) => (api as { callTool: (qualifiedName: string, input: Readonly<Record<string, unknown>>) => Promise<unknown> }).callTool(qualifiedName, input);
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
      runBoundary: 'Conflict findings are advisory; reminders use schedule action:"remind" and calendar edits use confirmed connector actions.',
    },
  ];
}

function hasMethod(methodIds: readonly string[], methodId: string): boolean {
  return methodIds.includes(methodId);
}

function taskWorkflows(methodIds: readonly string[]): readonly PersonalOpsWorkflow[] {
  const hostTaskStatus: PersonalOpsWorkflowStatus = methodIds.length > 0 ? 'ready' : 'needs-setup';
  return [
    {
      id: 'visible-work-plan-review',
      label: 'Visible work-plan review',
      status: 'ready',
      summary: 'Track user-facing work items in the Agent-owned work plan before creating background or host work.',
      next: 'Review the plan, add or update one item when useful, and keep status changes visible.',
      modelRoute: 'agent_work_plan action:"list"',
      inspectRoutes: [
        'agent_harness mode:"workspace_action" actionId:"workplan"',
        'agent_harness mode:"workspace_action" actionId:"workplan-add"',
        'agent_harness mode:"workspace_action" actionId:"workplan-status"',
      ],
      prerequisites: ['Use the work plan when the user asks for task tracking, multi-step work, or a visible checkpoint.'],
      runBoundary: 'Agent-owned work-plan edits stay local and visible; deletion/clear-completed routes require explicit confirmation.',
    },
    {
      id: 'connected-host-task-review',
      label: 'Connected-host task review',
      status: hostTaskStatus,
      summary: 'Inspect connected-host task state separately from Agent-owned work-plan state.',
      next: hostTaskStatus === 'ready'
        ? 'List host tasks, inspect one exact task id, then cancel or retry only through confirmed daemon controls when the user asks.'
        : 'Update or connect the GoodVibes host until task inspection methods are present.',
      modelRoute: 'agent_harness mode:"workspace_action" actionId:"tasks-list"',
      inspectRoutes: [
        'agent_harness mode:"workspace_action" actionId:"tasks-list"',
        'agent_harness mode:"workspace_action" actionId:"task-show"',
        ...methodIds.slice(0, 6).map((methodId) => `agent_harness mode:"operator_method" methodId:"${methodId}"`),
      ],
      prerequisites: hostTaskStatus === 'ready'
        ? [`${methodIds.length} task/work-plan daemon method(s) are discoverable.`]
        : ['Connected-host task methods are not present in the current SDK operator contract.'],
      runBoundary: 'Host task cancel/retry/create actions mutate connected-host state and require exact ids, confirmation, and explicit user request.',
    },
  ];
}

function reminderWorkflows(methodIds: readonly string[], deliveryConfigured: boolean): readonly PersonalOpsWorkflow[] {
  const scheduleStatus: PersonalOpsWorkflowStatus = methodIds.length > 0 ? 'ready' : 'needs-setup';
  const reminderStatus: PersonalOpsWorkflowStatus = methodIds.length === 0 ? 'needs-setup' : deliveryConfigured ? 'ready' : 'attention';
  return [
    {
      id: 'confirmed-reminder-request',
      label: 'Confirmed reminder request',
      status: reminderStatus,
      summary: 'Create one visible reminder only from a direct user request with real timing and optional delivery target.',
      next: reminderStatus === 'ready'
        ? 'Collect title, timing, delivery scope, and explicit user request, then use the confirmed reminder route.'
        : reminderStatus === 'attention'
          ? 'Configure or confirm a delivery target before relying on reminder delivery, or create the reminder with explicit scope.'
          : 'Update the connected GoodVibes host until schedule/reminder creation methods are available.',
      modelRoute: 'schedule action:"remind"',
      inspectRoutes: [
        'agent_harness mode:"workspace_action" actionId:"schedule-reminder"',
        'agent_harness mode:"channels"',
        ...methodIds.filter((methodId) => methodId.startsWith('schedules.')).slice(0, 6).map((methodId) => `agent_harness mode:"operator_method" methodId:"${methodId}"`),
      ],
      prerequisites: [
        'The user must provide a concrete reminder title and time.',
        deliveryConfigured ? 'At least one delivery target or channel is configured.' : 'No configured delivery target was detected; delivery setup may be needed.',
      ],
      runBoundary: 'Reminder creation requires confirm:true and explicitUserRequest; vague follow-up ideas stay as notes or work-plan items.',
    },
    {
      id: 'connected-schedule-review',
      label: 'Connected schedule review',
      status: scheduleStatus,
      summary: 'Review existing connected schedules before editing, running, pausing, resuming, or deleting one.',
      next: scheduleStatus === 'ready'
        ? 'List schedules or inspect the autonomy queue, then control only one exact schedule id through confirmed routes.'
        : 'Update the connected GoodVibes host until schedule list/control methods are available.',
      modelRoute: 'agent_harness mode:"autonomy_queue_item" queueItemId:"connected-schedules"',
      inspectRoutes: [
        'agent_harness mode:"workspace_action" actionId:"schedule-list"',
        'agent_harness mode:"autonomy_queue_item" queueItemId:"connected-schedules"',
        'agent_harness mode:"workspace_action" actionId:"schedule-edit"',
      ],
      prerequisites: scheduleStatus === 'ready'
        ? [`${methodIds.length} schedule/reminder daemon method(s) are discoverable.`]
        : ['Connected-host schedule methods are not present in the current SDK operator contract.'],
      runBoundary: 'Schedule edit/run/enable/disable/delete actions require exact ids, confirmation, and explicit user request.',
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
      record.freshness ? [
        record.freshness.status,
        record.freshness.source,
        record.freshness.sourceTool ?? '',
        record.freshness.refreshRoute ?? '',
        record.freshness.policy,
      ].join('\n') : '',
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
    ...(includeParameters && record.artifactId ? { artifactId: record.artifactId } : {}),
    ...(includeParameters && typeof record.reviewRecordCount === 'number' ? { reviewRecordCount: record.reviewRecordCount } : {}),
    ...(includeParameters && record.reviewLabels && record.reviewLabels.length > 0 ? { reviewLabels: record.reviewLabels } : {}),
    ...(includeParameters && record.sourceTool ? { sourceTool: record.sourceTool } : {}),
    ...(includeParameters && record.freshness ? { freshness: record.freshness } : {}),
    ...(includeParameters && record.followUpRoutes && record.followUpRoutes.length > 0 ? { followUpRoutes: record.followUpRoutes } : {}),
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

function personalOpsReadRunRoute(laneId: PersonalOpsLaneId, recordId: string): string {
  return `agent_harness mode:"run_personal_ops_read" laneId:"${laneId}" recordId:"${recordId}" fields:{...} confirm:true explicitUserRequest:"..."`;
}

function connectorReadFreshness(signal: PersonalOpsConnectorSignal, tool: PersonalOpsConnectorTool, laneId: PersonalOpsLaneId): PersonalOpsRecordFreshness | undefined {
  if (tool.effect !== 'read-only') return undefined;
  const recordId = tool.qualifiedName ?? `${signal.id}:${tool.name}`;
  return {
    status: signal.status === 'ready' ? 'fresh-provider-route-ready' : 'connector-attention',
    source: 'connector-read',
    ...(tool.qualifiedName ? { sourceTool: tool.qualifiedName } : {}),
    ...(signal.status === 'ready' ? { refreshRoute: personalOpsReadRunRoute(laneId, recordId) } : {}),
    ...(tool.requiredFields ? { requiredFields: tool.requiredFields } : {}),
    ...(tool.sampleInput ? { sampleInput: tool.sampleInput } : {}),
    policy: signal.status === 'ready'
      ? 'Reads fresh provider data only through the confirmed Personal Ops read route; provider mutations stay on separate confirmed-effect routes.'
      : 'Repair connector connection, trust, or schema freshness before reading provider data.',
  };
}

function connectorRecords(signals: readonly PersonalOpsConnectorSignal[], laneLabel: string, laneId: PersonalOpsLaneId): readonly PersonalOpsLiveRecord[] {
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
      .map((tool) => {
        const freshness = connectorReadFreshness(signal, tool, laneId);
        return {
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
          ...(freshness ? { freshness } : {}),
        };
      });
    return [summaryRecord, ...operationRecords];
  });
}

function artifactMetadata(artifact: ArtifactDescriptor): Readonly<Record<string, unknown>> {
  return artifact.metadata && typeof artifact.metadata === 'object' && !Array.isArray(artifact.metadata)
    ? artifact.metadata
    : {};
}

function artifactMetadataString(artifact: ArtifactDescriptor, key: string): string {
  const value = artifactMetadata(artifact)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function artifactMetadataNumber(artifact: ArtifactDescriptor, key: string): number | null {
  const value = artifactMetadata(artifact)[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function artifactMetadataStringArray(artifact: ArtifactDescriptor, key: string): readonly string[] {
  const value = artifactMetadata(artifact)[key];
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => previewHarnessText(redactedPersonalOpsText(entry.trim()), 120));
  }
  if (typeof value === 'string' && value.trim()) return [previewHarnessText(redactedPersonalOpsText(value.trim()), 120)];
  return [];
}

function safeRecordIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function savedReviewArtifacts(context: CommandContext, laneId: 'inbox' | 'calendar'): readonly ArtifactDescriptor[] {
  const store = context.platform.artifactStore;
  if (!store?.list) return [];
  try {
    return store.list(100)
      .filter((artifact) => artifactMetadataString(artifact, 'purpose') === 'personal-ops-review-cards')
      .filter((artifact) => artifactMetadataString(artifact, 'laneId') === laneId)
      .sort((left, right) => {
        const leftCreated = typeof left.createdAt === 'number' ? left.createdAt : 0;
        const rightCreated = typeof right.createdAt === 'number' ? right.createdAt : 0;
        return rightCreated - leftCreated;
      })
      .slice(0, 5);
  } catch {
    return [];
  }
}

function matchingReadTool(
  connectors: readonly PersonalOpsConnectorSignal[],
  sourceTool: string,
): { readonly signal: PersonalOpsConnectorSignal; readonly tool: PersonalOpsConnectorTool } | null {
  if (!sourceTool) return null;
  for (const signal of connectors) {
    const tool = (signal.readTools ?? []).find((entry) => entry.qualifiedName === sourceTool || entry.name === sourceTool);
    if (tool) return { signal, tool };
  }
  return null;
}

function savedReviewFreshness(options: {
  readonly laneId: 'inbox' | 'calendar';
  readonly createdAt: string;
  readonly sourceTool: string;
  readonly connectors: readonly PersonalOpsConnectorSignal[];
}): PersonalOpsRecordFreshness {
  const match = matchingReadTool(options.connectors, options.sourceTool);
  if (!options.sourceTool) {
    return {
      status: 'source-tool-missing',
      source: 'saved-review-artifact',
      ...(options.createdAt ? { lastReviewedAt: options.createdAt } : {}),
      policy: 'This saved review artifact did not preserve a connector source tool, so Agent can only reopen the redacted artifact and cannot offer a precise refresh route.',
    };
  }
  if (!match) {
    return {
      status: 'provider-contract-missing',
      source: 'saved-review-artifact',
      sourceTool: options.sourceTool,
      ...(options.createdAt ? { lastReviewedAt: options.createdAt } : {}),
      policy: 'The saved review names a source tool, but the current runtime does not expose a matching read-only connector route. Reconnect or repair the provider before refreshing.',
    };
  }
  return {
    status: match.signal.status === 'ready' ? 'saved-review-refreshable' : 'connector-attention',
    source: 'saved-review-artifact',
    sourceTool: options.sourceTool,
    ...(options.createdAt ? { lastReviewedAt: options.createdAt } : {}),
    ...(match.signal.status === 'ready' ? { refreshRoute: personalOpsReadRunRoute(options.laneId, options.sourceTool) } : {}),
    ...(match.tool.requiredFields ? { requiredFields: match.tool.requiredFields } : {}),
    ...(match.tool.sampleInput ? { sampleInput: match.tool.sampleInput } : {}),
    policy: match.signal.status === 'ready'
      ? 'Saved review data is stale by default. Refresh requires the user to supply current connector fields and confirm the read; saved artifacts do not store raw prior input values.'
      : 'A matching connector route exists, but it needs connection, trust, or schema freshness repair before refreshing saved review data.',
  };
}

function refreshableSavedRecordCount(records: readonly PersonalOpsLiveRecord[]): number {
  return records.filter((record) => record.freshness?.status === 'saved-review-refreshable').length;
}

function savedReviewQueueRecords(
  context: CommandContext,
  laneId: 'inbox' | 'calendar',
  connectors: readonly PersonalOpsConnectorSignal[],
): readonly PersonalOpsLiveRecord[] {
  return savedReviewArtifacts(context, laneId)
    .flatMap((artifact) => {
      const reviewLabels = artifactMetadataStringArray(artifact, 'reviewLabels').slice(0, 5);
      const reviewRecordIds = artifactMetadataStringArray(artifact, 'reviewRecordIds').slice(0, reviewLabels.length);
      const sourceTool = artifactMetadataString(artifact, 'sourceTool') || artifactMetadataString(artifact, 'sourceRecordId');
      const createdAt = typeof artifact.createdAt === 'number' && Number.isFinite(artifact.createdAt)
        ? new Date(artifact.createdAt).toISOString()
        : '';
      const freshness = savedReviewFreshness({ laneId, createdAt, sourceTool, connectors });
      return reviewLabels.map((label, index): PersonalOpsLiveRecord => {
        const recordId = reviewRecordIds[index] || label || `${index + 1}`;
        const artifactRoute = `agent_artifacts show artifactId:"${artifact.id}" includeContent:true`;
        const calendar = laneId === 'calendar';
        return {
          id: `${calendar ? 'review-event' : 'review-thread'}:${artifact.id}:${safeRecordIdPart(recordId)}`,
          label: `${calendar ? 'Saved event' : 'Saved thread'}: ${label}`,
          status: calendar ? 'ready-for-reminder' : 'ready-for-draft',
          summary: [
            `Derived from saved redacted ${calendar ? 'calendar' : 'inbox'} review artifact ${artifact.id}.`,
            sourceTool ? `Source ${sourceTool}.` : '',
            createdAt ? `Saved ${createdAt}.` : '',
            calendar
              ? 'Inspect the artifact before creating reminders or proposing calendar edits.'
              : 'Inspect the artifact before drafting; sending remains a separate confirmed connector action.',
          ].filter(Boolean).join(' '),
          userRoute: calendar
            ? 'Agent Workspace -> Personal Ops -> Calendar review queue'
            : 'Agent Workspace -> Personal Ops -> Inbox review queue',
          modelRoute: artifactRoute,
          tags: [
            'saved-review',
            'artifact',
            calendar ? 'calendar-event' : 'inbox-thread',
            calendar ? 'reminder-ready' : 'draft-ready',
          ],
          effect: 'read-only',
          capability: calendar ? 'calendar-event-review' : 'inbox-thread-review',
          confirmationRequired: false,
          artifactId: artifact.id,
          reviewRecordCount: 1,
          reviewLabels: [label],
          ...(sourceTool ? { sourceTool } : {}),
          freshness,
          followUpRoutes: calendar
            ? [
              ...(freshness.refreshRoute ? [{
                id: 'refresh-saved-event',
                label: 'Refresh saved event from provider',
                effect: 'read-only' as const,
                modelRoute: freshness.refreshRoute,
                requiresConfirmation: true,
                policy: 'Refresh reads current provider data only after the user supplies required fields and confirms the bounded read.',
              }] : []),
              {
                id: 'create-reminder-from-event',
                label: 'Create reminder from saved event',
                effect: 'confirmed-effect',
                modelRoute: 'schedule action:"remind" message:"..." at:"..." confirm:true explicitUserRequest:"..."',
                requiresConfirmation: true,
                policy: 'Create one reminder only after the user reviews the saved event and confirms exact timing.',
              },
              {
                id: 'calendar-edit-boundary',
                label: 'Inspect calendar edit route',
                effect: 'confirmed-effect',
                modelRoute: 'agent_harness mode:"personal_ops_intake" query:"edit saved calendar event" includeParameters:true',
                requiresConfirmation: true,
                policy: 'Calendar edits, RSVP, reschedule, and deletes require a separate inspected connector route and explicit confirmation.',
              },
            ]
            : [
              ...(freshness.refreshRoute ? [{
                id: 'refresh-saved-thread',
                label: 'Refresh saved thread from provider',
                effect: 'read-only' as const,
                modelRoute: freshness.refreshRoute,
                requiresConfirmation: true,
                policy: 'Refresh reads current provider data only after the user supplies required fields and confirms the bounded read.',
              }] : []),
              {
                id: 'draft-local-reply',
                label: 'Draft local reply from saved thread',
                effect: 'read-only',
                modelRoute: artifactRoute,
                requiresConfirmation: false,
                policy: 'Drafting stays local in the Agent transcript and does not send, label, archive, move, or delete provider records.',
              },
              {
                id: 'send-reviewed-reply-boundary',
                label: 'Inspect send route for reviewed reply',
                effect: 'confirmed-effect',
                modelRoute: 'agent_harness mode:"personal_ops_intake" query:"send reviewed reply from saved inbox review" includeParameters:true',
                requiresConfirmation: true,
                policy: 'Send only after a write-like inbox connector route is inspected and the user confirms exact recipients and body.',
              },
            ],
        };
      });
    })
    .slice(0, 10);
}

function savedReviewArtifactRecords(
  context: CommandContext,
  laneId: 'inbox' | 'calendar',
  connectors: readonly PersonalOpsConnectorSignal[],
): readonly PersonalOpsLiveRecord[] {
  return savedReviewArtifacts(context, laneId).map((artifact) => {
    const reviewRecordCount = artifactMetadataNumber(artifact, 'reviewRecordCount') ?? 0;
    const reviewLabels = artifactMetadataStringArray(artifact, 'reviewLabels').slice(0, 5);
    const sourceTool = artifactMetadataString(artifact, 'sourceTool') || artifactMetadataString(artifact, 'sourceRecordId');
    const createdAt = typeof artifact.createdAt === 'number' && Number.isFinite(artifact.createdAt)
      ? new Date(artifact.createdAt).toISOString()
      : '';
    const freshness = savedReviewFreshness({ laneId, createdAt, sourceTool, connectors });
    const countText = reviewRecordCount > 0
      ? `${reviewRecordCount} normalized review card${reviewRecordCount === 1 ? '' : 's'}`
      : 'normalized review cards';
    return {
      id: `review-artifact:${artifact.id}`,
      label: `${laneId === 'calendar' ? 'Saved agenda review' : 'Saved inbox review'}: ${artifact.filename ?? artifact.id}`,
      status: 'ready',
      summary: [
        `${countText} saved for later review.`,
        reviewLabels.length > 0 ? `Items ${reviewLabels.slice(0, 3).join('; ')}.` : '',
        sourceTool ? `Source ${sourceTool}.` : '',
        createdAt ? `Saved ${createdAt}.` : '',
        'Use the artifact route to reopen redacted cards before summary, draft, or promotion work.',
      ].filter(Boolean).join(' '),
      userRoute: 'Agent Workspace -> Artifacts -> Browse artifacts',
      modelRoute: `agent_artifacts show artifactId:"${artifact.id}" includeContent:true`,
      tags: ['saved-review', 'artifact', laneId === 'calendar' ? 'calendar-read' : 'inbox-read'],
      effect: 'read-only',
      capability: laneId === 'calendar' ? 'calendar-review-artifact' : 'inbox-review-artifact',
      confirmationRequired: false,
      artifactId: artifact.id,
      reviewRecordCount,
      ...(reviewLabels.length > 0 ? { reviewLabels } : {}),
      ...(sourceTool ? { sourceTool } : {}),
      freshness,
    };
  });
}

function taskOperationRecords(methodIds: readonly string[]): readonly PersonalOpsLiveRecord[] {
  const records: PersonalOpsLiveRecord[] = [
    {
      id: 'workplan-list',
      label: 'Review visible work plan',
      status: 'ready',
      summary: 'Read Agent-owned work-plan items before starting or switching multi-step work.',
      userRoute: 'Agent Workspace -> Work -> Review work plan',
      modelRoute: 'agent_work_plan action:"list"',
      tags: ['work-plan', 'task-read'],
      effect: 'read-only',
      capability: 'task-read',
    },
    {
      id: 'workplan-add',
      label: 'Add visible work item',
      status: 'ready',
      summary: 'Create one local Agent work-plan item instead of hiding task state in chat.',
      userRoute: 'Agent Workspace -> Personal Ops -> Add work item',
      modelRoute: 'agent_work_plan action:"create" title:"..."',
      tags: ['work-plan', 'task-write'],
      effect: 'confirmed-effect',
      capability: 'task-write',
      requiredFields: ['title'],
      optionalFields: ['detail', 'priority', 'status'],
      confirmationRequired: false,
    },
    {
      id: 'workplan-status',
      label: 'Update work item status',
      status: 'ready',
      summary: 'Move one visible work item through pending, active, blocked, done, failed, or cancelled state.',
      userRoute: 'Agent Workspace -> Work -> Update work item status',
      modelRoute: 'agent_work_plan action:"set_status" id:"..." status:"..."',
      tags: ['work-plan', 'task-write'],
      effect: 'confirmed-effect',
      capability: 'task-write',
      requiredFields: ['id', 'status'],
      confirmationRequired: false,
    },
  ];
  if (hasMethod(methodIds, 'tasks.list')) {
    records.push({
      id: 'host-tasks-list',
      label: 'List connected-host tasks',
      status: 'ready',
      summary: 'Inspect connected-host task state without creating, retrying, or mutating host tasks.',
      userRoute: 'Agent Workspace -> Work -> Host tasks',
      modelRoute: 'agent_harness mode:"workspace_action" actionId:"tasks-list"',
      tags: ['host-task', 'task-read'],
      effect: 'read-only',
      capability: 'host-task-read',
    });
  }
  if (hasMethod(methodIds, 'tasks.get') || hasMethod(methodIds, 'tasks.status')) {
    records.push({
      id: 'host-task-inspect',
      label: 'Inspect connected-host task',
      status: 'ready',
      summary: 'Inspect one exact connected-host task id and output before considering controls.',
      userRoute: 'Agent Workspace -> Work -> Inspect host task',
      modelRoute: 'agent_harness mode:"workspace_action" actionId:"task-show"',
      tags: ['host-task', 'task-read'],
      effect: 'read-only',
      capability: 'host-task-read',
      requiredFields: ['taskId'],
    });
  }
  if (hasMethod(methodIds, 'tasks.cancel')) {
    records.push({
      id: 'host-task-cancel',
      label: 'Cancel connected-host task',
      status: 'ready',
      summary: 'Cancel one exact connected-host task id only when the user authorizes it.',
      userRoute: 'Agent Workspace -> Work -> Host task controls',
      modelRoute: 'agent_operator_method methodId:"tasks.cancel" input:{"taskId":"..."} confirm:true explicitUserRequest:"..."',
      tags: ['host-task', 'task-write'],
      effect: 'confirmed-effect',
      capability: 'host-task-control',
      requiredFields: ['taskId'],
      confirmationRequired: true,
    });
  }
  if (hasMethod(methodIds, 'tasks.retry')) {
    records.push({
      id: 'host-task-retry',
      label: 'Retry connected-host task',
      status: 'ready',
      summary: 'Retry one failed or cancelled connected-host task id only after inspection.',
      userRoute: 'Agent Workspace -> Work -> Host task controls',
      modelRoute: 'agent_operator_method methodId:"tasks.retry" input:{"taskId":"..."} confirm:true explicitUserRequest:"..."',
      tags: ['host-task', 'task-write'],
      effect: 'confirmed-effect',
      capability: 'host-task-control',
      requiredFields: ['taskId'],
      confirmationRequired: true,
    });
  }
  return records;
}

function reminderOperationRecords(methodIds: readonly string[], deliveryConfigured: boolean): readonly PersonalOpsLiveRecord[] {
  const records: PersonalOpsLiveRecord[] = [
    {
      id: 'reminder-create',
      label: 'Create confirmed reminder',
      status: hasMethod(methodIds, 'schedules.create') ? deliveryConfigured ? 'ready' : 'attention' : 'needs-setup',
      summary: deliveryConfigured
        ? 'Create one connected reminder schedule with real timing and a visible delivery path.'
        : 'Create one reminder only after confirming timing and delivery scope; no configured delivery target was detected.',
      userRoute: 'Agent Workspace -> Personal Ops -> Create reminder',
      modelRoute: 'schedule action:"remind" message:"..." scheduleKind:"..." scheduleValue:"..." confirm:true explicitUserRequest:"..."',
      tags: ['reminder', 'schedule-write'],
      effect: 'confirmed-effect',
      capability: 'reminder-create',
      requiredFields: ['title', 'scheduleKind', 'scheduleValue'],
      optionalFields: ['deliveryTargetId', 'timezone', 'message'],
      confirmationRequired: true,
    },
    {
      id: 'autonomous-schedule-create',
      label: 'Create autonomous schedule',
      status: hasMethod(methodIds, 'schedules.create') ? 'ready' : 'needs-setup',
      summary: 'Create one visible autonomous schedule only when task, cadence, success criteria, and user request provenance are explicit.',
      userRoute: 'Agent Workspace -> Automation -> Create schedule',
      modelRoute: 'schedule action:"create" task:"..." successCriteria:"..." scheduleKind:"..." scheduleValue:"..." confirm:true explicitUserRequest:"..."',
      tags: ['autonomy', 'schedule-write'],
      effect: 'confirmed-effect',
      capability: 'schedule-create',
      requiredFields: ['task', 'successCriteria', 'scheduleKind', 'scheduleValue'],
      confirmationRequired: true,
    },
  ];
  if (hasMethod(methodIds, 'schedules.list')) {
    records.push({
      id: 'schedule-list',
      label: 'List connected schedules',
      status: 'ready',
      summary: 'Inspect configured schedules and history before running or mutating one.',
      userRoute: 'Agent Workspace -> Automation -> Schedules',
      modelRoute: 'agent_harness mode:"workspace_action" actionId:"schedule-list"',
      tags: ['schedule', 'schedule-read'],
      effect: 'read-only',
      capability: 'schedule-read',
    });
    records.push({
      id: 'schedule-edit',
      label: 'Edit connected schedule',
      status: 'ready',
      summary: 'Preview and edit one exact connected schedule id with before/after diff context.',
      userRoute: 'Agent Workspace -> Automation -> Edit schedule',
      modelRoute: 'schedule action:"edit" scheduleId:"..." confirm:true explicitUserRequest:"..."',
      tags: ['schedule', 'schedule-write'],
      effect: 'confirmed-effect',
      capability: 'schedule-control',
      requiredFields: ['scheduleId'],
      optionalFields: ['name', 'scheduleKind', 'scheduleValue', 'prompt'],
      confirmationRequired: true,
    });
  }
  if (hasMethod(methodIds, 'schedules.run')) {
    records.push({
      id: 'schedule-run-now',
      label: 'Run schedule now',
      status: 'ready',
      summary: 'Run one exact connected schedule id now after the user confirms.',
      userRoute: 'Agent Workspace -> Automation -> Run job now',
      modelRoute: 'schedule action:"run" scheduleId:"..." confirm:true explicitUserRequest:"..."',
      tags: ['schedule', 'schedule-write'],
      effect: 'confirmed-effect',
      capability: 'schedule-control',
      requiredFields: ['scheduleId'],
      confirmationRequired: true,
    });
  }
  if (hasMethod(methodIds, 'schedules.disable')) {
    records.push({
      id: 'schedule-pause',
      label: 'Pause connected schedule',
      status: 'ready',
      summary: 'Disable one exact connected schedule id after reviewing current state.',
      userRoute: 'Agent Workspace -> Automation -> Schedule controls',
      modelRoute: 'schedule action:"pause" scheduleId:"..." confirm:true explicitUserRequest:"..."',
      tags: ['schedule', 'schedule-write'],
      effect: 'confirmed-effect',
      capability: 'schedule-control',
      requiredFields: ['scheduleId'],
      confirmationRequired: true,
    });
  }
  if (hasMethod(methodIds, 'schedules.enable')) {
    records.push({
      id: 'schedule-resume',
      label: 'Resume connected schedule',
      status: 'ready',
      summary: 'Enable one exact connected schedule id after reviewing current state.',
      userRoute: 'Agent Workspace -> Automation -> Schedule controls',
      modelRoute: 'schedule action:"resume" scheduleId:"..." confirm:true explicitUserRequest:"..."',
      tags: ['schedule', 'schedule-write'],
      effect: 'confirmed-effect',
      capability: 'schedule-control',
      requiredFields: ['scheduleId'],
      confirmationRequired: true,
    });
  }
  if (hasMethod(methodIds, 'schedules.delete')) {
    records.push({
      id: 'schedule-delete',
      label: 'Delete connected schedule',
      status: 'ready',
      summary: 'Delete one exact connected schedule id only after explicit user confirmation.',
      userRoute: 'Agent Workspace -> Automation -> Schedule controls',
      modelRoute: 'schedule action:"delete" scheduleId:"..." confirm:true explicitUserRequest:"..."',
      tags: ['schedule', 'schedule-write'],
      effect: 'confirmed-effect',
      capability: 'schedule-control',
      requiredFields: ['scheduleId'],
      confirmationRequired: true,
    });
  }
  return records;
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
  const inboxArtifactRecords = savedReviewArtifactRecords(context, 'inbox', emailConnectors);
  const calendarArtifactRecords = savedReviewArtifactRecords(context, 'calendar', calendarConnectors);
  const inboxReviewQueueRecords = savedReviewQueueRecords(context, 'inbox', emailConnectors);
  const calendarReviewQueueRecords = savedReviewQueueRecords(context, 'calendar', calendarConnectors);
  const refreshableInboxQueueRecords = refreshableSavedRecordCount(inboxReviewQueueRecords);
  const refreshableCalendarQueueRecords = refreshableSavedRecordCount(calendarReviewQueueRecords);
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
      status: emailMethods.length > 0 || emailConnectors.length > 0 || inboxArtifactRecords.length > 0 ? 'partial' : 'gap',
      outcome: 'Triage inbound email or message inboxes, summarize threads, draft replies, and send only after confirmation.',
      current: emailMethods.length > 0
        ? 'The daemon contract exposes email-like methods; Personal Ops workflow cards now guide inbox triage and draft boundaries around exact methods.'
        : emailConnectors.length > 0
          ? 'A configured MCP connector looks email-capable; Personal Ops workflow cards now guide inbox triage, schema-derived operation records, and draft boundaries around its exact tools.'
          : inboxArtifactRecords.length > 0
            ? 'Saved inbox review artifacts and thread queue items are available for recap, local draft review, or promotion; no fresh email connector is currently ready.'
        : 'No email/IMAP/SMTP methods are present in the current GoodVibes SDK operator contract.',
      next: emailMethods.length > 0
        ? 'Use the inbox workflow cards to inspect exact methods, read selected threads, summarize priorities, and keep send as a separate confirmation.'
        : emailConnectors.length > 0
          ? 'Use the inbox workflow cards and operation records to inspect matching MCP connector schemas, then route triage only through reviewed connector actions.'
          : inboxArtifactRecords.length > 0
            ? 'Use saved thread queue records for local draft review or recap, then repair an email connector before reading fresh inbox data or sending.'
        : 'Install or build an email connector/MCP/plugin, then expose triage and draft-reply actions here.',
      userRoute: 'Agent Workspace -> Personal Ops -> Channels or connector setup',
      modelRoute: emailConnectors.length > 0 ? 'agent_harness mode:"mcp_servers" query:"email"' : 'agent_harness mode:"operator_methods" query:"email"',
      signals: [
        `${emailMethods.length} email-like daemon method(s)`,
        `${emailConnectors.length} email-like MCP connector(s)`,
        `${inboxArtifactRecords.length} saved inbox review artifact(s)`,
        `${inboxReviewQueueRecords.length} saved inbox thread queue item(s)`,
        `${refreshableInboxQueueRecords} refreshable saved inbox queue item(s)`,
        `${readyChannels}/${snapshot.channels.length} channel(s) ready for delivery`,
      ],
      methodIds: emailMethods,
      connectorSignals: emailConnectors,
      workflows: inboxWorkflows(emailMethods, emailConnectors),
      liveRecords: [
        ...inboxReviewQueueRecords,
        ...inboxArtifactRecords,
        ...connectorRecords(emailConnectors, 'Inbox', 'inbox'),
      ],
    },
    {
      id: 'calendar',
      label: 'Calendar',
      status: calendarMethods.length > 0 || calendarConnectors.length > 0 || calendarArtifactRecords.length > 0 ? 'partial' : 'gap',
      outcome: 'Read agenda context, identify conflicts, prepare briefings, and create reminders for calendar-driven work.',
      current: calendarMethods.length > 0
        ? 'The daemon contract exposes calendar-like methods; Personal Ops workflow cards now guide agenda briefing and conflict-scan boundaries.'
        : calendarConnectors.length > 0
          ? 'A configured MCP connector looks calendar-capable; Personal Ops workflow cards now guide agenda briefing, schema-derived operation records, and conflict-scan boundaries around its exact tools.'
          : calendarArtifactRecords.length > 0
            ? 'Saved calendar review artifacts and event queue items are available for agenda recap, reminder creation, or follow-up planning; no fresh calendar connector is currently ready.'
        : 'No calendar/CalDAV/agenda methods are present in the current GoodVibes SDK operator contract.',
      next: calendarMethods.length > 0
        ? 'Use the calendar workflow cards to inspect exact methods, fetch a bounded agenda window, and propose reminders or follow-ups.'
        : calendarConnectors.length > 0
          ? 'Use the calendar workflow cards and operation records to inspect matching MCP connector schemas, then route agenda work only through reviewed connector actions.'
          : calendarArtifactRecords.length > 0
            ? 'Use saved event queue records for recap or reminder creation, then repair a calendar connector before reading fresh agenda data or editing events.'
        : 'Add a CalDAV/calendar connector and route agenda briefing, conflicts, and reminders through this lane.',
      userRoute: 'Agent Workspace -> Personal Ops -> Create reminder',
      modelRoute: calendarConnectors.length > 0 ? 'agent_harness mode:"mcp_servers" query:"calendar"' : 'agent_harness mode:"operator_methods" query:"calendar"',
      signals: [
        `${calendarMethods.length} calendar-like daemon method(s)`,
        `${calendarConnectors.length} calendar-like MCP connector(s)`,
        `${calendarArtifactRecords.length} saved calendar review artifact(s)`,
        `${calendarReviewQueueRecords.length} saved calendar event queue item(s)`,
        `${refreshableCalendarQueueRecords} refreshable saved calendar queue item(s)`,
        `${scheduleMethods.length} schedule/reminder method(s) available for follow-up`,
      ],
      methodIds: calendarMethods,
      connectorSignals: calendarConnectors,
      workflows: calendarWorkflows(calendarMethods, calendarConnectors),
      liveRecords: [
        ...calendarReviewQueueRecords,
        ...calendarArtifactRecords,
        ...connectorRecords(calendarConnectors, 'Calendar', 'calendar'),
      ],
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
      modelRoute: 'agent_work_plan action:"create"',
      signals: [
        `${taskMethods.length} task/work-plan daemon method(s)`,
        'Work plan add/show/status/delete actions are available',
      ],
      methodIds: taskMethods,
      workflows: taskWorkflows(taskMethods),
      liveRecords: taskOperationRecords(taskMethods),
    },
    {
      id: 'reminders',
      label: 'Reminders',
      status: scheduleMethods.length > 0 ? 'ready' : 'partial',
      outcome: 'Turn a user request into a visible reminder or autonomous schedule with delivery target and cancellation path.',
      current: `Reminder and autonomous schedule creation are available through Agent tools; ${scheduleMethods.length} schedule/reminder daemon method(s) are discoverable.`,
      next: 'Create one confirmed reminder or autonomous schedule with title, time, scope, delivery target, success criteria, and explicit user request.',
      userRoute: 'Agent Workspace -> Personal Ops -> Create reminder',
      modelRoute: 'schedule action:"remind|create"',
      signals: [
        `${scheduleMethods.length} schedule/reminder daemon method(s)`,
        `${configuredTargets} configured delivery target(s)`,
      ],
      methodIds: scheduleMethods,
      workflows: reminderWorkflows(scheduleMethods, configuredTargets > 0 || readyChannels > 0),
      liveRecords: reminderOperationRecords(scheduleMethods, configuredTargets > 0 || readyChannels > 0),
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

function laneById(lanes: readonly PersonalOpsLane[], laneId: PersonalOpsLaneId): PersonalOpsLane {
  return lanes.find((lane) => lane.id === laneId)!;
}

function workflowById(lane: PersonalOpsLane, workflowId: string): PersonalOpsWorkflow | null {
  return lane.workflows?.find((workflow) => workflow.id === workflowId) ?? null;
}

function liveRecordById(lane: PersonalOpsLane, recordId: string): PersonalOpsLiveRecord | null {
  return lane.liveRecords?.find((record) => record.id === recordId) ?? null;
}

function liveRecordSearchText(record: PersonalOpsLiveRecord): string {
  return [
    record.id,
    record.label,
    record.status,
    record.summary,
    record.modelRoute,
    record.qualifiedName ?? '',
    record.capability ?? '',
    record.artifactId ?? '',
    record.reviewLabels?.join('\n') ?? '',
    record.sourceTool ?? '',
    record.followUpRoutes?.map((route) => `${route.id} ${route.label} ${route.effect} ${route.modelRoute} ${route.policy}`).join('\n') ?? '',
    record.tags?.join('\n') ?? '',
  ].join('\n').toLowerCase();
}

function workflowMissingFields(lane: PersonalOpsLane, workflow: PersonalOpsWorkflow, operation?: PersonalOpsConnectorTool): readonly string[] | undefined {
  if (workflow.status === 'needs-setup') return [`configured ${lane.id === 'inbox' ? 'email' : lane.id} connector or daemon method`];
  if (workflow.status === 'attention') return ['connector trust/schema freshness'];
  if (operation?.requiredFields && operation.requiredFields.length > 0) return operation.requiredFields;
  return undefined;
}

function operationSummary(
  tool: PersonalOpsConnectorTool | undefined,
  signal: PersonalOpsConnectorSignal | undefined,
  includeParameters: boolean,
): Record<string, unknown> | undefined {
  if (!tool) return undefined;
  return {
    name: tool.name,
    effect: tool.effect,
    capability: tool.capability,
    ...(tool.qualifiedName ? { qualifiedName: tool.qualifiedName } : {}),
    ...(signal ? { connectorId: signal.id, connectorStatus: signal.status } : {}),
    ...(tool.schemaRoute ? { schemaRoute: tool.schemaRoute } : {}),
    ...(includeParameters && tool.requiredFields ? { requiredFields: tool.requiredFields } : {}),
    ...(includeParameters && tool.optionalFields ? { optionalFields: tool.optionalFields.slice(0, 12) } : {}),
    ...(includeParameters && tool.sampleInput ? { sampleInput: tool.sampleInput } : {}),
    ...(tool.effect === 'confirmed-effect' ? { confirmationRequired: true } : { confirmationRequired: false }),
  };
}

function toolModelRoute(tool: PersonalOpsConnectorTool | undefined): string {
  if (!tool) return 'agent_harness mode:"personal_ops"';
  return tool.schemaRoute ?? `agent_harness mode:"mcp_servers" query:"${tool.qualifiedName ?? tool.name}"`;
}

function connectorStep(options: {
  readonly id: string;
  readonly label: string;
  readonly routeKind: PersonalOpsExecutionStep['routeKind'];
  readonly status: PersonalOpsWorkflowStatus;
  readonly tool: PersonalOpsConnectorTool;
  readonly signal?: PersonalOpsConnectorSignal;
  readonly includeParameters: boolean;
  readonly policy: string;
}): PersonalOpsExecutionStep {
  return {
    id: options.id,
    label: options.label,
    routeKind: options.routeKind,
    effect: options.tool.effect,
    requiresConfirmation: options.tool.effect === 'confirmed-effect',
    modelRoute: toolModelRoute(options.tool),
    status: options.status,
    policy: options.policy,
    ...(options.signal ? { connectorId: options.signal.id, connectorStatus: options.signal.status } : {}),
    ...(options.tool.qualifiedName ? { qualifiedName: options.tool.qualifiedName } : {}),
    ...(options.tool.schemaRoute ? { schemaRoute: options.tool.schemaRoute } : {}),
    ...(options.includeParameters && options.tool.requiredFields ? { requiredFields: options.tool.requiredFields } : {}),
    ...(options.includeParameters && options.tool.sampleInput ? { sampleInput: options.tool.sampleInput } : {}),
  };
}

function workflowExecutionPlan(options: {
  readonly lane: PersonalOpsLane;
  readonly workflow: PersonalOpsWorkflow;
  readonly operation?: { readonly signal: PersonalOpsConnectorSignal; readonly tool: PersonalOpsConnectorTool };
  readonly followUpOperation?: { readonly signal: PersonalOpsConnectorSignal; readonly tool: PersonalOpsConnectorTool };
  readonly includeParameters: boolean;
  readonly readOnlyNext: string;
  readonly mutationBoundary: string;
}): readonly PersonalOpsExecutionStep[] {
  if (options.workflow.status === 'needs-setup') {
    return [{
      id: 'setup-connector',
      label: `Set up a ${options.lane.id === 'inbox' ? 'mail' : options.lane.id} connector`,
      routeKind: 'setup',
      effect: 'setup',
      requiresConfirmation: false,
      modelRoute: options.workflow.modelRoute,
      status: 'needs-setup',
      policy: 'Do not read personal data or create effects until a connector or daemon method is configured and reviewed.',
    }];
  }
  if (options.workflow.status === 'attention') {
    return [{
      id: 'repair-connector-readiness',
      label: 'Repair connector trust or schema freshness',
      routeKind: 'setup',
      effect: 'setup',
      requiresConfirmation: false,
      modelRoute: options.operation?.signal.modelRoute ?? options.workflow.modelRoute,
      status: 'attention',
      policy: 'Review connector trust, connection, and schema freshness before using live personal data.',
    }];
  }

  const steps: PersonalOpsExecutionStep[] = [];
  if (options.operation) {
    steps.push(connectorStep({
      id: 'read-live-context',
      label: options.readOnlyNext,
      routeKind: 'connector-read',
      status: options.workflow.status,
      tool: options.operation.tool,
      signal: options.operation.signal,
      includeParameters: options.includeParameters,
      policy: 'Run only the selected bounded read route, then summarize or draft in the Agent transcript without mutating the provider.',
    }));
  } else {
    steps.push({
      id: 'inspect-read-route',
      label: 'Inspect the exact read route before using live personal data.',
      routeKind: 'setup',
      effect: 'setup',
      requiresConfirmation: false,
      modelRoute: options.workflow.modelRoute,
      status: options.workflow.status,
      policy: 'No concrete connector tool is selected yet; inspect the lane before using personal data.',
    });
  }

  steps.push({
    id: 'compose-local-result',
    label: options.lane.id === 'calendar' ? 'Summarize agenda or conflict findings locally.' : 'Summarize or draft locally without sending.',
    routeKind: 'local-compose',
    effect: 'local-only',
    requiresConfirmation: false,
    modelRoute: 'main Agent response',
    status: options.workflow.status,
    policy: 'Local composition does not send, edit, archive, label, or write provider records.',
  });

  if (options.followUpOperation) {
    steps.push(connectorStep({
      id: 'confirmed-follow-up-effect',
      label: options.mutationBoundary,
      routeKind: 'connector-confirmed-effect',
      status: options.workflow.status,
      tool: options.followUpOperation.tool,
      signal: options.followUpOperation.signal,
      includeParameters: options.includeParameters,
      policy: 'Only run this follow-up after the user reviews the draft/change and explicitly confirms the exact provider effect.',
    }));
  }
  return steps;
}

function recordOperationSummary(record: PersonalOpsLiveRecord | null, includeParameters: boolean): Record<string, unknown> | undefined {
  if (!record) return undefined;
  return {
    id: record.id,
    label: record.label,
    status: record.status,
    modelRoute: record.modelRoute,
    effect: record.effect ?? 'read-only',
    capability: record.capability,
    ...(includeParameters && record.requiredFields ? { requiredFields: record.requiredFields } : {}),
    ...(includeParameters && record.optionalFields ? { optionalFields: record.optionalFields.slice(0, 12) } : {}),
    ...(includeParameters && record.sampleInput ? { sampleInput: record.sampleInput } : {}),
    confirmationRequired: record.confirmationRequired === true,
  };
}

function redactedPersonalOpsText(value: string): string {
  return value
    .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTHORIZATION|BEARER)[A-Z0-9_]*)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1=<redacted>')
    .replace(/(\b(?:api[-_]?key|token|secret|password|passwd|authorization|credential)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1<redacted>')
    .replace(/\b(xox[baprs]-[A-Za-z0-9-]{8,})\b/g, '<redacted-token>');
}

function stringifyForPreview(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function boundedPersonalOpsResult(value: unknown, includeParameters: boolean): Record<string, unknown> {
  const text = redactedPersonalOpsText(stringifyForPreview(value));
  const max = includeParameters ? 6000 : 1600;
  return {
    format: typeof value,
    characters: text.length,
    truncated: text.length > max,
    preview: text.length <= max ? text : `${text.slice(0, max).trimEnd()}...`,
    redaction: 'Secret-looking tokens, API keys, credentials, passwords, and bearer values are redacted before model display.',
  };
}

function recordObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function lowerKeyEntries(record: Record<string, unknown>): readonly [string, unknown][] {
  return Object.entries(record).map(([key, value]) => [key.toLowerCase(), value] as [string, unknown]);
}

function stringField(record: Record<string, unknown>, names: readonly string[]): string {
  const lowered = lowerKeyEntries(record);
  for (const name of names) {
    const exact = lowered.find(([key]) => key === name);
    const value = exact?.[1];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  for (const name of names) {
    const fuzzy = lowered.find(([key]) => key.includes(name));
    const value = fuzzy?.[1];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function candidateResultItems(value: unknown, depth = 0): readonly unknown[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) return value;
  const object = recordObject(value);
  if (!object) return [];
  for (const key of ['messages', 'threads', 'emails', 'mail', 'events', 'items', 'results', 'data']) {
    const entry = object[key];
    if (Array.isArray(entry)) return entry;
    const nested = candidateResultItems(entry, depth + 1);
    if (nested.length > 0) return nested;
  }
  for (const key of ['structuredContent', 'structured_content', 'result', 'payload', 'output']) {
    const nested = candidateResultItems(object[key], depth + 1);
    if (nested.length > 0) return nested;
  }
  return [];
}

function reviewCardFromObject(
  lane: PersonalOpsLane,
  sourceRecord: PersonalOpsLiveRecord,
  item: Record<string, unknown>,
  index: number,
  includeParameters: boolean,
): Record<string, unknown> {
  const calendar = lane.id === 'calendar';
  const id = stringField(item, calendar ? ['id', 'eventid', 'uid'] : ['id', 'messageid', 'threadid', 'emailid']) || `${sourceRecord.id}:item-${index + 1}`;
  const subject = stringField(item, calendar
    ? ['summary', 'title', 'subject', 'name']
    : ['subject', 'title', 'summary']);
  const actor = stringField(item, calendar
    ? ['calendar', 'organizer', 'attendee', 'location']
    : ['from', 'sender', 'author']);
  const time = stringField(item, calendar
    ? ['start', 'starttime', 'time', 'when', 'date']
    : ['date', 'receivedat', 'timestamp', 'time']);
  const body = stringField(item, calendar
    ? ['description', 'notes', 'body', 'snippet']
    : ['snippet', 'preview', 'body', 'text', 'content']);
  const label = subject || actor || `${calendar ? 'Calendar event' : 'Inbox item'} ${index + 1}`;
  const summaryParts = [
    actor ? `${calendar ? 'source' : 'from'} ${actor}` : '',
    time ? `time ${time}` : '',
    body,
  ].filter(Boolean);
  const summary = redactedPersonalOpsText(summaryParts.join('; ') || stringifyForPreview(item));
  return {
    id,
    kind: calendar ? 'calendar-event' : 'inbox-message',
    label: previewHarnessText(redactedPersonalOpsText(label), includeParameters ? 160 : 96),
    summary: previewHarnessText(summary, includeParameters ? 420 : 180),
    sourceRecordId: sourceRecord.id,
    sourceTool: sourceRecord.qualifiedName,
    confidence: 'normalized',
    followUpBoundary: calendar
      ? 'Calendar create, edit, delete, RSVP, and reschedule actions require a separate confirmed route.'
      : 'Reply, send, label, archive, move, and delete actions require a separate confirmed route.',
    ...(includeParameters ? { rawKeys: Object.keys(item).slice(0, 16) } : {}),
  };
}

function personalOpsReadReviewRecords(
  lane: PersonalOpsLane,
  sourceRecord: PersonalOpsLiveRecord,
  result: unknown,
  includeParameters: boolean,
): readonly Record<string, unknown>[] {
  const items = candidateResultItems(result);
  const objectCards = items
    .map((item, index) => {
      const object = recordObject(item);
      if (!object) return null;
      return reviewCardFromObject(lane, sourceRecord, object, index, includeParameters);
    })
    .filter((item): item is Record<string, unknown> => item !== null)
    .slice(0, 8);
  if (objectCards.length > 0) return objectCards;
  const preview = boundedPersonalOpsResult(result, includeParameters).preview;
  return [{
    id: `${sourceRecord.id}:raw-preview`,
    kind: lane.id === 'calendar' ? 'calendar-read-preview' : 'inbox-read-preview',
    label: `${lane.label} read output preview`,
    summary: previewHarnessText(String(preview), includeParameters ? 420 : 180),
    sourceRecordId: sourceRecord.id,
    sourceTool: sourceRecord.qualifiedName,
    confidence: 'raw-preview',
    followUpBoundary: 'Use this preview to summarize locally; any provider mutation requires a separate confirmed route.',
  }];
}

function reviewRecordFieldValues(records: readonly Record<string, unknown>[], names: readonly string[], limit: number): readonly string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const value = previewHarnessText(redactedPersonalOpsText(stringField(record, names)), 120);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    values.push(value);
    if (values.length >= limit) break;
  }
  return values;
}

async function savePersonalOpsReviewArtifact(options: {
  readonly context: CommandContext;
  readonly lane: PersonalOpsLane;
  readonly sourceRecord: PersonalOpsLiveRecord;
  readonly inputFields: Readonly<Record<string, unknown>>;
  readonly reviewRecords: readonly Record<string, unknown>[];
  readonly output: Record<string, unknown>;
  readonly title?: string;
}): Promise<Record<string, unknown>> {
  const store = options.context.platform.artifactStore;
  if (!store?.create) {
    return {
      status: 'unavailable',
      reason: 'artifact_store_unavailable',
      policy: 'Review-card persistence requires the Agent artifact store; raw connector output was not written.',
    };
  }
  const createdAt = new Date().toISOString();
  const safeTitle = previewHarnessText(options.title || `${options.lane.label} review cards`, 96)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'personal-ops-review';
  const reviewLabels = reviewRecordFieldValues(options.reviewRecords, ['label', 'subject', 'title', 'summary'], 5);
  const reviewKinds = reviewRecordFieldValues(options.reviewRecords, ['kind'], 5);
  const reviewRecordIds = reviewRecordFieldValues(options.reviewRecords, ['id'], 8);
  const payload = {
    version: 1,
    createdAt,
    laneId: options.lane.id,
    sourceRecordId: options.sourceRecord.id,
    sourceTool: options.sourceRecord.qualifiedName,
    reviewRecords: options.reviewRecords,
    outputPreview: options.output.preview,
    outputTruncated: options.output.truncated,
    inputFieldKeys: Object.keys(options.inputFields).sort((left, right) => left.localeCompare(right)),
    policy: 'Saved Personal Ops review-card artifacts contain redacted review cards and bounded previews only; full raw connector output and full input values are not stored.',
  };
  const descriptor = await store.create({
    kind: 'data',
    mimeType: 'application/json',
    filename: `${safeTitle}-${Date.now()}.json`,
    text: `${redactedPersonalOpsText(JSON.stringify(payload, null, 2))}\n`,
    acquisitionMode: 'inline-data',
    fetchMode: 'not-applicable',
    metadata: {
      purpose: 'personal-ops-review-cards',
      laneId: options.lane.id,
      sourceRecordId: options.sourceRecord.id,
      sourceTool: options.sourceRecord.qualifiedName ?? '',
      reviewRecordCount: options.reviewRecords.length,
      reviewLabels,
      reviewKinds,
      reviewRecordIds,
      fullRawConnectorOutputStored: false,
    },
  });
  return {
    status: 'saved',
    artifactId: descriptor.id,
    filename: descriptor.filename ?? null,
    mimeType: descriptor.mimeType,
    sizeBytes: descriptor.sizeBytes,
    modelRoute: `agent_artifacts show artifactId:"${descriptor.id}"`,
    policy: 'Artifact contains redacted review cards for later user review; provider mutations still require separate confirmation.',
  };
}

function fieldInputValue(value: string, sample: unknown): unknown {
  if (typeof sample === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (typeof sample === 'boolean') return /^(1|true|yes|y)$/i.test(value.trim());
  if (Array.isArray(sample)) return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return value;
}

function readInputFields(value: unknown, sampleInput?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const fields: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PERSONAL_OPS_READ_CONTROL_FIELDS.has(key)) continue;
    if (entry === undefined || entry === null) continue;
    const text = typeof entry === 'string' ? entry.trim() : String(entry).trim();
    if (!text) continue;
    fields[key] = fieldInputValue(text, sampleInput?.[key]);
  }
  return fields;
}

function readRunControlString(fields: unknown, key: string): string {
  const object = recordObject(fields);
  const value = object?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readRunControlBoolean(fields: unknown, keys: readonly string[]): boolean {
  const object = recordObject(fields);
  if (!object) return false;
  return keys.some((key) => {
    const value = object[key];
    if (value === true) return true;
    if (typeof value !== 'string') return false;
    return /^(1|true|yes|y|on)$/i.test(value.trim());
  });
}

function missingRequiredInputFields(record: PersonalOpsLiveRecord, fields: Readonly<Record<string, unknown>>): readonly string[] {
  return (record.requiredFields ?? []).filter((field) => !(field in fields) || fields[field] === '');
}

function executionRouteForRecord(record: PersonalOpsLiveRecord, laneId: PersonalOpsLaneId): string {
  return personalOpsReadRunRoute(laneId, record.id);
}

function summarizeRunRecord(record: PersonalOpsLiveRecord, lane: PersonalOpsLane, includeParameters: boolean): Record<string, unknown> {
  return {
    laneId: lane.id,
    recordId: record.id,
    label: record.label,
    status: record.status,
    effect: record.effect ?? 'read-only',
    capability: record.capability,
    modelRoute: record.modelRoute,
    ...(record.qualifiedName ? { qualifiedName: record.qualifiedName } : {}),
    ...(includeParameters && record.requiredFields ? { requiredFields: record.requiredFields } : {}),
    ...(includeParameters && record.optionalFields ? { optionalFields: record.optionalFields.slice(0, 12) } : {}),
    ...(includeParameters && record.sampleInput ? { sampleInput: record.sampleInput } : {}),
  };
}

function resolveRunRecord(
  lanes: readonly PersonalOpsLane[],
  options: { readonly laneId: string; readonly recordId: string; readonly target: string; readonly query: string },
): { readonly lane: PersonalOpsLane; readonly record: PersonalOpsLiveRecord } | null | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] } {
  const scopedLanes = options.laneId ? lanes.filter((lane) => lane.id === options.laneId) : lanes;
  const lookup = options.recordId || options.target || options.query;
  if (!lookup) return null;
  const normalized = lookup.toLowerCase();
  const exact = scopedLanes.flatMap((lane) => (lane.liveRecords ?? [])
    .filter((record) => record.id === lookup || record.qualifiedName === lookup)
    .map((record) => ({ lane, record })));
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup,
      candidates: exact.map(({ lane, record }) => summarizeRunRecord(record, lane, false)),
    };
  }
  const matches = scopedLanes.flatMap((lane) => (lane.liveRecords ?? [])
    .filter((record) => liveRecordSearchText(record).includes(normalized))
    .map((record) => ({ lane, record })));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup,
      candidates: matches.slice(0, 8).map(({ lane, record }) => summarizeRunRecord(record, lane, false)),
    };
  }
  return null;
}

function toolPreferenceScore(tool: PersonalOpsConnectorTool, preferredTokens: readonly string[]): number {
  const text = [tool.name, tool.description ?? '', tool.capability].join('\n').toLowerCase();
  const preferred = preferredTokens.findIndex((token) => text.includes(token));
  const preferredScore = preferred >= 0 ? 1_000 - preferred * 50 : 0;
  const schemaScore = tool.schemaRoute ? 100 : 0;
  const requiredFieldPenalty = (tool.requiredFields?.length ?? 0) * 5;
  return preferredScore + schemaScore - requiredFieldPenalty;
}

function selectConnectorTool(
  lane: PersonalOpsLane,
  effect: PersonalOpsConnectorTool['effect'],
  capability: string,
  preferredTokens: readonly string[],
): { readonly signal: PersonalOpsConnectorSignal; readonly tool: PersonalOpsConnectorTool } | undefined {
  const candidates = (lane.connectorSignals ?? []).flatMap((signal) => {
    const tools = effect === 'read-only' ? signal.readTools ?? [] : signal.writeTools ?? [];
    return tools
      .filter((tool) => tool.capability === capability)
      .map((tool) => ({ signal, tool }));
  });
  return candidates
    .sort((left, right) => {
      const statusDelta = (right.signal.status === 'ready' ? 1 : 0) - (left.signal.status === 'ready' ? 1 : 0);
      if (statusDelta !== 0) return statusDelta;
      return toolPreferenceScore(right.tool, preferredTokens) - toolPreferenceScore(left.tool, preferredTokens)
        || left.tool.name.localeCompare(right.tool.name);
    })[0];
}

function workflowCandidate(options: {
  readonly lane: PersonalOpsLane;
  readonly workflowId: string;
  readonly id: string;
  readonly label: string;
  readonly confidence: PersonalOpsIntakeCandidate['confidence'];
  readonly why: string;
  readonly operation?: { readonly signal: PersonalOpsConnectorSignal; readonly tool: PersonalOpsConnectorTool };
  readonly followUpOperation?: { readonly signal: PersonalOpsConnectorSignal; readonly tool: PersonalOpsConnectorTool };
  readonly includeParameters: boolean;
  readonly readOnlyNext: string;
  readonly mutationBoundary: string;
}): PersonalOpsIntakeCandidate | null {
  const workflow = workflowById(options.lane, options.workflowId);
  if (!workflow) return null;
  const operation = options.operation?.tool;
  const modelRoute = operation?.schemaRoute ?? workflow.modelRoute;
  const inspectRoutes = [
    ...(operation?.schemaRoute ? [operation.schemaRoute] : []),
    ...workflow.inspectRoutes,
  ];
  const missingFields = workflowMissingFields(options.lane, workflow, operation);
  const nextSteps = workflow.status === 'ready'
    ? [
      `Inspect ${operation?.schemaRoute ? 'the selected connector schema' : 'the exact route'} before using live personal data.`,
      options.readOnlyNext,
      options.mutationBoundary,
    ]
    : workflow.status === 'attention'
      ? [
        'Repair connector trust, connection, or schema freshness before using live personal data.',
        'Re-run this intake request after the connector reports ready.',
      ]
      : [
        `Set up a ${options.lane.id === 'inbox' ? 'mail' : options.lane.id} connector or daemon method first.`,
        'Re-run this intake request after setup so the route can bind to a concrete tool.',
      ];
  return {
    id: options.id,
    label: options.label,
    laneId: options.lane.id,
    workflowId: workflow.id,
    status: workflow.status,
    confidence: options.confidence,
    why: options.why,
    modelRoute,
    inspectRoutes: [...new Set(inspectRoutes)],
    requiresConfirmation: false,
    safetyBoundary: workflow.runBoundary,
    nextSteps,
    ...(operation ? { operation: operationSummary(operation, options.operation?.signal, options.includeParameters) } : {}),
    ...(options.followUpOperation ? { followUpOperation: operationSummary(options.followUpOperation.tool, options.followUpOperation.signal, options.includeParameters) } : {}),
    executionPlan: workflowExecutionPlan({
      lane: options.lane,
      workflow,
      operation: options.operation,
      followUpOperation: options.followUpOperation,
      includeParameters: options.includeParameters,
      readOnlyNext: options.readOnlyNext,
      mutationBoundary: options.mutationBoundary,
    }),
    ...(operation?.requiredFields && operation.requiredFields.length > 0 ? { requiredFields: operation.requiredFields } : {}),
    ...(missingFields && missingFields.length > 0 ? { missingFields } : {}),
    ...(workflow.status === 'needs-setup' ? { userQuestion: `Which ${options.lane.id === 'inbox' ? 'email' : options.lane.id} connector should GoodVibes use?` } : {}),
  };
}

function recordStatusAsWorkflowStatus(status: string): PersonalOpsWorkflowStatus {
  if (status === 'ready') return 'ready';
  if (status === 'needs-setup') return 'needs-setup';
  return 'attention';
}

function recordCandidate(options: {
  readonly lane: PersonalOpsLane;
  readonly recordId: string;
  readonly id: string;
  readonly label: string;
  readonly confidence: PersonalOpsIntakeCandidate['confidence'];
  readonly why: string;
  readonly includeParameters: boolean;
  readonly requiresConfirmation: boolean;
  readonly missingFields?: readonly string[];
  readonly userQuestion?: string;
  readonly nextSteps: readonly string[];
  readonly safetyBoundary: string;
}): PersonalOpsIntakeCandidate | null {
  const record = liveRecordById(options.lane, options.recordId);
  if (!record) return null;
  return {
    id: options.id,
    label: options.label,
    laneId: options.lane.id,
    status: recordStatusAsWorkflowStatus(record.status),
    confidence: options.confidence,
    why: options.why,
    modelRoute: record.modelRoute,
    inspectRoutes: [record.modelRoute, `agent_harness mode:"personal_ops_lane" laneId:"${options.lane.id}"`],
    requiresConfirmation: options.requiresConfirmation,
    safetyBoundary: options.safetyBoundary,
    nextSteps: options.nextSteps,
    operation: recordOperationSummary(record, options.includeParameters),
    ...(record.requiredFields && record.requiredFields.length > 0 ? { requiredFields: record.requiredFields } : {}),
    ...(options.missingFields && options.missingFields.length > 0 ? { missingFields: options.missingFields } : {}),
    ...(options.userQuestion ? { userQuestion: options.userQuestion } : {}),
  };
}

function setupCandidate(lane: PersonalOpsLane, request: string): PersonalOpsIntakeCandidate {
  return {
    id: 'personal-ops-map-first',
    label: 'Map Personal Ops readiness first',
    laneId: lane.id,
    status: lane.status === 'gap' || lane.status === 'needs-setup' ? 'needs-setup' : lane.status === 'ready' ? 'ready' : 'attention',
    confidence: 'low',
    why: `The request "${previewHarnessText(request, 80)}" does not clearly name one personal operation, so the safest next step is a readiness map.`,
    modelRoute: 'agent_harness mode:"personal_ops"',
    inspectRoutes: ['agent_harness mode:"personal_ops"'],
    requiresConfirmation: false,
    safetyBoundary: 'Readiness inspection is read-only; personal-data reads and all sends or mutations remain on their owning routes.',
    nextSteps: [
      'Inspect Personal Ops readiness.',
      'Choose one lane: inbox, calendar, notes, tasks, reminders, routines, or delivery.',
      'Re-run personal_ops_intake with the specific user request.',
    ],
    missingFields: ['specific personal operation goal'],
    userQuestion: 'Should this be inbox, calendar, notes, tasks, reminders, routines, or delivery work?',
  };
}

function candidatePriority(candidate: PersonalOpsIntakeCandidate): number {
  const confidence = candidate.confidence === 'high' ? 300 : candidate.confidence === 'medium' ? 200 : 100;
  const readiness = candidate.status === 'ready' ? 30 : candidate.status === 'attention' ? 15 : 0;
  return confidence + readiness;
}

function buildPersonalOpsIntakeCandidates(
  request: string,
  lanes: readonly PersonalOpsLane[],
  includeParameters: boolean,
): readonly PersonalOpsIntakeCandidate[] {
  const lower = request.toLowerCase();
  const inboxLane = laneById(lanes, 'inbox');
  const calendarLane = laneById(lanes, 'calendar');
  const taskLane = laneById(lanes, 'tasks');
  const reminderLane = laneById(lanes, 'reminders');
  const routineLane = laneById(lanes, 'routines');
  const deliveryLane = laneById(lanes, 'delivery');
  const candidates: PersonalOpsIntakeCandidate[] = [];

  const asksInbox = hasAny(lower, ['inbox', 'email', 'mail', 'gmail', 'imap', 'message', 'thread']);
  const asksReply = hasAny(lower, ['draft', 'reply', 'respond', 'compose']);
  const asksCalendar = hasAny(lower, ['calendar', 'agenda', 'caldav', 'event', 'meeting', 'availability', 'freebusy', 'free busy']);
  const asksConflict = hasAny(lower, ['conflict', 'overlap', 'double-book', 'double booked', 'availability', 'freebusy', 'free busy']);
  const asksReminder = hasAny(lower, ['remind', 'reminder', 'follow up', 'follow-up', 'ping me', 'notify me']);
  const asksTask = hasAny(lower, ['task', 'todo', 'to-do', 'work item', 'work plan', 'host task']);
  const asksNote = hasAny(lower, ['note', 'scratchpad', 'capture', 'jot down']);
  const asksRoutine = hasAny(lower, ['routine', 'checklist', 'repeatable']);
  const asksDelivery = !asksReminder && hasAny(lower, ['deliver', 'send', 'channel', 'slack', 'discord', 'telegram', 'sms', 'notification']);

  if (asksInbox && asksReply) {
    const readTool = selectConnectorTool(inboxLane, 'read-only', 'inbox-read', ['get_thread', 'thread', 'read', 'message', 'fetch', 'get']);
    const writeTool = selectConnectorTool(inboxLane, 'confirmed-effect', 'inbox-write', ['send_reply', 'reply', 'draft', 'compose', 'send']);
    const candidate = workflowCandidate({
      lane: inboxLane,
      workflowId: 'inbox-draft-reply',
      id: 'inbox-draft-reply',
      label: 'Draft an inbox reply without sending',
      confidence: 'high',
      why: 'The request mentions drafting or replying to inbox content.',
      operation: readTool,
      followUpOperation: writeTool,
      includeParameters,
      readOnlyNext: 'Read the selected thread through the reviewed connector, then draft the reply in chat.',
      mutationBoundary: 'Sending, labeling, archiving, moving, or deleting remains a separate confirmed connector action.',
    });
    if (candidate) candidates.push(candidate);
  }

  if (asksInbox) {
    const readTool = selectConnectorTool(inboxLane, 'read-only', 'inbox-read', ['search', 'list', 'unread', 'query', 'find', 'messages', 'inbox']);
    const candidate = workflowCandidate({
      lane: inboxLane,
      workflowId: 'inbox-triage-briefing',
      id: 'inbox-triage-briefing',
      label: 'Triage inbox messages',
      confidence: asksReply ? 'medium' : 'high',
      why: 'The request asks for inbox, email, message, or thread triage.',
      operation: readTool,
      includeParameters,
      readOnlyNext: 'Run only a bounded read/list/search route, then summarize priorities, risks, and suggested next actions in chat.',
      mutationBoundary: 'Reply, send, label, archive, move, and delete actions require a separate explicit confirmation.',
    });
    if (candidate) candidates.push(candidate);
  }

  if (asksCalendar) {
    const workflowId = asksConflict ? 'calendar-conflict-scan' : 'calendar-agenda-briefing';
    const readTool = selectConnectorTool(calendarLane, 'read-only', 'calendar-read', asksConflict
      ? ['freebusy', 'availability', 'list', 'events', 'upcoming']
      : ['list', 'upcoming', 'agenda', 'events', 'search']);
    const writeTool = selectConnectorTool(calendarLane, 'confirmed-effect', 'calendar-write', ['create', 'update', 'reschedule', 'edit', 'delete']);
    const candidate = workflowCandidate({
      lane: calendarLane,
      workflowId,
      id: workflowId,
      label: asksConflict ? 'Scan calendar conflicts' : 'Brief calendar agenda',
      confidence: 'high',
      why: asksConflict ? 'The request asks about conflicts, overlap, or availability.' : 'The request asks for agenda, event, meeting, or calendar context.',
      operation: readTool,
      followUpOperation: writeTool,
      includeParameters,
      readOnlyNext: asksConflict
        ? 'Read a bounded calendar window and report overlaps, prep gaps, and reminder suggestions.'
        : 'Read a bounded calendar window and summarize agenda context, prep items, and risks.',
      mutationBoundary: 'Creating, editing, deleting, RSVP, or rescheduling events requires a separate explicit confirmation.',
    });
    if (candidate) candidates.push(candidate);
  }

  if (asksReminder) {
    const candidate = recordCandidate({
      lane: reminderLane,
      recordId: 'reminder-create',
      id: 'confirmed-reminder-request',
      label: 'Create one confirmed reminder',
      confidence: 'high',
      why: 'The request asks GoodVibes to remind, notify, ping, or follow up with the user.',
      includeParameters,
      requiresConfirmation: true,
      missingFields: ['title', 'scheduleKind', 'scheduleValue', 'explicitUserRequest'],
      userQuestion: 'What exact reminder title and time should GoodVibes use?',
      safetyBoundary: 'Reminder creation requires confirm:true and explicitUserRequest; vague follow-up ideas stay as notes or work-plan items.',
      nextSteps: [
        'Collect the reminder title, exact timing, timezone/cadence, and delivery scope.',
        'Inspect delivery channel readiness when the reminder must reach the user outside the terminal.',
        'Create exactly one reminder through the confirmed route.',
      ],
    });
    if (candidate) candidates.push(candidate);
  }

  if (asksTask) {
    const recordId = hasAny(lower, ['host task', 'running task', 'task status', 'inspect task']) ? 'host-tasks-list' : 'workplan-add';
    const candidate = recordCandidate({
      lane: taskLane,
      recordId,
      id: recordId === 'host-tasks-list' ? 'host-task-review' : 'visible-work-item',
      label: recordId === 'host-tasks-list' ? 'Review connected-host tasks' : 'Create a visible work item',
      confidence: 'high',
      why: recordId === 'host-tasks-list'
        ? 'The request asks about host task state.'
        : 'The request asks for task or work-plan tracking.',
      includeParameters,
      requiresConfirmation: false,
      missingFields: recordId === 'workplan-add' ? ['title'] : undefined,
      userQuestion: recordId === 'workplan-add' ? 'What short title should this visible work item use?' : undefined,
      safetyBoundary: 'Agent-owned work-plan edits stay local and visible; connected-host task controls require exact ids and confirmation.',
      nextSteps: recordId === 'host-tasks-list'
        ? ['List host tasks.', 'Inspect one exact host task id before considering retry or cancel.', 'Use confirmed host controls only when the user asks.']
        : ['Create a concise visible work-plan item.', 'Keep status changes visible as the work proceeds.', 'Use host tasks only when execution needs connected-host ownership.'],
    });
    if (candidate) candidates.push(candidate);
  }

  if (asksNote) {
    const candidate: PersonalOpsIntakeCandidate = {
      id: 'capture-scratchpad-note',
      label: 'Capture a scratchpad note',
      laneId: 'notes' as const,
      status: 'ready' as const,
      confidence: 'medium' as const,
      why: 'The request asks to capture or note working context.',
      modelRoute: 'agent_local_registry domain:"notes" action:"create"',
      inspectRoutes: ['agent_harness mode:"personal_ops_lane" laneId:"notes"'],
      requiresConfirmation: false,
      safetyBoundary: 'Notes are Agent-local scratchpad records; promotion to memory or Knowledge stays separate and reviewed.',
      nextSteps: ['Create a scratchpad note with a short title and body.', 'Review or promote the note only when it proves useful.'],
      requiredFields: ['title', 'body'],
      missingFields: ['title', 'body'],
      userQuestion: 'What should the note say?',
    };
    candidates.push(candidate);
  }

  if (asksRoutine) {
    candidates.push({
      id: 'routine-review-or-promotion',
      label: 'Review routines before reuse',
      laneId: 'routines',
      status: routineLane.status === 'ready' ? 'ready' : routineLane.status === 'needs-setup' ? 'needs-setup' : 'attention',
      confidence: 'medium',
      why: 'The request asks about a routine, checklist, or repeatable workflow.',
      modelRoute: 'agent_harness mode:"personal_ops_lane" laneId:"routines"',
      inspectRoutes: [
        'agent_harness mode:"personal_ops_lane" laneId:"routines"',
        'agent_harness mode:"workspace_actions" categoryId:"routines"',
      ],
      requiresConfirmation: true,
      safetyBoundary: 'Routine creation/review is Agent-local; schedule promotion requires explicit cadence and confirmation.',
      nextSteps: [
        'Inspect routine readiness and setup gaps.',
        'Create or review the routine locally.',
        'Promote to a connected schedule only after the user confirms cadence and delivery expectations.',
      ],
      missingFields: ['routineId or routine goal'],
      userQuestion: 'Which routine or repeatable workflow should GoodVibes use?',
    });
  }

  if (asksDelivery) {
    candidates.push({
      id: 'delivery-channel-review',
      label: 'Review delivery channels before sending',
      laneId: 'delivery',
      status: deliveryLane.status === 'ready' ? 'ready' : deliveryLane.status === 'needs-setup' ? 'needs-setup' : 'attention',
      confidence: 'medium',
      why: 'The request asks to deliver, send, notify, or use a communication channel.',
      modelRoute: 'agent_harness mode:"channels"',
      inspectRoutes: [
        'agent_harness mode:"personal_ops_lane" laneId:"delivery"',
        'agent_harness mode:"channel_triage"',
        'agent_harness mode:"channel_deliveries"',
      ],
      requiresConfirmation: true,
      safetyBoundary: 'External sends require an explicit target, reviewed message, and confirmed channel send route.',
      nextSteps: [
        'Inspect channel readiness and recent delivery receipts.',
        'Choose one configured target and message.',
        'Send only through agent_channel_send or the confirmed workspace send flow.',
      ],
      missingFields: ['channel target', 'reviewed message', 'explicitUserRequest'],
      userQuestion: 'Which configured channel target and reviewed message should GoodVibes send?',
    });
  }

  if (candidates.length === 0) candidates.push(setupCandidate(laneById(lanes, 'tasks'), request));
  return candidates
    .sort((left, right) => candidatePriority(right) - candidatePriority(left) || left.id.localeCompare(right.id));
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
    modes: ['personal_ops_briefing', 'personal_ops', 'personal_ops_lane', 'personal_ops_intake', 'run_personal_ops_read'],
    lanes: lanes.length,
    ...counts,
    workflows: workflows.length,
    readyWorkflows: workflows.filter((workflow) => workflow.status === 'ready').length,
    attentionWorkflows: workflows.filter((workflow) => workflow.status === 'attention').length,
    setupWorkflows: workflows.filter((workflow) => workflow.status === 'needs-setup').length,
    bestReadyStatus: lanes.reduce((best, lane) => Math.max(best, laneStatusRank(lane.status)), 0),
  };
}

function briefingStatusForLane(lane: PersonalOpsLane): PersonalOpsBriefingStatus {
  if (lane.status === 'ready') return 'ready';
  if (lane.status === 'partial') return 'attention';
  return 'needs-setup';
}

function briefingStatusRank(status: PersonalOpsBriefingStatus): number {
  if (status === 'ready') return 3;
  if (status === 'attention') return 2;
  return 1;
}

function briefingStatusFromSteps(steps: readonly Record<string, unknown>[]): PersonalOpsBriefingStatus {
  const statuses = steps
    .map((step) => typeof step.status === 'string' ? step.status : '')
    .filter((status): status is PersonalOpsBriefingStatus => status === 'ready' || status === 'attention' || status === 'needs-setup');
  if (statuses.length === 0) return 'needs-setup';
  if (statuses.some((status) => status === 'needs-setup')) return statuses.some((status) => status !== 'needs-setup') ? 'attention' : 'needs-setup';
  return statuses.some((status) => status === 'attention') ? 'attention' : 'ready';
}

function recordCount(lane: PersonalOpsLane, predicate: (record: PersonalOpsLiveRecord) => boolean): number {
  return (lane.liveRecords ?? []).filter(predicate).length;
}

function workflowCount(lane: PersonalOpsLane, status: PersonalOpsWorkflowStatus): number {
  return (lane.workflows ?? []).filter((workflow) => workflow.status === status).length;
}

function briefingPurpose(lane: PersonalOpsLane): string {
  if (lane.id === 'inbox') return 'Find inbox items that need attention while keeping replies, labels, archive, and sends as separate confirmed effects.';
  if (lane.id === 'calendar') return 'Brief the agenda, conflicts, prep gaps, and reminder opportunities before any event edit or RSVP.';
  if (lane.id === 'tasks') return 'Make ongoing work visible through work plans and connected-host task inspection.';
  if (lane.id === 'reminders') return 'Capture follow-ups as confirmed reminders or schedules with an explicit delivery path.';
  if (lane.id === 'routines') return 'Reuse reviewed routines and only promote schedules when cadence and scope are explicit.';
  if (lane.id === 'delivery') return 'Check whether summaries, reminders, and follow-ups can reach the user through configured channels.';
  return 'Capture useful working context locally without promoting it to durable memory until reviewed.';
}

function briefingNext(lane: PersonalOpsLane): string {
  const freshProviderReads = recordCount(lane, (record) => record.freshness?.status === 'fresh-provider-route-ready');
  const refreshableSavedRecords = recordCount(lane, (record) => record.freshness?.status === 'saved-review-refreshable');
  const savedReviewRecords = recordCount(lane, (record) => record.freshness?.source === 'saved-review-artifact' || typeof record.reviewRecordCount === 'number');
  const attentionWorkflows = workflowCount(lane, 'attention');
  if ((lane.id === 'inbox' || lane.id === 'calendar') && freshProviderReads > 0) {
    return 'Pick one bounded read-only record and run it with run_personal_ops_read only when the user asks for live provider data.';
  }
  if ((lane.id === 'inbox' || lane.id === 'calendar') && refreshableSavedRecords > 0) {
    return 'Recap the saved redacted queue first; refresh a single record only through the returned confirmed read route.';
  }
  if ((lane.id === 'inbox' || lane.id === 'calendar') && savedReviewRecords > 0) {
    return 'Use saved redacted review records for today, then repair a provider connector before promising fresh queue state.';
  }
  if ((lane.id === 'inbox' || lane.id === 'calendar') && attentionWorkflows > 0) {
    return 'Repair connector trust, connection, or schema freshness before reading live personal data.';
  }
  return lane.next;
}

function briefingStepForLane(lane: PersonalOpsLane, includeParameters: boolean): Record<string, unknown> {
  const records = lane.liveRecords ?? [];
  const workflows = lane.workflows ?? [];
  const freshProviderReads = recordCount(lane, (record) => record.freshness?.status === 'fresh-provider-route-ready');
  const refreshableSavedRecords = recordCount(lane, (record) => record.freshness?.status === 'saved-review-refreshable');
  const savedReviewRecords = recordCount(lane, (record) => record.freshness?.source === 'saved-review-artifact' || typeof record.reviewRecordCount === 'number');
  const readOnlyRecords = recordCount(lane, (record) => record.effect === 'read-only');
  const confirmedEffectRecords = recordCount(lane, (record) => record.effect === 'confirmed-effect' || record.confirmationRequired === true);
  const laneRoute = `agent_harness mode:"personal_ops_lane" laneId:"${lane.id}"`;
  const intakeRoute = `agent_harness mode:"personal_ops_intake" query:"${lane.label.toLowerCase()} daily briefing"`;
  const workflowRoutes = workflows
    .map((workflow) => workflow.modelRoute)
    .filter((route, index, routes) => route && routes.indexOf(route) === index)
    .slice(0, includeParameters ? 4 : 2);
  const evidence = [
    ...lane.signals.slice(0, includeParameters ? 8 : 4),
    `${records.length} live/operation record(s)`,
    `${workflowCount(lane, 'ready')} ready workflow(s)`,
    `${workflowCount(lane, 'attention')} attention workflow(s)`,
    `${freshProviderReads} fresh provider read route(s)`,
    `${refreshableSavedRecords} refreshable saved review record(s)`,
    `${savedReviewRecords} saved review record(s)`,
  ];
  return {
    id: lane.id,
    label: lane.label,
    status: briefingStatusForLane(lane),
    purpose: briefingPurpose(lane),
    next: previewHarnessText(briefingNext(lane), includeParameters ? 220 : 140),
    modelRoute: laneRoute,
    inspectRoutes: [laneRoute, intakeRoute, ...workflowRoutes].slice(0, includeParameters ? 8 : 4),
    evidence,
    sourceCounts: {
      records: records.length,
      readOnlyRecords,
      confirmedEffectRecords,
      workflows: workflows.length,
      readyWorkflows: workflowCount(lane, 'ready'),
      attentionWorkflows: workflowCount(lane, 'attention'),
      freshProviderReads,
      refreshableSavedRecords,
      savedReviewRecords,
      connectorSignals: lane.connectorSignals?.length ?? 0,
    },
    confirmationBoundary: lane.id === 'inbox' || lane.id === 'calendar'
      ? 'Live provider reads stay bounded and selected; sends, labels, archives, moves, event edits, RSVP, and deletes require a separate confirmed route.'
      : 'Writes, sends, schedules, connected-host controls, and operator effects require an explicit user request and the owning confirmed tool.',
  };
}

function autonomyBriefingStep(): Record<string, unknown> {
  return {
    id: 'autonomy-queue',
    label: 'Autonomy Queue',
    status: 'ready' satisfies PersonalOpsBriefingStatus,
    purpose: 'Review visible ongoing work, owners, status, tails, receipts, and cancel or recovery routes before starting more autonomous work.',
    next: 'Inspect the autonomy queue and resolve running, blocked, or ownerless work before adding new background jobs.',
    modelRoute: 'agent_harness mode:"autonomy_queue"',
    inspectRoutes: [
      'agent_harness mode:"autonomy_queue"',
      'agent_harness mode:"autonomy_intake" query:"daily operations follow-up"',
    ],
    evidence: [
      'Visible autonomy queue has a first-class harness mode',
      'Queue item inspection exposes cancel and recovery routes',
      'New ongoing work should enter through autonomy_intake or a visible schedule/work-plan route',
    ],
    sourceCounts: {
      records: 0,
      workflows: 1,
      readyWorkflows: 1,
      attentionWorkflows: 0,
      freshProviderReads: 0,
      refreshableSavedRecords: 0,
      savedReviewRecords: 0,
      connectorSignals: 0,
    },
    confirmationBoundary: 'Starting, cancelling, retrying, scheduling, or mutating autonomous work remains a separate confirmed route.',
  };
}

export async function personalOpsBriefingSummary(context: CommandContext, args: AgentHarnessPersonalOpsArgs): Promise<Record<string, unknown>> {
  const includeParameters = args.includeParameters === true;
  const request = readString(args.query) || readString(args.target) || 'daily personal operations';
  const tools = await mcpToolRecords(context);
  const lanes = buildLanes(context, {
    toolsByServer: toolsByServer(tools),
    schemasByQualifiedName: includeParameters ? await mcpToolSchemas(context, tools) : new Map<string, McpToolSchema>(),
  });
  const orderedLaneIds: readonly PersonalOpsLaneId[] = ['inbox', 'calendar', 'tasks', 'reminders', 'routines', 'delivery', 'notes'];
  const allSteps = [
    ...orderedLaneIds
      .map((laneId) => lanes.find((lane) => lane.id === laneId))
      .filter((lane): lane is PersonalOpsLane => lane !== undefined)
      .map((lane) => briefingStepForLane(lane, includeParameters)),
    autonomyBriefingStep(),
  ];
  const limit = readLimit(args.limit, includeParameters ? 8 : 6);
  const steps = allSteps.slice(0, limit);
  const status = briefingStatusFromSteps(steps);
  const readiness = steps.reduce<Record<PersonalOpsBriefingStatus, number>>((acc, step) => {
    const stepStatus = typeof step.status === 'string' ? step.status : 'needs-setup';
    if (stepStatus === 'ready' || stepStatus === 'attention' || stepStatus === 'needs-setup') acc[stepStatus] += 1;
    return acc;
  }, { ready: 0, attention: 0, 'needs-setup': 0 });
  const liveRecords = lanes.flatMap((lane) => lane.liveRecords ?? []);
  const workflows = lanes.flatMap((lane) => lane.workflows ?? []);
  const missingContracts = lanes
    .filter((lane) => (lane.id === 'inbox' || lane.id === 'calendar') && lane.status !== 'ready')
    .map((lane) => `${lane.label}: fresh provider-backed queues need a ready connector or daemon record before GoodVibes can promise current live data.`);
  return {
    status,
    title: 'Daily Personal Ops briefing plan',
    request: previewHarnessText(request, includeParameters ? 220 : 120),
    generatedFrom: 'Current Agent-local workspace state, GoodVibes daemon contract metadata, MCP connector posture, saved review queues, and schema-derived Personal Ops records.',
    returned: steps.length,
    total: allSteps.length,
    steps,
    readiness,
    recommendedOrder: steps
      .slice()
      .sort((left, right) => briefingStatusRank((right.status as PersonalOpsBriefingStatus) ?? 'needs-setup') - briefingStatusRank((left.status as PersonalOpsBriefingStatus) ?? 'needs-setup'))
      .map((step) => step.id),
    sourceSummary: {
      lanes: lanes.length,
      liveRecords: liveRecords.length,
      workflows: workflows.length,
      readyWorkflows: workflows.filter((workflow) => workflow.status === 'ready').length,
      attentionWorkflows: workflows.filter((workflow) => workflow.status === 'attention').length,
      freshProviderReads: liveRecords.filter((record) => record.freshness?.status === 'fresh-provider-route-ready').length,
      refreshableSavedRecords: liveRecords.filter((record) => record.freshness?.status === 'saved-review-refreshable').length,
      savedReviewRecords: liveRecords.filter((record) => record.freshness?.source === 'saved-review-artifact' || typeof record.reviewRecordCount === 'number').length,
      connectorSignals: lanes.reduce((sum, lane) => sum + (lane.connectorSignals?.length ?? 0), 0),
    },
    routes: {
      personalOps: 'agent_harness mode:"personal_ops"',
      intake: 'agent_harness mode:"personal_ops_intake" query:"..."',
      laneTemplate: 'agent_harness mode:"personal_ops_lane" laneId:"inbox|calendar|notes|tasks|reminders|routines|delivery"',
      liveReadTemplate: 'agent_harness mode:"run_personal_ops_read" laneId:"inbox|calendar" recordId:"..." fields:{...} confirm:true explicitUserRequest:"..."',
      autonomyQueue: 'agent_harness mode:"autonomy_queue"',
      workspace: 'agent_harness mode:"workspace_actions" categoryId:"personal-ops"',
    },
    nextActions: [
      'Start with ready steps, then resolve attention or setup steps before promising live provider state.',
      'Use saved redacted inbox/calendar review queues for recap when fresh connectors are not ready.',
      'Run exactly one live personal-data read at a time through run_personal_ops_read, then summarize before any follow-up effect.',
      ...nextActions(lanes).slice(0, 3),
    ].slice(0, includeParameters ? 8 : 5),
    missingContracts,
    policy: 'This briefing is read-only. It plans the user-facing daily operations flow across Personal Ops lanes and the autonomy queue; live personal-data reads, sends, edits, schedule creation, connected-host controls, and external delivery remain separate explicit confirmed actions.',
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

export async function personalOpsIntakeSummary(context: CommandContext, args: AgentHarnessPersonalOpsArgs): Promise<Record<string, unknown>> {
  const request = readString(args.query) || readString(args.target);
  if (!request) {
    return {
      status: 'missing_request',
      usage: 'Use mode:"personal_ops_intake" with query:"<personal operations request>". This mode is read-only and returns the safest lane, route, missing fields, and confirmation boundary.',
      examples: [
        'Triage my unread inbox.',
        'Draft a reply to this email thread.',
        'Brief my calendar for today.',
        'Remind me tomorrow at 9am to send the report.',
      ],
      personalOpsRoute: 'agent_harness mode:"personal_ops"',
    };
  }
  const includeParameters = args.includeParameters === true;
  const tools = await mcpToolRecords(context);
  const lanes = buildLanes(context, {
    toolsByServer: toolsByServer(tools),
    schemasByQualifiedName: await mcpToolSchemas(context, tools),
  });
  const limit = readLimit(args.limit, includeParameters ? 8 : 4);
  const candidates = buildPersonalOpsIntakeCandidates(request, lanes, includeParameters).slice(0, limit);
  const preferred = candidates[0]!;
  return {
    status: 'ready',
    request: previewHarnessText(request, includeParameters ? 220 : 120),
    preferred,
    candidates,
    personalOpsRoute: 'agent_harness mode:"personal_ops"',
    laneRoute: `agent_harness mode:"personal_ops_lane" laneId:"${preferred.laneId}"`,
    policy: 'Personal Ops intake is read-only. It chooses the safest visible lane and route; live personal-data reads must use reviewed connector or daemon routes, and every send, edit, schedule, or external effect still requires explicit confirmation.',
  };
}

export async function runPersonalOpsRead(context: CommandContext, args: AgentHarnessPersonalOpsArgs): Promise<PersonalOpsReadRunResult> {
  const includeParameters = args.includeParameters === true;
  const tools = await mcpToolRecords(context);
  const lanes = buildLanes(context, {
    toolsByServer: toolsByServer(tools),
    schemasByQualifiedName: await mcpToolSchemas(context, tools),
  });
  const resolved = resolveRunRecord(lanes, {
    laneId: readString(args.laneId),
    recordId: readString(args.recordId),
    target: readString(args.target),
    query: readString(args.query),
  });
  if (!resolved) {
    return {
      status: 'missing_lookup',
      usage: 'run_personal_ops_read requires laneId plus recordId, target, or query for one read-only inbox/calendar connector operation.',
      examples: [
        'agent_harness mode:"personal_ops_intake" query:"Triage my unread email." includeParameters:true',
        'agent_harness mode:"run_personal_ops_read" laneId:"inbox" recordId:"mcp:gmail-inbox:gmail.search_messages" fields:{"query":"is:unread newer_than:7d"} confirm:true explicitUserRequest:"Triage my unread inbox."',
      ],
    };
  }
  if (!('lane' in resolved)) return resolved;

  const { lane, record } = resolved;
  const runRoute = executionRouteForRecord(record, lane.id);
  const fields = readInputFields(args.fields, record.sampleInput);
  const recordSummary = summarizeRunRecord(record, lane, includeParameters);

  if (record.status !== 'ready') {
    return {
      status: 'blocked',
      reason: 'connector_not_ready',
      record: recordSummary,
      next: 'Repair connector trust, connection, or schema freshness before reading live personal data.',
      inspectRoutes: [record.modelRoute, `agent_harness mode:"personal_ops_lane" laneId:"${lane.id}"`],
      policy: 'Personal Ops never reads personal provider data from attention or setup-needed connectors.',
    };
  }
  if (record.effect !== 'read-only') {
    return {
      status: 'blocked',
      reason: 'not_read_only',
      record: recordSummary,
      next: 'Use the returned confirmed-effect route only after the user reviews the intended provider mutation.',
      policy: 'run_personal_ops_read refuses send, edit, label, archive, delete, move, create, RSVP, and reschedule operations.',
    };
  }
  if (!record.qualifiedName) {
    return {
      status: 'blocked',
      reason: 'missing_qualified_tool',
      record: recordSummary,
      next: 'Inspect the connector schema or lane operation records until a qualified MCP tool name is available.',
    };
  }
  const missingFields = missingRequiredInputFields(record, fields);
  if (missingFields.length > 0) {
    return {
      status: 'missing_fields',
      record: recordSummary,
      missingFields,
      sampleInput: record.sampleInput ?? {},
      runRoute,
      policy: 'Required fields must be supplied by the user or an explicit intake plan; placeholder sample values are never executed silently.',
    };
  }
  if (!readString(args.explicitUserRequest) || args.confirm !== true) {
    return {
      status: 'needs_confirmation',
      record: recordSummary,
      inputPreview: fields,
      runRoute,
      policy: 'Reading live personal inbox/calendar data requires confirm:true and explicitUserRequest. Write-like provider effects are not supported by this route.',
    };
  }
  const callTool = mcpToolCaller(context);
  if (!callTool) {
    return {
      status: 'unavailable',
      reason: 'mcp_call_tool_unavailable',
      record: recordSummary,
      next: 'Use MCP tool discovery and connector setup until the runtime publishes callTool for this Agent session.',
    };
  }

  try {
    const result = await callTool(record.qualifiedName, fields);
    const reviewRecords = personalOpsReadReviewRecords(lane, record, result, includeParameters);
    const output = boundedPersonalOpsResult(result, includeParameters);
    const saveRequested = readRunControlBoolean(args.fields, ['saveReviewCards', 'saveReview']);
    const savedReviewArtifact = saveRequested
      ? await savePersonalOpsReviewArtifact({
        context,
        lane,
        sourceRecord: record,
        inputFields: fields,
        reviewRecords,
        output,
        title: readRunControlString(args.fields, 'artifactTitle'),
      })
      : null;
    return {
      status: 'executed',
      record: recordSummary,
      input: fields,
      output,
      reviewSummary: {
        kind: lane.id === 'calendar' ? 'calendar' : 'inbox',
        records: reviewRecords.length,
        source: record.qualifiedName,
      },
      reviewRecords,
      ...(savedReviewArtifact ? { savedReviewArtifact } : {}),
      followUp: [
        'Summarize or draft only in the Agent transcript.',
        'Ask for explicit confirmation before any send, label, archive, delete, calendar edit, RSVP, or reschedule route.',
      ],
      policy: 'This route executed one selected read-only MCP connector tool and returned bounded, redacted output for review.',
    };
  } catch (error) {
    return {
      status: 'failed',
      record: recordSummary,
      input: fields,
      error: previewHarnessText(redactedPersonalOpsText(summarizeError(error)), 320),
      policy: 'Connector failures are reported as reviewable errors; no fallback personal data is fabricated.',
    };
  }
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
