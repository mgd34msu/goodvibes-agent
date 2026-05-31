import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';
import { AgentPersonaRegistry } from './persona-registry.ts';
import { AgentRoutineRegistry } from './routine-registry.ts';
import { AgentSkillRegistry } from './skill-registry.ts';

export type AgentRuntimeProfileTemplateId = 'household' | 'research' | 'travel' | 'operations' | 'personal-productivity';

export interface AgentRuntimeProfileTemplateSummary {
  readonly id: AgentRuntimeProfileTemplateId;
  readonly name: string;
  readonly description: string;
  readonly personaName: string;
  readonly skillNames: readonly string[];
  readonly routineNames: readonly string[];
}

export interface AgentRuntimeProfileResolution {
  readonly id: string;
  readonly homeDirectory: string;
}

export interface AgentRuntimeProfileInfo extends AgentRuntimeProfileResolution {
  readonly createdAt: string | null;
  readonly starterTemplateId?: AgentRuntimeProfileTemplateId;
  readonly starterTemplateName?: string;
  readonly starterTemplateApplication?: AgentRuntimeProfileTemplateApplication;
}

export interface AgentRuntimeProfileTemplateApplication {
  readonly id: AgentRuntimeProfileTemplateId;
  readonly name: string;
  readonly appliedAt: string;
  readonly personaIds: readonly string[];
  readonly skillIds: readonly string[];
  readonly routineIds: readonly string[];
}

export interface CreateAgentRuntimeProfileOptions {
  readonly templateId?: AgentRuntimeProfileTemplateId;
}

export interface AgentRuntimeProfileCommandResult {
  readonly ok: boolean;
  readonly kind:
    | 'agent.profiles.list'
    | 'agent.profiles.show'
    | 'agent.profiles.templates'
    | 'agent.profiles.create'
    | 'agent.profiles.delete'
    | 'agent.profiles.error';
  readonly data?: {
    readonly profiles?: readonly AgentRuntimeProfileInfo[];
    readonly profile?: AgentRuntimeProfileInfo;
    readonly templates?: readonly AgentRuntimeProfileTemplateSummary[];
    readonly appliedTemplate?: AgentRuntimeProfileTemplateApplication;
    readonly nextCommand?: string;
  };
  readonly error?: string;
}

const PROFILE_CREATED_FILE = 'profile.json';
const PROFILE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

interface AgentRuntimeProfileStarterTemplate extends AgentRuntimeProfileTemplateSummary {
  readonly persona: {
    readonly name: string;
    readonly description: string;
    readonly body: string;
    readonly tags: readonly string[];
    readonly triggers: readonly string[];
  };
  readonly skills: readonly {
    readonly name: string;
    readonly description: string;
    readonly procedure: string;
    readonly triggers: readonly string[];
    readonly tags: readonly string[];
  }[];
  readonly routines: readonly {
    readonly name: string;
    readonly description: string;
    readonly steps: string;
    readonly triggers: readonly string[];
    readonly tags: readonly string[];
  }[];
}

