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
    '  tui|launch [path]          Start the interactive Agent terminal UI (default)',
    '  run|exec [prompt]          Run non-interactively with text/json/stream-json output',
    '  status                     Print config, provider, auth, and setup posture',
    '  doctor                     Print status plus setup warnings',
    '  setup|onboarding [status]  Open Agent setup, or print setup status',
    '  models [provider]          List/use/pin selectable models and recent model history',
    '  providers                  List/inspect/use provider config/auth posture',
    '  profiles                   Manage isolated Agent profile homes',
    '  personas                   Manage local Agent personas',
    '  skills                     Manage local Agent skills and skill bundles',
    '  memory                     Manage Agent-owned durable memory records',
    '  routines                   Inspect local routines and explicitly promote one to an external schedule',
    '  auth                       Inspect Agent auth posture and external runtime token state',
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
    '      --runtime-url <url>        External GoodVibes runtime API root',
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
    `  ${binary} launch`,
    `  ${binary} --no-alt-screen`,
    `  ${binary} --cd ~/work/project --model openai:gpt-5.2`,
    `  ${binary} setup`,
    `  ${binary} setup status`,
    `  ${binary} status`,
    `  ${binary} --runtime-url http://127.0.0.1:3421 status`,
    `  ${binary} models current`,
    `  ${binary} models use openai:gpt-5.2`,
    `  ${binary} providers inspect openai`,
    `  ${binary} profiles create household --template household --yes`,
    `  ${binary} --agent-profile household`,
    `  ${binary} personas create --name "Travel Planner" --description "Plan trips" --body "Compare options before booking"`,
    `  ${binary} skills create --name "Daily Brief" --description "Summarize operator state" --procedure "Review Agent Knowledge, work plans, approvals, and routines" --enabled`,
    `  ${binary} memory add fact "Prefers concise morning briefings" --scope project --tags preference`,
    `  ${binary} memory search "morning briefings"`,
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
    usage: ['tui [path]', 'launch [path]', '[prompt]'],
    summary: 'Start the interactive Agent terminal UI. A prompt starts Agent with that prompt seeded.',
    examples: ['', 'launch', 'tui ~/work/project', '"summarize current tasks"'],
  },
  run: {
    usage: ['run [prompt] [--output text|json|stream-json]', 'exec [prompt]'],
    summary: 'Run a single non-interactive agent turn and write the result to stdout.',
    examples: ['run "summarize the current project"', 'run --output json "list risks"', 'exec --output stream-json "check runtime status"'],
  },
  setup: {
    usage: ['setup', 'setup status', 'onboarding', 'onboarding status'],
    summary: 'Open Agent setup, or inspect whether setup has already been shown for this user.',
    examples: ['setup', 'setup status', 'onboarding status'],
  },
  status: {
    usage: ['status', 'status --json', '--runtime-url http://127.0.0.1:3421 status'],
    summary: 'Print Agent config, provider, auth, runtime connection, and setup posture.',
    examples: ['status', 'status --json', '--runtime-url http://127.0.0.1:3421 status'],
  },
  doctor: {
    usage: ['doctor', 'doctor --json', '--runtime-url http://127.0.0.1:3421 doctor'],
    summary: 'Print status plus actionable setup warnings with cause, impact, and next action.',
    examples: ['doctor', 'doctor --json', '--runtime-url http://127.0.0.1:3421 doctor'],
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
  personas: {
    usage: [
      'personas list',
      'personas active',
      'personas search <query>',
      'personas show <id>',
      'personas create --name <name> --description <summary> --body <instructions> [--tags a,b] [--triggers a,b] [--use]',
      'personas update <id> [--name <name>] [--description <summary>] [--body <instructions>] [--tags a,b] [--triggers a,b]',
      'personas use <id>',
      'personas clear',
      'personas review <id>',
      'personas stale <id> <reason>',
      'personas delete <id> --yes',
    ],
    summary: 'Manage Agent-local personas for the serial main conversation. Personas do not spawn worker agents.',
    examples: [
      'personas list',
      'personas create --name "Travel Planner" --description "Plan trips" --body "Compare options before booking" --use',
      'personas review travel-planner',
      'personas delete travel-planner --yes',
    ],
  },
  skills: {
    usage: [
      'skills list',
      'skills enabled',
      'skills active',
      'skills search <query>',
      'skills show <id>',
      'skills create --name <name> --description <summary> --procedure <steps> [--tags a,b] [--triggers a,b] [--enabled]',
      'skills update <id> [--name <name>] [--description <summary>] [--procedure <steps>] [--tags a,b] [--triggers a,b]',
      'skills enable <id>',
      'skills disable <id>',
      'skills review <id>',
      'skills stale <id> <reason>',
      'skills delete <id> --yes',
      'skills bundle [list|enabled|show|create|update|enable|disable|review|stale|delete]',
    ],
    summary: 'Manage reusable Agent-local procedures and skill bundles for the main conversation.',
    examples: [
      'skills list',
      'skills create --name "Daily Brief" --description "Summarize operator state" --procedure "Review Agent Knowledge, work plans, approvals, and routines" --enabled',
      'skills bundle create --name "Ops Pack" --description "Daily operations bundle" --skills daily-brief --enabled',
      'skills delete daily-brief --yes',
    ],
  },
  memory: {
    usage: [
      'memory list [class] [--scope session|project|team] [--limit <n>]',
      'memory search <query> [--semantic] [--cls <class>] [--scope <scope>] [--limit <n>]',
      'memory add <class> <summary> [--scope <scope>] [--detail <text>] [--tags a,b] [--confidence <0-100>]',
      'memory show <id>',
      'memory queue [limit]',
      'memory review <id> <fresh|reviewed|stale|contradicted> [--confidence <0-100>] [--by <name>] [--reason <text>]',
      'memory stale <id> <reason>',
      'memory contradict <id> <reason>',
      'memory promote <id> <session|project|team> --yes',
      'memory link <fromId> <toId> <relation> --yes',
      'memory delete <id> --yes',
      'memory export <path> [--scope <scope>] [--cls <class>] --yes',
      'memory import <path> --yes',
      'memory handoff-inspect <path>',
      'memory vector [status|doctor|rebuild]',
    ],
    summary: 'Manage Agent-owned durable memory. This uses the Agent memory store only; it never falls back to default Knowledge/Wiki or non-Agent knowledge segments.',
    examples: [
      'memory list',
      'memory add fact "Prefers concise morning briefings" --scope project --tags preference',
      'memory search "morning briefings"',
      'memory review mem-1 reviewed --confidence 92',
      'memory export ./agent-memory.json --scope project --yes',
      'memory delete mem-1 --yes',
    ],
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
    usage: ['auth', 'auth status', 'auth review', 'auth users', 'auth sessions'],
    summary: 'Inspect Agent auth posture and external runtime token state. Runtime user/session administration belongs to the runtime-owning TUI or host tooling.',
    examples: ['auth', 'auth status', 'auth users'],
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
      'knowledge list [--kind sources|nodes|issues] [--limit <n>]',
      'knowledge get <id>',
      'knowledge connectors',
      'knowledge ingest-url <url> [--title <title>] [--tags a,b] --yes',
      'knowledge import-urls <path> --yes',
      'knowledge import-bookmarks <path> --yes',
      'knowledge reindex --yes',
    ],
    summary: 'Call isolated Agent Knowledge/Wiki routes under /api/goodvibes-agent/knowledge. No default wiki or non-Agent fallback.',
    examples: [
      'knowledge status',
      'knowledge ask "What is GoodVibes Agent?"',
      'knowledge search "release checklist"',
      'knowledge list --kind sources',
      'knowledge connectors',
      'knowledge ingest-url https://example.com/page --title "Reference" --yes',
      'knowledge import-urls ~/agent-links.txt --yes',
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
    usage: ['subscription list', 'subscription providers', 'subscription inspect <provider>', 'subscription login <provider> start [--open]', 'subscription login <provider> finish <code-or-url>', 'subscription logout <provider>'],
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
    summary: 'Inspect in-process runtime tasks. Agent blocks runtime-owned task submission; use run for one-shot work or delegate for explicit build/fix/review handoff.',
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
  onboarding: 'setup',
  provider: 'providers',
  model: 'models',
  profile: 'profiles',
  persona: 'personas',
  skill: 'skills',
  'agent-skills': 'skills',
  memories: 'memory',
  recall: 'memory',
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
