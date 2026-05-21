import { delegateToTui } from '../assistant/delegation.js';
import { formatJson } from '../utils/format.js';
import { AgentTuiApp } from '../tui/app.js';
import { bootstrapAgentRuntime } from '../runtime/bootstrap.js';
import { summarizeAuth, summarizeDaemonDiagnostics, type DaemonDiagnosticSummary } from '../daemon/diagnostics-format.js';
import type { AgentRuntimeServices } from '../runtime/services.js';
import type { MemoryClass, MemoryReviewState, MemoryScope, MemorySensitivity } from '../store/memory.js';
import type { SkillReviewState } from '../store/skills.js';
import type { PersonaReviewState } from '../store/personas.js';
import { getFlag, getText, hasFlag, type ParsedArgs } from './args.js';
import { renderHelp } from './help.js';
import { printCaughtFailure, printFailure, printSuccess } from './output.js';

export async function runCommand(args: ParsedArgs): Promise<number> {
  let services: AgentRuntimeServices;
  try {
    services = bootstrapAgentRuntime().services;
  } catch (error) {
    return printCaughtFailure(error);
  }
  const { config, assistant: runtime } = services;
  const text = getText(args);

  switch (args.command) {
    case 'help':
    case '--help':
    case '-h':
      console.log(renderHelp());
      return 0;
    case 'tui':
      await new AgentTuiApp(runtime).run();
      return 0;
    case 'status':
    case 'health':
      return handleStatus(services);
    case 'auth':
      return printSuccess('auth.current', summarizeAuth(await runtime.client.currentAuth()));
    case 'smoke': {
      const diagnostics = await runtime.client.diagnostics();
      console.log(formatJson({
        ok: diagnostics.ok,
        bin: 'goodvibes-agent',
        surfaceKind: config.surfaceKind,
        surfaceId: config.surfaceId,
        providerModel: runtime.providerModel,
        companionChat: runtime.chatStatus(),
        daemon: summarizeDaemonDiagnostics(diagnostics),
      }));
      return diagnostics.ok ? 0 : 1;
    }
    case 'config':
      return handleConfig(services);
    case 'chat':
      console.log((await runtime.handleUserText(text)).text);
      return 0;
    case 'ask':
      return handleKnowledgeAsk(args, runtime, text);
    case 'search':
      return handleKnowledgeSearch(args, runtime, text);
    case 'remember':
      return handleRemember(args, services);
    case 'memory':
      return handleMemory(args, services);
    case 'skills':
      return handleSkills(args, services);
    case 'personas':
      return handlePersonas(args, services);
    case 'delegate':
      console.log(formatJson(await delegateToTui(runtime.client, config, {
        task: text,
        wrfc: hasFlag(args, 'wrfc'),
        reason: 'cli-command',
      })));
      return 0;
    case 'approvals':
      return handleApprovals(args, runtime);
    case 'workplan':
      return handleWorkPlan(args, runtime);
    default:
      console.error(`Unknown command: ${args.command}\n`);
      console.error(renderHelp());
      return 2;
  }
}

async function handleConfig(services: AgentRuntimeServices): Promise<number> {
  const diagnostics = await configDiagnostics(services);
  console.log(formatJson({
    ok: diagnostics.daemon.ok,
    kind: diagnostics.daemon.ok ? 'config' : diagnostics.daemon.kind,
    data: diagnostics,
  }));
  return diagnostics.daemon.ok ? 0 : 1;
}

async function handleStatus(services: AgentRuntimeServices): Promise<number> {
  const diagnostics = await services.daemon.diagnostics();
  console.log(formatJson({
    ok: diagnostics.ok,
    kind: diagnostics.kind,
    data: {
      daemon: summarizeDaemonDiagnostics(diagnostics),
      providerModel: services.assistant.providerModel,
      companionChat: services.assistant.chatStatus(),
    },
  }));
  return diagnostics.ok ? 0 : 1;
}