const STARTER_TEMPLATES: readonly AgentRuntimeProfileStarterTemplate[] = [
  {
    id: 'household',
    name: 'Household Operator',
    description: 'Coordinate household tasks, home service checks, shared routines, and family logistics.',
    personaName: 'Household Operator',
    skillNames: ['Household Triage', 'Home Service Check'],
    routineNames: ['Weekly Household Review'],
    persona: {
      name: 'Household Operator',
      description: 'Practical assistant for home operations, shared chores, services, and family logistics.',
      body: [
        'Operate as a calm household coordinator.',
        'Track preferences, routines, device/service notes, and recurring decisions in Agent-local memory after they are durable and non-secret.',
        'Use read-only daemon/operator routes for status checks. Require explicit approval for purchases, messages to other people, service changes, deletions, or secret handling.',
        'Keep replies concrete: next action, owner, date, and open question when one is needed.',
      ].join('\n'),
      tags: ['household', 'home', 'coordination'],
      triggers: ['home', 'household', 'family', 'chores', 'errands'],
    },
    skills: [
      {
        name: 'Household Triage',
        description: 'Turn a household request into owner, urgency, next step, and reminder/delegation posture.',
        procedure: [
          '1. Identify whether the task is information, coordination, purchase, repair, or reminder.',
          '2. Check Agent-local memory for known preferences or constraints before asking repeat questions.',
          '3. Propose the next non-destructive action. Ask before external messages, payments, account changes, or device/service changes.',
          '4. Record durable non-secret decisions locally with provenance.',
        ].join('\n'),
        triggers: ['plan household', 'home task', 'family logistics'],
        tags: ['household', 'triage'],
      },
      {
        name: 'Home Service Check',
        description: 'Review configured services and surface actionable household status without taking hidden action.',
        procedure: [
          '1. Inspect configured read-only status, approval, schedule, and knowledge routes.',
          '2. Summarize degraded services, pending approvals, and stale routines.',
          '3. Suggest explicit commands for approved follow-up instead of mutating services directly.',
        ].join('\n'),
        triggers: ['home status', 'service check', 'household check'],
        tags: ['household', 'ops'],
      },
    ],
    routines: [
      {
        name: 'Weekly Household Review',
        description: 'Review open household commitments, pending approvals, and stale home notes.',
        steps: [
          '1. List pending local routines, workplan tasks, and approvals.',
          '2. Summarize what changed since the last review from local Agent state.',
          '3. Ask for confirmation before scheduling, sending messages, purchasing, or changing services.',
          '4. Record reviewed preferences and stale notes locally.',
        ].join('\n'),
        triggers: ['weekly review', 'household review'],
        tags: ['household', 'review'],
      },
    ],
  },
  {
    id: 'research',
    name: 'Research Analyst',
    description: 'Source-grounded research, brief generation, question tracking, and evidence review.',
    personaName: 'Research Analyst',
    skillNames: ['Source-grounded Brief', 'Research Gap Tracker'],
    routineNames: ['Research Packet Review'],
    persona: {
      name: 'Research Analyst',
      description: 'Evidence-first analyst for research questions, summaries, and decision support.',
      body: [
        'Prefer primary sources and cite provenance clearly.',
        'Use Agent Knowledge only through the isolated Agent knowledge routes.',
        'Separate findings, confidence, gaps, and recommendations.',
        'Do not store secrets or unsupported claims as durable knowledge.',
      ].join('\n'),
      tags: ['research', 'analysis', 'evidence'],
      triggers: ['research', 'brief', 'compare', 'investigate'],
    },
    skills: [
      {
        name: 'Source-grounded Brief',
        description: 'Produce concise findings with source provenance and confidence.',
        procedure: [
          '1. Clarify the decision or question if the request is ambiguous.',
          '2. Search current sources when freshness matters.',
          '3. Return answer, evidence, confidence, gaps, and suggested follow-up.',
          '4. Save durable, reviewed, non-secret facts to Agent-local memory only when useful later.',
        ].join('\n'),
        triggers: ['brief me', 'research this', 'compare options'],
        tags: ['research', 'briefing'],
      },
      {
        name: 'Research Gap Tracker',
        description: 'Maintain open research questions and stale assumptions.',
        procedure: [
          '1. Extract unknowns, weak evidence, and stale facts from the current task.',
          '2. Convert actionable follow-up into workplan or local routine guidance only after explicit user direction.',
          '3. Mark resolved gaps with source and date.',
        ].join('\n'),
        triggers: ['research gaps', 'unknowns', 'follow up'],
        tags: ['research', 'quality'],
      },
    ],
    routines: [
      {
        name: 'Research Packet Review',
        description: 'Review recent research notes for stale assumptions and missing citations.',
        steps: [
          '1. Inspect local memory/skills/personas relevant to the current topic.',
          '2. Identify claims lacking provenance.',
          '3. Recommend refresh searches for time-sensitive claims.',
          '4. Mark stale local notes instead of deleting them without explicit command intent.',
        ].join('\n'),
        triggers: ['review research', 'research packet'],
        tags: ['research', 'review'],
      },
    ],
  },
  {
    id: 'travel',
    name: 'Travel Planner',
    description: 'Trip planning, itinerary decisions, packing, local constraints, and travel follow-through.',
    personaName: 'Travel Planner',
    skillNames: ['Trip Decision Matrix', 'Travel Checklist Builder'],
    routineNames: ['Pre-trip Readiness Review'],
    persona: {
      name: 'Travel Planner',
      description: 'Travel planning assistant focused on constraints, itinerary tradeoffs, and readiness.',
      body: [
        'Track destinations, dates, preferences, constraints, and open decisions locally.',
        'Search current details for prices, schedules, visa/rule changes, weather, and safety.',
        'Ask before bookings, purchases, external messages, or account changes.',
        'Keep recommendations practical and time-aware.',
      ].join('\n'),
      tags: ['travel', 'planning', 'logistics'],
      triggers: ['trip', 'travel', 'itinerary', 'flight', 'hotel'],
    },
    skills: [
      {
        name: 'Trip Decision Matrix',
        description: 'Compare travel options against user constraints and live facts.',
        procedure: [
          '1. List hard constraints: dates, budget, location, accessibility, work needs, and risk tolerance.',
          '2. Search current schedule/price/rule data when decisions depend on fresh details.',
          '3. Present ranked options with tradeoffs and next checks.',
          '4. Ask for confirmation before bookings or payments.',
        ].join('\n'),
        triggers: ['choose travel', 'compare hotels', 'compare flights'],
        tags: ['travel', 'decision'],
      },
      {
        name: 'Travel Checklist Builder',
        description: 'Create trip-specific prep lists and reminders from known constraints.',
        procedure: [
          '1. Infer trip type and constraints from the current conversation and local memory.',
          '2. Build checklist sections for documents, packing, transport, lodging, work, health, and communications.',
          '3. Keep tasks local until the user explicitly requests scheduling or external coordination.',
        ].join('\n'),
        triggers: ['packing list', 'trip checklist', 'travel prep'],
        tags: ['travel', 'checklist'],
      },
    ],
    routines: [
      {
        name: 'Pre-trip Readiness Review',
        description: 'Check documents, reservations, transport, packing, weather, and open decisions.',
        steps: [
          '1. Review trip dates, locations, reservations, and open decisions from local Agent state.',
          '2. Refresh current weather, schedule, and rule data when needed.',
          '3. Summarize blockers and next confirmed action.',
          '4. Ask before external sends, purchases, or reservation changes.',
        ].join('\n'),
        triggers: ['pre trip review', 'before travel'],
        tags: ['travel', 'review'],
      },
    ],
  },
  {
    id: 'operations',
    name: 'Operations Lead',
    description: 'Operational monitoring, incident triage, approvals, schedules, and service health.',
    personaName: 'Operations Lead',
    skillNames: ['Incident Intake', 'Approval Review'],
    routineNames: ['Daily Operations Sweep'],
    persona: {
      name: 'Operations Lead',
      description: 'Operator persona for systems, incidents, runbooks, approvals, and service posture.',
      body: [
        'Favor explicit state, logs, health, approvals, and next action.',
        'Use read-only daemon/operator routes by default.',
        'Require explicit confirmation for run, pause, resume, cancel, retry, approve, deny, service changes, or writes.',
        'Delegate code/build fixes to GoodVibes TUI when explicitly requested.',
      ].join('\n'),
      tags: ['operations', 'incident', 'runbook'],
      triggers: ['incident', 'ops', 'approval', 'automation', 'service'],
    },
    skills: [
      {
        name: 'Incident Intake',
        description: 'Convert a symptom into severity, suspected system, evidence, and next safe checks.',
        procedure: [
          '1. Identify symptom, affected surface, time window, severity, and user impact.',
          '2. Pull read-only status, approvals, schedules, runs, and workplan summaries.',
          '3. Separate evidence from hypothesis.',
          '4. Ask before mutating services, automation, schedules, or approvals.',
        ].join('\n'),
        triggers: ['incident', 'outage', 'broken', 'triage'],
        tags: ['operations', 'incident'],
      },
      {
        name: 'Approval Review',
        description: 'Summarize pending approvals with risk, route, and required decision.',
        procedure: [
          '1. List pending approvals and classify risk labels.',
          '2. Explain what each approval would allow.',
          '3. Only approve, deny, or cancel from exact user command with confirmation.',
        ].join('\n'),
        triggers: ['approvals', 'pending approval', 'review approvals'],
        tags: ['operations', 'approvals'],
      },
    ],
    routines: [
      {
        name: 'Daily Operations Sweep',
        description: 'Inspect service posture, pending approvals, failed runs, and stale tasks.',
        steps: [
          '1. Refresh daemon status, compat, approvals, workplan, automation snapshot, runs, schedules, and capacity.',
          '2. Summarize degraded items and blocked work.',
          '3. Recommend exact follow-up commands with confirmation gates for side effects.',
        ].join('\n'),
        triggers: ['daily ops', 'operations sweep'],
        tags: ['operations', 'review'],
      },
    ],
  },
  {
    id: 'personal-productivity',
    name: 'Personal Productivity',
    description: 'Task capture, weekly planning, focus blocks, reminders, and decision hygiene.',
    personaName: 'Personal Productivity Coach',
    skillNames: ['Inbox Zero Triage', 'Focus Block Planner'],
    routineNames: ['Weekly Personal Planning'],
    persona: {
      name: 'Personal Productivity Coach',
      description: 'Personal assistant for task capture, planning, prioritization, and follow-through.',
      body: [
        'Keep planning lightweight and action-oriented.',
        'Capture durable preferences, commitments, and constraints locally when they are useful later.',
        'Prefer one clear next action over broad plans.',
        'Ask before sending messages, spending money, changing services, or deleting records.',
      ].join('\n'),
      tags: ['productivity', 'planning', 'personal'],
      triggers: ['plan my day', 'prioritize', 'tasks', 'focus'],
    },
    skills: [
      {
        name: 'Inbox Zero Triage',
        description: 'Sort loose tasks into do, delegate, defer, drop, or ask-for-info.',
        procedure: [
          '1. Capture each item as an outcome and next action.',
          '2. Classify by urgency, effort, dependency, and consequence.',
          '3. Recommend a short ordered list for today and parking lot for later.',
          '4. Store durable commitments locally with source and date.',
        ].join('\n'),
        triggers: ['triage tasks', 'organize tasks', 'inbox'],
        tags: ['productivity', 'triage'],
      },
      {
        name: 'Focus Block Planner',
        description: 'Design realistic focus blocks around constraints and energy.',
        procedure: [
          '1. Identify available time, constraints, and high-value outcome.',
          '2. Split work into 25-90 minute blocks with breakpoints.',
          '3. Keep schedule changes local unless the user explicitly asks for calendar or external updates.',
        ].join('\n'),
        triggers: ['focus block', 'plan my day', 'deep work'],
        tags: ['productivity', 'focus'],
      },
    ],
    routines: [
      {
        name: 'Weekly Personal Planning',
        description: 'Review commitments, priorities, routines, and open decisions for the week.',
        steps: [
          '1. Review local tasks, routines, memory, and recent decisions.',
          '2. Identify top outcomes, blockers, and decisions needed from the user.',
          '3. Suggest a small weekly plan and ask before creating external reminders or sending messages.',
        ].join('\n'),
        triggers: ['weekly planning', 'plan my week'],
        tags: ['productivity', 'review'],
      },
    ],
  },
];

