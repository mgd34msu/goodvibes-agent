import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { ShellPathService } from '@/runtime/index.ts';
import {
  MemoryRegistry,
  type MemoryClass,
  type MemoryRecord,
  type MemoryScope,
} from '@pellux/goodvibes-sdk/platform/state';
import { AgentPersonaRegistry, type AgentPersonaRecord } from '../agent/persona-registry.ts';
import { AgentNoteRegistry, type AgentNoteRecord } from '../agent/note-registry.ts';
import { AgentRoutineRegistry, type AgentRoutineRecord } from '../agent/routine-registry.ts';
import { AgentSkillRegistry, type AgentSkillBundleRecord, type AgentSkillRecord } from '../agent/skill-registry.ts';
import { assertNoSecretLikeMemoryText } from '../agent/memory-safety.ts';

export type AgentLocalRegistryDomain = 'memory' | 'note' | 'persona' | 'skill' | 'skill_bundle' | 'routine';
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
  readonly cls?: unknown;
  readonly scope?: unknown;
  readonly summary?: unknown;
  readonly detail?: unknown;
  readonly confidence?: unknown;
  readonly title?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly body?: unknown;
  readonly sourceUrl?: unknown;
  readonly procedure?: unknown;
  readonly steps?: unknown;
  readonly skills?: unknown;
  readonly skillIds?: unknown;
  readonly triggers?: unknown;
  readonly tags?: unknown;
  readonly reason?: unknown;
  readonly enabled?: unknown;
  readonly provenance?: unknown;
}

const DOMAINS: readonly AgentLocalRegistryDomain[] = ['memory', 'note', 'persona', 'skill', 'skill_bundle', 'routine'];
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
const MEMORY_CLASSES: readonly MemoryClass[] = ['decision', 'constraint', 'incident', 'pattern', 'fact', 'risk', 'runbook', 'architecture', 'ownership'];
const MEMORY_SCOPES: readonly MemoryScope[] = ['session', 'project', 'team'];

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

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readOptionalConfidence(value: unknown): number | undefined {
  const confidence = readOptionalNumber(value);
  if (confidence === undefined) return undefined;
  if (confidence < 0 || confidence > 100) throw new Error('confidence must be between 0 and 100.');
  return confidence;
}

function isMemoryClass(value: unknown): value is MemoryClass {
  return typeof value === 'string' && MEMORY_CLASSES.includes(value as MemoryClass);
}

function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === 'string' && MEMORY_SCOPES.includes(value as MemoryScope);
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

function requireTextField(value: unknown, fieldName: string): string {
  const text = readString(value);
  if (!text) throw new Error(`${fieldName} is required.`);
  return text;
}

function requireSummary(args: AgentLocalRegistryToolArgs): string {
  const summary = readString(args.summary || args.description);
  if (!summary) throw new Error('summary is required.');
  return summary;
}

function requireMemoryClass(args: AgentLocalRegistryToolArgs): MemoryClass {
  const cls = args.cls || 'fact';
  if (!isMemoryClass(cls)) throw new Error(`Invalid memory class. Valid: ${MEMORY_CLASSES.join(', ')}.`);
  return cls;
}

function readMemoryScope(args: AgentLocalRegistryToolArgs): MemoryScope {
  const scope = args.scope || 'project';
  if (!isMemoryScope(scope)) throw new Error(`Invalid memory scope. Valid: ${MEMORY_SCOPES.join(', ')}.`);
  return scope;
}

function formatMemory(record: MemoryRecord): string {
  const tags = record.tags.length > 0 ? ` tags=${record.tags.join(',')}` : '';
  return `${record.id}  ${record.scope}/${record.cls}  ${record.reviewState}  ${record.confidence}%${tags}  ${record.summary}`;
}