async function configDiagnostics(services: AgentRuntimeServices): Promise<{
  readonly config: {
    readonly baseUrl: string;
    readonly baseUrlSource: string;
    readonly agentHome: string;
    readonly configPath: string;
    readonly configExists: boolean;
    readonly surfaceKind: string;
    readonly surfaceId: string;
    readonly providerModel: AgentRuntimeServices['assistant']['providerModel'];
    readonly token: AgentRuntimeServices['configMetadata']['token'];
  };
  readonly companionChat: ReturnType<AgentRuntimeServices['assistant']['chatStatus']>;
  readonly daemon: DaemonDiagnosticSummary;
  readonly nextSteps: readonly string[];
}> {
  const daemon = await services.daemon.diagnostics();
  const daemonSummary = summarizeDaemonDiagnostics(daemon);
  return {
    config: {
      baseUrl: services.config.baseUrl,
      baseUrlSource: services.configMetadata.baseUrlSource,
      agentHome: services.configMetadata.agentHome,
      configPath: services.configMetadata.configPath,
      configExists: services.configMetadata.configExists,
      surfaceKind: services.config.surfaceKind,
      surfaceId: services.config.surfaceId,
      providerModel: services.assistant.providerModel,
      token: services.configMetadata.token,
    },
    companionChat: services.assistant.chatStatus(),
    daemon: daemonSummary,
    nextSteps: daemonSummary.ok
      ? ['Daemon connection is ready.']
      : [
        'Confirm the GoodVibes daemon is already running.',
        'Check GOODVIBES_AGENT_BASE_URL or GOODVIBES_BASE_URL.',
        'Check GOODVIBES_AGENT_TOKEN, GOODVIBES_HTTP_TOKEN, GOODVIBES_DAEMON_TOKEN, or the daemon token file.',
      ],
  };
}

async function handleKnowledgeAsk(
  args: ParsedArgs,
  runtime: AgentRuntimeServices['assistant'],
  text: string,
): Promise<number> {
  const query = text || getFlag(args, 'json') || '';
  const reply = await runtime.askKnowledge(query);
  if (args.flags.has('json')) return printSuccess('knowledge.ask', reply.data);
  console.log(reply.text);
  return 0;
}

async function handleKnowledgeSearch(
  args: ParsedArgs,
  runtime: AgentRuntimeServices['assistant'],
  text: string,
): Promise<number> {
  const query = text || getFlag(args, 'json') || '';
  const reply = await runtime.searchKnowledge(query);
  if (args.flags.has('json')) return printSuccess('knowledge.search', reply.data);
  console.log(reply.text);
  return 0;
}

async function handleApprovals(
  args: ParsedArgs,
  runtime: AgentRuntimeServices['assistant'],
): Promise<number> {
  const reply = await runtime.getApprovals();
  if (args.flags.has('json')) return printSuccess('approvals.list', reply.data);
  console.log(reply.text);
  return 0;
}

async function handleWorkPlan(
  args: ParsedArgs,
  runtime: AgentRuntimeServices['assistant'],
): Promise<number> {
  const reply = await runtime.getWorkPlan();
  if (args.flags.has('json')) return printSuccess('projectPlanning.workPlan.snapshot', reply.data);
  console.log(reply.text);
  return 0;
}

function handleRemember(args: ParsedArgs, services: AgentRuntimeServices): number {
  try {
    const summary = getText(args);
    const record = services.memory.remember({
      summary,
      detail: getFlag(args, 'detail'),
      source: 'cli',
      tags: parseList(getFlag(args, 'tags')),
      cls: parseMemoryClass(getFlag(args, 'class')),
      scope: parseMemoryScope(getFlag(args, 'scope')),
      confidence: parseNumberFlag(args, 'confidence'),
      sensitivity: parseMemorySensitivity(getFlag(args, 'sensitivity')),
      provenance: [{ kind: 'user', id: 'cli-remember' }],
    });
    return printSuccess('memory.created', record);
  } catch (error) {
    return printCaughtFailure(error);
  }
}