export function normalizeAgentRuntimeProfileId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .replace(/[-_]{2,}/g, '-');
}

export function assertValidAgentRuntimeProfileId(value: string): string {
  const raw = value.trim();
  if (raw.includes('..') || raw.includes('/') || raw.includes('\\')) {
    throw new Error('Agent profile names cannot contain path traversal sequences.');
  }
  const normalized = normalizeAgentRuntimeProfileId(value);
  if (!PROFILE_ID_PATTERN.test(normalized)) {
    throw new Error('Agent profile names must normalize to 1-64 lowercase letters, numbers, dots, underscores, or dashes.');
  }
  return normalized;
}

export function getAgentRuntimeProfilesRoot(baseHomeDirectory: string): string {
  return join(baseHomeDirectory, '.goodvibes', 'agent', 'profile-homes');
}

export function resolveAgentRuntimeProfileHome(baseHomeDirectory: string, profileName: string): AgentRuntimeProfileResolution {
  const id = assertValidAgentRuntimeProfileId(profileName);
  return {
    id,
    homeDirectory: join(getAgentRuntimeProfilesRoot(baseHomeDirectory), id),
  };
}

function readProfileCreatedAt(homeDirectory: string): string | null {
  const path = join(homeDirectory, PROFILE_CREATED_FILE);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    if (raw && typeof raw === 'object' && typeof raw.createdAt === 'string') return raw.createdAt;
  } catch {
    return null;
  }
  return null;
}