async function handleMemory(registry: MemoryRegistry, action: AgentLocalRegistryAction, args: AgentLocalRegistryToolArgs): Promise<string> {
    if (action === 'list') {
      const records = registry.getAll();
      return records.length === 0
        ? 'Agent-local memory\nNo Agent-local memory records.'
        : ['Agent-local memory', ...records.map(formatMemory)].join('\n');
    }
    if (action === 'search') {
      const query = readString(args.query);
      const records = registry.search({ query, limit: 10 });
      return records.length === 0
        ? `Agent-local memory search\nNo Agent-local memory records matched "${query}".`
        : [`Agent-local memory search: ${query || '(all)'}`, ...records.map(formatMemory)].join('\n');
    }
    if (action === 'get') {
      const record = registry.get(requireId(args));
      if (!record) return `Unknown Agent-local memory: ${readString(args.id)}`;
      return [
        formatMemory(record),
        `created: ${new Date(record.createdAt).toISOString()}`,
        `updated: ${new Date(record.updatedAt).toISOString()}`,
        `provenance: ${record.provenance.map((entry) => `${entry.kind}:${entry.ref}`).join(', ') || '(none)'}`,
        '',
        record.detail || '(no detail)',
      ].join('\n');
    }
    if (action === 'create') {
      const summary = requireSummary(args);
      const detail = readString(args.detail || args.body);
      const tags = readStringList(args.tags);
      assertNoSecretLikeMemoryText([summary, detail, ...tags]);
      const record = await registry.add({
        scope: readMemoryScope(args),
        cls: requireMemoryClass(args),
        summary,
        detail,
        tags: [...tags],
        provenance: [{ kind: 'event', ref: readString(args.provenance) || 'agent-local-registry-tool' }],
      });
      return `Created Agent-local memory ${record.id}: ${record.summary}`;
    }
    if (action === 'update') {
      const summary = readString(args.summary || args.description);
      const detail = readString(args.detail || args.body);
      const tags = args.tags === undefined ? undefined : [...readStringList(args.tags)];
      assertNoSecretLikeMemoryText([summary, detail, ...(tags ?? [])]);
      const record = registry.update(requireId(args), {
        summary: summary || undefined,
        detail: detail || undefined,
        tags,
        scope: args.scope === undefined ? undefined : readMemoryScope(args),
      });
      if (!record) return `Unknown Agent-local memory: ${readString(args.id)}`;
      return `Updated Agent-local memory ${record.id}: ${record.summary}`;
    }
    if (action === 'review') {
      const record = registry.review(requireId(args), {
        state: 'reviewed',
        confidence: readOptionalConfidence(args.confidence),
        reviewedBy: 'agent',
      });
      if (!record) return `Unknown Agent-local memory: ${readString(args.id)}`;
      return `Reviewed Agent-local memory ${record.id}.`;
    }
    if (action === 'stale') {
      const record = registry.review(requireId(args), {
        state: 'stale',
        staleReason: readString(args.reason) || 'Marked stale by Agent.',
      });
      if (!record) return `Unknown Agent-local memory: ${readString(args.id)}`;
      return `Marked Agent-local memory ${record.id} stale.`;
    }
    throw new Error(`Action ${action} is not valid for memory.`);
}

function formatNote(note: AgentNoteRecord): string {
  const tags = note.tags.length > 0 ? ` tags=${note.tags.join(',')}` : '';
  const sourceUrl = note.sourceUrl ? ` source=${note.sourceUrl}` : '';
  return `${note.id}  ${note.reviewState}  ${note.source}${tags}${sourceUrl}  ${note.title}`;
}

function listNotes(records: readonly AgentNoteRecord[], title: string): string {
  return records.length === 0
    ? `${title}\nNo Agent-local notes.`
    : [title, ...records.map(formatNote)].join('\n');
}

