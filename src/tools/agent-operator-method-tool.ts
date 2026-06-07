import { getOperatorContract } from '@pellux/goodvibes-sdk/contracts';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { ShellPathService } from '@/runtime/index.ts';
import type { AgentConnectedHostConfigReader } from '../agent/routine-schedule-promotion.ts';
import { resolveAgentConnectedHostConnection } from '../agent/routine-schedule-promotion.ts';

type JsonRecord = Record<string, unknown>;

interface OperatorContractMethod {
  readonly id: string;
  readonly title?: string;
  readonly category?: string;
  readonly access?: string;
  readonly scopes?: readonly string[];
  readonly http?: {
    readonly method?: string;
    readonly path?: string;
  };
}

interface OperatorMethodToolArgs {
  readonly methodId?: unknown;
  readonly input?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
  readonly dryRun?: unknown;
}

interface PreparedOperatorRoute {
  readonly method: OperatorContractMethod;
  readonly httpMethod: string;
  readonly path: string;
  readonly payload: JsonRecord;
}

type ServiceMethodId = 'services.status' | 'services.install' | 'services.start' | 'services.restart';

const READ_ONLY_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_OUTPUT_CHARS = 18_000;
const SERVICE_METHOD_IDS = new Set<string>(['services.status', 'services.install', 'services.start', 'services.restart']);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function operatorMethods(): readonly OperatorContractMethod[] {
  const contract = getOperatorContract();
  return Array.isArray(contract.operator?.methods)
    ? contract.operator.methods as OperatorContractMethod[]
    : [];
}

function findOperatorMethod(methodId: string): OperatorContractMethod | null {
  const methods = operatorMethods();
  return methods.find((method) => method.id === methodId)
    ?? methods.find((method) => method.id.toLowerCase() === methodId.toLowerCase())
    ?? null;
}

function methodIsReadOnly(method: OperatorContractMethod): boolean {
  const httpMethod = method.http?.method?.toUpperCase();
  if (httpMethod && READ_ONLY_HTTP_METHODS.has(httpMethod)) return true;
  const scopes = method.scopes ?? [];
  return scopes.length > 0 && scopes.every((scope) => scope.startsWith('read:'));
}

function methodRequiresConfirmation(method: OperatorContractMethod): boolean {
  return !methodIsReadOnly(method);
}

function cloneInput(input: unknown): JsonRecord {
  if (!isRecord(input)) return {};
  return { ...input };
}

function encodePathValue(value: unknown, name: string): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return encodeURIComponent(String(value));
  }
  throw new Error(`operator method path parameter '${name}' must be a string, number, or boolean.`);
}

function substitutePath(pathTemplate: string, payload: JsonRecord): string {
  let path = pathTemplate.replace(/\{([^}]+)\}/g, (_match, rawName: string) => {
    const name = rawName.trim();
    if (!(name in payload)) throw new Error(`operator method path parameter '${name}' is required.`);
    const encoded = encodePathValue(payload[name], name);
    delete payload[name];
    return encoded;
  });
  path = path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (match, name: string) => {
    if (!(name in payload)) return match;
    const encoded = encodePathValue(payload[name], name);
    delete payload[name];
    return encoded;
  });
  return path;
}

function prepareOperatorRoute(method: OperatorContractMethod, input: unknown): PreparedOperatorRoute {
  const httpMethod = method.http?.method?.toUpperCase();
  const pathTemplate = method.http?.path;
  if (!httpMethod || !pathTemplate) {
    throw new Error(`operator method '${method.id}' is not invokable over HTTP.`);
  }
  const payload = cloneInput(input);
  const path = substitutePath(pathTemplate, payload);
  return { method, httpMethod, path, payload };
}

