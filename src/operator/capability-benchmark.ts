export type CompetitorProduct = 'openclaw' | 'hermes';

export type CapabilityPosture =
  | 'ready'
  | 'configurable'
  | 'external-daemon'
  | 'explicit-delegation'
  | 'guarded'
  | 'in-progress';

export interface OperatorCapabilityBenchmark {
  readonly id: string;
  readonly title: string;
  readonly posture: CapabilityPosture;
  readonly competitors: readonly CompetitorProduct[];
  readonly competitorBaseline: string;
  readonly goodvibesAgent: string;
  readonly configure: readonly string[];
  readonly use: readonly string[];
  readonly exceedsBy: readonly string[];
  readonly next: readonly string[];
}

export interface OperatorCapabilityBenchmarkReport {
  readonly generatedAt: string;
  readonly packageName: '@pellux/goodvibes-agent';
  readonly benchmarkSources: readonly string[];
  readonly capabilities: readonly OperatorCapabilityBenchmark[];
}

export const OPERATOR_CAPABILITY_BENCHMARK_SOURCES = [
  'https://github.com/openclaw/openclaw/blob/main/README.md',
  'https://docs.openclaw.ai/help/faq',
  'https://docs.openclaw.ai/concepts/memory',
  'https://github.com/NousResearch/hermes-agent',
  'https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/',
  'https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/',
  'https://hermes-agent.nousresearch.com/docs/user-guide/profiles/',
] as const;