function readProfileStarterTemplate(homeDirectory: string): Pick<AgentRuntimeProfileInfo, 'starterTemplateId' | 'starterTemplateName'> {
  const path = join(homeDirectory, PROFILE_CREATED_FILE);
  if (!existsSync(path)) return {};
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const record = raw as Record<string, unknown>;
    const starter = record.starterTemplate;
    if (!starter || typeof starter !== 'object' || Array.isArray(starter)) return {};
    const starterRecord = starter as Record<string, unknown>;
    const id = starterRecord.id;
    const name = starterRecord.name;
    if (!isAgentRuntimeProfileTemplateId(id) || typeof name !== 'string') return {};
    return {
      starterTemplateId: id,
      starterTemplateName: name,
    };
  } catch {
    return {};
  }
}

function buildProfileInfo(baseHomeDirectory: string, id: string): AgentRuntimeProfileInfo {
  const { homeDirectory } = resolveAgentRuntimeProfileHome(baseHomeDirectory, id);
  return {
    id,
    homeDirectory,
    createdAt: readProfileCreatedAt(homeDirectory),
    ...readProfileStarterTemplate(homeDirectory),
  };
}

function profileStorePath(homeDirectory: string, folder: string, file: string): string {
  return join(homeDirectory, '.goodvibes', GOODVIBES_AGENT_SURFACE_ROOT, folder, file);
}