function handleMemory(args: ParsedArgs, services: AgentRuntimeServices): number {
  const [action = 'list', ...rest] = args.positional;
  try {
    switch (action) {
      case 'list':
        return printSuccess('memory.list', services.memory.list());
      case 'search':
        return printSuccess('memory.search', services.memory.search(rest.join(' ')));
      case 'add':
      case 'create':
        return printSuccess('memory.created', services.memory.remember({
          summary: rest.join(' '),
          detail: getFlag(args, 'detail'),
          source: getFlag(args, 'source') ?? 'cli',
          tags: parseList(getFlag(args, 'tags')),
          cls: parseMemoryClass(getFlag(args, 'class')),
          scope: parseMemoryScope(getFlag(args, 'scope')),
          confidence: parseNumberFlag(args, 'confidence'),
          sensitivity: parseMemorySensitivity(getFlag(args, 'sensitivity')),
          provenance: [{ kind: 'user', id: 'cli-memory-create' }],
        }));
      case 'update':
        return printSuccess('memory.updated', services.memory.update(requireFirst(rest, 'memory update requires an id.'), {
          summary: getFlag(args, 'summary'),
          detail: getFlag(args, 'detail'),
          source: getFlag(args, 'source'),
          tags: parseList(getFlag(args, 'tags')),
          cls: parseMemoryClass(getFlag(args, 'class')),
          scope: parseMemoryScope(getFlag(args, 'scope')),
          confidence: parseNumberFlag(args, 'confidence'),
          reviewState: parseMemoryReviewState(getFlag(args, 'review-state')),
          sensitivity: parseMemorySensitivity(getFlag(args, 'sensitivity')),
        }));
      case 'review':
        return printSuccess('memory.reviewed', services.memory.update(requireFirst(rest, 'memory review requires an id.'), {
          reviewState: 'reviewed',
          reviewedBy: 'goodvibes-agent-cli',
        }));
      case 'stale':
        return printSuccess('memory.stale', services.memory.update(requireFirst(rest, 'memory stale requires an id.'), {
          reviewState: 'stale',
          staleReason: getFlag(args, 'reason') ?? rest.slice(1).join(' '),
        }));
      case 'delete':
        if (!hasFlag(args, 'yes')) return printFailure('confirmation_required', 'Deleting memory requires --yes.');
        return printSuccess('memory.deleted', services.memory.delete(requireFirst(rest, 'memory delete requires an id.')));
      default:
        return printSuccess('memory.search', services.memory.search(args.positional.join(' ')));
    }
  } catch (error) {
    return printCaughtFailure(error);
  }
}

function handleSkills(args: ParsedArgs, services: AgentRuntimeServices): number {
  const [action = 'list', ...rest] = args.positional;
  try {
    switch (action) {
      case 'list':
        return printSuccess('skills.list', services.skills.list());
      case 'search':
        return printSuccess('skills.search', services.skills.search(rest.join(' ')));
      case 'create':
      case 'add':
        return printSuccess('skills.created', services.skills.create({
          name: requireFirst(rest, 'skills create requires a name.'),
          title: getFlag(args, 'title'),
          description: getFlag(args, 'description'),
          body: getFlag(args, 'body'),
          triggers: parseList(getFlag(args, 'triggers')),
          tags: parseList(getFlag(args, 'tags')),
          steps: parseList(getFlag(args, 'steps')),
          source: getFlag(args, 'source') ?? 'cli',
          provenance: ['cli'],
        }));
      case 'update':
        return printSuccess('skills.updated', services.skills.update(requireFirst(rest, 'skills update requires an id or name.'), {
          name: getFlag(args, 'name'),
          title: getFlag(args, 'title'),
          description: getFlag(args, 'description'),
          body: getFlag(args, 'body'),
          triggers: parseList(getFlag(args, 'triggers')),
          tags: parseList(getFlag(args, 'tags')),
          steps: parseList(getFlag(args, 'steps')),
          source: getFlag(args, 'source'),
          reviewState: parseSkillReviewState(getFlag(args, 'review-state')),
        }));
      case 'review':
        return printSuccess('skills.reviewed', services.skills.update(requireFirst(rest, 'skills review requires an id or name.'), {
          reviewState: 'reviewed',
          reviewedBy: 'goodvibes-agent-cli',
        }));
      case 'delete':
        if (!hasFlag(args, 'yes')) return printFailure('confirmation_required', 'Deleting a skill requires --yes.');
        return printSuccess('skills.deleted', services.skills.delete(requireFirst(rest, 'skills delete requires an id or name.')));
      default:
        return printSuccess('skills.search', services.skills.search(args.positional.join(' ')));
    }
  } catch (error) {
    return printCaughtFailure(error);
  }
}

