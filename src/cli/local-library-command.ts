import { createShellPathService } from '@/runtime/index.ts';
import { discoverPersonas, type DiscoveredPersonaRecord } from '../agent/persona-discovery.ts';
import { AgentPersonaRegistry, type AgentPersonaRecord } from '../agent/persona-registry.ts';
import { discoverSkills, type SkillRecord } from '../agent/skill-discovery.ts';
import {
  AgentSkillRegistry,
  buildAgentSkillRequirements,
  evaluateAgentSkillReadiness,
  formatAgentSkillRequirement,
  type AgentSkillBundleRecord,
  type AgentSkillRecord,
} from '../agent/skill-registry.ts';
import type { CliCommandOutput } from './types.ts';
import type { CliCommandRuntime } from './management.ts';

interface CommandSuccess<TData> {
  readonly ok: true;
  readonly kind: string;
  readonly data: TData;
}

interface CommandFailure {
  readonly ok: false;
  readonly kind: string;
  readonly error: string;
}

interface ParsedOptions {
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
  readonly positionals: readonly string[];
}

function jsonOrText(runtime: CliCommandRuntime, value: unknown, text: string): string {
  return runtime.cli.flags.outputFormat === 'json' ? JSON.stringify(value, null, 2) : text;
}

function success<TData>(runtime: CliCommandRuntime, kind: string, data: TData, text: string): CliCommandOutput {
  const value: CommandSuccess<TData> = { ok: true, kind, data };
  return { output: jsonOrText(runtime, value, text), exitCode: 0 };
}

function failure(runtime: CliCommandRuntime, kind: string, error: string, exitCode: number): CliCommandOutput {
  const value: CommandFailure = { ok: false, kind, error };
  return {
    output: runtime.cli.flags.outputFormat === 'json' ? JSON.stringify(value, null, 2) : error,
    exitCode,
  };
}

function parseOptions(args: readonly string[]): ParsedOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const equalIndex = arg.indexOf('=');
    if (equalIndex >= 0) {
      values.set(arg.slice(2, equalIndex), arg.slice(equalIndex + 1));
      continue;
    }
    const name = arg.slice(2);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      values.set(name, next);
      index += 1;
      continue;
    }
    flags.add(name);
  }
  return { values, flags, positionals };
}