export const OPERATOR_CAPABILITY_BENCHMARKS: readonly OperatorCapabilityBenchmark[] = [
  {
    id: 'terminal-operator-ui',
    title: 'Terminal Operator UI',
    posture: 'ready',
    competitors: ['openclaw', 'hermes'],
    competitorBaseline: 'Interactive CLI/TUI entry point with command discovery and persistent sessions.',
    goodvibesAgent: 'Near-fork GoodVibes TUI shell, renderer, compositor, input, fullscreen workspace, history, command registry, and release gates.',
    configure: ['goodvibes-agent onboarding', 'goodvibes-agent status', 'goodvibes-agent --no-alt-screen'],
    use: ['goodvibes-agent', '/agent', '/help'],
    exceedsBy: ['Diff-rendered GoodVibes compositor foundation', 'fullscreen operator workspace', 'strict TypeScript/Bun release gates'],
    next: ['Continue porting more GoodVibes TUI modal/workspace affordances into Agent-first setup flows.'],
  },
  {
    id: 'external-gateway',
    title: 'Always-On Gateway / Daemon',
    posture: 'external-daemon',
    competitors: ['openclaw', 'hermes'],
    competitorBaseline: 'Always-on gateway/service provides channel ingress, sessions, tools, events, and scheduled execution.',
    goodvibesAgent: 'Connects to the GoodVibes daemon owned by GoodVibes TUI/daemon tooling; Agent never starts, stops, or owns daemon lifecycle.',
    configure: ['goodvibes-agent compat', 'goodvibes-agent service check', 'goodvibes-agent control-plane status'],
    use: ['goodvibes-agent status', 'goodvibes-agent doctor'],
    exceedsBy: ['Typed SDK/operator contracts', 'explicit external-daemon boundary', 'no hidden lifecycle mutation from Agent'],
    next: ['Improve daemon route readiness dashboard and setup diagnostics for first-run users.'],
  },
  {
    id: 'multi-channel',
    title: 'Channels And Companion Surfaces',
    posture: 'configurable',
    competitors: ['openclaw', 'hermes'],
    competitorBaseline: 'Messaging gateway for WhatsApp, Telegram, Slack, Discord, Signal, iMessage, web chat, and related platforms.',
    goodvibesAgent: 'Uses GoodVibes daemon channel, companion, pairing, QR, and session surfaces while keeping side effects behind explicit user action.',
    configure: ['goodvibes-agent pair', 'goodvibes-agent qrcode', 'goodvibes-agent surfaces check'],
    use: ['/channels', '/communication', '/pair'],
    exceedsBy: ['Agent-owned safety policy over shared channel routes', 'read-only inspection by default', 'explicit approval path for external side effects'],
    next: ['Add Agent-first channel onboarding workspace that exposes connected accounts, delivery defaults, and pairing state without daemon ownership.'],
  },
  {
    id: 'isolated-knowledge-wiki',
    title: 'Isolated Agent Knowledge / Wiki',
    posture: 'ready',
    competitors: ['openclaw', 'hermes'],
    competitorBaseline: 'Persistent memory and knowledge/wiki layers with search, recall, provenance, and freshness checks.',
    goodvibesAgent: 'Uses only /api/goodvibes-agent/knowledge/*; never falls back to default Knowledge/Wiki, HomeGraph, or Home Assistant routes.',
    configure: ['goodvibes-agent compat', 'goodvibes-agent knowledge status'],
    use: ['goodvibes-agent ask <question>', 'goodvibes-agent search <query>', '/knowledge ask <question>', '/knowledge ingest-url <url> --yes'],
    exceedsBy: ['Dedicated product segment for Agent knowledge', 'route-level isolation', 'package gates that reject default wiki/HomeGraph fallback'],
    next: ['Add richer Agent Knowledge ingestion workflows for artifacts, URLs, bookmarks, and review queues in the fullscreen workspace.'],
  },
  {
    id: 'local-memory-skills-personas',
    title: 'Local Memory, Skills, Personas, And Routines',
    posture: 'ready',
    competitors: ['openclaw', 'hermes'],
    competitorBaseline: 'Skills/procedural memory, persona files, profile state, durable memory, and recurring workflows.',
    goodvibesAgent: 'Typed local registries for Agent personas, skills, routines, and local memory; active items are injected into the serial main conversation.',
    configure: ['/personas create ...', '/agent-skills create ...', '/routines create ...', '/memory add ...'],
    use: ['/personas use <id>', '/skills local list', '/routines start <id>', '/memory search <query>'],
    exceedsBy: ['Review/stale lifecycle fields', 'secret-value rejection', 'Agent-local state that does not contaminate wiki or HomeGraph'],
    next: ['Add CLI parity for local registry lifecycle and a curated starter pack of operator skills/routines.'],
  },
  {
    id: 'automation-schedules',
    title: 'Automation, Schedules, And Routines',
    posture: 'guarded',
    competitors: ['openclaw', 'hermes'],
    competitorBaseline: 'Cron/scheduler can create, pause, resume, run, remove, and deliver recurring tasks from natural language.',
    goodvibesAgent: 'Observes public automation/schedule routes and allows only explicitly confirmed side-effecting route calls; hidden model scheduling/spawn paths are blocked.',
    configure: ['/schedule list', '/routines create ...', 'goodvibes-agent status'],
    use: ['/schedule list', '/routines start <id>'],
    exceedsBy: ['No recursive hidden scheduler creation from model tools', 'explicit confirmation for side effects', 'local routines separate from daemon jobs'],
    next: ['Build Agent-first routine-to-daemon schedule promotion flow with preview, confirmation, delivery target selection, and audit trail.'],
  },
  {
    id: 'tool-gateway-mcp',
    title: 'Tools, MCP, And Managed Integrations',
    posture: 'configurable',
    competitors: ['openclaw', 'hermes'],
    competitorBaseline: 'Broad toolsets, MCP integration, browser/web/media tools, and configurable platform-specific tool availability.',
    goodvibesAgent: 'Uses GoodVibes SDK tool registry, MCP inspection, provider tools, web search, media, plugins, and policy-gated model-visible tools.',
    configure: ['/mcp servers', '/plugin list', 'goodvibes-agent providers', 'goodvibes-agent models'],
    use: ['/mcp tools', '/provider current', 'goodvibes-agent search <query>'],
    exceedsBy: ['Model-visible tool policies for read/write/network boundaries', 'typed contract gates', 'per-tool denial messages aligned with Agent product policy'],
    next: ['Add a task-intent tool picker so only relevant tools are exposed per turn, reducing schema noise while preserving capability breadth.'],
  },
  {
    id: 'voice-media-canvas',
    title: 'Voice, Media, Canvas, And Nodes',
    posture: 'in-progress',
    competitors: ['openclaw', 'hermes'],
    competitorBaseline: 'Voice/TTS, mobile nodes, live canvas, browser automation, image/video generation, and multimodal analysis.',
    goodvibesAgent: 'Carries GoodVibes voice/media/browser/node primitives, but Agent-first setup and canvas/workspace UX still needs product wiring.',
    configure: ['/tts status', '/provider media', '/agent'],
    use: ['/tts speak <text>', '/image', '/media'],
    exceedsBy: ['Shared GoodVibes media/provider substrate', 'future fullscreen workspaces can make setup inspectable and reversible'],
    next: ['Implement Agent setup workspaces for voice, media, browser, and node surfaces with capability tests and non-leaky credential handling.'],
  },
  {
    id: 'explicit-build-delegation',
    title: 'Build/Fix/Review Delegation',
    posture: 'explicit-delegation',
    competitors: ['openclaw', 'hermes'],
    competitorBaseline: 'Terminal/file/code tools and subagents can execute software tasks directly.',
    goodvibesAgent: 'Main assistant stays serial. Explicit build/fix/review/code work is delegated to GoodVibes TUI/shared-session contracts; WRFC is opt-in only.',
    configure: ['goodvibes-agent delegate --help', 'goodvibes-agent compat'],
    use: ['goodvibes-agent delegate "fix the failing tests"', 'goodvibes-agent delegate --wrfc "implement and review the feature"'],
    exceedsBy: ['Keeps personal operator brain separate from coding execution', 'delegates one authoritative TUI-owned execution chain', 'blocks local sibling agent fanout'],
    next: ['Expose delegation receipts and artifacts in the operator workspace, with status recovery and user steering.'],
  },
  {
    id: 'profiles-isolation',
    title: 'Profiles And Isolated Operator State',
    posture: 'configurable',
    competitors: ['hermes'],
    competitorBaseline: 'Profiles run independent agents with isolated configs, sessions, skills, memory, cron jobs, and gateway state.',
    goodvibesAgent: 'Uses Agent surface root, explicit home/working-dir flags, local registries, sessions, and bundle export/import; daemon remains shared/external by design.',
    configure: ['GOODVIBES_AGENT_HOME=<path> goodvibes-agent status', 'goodvibes-agent bundle export goodvibes-agent-bundle.json'],
    use: ['goodvibes-agent --daemon-home <path> status', 'goodvibes-agent sessions list'],
    exceedsBy: ['Typed support bundles', 'explicit daemon boundary', 'no accidental cross-product knowledge fallback'],
    next: ['Add named Agent profiles with command aliases, isolated local registry paths, and profile-aware onboarding.'],
  },
  {
    id: 'security-approvals',
    title: 'Security, Approvals, And Policy',
    posture: 'ready',
    competitors: ['openclaw', 'hermes'],
    competitorBaseline: 'Command approval, DM pairing, sandboxing, allowlists, and safety defaults for exposed channels.',
    goodvibesAgent: 'Uses daemon approvals, local auth diagnostics, secret refs, explicit confirmation gates, and Agent model-tool policy guards.',
    configure: ['goodvibes-agent auth status', 'goodvibes-agent secrets providers', '/approvals list'],
    use: ['/policy status', '/approvals list', 'goodvibes-agent doctor'],
    exceedsBy: ['No token printing', 'secret-value rejection in local registries', 'policy tests for hidden spawn/lifecycle/default-knowledge failures'],
    next: ['Add user-facing approval center in the Agent workspace with route risk labels and saved policy presets.'],
  },
] as const;