export function isAgentRuntimeProfileTemplateId(value: unknown): value is AgentRuntimeProfileTemplateId {
  return typeof value === 'string' && STARTER_TEMPLATES.some((template) => template.id === value);
}

export function listAgentRuntimeProfileTemplates(): readonly AgentRuntimeProfileTemplateSummary[] {
  return STARTER_TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    personaName: template.personaName,
    skillNames: [...template.skillNames],
    routineNames: [...template.routineNames],
  }));
}

export function getAgentRuntimeProfileTemplate(templateId: AgentRuntimeProfileTemplateId): AgentRuntimeProfileTemplateSummary {
  const template = STARTER_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template) throw new Error(`Unknown Agent starter profile template: ${templateId}`);
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    personaName: template.personaName,
    skillNames: [...template.skillNames],
    routineNames: [...template.routineNames],
  };
}

function createMissingSkill(registry: AgentSkillRegistry, template: AgentRuntimeProfileStarterTemplate['skills'][number]): string {
  const existing = registry.get(template.name);
  if (existing) return existing.id;
  return registry.create({
    name: template.name,
    description: template.description,
    procedure: template.procedure,
    triggers: template.triggers,
    tags: template.tags,
    enabled: true,
    source: 'system',
    provenance: `goodvibes-agent starter:${template.name}`,
  }).id;
}

