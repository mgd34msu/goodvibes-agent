import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../version.ts';

function readJsonVersion(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

export function getPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readJsonVersion(join(here, '..', '..', 'package.json'))
    ?? VERSION;
}

export function renderGoodVibesVersion(binary = 'goodvibes-agent'): string {
  return `${binary} ${getPackageVersion()}`;
}

export function renderGoodVibesHelp(binary = 'goodvibes-agent'): string {
  return [
    `Usage: ${binary} [OPTIONS] [PROMPT]`,
    `       ${binary} [OPTIONS] <COMMAND> [ARGS]`,
    '',
    'Commands:',
    '  tui [path]                 Start the interactive Agent terminal UI (default)',
    '  run|exec [prompt]          Run non-interactively with text/json/stream-json output',
    '  status                     Print config, provider, auth, and onboarding posture',
    '  doctor                     Print status plus setup warnings',
    '  onboarding [status]        Open Agent onboarding, or print onboarding status',
    '  models [provider]          List/use/pin selectable models and recent model history',
    '  providers                  List/inspect/use provider config/auth posture',
    '  profiles                   Manage isolated Agent profile homes',
    '  routines                   Inspect local routines and explicitly promote one to an external schedule',
    '  auth                       Inspect and manage local users, sessions, and bootstrap auth',
    '  compat                     Inspect Agent SDK pin, runtime version, and Agent knowledge route readiness',
    '  knowledge                  Use isolated Agent Knowledge/Wiki routes',
    '  ask|search                 Shortcuts for isolated Agent Knowledge ask/search',
    '  delegate                   Explicitly delegate build/fix/review work to GoodVibes TUI',
    '  subscription               Start/finish/logout provider subscription sessions',
    '  secrets                    List, set, link, delete, and test GoodVibes secret refs',
    '  sessions                   List, show, export, or resume saved sessions',
    '  pair|qrcode                Print companion pairing payload and QR code',
    '  bundle export|inspect|import',
    '                             Move setup/profile/trust/support bundles',
    '  completion <shell>         Generate shell completion script',
    '  help [command]             Print this help or command-specific help',
    '  version                    Print version',
    '',
    'Options:',
    '  -m, --model <registryKey>       Override model. provider:model infers --provider',
    '      --provider <id>            Override provider',
    '      --agent-profile <name>     Use an isolated Agent profile home',
    '  -C, --cd <dir>                 Set working directory for this launch',
    '      --working-dir <dir>        Alias for --cd',
    '  -c, --config <key=value>       Override a config value for this launch',
    '      --enable <feature>         Enable a feature flag for this launch',
    '      --disable <feature>        Disable a feature flag for this launch',
    '  -p, --prompt <text>            Run a non-interactive prompt',
    '      --print                    Alias for non-interactive run mode',
    '  -o, --output <format>          text, json, or stream-json',
    '      --output-format <format>   Alias for --output',
    '      --json                     Alias for --output-format json',
    '      --no-alt-screen            Keep output in normal terminal scrollback',
    '  -r, --resume [id|latest]       Resume saved session when supported',
    '  -s, --session <id>             Use a specific session when supported',
    '      --continue                 Continue the latest session when supported',
    '      --fork                     Fork session when supported',
    '  -h, --help                     Print help',
    '  -v, --version                  Print version',
    '',
    'Examples:',
    `  ${binary}`,
    `  ${binary} --no-alt-screen`,
    `  ${binary} --cd ~/work/project --model openai:gpt-5.2`,
    `  ${binary} onboarding`,
    `  ${binary} onboarding status`,
    `  ${binary} status`,
    `  ${binary} models current`,
    `  ${binary} models use openai:gpt-5.2`,
    `  ${binary} providers inspect openai`,
    `  ${binary} profiles create household --template household --yes`,
    `  ${binary} --agent-profile household`,
    `  ${binary} routines promote daily-operations-sweep --cron "0 9 * * *" --timezone America/Chicago --yes`,
    `  ${binary} compat`,
    `  ${binary} knowledge status`,
    `  ${binary} knowledge ask "What is GoodVibes Agent?"`,
    `  ${binary} ask "What is GoodVibes Agent?"`,
    `  ${binary} search "release checklist"`,
    `  ${binary} delegate --wrfc "fix the failing tests in ~/work/project"`,
    `  ${binary} subscription providers`,
    `  ${binary} subscription login openai start --open`,
    `  ${binary} pair`,
    `  ${binary} routines list`,
  ].join('\n');
}

type CommandHelp = {
  readonly usage: readonly string[];
  readonly summary: string;
  readonly subcommands?: readonly string[];
  readonly examples?: readonly string[];
};

