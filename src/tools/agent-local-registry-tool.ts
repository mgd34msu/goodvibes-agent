import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { ShellPathService } from '@/runtime/index.ts';
import { AgentPersonaRegistry, type AgentPersonaRecord } from '../agent/persona-registry.ts';
import { AgentRoutineRegistry, type AgentRoutineRecord } from '../agent/routine-registry.ts';
import { AgentSkillRegistry, type AgentSkillRecord } from '../agent/skill-registry.ts';

export type AgentLocalRegistryDomain = 'persona' | 'skill' | 'routine';
export type AgentLocalRegistryAction =
  | 'list'
  | 'search'
  | 'get'
  | 'create'
  | 'update'
  | 'enable'
  | 'disable'
  | 'review'
  | 'stale'
  | 'use'
  | 'clear_active'
  | 'start';

export interface AgentLocalRegistryToolArgs {
  readonly domain?: unknown;
  readonly action?: unknown;
  readonly id?: unknown;
  readonly query?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly body?: unknown;
  readonly procedure?: unknown;
  readonly steps?: unknown;
  readonly triggers?: unknown;
  readonly tags?: unknown;
  readonly reason?: unknown;
  readonly enabled?: unknown;
  readonly provenance?: unknown;
}

const DOMAINS: readonly AgentLocalRegistryDomain[] = ['persona', 'skill', 'routine'];
const ACTIONS: readonly AgentLocalRegistryAction[] = [
  'list',
  'search',
  'get',
  'create',
  'update',
  'enable',
  'disable',
  'review',
  'stale',
  'use',
  'clear_active',
  'start',
];

function isDomain(value: unknown): value is AgentLocalRegistryDomain {
  return typeof value === 'string' && DOMAINS.includes(value as AgentLocalRegistryDomain);
}