function createMissingRoutine(registry: AgentRoutineRegistry, template: AgentRuntimeProfileStarterTemplate['routines'][number]): string {
  const existing = registry.get(template.name);
  if (existing) return existing.id;
  return registry.create({
    name: template.name,
    description: template.description,
    steps: template.steps,
    triggers: template.triggers,
    tags: template.tags,
    enabled: true,
    source: 'system',
    provenance: `goodvibes-agent starter:${template.name}`,
  }).id;
}

export function applyAgentRuntimeProfileTemplate(homeDirectory: string, templateId: AgentRuntimeProfileTemplateId): AgentRuntimeProfileTemplateApplication {
  const template = STARTER_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template) throw new Error(`Unknown Agent starter profile template: ${templateId}`);
  const personaRegistry = new AgentPersonaRegistry(profileStorePath(homeDirectory, 'personas', 'personas.json'));
  const skillRegistry = new AgentSkillRegistry(profileStorePath(homeDirectory, 'skills', 'skills.json'));
  const routineRegistry = new AgentRoutineRegistry(profileStorePath(homeDirectory, 'routines', 'routines.json'));
  const existingPersona = personaRegistry.get(template.persona.name);
  const persona = existingPersona ?? personaRegistry.create({
    name: template.persona.name,
    description: template.persona.description,
    body: template.persona.body,
    tags: template.persona.tags,
    triggers: template.persona.triggers,
    source: 'system',
    provenance: `goodvibes-agent starter:${template.name}`,
  });
  personaRegistry.setActive(persona.id);
  const skillIds = template.skills.map((skill) => createMissingSkill(skillRegistry, skill));
  const routineIds = template.routines.map((routine) => createMissingRoutine(routineRegistry, routine));
  return {
    id: template.id,
    name: template.name,
    appliedAt: new Date().toISOString(),
    personaIds: [persona.id],
    skillIds,
    routineIds,
  };
}

export function listAgentRuntimeProfiles(baseHomeDirectory: string): readonly AgentRuntimeProfileInfo[] {
  const root = getAgentRuntimeProfilesRoot(baseHomeDirectory);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((entry) => PROFILE_ID_PATTERN.test(entry) && !entry.includes('..'))
    .filter((entry) => {
      try {
        return statSync(join(root, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => buildProfileInfo(baseHomeDirectory, entry));
}

export function createAgentRuntimeProfile(baseHomeDirectory: string, profileName: string, options: CreateAgentRuntimeProfileOptions = {}): AgentRuntimeProfileInfo {
  const resolution = resolveAgentRuntimeProfileHome(baseHomeDirectory, profileName);
  mkdirSync(resolution.homeDirectory, { recursive: true });
  const createdAt = new Date().toISOString();
  const appliedTemplate = options.templateId
    ? applyAgentRuntimeProfileTemplate(resolution.homeDirectory, options.templateId)
    : undefined;
  writeFileSync(
    join(resolution.homeDirectory, PROFILE_CREATED_FILE),
    `${JSON.stringify({
      id: resolution.id,
      createdAt,
      starterTemplate: appliedTemplate,
    }, null, 2)}\n`,
    'utf-8',
  );
  return {
    ...resolution,
    createdAt,
    starterTemplateId: appliedTemplate?.id,
    starterTemplateName: appliedTemplate?.name,
    starterTemplateApplication: appliedTemplate,
  };
}

export function deleteAgentRuntimeProfile(baseHomeDirectory: string, profileName: string): boolean {
  const resolution = resolveAgentRuntimeProfileHome(baseHomeDirectory, profileName);
  if (!existsSync(resolution.homeDirectory)) return false;
  rmSync(resolution.homeDirectory, { recursive: true, force: true });
  return true;
}