function handlePersonas(args: ParsedArgs, services: AgentRuntimeServices): number {
  const [action = 'list', ...rest] = args.positional;
  try {
    switch (action) {
      case 'list':
        return printSuccess('personas.list', services.personas.list());
      case 'search':
        return printSuccess('personas.search', services.personas.search(rest.join(' ')));
      case 'create':
      case 'add':
        return printSuccess('personas.created', services.personas.create({
          name: requireFirst(rest, 'personas create requires a name.'),
          title: getFlag(args, 'title'),
          description: getFlag(args, 'description'),
          body: getFlag(args, 'body'),
          tags: parseList(getFlag(args, 'tags')),
          source: getFlag(args, 'source') ?? 'cli',
          provenance: ['cli'],
        }));
      case 'update':
        return printSuccess('personas.updated', services.personas.update(requireFirst(rest, 'personas update requires an id or name.'), {
          name: getFlag(args, 'name'),
          title: getFlag(args, 'title'),
          description: getFlag(args, 'description'),
          body: getFlag(args, 'body'),
          tags: parseList(getFlag(args, 'tags')),
          source: getFlag(args, 'source'),
          reviewState: parsePersonaReviewState(getFlag(args, 'review-state')),
        }));
      case 'review':
        return printSuccess('personas.reviewed', services.personas.update(requireFirst(rest, 'personas review requires an id or name.'), {
          reviewState: 'reviewed',
          reviewedBy: 'goodvibes-agent-cli',
        }));
      case 'delete':
        if (!hasFlag(args, 'yes')) return printFailure('confirmation_required', 'Deleting a persona requires --yes.');
        return printSuccess('personas.deleted', services.personas.delete(requireFirst(rest, 'personas delete requires an id or name.')));
      default:
        return printSuccess('personas.search', services.personas.search(args.positional.join(' ')));
    }
  } catch (error) {
    return printCaughtFailure(error);
  }
}

function requireFirst(values: readonly string[], message: string): string {
  const value = values[0]?.trim();
  if (!value) throw new Error(message);
  return value;
}

function parseList(value: string | undefined): readonly string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseNumberFlag(args: ParsedArgs, name: string): number | undefined {
  const value = getFlag(args, name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number for --${name}: ${value}`);
  return parsed;
}

function parseMemoryScope(value: string | undefined): MemoryScope | undefined {
  return parseEnum(value, ['session', 'project', 'team'], 'memory scope');
}

function parseMemoryClass(value: string | undefined): MemoryClass | undefined {
  return parseEnum(value, ['decision', 'constraint', 'incident', 'pattern', 'fact', 'risk', 'runbook', 'architecture', 'ownership'], 'memory class');
}

function parseMemoryReviewState(value: string | undefined): MemoryReviewState | undefined {
  return parseEnum(value, ['fresh', 'reviewed', 'stale', 'contradicted'], 'memory review state');
}

function parseMemorySensitivity(value: string | undefined): MemorySensitivity | undefined {
  return parseEnum(value, ['public', 'project', 'private', 'secret'], 'memory sensitivity');
}

function parseSkillReviewState(value: string | undefined): SkillReviewState | undefined {
  return parseEnum(value, ['fresh', 'reviewed', 'stale'], 'skill review state');
}

function parsePersonaReviewState(value: string | undefined): PersonaReviewState | undefined {
  return parseEnum(value, ['fresh', 'reviewed', 'stale'], 'persona review state');
}

function parseEnum<const T extends string>(value: string | undefined, allowed: readonly T[], label: string): T | undefined {
  if (!value) return undefined;
  const match = allowed.find((item) => item === value);
  if (!match) throw new Error(`Invalid ${label}: ${value}`);
  return match;
}