function isAction(value: unknown): value is AgentLocalRegistryAction {
  return typeof value === 'string' && ACTIONS.includes(value as AgentLocalRegistryAction);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringList(value: unknown): readonly string[] {
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
}

function registryError(message: string): { readonly success: false; readonly error: string } {
  return { success: false, error: message };
}

function registryOutput(output: string): { readonly success: true; readonly output: string } {
  return { success: true, output };
}

function requireId(args: AgentLocalRegistryToolArgs): string {
  const id = readString(args.id);
  if (!id) throw new Error('id is required.');
  return id;
}

function requireName(args: AgentLocalRegistryToolArgs): string {
  const name = readString(args.name);
  if (!name) throw new Error('name is required.');
  return name;
}

function requireDescription(args: AgentLocalRegistryToolArgs): string {
  const description = readString(args.description);
  if (!description) throw new Error('description is required.');
  return description;
}

function formatPersona(persona: AgentPersonaRecord, activeId: string | null): string {
  const active = persona.id === activeId ? 'active' : 'inactive';
  return `${persona.id}  ${active}  ${persona.reviewState}  ${persona.name} - ${persona.description}`;
}

function formatSkill(skill: AgentSkillRecord): string {
  const enabled = skill.enabled ? 'enabled' : 'disabled';
  return `${skill.id}  ${enabled}  ${skill.reviewState}  ${skill.name} - ${skill.description}`;
}

function formatRoutine(routine: AgentRoutineRecord): string {
  const enabled = routine.enabled ? 'enabled' : 'disabled';
  return `${routine.id}  ${enabled}  ${routine.reviewState}  starts=${routine.startCount}  ${routine.name} - ${routine.description}`;
}

function listPersonas(registry: AgentPersonaRegistry, records: readonly AgentPersonaRecord[], title: string): string {
  const snapshot = registry.snapshot();
  return records.length === 0
    ? `${title}\nNo Agent-local personas.`
    : [title, ...records.map((persona) => formatPersona(persona, snapshot.activePersonaId))].join('\n');
}

function listSkills(records: readonly AgentSkillRecord[], title: string): string {
  return records.length === 0
    ? `${title}\nNo Agent-local skills.`
    : [title, ...records.map(formatSkill)].join('\n');
}

function listRoutines(records: readonly AgentRoutineRecord[], title: string): string {
  return records.length === 0
    ? `${title}\nNo Agent-local routines.`
    : [title, ...records.map(formatRoutine)].join('\n');
}

function handlePersona(shellPaths: ShellPathService, action: AgentLocalRegistryAction, args: AgentLocalRegistryToolArgs): string {
  const registry = AgentPersonaRegistry.fromShellPaths(shellPaths);
  if (action === 'list') return listPersonas(registry, registry.list(), 'Agent-local personas');
  if (action === 'search') return listPersonas(registry, registry.search(readString(args.query)), 'Agent-local personas search');
  if (action === 'get') {
    const persona = registry.get(requireId(args));
    if (!persona) return `Unknown Agent-local persona: ${readString(args.id)}`;
    return [
      formatPersona(persona, registry.snapshot().activePersonaId),
      `triggers: ${persona.triggers.join(', ') || '(manual)'}`,
      `tags: ${persona.tags.join(', ') || '(none)'}`,
      '',
      persona.body,
    ].join('\n');
  }
  if (action === 'create') {
    const persona = registry.create({
      name: requireName(args),
      description: requireDescription(args),
      body: readString(args.body),
      tags: readStringList(args.tags),
      triggers: readStringList(args.triggers),
      source: 'agent',
      provenance: readString(args.provenance) || 'agent-local-registry-tool',
    });
    return `Created Agent-local persona ${persona.id}: ${persona.name}`;
  }
  if (action === 'update') {
    const persona = registry.update(requireId(args), {
      name: readString(args.name) || undefined,
      description: readString(args.description) || undefined,
      body: readString(args.body) || undefined,
      tags: args.tags === undefined ? undefined : readStringList(args.tags),
      triggers: args.triggers === undefined ? undefined : readStringList(args.triggers),
      provenance: readString(args.provenance) || 'agent-local-registry-tool',
    });
    return `Updated Agent-local persona ${persona.id}: ${persona.name}`;
  }
  if (action === 'use') {
    const persona = registry.setActive(requireId(args));
    return `Active Agent-local persona set to ${persona.id}: ${persona.name}`;
  }
  if (action === 'clear_active') {
    registry.clearActive();
    return 'Cleared active Agent-local persona.';
  }
  if (action === 'review') return `Reviewed Agent-local persona ${registry.markReviewed(requireId(args)).id}.`;
  if (action === 'stale') return `Marked Agent-local persona ${registry.markStale(requireId(args), readString(args.reason)).id} stale.`;
  throw new Error(`Action ${action} is not valid for personas.`);
}

function handleSkill(shellPaths: ShellPathService, action: AgentLocalRegistryAction, args: AgentLocalRegistryToolArgs): string {
  const registry = AgentSkillRegistry.fromShellPaths(shellPaths);
  if (action === 'list') return listSkills(registry.list(), 'Agent-local skills');
  if (action === 'search') return listSkills(registry.search(readString(args.query)), 'Agent-local skills search');
  if (action === 'get') {
    const skill = registry.get(requireId(args));
    if (!skill) return `Unknown Agent-local skill: ${readString(args.id)}`;
    return [
      formatSkill(skill),
      `triggers: ${skill.triggers.join(', ') || '(manual)'}`,
      `tags: ${skill.tags.join(', ') || '(none)'}`,
      '',
      skill.procedure,
    ].join('\n');
  }
  if (action === 'create') {
    const skill = registry.create({
      name: requireName(args),
      description: requireDescription(args),
      procedure: readString(args.procedure),
      triggers: readStringList(args.triggers),
      tags: readStringList(args.tags),
      enabled: args.enabled === true,
      source: 'agent',
      provenance: readString(args.provenance) || 'agent-local-registry-tool',
    });
    return `Created Agent-local skill ${skill.id}: ${skill.name}`;
  }
  if (action === 'update') {
    const skill = registry.update(requireId(args), {
      name: readString(args.name) || undefined,
      description: readString(args.description) || undefined,
      procedure: readString(args.procedure) || undefined,
      triggers: args.triggers === undefined ? undefined : readStringList(args.triggers),
      tags: args.tags === undefined ? undefined : readStringList(args.tags),
      provenance: readString(args.provenance) || 'agent-local-registry-tool',
    });
    return `Updated Agent-local skill ${skill.id}: ${skill.name}`;
  }
  if (action === 'enable' || action === 'disable') {
    const skill = registry.setEnabled(requireId(args), action === 'enable');
    return `${action === 'enable' ? 'Enabled' : 'Disabled'} Agent-local skill ${skill.id}: ${skill.name}`;
  }
  if (action === 'review') return `Reviewed Agent-local skill ${registry.markReviewed(requireId(args)).id}.`;
  if (action === 'stale') return `Marked Agent-local skill ${registry.markStale(requireId(args), readString(args.reason)).id} stale.`;
  throw new Error(`Action ${action} is not valid for skills.`);
}

function handleRoutine(shellPaths: ShellPathService, action: AgentLocalRegistryAction, args: AgentLocalRegistryToolArgs): string {
  const registry = AgentRoutineRegistry.fromShellPaths(shellPaths);
  if (action === 'list') return listRoutines(registry.list(), 'Agent-local routines');
  if (action === 'search') return listRoutines(registry.search(readString(args.query)), 'Agent-local routines search');
  if (action === 'get') {
    const routine = registry.get(requireId(args));
    if (!routine) return `Unknown Agent-local routine: ${readString(args.id)}`;
    return [
      formatRoutine(routine),
      `triggers: ${routine.triggers.join(', ') || '(manual)'}`,
      `tags: ${routine.tags.join(', ') || '(none)'}`,
      '',
      routine.steps,
    ].join('\n');
  }
  if (action === 'create') {
    const routine = registry.create({
      name: requireName(args),
      description: requireDescription(args),
      steps: readString(args.steps),
      triggers: readStringList(args.triggers),
      tags: readStringList(args.tags),
      enabled: args.enabled === true,
      source: 'agent',
      provenance: readString(args.provenance) || 'agent-local-registry-tool',
    });
    return `Created Agent-local routine ${routine.id}: ${routine.name}`;
  }
  if (action === 'update') {
    const routine = registry.update(requireId(args), {
      name: readString(args.name) || undefined,
      description: readString(args.description) || undefined,
      steps: readString(args.steps) || undefined,
      triggers: args.triggers === undefined ? undefined : readStringList(args.triggers),
      tags: args.tags === undefined ? undefined : readStringList(args.tags),
      provenance: readString(args.provenance) || 'agent-local-registry-tool',
    });
    return `Updated Agent-local routine ${routine.id}: ${routine.name}`;
  }
  if (action === 'enable' || action === 'disable') {
    const routine = registry.setEnabled(requireId(args), action === 'enable');
    return `${action === 'enable' ? 'Enabled' : 'Disabled'} Agent-local routine ${routine.id}: ${routine.name}`;
  }
  if (action === 'start') {
    const routine = registry.markStarted(requireId(args));
    return [
      `Started Agent-local routine ${routine.id}: ${routine.name}`,
      'Policy: same main conversation; no hidden background job, daemon mutation, or external side effect was started.',
      '',
      routine.steps,
    ].join('\n');
  }
  if (action === 'review') return `Reviewed Agent-local routine ${registry.markReviewed(requireId(args)).id}.`;
  if (action === 'stale') return `Marked Agent-local routine ${registry.markStale(requireId(args), readString(args.reason)).id} stale.`;
  throw new Error(`Action ${action} is not valid for routines.`);
}

export function createAgentLocalRegistryTool(shellPaths: ShellPathService): Tool {
  return {
    definition: {
      name: 'agent_local_registry',
      description: [
        'Inspect and maintain GoodVibes Agent-local personas, skills, and routines from the main conversation.',
        'Use this for safe self-improvement: create or refine reusable behavior, enable skills/routines, choose personas, review/stale records, and start routines in the same serial conversation.',
        'This tool cannot delete records, create schedules, mutate the daemon, send messages, run background jobs, or delegate build work.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', enum: [...DOMAINS] },
          action: { type: 'string', enum: [...ACTIONS] },
          id: { type: 'string' },
          query: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          body: { type: 'string', description: 'Persona body/instructions.' },
          procedure: { type: 'string', description: 'Skill procedure.' },
          steps: { type: 'string', description: 'Routine steps.' },
          triggers: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
          enabled: { type: 'boolean' },
          provenance: { type: 'string' },
        },
        required: ['domain', 'action'],
        additionalProperties: false,
      },
      sideEffects: ['state'],
    },
    execute: async (rawArgs: unknown) => {
      const args = rawArgs as AgentLocalRegistryToolArgs;
      if (!isDomain(args.domain)) return registryError(`Unknown domain. Valid: ${DOMAINS.join(', ')}.`);
      if (!isAction(args.action)) return registryError(`Unknown action. Valid: ${ACTIONS.join(', ')}.`);
      try {
        if (args.domain === 'persona') return registryOutput(handlePersona(shellPaths, args.action, args));
        if (args.domain === 'skill') return registryOutput(handleSkill(shellPaths, args.action, args));
        return registryOutput(handleRoutine(shellPaths, args.action, args));
      } catch (error) {
        return registryError(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function registerAgentLocalRegistryTool(registry: ToolRegistry, shellPaths: ShellPathService): void {
  registry.register(createAgentLocalRegistryTool(shellPaths));
}
