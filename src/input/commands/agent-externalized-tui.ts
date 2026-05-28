import type { CommandRegistry, SlashCommand } from '../command-registry.ts';

type ExternalizedCommandId = 'git' | 'diff' | 'worktree' | 'sandbox';

interface ExternalizedCommandSpec {
  readonly name: ExternalizedCommandId;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly usage: string;
  readonly owner: string;
  readonly reason: string;
}

const EXTERNALIZED_TUI_COMMANDS: readonly ExternalizedCommandSpec[] = [
  {
    name: 'git',
    aliases: ['g'],
    description: 'Externalized: git workflows are owned by GoodVibes TUI',
    usage: '[status|log|diff]',
    owner: 'GoodVibes TUI',
    reason: 'Git status, commits, and repository mutation belong to the coding TUI, not the serial Agent surface.',
  },
  {
    name: 'diff',
    aliases: ['d'],
    description: 'Externalized: code diff review is owned by GoodVibes TUI',
    usage: '[session|head|working|staged|<git-ref>]',
    owner: 'GoodVibes TUI',
    reason: 'Diff views are part of delegated build/fix/review work and should stay attached to the coding TUI execution context.',
  },
  {
    name: 'worktree',
    aliases: ['worktrees'],
    description: 'Externalized: git worktree lifecycle is owned by GoodVibes TUI',
    usage: '[review|inspect|attach|recover|cleanup]',
    owner: 'GoodVibes TUI',
    reason: 'Worktree creation, attachment, recovery, and cleanup are coding-session lifecycle operations.',
  },
  {
    name: 'sandbox',
    description: 'Externalized: sandbox and QEMU workflows are owned by GoodVibes TUI',
    usage: '[review|probe|session|qemu|bundle|preset]',
    owner: 'GoodVibes TUI',
    reason: 'Sandbox/QEMU setup and session execution are terminal-native coding/runtime isolation workflows.',
  },
];

function makeExternalizedCommand(spec: ExternalizedCommandSpec): SlashCommand {
  return {
    name: spec.name,
    aliases: spec.aliases ? [...spec.aliases] : undefined,
    description: spec.description,
    usage: spec.usage,
    argsHint: spec.usage,
    handler(_args, ctx) {
      ctx.print([
        `${spec.name} is externalized in GoodVibes Agent.`,
        `  owner: ${spec.owner}`,
        `  reason: ${spec.reason}`,
        '  Agent policy: no local coding TUI, git/worktree, or sandbox execution from this surface.',
        '  build/fix/review: ask Agent to delegate the full request to GoodVibes TUI, or run goodvibes-tui in the target workspace.',
        '  result: blocked here; no local files, config, worktrees, sandbox sessions, or repository state were changed.',
      ].join('\n'));
    },
  };
}

export function registerAgentExternalizedTuiCommands(registry: CommandRegistry): void {
  for (const spec of EXTERNALIZED_TUI_COMMANDS) {
    registry.register(makeExternalizedCommand(spec));
  }
}