const COMMAND_HELP: Record<string, CommandHelp> = {
  tui: {
    usage: ['tui [path]', '[prompt]'],
    summary: 'Start the interactive Agent terminal UI. A prompt starts Agent with that prompt seeded.',
    examples: ['', 'tui ~/work/project', '"summarize current tasks"'],
  },
  run: {
    usage: ['run [prompt] [--output text|json|stream-json]', 'exec [prompt]'],
    summary: 'Run a single non-interactive agent turn and write the result to stdout.',
    examples: ['run "summarize the current project"', 'run --output json "list risks"', 'exec --output stream-json "check runtime status"'],
  },
  onboarding: {
    usage: ['onboarding', 'setup', 'onboarding status'],
    summary: 'Open the setup wizard, or inspect whether onboarding has already been shown for this user.',
    examples: ['onboarding', 'onboarding status'],
  },
  status: {
    usage: ['status', 'status --json'],
    summary: 'Print Agent config, provider, auth, runtime connection, and onboarding posture.',
    examples: ['status', 'status --json'],
  },
  doctor: {
    usage: ['doctor', 'doctor --json'],
    summary: 'Print status plus actionable setup warnings with cause, impact, and next action.',
    examples: ['doctor', 'doctor --json'],
  },
  providers: {
    usage: ['providers [list]', 'providers current', 'providers inspect <provider>', 'providers use <provider> [modelRegistryKey]'],
    summary: 'Inspect and change provider setup, auth posture, model counts, and setup class.',
    examples: ['providers', 'providers inspect openai-subscriber', 'providers use openai openai:gpt-5.4'],
  },
  profiles: {
    usage: ['profiles list', 'profiles templates', 'profiles templates export <id> <path> --yes', 'profiles templates import <path> --yes', 'profiles show <name>', 'profiles create <name> [--template <id>] --yes', 'profiles delete <name> --yes', '--agent-profile <name>'],
    summary: 'Create and inspect isolated Agent profile homes, with starter templates for household, research, travel, operations, personal productivity, and local imported starters. A profile changes Agent-local config, sessions, memory, personas, skills, routines, and setup paths without changing the shared GoodVibes runtime.',
    examples: ['profiles templates', 'profiles templates export research ./research-starter.json --yes', 'profiles templates import ./research-starter.json --yes', 'profiles create household --template household --yes', '--agent-profile household status'],
  },
  routines: {
    usage: [
      'routines list',
      'routines enabled',
      'routines show <id>',
      'routines receipts',
      'routines reconcile',
      'routines receipt <receipt-id>',
      'routines promote <id> (--cron <expr>|--every <interval>|--at <iso-time>) [--timezone <tz>] [--name <schedule-name>] [--provider <id>] [--model <model>] [--delivery-channel <channel[:route[:label]]>|--delivery-route <route[:label]>|--delivery-webhook <url>|--delivery-link <url>] [--disabled] --yes',
    ],
    summary: 'Inspect Agent-local routines, review local promotion receipts, reconcile receipts against live external schedules, and explicitly promote a reviewed routine into a GoodVibes schedule. Without --yes, promote only prints the schedules.create preview.',
    examples: [
      'routines list',
      'routines show daily-operations-sweep',
      'routines receipts',
      'routines reconcile',
      'routines promote daily-operations-sweep --cron "0 9 * * *" --timezone America/Chicago --delivery-channel slack --yes',
      'routines promote weekly-review --every 7d --disabled',
    ],
  },
  models: {
    usage: ['models [provider]', 'models current', 'models use <registryKey>', 'models pin <registryKey>', 'models recent'],
    summary: 'List, inspect, select, pin, and review model choices.',
    examples: ['models current', 'models openai', 'models use openai:gpt-5.4'],
  },
  auth: {
    usage: ['auth status', 'auth users', 'auth sessions', 'auth add-user <username>', 'auth clear-bootstrap'],
    summary: 'Inspect and manage local admin users, bootstrap auth, and local sessions.',
    examples: ['auth', 'auth add-user admin --password-stdin', 'auth clear-bootstrap'],
  },
  compat: {
    usage: ['compat', 'compat --json'],
    summary: 'Inspect package SDK pin, live runtime version, and Agent-specific knowledge route readiness.',
    examples: ['compat', 'compat --json'],
  },
  knowledge: {
    usage: [
      'knowledge status',
      'knowledge ask <question> [--limit <n>] [--mode concise|standard|detailed]',
      'knowledge search <query> [--limit <n>]',
      'knowledge ingest-url <url> [--title <title>] [--tags a,b] --yes',
    ],
    summary: 'Call isolated Agent Knowledge/Wiki routes under /api/goodvibes-agent/knowledge. No default wiki or non-Agent fallback.',
    examples: [
      'knowledge status',
      'knowledge ask "What is GoodVibes Agent?"',
      'knowledge search "release checklist"',
      'knowledge ingest-url https://example.com/page --title "Reference" --yes',
    ],
  },
  ask: {
    usage: ['ask <question> [--limit <n>] [--mode concise|standard|detailed]'],
    summary: 'Shortcut for isolated Agent Knowledge ask. This never queries default Knowledge/Wiki or non-Agent knowledge.',
    examples: ['ask "What is GoodVibes Agent?"', 'ask "release checklist" --mode concise'],
  },
  search: {
    usage: ['search <query> [--limit <n>]'],
    summary: 'Shortcut for isolated Agent Knowledge search. This never queries default Knowledge/Wiki or non-Agent knowledge.',
    examples: ['search "release checklist"', 'search "operator workspace" --limit 5'],
  },
  delegate: {
    usage: ['delegate [--wrfc] <build/fix/review task>'],
    summary: 'Create one shared-session task request for GoodVibes TUI. WRFC is requested only with --wrfc.',
    examples: [
      'delegate "fix the failing tests in this repo"',
      'delegate --wrfc "implement the settings screen and review it"',
    ],
  },
  subscription: {
    usage: ['subscription list', 'subscription providers', 'subscription inspect <provider>', 'subscription login <provider> start|finish', 'subscription logout <provider>'],
    summary: 'Manage OAuth/subscription-backed provider sessions such as OpenAI subscription access.',
    examples: ['subscription providers', 'subscription login openai start --open', 'subscription inspect openai'],
  },
  secrets: {
    usage: ['secrets list', 'secrets providers', 'secrets test goodvibes://secrets/<source>/...', 'secrets set <KEY> <value>', 'secrets link <KEY> <ref>'],
    summary: 'Manage GoodVibes secret records and secret references. Secret refs never embed secret values.',
    examples: ['secrets providers', 'secrets test goodvibes://secrets/env/OPENAI_API_KEY', 'secrets link OPENAI_API_KEY goodvibes://secrets/env/OPENAI_API_KEY'],
  },
  sessions: {
    usage: ['sessions list', 'sessions show <id|name>', 'sessions export <id|name> [path]', 'sessions resume <id|name>'],
    summary: 'List, inspect, export, or resume saved Agent terminal sessions.',
    examples: ['sessions list', 'sessions show latest-session', 'sessions export abc123 session.json'],
  },
  tasks: {
    usage: ['tasks list', 'tasks show <taskId>'],
    summary: 'Inspect in-process runtime tasks. Agent blocks copied task submission; use run for one-shot work or delegate for explicit build/fix/review handoff.',
    examples: ['tasks list', 'tasks show task-123', 'run "check provider readiness"', 'delegate "fix the failing tests"'],
  },
  bundle: {
    usage: ['bundle export [path]', 'bundle inspect <path>', 'bundle import <path>'],
    summary: 'Export, inspect, or import setup/profile/trust/support bundle data.',
    examples: ['bundle export goodvibes-agent-bundle.json', 'bundle inspect goodvibes-agent-bundle.json'],
  },
  pair: {
    usage: ['pair', 'qrcode'],
    summary: 'Print companion pairing connection details and a QR code.',
    examples: ['pair', 'qrcode'],
  },
  completion: {
    usage: ['completion <bash|zsh|fish>'],
    summary: 'Generate shell completion scripts.',
    examples: ['completion bash', 'completion zsh'],
  },
};