function appendQuery(path: string, payload: JsonRecord): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      query.set(key, String(value));
    } else {
      query.set(key, JSON.stringify(value));
    }
  }
  const queryString = query.toString();
  if (!queryString) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${queryString}`;
}

function isServiceMethodId(methodId: string): methodId is ServiceMethodId {
  return SERVICE_METHOD_IDS.has(methodId);
}

function serviceSuccessCriteria(methodId: ServiceMethodId): readonly string[] {
  if (methodId === 'services.status') {
    return [
      'The daemon returns a service status receipt with installed, autostart, and running booleans.',
      'The receipt has no actionError.',
    ];
  }
  if (methodId === 'services.install') {
    return [
      'The daemon returns ok:true for services.install.',
      'The service status receipt reports installed:true.',
      'The receipt has no actionError.',
      'Verify with services.status before retrying install, start, or restart.',
    ];
  }
  if (methodId === 'services.start') {
    return [
      'The daemon returns ok:true for services.start.',
      'The service status receipt reports running:true.',
      'The receipt has no actionError.',
      'Verify with services.status before retrying start or escalating.',
    ];
  }
  return [
    'The daemon returns ok:true for services.restart.',
    'The service status receipt reports running:true after restart.',
    'The receipt has no actionError.',
    'Verify with services.status before retrying restart or escalating.',
  ];
}

function serviceExpectedOutcome(methodId: ServiceMethodId): JsonRecord {
  const target = methodId === 'services.status'
    ? 'read-current-posture'
    : methodId === 'services.install'
      ? 'installed-service'
      : methodId === 'services.start'
        ? 'running-service'
        : 'restarted-running-service';
  return {
    target,
    successCriteria: serviceSuccessCriteria(methodId),
    evidenceFields: ['installed', 'autostart', 'running', 'pid', 'lastAction', 'actionError', 'network.controlPlane.ready'],
    verificationRoute: 'agent_operator_method methodId:"services.status"',
    recoveryRoute: 'agent_harness mode:"setup_item" setupItemId:"connected-host-readiness" includeParameters:true',
  };
}

function summarizePreview(route: PreparedOperatorRoute): JsonRecord {
  const readOnly = methodIsReadOnly(route.method);
  const preview: JsonRecord = {
    methodId: route.method.id,
    title: route.method.title ?? route.method.id,
    category: route.method.category ?? 'uncategorized',
    access: route.method.access ?? 'authenticated',
    scopes: route.method.scopes ?? [],
    route: `${route.httpMethod} ${route.path}`,
    effect: readOnly
      ? 'read-only-network'
      : route.method.access === 'admin'
        ? 'confirmed-admin-connected-host-state'
        : 'confirmed-connected-host-state',
    confirmationRequired: !readOnly,
    body: READ_ONLY_HTTP_METHODS.has(route.httpMethod) ? undefined : route.payload,
    query: READ_ONLY_HTTP_METHODS.has(route.httpMethod) ? route.payload : undefined,
  };
  if (isServiceMethodId(route.method.id)) preview.expectedOutcome = serviceExpectedOutcome(route.method.id);
  return preview;
}

function redacted(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated-depth]';
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redacted(entry, depth + 1));
  if (!isRecord(value)) return value;
  const output: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/(token|password|secret|apikey|api_key|authorization|cookie|credential)/i.test(key)) {
      output[key] = '[redacted]';
    } else {
      output[key] = redacted(entry, depth + 1);
    }
  }
  return output;
}

function stringifyOutput(value: unknown): string {
  const text = JSON.stringify(redacted(value), null, 2);
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated ${text.length - MAX_OUTPUT_CHARS} chars]`;
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function serviceReceiptEvidence(body: unknown): JsonRecord {
  if (!isRecord(body)) return { receipt: 'not-json-object' };
  const network = isRecord(body.network) ? body.network : {};
  const controlPlane = isRecord(network.controlPlane) ? network.controlPlane : {};
  return {
    installed: typeof body.installed === 'boolean' ? body.installed : null,
    autostart: typeof body.autostart === 'boolean' ? body.autostart : null,
    running: typeof body.running === 'boolean' ? body.running : null,
    pid: typeof body.pid === 'number' ? body.pid : null,
    lastAction: typeof body.lastAction === 'string' ? body.lastAction : null,
    actionError: typeof body.actionError === 'string' ? body.actionError : null,
    controlPlaneReady: typeof controlPlane.ready === 'boolean' ? controlPlane.ready : null,
  };
}

function serviceOutcomeCertified(methodId: ServiceMethodId, responseOk: boolean, body: unknown): boolean {
  if (!responseOk || !isRecord(body) || typeof body.actionError === 'string') return false;
  if (methodId === 'services.status') {
    return typeof body.installed === 'boolean'
      && typeof body.autostart === 'boolean'
      && typeof body.running === 'boolean';
  }
  if (methodId === 'services.install') return body.installed === true;
  if (methodId === 'services.start') return body.running === true;
  return body.running === true;
}