function handleNote(shellPaths: ShellPathService, action: AgentLocalRegistryAction, args: AgentLocalRegistryToolArgs): string {
  const registry = AgentNoteRegistry.fromShellPaths(shellPaths);
  if (action === 'list') return listNotes(registry.list(), 'Agent-local notes');
  if (action === 'search') return listNotes(registry.search(readString(args.query)), 'Agent-local notes search');
  if (action === 'get') {
    const note = registry.get(requireId(args));
    if (!note) return `Unknown Agent-local note: ${readString(args.id)}`;
    return [
      formatNote(note),
      `created: ${note.createdAt}`,
      `updated: ${note.updatedAt}`,
      `provenance: ${note.provenance}`,
      '',
      note.body,
    ].join('\n');
  }
  if (action === 'create') {
    const note = registry.create({
      title: requireTextField(args.title ?? args.name ?? args.summary, 'title'),
      body: requireTextField(args.body ?? args.detail ?? args.description, 'body'),
      tags: readStringList(args.tags),
      sourceUrl: readString(args.sourceUrl) || undefined,
      source: 'agent',
      provenance: readString(args.provenance) || 'agent-local-registry-tool',
    });
    return `Created Agent-local note ${note.id}: ${note.title}`;
  }
  if (action === 'update') {
    const note = registry.update(requireId(args), {
      title: readString(args.title ?? args.name ?? args.summary) || undefined,
      body: readString(args.body ?? args.detail ?? args.description) || undefined,
      tags: args.tags === undefined ? undefined : readStringList(args.tags),
      sourceUrl: args.sourceUrl === undefined ? undefined : readString(args.sourceUrl),
      provenance: readString(args.provenance) || 'agent-local-registry-tool',
    });
    return `Updated Agent-local note ${note.id}: ${note.title}`;
  }
  if (action === 'review') return `Reviewed Agent-local note ${registry.markReviewed(requireId(args)).id}.`;
  if (action === 'stale') return `Marked Agent-local note ${registry.markStale(requireId(args), readString(args.reason)).id} stale.`;
  throw new Error(`Action ${action} is not valid for notes.`);
}

function formatPersona(persona: AgentPersonaRecord, activeId: string | null): string {
  const active = persona.id === activeId ? 'active' : 'inactive';
  return `${persona.id}  ${active}  ${persona.reviewState}  ${persona.name} - ${persona.description}`;
}

function formatSkill(skill: AgentSkillRecord): string {
  const enabled = skill.enabled ? 'enabled' : 'disabled';
  return `${skill.id}  ${enabled}  ${skill.reviewState}  ${skill.name} - ${skill.description}`;
}

function formatSkillBundle(bundle: AgentSkillBundleRecord): string {
  const enabled = bundle.enabled ? 'enabled' : 'disabled';
  return `${bundle.id}  ${enabled}  ${bundle.reviewState}  ${bundle.name} - ${bundle.description} skills=${bundle.skillIds.join(',')}`;
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

function listSkillBundles(records: readonly AgentSkillBundleRecord[], title: string): string {
  return records.length === 0
    ? `${title}\nNo Agent-local skill bundles.`
    : [title, ...records.map(formatSkillBundle)].join('\n');
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
      body: requireTextField(args.body, 'body'),
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
      procedure: requireTextField(args.procedure, 'procedure'),
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

function handleSkillBundle(shellPaths: ShellPathService, action: AgentLocalRegistryAction, args: AgentLocalRegistryToolArgs): string {
  const registry = AgentSkillRegistry.fromShellPaths(shellPaths);
  if (action === 'list') return listSkillBundles(registry.listBundles(), 'Agent-local skill bundles');
  if (action === 'search') return listSkillBundles(registry.searchBundles(readString(args.query)), 'Agent-local skill bundles search');
  if (action === 'get') {
    const bundle = registry.getBundle(requireId(args));
    if (!bundle) return `Unknown Agent-local skill bundle: ${readString(args.id)}`;
    return [
      formatSkillBundle(bundle),
      `skills: ${bundle.skillIds.join(', ')}`,
      '',
      bundle.description,
    ].join('\n');
  }
  if (action === 'create') {
    const bundle = registry.createBundle({
      name: requireName(args),
      description: requireDescription(args),
      skillIds: readStringList(args.skillIds ?? args.skills),
      enabled: args.enabled === true,
      source: 'agent',
      provenance: readString(args.provenance) || 'agent-local-registry-tool',
    });
    return `Created Agent-local skill bundle ${bundle.id}: ${bundle.name}`;
  }
  if (action === 'update') {
    const bundle = registry.updateBundle(requireId(args), {
      name: readString(args.name) || undefined,
      description: readString(args.description) || undefined,
      skillIds: args.skillIds === undefined && args.skills === undefined ? undefined : readStringList(args.skillIds ?? args.skills),
      provenance: readString(args.provenance) || 'agent-local-registry-tool',
    });
    return `Updated Agent-local skill bundle ${bundle.id}: ${bundle.name}`;
  }
  if (action === 'enable' || action === 'disable') {
    const bundle = registry.setBundleEnabled(requireId(args), action === 'enable');
    return `${action === 'enable' ? 'Enabled' : 'Disabled'} Agent-local skill bundle ${bundle.id}: ${bundle.name}`;
  }
  if (action === 'review') return `Reviewed Agent-local skill bundle ${registry.markBundleReviewed(requireId(args)).id}.`;
  if (action === 'stale') return `Marked Agent-local skill bundle ${registry.markBundleStale(requireId(args), readString(args.reason)).id} stale.`;
  throw new Error(`Action ${action} is not valid for skill bundles.`);
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
      steps: requireTextField(args.steps, 'steps'),
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
      'Policy: same main conversation; no hidden background job, connected-host mutation, or external side effect was started.',
      '',
      routine.steps,
    ].join('\n');
  }
  if (action === 'review') return `Reviewed Agent-local routine ${registry.markReviewed(requireId(args)).id}.`;
  if (action === 'stale') return `Marked Agent-local routine ${registry.markStale(requireId(args), readString(args.reason)).id} stale.`;
  throw new Error(`Action ${action} is not valid for routines.`);
}