export function buildOperatorCapabilityBenchmarkReport(now = new Date()): OperatorCapabilityBenchmarkReport {
  return {
    generatedAt: now.toISOString(),
    packageName: '@pellux/goodvibes-agent',
    benchmarkSources: OPERATOR_CAPABILITY_BENCHMARK_SOURCES,
    capabilities: OPERATOR_CAPABILITY_BENCHMARKS,
  };
}

export function filterOperatorCapabilities(
  capabilities: readonly OperatorCapabilityBenchmark[],
  query: string | undefined,
): readonly OperatorCapabilityBenchmark[] {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return capabilities;
  return capabilities.filter((capability) => {
    if (capability.id.includes(normalized)) return true;
    if (capability.title.toLowerCase().includes(normalized)) return true;
    if (capability.posture.includes(normalized)) return true;
    if (capability.competitors.some((competitor) => competitor === normalized)) return true;
    return capability.goodvibesAgent.toLowerCase().includes(normalized)
      || capability.competitorBaseline.toLowerCase().includes(normalized);
  });
}

export function renderOperatorCapabilityBenchmark(
  capabilities: readonly OperatorCapabilityBenchmark[] = OPERATOR_CAPABILITY_BENCHMARKS,
): string {
  const lines: string[] = [
    'GoodVibes Agent capability benchmark',
    '  Goal: match and exceed OpenClaw/Hermes personal-operator capabilities without default wiki/HomeGraph fallback or hidden local agent fanout.',
    '',
  ];

  for (const capability of capabilities) {
    lines.push(`${capability.title} [${capability.posture}]`);
    lines.push(`  competitors: ${capability.competitors.join(', ')}`);
    lines.push(`  baseline: ${capability.competitorBaseline}`);
    lines.push(`  Agent: ${capability.goodvibesAgent}`);
    lines.push(`  configure: ${capability.configure.join(' | ')}`);
    lines.push(`  use: ${capability.use.join(' | ')}`);
    lines.push(`  exceeds: ${capability.exceedsBy.join(' | ')}`);
    lines.push(`  next: ${capability.next.join(' | ')}`);
    lines.push('');
  }

  lines.push('Sources:');
  for (const source of OPERATOR_CAPABILITY_BENCHMARK_SOURCES) lines.push(`  ${source}`);
  return lines.join('\n');
}
