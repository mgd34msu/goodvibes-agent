import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  createAgentRuntimeProfile,
  deleteAgentRuntimeProfile,
  exportAgentRuntimeProfileTemplate,
  getAgentRuntimeProfileTemplateFile,
  importAgentRuntimeProfileTemplate,
  listAgentRuntimeProfiles,
  listAgentRuntimeProfileTemplates,
  type AgentRuntimeProfileInfo,
  type AgentRuntimeProfileTemplateSummary,
} from '../../agent/runtime-profile.ts';
import type { CommandContext, CommandRegistry } from '../command-registry.ts';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';
import { requireShellPaths } from './runtime-services.ts';

function parseFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function profileLine(profile: AgentRuntimeProfileInfo): string {
  const created = profile.createdAt ? ` created=${profile.createdAt}` : '';
  const starter = profile.starterTemplateId ? ` starter=${profile.starterTemplateId}` : '';
  return `  ${profile.id}  home=${profile.homeDirectory}${created}${starter}`;
}

function templateLine(template: AgentRuntimeProfileTemplateSummary): string {
  const source = template.source === 'local' ? `local ${template.path ?? ''}`.trim() : 'builtin';
  return [
    `  ${template.id}  [${source}]`,
    `    ${template.name}: ${template.description}`,
    `    persona: ${template.personaName}`,
    `    skills: ${template.skillNames.join(', ')}`,
    `    routines: ${template.routineNames.join(', ')}`,
  ].join('\n');
}

function renderProfiles(homeDirectory: string): string {
  const profiles = listAgentRuntimeProfiles(homeDirectory);
  if (profiles.length === 0) {
    return [
      'Agent Profiles',
      '  No isolated Agent profiles yet.',
      '  Create one with /agent-profile create <name> --template <id> --yes.',
    ].join('\n');
  }
  return ['Agent Profiles', ...profiles.map(profileLine)].join('\n');
}

function renderTemplates(homeDirectory: string): string {
  const templates = listAgentRuntimeProfileTemplates(homeDirectory);
  return [
    `Agent Starter Templates (${templates.length})`,
    ...templates.map(templateLine),
    '',
    'Authoring flow:',
    '  /agent-profile template export research ./agent-starter.json --yes',
    '  edit the JSON file',
    '  /agent-profile template import ./agent-starter.json --yes',
    '  /agent-profile create <name> --template <imported-id> --yes',
  ].join('\n');
}

function renderGuide(homeDirectory: string): string {
  const templates = listAgentRuntimeProfileTemplates(homeDirectory);
  const localCount = templates.filter((template) => template.source === 'local').length;
  return [
    'Agent Starter Authoring Guide',
    `  built-in starters: ${templates.length - localCount}`,
    `  local starters: ${localCount}`,
    '',
    '1. Pick a base starter:',
    '   /agent-profile templates',
    '2. Export a starter JSON file:',
    '   /agent-profile template export research ./agent-starter.json --yes',
    '3. Edit id, name, description, persona, skills, and routines in that JSON file.',
    '4. Import it into this Agent home:',
    '   /agent-profile template import ./agent-starter.json --yes',
    '5. Create an Agent profile from the imported starter:',
    '   /agent-profile create <name> --template <imported-id> --yes',
    '',
    'This writes only Agent-local starter/profile state. It does not mutate the runtime host, default wiki, or non-Agent knowledge segments.',
  ].join('\n');
}

function renderTemplatePreview(homeDirectory: string, templateId: string): string {
  const file = getAgentRuntimeProfileTemplateFile(templateId, homeDirectory);
  return [
    `Agent Starter Template: ${file.template.id}`,
    `  name: ${file.template.name}`,
    `  source: ${file.template.source}`,
    `  description: ${file.template.description}`,
    `  persona: ${file.template.persona.name}`,
    `  skills: ${file.template.skills.map((skill) => skill.name).join(', ')}`,
    `  routines: ${file.template.routines.map((routine) => routine.name).join(', ')}`,
    '',
    'Export/edit/import to customize this starter:',
    `  /agent-profile template export ${file.template.id} ./agent-starter.json --yes`,
  ].join('\n');
}

export function registerAgentRuntimeProfileRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'agent-profile',
    aliases: ['runtime-profile', 'agent-profiles'],
    description: 'Manage isolated Agent profiles and starter templates',
    usage: '[list|templates|guide|template show|template export|template import|create|delete]',
    handler(args, ctx) {
      const shellPaths = requireShellPaths(ctx);
      const homeDirectory = shellPaths.homeDirectory;
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const sub = (commandArgs[0] ?? 'list').toLowerCase();

      try {
        if (sub === 'list' || sub === 'profiles') {
          ctx.print(renderProfiles(homeDirectory));
          return;
        }

        if (sub === 'templates' || sub === 'starters') {
          ctx.print(renderTemplates(homeDirectory));
          return;
        }

        if (sub === 'guide' || sub === 'author') {
          ctx.print(renderGuide(homeDirectory));
          return;
        }

        if (sub === 'template' || sub === 'starter') {
          const mode = (commandArgs[1] ?? 'show').toLowerCase();
          if (mode === 'show' || mode === 'preview') {
            const templateId = commandArgs[2];
            if (!templateId) {
              ctx.print('Usage: /agent-profile template show <id>');
              return;
            }
            ctx.print(renderTemplatePreview(homeDirectory, templateId));
            return;
          }
          if (mode === 'export') {
            const templateId = commandArgs[2];
            const pathArg = commandArgs[3];
            if (!templateId || !pathArg) {
              ctx.print('Usage: /agent-profile template export <id> <path> --yes');
              return;
            }
            if (!parsed.yes) {
              requireYesFlag(ctx, `export Agent starter template ${templateId}`, '/agent-profile template export <id> <path> --yes');
              return;
            }
            const targetPath = shellPaths.resolveWorkspacePath(pathArg);
            mkdirSync(dirname(targetPath), { recursive: true });
            const template = exportAgentRuntimeProfileTemplate(homeDirectory, templateId, targetPath);
            ctx.print(`Agent starter template exported: ${template.id}\n  path: ${template.path ?? targetPath}\n  edit it, then import it with /agent-profile template import <path> --yes`);
            return;
          }
          if (mode === 'import') {
            const pathArg = commandArgs[2];
            if (!pathArg) {
              ctx.print('Usage: /agent-profile template import <path> --yes');
              return;
            }
            if (!parsed.yes) {
              requireYesFlag(ctx, 'import Agent starter template', '/agent-profile template import <path> --yes');
              return;
            }
            const sourcePath = shellPaths.resolveWorkspacePath(pathArg);
            const template = importAgentRuntimeProfileTemplate(homeDirectory, sourcePath);
            ctx.print(`Agent starter template imported: ${template.id}\n  source: ${template.source}\n  use: /agent-profile create <name> --template ${template.id} --yes`);
            return;
          }
          ctx.print('Usage: /agent-profile template [show <id>|export <id> <path> --yes|import <path> --yes]');
          return;
        }

        if (sub === 'create') {
          const name = commandArgs[1];
          const templateId = parseFlag(commandArgs, '--template') ?? parseFlag(commandArgs, '--starter');
          if (!name) {
            ctx.print('Usage: /agent-profile create <name> [--template <id>] --yes');
            return;
          }
          if (!parsed.yes) {
            requireYesFlag(ctx, `create Agent profile ${name}`, '/agent-profile create <name> [--template <id>] --yes');
            return;
          }
          const profile = createAgentRuntimeProfile(homeDirectory, name, { templateId });
          ctx.print([
            `Agent profile created: ${profile.id}`,
            `  home: ${profile.homeDirectory}`,
            profile.starterTemplateId ? `  starter: ${profile.starterTemplateId}` : '',
            `  launch: goodvibes-agent --agent-profile ${profile.id}`,
          ].filter(Boolean).join('\n'));
          return;
        }

        if (sub === 'delete') {
          const name = commandArgs[1];
          if (!name) {
            ctx.print('Usage: /agent-profile delete <name> --yes');
            return;
          }
          if (!parsed.yes) {
            requireYesFlag(ctx, `delete Agent profile ${name}`, '/agent-profile delete <name> --yes');
            return;
          }
          ctx.print(deleteAgentRuntimeProfile(homeDirectory, name) ? `Agent profile deleted: ${name}` : `Agent profile not found: ${name}`);
          return;
        }

        ctx.print('Usage: /agent-profile [list|templates|guide|template show <id>|template export <id> <path> --yes|template import <path> --yes|create <name> [--template <id>] --yes|delete <name> --yes]');
      } catch (error) {
        ctx.print(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });
}
