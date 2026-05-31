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
    '  web                        Show browser surface bind URL and enablement',
    '  service                    Inspect existing daemon service posture (read-only)',
    '  status                     Print config, provider, service, and onboarding posture',
    '  doctor                     Print status plus setup warnings',
    '  onboarding [status]        Open Agent onboarding, or print onboarding status',
    '  models [provider]          List/use/pin selectable models and recent model history',
    '  providers                  List/inspect/use provider config/auth posture',
    '  profiles                   Manage isolated Agent runtime profile homes',
    '  auth                       Inspect and manage local users, sessions, and bootstrap auth',
    '  compat                     Inspect Agent SDK pin, daemon version, and Agent knowledge route readiness',
    '  capabilities               Show OpenClaw/Hermes capability parity and Agent readiness',
    '  knowledge                  Use isolated Agent Knowledge/Wiki routes',
    '  ask|search                 Shortcuts for isolated Agent Knowledge ask/search',
    '  delegate                   Explicitly delegate build/fix/review work to GoodVibes TUI',
    '  subscription               Start/finish/logout provider subscription sessions',
    '  secrets                    List, set, link, delete, and test GoodVibes secret refs',
    '  sessions                   List, show, export, or resume saved sessions',
    '  tasks                      List/show in-process runtime tasks (read-only)',
    '  pair|qrcode                Print companion pairing payload and QR code',
    '  surfaces                   Inspect/check browser/listener/external surfaces (read-only)',
    '  listener test              Test HTTP listener/webhook readiness',
    '  control-plane status       Inspect daemon auth, local admin, tokens, and ports',
    '  bundle export|inspect|import',
    '                             Move setup/profile/trust/support bundles',
    '  remote|bridge              Inspect remote runner/node posture',
    '  completion <shell>         Generate shell completion script',
    '  help [command]             Print this help or command-specific help',
    '  version                    Print version',
    '',
    'Options:',
    '  -m, --model <registryKey>       Override model. provider:model infers --provider',
    '      --provider <id>            Override provider',
    '      --agent-profile <name>     Use an isolated Agent runtime profile home',
    '  -C, --cd <dir>                 Set working directory for this launch',
    '      --working-dir <dir>        Alias for --cd',
    '      --daemon-home <dir>        Override daemon home for daemon-backed commands',
    '  -c, --config <key=value>       Override a config value for this launch',
    '      --enable <feature>         Enable a feature flag for this launch',
    '      --disable <feature>        Disable a feature flag for this launch',
    '  -p, --prompt <text>            Run a non-interactive prompt',
    '      --print                    Alias for non-interactive run mode',
    '  -o, --output <format>          text, json, or stream-json',
    '      --output-format <format>   Alias for --output',
    '      --json                     Alias for --output-format json',
    '      --no-alt-screen            Keep output in normal terminal scrollback',
    '      --port <port>              Port for server/web commands',
    '      --hostname <host>          Hostname for server/web commands',
    '      --open                     Open browser when supported',
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
    `  ${binary} compat`,
    `  ${binary} capabilities`,
    `  ${binary} knowledge status`,
    `  ${binary} knowledge ask "What is GoodVibes Agent?"`,
    `  ${binary} ask "What is GoodVibes Agent?"`,
    `  ${binary} search "release checklist"`,
    `  ${binary} delegate --wrfc "fix the failing tests in ~/work/project"`,
    `  ${binary} surfaces`,
    `  ${binary} surfaces check`,
    `  ${binary} service check`,
    `  ${binary} listener test`,
    `  ${binary} control-plane status`,
    `  ${binary} subscription providers`,
    `  ${binary} subscription login openai start --open`,
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
    examples: ['run "summarize the current project"', 'run --output json "list risks"', 'exec --output stream-json "check daemon status"'],
  },
  onboarding: {
    usage: ['onboarding', 'setup', 'onboarding status'],
    summary: 'Open the setup wizard, or inspect whether onboarding has already been shown for this user.',
    examples: ['onboarding', 'onboarding status'],
  },
  status: {
    usage: ['status', 'status --json'],
    summary: 'Print config, provider, auth, service, surface, and onboarding posture.',
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
    summary: 'Create and inspect isolated Agent runtime profile homes, with starter templates for household, research, travel, operations, personal productivity, and local imported starters. A profile changes Agent-local config, sessions, memory, personas, skills, routines, and setup paths without changing the externally owned daemon.',
    examples: ['profiles templates', 'profiles templates export research ./research-starter.json --yes', 'profiles templates import ./research-starter.json --yes', 'profiles create household --template household --yes', '--agent-profile household status'],
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
    summary: 'Inspect package SDK pin, live daemon version, and Agent-specific knowledge route readiness.',
    examples: ['compat', 'compat --json'],
  },
  capabilities: {
    usage: ['capabilities [openclaw|hermes|query]', 'capabilities --json'],
    summary: 'Show the OpenClaw/Hermes capability benchmark, Agent readiness, configuration commands, usage paths, and next product gaps.',
    examples: ['capabilities', 'capabilities hermes', 'capabilities knowledge --json'],
  },
  knowledge: {
    usage: [
      'knowledge status',
      'knowledge ask <question> [--limit <n>] [--mode concise|standard|detailed]',
      'knowledge search <query> [--limit <n>]',
      'knowledge ingest-url <url> [--title <title>] [--tags a,b] --yes',
    ],
    summary: 'Call isolated Agent Knowledge/Wiki routes under /api/goodvibes-agent/knowledge. No default wiki or HomeGraph fallback.',
    examples: [
      'knowledge status',
      'knowledge ask "What is GoodVibes Agent?"',
      'knowledge search "release checklist"',
      'knowledge ingest-url https://example.com/page --title "Reference" --yes',
    ],
  },
  ask: {
    usage: ['ask <question> [--limit <n>] [--mode concise|standard|detailed]'],
    summary: 'Shortcut for isolated Agent Knowledge ask. This never queries default Knowledge/Wiki or HomeGraph.',
    examples: ['ask "What is GoodVibes Agent?"', 'ask "release checklist" --mode concise'],
  },
  search: {
    usage: ['search <query> [--limit <n>]'],
    summary: 'Shortcut for isolated Agent Knowledge search. This never queries default Knowledge/Wiki or HomeGraph.',
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
  surfaces: {
    usage: ['surfaces [list]', 'surfaces check', 'surfaces show <surfaceId>'],
    summary: 'Inspect browser, control-plane, HTTP listener, and external integration surfaces. Agent does not mutate daemon/listener posture.',
    examples: ['surfaces', 'surfaces check', 'surfaces show slack'],
  },
  listener: {
    usage: ['listener test'],
    summary: 'Check HTTP listener/webhook readiness, network posture, service posture, auth, and enabled surface requirements.',
    examples: ['listener test', 'listener test --json'],
  },
  'control-plane': {
    usage: ['control-plane status'],
    summary: 'Inspect daemon control-plane bind posture, reachability, local auth, bootstrap credentials, and operator tokens.',
    examples: ['control-plane status', 'control-plane status --json'],
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
  web: {
    usage: ['web [--open]'],
    summary: 'Show the configured browser surface URL, bind address, and enablement state.',
    examples: ['web', 'web --open', 'web --hostname 0.0.0.0 --port 3423'],
  },
  service: {
    usage: ['service status', 'service check'],
    summary: 'Inspect the externally owned GoodVibes daemon service posture. Agent does not install, start, stop, restart, or uninstall the daemon.',
    examples: ['service status', 'service check --json'],
  },
  completion: {
    usage: ['completion <bash|zsh|fish>'],
    summary: 'Generate shell completion scripts.',
    examples: ['completion bash', 'completion zsh'],
  },
  serve: {
    usage: ['serve [--hostname <host>] [--port <port>]', 'daemon [--hostname <host>] [--port <port>]'],
    summary: 'Unavailable in GoodVibes Agent. Agent connects to an already-running GoodVibes daemon owned by GoodVibes TUI/daemon tooling.',
    examples: [],
  },
  remote: {
    usage: ['remote', 'bridge'],
    summary: 'Inspect remote runner/node posture and bridge readiness.',
    examples: ['remote', 'bridge'],
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
  surface: 'surfaces',
  webhook: 'listener',
  controlplane: 'control-plane',
  cp: 'control-plane',
  qrcode: 'pair',
  qr: 'pair',
  daemon: 'serve',
  server: 'serve',
  services: 'service',
  bridge: 'remote',
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

export function renderGoodVibesDaemonHelp(binary = 'goodvibes-daemon'): string {
  return [
    `Usage: ${binary} [OPTIONS]`,
    '',
    'Unavailable in GoodVibes Agent.',
    '',
    'GoodVibes Agent connects to an already-running GoodVibes daemon. It does not start, install, restart, or own daemon/listener lifecycle.',
    'Use GoodVibes TUI or your daemon host tooling to manage the daemon, then connect with goodvibes-agent.',
    '',
    'Options:',
    '      --daemon-home <dir>        Override daemon home',
    '      --working-dir <dir>        Override working directory',
    '  -C, --cd <dir>                 Alias for --working-dir',
    '      --provider <id>            Override provider',
    '  -m, --model <registryKey>      Override model. provider:model infers --provider',
    '      --hostname <host>          Hostname hint for printed connection info',
    '      --port <port>              Control-plane port override when supported',
    '  -h, --help                     Print help',
    '  -v, --version                  Print version',
  ].join('\n');
}