function serviceOutcome(methodId: string, responseOk: boolean, body: unknown): JsonRecord | undefined {
  if (!isServiceMethodId(methodId)) return undefined;
  const certified = serviceOutcomeCertified(methodId, responseOk, body);
  return {
    kind: 'service-repair-receipt',
    status: !responseOk
      ? 'failed'
      : certified
        ? 'certified'
        : 'needs-follow-up',
    certified,
    methodId,
    evidence: serviceReceiptEvidence(body),
    expectedOutcome: serviceExpectedOutcome(methodId),
    nextStep: certified
      ? 'Inspect services.status or connected-host status to confirm the setup wizard can advance.'
      : 'Inspect services.status and connected-host setup posture before retrying a lifecycle mutation.',
  };
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function createAgentOperatorMethodTool(
  shellPaths: ShellPathService,
  configManager: AgentConnectedHostConfigReader,
): Tool {
  return {
    definition: {
      name: 'agent_operator_method',
      description: 'Invoke a GoodVibes daemon operator method with confirmation gates.',
      parameters: {
        type: 'object',
        properties: {
          methodId: {
            type: 'string',
            description: 'Exact operator method id, for example services.status.',
          },
          input: {
            type: 'object',
            description: 'Method input; path keys are removed before query/body.',
            additionalProperties: true,
          },
          confirm: {
            type: 'boolean',
            description: 'Required true for write/admin operator methods.',
          },
          explicitUserRequest: {
            type: 'string',
            description: 'User request authorizing a write/admin method.',
          },
          dryRun: {
            type: 'boolean',
            description: 'Preview the route without calling the daemon.',
          },
        },
        required: ['methodId'],
        additionalProperties: false,
      },
      sideEffects: ['network', 'state'],
    },
    execute: async (rawArgs: unknown) => {
      const args = isRecord(rawArgs) ? rawArgs as OperatorMethodToolArgs : {};
      const methodId = readString(args.methodId);
      if (!methodId) return { success: false, error: 'methodId is required.' };
      const method = findOperatorMethod(methodId);
      if (!method) {
        return {
          success: false,
          error: `Unknown GoodVibes operator method '${methodId}'. Inspect agent_harness mode:"operator_methods" first.`,
        };
      }

      let route: PreparedOperatorRoute;
      try {
        route = prepareOperatorRoute(method, args.input);
      } catch (error) {
        return { success: false, error: summarizeError(error) };
      }

      const preview = summarizePreview(route);
      if (readBoolean(args.dryRun)) {
        return { success: true, output: stringifyOutput({ preview, dryRun: true }) };
      }

      if (methodRequiresConfirmation(method)) {
        const explicitUserRequest = readString(args.explicitUserRequest);
        if (!readBoolean(args.confirm) || !explicitUserRequest) {
          return {
            success: false,
            error: stringifyOutput({
              preview,
              required: {
                confirm: true,
                explicitUserRequest: 'Required for write/admin operator methods.',
              },
            }),
          };
        }
      }

      const connection = resolveAgentConnectedHostConnection(configManager, shellPaths.homeDirectory);
      if (!connection.token) {
        return {
          success: false,
          error: `auth_required: no connected-host operator token found at ${connection.tokenPath}`,
        };
      }

      const requestPath = READ_ONLY_HTTP_METHODS.has(route.httpMethod)
        ? appendQuery(route.path, route.payload)
        : route.path;
      try {
        const response = await fetch(`${connection.baseUrl}${requestPath}`, {
          method: route.httpMethod,
          headers: {
            authorization: `Bearer ${connection.token}`,
            ...(READ_ONLY_HTTP_METHODS.has(route.httpMethod) ? {} : { 'content-type': 'application/json' }),
          },
          ...(READ_ONLY_HTTP_METHODS.has(route.httpMethod) ? {} : { body: JSON.stringify(route.payload) }),
        });
        const body = await readResponseBody(response);
        const outcome = serviceOutcome(route.method.id, response.ok, body);
        const output = {
          methodId: route.method.id,
          status: response.status,
          ok: response.ok,
          route: `${route.httpMethod} ${requestPath}`,
          effect: preview.effect,
          body,
          ...(outcome ? { outcome } : {}),
        };
        if (!response.ok) return { success: false, error: stringifyOutput(output) };
        return { success: true, output: stringifyOutput(output) };
      } catch (error) {
        return {
          success: false,
          error: `connected_host_unavailable: ${summarizeError(error)}`,
        };
      }
    },
  };
}

export function registerAgentOperatorMethodTool(
  registry: ToolRegistry,
  shellPaths: ShellPathService,
  configManager: AgentConnectedHostConfigReader,
): void {
  registry.register(createAgentOperatorMethodTool(shellPaths, configManager));
}