export function createAgentLocalRegistryTool(shellPaths: ShellPathService, memoryRegistry: MemoryRegistry): Tool {
  return {
    definition: {
      name: 'agent_local_registry',
      description: [
        'Inspect and maintain GoodVibes Agent-local notes, memory, personas, skills, and routines from the main conversation.',
        'Use this for safe self-improvement: capture scratchpad notes, remember durable non-secret facts, create or refine reusable behavior, bundle related skills, enable skills/routines, choose personas, review/stale records, and start routines in the same serial conversation.',
        'This tool cannot delete records, create schedules, mutate connected hosts, send messages, run background jobs, or delegate build work.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', enum: [...DOMAINS] },
          action: { type: 'string', enum: [...ACTIONS] },
          id: { type: 'string' },
          query: { type: 'string' },
          cls: { type: 'string', enum: [...MEMORY_CLASSES], description: 'Memory class when domain is memory.' },
          scope: { type: 'string', enum: [...MEMORY_SCOPES], description: 'Memory scope when domain is memory.' },
          summary: { type: 'string', description: 'Memory summary when domain is memory.' },
          detail: { type: 'string', description: 'Memory detail when domain is memory.' },
          confidence: { type: 'number', description: 'Memory review confidence from 0 to 100.' },
          title: { type: 'string', description: 'Note title when domain is note.' },
          name: { type: 'string' },
          description: { type: 'string' },
          body: { type: 'string', description: 'Note body or persona body/instructions.' },
          sourceUrl: { type: 'string', description: 'Optional source URL when domain is note.' },
          procedure: { type: 'string', description: 'Skill procedure.' },
          steps: { type: 'string', description: 'Routine steps.' },
          skills: { type: 'array', items: { type: 'string' }, description: 'Skill ids for skill_bundle create/update.' },
          skillIds: { type: 'array', items: { type: 'string' }, description: 'Skill ids for skill_bundle create/update.' },
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
        if (args.domain === 'memory') return registryOutput(await handleMemory(memoryRegistry, args.action, args));
        if (args.domain === 'note') return registryOutput(handleNote(shellPaths, args.action, args));
        if (args.domain === 'persona') return registryOutput(handlePersona(shellPaths, args.action, args));
        if (args.domain === 'skill') return registryOutput(handleSkill(shellPaths, args.action, args));
        if (args.domain === 'skill_bundle') return registryOutput(handleSkillBundle(shellPaths, args.action, args));
        return registryOutput(handleRoutine(shellPaths, args.action, args));
      } catch (error) {
        return registryError(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function registerAgentLocalRegistryTool(registry: ToolRegistry, shellPaths: ShellPathService, memoryRegistry: MemoryRegistry): void {
  registry.register(createAgentLocalRegistryTool(shellPaths, memoryRegistry));
}
