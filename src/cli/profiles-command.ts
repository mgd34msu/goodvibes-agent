import {
  createAgentRuntimeProfile,
  deleteAgentRuntimeProfile,
  listAgentRuntimeProfiles,
  resolveAgentRuntimeProfileHome,
  type AgentRuntimeProfileCommandResult,
  type AgentRuntimeProfileInfo,
} from '../agent/runtime-profile.ts';
import type { CliCommandOutput, GoodVibesCliParseResult } from './types.ts';

interface ProfilesCommandRuntime {
  readonly cli: GoodVibesCliParseResult;
  readonly homeDirectory: string;
}

function hasYes(args: readonly string[]): boolean {
  return args.includes('--yes');
}

function commandValues(args: readonly string[]): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith('--')) values.push(token);
  }
  return values;
}

function profileLine(profile: AgentRuntimeProfileInfo): string {
  const created = profile.createdAt ? ` created=${profile.createdAt}` : '';
  return `  ${profile.id}  home=${profile.homeDirectory}${created}`;
}

function renderProfilesResult(result: AgentRuntimeProfileCommandResult): string {
  if (!result.ok) return result.error ?? 'Agent profile command failed.';
  if (result.kind === 'agent.profiles.list') {
    const profiles = result.data?.profiles ?? [];
    if (profiles.length === 0) return 'No Agent runtime profiles. Use: goodvibes-agent profiles create <name> --yes';
    return [
      `Agent runtime profiles (${profiles.length})`,
      ...profiles.map(profileLine),
    ].join('\n');
  }
  const profile = result.data?.profile;
  if (result.kind === 'agent.profiles.create' && profile) {
    return [
      `Agent runtime profile created: ${profile.id}`,
      `  home: ${profile.homeDirectory}`,
      `  use: ${result.data?.nextCommand ?? `goodvibes-agent --agent-profile ${profile.id}`}`,
    ].join('\n');
  }
  if (result.kind === 'agent.profiles.delete' && profile) {
    return `Agent runtime profile deleted: ${profile.id}`;
  }
  return 'Agent profile command completed.';
}

function renderProfilesOutput(result: AgentRuntimeProfileCommandResult, format: string): string {
  if (format === 'json') return JSON.stringify(result, null, 2);
  return renderProfilesResult(result);
}

export async function handleProfilesCommand(runtime: ProfilesCommandRuntime): Promise<CliCommandOutput> {
  const [sub = 'list', ...rawRest] = runtime.cli.commandArgs;
  const values = commandValues(rawRest);

  try {
    if (sub === 'list' || sub === 'ls') {
      const result: AgentRuntimeProfileCommandResult = {
        ok: true,
        kind: 'agent.profiles.list',
        data: { profiles: listAgentRuntimeProfiles(runtime.homeDirectory) },
      };
      return {
        output: renderProfilesOutput(result, runtime.cli.flags.outputFormat),
        exitCode: 0,
      };
    }

    if (sub === 'show' || sub === 'path' || sub === 'home') {
      const name = values[0];
      if (!name) {
        const result: AgentRuntimeProfileCommandResult = {
          ok: false,
          kind: 'agent.profiles.error',
          error: 'Usage: goodvibes-agent profiles show <name>',
        };
        return {
          output: renderProfilesOutput(result, runtime.cli.flags.outputFormat),
          exitCode: 2,
        };
      }
      const profile = resolveAgentRuntimeProfileHome(runtime.homeDirectory, name);
      const result: AgentRuntimeProfileCommandResult = {
        ok: true,
        kind: 'agent.profiles.show',
        data: { profile: { ...profile, createdAt: null } },
      };
      const text = [`Agent runtime profile: ${profile.id}`, `  home: ${profile.homeDirectory}`, `  use: goodvibes-agent --agent-profile ${profile.id}`].join('\n');
      return {
        output: runtime.cli.flags.outputFormat === 'json' ? JSON.stringify(result, null, 2) : text,
        exitCode: 0,
      };
    }

    if (sub === 'create') {
      const name = values[0];
      if (!name) {
        const result: AgentRuntimeProfileCommandResult = {
          ok: false,
          kind: 'agent.profiles.error',
          error: 'Usage: goodvibes-agent profiles create <name> --yes',
        };
        return {
          output: renderProfilesOutput(result, runtime.cli.flags.outputFormat),
          exitCode: 2,
        };
      }
      if (!hasYes(rawRest)) {
        const result: AgentRuntimeProfileCommandResult = {
          ok: false,
          kind: 'agent.profiles.error',
          error: `Refusing to create Agent runtime profile ${name} without --yes.`,
        };
        return {
          output: renderProfilesOutput(result, runtime.cli.flags.outputFormat),
          exitCode: 2,
        };
      }
      const profile = createAgentRuntimeProfile(runtime.homeDirectory, name);
      const result: AgentRuntimeProfileCommandResult = {
        ok: true,
        kind: 'agent.profiles.create',
        data: {
          profile,
          nextCommand: `goodvibes-agent --agent-profile ${profile.id}`,
        },
      };
      return {
        output: renderProfilesOutput(result, runtime.cli.flags.outputFormat),
        exitCode: 0,
      };
    }

    if (sub === 'delete' || sub === 'remove') {
      const name = values[0];
      if (!name) {
        const result: AgentRuntimeProfileCommandResult = {
          ok: false,
          kind: 'agent.profiles.error',
          error: 'Usage: goodvibes-agent profiles delete <name> --yes',
        };
        return {
          output: renderProfilesOutput(result, runtime.cli.flags.outputFormat),
          exitCode: 2,
        };
      }
      if (!hasYes(rawRest)) {
        const result: AgentRuntimeProfileCommandResult = {
          ok: false,
          kind: 'agent.profiles.error',
          error: `Refusing to delete Agent runtime profile ${name} without --yes.`,
        };
        return {
          output: renderProfilesOutput(result, runtime.cli.flags.outputFormat),
          exitCode: 2,
        };
      }
      const resolution = resolveAgentRuntimeProfileHome(runtime.homeDirectory, name);
      const deleted = deleteAgentRuntimeProfile(runtime.homeDirectory, name);
      const result: AgentRuntimeProfileCommandResult = deleted
        ? {
          ok: true,
          kind: 'agent.profiles.delete',
          data: { profile: { ...resolution, createdAt: null } },
        }
        : {
          ok: false,
          kind: 'agent.profiles.error',
          error: `Agent runtime profile not found: ${resolution.id}`,
      };
      return {
        output: renderProfilesOutput(result, runtime.cli.flags.outputFormat),
        exitCode: deleted ? 0 : 1,
      };
    }

    const result: AgentRuntimeProfileCommandResult = {
      ok: false,
      kind: 'agent.profiles.error',
      error: 'Usage: goodvibes-agent profiles [list|show <name>|create <name> --yes|delete <name> --yes]',
    };
    return {
      output: renderProfilesOutput(result, runtime.cli.flags.outputFormat),
      exitCode: 2,
    };
  } catch (error) {
    const result: AgentRuntimeProfileCommandResult = {
      ok: false,
      kind: 'agent.profiles.error',
      error: error instanceof Error ? error.message : String(error),
    };
    return {
      output: renderProfilesOutput(result, runtime.cli.flags.outputFormat),
      exitCode: 2,
    };
  }
}