function optionValue(options: ParsedOptions, name: string): string | undefined {
  const value = options.values.get(name);
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredOption(options: ParsedOptions, name: string, usage: string): string {
  const value = optionValue(options, name);
  if (!value) throw new Error(`${usage}\nMissing --${name}.`);
  return value;
}

function csvOption(options: ParsedOptions, name: string): readonly string[] | undefined {
  const value = optionValue(options, name);
  if (value === undefined) return undefined;
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function hasFlag(options: ParsedOptions, name: string): boolean {
  return options.flags.has(name);
}

function personaRegistry(runtime: CliCommandRuntime): AgentPersonaRegistry {
  return AgentPersonaRegistry.fromShellPaths(createShellPathService({
    workingDirectory: runtime.workingDirectory,
    homeDirectory: runtime.homeDirectory,
  }));
}

function skillRegistry(runtime: CliCommandRuntime): AgentSkillRegistry {
  return AgentSkillRegistry.fromShellPaths(createShellPathService({
    workingDirectory: runtime.workingDirectory,
    homeDirectory: runtime.homeDirectory,
  }));
}

function shellPaths(runtime: CliCommandRuntime): ReturnType<typeof createShellPathService> {
  return createShellPathService({
    workingDirectory: runtime.workingDirectory,
    homeDirectory: runtime.homeDirectory,
  });
}

function summarizePersona(persona: AgentPersonaRecord, activePersonaId: string | null): string {
  const active = persona.id === activePersonaId ? 'active' : 'available';
  const tags = persona.tags.length > 0 ? ` tags=${persona.tags.join(',')}` : '';
  return `  ${persona.id}  ${active}  ${persona.reviewState}  ${persona.name} - ${persona.description}${tags}`;
}

function renderPersonaList(title: string, path: string, personas: readonly AgentPersonaRecord[], activePersonaId: string | null): string {
  if (personas.length === 0) {
    return [
      title,
      '  No local Agent personas yet.',
      '  Create one with: goodvibes-agent personas create --name <name> --description <summary> --body <instructions>',
    ].join('\n');
  }
  return [
    `${title} (${personas.length})`,
    `  store: ${path}`,
    ...personas.map((persona) => summarizePersona(persona, activePersonaId)),
  ].join('\n');
}

function renderPersona(persona: AgentPersonaRecord, activePersonaId: string | null): string {
  return [
    `Persona ${persona.name}`,
    `  id: ${persona.id}`,
    `  active: ${persona.id === activePersonaId ? 'yes' : 'no'}`,
    `  review: ${persona.reviewState}`,
    `  source: ${persona.source}`,
    `  provenance: ${persona.provenance}`,
    `  tags: ${persona.tags.join(', ') || '(none)'}`,
    `  triggers: ${persona.triggers.join(', ') || '(manual)'}`,
    `  created: ${persona.createdAt}`,
    `  updated: ${persona.updatedAt}`,
    persona.staleReason ? `  stale reason: ${persona.staleReason}` : '',
    '',
    persona.description,
    '',
    persona.body,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function summarizeDiscoveredPersona(persona: DiscoveredPersonaRecord): string {
  const description = persona.description ? ` - ${persona.description}` : '';
  return [
    `  ${persona.name}  ${persona.origin}${description}`,
    `    path: ${persona.path}`,
  ].join('\n');
}

function renderDiscoveredPersonaList(personas: readonly DiscoveredPersonaRecord[]): string {
  if (personas.length === 0) {
    return [
      'Discovered Agent persona files',
      '  No persona markdown files found in Agent persona folders.',
      '  Search roots: .goodvibes/personas, .goodvibes/agent/personas, ~/.goodvibes/personas, ~/.goodvibes/agent/personas',
    ].join('\n');
  }
  return [
    `Discovered Agent persona files (${personas.length})`,
    ...personas.map(summarizeDiscoveredPersona),
    '',
    'Import one with: goodvibes-agent personas import-discovered <name> --yes',
  ].join('\n');
}

function discoveredPersonaLookupValues(persona: DiscoveredPersonaRecord): readonly string[] {
  const slug = persona.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const basename = persona.path.split(/[\\/]/).pop()?.replace(/\.md$/i, '') ?? '';
  return [persona.name, slug, persona.path, basename]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function findDiscoveredPersona(personas: readonly DiscoveredPersonaRecord[], idOrName: string): DiscoveredPersonaRecord | null {
  const lookup = idOrName.trim().toLowerCase();
  if (!lookup) return null;
  return personas.find((persona) => discoveredPersonaLookupValues(persona).includes(lookup)) ?? null;
}

function discoveredPersonaFrontmatterList(persona: DiscoveredPersonaRecord, key: string): readonly string[] {
  const value = persona.frontmatter[key];
  if (!value) return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function summarizeSkill(skill: AgentSkillRecord): string {
  const enabled = skill.enabled ? 'enabled' : 'disabled';
  const tags = skill.tags.length > 0 ? ` tags=${skill.tags.join(',')}` : '';
  const readiness = evaluateAgentSkillReadiness(skill);
  const ready = readiness.ready ? 'ready' : `needs ${readiness.missing.map(formatAgentSkillRequirement).join(',')}`;
  return `  ${skill.id}  ${enabled}  ${skill.reviewState}  ${ready}  ${skill.name} - ${skill.description}${tags}`;
}

function summarizeBundle(bundle: AgentSkillBundleRecord): string {
  const enabled = bundle.enabled ? 'enabled' : 'disabled';
  return `  ${bundle.id}  ${enabled}  ${bundle.reviewState}  ${bundle.name} - ${bundle.description} skills=${bundle.skillIds.join(',')}`;
}

function renderSkillList(title: string, path: string, skills: readonly AgentSkillRecord[]): string {
  if (skills.length === 0) {
    return [
      title,
      '  No local Agent skills yet.',
      '  Create one with: goodvibes-agent skills create --name <name> --description <summary> --procedure <steps>',
    ].join('\n');
  }
  return [
    `${title} (${skills.length})`,
    `  store: ${path}`,
    ...skills.map(summarizeSkill),
  ].join('\n');
}

function summarizeDiscoveredSkill(skill: SkillRecord): string {
  const description = skill.description ? ` - ${skill.description}` : '';
  const dependencies = skill.dependencies.length > 0 ? ` deps=${skill.dependencies.join(',')}` : '';
  const includes = skill.includes.length > 0 ? ` includes=${skill.includes.join(',')}` : '';
  return [
    `  ${skill.name}  ${skill.origin}${description}${dependencies}${includes}`,
    `    path: ${skill.path}`,
  ].join('\n');
}

function renderDiscoveredSkillList(skills: readonly SkillRecord[]): string {
  if (skills.length === 0) {
    return [
      'Discovered Agent skill files',
      '  No SKILL.md or .md skill files found in Agent skill folders.',
      '  Search roots: .goodvibes/skills, .goodvibes/agent/skills, ~/.goodvibes/skills, ~/.goodvibes/agent/skills',
    ].join('\n');
  }
  return [
    `Discovered Agent skill files (${skills.length})`,
    ...skills.map(summarizeDiscoveredSkill),
    '',
    'Import one with: goodvibes-agent skills import-discovered <name> --yes',
  ].join('\n');
}

function discoveredSkillLookupValues(skill: SkillRecord): readonly string[] {
  const slug = skill.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const basename = skill.path.split(/[\\/]/).pop()?.replace(/\.md$/i, '') ?? '';
  return [skill.name, slug, skill.path, basename]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function findDiscoveredSkill(skills: readonly SkillRecord[], idOrName: string): SkillRecord | null {
  const lookup = idOrName.trim().toLowerCase();
  if (!lookup) return null;
  return skills.find((skill) => discoveredSkillLookupValues(skill).includes(lookup)) ?? null;
}

function discoveredFrontmatterList(skill: SkillRecord, key: string): readonly string[] {
  const value = skill.frontmatter[key];
  if (!value) return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function discoveredFrontmatterAnyList(skill: SkillRecord, keys: readonly string[]): readonly string[] {
  for (const key of keys) {
    const values = discoveredFrontmatterList(skill, key);
    if (values.length > 0) return values;
  }
  return [];
}

function renderBundleList(title: string, path: string, bundles: readonly AgentSkillBundleRecord[]): string {
  if (bundles.length === 0) {
    return [
      title,
      '  No local Agent skill bundles yet.',
      '  Create one with: goodvibes-agent skills bundle create --name <name> --description <summary> --skills <id,id>',
    ].join('\n');
  }
  return [
    `${title} (${bundles.length})`,
    `  store: ${path}`,
    ...bundles.map(summarizeBundle),
  ].join('\n');
}

function renderSkill(skill: AgentSkillRecord): string {
  const readiness = evaluateAgentSkillReadiness(skill);
  return [
    `Skill ${skill.name}`,
    `  id: ${skill.id}`,
    `  enabled: ${skill.enabled ? 'yes' : 'no'}`,
    `  readiness: ${readiness.ready ? 'ready' : 'needs setup'}`,
    `  requirements: ${skill.requirements.map(formatAgentSkillRequirement).join(', ') || '(none)'}`,
    readiness.missing.length > 0 ? `  missing: ${readiness.missing.map(formatAgentSkillRequirement).join(', ')}` : '',
    `  review: ${skill.reviewState}`,
    `  source: ${skill.source}`,
    `  provenance: ${skill.provenance}`,
    `  tags: ${skill.tags.join(', ') || '(none)'}`,
    `  triggers: ${skill.triggers.join(', ') || '(manual)'}`,
    `  created: ${skill.createdAt}`,
    `  updated: ${skill.updatedAt}`,
    skill.staleReason ? `  stale reason: ${skill.staleReason}` : '',
    '',
    skill.description,
    '',
    skill.procedure,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function renderBundle(bundle: AgentSkillBundleRecord): string {
  return [
    `Skill bundle ${bundle.name}`,
    `  id: ${bundle.id}`,
    `  enabled: ${bundle.enabled ? 'yes' : 'no'}`,
    `  review: ${bundle.reviewState}`,
    `  source: ${bundle.source}`,
    `  provenance: ${bundle.provenance}`,
    `  skills: ${bundle.skillIds.join(', ')}`,
    `  created: ${bundle.createdAt}`,
    `  updated: ${bundle.updatedAt}`,
    bundle.staleReason ? `  stale reason: ${bundle.staleReason}` : '',
    '',
    bundle.description,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function usagePersonas(): string {
  return 'Usage: goodvibes-agent personas [list|active|discover|import-discovered <name> --yes|search <query>|show <id>|create|update <id>|use <id>|clear|review <id>|stale <id> <reason>|delete <id> --yes]';
}

function usageSkills(): string {
  return 'Usage: goodvibes-agent skills [list|enabled|active|attention|discover|import-discovered <name> --yes|search <query>|show <id>|create [--requires-env A,B] [--requires-command gh,jq]|update <id>|enable <id>|disable <id>|review <id>|stale <id> <reason>|delete <id> --yes|bundle ...]';
}

function usageBundles(): string {
  return 'Usage: goodvibes-agent skills bundle [list|enabled|search <query>|show <id>|create|update <id>|enable <id>|disable <id>|review <id>|stale <id> <reason>|delete <id> --yes]';
}

function errorOutput(runtime: CliCommandRuntime, error: unknown, kind: string): CliCommandOutput {
  const message = error instanceof Error ? error.message : String(error);
  const exitCode = message.startsWith('Usage:') || message.includes('\nMissing --') ? 2 : 1;
  return failure(runtime, kind, message, exitCode);
}

export async function handlePersonasCommand(runtime: CliCommandRuntime): Promise<CliCommandOutput> {
  try {
    const [sub = 'list', ...rest] = runtime.cli.commandArgs;
    const normalized = sub.toLowerCase();
    const registry = personaRegistry(runtime);
    const snapshot = registry.snapshot();
    if (normalized === 'list' || normalized === 'ls') {
      return success(runtime, 'agent.personas.list', snapshot, renderPersonaList('Agent personas', snapshot.path, snapshot.personas, snapshot.activePersonaId));
    }
    if (normalized === 'active') {
      const active = snapshot.activePersona;
      if (!active) return failure(runtime, 'agent.personas.active_missing', 'No active Agent persona.', 1);
      return success(runtime, 'agent.personas.active', active, renderPersona(active, active.id));
    }
    if (normalized === 'discover') {
      const discovered = await discoverPersonas(shellPaths(runtime));
      return success(runtime, 'agent.personas.discover', { personas: discovered }, renderDiscoveredPersonaList(discovered));
    }
    if (normalized === 'import-discovered' || normalized === 'import-persona') {
      const options = parseOptions(rest);
      const name = options.positionals.join(' ').trim();
      if (!name) return failure(runtime, 'invalid_persona_command', 'Usage: goodvibes-agent personas import-discovered <name> [--use] --yes', 2);
      const discovered = findDiscoveredPersona(await discoverPersonas(shellPaths(runtime)), name);
      if (!discovered) {
        return failure(runtime, 'persona_discovery_not_found', `Unknown discovered Agent persona: ${name}\nRun goodvibes-agent personas discover to inspect available persona files.`, 1);
      }
      if (!hasFlag(options, 'yes')) {
        return success(runtime, 'agent.personas.import_discovered.preview', { persona: discovered }, [
          'Agent persona import preview',
          `  name: ${discovered.name}`,
          `  origin: ${discovered.origin}`,
          `  path: ${discovered.path}`,
          `  description: ${discovered.description || '(none)'}`,
          `  body characters: ${discovered.body.length}`,
          '  next: rerun with --yes to import into the Agent-local persona registry',
        ].join('\n'));
      }
      const persona = registry.create({
        name: discovered.name,
        description: discovered.description || `Imported persona from ${discovered.origin} markdown file.`,
        body: discovered.body,
        tags: discoveredPersonaFrontmatterList(discovered, 'tags'),
        triggers: discoveredPersonaFrontmatterList(discovered, 'triggers'),
        source: 'imported',
        provenance: `discovered:${discovered.origin}:${discovered.path}`,
      });
      if (hasFlag(options, 'use')) registry.setActive(persona.id);
      return success(runtime, 'agent.personas.import_discovered', persona, `Imported Agent persona ${persona.id}: ${persona.name}${hasFlag(options, 'use') ? ' (active)' : ''}`);
    }
    if (normalized === 'search' || normalized === 'find') {
      const query = rest.join(' ').trim();
      const results = registry.search(query);
      return success(runtime, 'agent.personas.search', { query, results }, renderPersonaList(`Agent personas matching "${query}"`, snapshot.path, results, snapshot.activePersonaId));
    }
    if (normalized === 'show' || normalized === 'get') {
      const id = rest[0];
      if (!id) return failure(runtime, 'invalid_persona_command', 'Usage: goodvibes-agent personas show <id>', 2);
      const persona = registry.get(id);
      if (!persona) return failure(runtime, 'persona_not_found', `Unknown Agent persona: ${id}`, 1);
      return success(runtime, 'agent.personas.show', persona, renderPersona(persona, snapshot.activePersonaId));
    }
    if (normalized === 'create') {
      const options = parseOptions(rest);
      const persona = registry.create({
        name: requiredOption(options, 'name', 'Usage: goodvibes-agent personas create --name <name> --description <summary> --body <instructions>'),
        description: requiredOption(options, 'description', 'Usage: goodvibes-agent personas create --name <name> --description <summary> --body <instructions>'),
        body: requiredOption(options, 'body', 'Usage: goodvibes-agent personas create --name <name> --description <summary> --body <instructions>'),
        tags: csvOption(options, 'tags'),
        triggers: csvOption(options, 'triggers'),
        provenance: optionValue(options, 'provenance') ?? 'cli',
      });
      if (hasFlag(options, 'use')) registry.setActive(persona.id);
      return success(runtime, 'agent.personas.create', persona, `Agent persona created: ${persona.id}${hasFlag(options, 'use') ? ' (active)' : ''}`);
    }
    if (normalized === 'update') {
      const id = rest[0];
      if (!id) return failure(runtime, 'invalid_persona_command', 'Usage: goodvibes-agent personas update <id> [--name ...] [--description ...] [--body ...]', 2);
      const options = parseOptions(rest.slice(1));
      const persona = registry.update(id, {
        name: optionValue(options, 'name'),
        description: optionValue(options, 'description'),
        body: optionValue(options, 'body'),
        tags: csvOption(options, 'tags'),
        triggers: csvOption(options, 'triggers'),
        provenance: optionValue(options, 'provenance'),
      });
      return success(runtime, 'agent.personas.update', persona, `Agent persona updated: ${persona.id}`);
    }
    if (normalized === 'use') {
      const id = rest[0];
      if (!id) return failure(runtime, 'invalid_persona_command', 'Usage: goodvibes-agent personas use <id>', 2);
      const persona = registry.setActive(id);
      return success(runtime, 'agent.personas.use', persona, `Active Agent persona: ${persona.id}`);
    }
    if (normalized === 'clear') {
      registry.clearActive();
      return success(runtime, 'agent.personas.clear', { activePersonaId: null }, 'Active Agent persona cleared.');
    }
    if (normalized === 'review') {
      const id = rest[0];
      if (!id) return failure(runtime, 'invalid_persona_command', 'Usage: goodvibes-agent personas review <id>', 2);
      const persona = registry.markReviewed(id);
      return success(runtime, 'agent.personas.review', persona, `Agent persona reviewed: ${persona.id}`);
    }
    if (normalized === 'stale') {
      const id = rest[0];
      if (!id || rest.length < 2) return failure(runtime, 'invalid_persona_command', 'Usage: goodvibes-agent personas stale <id> <reason>', 2);
      const persona = registry.markStale(id, rest.slice(1).join(' '));
      return success(runtime, 'agent.personas.stale', persona, `Agent persona marked stale: ${persona.id}`);
    }
    if (normalized === 'delete' || normalized === 'remove' || normalized === 'rm') {
      const options = parseOptions(rest);
      const id = options.positionals[0];
      if (!id) return failure(runtime, 'invalid_persona_command', 'Usage: goodvibes-agent personas delete <id> --yes', 2);
      if (!hasFlag(options, 'yes')) return failure(runtime, 'confirmation_required', `Refusing to delete Agent persona ${id} without --yes.`, 2);
      const persona = registry.deletePersona(id);
      return success(runtime, 'agent.personas.delete', persona, `Agent persona deleted: ${persona.id}`);
    }
    return failure(runtime, 'invalid_persona_command', usagePersonas(), 2);
  } catch (error) {
    return errorOutput(runtime, error, 'agent.personas.error');
  }
}

function skillPayloadFromOptions(options: ParsedOptions): {
  readonly name: string;
  readonly description: string;
  readonly procedure: string;
  readonly tags: readonly string[] | undefined;
  readonly triggers: readonly string[] | undefined;
  readonly requirements: ReturnType<typeof buildAgentSkillRequirements>;
  readonly enabled: boolean | undefined;
  readonly provenance: string;
} {
  const usage = 'Usage: goodvibes-agent skills create --name <name> --description <summary> --procedure <steps>';
  return {
    name: requiredOption(options, 'name', usage),
    description: requiredOption(options, 'description', usage),
    procedure: requiredOption(options, 'procedure', usage),
    tags: csvOption(options, 'tags'),
    triggers: csvOption(options, 'triggers'),
    requirements: buildAgentSkillRequirements({
      env: csvOption(options, 'requires-env'),
      commands: csvOption(options, 'requires-command') ?? csvOption(options, 'requires-commands'),
    }),
    enabled: hasFlag(options, 'enabled') ? true : undefined,
    provenance: optionValue(options, 'provenance') ?? 'cli',
  };
}

async function handleSkillBundleCommand(runtime: CliCommandRuntime, args: readonly string[]): Promise<CliCommandOutput> {
  try {
    const [sub = 'list', ...rest] = args;
    const normalized = sub.toLowerCase();
    const registry = skillRegistry(runtime);
    const snapshot = registry.snapshot();
    if (normalized === 'list' || normalized === 'ls') {
      return success(runtime, 'agent.skills.bundles.list', { path: snapshot.path, bundles: snapshot.bundles }, renderBundleList('Agent skill bundles', snapshot.path, snapshot.bundles));
    }
    if (normalized === 'enabled') {
      return success(runtime, 'agent.skills.bundles.enabled', { path: snapshot.path, bundles: snapshot.enabledBundles }, renderBundleList('Enabled Agent skill bundles', snapshot.path, snapshot.enabledBundles));
    }
    if (normalized === 'search' || normalized === 'find') {
      const query = rest.join(' ').trim();
      const results = registry.searchBundles(query);
      return success(runtime, 'agent.skills.bundles.search', { query, results }, renderBundleList(`Agent skill bundles matching "${query}"`, snapshot.path, results));
    }
    if (normalized === 'show' || normalized === 'get') {
      const id = rest[0];
      if (!id) return failure(runtime, 'invalid_skill_bundle_command', 'Usage: goodvibes-agent skills bundle show <id>', 2);
      const bundle = registry.getBundle(id);
      if (!bundle) return failure(runtime, 'skill_bundle_not_found', `Unknown Agent skill bundle: ${id}`, 1);
      return success(runtime, 'agent.skills.bundles.show', bundle, renderBundle(bundle));
    }
    if (normalized === 'create') {
      const options = parseOptions(rest);
      const usage = 'Usage: goodvibes-agent skills bundle create --name <name> --description <summary> --skills <id,id>';
      const bundle = registry.createBundle({
        name: requiredOption(options, 'name', usage),
        description: requiredOption(options, 'description', usage),
        skillIds: requiredOption(options, 'skills', usage).split(',').map((entry) => entry.trim()).filter(Boolean),
        enabled: hasFlag(options, 'enabled'),
        provenance: optionValue(options, 'provenance') ?? 'cli',
      });
      return success(runtime, 'agent.skills.bundles.create', bundle, `Agent skill bundle created: ${bundle.id}`);
    }
    if (normalized === 'update') {
      const id = rest[0];
      if (!id) return failure(runtime, 'invalid_skill_bundle_command', 'Usage: goodvibes-agent skills bundle update <id> [--name ...] [--description ...] [--skills id,id]', 2);
      const options = parseOptions(rest.slice(1));
      const bundle = registry.updateBundle(id, {
        name: optionValue(options, 'name'),
        description: optionValue(options, 'description'),
        skillIds: csvOption(options, 'skills'),
        provenance: optionValue(options, 'provenance'),
      });
      return success(runtime, 'agent.skills.bundles.update', bundle, `Agent skill bundle updated: ${bundle.id}`);
    }
    if (normalized === 'enable' || normalized === 'disable') {
      const id = rest[0];
      if (!id) return failure(runtime, 'invalid_skill_bundle_command', `Usage: goodvibes-agent skills bundle ${normalized} <id>`, 2);
      const bundle = registry.setBundleEnabled(id, normalized === 'enable');
      return success(runtime, `agent.skills.bundles.${normalized}`, bundle, `Agent skill bundle ${normalized}d: ${bundle.id}`);
    }
    if (normalized === 'review') {
      const id = rest[0];
      if (!id) return failure(runtime, 'invalid_skill_bundle_command', 'Usage: goodvibes-agent skills bundle review <id>', 2);
      const bundle = registry.markBundleReviewed(id);
      return success(runtime, 'agent.skills.bundles.review', bundle, `Agent skill bundle reviewed: ${bundle.id}`);
    }
    if (normalized === 'stale') {
      const id = rest[0];
      if (!id || rest.length < 2) return failure(runtime, 'invalid_skill_bundle_command', 'Usage: goodvibes-agent skills bundle stale <id> <reason>', 2);
      const bundle = registry.markBundleStale(id, rest.slice(1).join(' '));
      return success(runtime, 'agent.skills.bundles.stale', bundle, `Agent skill bundle marked stale: ${bundle.id}`);
    }
    if (normalized === 'delete' || normalized === 'remove' || normalized === 'rm') {
      const options = parseOptions(rest);
      const id = options.positionals[0];
      if (!id) return failure(runtime, 'invalid_skill_bundle_command', 'Usage: goodvibes-agent skills bundle delete <id> --yes', 2);
      if (!hasFlag(options, 'yes')) return failure(runtime, 'confirmation_required', `Refusing to delete Agent skill bundle ${id} without --yes.`, 2);
      const bundle = registry.deleteBundle(id);
      return success(runtime, 'agent.skills.bundles.delete', bundle, `Agent skill bundle deleted: ${bundle.id}`);
    }
    return failure(runtime, 'invalid_skill_bundle_command', usageBundles(), 2);
  } catch (error) {
    return errorOutput(runtime, error, 'agent.skills.bundles.error');
  }
}

export async function handleSkillsCommand(runtime: CliCommandRuntime): Promise<CliCommandOutput> {
  try {
    const [sub = 'list', ...rest] = runtime.cli.commandArgs;
    const normalized = sub.toLowerCase();
    if (normalized === 'bundle' || normalized === 'bundles') return handleSkillBundleCommand(runtime, rest);
    const registry = skillRegistry(runtime);
    const snapshot = registry.snapshot();
    if (normalized === 'list' || normalized === 'ls') {
      return success(runtime, 'agent.skills.list', { path: snapshot.path, skills: snapshot.skills, enabledCount: snapshot.enabledSkills.length }, renderSkillList('Agent skills', snapshot.path, snapshot.skills));
    }
    if (normalized === 'enabled') {
      return success(runtime, 'agent.skills.enabled', { path: snapshot.path, skills: snapshot.enabledSkills }, renderSkillList('Enabled Agent skills', snapshot.path, snapshot.enabledSkills));
    }
    if (normalized === 'active') {
      return success(runtime, 'agent.skills.active', { path: snapshot.path, skills: snapshot.activeSkills, bundles: snapshot.enabledBundles }, [
        renderSkillList('Active Agent skills', snapshot.path, snapshot.activeSkills),
        snapshot.enabledBundles.length > 0 ? renderBundleList('Enabled Agent skill bundles', snapshot.path, snapshot.enabledBundles) : '',
      ].filter(Boolean).join('\n\n'));
    }
    if (normalized === 'attention' || normalized === 'needs-setup') {
      const skills = snapshot.skills.filter((skill) => !evaluateAgentSkillReadiness(skill).ready);
      return success(runtime, 'agent.skills.attention', { path: snapshot.path, skills }, renderSkillList('Agent skills needing setup', snapshot.path, skills));
    }
    if (normalized === 'discover') {
      const discovered = await discoverSkills(shellPaths(runtime));
      return success(runtime, 'agent.skills.discover', { skills: discovered }, renderDiscoveredSkillList(discovered));
    }
    if (normalized === 'import-discovered' || normalized === 'import-skill') {
      const options = parseOptions(rest);
      const name = options.positionals.join(' ').trim();
      if (!name) return failure(runtime, 'invalid_skill_command', 'Usage: goodvibes-agent skills import-discovered <name> [--enabled] --yes', 2);
      const discovered = findDiscoveredSkill(await discoverSkills(shellPaths(runtime)), name);
      if (!discovered) {
        return failure(runtime, 'skill_discovery_not_found', `Unknown discovered Agent skill: ${name}\nRun goodvibes-agent skills discover to inspect available skill files.`, 1);
      }
      if (!hasFlag(options, 'yes')) {
        return success(runtime, 'agent.skills.import_discovered.preview', { skill: discovered }, [
          'Agent skill import preview',
          `  name: ${discovered.name}`,
          `  origin: ${discovered.origin}`,
          `  path: ${discovered.path}`,
          `  description: ${discovered.description || '(none)'}`,
          `  procedure characters: ${discovered.body.length}`,
          '  next: rerun with --yes to import into the Agent-local skill registry',
        ].join('\n'));
      }
      const skill = registry.create({
        name: discovered.name,
        description: discovered.description || `Imported skill from ${discovered.origin} skill file.`,
        procedure: discovered.body,
        tags: discoveredFrontmatterList(discovered, 'tags'),
        triggers: discoveredFrontmatterList(discovered, 'triggers'),
        requirements: buildAgentSkillRequirements({
          env: discoveredFrontmatterAnyList(discovered, ['requiresEnv', 'requires-env', 'requires_env']),
          commands: discoveredFrontmatterAnyList(discovered, ['requiresCommands', 'requires-commands', 'requires_commands', 'commands']),
        }),
        enabled: hasFlag(options, 'enabled'),
        source: 'imported',
        provenance: `discovered:${discovered.origin}:${discovered.path}`,
      });
      return success(runtime, 'agent.skills.import_discovered', skill, `Imported Agent skill ${skill.id}: ${skill.name}${skill.enabled ? ' (enabled)' : ''}`);
    }
    if (normalized === 'search' || normalized === 'find') {
      const query = rest.join(' ').trim();
      const results = registry.search(query);
      return success(runtime, 'agent.skills.search', { query, results }, renderSkillList(`Agent skills matching "${query}"`, snapshot.path, results));
    }
    if (normalized === 'show' || normalized === 'get') {
      const id = rest[0];
      if (!id) return failure(runtime, 'invalid_skill_command', 'Usage: goodvibes-agent skills show <id>', 2);
      const skill = registry.get(id);
      if (!skill) return failure(runtime, 'skill_not_found', `Unknown Agent skill: ${id}`, 1);
      return success(runtime, 'agent.skills.show', skill, renderSkill(skill));
    }
    if (normalized === 'create') {
      const skill = registry.create(skillPayloadFromOptions(parseOptions(rest)));
      return success(runtime, 'agent.skills.create', skill, `Agent skill created: ${skill.id}${skill.enabled ? ' (enabled)' : ''}`);
    }
    if (normalized === 'update') {
      const id = rest[0];
      if (!id) return failure(runtime, 'invalid_skill_command', 'Usage: goodvibes-agent skills update <id> [--name ...] [--description ...] [--procedure ...]', 2);
      const options = parseOptions(rest.slice(1));
      const skill = registry.update(id, {
        name: optionValue(options, 'name'),
        description: optionValue(options, 'description'),
        procedure: optionValue(options, 'procedure'),
        tags: csvOption(options, 'tags'),
        triggers: csvOption(options, 'triggers'),
        requirements: options.values.has('requires-env') || options.values.has('requires-command') || options.values.has('requires-commands')
          ? buildAgentSkillRequirements({
            env: csvOption(options, 'requires-env'),
            commands: csvOption(options, 'requires-command') ?? csvOption(options, 'requires-commands'),
          })
          : undefined,
        provenance: optionValue(options, 'provenance'),
      });
      return success(runtime, 'agent.skills.update', skill, `Agent skill updated: ${skill.id}`);
    }
    if (normalized === 'enable' || normalized === 'disable') {
      const id = rest[0];
      if (!id) return failure(runtime, 'invalid_skill_command', `Usage: goodvibes-agent skills ${normalized} <id>`, 2);
      const skill = registry.setEnabled(id, normalized === 'enable');
      return success(runtime, `agent.skills.${normalized}`, skill, `Agent skill ${normalized}d: ${skill.id}`);
    }
    if (normalized === 'review') {
      const id = rest[0];
      if (!id) return failure(runtime, 'invalid_skill_command', 'Usage: goodvibes-agent skills review <id>', 2);
      const skill = registry.markReviewed(id);
      return success(runtime, 'agent.skills.review', skill, `Agent skill reviewed: ${skill.id}`);
    }
    if (normalized === 'stale') {
      const id = rest[0];
      if (!id || rest.length < 2) return failure(runtime, 'invalid_skill_command', 'Usage: goodvibes-agent skills stale <id> <reason>', 2);
      const skill = registry.markStale(id, rest.slice(1).join(' '));
      return success(runtime, 'agent.skills.stale', skill, `Agent skill marked stale: ${skill.id}`);
    }
    if (normalized === 'delete' || normalized === 'remove' || normalized === 'rm') {
      const options = parseOptions(rest);
      const id = options.positionals[0];
      if (!id) return failure(runtime, 'invalid_skill_command', 'Usage: goodvibes-agent skills delete <id> --yes', 2);
      if (!hasFlag(options, 'yes')) return failure(runtime, 'confirmation_required', `Refusing to delete Agent skill ${id} without --yes.`, 2);
      const skill = registry.deleteSkill(id);
      return success(runtime, 'agent.skills.delete', skill, `Agent skill deleted: ${skill.id}`);
    }
    return failure(runtime, 'invalid_skill_command', usageSkills(), 2);
  } catch (error) {
    return errorOutput(runtime, error, 'agent.skills.error');
  }
}