const HELP_ALIASES: Record<string, string> = {
  app: 'tui',
  exec: 'run',
  setup: 'onboarding',
  provider: 'providers',
  model: 'models',
  profile: 'profiles',
  subscriptions: 'subscription',
  secret: 'secrets',
  session: 'sessions',
  task: 'tasks',
  qrcode: 'pair',
  qr: 'pair',
};

function normalizeHelpTopic(topic: string): string {
  const normalized = topic.trim().toLowerCase();
  return HELP_ALIASES[normalized] ?? normalized;
}

export function renderGoodVibesCommandHelp(topic: string, binary = 'goodvibes-agent'): string {
  const normalized = normalizeHelpTopic(topic);
  const help = COMMAND_HELP[normalized];
  if (!help) {
    return [
      `No detailed help is available for "${topic}".`,
      '',
      renderGoodVibesHelp(binary),
    ].join('\n');
  }
  return [
    `GoodVibes ${normalized}`,
    '',
    help.summary,
    '',
    'Usage:',
    ...help.usage.map((usage) => `  ${binary} ${usage}`),
    ...(help.subcommands && help.subcommands.length > 0 ? [
      '',
      'Subcommands:',
      ...help.subcommands.map((subcommand) => `  ${subcommand}`),
    ] : []),
    ...(help.examples && help.examples.length > 0 ? [
      '',
      'Examples:',
      ...help.examples.map((example) => `  ${binary}${example ? ` ${example}` : ''}`),
    ] : []),
  ].join('\n');
}
