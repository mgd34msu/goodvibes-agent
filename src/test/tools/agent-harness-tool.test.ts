import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactCreateInput, ArtifactDescriptor, ArtifactRecord, ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { FileUndoManager, MemoryEmbeddingProviderRegistry, MemoryRegistry, MemoryStore } from '@pellux/goodvibes-sdk/platform/state';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerBuiltinCommands } from '../../input/commands.ts';
import { registerScheduleRuntimeCommands } from '../../input/commands/schedule-runtime.ts';
import { PanelManager } from '../../panels/panel-manager.ts';
import type { Panel, PanelCategory } from '../../panels/types.ts';
import { CONFIG_SCHEMA, ConfigManager } from '../../config/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { SecretsManager } from '../../config/secrets.ts';
import { buildGoodVibesSecretKey, buildGoodVibesSecretRef } from '../../config/secret-config.ts';
import { isAgentHiddenSettingKey } from '../../config/agent-settings-policy.ts';
import { createShellPathService } from '@/runtime/index.ts';
import { registerOperatorRuntimeCommands } from '../../input/commands/operator-runtime.ts';
import { AGENT_WORKSPACE_CATEGORIES } from '../../input/agent-workspace-categories.ts';
import { KeybindingsManager } from '../../input/keybindings.ts';
import { describeCliCommandPolicy, describeCommandPolicy } from '../../tools/agent-harness-metadata.ts';
import { createAgentArtifactsTool } from '../../tools/agent-artifacts-tool.ts';
import { createAgentDocumentsTool } from '../../tools/agent-documents-tool.ts';
import { createAgentHarnessTool } from '../../tools/agent-harness-tool.ts';
import { createAgentLocalRegistryTool } from '../../tools/agent-local-registry-tool.ts';
import { createAgentResearchReportTool } from '../../tools/agent-research-report-tool.ts';
import { createAgentResearchRunsTool } from '../../tools/agent-research-runs-tool.ts';
import { createAgentResearchSourcesTool } from '../../tools/agent-research-sources-tool.ts';
import { AgentNoteRegistry } from '../../agent/note-registry.ts';
import { AgentPersonaRegistry } from '../../agent/persona-registry.ts';
import { AgentResearchRunRegistry } from '../../agent/research-run-registry.ts';
import { AgentResearchSourceRegistry } from '../../agent/research-source-registry.ts';
import { AgentSkillRegistry } from '../../agent/skill-registry.ts';
import { AgentRoutineRegistry } from '../../agent/routine-registry.ts';
import { WorkPlanStore } from '../../work-plans/work-plan-store.ts';
import { listGoodVibesCliCommands } from '../../cli/parser.ts';
import { compactRegisteredToolDefinitions } from '../../tools/tool-definition-compaction.ts';
import type { AgentExecutionRecord } from '../../runtime/execution-ledger.ts';

type ShellPaths = ReturnType<typeof createShellPathService>;
type HarnessOpenSelection = NonNullable<CommandContext['openSelection']>;

interface HarnessFixture {
  readonly root: string;
  readonly paths: ShellPaths;
  readonly commandRegistry: CommandRegistry;
  readonly configManager: ConfigManager;
  readonly secretsManager: SecretsManager | null;
  readonly panelManager: PanelManager;
  readonly keybindingsManager: KeybindingsManager;
  readonly toolRegistry: ToolRegistry;
  readonly tool: ReturnType<typeof createAgentHarnessTool>;
  readonly context: CommandContext;
  readonly printed: string[];
  readonly routedPanels: Array<{ readonly panelId: string; readonly pane: 'top' | 'bottom' | undefined }>;
  readonly openedSurfaces: Array<{ readonly id: string; readonly detail?: string; readonly result?: boolean }>;
  readonly openedSelections: Array<{ readonly title: string; readonly itemIds: readonly string[]; readonly preSelectId?: string }>;
  readonly executionRecords: AgentExecutionRecord[];
  readonly cleanup: () => void;
}

function makeShellPaths(): { readonly root: string; readonly paths: ShellPaths; readonly cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-harness-tool-'));
  mkdirSync(join(root, '.goodvibes', 'daemon'), { recursive: true });
  return {
    root,
    paths: createShellPathService({ workingDirectory: root, homeDirectory: root }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function makeConfig(paths: ShellPaths): ConfigManager {
  return new ConfigManager({
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    configDir: paths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT),
    workingDir: paths.workingDirectory,
    homeDir: paths.homeDirectory,
  });
}

function createHarnessArtifactStore() {
  const records: ArtifactRecord[] = [];
  const contents = new Map<string, Buffer>();
  const store: Pick<ArtifactStore, 'create' | 'get' | 'list' | 'readContent'> = {
    async create(input: ArtifactCreateInput): Promise<ArtifactDescriptor> {
      const id = `artifact-${records.length + 1}`;
      const buffer = Buffer.from(input.text ?? '', 'utf-8');
      const record: ArtifactRecord = {
        id,
        kind: input.kind ?? 'data',
        mimeType: input.mimeType ?? 'text/plain',
        ...(input.filename ? { filename: input.filename } : {}),
        sizeBytes: buffer.byteLength,
        sha256: `sha-${records.length + 1}`,
        createdAt: Date.now() + records.length,
        acquisitionMode: input.acquisitionMode ?? 'inline-data',
        fetchMode: input.fetchMode ?? 'not-applicable',
        metadata: input.metadata ?? {},
        contentPath: `/tmp/${id}.data`,
        metadataPath: `/tmp/${id}.json`,
      };
      records.push(record);
      contents.set(id, buffer);
      return record;
    },
    get(id: string): ArtifactDescriptor | null {
      return records.find((record) => record.id === id) ?? null;
    },
    list(limit = 100): ArtifactDescriptor[] {
      return [...records].reverse().slice(0, limit);
    },
    async readContent(id: string): Promise<{ record: ArtifactRecord; buffer: Buffer }> {
      const record = records.find((entry) => entry.id === id);
      const buffer = contents.get(id);
      if (!record || !buffer) throw new Error(`Unknown artifact: ${id}`);
      return { record, buffer };
    },
  };
  return { records, store };
}

function createFakePanel(id: string, name: string, icon: string, category: PanelCategory): Panel {
  return {
    id,
    name,
    icon,
    category,
    isTransient: false,
    isPinned: false,
    needsRender: true,
    onActivate: () => {},
    onDeactivate: () => {},
    onDestroy: () => {},
    render: () => [],
    invalidate: () => {},
    markRendered: () => {},
  };
}

function registerHarnessFixturePanels(panelManager: PanelManager): void {
  panelManager.registerType({
    id: 'provider-health',
    name: 'Health',
    icon: 'N',
    category: 'monitoring',
    description: 'Provider health dashboard for current Agent provider posture',
    factory: () => createFakePanel('provider-health', 'Health', 'N', 'monitoring'),
  });
  panelManager.registerType({
    id: 'knowledge',
    name: 'Knowledge',
    icon: 'K',
    category: 'agent',
    description: 'Isolated Agent Knowledge and local memory review',
    factory: () => createFakePanel('knowledge', 'Knowledge', 'K', 'agent'),
  });
  panelManager.registerType({
    id: 'panel-list',
    name: 'Panel List',
    icon: 'L',
    category: 'session',
    description: 'Browse all registered panels grouped by category',
    factory: () => createFakePanel('panel-list', 'Panel List', 'L', 'session'),
  });
}

function makeFixture(options: {
  readonly secrets?: boolean;
  readonly dismissAgentWorkspace?: boolean;
  readonly keybindings?: boolean;
  readonly builtinCommands?: boolean;
  readonly controlPlaneEnabled?: boolean;
  readonly controlPlanePort?: number;
  readonly artifactStore?: Pick<ArtifactStore, 'create' | 'get' | 'list' | 'readContent'>;
} = {}): HarnessFixture {
  const { root, paths, cleanup } = makeShellPaths();
  const commandRegistry = new CommandRegistry();
  const configManager = makeConfig(paths);
  if (options.controlPlaneEnabled !== undefined) configManager.set('controlPlane.enabled', options.controlPlaneEnabled);
  if (options.controlPlanePort !== undefined) configManager.set('controlPlane.port', options.controlPlanePort);
  const secretsManager = options.secrets === false
    ? null
    : new SecretsManager({ projectRoot: root, globalHome: root, configManager });
  const panelManager = new PanelManager();
  const keybindingsManager = new KeybindingsManager({
    configPath: paths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'keybindings.json'),
  });
  registerHarnessFixturePanels(panelManager);
  const toolRegistry = new ToolRegistry();
  const fileUndoManager = new FileUndoManager();
  const workPlanStore = new WorkPlanStore({ homeDirectory: root, projectId: 'harness-test', projectRoot: root });
  const printed: string[] = [];
  const routedPanels: Array<{ readonly panelId: string; readonly pane: 'top' | 'bottom' | undefined }> = [];
  const openedSurfaces: Array<{ readonly id: string; readonly detail?: string; readonly result?: boolean }> = [];
  const openedSelections: Array<{ readonly title: string; readonly itemIds: readonly string[]; readonly preSelectId?: string }> = [];
  const executionRecords: AgentExecutionRecord[] = [];
  const savedSessions = [{
    name: 'session-alpha',
    title: 'Alpha planning session',
    model: 'gpt-4.1',
    provider: 'openai',
    timestamp: 1_700_000_000_000,
    messageCount: 5,
    filePath: join(root, '.goodvibes', 'sessions', 'session-alpha.json'),
  }];
  const sessionManager = {
    list: () => savedSessions,
    search: (query: string) => savedSessions
      .filter((session) => [session.name, session.title, session.model, session.provider].join('\n').toLowerCase().includes(query.toLowerCase()))
      .map((session) => ({ session, matchCount: 1, snippets: [`${session.title} match`] })),
  };
  const bookmarkManager = {
    list: () => [{ id: 'bookmark-alpha' }],
    listSavedFiles: () => [{ path: join(root, 'bookmarks.md') }],
  };
  const openSelection: HarnessOpenSelection = (title, items, opts) => {
    openedSelections.push({
      title,
      itemIds: items.map((item) => item.id),
      preSelectId: opts?.preSelectId,
    });
  };

  if (options.builtinCommands === true) {
    registerBuiltinCommands(commandRegistry);
  } else {
    commandRegistry.register({
      name: 'brief',
      description: 'Test briefing command',
      handler: (_args, ctx) => {
        ctx.print('briefing output');
      },
    });
    commandRegistry.register({
      name: 'commands',
      description: 'Browse all commands in a scrollable list',
      handler: (_args, ctx) => {
        ctx.openSelection?.(
          'Help - Commands',
          [{ id: '/brief', label: '/brief', detail: 'Test briefing command' }],
          { allowSearch: true },
          () => {},
        );
      },
    });
  }

  const context = {
    print: (text: string) => printed.push(text),
    renderRequest: () => {},
    executeCommand: async (name: string, args: string[]) => commandRegistry.execute(name, args, context as CommandContext),
    showPanel: (panelId: string, pane?: 'top' | 'bottom') => {
      routedPanels.push({ panelId, pane });
    },
    openPanelPicker: () => {
      openedSurfaces.push({ id: 'panel-picker', detail: 'home' });
    },
    openAgentWorkspace: (categoryId?: string) => {
      openedSurfaces.push({ id: 'agent-workspace', detail: categoryId });
    },
    dismissAgentWorkspace: () => {
      const result = options.dismissAgentWorkspace === true;
      openedSurfaces.push({ id: 'agent-workspace-dismissed', result });
      return result;
    },
    openSettingsModal: (target?: string) => {
      openedSurfaces.push({ id: 'settings', detail: target });
    },
    openMcpWorkspace: () => {
      openedSurfaces.push({ id: 'mcp-workspace' });
    },
    openModelPicker: () => {
      openedSurfaces.push({ id: 'model-picker' });
    },
    openModelPickerWithTarget: (target) => {
      openedSurfaces.push({ id: 'model-picker', detail: target, result: true });
      return true;
    },
    openProviderPicker: () => {
      openedSurfaces.push({ id: 'provider-picker' });
    },
    openProviderModelPickerWithTarget: (target) => {
      openedSurfaces.push({ id: 'provider-picker', detail: target });
      return true;
    },
    openReasoningEffortPicker: () => {
      openedSelections.push({
        title: 'Reasoning Effort',
        itemIds: ['low', 'medium', 'high'],
        preSelectId: 'medium',
      });
      return { opened: true, model: 'Reasoning Model', levels: ['low', 'medium', 'high'] };
    },
    openSessionPicker: () => {
      openedSurfaces.push({ id: 'session-picker' });
    },
    openProfilePicker: () => {
      openedSurfaces.push({ id: 'profile-picker' });
    },
    openBookmarkModal: () => {
      openedSurfaces.push({ id: 'bookmark-modal' });
    },
    openProcessModal: () => {
      openedSurfaces.push({ id: 'process-monitor' });
    },
    openLiveTail: (target?: string) => {
      openedSurfaces.push({ id: 'live-tail', detail: target ?? 'selected' });
      return { opened: true, processId: 'bg-test', label: 'sleep 5' };
    },
    openConversationSearch: (query?: string) => {
      openedSurfaces.push({ id: 'conversation-search', detail: query });
    },
    openPromptHistorySearch: (query?: string) => {
      openedSurfaces.push({ id: 'prompt-history-search', detail: query });
    },
    openSlashCommandMode: (query?: string) => {
      openedSurfaces.push({ id: 'slash-command-mode', detail: query });
      return true;
    },
    openFilePicker: (options?: { injectMode?: boolean; query?: string }) => {
      openedSurfaces.push({
        id: 'file-picker',
        detail: `${options?.injectMode ? 'inject' : 'reference'}:${options?.query ?? ''}`,
      });
      return true;
    },
    openBlockActions: () => {
      openedSurfaces.push({ id: 'block-actions' });
      return true;
    },
    openContextInspector: () => {
      openedSurfaces.push({ id: 'context-inspector' });
    },
    openHelpOverlay: () => {
      openedSurfaces.push({ id: 'help-overlay' });
    },
    openShortcutsOverlay: () => {
      openedSurfaces.push({ id: 'shortcuts-overlay' });
    },
    openSelection,
    workspace: options.keybindings === false
      ? { shellPaths: paths, panelManager, bookmarkManager, fileUndoManager, workPlanStore }
      : { shellPaths: paths, panelManager, keybindingsManager, bookmarkManager, fileUndoManager, workPlanStore },
    platform: {
      configManager,
      serviceRegistry: {
        getAll: () => ({}),
        inspect: async () => null,
      },
      localUserAuthManager: {
        inspect: () => ({
          userStorePath: join(root, '.goodvibes', 'auth', 'users.json'),
          bootstrapCredentialPath: join(root, '.goodvibes', 'auth', 'bootstrap.txt'),
          persisted: true,
          bootstrapCredentialPresent: false,
          userCount: 0,
          sessionCount: 0,
          users: [],
          sessions: [],
        }),
      },
      subscriptionManager: {
        list: () => [],
        listPending: () => [],
        get: () => null,
        getPending: () => null,
      },
      voiceProviderRegistry: {
        list: () => [
          { id: 'stream-voice', label: 'Streaming Voice', capabilities: ['tts-stream'] },
          { id: 'non-stream-voice', label: 'Non Streaming Voice', capabilities: [] },
        ],
      },
      voiceService: {
        listVoices: async (providerId?: string) => [
          { id: `${providerId ?? 'default'}-voice-a`, label: 'Voice A' },
          { id: `${providerId ?? 'default'}-voice-b`, label: 'Voice B' },
        ],
      },
      ...(options.artifactStore ? { artifactStore: options.artifactStore } : {}),
      readModels: {
        security: {
          getSnapshot: () => ({
            audit: {
              totalTokens: 1,
              results: [{
                label: 'agent-token',
                blocked: true,
                scope: { outcome: 'violation', policyId: 'agent-policy' },
                rotation: { outcome: 'ok' },
              }],
              blocked: ['agent-token'],
              scopeViolations: ['agent-token'],
              rotationWarnings: [],
              rotationOverdue: [],
            },
            policy: {
              preflightStatus: 'ok',
              preflightIssueCount: 0,
              lintFindingCount: 0,
            },
            mcpServers: [],
            plugins: [],
            incidents: [],
            deniedPermissions: 0,
          }),
        },
      },
      ...(secretsManager ? { secretsManager } : {}),
    },
    clients: {
      mcpApi: {
        listServerSecurity: () => [{
          name: 'filesystem',
          connected: true,
          trustMode: 'constrained',
          role: 'tools',
          schemaFreshness: 'fresh',
          quarantineReason: null,
          quarantineDetail: null,
          allowedPaths: [root],
          allowedHosts: ['localhost'],
        }],
        listAllTools: async () => [{
          serverName: 'filesystem',
          toolName: 'read_file',
          description: 'Read a file from an allowed path.',
        }],
      },
    },
    session: {
      runtime: {
        sessionId: 'session-alpha',
        provider: 'openai',
        model: 'gpt-4.1',
        reasoningEffort: 'medium',
      },
      conversationManager: {
        title: 'Alpha planning session',
        getMessageCount: () => 5,
        getTranscriptEventIndex: () => ({ events: [], groups: [] }),
      },
      sessionManager,
    },
    provider: {
      providerRegistry: {
        listModels: () => [{ provider: 'openai', modelId: 'gpt-4.1', providerEnvVars: ['OPENAI_API_KEY'] }],
        getContextWindowForModel: () => 128_000,
      },
    },
    ops: {
      executionLedger: {
        getSnapshot: () => ({
          records: executionRecords,
          total: executionRecords.length,
          running: executionRecords.filter((record) => record.status === 'running').length,
          succeeded: executionRecords.filter((record) => record.status === 'succeeded').length,
          failed: executionRecords.filter((record) => record.status === 'failed').length,
          cancelled: executionRecords.filter((record) => record.status === 'cancelled').length,
        }),
        subscribe: () => () => {},
        dispose: () => {},
      },
    },
    extensions: { toolRegistry },
  } as unknown as CommandContext;

  const tool = createAgentHarnessTool({
    commandRegistry,
    commandContext: context,
    toolRegistry,
  });
  toolRegistry.register(tool);

  return {
    root,
    paths,
    commandRegistry,
    configManager,
    secretsManager,
    panelManager,
    keybindingsManager,
    toolRegistry,
    tool,
    context,
    printed,
    routedPanels,
    openedSurfaces,
    openedSelections,
    executionRecords,
    cleanup,
  };
}

async function createMemoryRegistry(paths: ShellPaths, configManager: ConfigManager): Promise<MemoryRegistry> {
  const embeddingRegistry = new MemoryEmbeddingProviderRegistry({ configManager });
  const store = new MemoryStore(paths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'memory.sqlite'), { embeddingRegistry });
  await store.init();
  return new MemoryRegistry(store);
}

function registerStubTool(toolRegistry: ToolRegistry, name: string): void {
  const tool: Tool = {
    definition: {
      name,
      description: `${name} test tool`,
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    execute: async () => ({ success: true, output: `${name} executed` }),
  };
  toolRegistry.register(tool);
}

function readAuthorizationHeader(headers: HeadersInit | undefined): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get('authorization');
  if (Array.isArray(headers)) {
    const entry = headers.find(([key]) => key.toLowerCase() === 'authorization');
    return entry ? String(entry[1]) : null;
  }
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization')?.[1];
  return typeof value === 'string' ? value : null;
}

function expectModelFacingText(output: string): void {
  const forbidden = [
    ['commandContext', '.'].join(''),
    ['legacy', 'panel'].join(' '),
    ['legacy', 'panels'].join(' '),
    ['shell', 'bridge'].join(' '),
    ['focus', 'Prompt'].join(''),
  ];
  for (const token of forbidden) {
    expect(output).not.toContain(token);
  }
}

function expectCompactSummaryFields(value: unknown, limit = 72): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) expectCompactSummaryFields(entry, limit);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'summary' && typeof entry === 'string') {
      expect(entry.length).toBeLessThanOrEqual(limit);
    }
    expectCompactSummaryFields(entry, limit);
  }
}

function expectCompactModelRoute(value: unknown): void {
  expect(typeof value).toBe('string');
  const route = String(value);
  expect(route.length).toBeGreaterThan(0);
  expect(route.length).toBeLessThanOrEqual(72);
}

function expectRowsHaveCompactModelRoutes(rows: readonly Record<string, unknown>[]): void {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expectCompactModelRoute(row.modelRoute);
}

async function executeHarnessJson<T>(fixture: HarnessFixture, args: Record<string, unknown>): Promise<T> {
  const result = await fixture.tool.execute(args);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.error);
  return JSON.parse(result.output ?? '{}') as T;
}

const CONNECTED_HOST_AUTH_ENV_KEYS = [
  'GOODVIBES_CONNECTED_HOST_TOKEN',
  'GOODVIBES_DAEMON_TOKEN',
] as const;

const PROVIDER_AUTH_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_KEY',
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GEMINI_API_KEY',
  'INCEPTION_API_KEY',
  'OPENROUTER_API_KEY',
  'AIHUBMIX_API_KEY',
  'GROQ_API_KEY',
  'CEREBRAS_API_KEY',
  'MISTRAL_API_KEY',
  'OLLAMA_CLOUD_API_KEY',
  'OLLAMA_API_KEY',
  'HF_API_KEY',
  'HUGGINGFACE_API_KEY',
  'HF_TOKEN',
  'NVIDIA_API_KEY',
  'LLM7_API_KEY',
  'DEEPSEEK_API_KEY',
  'FIREWORKS_API_KEY',
  'COPILOT_GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'AZURE_OPENAI_API_KEY',
  'MINIMAX_API_KEY',
  'MOONSHOT_API_KEY',
  'QIANFAN_API_KEY',
  'QWEN_API_KEY',
  'DASHSCOPE_API_KEY',
  'MODELSTUDIO_API_KEY',
  'SGLANG_API_KEY',
  'STEPFUN_API_KEY',
  'TOGETHER_API_KEY',
  'VENICE_API_KEY',
  'VOLCANO_ENGINE_API_KEY',
  'XAI_API_KEY',
  'XIAOMI_API_KEY',
  'ZAI_API_KEY',
  'Z_AI_API_KEY',
  'AI_GATEWAY_API_KEY',
  'LITELLM_API_KEY',
  'COPILOT_PROXY_API_KEY',
] as const;

async function withClearedEnv<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withTcpListener<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const server = createServer((socket) => socket.end());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TCP fixture did not receive an address.');
    return await fn((address as AddressInfo).port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function writeConnectedHostOperatorToken(fixture: HarnessFixture, token = 'fixture-connected-host-token'): void {
  writeFileSync(join(fixture.root, '.goodvibes', 'daemon', 'operator-tokens.json'), `${JSON.stringify({ token })}\n`, { mode: 0o600 });
}

describe('agent_harness tool', () => {
  test('exposes a searchable compact harness mode catalog to the model', async () => {
    const fixture = makeFixture();
    try {
      const summary = await fixture.tool.execute({ mode: 'summary' });
      expect(summary.success).toBe(true);
      if (!summary.success) throw new Error(summary.error);
      const summaryJson = JSON.parse(summary.output ?? '{}') as {
        readonly assistant?: {
          readonly status?: string;
          readonly primaryNextAction?: string;
          readonly boundaryPolicy?: string;
          readonly lanes?: readonly {
            readonly id: string;
            readonly label: string;
            readonly state: string;
            readonly routes: readonly string[];
          }[];
        };
        readonly harnessModes?: number;
        readonly modeGuide?: { readonly discover?: readonly string[]; readonly inspect?: readonly string[] };
      };
      expect(summaryJson.assistant?.status).toBeTruthy();
      expect(summaryJson.assistant?.primaryNextAction).toBeTruthy();
      expect(summaryJson.assistant?.boundaryPolicy).toContain('Primary UX is one assistant');
      expect(summaryJson.assistant?.lanes?.map((lane) => lane.id)).toEqual([
        'setup',
        'chat-and-model',
        'work-and-files',
        'personal-ops',
        'research-and-docs',
        'background-work',
        'safety-and-recovery',
      ]);
      expect(summaryJson.assistant?.lanes?.find((lane) => lane.id === 'setup')?.routes.join('\n')).toContain('setup_posture');
      expect(summaryJson.assistant?.lanes?.find((lane) => lane.id === 'setup')?.routes.join('\n')).toContain('run_setup_smoke');
      expect(summaryJson.assistant?.lanes?.find((lane) => lane.id === 'work-and-files')?.label).toBe('Work in this project');
      expect(summaryJson.harnessModes).toBeGreaterThan(60);
      expect(summaryJson.modeGuide?.discover).toContain('modes');
      expect(summaryJson.modeGuide?.discover).toContain('execution_posture');
      expect(summaryJson.modeGuide?.discover).toContain('execution_history');
      expect(summaryJson.modeGuide?.discover).toContain('file_recovery');
      expect(summaryJson.modeGuide?.discover).toContain('personal_ops');
      expect(summaryJson.modeGuide?.discover).toContain('autonomy_intake');
      expect(summaryJson.modeGuide?.discover).toContain('research_runs');
      expect(summaryJson.modeGuide?.inspect).toContain('mode');
      expect(summaryJson.modeGuide?.inspect).toContain('execution_route');
      expect(summaryJson.modeGuide?.inspect).toContain('execution_history_item');
      expect(summaryJson.modeGuide?.inspect).toContain('personal_ops_lane');
      expect(summaryJson.modeGuide?.inspect).toContain('research_run');
      expect(summaryJson.modeGuide?.inspect).toContain('research_source');
      expect(summaryJson.modeGuide?.inspect).toContain('document_ops_lane');

      const allModes = await fixture.tool.execute({ mode: 'modes', limit: 500 });
      expect(allModes.success).toBe(true);
      if (!allModes.success) throw new Error(allModes.error);
      const allModesJson = JSON.parse(allModes.output ?? '{}') as {
        readonly modes: readonly { readonly summary?: string; readonly next?: string; readonly parameters?: readonly string[] }[];
      };
      expect(allModesJson.modes.length).toBe(summaryJson.harnessModes);
      expect(allModesJson.modes.filter((entry) => (entry.summary?.length ?? 0) > 72)).toEqual([]);
      expect(allModesJson.modes.filter((entry) => (entry.next?.length ?? 0) > 72)).toEqual([]);
      expect(allModesJson.modes.filter((entry) => entry.parameters !== undefined)).toEqual([]);

      const settingsModes = await fixture.tool.execute({ mode: 'modes', query: 'settings' });
      expect(settingsModes.success).toBe(true);
      if (!settingsModes.success) throw new Error(settingsModes.error);
      const settingsJson = JSON.parse(settingsModes.output ?? '{}') as {
        readonly modes: readonly { readonly id: string; readonly parameters?: readonly string[] }[];
        readonly returned: number;
        readonly total: number;
      };
      expect(settingsJson.total).toBe(summaryJson.harnessModes);
      expect(settingsJson.returned).toBeGreaterThan(0);
      expect(settingsJson.modes.map((entry) => entry.id)).toEqual(expect.arrayContaining([
        'settings',
        'get_setting',
        'set_setting',
        'reset_setting',
      ]));
      expect(settingsJson.modes.filter((entry) => entry.parameters !== undefined)).toEqual([]);

      const personalModes = await fixture.tool.execute({ mode: 'modes', query: 'personal operations' });
      expect(personalModes.success).toBe(true);
      expect(personalModes.output).toContain('personal_ops');

      const autonomyModes = await fixture.tool.execute({ mode: 'modes', query: 'ongoing-work' });
      expect(autonomyModes.success).toBe(true);
      expect(autonomyModes.output).toContain('autonomy_intake');

      const executionModes = await fixture.tool.execute({ mode: 'modes', query: 'local shell execution' });
      expect(executionModes.success).toBe(true);
      expect(executionModes.output).toContain('execution_posture');

      const recoveryModes = await fixture.tool.execute({ mode: 'modes', query: 'file edit undo recovery' });
      expect(recoveryModes.success).toBe(true);
      expect(recoveryModes.output).toContain('file_recovery');

      const historyModes = await fixture.tool.execute({ mode: 'modes', query: 'execution history record' });
      expect(historyModes.success).toBe(true);
      expect(historyModes.output).toContain('execution_history');

      const documentModes = await fixture.tool.execute({ mode: 'modes', query: 'blind model comparison documents uploads' });
      expect(documentModes.success).toBe(true);
      expect(documentModes.output).toContain('document_ops');

      const detailedModes = await fixture.tool.execute({
        mode: 'modes',
        query: 'settings',
        includeParameters: true,
        limit: 1,
      });
      expect(detailedModes.success).toBe(true);
      if (!detailedModes.success) throw new Error(detailedModes.error);
      expect(detailedModes.output).toContain('"parameters"');
      expectModelFacingText(allModes.output);
      expectModelFacingText(detailedModes.output);

      const taskPhrase = await fixture.tool.execute({ mode: 'modes', query: 'set setting' });
      expect(taskPhrase.success).toBe(true);
      if (!taskPhrase.success) throw new Error(taskPhrase.error);
      const taskPhraseJson = JSON.parse(taskPhrase.output ?? '{}') as {
        readonly modes: readonly { readonly id: string }[];
      };
      expect(taskPhraseJson.modes[0]?.id).toBe('set_setting');
      expect(taskPhraseJson.modes.map((entry) => entry.id)).toContain('set_setting');

      const setSetting = await fixture.tool.execute({ mode: 'mode', target: 'set_setting' });
      expect(setSetting.success).toBe(true);
      if (!setSetting.success) throw new Error(setSetting.error);
      const setSettingJson = JSON.parse(setSetting.output ?? '{}') as {
        readonly id: string;
        readonly kind: string;
        readonly family: string;
        readonly requiresConfirmation?: boolean;
        readonly parameters?: readonly string[];
        readonly lookup?: { readonly resolvedBy?: string };
      };
      expect(setSettingJson).toMatchObject({
        id: 'set_setting',
        kind: 'effect',
        family: 'settings',
        requiresConfirmation: true,
      });
      expect(setSettingJson.parameters).toEqual(expect.arrayContaining(['key', 'value', 'confirm', 'explicitUserRequest']));
      expect(setSettingJson.lookup?.resolvedBy).toBe('id');

      const missing = await fixture.tool.execute({ mode: 'mode' });
      expect(missing.success).toBe(false);
      expect(missing.error).toContain('mode inspection requires target or query');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes a prioritized first-run setup plan with route-backed next actions', async () => {
    const fixture = makeFixture();
    try {
      const summary = await executeHarnessJson<{
        readonly setupPosture?: {
          readonly planItems?: number;
          readonly blockedPlanItems?: number;
          readonly autonomyBlockers?: number;
        };
      }>(fixture, { mode: 'summary', includeParameters: true });
      expect(summary.setupPosture?.planItems).toBeGreaterThanOrEqual(7);
      expect(typeof summary.setupPosture?.blockedPlanItems).toBe('number');
      expect(summary.setupPosture?.autonomyBlockers).toBeGreaterThanOrEqual(1);

      const posture = await executeHarnessJson<{
        readonly summary: {
          readonly readinessPlan: {
            readonly blocked: number;
            readonly check: number;
            readonly blocksAutonomy: number;
          };
        };
        readonly readinessPlan: readonly {
          readonly setupItemId: string;
          readonly status: string;
          readonly priority: number;
          readonly blocksAutonomy: boolean;
          readonly nextAction: string;
          readonly userRoute: string;
          readonly modelRoute: string;
          readonly signals?: readonly string[];
          readonly availableRepairCards?: readonly string[];
          readonly bootstrapRoute?: string;
          readonly repairCards?: readonly {
            readonly id: string;
            readonly state: string;
            readonly effect: string;
            readonly methodId?: string;
            readonly modelRoute?: string;
            readonly prerequisite?: string;
            readonly recommendedWhen: string;
            readonly safety: string;
          }[];
          readonly bootstrapPlan?: {
            readonly status: string;
            readonly source: string;
            readonly recommendedWhen: string;
            readonly steps: readonly {
              readonly id: string;
              readonly commands: readonly string[];
              readonly fallback?: string;
            }[];
            readonly reconnectRoutes: { readonly agentStatus: string; readonly serviceDiagnostics: string; readonly setupItem: string };
            readonly policy: string;
          };
          readonly installSmokePlan?: {
            readonly status: string;
            readonly source: string;
            readonly checks: readonly { readonly id: string; readonly status: string; readonly route: string; readonly evidence: string }[];
            readonly successCriteria: readonly string[];
            readonly policy: string;
          };
          readonly localModelReadiness?: {
            readonly cookbookStatus: string;
            readonly inspectRoute: string;
            readonly inspectRecipeRoute: string;
            readonly readinessRubric?: {
              readonly dimensions: readonly { readonly id: string; readonly weight: number }[];
            };
            readonly topRecipe?: {
              readonly id: string;
              readonly readinessScore?: number | null;
              readonly setupStatus?: string;
            };
            readonly nextActions?: readonly string[];
          };
        }[];
        readonly nextSetupActions: readonly {
          readonly setupItemId: string;
          readonly status: string;
          readonly modelRoute: string;
        }[];
        readonly policy: string;
      }>(fixture, { mode: 'setup_posture', includeParameters: true });

      expect(typeof posture.summary.readinessPlan.blocked).toBe('number');
      expect(posture.summary.readinessPlan.check).toBeGreaterThanOrEqual(1);
      expect(posture.summary.readinessPlan.blocksAutonomy).toBeGreaterThanOrEqual(1);
      expect(posture.policy).toContain('Read-only setup/onboarding posture');

      const first = posture.readinessPlan[0];
      expect(first?.setupItemId).toBe('connected-host-readiness');
      expect(first?.status).toBe('check');
      expect(first?.blocksAutonomy).toBe(true);
      expect(first?.modelRoute).toContain('connected_host_status');
      expect(first?.userRoute).toContain('Host compatibility');
      expect(first?.availableRepairCards).toContain('connected-host-status');
      expect(first?.bootstrapRoute).toContain('connected-host-readiness');
      expect(first?.bootstrapPlan?.source).toContain('goodvibes-tui');
      expect(first?.bootstrapPlan?.steps.map((step) => step.id)).toEqual([
        'verify-bun',
        'install-goodvibes-host',
        'verify-goodvibes-binaries',
        'start-goodvibes-host',
        'reconnect-agent',
      ]);
      expect(first?.bootstrapPlan?.steps.find((step) => step.id === 'install-goodvibes-host')?.commands.join('\n')).toContain('bun add -g @pellux/goodvibes-tui');
      expect(first?.bootstrapPlan?.steps.find((step) => step.id === 'install-goodvibes-host')?.commands.join('\n')).toContain('bun pm trust -g');
      expect(first?.bootstrapPlan?.steps.find((step) => step.id === 'verify-goodvibes-binaries')?.commands.join('\n')).toContain('goodvibes-daemon --version');
      expect(first?.bootstrapPlan?.steps.find((step) => step.id === 'start-goodvibes-host')?.commands.join('\n')).toContain('goodvibes service start');
      expect(first?.bootstrapPlan?.steps.find((step) => step.id === 'reconnect-agent')?.fallback).toContain('GOODVIBES_AGENT_RUNTIME_URL');
      expect(first?.bootstrapPlan?.reconnectRoutes.agentStatus).toContain('connected_host_status');
      expect(first?.bootstrapPlan?.policy).toContain('does not run host install/start commands implicitly');
      expect(first?.repairCards?.find((card) => card.id === 'service-status')?.methodId).toBe('services.status');
      expect(first?.repairCards?.find((card) => card.id === 'service-install')?.modelRoute).toContain('services.install');
      expect(first?.repairCards?.find((card) => card.id === 'service-start')?.effect).toBe('confirmed-effect');
      expect(first?.repairCards?.find((card) => card.id === 'service-restart')?.safety).toContain('Confirmed service mutation');
      expect(first?.repairCards?.some((card) => card.methodId === 'services.uninstall')).toBe(false);

      const provider = posture.readinessPlan.find((item) => item.setupItemId === 'provider-access');
      expect(['ready', 'blocked']).toContain(provider?.status);
      expect(provider?.blocksAutonomy).toBe(true);
      expect(provider?.modelRoute).toContain('model_routing');
      expect(provider?.nextAction).toMatch(/Choose a provider\/model route|Review the current model route/);
      expect(posture.nextSetupActions[0]?.setupItemId).toBe('connected-host-readiness');

      const installSmoke = posture.readinessPlan.find((item) => item.setupItemId === 'install-smoke');
      expect(installSmoke?.status).toBe('blocked');
      expect(installSmoke?.blocksAutonomy).toBe(false);
      expect(installSmoke?.priority).toBe(22);
      expect(installSmoke?.modelRoute).toContain('install-smoke');
      expect(installSmoke?.signals?.join('\n')).toContain('install smoke');
      expect(installSmoke?.installSmokePlan?.source).toContain('GoodVibes Agent installed package');
      expect(installSmoke?.installSmokePlan?.checks.map((check) => check.id)).toEqual([
        'agent-binary',
        'connected-host-status',
        'connected-host-auth',
        'provider-model',
        'setup-posture',
        'first-assistant-turn',
      ]);
      expect(installSmoke?.installSmokePlan?.checks.find((check) => check.id === 'agent-binary')?.route).toContain('goodvibes-agent --version');
      expect(installSmoke?.installSmokePlan?.checks.find((check) => check.id === 'connected-host-status')?.route).toContain('connected_host_status');
      expect(installSmoke?.installSmokePlan?.checks.find((check) => check.id === 'connected-host-auth')?.route).toContain('connected-host-auth');
      expect(installSmoke?.installSmokePlan?.checks.find((check) => check.id === 'provider-model')?.route).toContain('model_routing');
      expect(installSmoke?.installSmokePlan?.checks.find((check) => check.id === 'first-assistant-turn')?.route).toContain('Say ready');
      expect(installSmoke?.installSmokePlan?.successCriteria.join('\n')).toContain('first assistant turn');
      expect(installSmoke?.installSmokePlan?.policy).toContain('does not run package, host, or shell smoke commands implicitly');

      const localModels = posture.readinessPlan.find((item) => item.setupItemId === 'local-model-readiness');
      expect(localModels?.status).toBe('recommended');
      expect(localModels?.blocksAutonomy).toBe(false);
      expect(localModels?.modelRoute).toBe('agent_harness mode:"model_routing" query:"local"');
      expect(localModels?.signals?.join('\n')).toContain('cookbook status');
      expect(localModels?.signals?.join('\n')).toContain('top recipe');
      expect(localModels?.localModelReadiness?.cookbookStatus).toBe('recommendations-only');
      expect(localModels?.localModelReadiness?.inspectRoute).toContain('query:"local"');
      expect(localModels?.localModelReadiness?.inspectRecipeRoute).toContain('local-model-cookbook');
      expect(localModels?.localModelReadiness?.topRecipe?.id).toBeTruthy();
      expect(localModels?.localModelReadiness?.topRecipe?.readinessScore).toBeGreaterThan(0);
      expect(localModels?.localModelReadiness?.readinessRubric?.dimensions.map((dimension) => dimension.id)).toEqual([
        'latency',
        'context-window',
        'tool-support',
        'vision',
        'cost',
        'privacy',
      ]);
      expect(localModels?.localModelReadiness?.nextActions?.join('\n')).toContain('Refresh the model catalog');

      const browserControl = posture.readinessPlan.find((item) => item.setupItemId === 'browser-desktop-control');
      expect(browserControl?.status).toBe('recommended');
      expect(browserControl?.blocksAutonomy).toBe(false);
      expect(browserControl?.userRoute).toContain('Tools & MCP');
      expect(browserControl?.modelRoute).toContain('mcp_servers');
      expect(browserControl?.signals?.join('\n')).toContain('No browser');

      const hostItem = await executeHarnessJson<{
        readonly setupItemId: string;
        readonly status: string;
        readonly lookup?: { readonly resolvedBy?: string };
        readonly modelRoute: string;
        readonly bootstrapPlan?: {
          readonly steps: readonly { readonly id: string; readonly commands: readonly string[] }[];
          readonly policy: string;
        };
        readonly repairCards?: readonly {
          readonly id: string;
          readonly state: string;
          readonly methodId?: string;
          readonly modelRoute?: string;
        }[];
        readonly policy?: { readonly effect: string };
      }>(fixture, { mode: 'setup_item', setupItemId: 'connected-host-readiness' });
      expect(hostItem.setupItemId).toBe('connected-host-readiness');
      expect(hostItem.status).toBe('check');
      expect(hostItem.lookup?.resolvedBy).toBe('plan-id');
      expect(hostItem.modelRoute).toContain('connected_host_status');
      expect(hostItem.bootstrapPlan?.steps.find((step) => step.id === 'verify-bun')?.commands).toEqual(['bun --version']);
      expect(hostItem.bootstrapPlan?.policy).toContain('confirmed operator methods');
      expect(hostItem.repairCards?.find((card) => card.id === 'service-start')?.modelRoute).toContain('services.start');
      expect(hostItem.policy?.effect).toBe('read-only');

      const localModelItem = await executeHarnessJson<{
        readonly setupItemId: string;
        readonly status: string;
        readonly lookup?: { readonly resolvedBy?: string };
        readonly modelRoute: string;
        readonly localModelReadiness?: {
          readonly topRecipe?: { readonly readinessScore?: number | null };
          readonly readinessRubric?: { readonly dimensions: readonly { readonly id: string }[] };
        };
      }>(fixture, { mode: 'setup_item', setupItemId: 'local-model-readiness' });
      expect(localModelItem.setupItemId).toBe('local-model-readiness');
      expect(localModelItem.status).toBe('recommended');
      expect(localModelItem.lookup?.resolvedBy).toBe('plan-id');
      expect(localModelItem.modelRoute).toContain('model_routing');
      expect(localModelItem.localModelReadiness?.topRecipe?.readinessScore).toBeGreaterThan(0);
      expect(localModelItem.localModelReadiness?.readinessRubric?.dimensions.map((dimension) => dimension.id)).toContain('privacy');

      const installSmokeItem = await executeHarnessJson<{
        readonly setupItemId: string;
        readonly status: string;
        readonly lookup?: { readonly resolvedBy?: string };
        readonly installSmokePlan?: {
          readonly status: string;
          readonly checks: readonly { readonly id: string; readonly status: string; readonly route: string }[];
          readonly policy: string;
        };
      }>(fixture, { mode: 'setup_item', setupItemId: 'install-smoke' });
      expect(installSmokeItem.setupItemId).toBe('install-smoke');
      expect(installSmokeItem.status).toBe('blocked');
      expect(installSmokeItem.lookup?.resolvedBy).toBe('plan-id');
      expect(installSmokeItem.installSmokePlan?.checks.find((check) => check.id === 'connected-host-auth')?.status).toBe('blocked');
      expect(installSmokeItem.installSmokePlan?.checks.find((check) => check.id === 'first-assistant-turn')?.status).toBe('user-run');
      expect(installSmokeItem.installSmokePlan?.policy).toContain('token-safe');

      const unconfirmedSmoke = await fixture.tool.execute({ mode: 'run_setup_smoke', setupItemId: 'install-smoke' });
      expect(unconfirmedSmoke.success).toBe(false);
      expect(unconfirmedSmoke.error).toContain('explicitUserRequest');

      const smokeMissingConfirm = await fixture.tool.execute({
        mode: 'run_setup_smoke',
        setupItemId: 'install-smoke',
        explicitUserRequest: 'Run the install smoke checks',
      });
      expect(smokeMissingConfirm.success).toBe(false);
      expect(smokeMissingConfirm.error).toContain('confirm:true');

      const smokeRun = await executeHarnessJson<{
        readonly status: string;
        readonly mode: string;
        readonly setupItemId: string;
        readonly smokeStatus: string;
        readonly result: string;
        readonly summary: { readonly blocked: number; readonly userRun: number; readonly total: number };
        readonly blockedChecks: readonly string[];
        readonly userRunChecks: readonly string[];
        readonly checks: readonly { readonly id: string; readonly status: string; readonly action: string; readonly route: string; readonly evidence: string }[];
        readonly artifact: { readonly status: string; readonly reason?: string; readonly supportedFields?: readonly string[] };
        readonly nextAction: string;
        readonly routes: { readonly inspectSetup: string; readonly inspectSmoke: string; readonly rerunSmoke: string };
        readonly policy: { readonly effect: string; readonly shell: string; readonly secrets: string; readonly source: string };
      }>(fixture, {
        mode: 'run_setup_smoke',
        setupItemId: 'install-smoke',
        includeParameters: true,
        confirm: true,
        explicitUserRequest: 'Run the install smoke checks',
      });
      expect(smokeRun.status).toBe('executed');
      expect(smokeRun.mode).toBe('run_setup_smoke');
      expect(smokeRun.setupItemId).toBe('install-smoke');
      expect(smokeRun.smokeStatus).toBe('blocked');
      expect(smokeRun.result).toBe('blocked');
      expect(smokeRun.summary.total).toBe(6);
      expect(smokeRun.summary.blocked).toBeGreaterThanOrEqual(1);
      expect(smokeRun.summary.userRun).toBeGreaterThanOrEqual(1);
      expect(smokeRun.blockedChecks).toContain('connected-host-auth');
      expect(smokeRun.userRunChecks).toContain('first-assistant-turn');
      expect(smokeRun.checks.map((check) => check.id)).toEqual([
        'agent-binary',
        'connected-host-status',
        'connected-host-auth',
        'provider-model',
        'setup-posture',
        'first-assistant-turn',
      ]);
      expect(smokeRun.checks.find((check) => check.id === 'agent-binary')?.action).toBe('user-visible-run');
      expect(smokeRun.checks.find((check) => check.id === 'connected-host-auth')?.action).toBe('fix-before-smoke');
      expect(smokeRun.artifact.status).toBe('not_requested');
      expect(smokeRun.artifact.supportedFields).toContain('agentBinaryOutput');
      expect(smokeRun.nextAction).toContain('Resolve blocked checks');
      expect(smokeRun.routes.inspectSetup).toContain('setup_posture');
      expect(smokeRun.routes.inspectSmoke).toContain('install-smoke');
      expect(smokeRun.routes.rerunSmoke).toContain('run_setup_smoke');
      expect(smokeRun.policy.effect).toBe('confirmed-redacted-setup-smoke');
      expect(smokeRun.policy.shell).toContain('No package, host, or shell commands were executed implicitly');
      expect(smokeRun.policy.secrets).toContain('tokens are never returned');
      expect(JSON.stringify(smokeRun)).not.toContain('fixture-connected-host-token');

      const browserItem = await executeHarnessJson<{
        readonly setupItemId: string;
        readonly status: string;
        readonly lookup?: { readonly resolvedBy?: string };
        readonly modelRoute: string;
        readonly signals?: readonly string[];
      }>(fixture, { mode: 'setup_item', setupItemId: 'browser-desktop-control' });
      expect(browserItem.setupItemId).toBe('browser-desktop-control');
      expect(browserItem.status).toBe('recommended');
      expect(browserItem.lookup?.resolvedBy).toBe('plan-id');
      expect(browserItem.modelRoute).toContain('mcp_servers');
      expect(browserItem.signals?.join('\n')).toContain('No browser');
    } finally {
      fixture.cleanup();
    }
  });

  test('saves redacted setup smoke evidence artifacts when user-run output is provided', async () => {
    const artifacts = createHarnessArtifactStore();
    const fixture = makeFixture({ artifactStore: artifacts.store });
    try {
      const smokeRun = await executeHarnessJson<{
        readonly status: string;
        readonly artifact: {
          readonly status: string;
          readonly artifactId?: string;
          readonly filename?: string;
          readonly purpose?: string;
          readonly evidenceFields?: readonly { readonly id: string; readonly preview: string }[];
          readonly inspectRoute?: string;
        };
      }>(fixture, {
        mode: 'run_setup_smoke',
        setupItemId: 'install-smoke',
        confirm: true,
        explicitUserRequest: 'Save the redacted setup smoke evidence.',
        fields: {
          agentBinaryOutput: 'goodvibes-agent 1.0.0\nAuthorization: Bearer binary-secret',
          statusJson: '{"connectedHost":{"token":"host-secret"},"ok":true}',
          firstAssistantTurn: 'Ready. apiKey=assistant-secret',
          notes: 'Operator saw token=query-secret in https://example.test/status?token=query-secret',
        },
      });

      expect(smokeRun.status).toBe('executed');
      expect(smokeRun.artifact.status).toBe('saved');
      expect(smokeRun.artifact.artifactId).toBe('artifact-1');
      expect(smokeRun.artifact.filename).toContain('setup-smoke-');
      expect(smokeRun.artifact.purpose).toBe('agent-setup-smoke-evidence');
      expect(smokeRun.artifact.inspectRoute).toContain('agent_artifacts');
      expect(smokeRun.artifact.evidenceFields?.map((field) => field.id)).toEqual([
        'agentBinaryOutput',
        'statusJson',
        'firstAssistantTurn',
        'notes',
      ]);
      expect(JSON.stringify(smokeRun)).not.toContain('binary-secret');
      expect(JSON.stringify(smokeRun)).not.toContain('host-secret');
      expect(JSON.stringify(smokeRun)).not.toContain('assistant-secret');
      expect(JSON.stringify(smokeRun)).not.toContain('query-secret');

      const artifact = artifacts.store.list(1)[0];
      expect(artifact?.metadata).toMatchObject({
        purpose: 'agent-setup-smoke-evidence',
        source: 'agent-harness-run-setup-smoke',
        smokeStatus: 'blocked',
        evidenceFields: ['agentBinaryOutput', 'statusJson', 'firstAssistantTurn', 'notes'],
      });
      expect(JSON.stringify(artifact?.metadata)).not.toContain('binary-secret');
      expect(JSON.stringify(artifact?.metadata)).not.toContain('host-secret');
      expect(JSON.stringify(artifact?.metadata)).not.toContain('assistant-secret');
      expect(JSON.stringify(artifact?.metadata)).not.toContain('query-secret');
      const saved = await artifacts.store.readContent('artifact-1');
      const content = saved.buffer.toString('utf-8');
      expect(content).toContain('GoodVibes Agent Setup Smoke Evidence');
      expect(content).toContain('Agent binary output');
      expect(content).toContain('<redacted>');
      expect(content).not.toContain('binary-secret');
      expect(content).not.toContain('host-secret');
      expect(content).not.toContain('assistant-secret');
      expect(content).not.toContain('query-secret');

      const summary = await executeHarnessJson<{
        readonly assistant?: {
          readonly lanes?: readonly {
            readonly id: string;
            readonly summary: string;
            readonly nextAction: string;
          }[];
        };
        readonly setupPosture?: {
          readonly setupSmokeEvidence?: {
            readonly status: string;
            readonly artifactId: string;
            readonly result: string;
            readonly evidenceFields: readonly string[];
            readonly inspectRoute: string;
          };
        };
      }>(fixture, { mode: 'summary' });
      expect(summary.setupPosture?.setupSmokeEvidence).toMatchObject({
        status: 'saved',
        artifactId: 'artifact-1',
        result: 'blocked',
        evidenceFields: ['agentBinaryOutput', 'statusJson', 'firstAssistantTurn', 'notes'],
      });
      expect(summary.setupPosture?.setupSmokeEvidence?.inspectRoute).toContain('agent_artifacts');
      const setupLane = summary.assistant?.lanes?.find((lane) => lane.id === 'setup');
      expect(setupLane?.summary).toContain('Last smoke blocked');
      expect(setupLane?.nextAction).toContain('saved smoke artifact');
    } finally {
      fixture.cleanup();
    }
  });

  test('uses live service probes before recommending connected-host lifecycle repair', async () => {
    const fixture = makeFixture({ controlPlaneEnabled: true, controlPlanePort: 1 });
    try {
      const hostItem = await executeHarnessJson<{
        readonly setupItemId: string;
        readonly status: string;
        readonly signals?: readonly string[];
        readonly recommendedRepairCards?: readonly string[];
        readonly bootstrapPlan?: { readonly status: string; readonly recommendedWhen: string };
        readonly serviceProbe?: {
          readonly status: string;
          readonly enabled: boolean;
          readonly binding: string;
          readonly diagnosticRoute: string;
          readonly issues: readonly string[];
        };
        readonly repairCards?: readonly {
          readonly id: string;
          readonly state: string;
          readonly recommendation: string;
          readonly liveEvidence?: { readonly probeStatus: string; readonly summary: string };
        }[];
      }>(fixture, { mode: 'setup_item', setupItemId: 'connected-host-readiness' });

      expect(hostItem.setupItemId).toBe('connected-host-readiness');
      expect(hostItem.status).toBe('blocked');
      expect(hostItem.serviceProbe).toMatchObject({
        status: 'unreachable',
        enabled: true,
        binding: '127.0.0.1:1',
      });
      expect(hostItem.serviceProbe?.diagnosticRoute).toContain('service_posture');
      expect(hostItem.signals?.join('\n')).toContain('runtime connection probe: unreachable 127.0.0.1:1');
      expect(hostItem.recommendedRepairCards).toContain('connected-host-status');
      expect(hostItem.recommendedRepairCards).toContain('service-posture');
      expect(hostItem.recommendedRepairCards).toContain('service-status');
      expect(hostItem.recommendedRepairCards).not.toContain('service-install');
      expect(hostItem.recommendedRepairCards).not.toContain('service-start');
      expect(hostItem.recommendedRepairCards).not.toContain('service-restart');
      expect(hostItem.bootstrapPlan?.status).toBe('recommended');
      expect(hostItem.bootstrapPlan?.recommendedWhen).toContain('runtime connection is enabled but unreachable');

      const start = hostItem.repairCards?.find((card) => card.id === 'service-start');
      const install = hostItem.repairCards?.find((card) => card.id === 'service-install');
      const restart = hostItem.repairCards?.find((card) => card.id === 'service-restart');
      expect(start?.state).toBe('available');
      expect(start?.recommendation).toBe('inspect-first');
      expect(start?.liveEvidence?.probeStatus).toBe('unreachable');
      expect(start?.liveEvidence?.summary).toContain('service status');
      expect(install?.recommendation).toBe('inspect-first');
      expect(restart?.recommendation).toBe('inspect-first');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes connected-host auth as a token-safe setup blocker', async () => {
    await withClearedEnv(CONNECTED_HOST_AUTH_ENV_KEYS, async () => {
      const fixture = makeFixture();
      try {
        const missing = await executeHarnessJson<{
          readonly setupItemId: string;
          readonly status: string;
          readonly blocksAutonomy: boolean;
          readonly nextAction: string;
          readonly signals?: readonly string[];
          readonly authPosture?: {
            readonly owner: string;
            readonly operatorToken: {
              readonly present: boolean;
              readonly usable: boolean;
              readonly path: string;
              readonly fingerprint?: string;
            };
            readonly routes: {
              readonly reviewCommand: string;
              readonly connectedHostStatus: string;
              readonly pairingPosture: string;
              readonly qrPairingRoute: string;
              readonly manualTokenRoute: string;
              readonly tokenProvisioningOwner: string;
            };
          };
        }>(fixture, { mode: 'setup_item', setupItemId: 'connected-host-auth' });

        expect(missing.setupItemId).toBe('connected-host-auth');
        expect(missing.status).toBe('blocked');
        expect(missing.blocksAutonomy).toBe(true);
        expect(missing.nextAction).toContain('Provision connected-host operator access through the owning GoodVibes host');
        expect(missing.signals?.join('\n')).toContain('operator token: missing');
        expect(missing.signals?.join('\n')).toContain('Agent does not create, rotate, or clear connected-host operator tokens');
        expect(missing.authPosture?.owner).toBe('connected-host');
        expect(missing.authPosture?.operatorToken).toMatchObject({ present: false, usable: false });
        expect(missing.authPosture?.routes.reviewCommand).toBe('/auth review');
        expect(missing.authPosture?.routes.connectedHostStatus).toContain('connected_host_status');
        expect(missing.authPosture?.routes.pairingPosture).toContain('pairing_posture');
        expect(missing.authPosture?.routes.qrPairingRoute).toContain('qr-pairing');
        expect(missing.authPosture?.routes.manualTokenRoute).toContain('manual-token-display');
        expect(missing.authPosture?.routes.tokenProvisioningOwner).toContain('owning GoodVibes host');

        writeConnectedHostOperatorToken(fixture);
        const ready = await executeHarnessJson<{
          readonly status: string;
          readonly signals?: readonly string[];
          readonly authPosture?: {
            readonly operatorToken: {
              readonly present: boolean;
              readonly usable: boolean;
              readonly fingerprint?: string;
            };
          };
        }>(fixture, { mode: 'setup_item', setupItemId: 'connected-host-auth' });

        expect(ready.status).toBe('ready');
        expect(ready.signals?.join('\n')).toContain('operator token: usable');
        expect(ready.authPosture?.operatorToken.present).toBe(true);
        expect(ready.authPosture?.operatorToken.usable).toBe(true);
        expect(ready.authPosture?.operatorToken.fingerprint).toHaveLength(12);
        expect(JSON.stringify(ready)).not.toContain('fixture-connected-host-token');
      } finally {
        fixture.cleanup();
      }
    });
  });

  test('covers first-run setup states for missing host reachable host and unconfigured model access', async () => {
    await withClearedEnv([...CONNECTED_HOST_AUTH_ENV_KEYS, ...PROVIDER_AUTH_ENV_KEYS], async () => {
      const missingHost = makeFixture();
      try {
        (missingHost.context.platform as unknown as {
          serviceRegistry: { getAll: () => Record<string, never>; inspect: () => Promise<null> };
        }).serviceRegistry = {
          getAll: () => {
            throw new Error('connected host registry unavailable');
          },
          inspect: async () => null,
        };
        const host = await executeHarnessJson<{
          readonly status: string;
          readonly signals?: readonly string[];
          readonly bootstrapPlan?: { readonly status: string };
          readonly repairCards?: readonly { readonly id: string; readonly state: string; readonly recommendation: string }[];
        }>(missingHost, { mode: 'setup_item', setupItemId: 'connected-host-readiness' });

        expect(host.status).toBe('blocked');
        expect(host.signals?.join('\n')).toContain('connected host registry unavailable');
        expect(host.bootstrapPlan?.status).toBe('recommended');
        expect(host.repairCards?.find((card) => card.id === 'service-start')?.state).toBe('requires-live-host');
        expect(host.repairCards?.find((card) => card.id === 'service-start')?.recommendation).toBe('unavailable');
      } finally {
        missingHost.cleanup();
      }

      const providerFixture = makeFixture();
      try {
        const posture = await executeHarnessJson<{
          readonly readinessPlan: readonly { readonly setupItemId: string; readonly status: string; readonly nextAction: string; readonly signals?: readonly string[] }[];
        }>(providerFixture, { mode: 'setup_posture', query: 'provider-access', includeParameters: true });
        const provider = posture.readinessPlan.find((item) => item.setupItemId === 'provider-access');
        expect(provider?.status).toBe('blocked');
        expect(provider?.nextAction).toContain('Choose a provider/model route');
        expect(provider?.signals ?? []).toEqual([]);
      } finally {
        providerFixture.cleanup();
      }

      await withTcpListener(async (port) => {
        const reachableHost = makeFixture({ controlPlaneEnabled: true, controlPlanePort: port });
        try {
          writeConnectedHostOperatorToken(reachableHost);
          const host = await executeHarnessJson<{
            readonly status: string;
            readonly serviceProbe?: { readonly status: string; readonly binding: string };
            readonly bootstrapPlan?: { readonly status: string };
            readonly recommendedRepairCards?: readonly string[];
            readonly repairCards?: readonly { readonly id: string; readonly recommendation: string }[];
          }>(reachableHost, { mode: 'setup_item', setupItemId: 'connected-host-readiness' });

          expect(host.status).toBe('check');
          expect(host.serviceProbe?.status).toBe('reachable');
          expect(host.serviceProbe?.binding).toBe(`127.0.0.1:${port}`);
          expect(host.bootstrapPlan?.status).toBe('optional');
          expect(host.recommendedRepairCards ?? []).not.toContain('service-status');
          expect(host.recommendedRepairCards ?? []).not.toContain('service-install');
          expect(host.recommendedRepairCards ?? []).not.toContain('service-start');
          expect(host.recommendedRepairCards ?? []).not.toContain('service-restart');
          expect(host.repairCards?.find((card) => card.id === 'service-status')?.recommendation).toBe('not-needed');
          expect(host.repairCards?.find((card) => card.id === 'service-start')?.recommendation).toBe('not-needed');

          const auth = await executeHarnessJson<{ readonly status: string }>(reachableHost, {
            mode: 'setup_item',
            setupItemId: 'connected-host-auth',
          });
          expect(auth.status).toBe('ready');
        } finally {
          reachableHost.cleanup();
        }
      });
    });
  });

  test('exposes Personal Ops readiness without faking email or calendar connectors', async () => {
    const fixture = makeFixture();
    try {
      AgentNoteRegistry.fromShellPaths(fixture.paths).create({
        title: 'Follow-up queue',
        body: 'Track pending replies, reminders, and handoffs here.',
        tags: ['personal-ops'],
        source: 'agent',
        provenance: 'test',
      });

      const summary = await executeHarnessJson<{
        readonly personalOps?: { readonly lanes: number; readonly gap: number; readonly ready: number; readonly workflows: number; readonly setupWorkflows: number };
      }>(fixture, { mode: 'summary' });
      expect(summary.personalOps?.lanes).toBe(7);
      expect(summary.personalOps?.gap).toBeGreaterThanOrEqual(2);
      expect(summary.personalOps?.ready).toBeGreaterThan(0);
      expect(summary.personalOps?.workflows).toBeGreaterThan(0);
      expect(summary.personalOps?.setupWorkflows).toBeGreaterThan(0);

      const ops = await executeHarnessJson<{
        readonly workflowSummary: { readonly workflows: number; readonly needsSetup: number };
        readonly lanes: readonly {
          readonly id: string;
          readonly status: string;
          readonly current: string;
          readonly methodIds?: readonly string[];
          readonly workflows?: readonly {
            readonly id: string;
            readonly status: string;
            readonly modelRoute: string;
            readonly inspectRoutes?: readonly string[];
            readonly prerequisites?: readonly string[];
            readonly runBoundary?: string;
          }[];
          readonly liveRecords?: readonly {
            readonly id: string;
            readonly label: string;
            readonly status: string;
            readonly summary: string;
            readonly modelRoute: string;
            readonly tags?: readonly string[];
          }[];
        }[];
        readonly policy: string;
        readonly nextActions: readonly string[];
      }>(fixture, { mode: 'personal_ops', includeParameters: true });
      expect(ops.policy).toContain('Missing email/calendar connectors');
      expect(ops.nextActions.join('\n')).toContain('Inbox');
      expect(ops.workflowSummary.needsSetup).toBeGreaterThan(0);

      const inbox = ops.lanes.find((lane) => lane.id === 'inbox');
      const calendar = ops.lanes.find((lane) => lane.id === 'calendar');
      const notes = ops.lanes.find((lane) => lane.id === 'notes');
      const tasks = ops.lanes.find((lane) => lane.id === 'tasks');
      const reminders = ops.lanes.find((lane) => lane.id === 'reminders');
      const delivery = ops.lanes.find((lane) => lane.id === 'delivery');
      expect(inbox?.status).toBe('gap');
      expect(inbox?.current).toContain('No email/IMAP/SMTP methods');
      expect(inbox?.workflows?.[0]?.id).toBe('inbox-triage-briefing');
      expect(inbox?.workflows?.[0]?.status).toBe('needs-setup');
      expect(inbox?.workflows?.[0]?.inspectRoutes?.[0]).toContain('personal_ops_lane');
      expect(inbox?.workflows?.[0]?.runBoundary).toContain('confirmation');
      expect(calendar?.status).toBe('gap');
      expect(calendar?.workflows?.[0]?.id).toBe('calendar-agenda-briefing');
      expect(calendar?.workflows?.[0]?.status).toBe('needs-setup');
      expect(notes?.status).toBe('ready');
      expect(notes?.current).toContain('1 note');
      expect(notes?.liveRecords?.[0]?.id).toBe('follow-up-queue');
      expect(notes?.liveRecords?.[0]?.label).toBe('Follow-up queue');
      expect(notes?.liveRecords?.[0]?.modelRoute).toContain('agent_local_registry');
      expect(tasks?.methodIds).toContain('tasks.list');
      expect(reminders?.methodIds).toContain('schedules.create');
      expect(delivery?.liveRecords?.some((record) => record.modelRoute.includes('mode:"channel"'))).toBe(true);

      const lane = await executeHarnessJson<{
        readonly id: string;
        readonly status: string;
        readonly routes?: { readonly model: string };
      }>(fixture, { mode: 'personal_ops_lane', laneId: 'reminders' });
      expect(lane.id).toBe('reminders');
      expect(lane.status).toBe('ready');
      expect(lane.routes?.model).toContain('agent_reminder_schedule');
      expect(lane.routes?.model).toContain('agent_autonomy_schedule');

      const notesLane = await executeHarnessJson<{
        readonly id: string;
        readonly liveRecords?: readonly { readonly id: string; readonly modelRoute: string }[];
      }>(fixture, { mode: 'personal_ops_lane', laneId: 'notes' });
      expect(notesLane.liveRecords?.[0]?.id).toBe('follow-up-queue');
      expect(notesLane.liveRecords?.[0]?.modelRoute).toContain('action:"get"');
    } finally {
      fixture.cleanup();
    }
  });

  test('surfaces email and calendar MCP connectors as Personal Ops setup routes', async () => {
    const fixture = makeFixture();
    try {
      const mcpApi = fixture.context.clients?.mcpApi as {
        listServerSecurity: () => readonly unknown[];
        listAllTools?: () => Promise<readonly {
          readonly qualifiedName?: string;
          readonly serverName: string;
          readonly toolName: string;
          readonly description?: string;
        }[]>;
        getToolSchema?: (qualifiedName: string) => Promise<{
          readonly inputSchema?: unknown;
        } | null>;
      };
      mcpApi.listServerSecurity = () => [
        {
          name: 'filesystem',
          connected: true,
          trustMode: 'constrained',
          role: 'tools',
          schemaFreshness: 'fresh',
          quarantineReason: null,
          quarantineDetail: null,
          allowedPaths: [fixture.root],
          allowedHosts: ['localhost'],
        },
        {
          name: 'gmail-inbox',
          connected: true,
          trustMode: 'constrained',
          role: 'tools',
          schemaFreshness: 'fresh',
          quarantineReason: null,
          quarantineDetail: null,
          allowedPaths: [],
          allowedHosts: ['mail.example.test'],
        },
        {
          name: 'caldav-agenda',
          connected: false,
          trustMode: 'ask-on-risk',
          role: 'tools',
          schemaFreshness: 'stale',
          quarantineReason: null,
          quarantineDetail: null,
          allowedPaths: [],
          allowedHosts: ['calendar.example.test'],
        },
      ];
      mcpApi.listAllTools = async () => [
        {
          qualifiedName: 'mcp:gmail-inbox:gmail.search_messages',
          serverName: 'gmail-inbox',
          toolName: 'gmail.search_messages',
          description: 'Search unread email messages and threads.',
        },
        {
          qualifiedName: 'mcp:gmail-inbox:gmail.get_thread',
          serverName: 'gmail-inbox',
          toolName: 'gmail.get_thread',
          description: 'Read one email thread by id.',
        },
        {
          qualifiedName: 'mcp:gmail-inbox:gmail.send_reply',
          serverName: 'gmail-inbox',
          toolName: 'gmail.send_reply',
          description: 'Send a reply to an email thread.',
        },
        {
          qualifiedName: 'mcp:caldav-agenda:caldav.list_events',
          serverName: 'caldav-agenda',
          toolName: 'caldav.list_events',
          description: 'List upcoming calendar events.',
        },
        {
          qualifiedName: 'mcp:caldav-agenda:caldav.update_event',
          serverName: 'caldav-agenda',
          toolName: 'caldav.update_event',
          description: 'Edit or reschedule a calendar event.',
        },
      ];
      mcpApi.getToolSchema = async (qualifiedName) => {
        if (qualifiedName === 'mcp:gmail-inbox:gmail.search_messages') {
          return {
            inputSchema: {
              type: 'object',
              required: ['query'],
              properties: {
                query: { type: 'string' },
                limit: { type: 'number' },
                mailbox: { type: 'string' },
                unreadOnly: { type: 'boolean' },
              },
            },
          };
        }
        if (qualifiedName === 'mcp:gmail-inbox:gmail.get_thread') {
          return {
            inputSchema: {
              type: 'object',
              required: ['threadId'],
              properties: {
                threadId: { type: 'string' },
                includeAttachments: { type: 'boolean' },
              },
            },
          };
        }
        if (qualifiedName === 'mcp:gmail-inbox:gmail.send_reply') {
          return {
            inputSchema: {
              type: 'object',
              required: ['threadId', 'body'],
              properties: {
                threadId: { type: 'string' },
                body: { type: 'string' },
                dryRun: { type: 'boolean' },
              },
            },
          };
        }
        if (qualifiedName === 'mcp:caldav-agenda:caldav.list_events') {
          return {
            inputSchema: {
              type: 'object',
              required: ['start', 'end'],
              properties: {
                start: { type: 'string' },
                end: { type: 'string' },
                calendarId: { type: 'string' },
              },
            },
          };
        }
        if (qualifiedName === 'mcp:caldav-agenda:caldav.update_event') {
          return {
            inputSchema: {
              type: 'object',
              required: ['eventId'],
              properties: {
                eventId: { type: 'string' },
                title: { type: 'string' },
                start: { type: 'string' },
                end: { type: 'string' },
              },
            },
          };
        }
        return null;
      };

      const ops = await executeHarnessJson<{
        readonly workflowSummary: { readonly ready: number; readonly attention: number };
        readonly lanes: readonly {
          readonly id: string;
          readonly status: string;
          readonly current: string;
          readonly modelRoute: string;
          readonly workflows?: readonly {
            readonly id: string;
            readonly status: string;
            readonly modelRoute: string;
            readonly inspectRoutes?: readonly string[];
            readonly prerequisites?: readonly string[];
            readonly runBoundary?: string;
          }[];
          readonly connectorSignals?: readonly {
            readonly id: string;
            readonly label: string;
            readonly status: string;
            readonly modelRoute: string;
            readonly toolCount: number;
            readonly capabilityTags?: readonly string[];
            readonly readTools?: readonly {
              readonly name: string;
              readonly qualifiedName?: string;
              readonly capability: string;
              readonly schemaRoute?: string;
              readonly requiredFields?: readonly string[];
              readonly sampleInput?: Record<string, unknown>;
            }[];
            readonly writeTools?: readonly {
              readonly name: string;
              readonly effect: string;
              readonly schemaRoute?: string;
              readonly requiredFields?: readonly string[];
              readonly sampleInput?: Record<string, unknown>;
            }[];
          }[];
          readonly liveRecords?: readonly {
            readonly id: string;
            readonly label?: string;
            readonly status: string;
            readonly modelRoute: string;
            readonly effect?: string;
            readonly capability?: string;
            readonly qualifiedName?: string;
            readonly requiredFields?: readonly string[];
            readonly sampleInput?: Record<string, unknown>;
            readonly confirmationRequired?: boolean;
          }[];
        }[];
      }>(fixture, { mode: 'personal_ops', includeParameters: true });

      const inbox = ops.lanes.find((lane) => lane.id === 'inbox');
      const calendar = ops.lanes.find((lane) => lane.id === 'calendar');
      expect(ops.workflowSummary.ready).toBeGreaterThan(0);
      expect(ops.workflowSummary.attention).toBeGreaterThan(0);
      expect(inbox?.status).toBe('partial');
      expect(inbox?.current).toContain('MCP connector');
      expect(inbox?.modelRoute).toContain('mcp_servers');
      expect(inbox?.connectorSignals?.[0]?.id).toBe('mcp:gmail-inbox');
      expect(inbox?.connectorSignals?.[0]?.status).toBe('ready');
      expect(inbox?.connectorSignals?.[0]?.modelRoute).toContain('gmail-inbox');
      expect(inbox?.connectorSignals?.[0]?.toolCount).toBe(3);
      expect(inbox?.connectorSignals?.[0]?.capabilityTags).toEqual(['inbox-read', 'inbox-write']);
      expect(inbox?.connectorSignals?.[0]?.readTools?.map((tool) => tool.name)).toEqual(['gmail.get_thread', 'gmail.search_messages']);
      expect(inbox?.connectorSignals?.[0]?.readTools?.[1]?.qualifiedName).toBe('mcp:gmail-inbox:gmail.search_messages');
      expect(inbox?.connectorSignals?.[0]?.readTools?.[1]?.schemaRoute).toContain('mcp:gmail-inbox:gmail.search_messages');
      expect(inbox?.connectorSignals?.[0]?.readTools?.[1]?.requiredFields).toEqual(['query']);
      expect(inbox?.connectorSignals?.[0]?.readTools?.[1]?.sampleInput?.query).toBe('is:unread newer_than:7d');
      expect(inbox?.connectorSignals?.[0]?.writeTools?.[0]?.name).toBe('gmail.send_reply');
      expect(inbox?.connectorSignals?.[0]?.writeTools?.[0]?.schemaRoute).toContain('mcp:gmail-inbox:gmail.send_reply');
      expect(inbox?.connectorSignals?.[0]?.writeTools?.[0]?.requiredFields).toEqual(['body', 'threadId']);
      expect(inbox?.connectorSignals?.[0]?.writeTools?.[0]?.sampleInput?.body).toBe('<reviewed draft text>');
      expect(inbox?.workflows?.[0]?.id).toBe('inbox-triage-briefing');
      expect(inbox?.workflows?.[0]?.status).toBe('ready');
      expect(inbox?.workflows?.[0]?.inspectRoutes?.[0]).toContain('gmail-inbox');
      expect(inbox?.workflows?.[0]?.prerequisites?.join('\n')).toContain('classified read-only inbox tool');
      expect(inbox?.workflows?.[1]?.runBoundary).toContain('sending');
      expect(inbox?.workflows?.[1]?.prerequisites?.join('\n')).toContain('write-like inbox tool');
      expect(inbox?.liveRecords?.[0]?.id).toBe('mcp:gmail-inbox');
      const inboxSearchRecord = inbox?.liveRecords?.find((record) => record.id === 'mcp:gmail-inbox:gmail.search_messages');
      expect(inboxSearchRecord?.label).toContain('Inbox read');
      expect(inboxSearchRecord?.modelRoute).toContain('mcp schema');
      expect(inboxSearchRecord?.effect).toBe('read-only');
      expect(inboxSearchRecord?.capability).toBe('inbox-read');
      expect(inboxSearchRecord?.requiredFields).toEqual(['query']);
      expect(inboxSearchRecord?.sampleInput?.query).toBe('is:unread newer_than:7d');
      expect(inboxSearchRecord?.confirmationRequired).toBe(false);
      const inboxSendRecord = inbox?.liveRecords?.find((record) => record.id === 'mcp:gmail-inbox:gmail.send_reply');
      expect(inboxSendRecord?.effect).toBe('confirmed-effect');
      expect(inboxSendRecord?.confirmationRequired).toBe(true);
      expect(inboxSendRecord?.sampleInput?.body).toBe('<reviewed draft text>');

      expect(calendar?.status).toBe('partial');
      expect(calendar?.connectorSignals?.[0]?.id).toBe('mcp:caldav-agenda');
      expect(calendar?.connectorSignals?.[0]?.status).toBe('attention');
      expect(calendar?.connectorSignals?.[0]?.capabilityTags).toEqual(['calendar-read', 'calendar-write']);
      expect(calendar?.connectorSignals?.[0]?.readTools?.[0]?.schemaRoute).toContain('mcp:caldav-agenda:caldav.list_events');
      expect(calendar?.connectorSignals?.[0]?.readTools?.[0]?.requiredFields).toEqual(['end', 'start']);
      expect(calendar?.workflows?.[0]?.status).toBe('attention');
      expect(calendar?.workflows?.[0]?.prerequisites?.join('\n')).toContain('trust/schema');
      const agendaRecord = calendar?.liveRecords?.find((record) => record.id === 'mcp:caldav-agenda:caldav.list_events');
      expect(agendaRecord?.modelRoute).toContain('mcp schema');
      expect(agendaRecord?.requiredFields).toEqual(['end', 'start']);
      expect(agendaRecord?.sampleInput?.start).toBe('<start-iso>');

      const lane = await executeHarnessJson<{
        readonly id: string;
        readonly status: string;
        readonly connectorSignals?: readonly { readonly id: string; readonly modelRoute: string; readonly readTools?: readonly { readonly name: string }[] }[];
        readonly workflows?: readonly { readonly id: string; readonly inspectRoutes?: readonly string[]; readonly prerequisites?: readonly string[] }[];
      }>(fixture, { mode: 'personal_ops_lane', laneId: 'inbox' });
      expect(lane.id).toBe('inbox');
      expect(lane.status).toBe('partial');
      expect(lane.connectorSignals?.[0]?.modelRoute).toContain('mcp_server');
      expect(lane.connectorSignals?.[0]?.readTools?.[0]?.name).toBe('gmail.get_thread');
      expect(lane.workflows?.[0]?.inspectRoutes?.[0]).toContain('gmail-inbox');
      expect(lane.workflows?.[0]?.prerequisites?.join('\n')).toContain('classified read-only inbox tool');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes a visible autonomy queue with owners and cancel routes', async () => {
    const fixture = makeFixture();
    try {
      const now = 1_700_000_100_000;
      const researchRunRegistry = AgentResearchRunRegistry.fromShellPaths(fixture.paths);
      const run = researchRunRegistry.create({
        title: 'Market map research',
        question: 'Which competitor research features need parity?',
        nextSteps: ['Read source queue'],
      });
      researchRunRegistry.start(run.id, 'Starting competitor map.');
      researchRunRegistry.checkpoint(run.id, {
        phase: 'reading',
        status: 'blocked',
        progress: 35,
        note: 'Waiting on source review before synthesis.',
        sourceIds: ['source-a'],
        nextSteps: ['Review source-a'],
      });
      const readModels = fixture.context.platform.readModels as Record<string, unknown>;
      const automationSource = {
        id: 'schedule-source-live',
        kind: 'schedule',
        label: 'Daily operator brief',
        enabled: true,
        createdAt: now - 600_000,
        updatedAt: now - 60_000,
        metadata: {},
      };
      const automationExecution = {
        prompt: 'Summarize overnight operator posture.',
        target: { kind: 'background' },
      };
      const automationDelivery = {
        mode: 'surface',
        targets: [],
        fallbackTargets: [],
        includeSummary: true,
        includeTranscript: false,
        includeLinks: true,
      };
      const automationFailure = {
        action: 'retry',
        maxConsecutiveFailures: 3,
        cooldownMs: 60_000,
        retryPolicy: {
          maxAttempts: 2,
          delayMs: 30_000,
          strategy: 'fixed',
        },
      };
      Object.assign(readModels, {
        tasks: {
          getSnapshot: () => ({
            tasks: [
              {
                id: 'host-task-live',
                kind: 'scheduler',
                title: 'Deliver scheduled brief',
                status: 'running',
                owner: 'scheduler',
                cancellable: true,
                childTaskIds: [],
                queuedAt: now - 120_000,
                startedAt: now - 60_000,
                correlationId: 'corr-live',
              },
              {
                id: 'host-task-failed',
                kind: 'daemon',
                title: 'Retry failed sync',
                status: 'failed',
                owner: 'daemon',
                cancellable: false,
                childTaskIds: [],
                queuedAt: now - 300_000,
                startedAt: now - 240_000,
                endedAt: now - 180_000,
                error: 'network timeout',
                retryPolicy: {
                  maxAttempts: 3,
                  currentAttempt: 1,
                  delayMs: 60_000,
                  backoff: 'exponential',
                  retryOn: ['network'],
                },
                retryAt: now + 60_000,
              },
            ],
          }),
          subscribe: () => () => {},
        },
        automation: {
          getSnapshot: () => ({
            jobs: [{
              id: 'sched-live-1',
              labels: ['operator-brief'],
              createdAt: now - 600_000,
              updatedAt: now - 30_000,
              name: 'Daily operator brief',
              status: 'enabled',
              enabled: true,
              schedule: { kind: 'cron', expression: '0 9 * * *', timezone: 'America/Chicago' },
              execution: automationExecution,
              delivery: automationDelivery,
              failure: automationFailure,
              source: automationSource,
              nextRunAt: now + 3_600_000,
              lastRunAt: now - 86_400_000,
              lastRunId: 'auto-run-1',
              runCount: 2,
              successCount: 1,
              failureCount: 1,
              deleteAfterRun: false,
            }],
            runs: [{
              id: 'auto-run-1',
              labels: ['operator-brief'],
              createdAt: now - 90_000,
              updatedAt: now - 15_000,
              jobId: 'sched-live-1',
              status: 'running',
              agentId: 'agent-live-1',
              triggeredBy: automationSource,
              target: { kind: 'background' },
              execution: automationExecution,
              scheduleKind: 'cron',
              queuedAt: now - 90_000,
              startedAt: now - 75_000,
              forceRun: false,
              dueRun: true,
              attempt: 2,
              sessionId: 'session-alpha',
              routeId: 'route-live-1',
              continuationMode: 'background',
              executionIntent: { mode: 'background', targetKind: 'background' },
              deliveryIds: ['delivery-live-1'],
              modelId: 'gpt-4.1',
              providerId: 'openai',
            }],
            totalJobs: 1,
            totalRuns: 1,
            activeRunIds: ['auto-run-1'],
            totalFailed: 0,
            sourceCount: 1,
            deliveryTotals: { succeeded: 1, failed: 0, deadLettered: 0 },
          }),
          subscribe: () => () => {},
        },
        controlPlane: {
          getSnapshot: () => ({
            connectionState: 'connected',
            activeClientIds: ['operator-client'],
            requestCount: 1,
            errorCount: 0,
            host: '127.0.0.1',
            port: 3421,
            clients: [],
            approvals: [{
              id: 'approval-live-1',
              callId: 'call-live-1',
              sessionId: 'session-alpha',
              routeId: 'route-live-1',
              status: 'pending',
              request: {
                callId: 'call-live-1',
                tool: 'shell.exec',
                args: { cmd: 'git status --short' },
                category: 'execute',
                analysis: {
                  classification: 'shell-command',
                  riskLevel: 'high',
                  summary: 'Run git status for the workspace.',
                  reasons: ['The action runs a shell command through the connected host.'],
                  target: 'git status --short',
                  targetKind: 'command',
                  surface: 'shell',
                  blastRadius: 'project',
                },
              },
              createdAt: now - 45_000,
              updatedAt: now - 30_000,
              metadata: { source: 'test' },
              audit: [{
                id: 'audit-live-1',
                action: 'created',
                actor: 'agent',
                actorSurface: 'tui',
                createdAt: now - 45_000,
                note: 'approval requested',
              }],
            }],
            sessions: [],
            recentEvents: [],
          }),
          subscribe: () => () => {},
        },
      });

      const summary = await executeHarnessJson<{
        readonly autonomyQueue?: { readonly items: number; readonly cancellable: number; readonly readOnly: boolean };
      }>(fixture, { mode: 'summary' });
      expect(summary.autonomyQueue?.items).toBeGreaterThanOrEqual(8);
      expect(summary.autonomyQueue?.cancellable).toBeGreaterThan(0);
      expect(summary.autonomyQueue?.readOnly).toBe(true);

      const queue = await executeHarnessJson<{
        readonly summary: { readonly items: number; readonly cancellable: number; readonly needsSetup: number };
        readonly queue: readonly {
          readonly queueItemId: string;
          readonly status: string;
          readonly owner: string;
          readonly cancellable: boolean;
          readonly modelRoute: string;
          readonly inspectRoute: string;
          readonly cancelRoute?: string;
          readonly liveRecords?: readonly {
            readonly id: string;
            readonly label: string;
            readonly status: string;
            readonly progress?: number;
            readonly inspectRoute: string;
            readonly cancelRoute?: string;
            readonly checkpointRoute?: string;
            readonly pauseRoute?: string;
            readonly resumeRoute?: string;
            readonly logTail?: readonly string[];
            readonly sourceIds?: readonly string[];
            readonly nextSteps?: readonly string[];
            readonly availableControls?: readonly string[];
            readonly controls?: readonly {
              readonly id: string;
              readonly state: string;
              readonly effect: string;
              readonly confirmationRequired: boolean;
              readonly modelRoute?: string;
              readonly reason?: string;
            }[];
          }[];
        }[];
        readonly policy: string;
      }>(fixture, { mode: 'autonomy_queue', includeParameters: true });
      expect(queue.summary.items).toBeGreaterThanOrEqual(8);
      expect(queue.summary.cancellable).toBeGreaterThan(0);
      expect(queue.policy).toContain('Visible autonomy queue is read-only');
      expectRowsHaveCompactModelRoutes(queue.queue);

      const workPlan = queue.queue.find((item) => item.queueItemId === 'visible-work-plan');
      const researchRuns = queue.queue.find((item) => item.queueItemId === 'research-runs');
      const hostTasks = queue.queue.find((item) => item.queueItemId === 'connected-host-tasks');
      const approvals = queue.queue.find((item) => item.queueItemId === 'pending-approvals');
      const automation = queue.queue.find((item) => item.queueItemId === 'automation-runs');
      const autonomousScheduleRequests = queue.queue.find((item) => item.queueItemId === 'autonomous-schedule-requests');
      const schedules = queue.queue.find((item) => item.queueItemId === 'connected-schedules');
      const routines = queue.queue.find((item) => item.queueItemId === 'routine-schedule-promotions');
      expect(workPlan?.owner).toBe('agent');
      expect(workPlan?.cancellable).toBe(true);
      expect(workPlan?.cancelRoute).toContain('workplan-status');
      expect(researchRuns?.status).toBe('attention');
      expect(researchRuns?.liveRecords?.[0]?.id).toBe('market-map-research');
      expect(researchRuns?.liveRecords?.[0]?.status).toBe('blocked');
      expect(researchRuns?.liveRecords?.[0]?.progress).toBe(35);
      expect(researchRuns?.liveRecords?.[0]?.inspectRoute).toContain('agent_research_runs show');
      expect(researchRuns?.liveRecords?.[0]?.cancelRoute).toContain('agent_research_runs cancel');
      expect(researchRuns?.liveRecords?.[0]?.checkpointRoute).toContain('agent_research_runs checkpoint');
      expect(researchRuns?.liveRecords?.[0]?.pauseRoute).toContain('agent_research_runs pause');
      expect(researchRuns?.liveRecords?.[0]?.resumeRoute).toContain('agent_research_runs resume');
      expect(researchRuns?.liveRecords?.[0]?.availableControls).toContain('checkpoint');
      expect(researchRuns?.liveRecords?.[0]?.availableControls).toContain('pause');
      expect(researchRuns?.liveRecords?.[0]?.availableControls).toContain('resume');
      expect(researchRuns?.liveRecords?.[0]?.controls?.find((control) => control.id === 'cancel')?.modelRoute).toContain('agent_research_runs cancel');
      expect(researchRuns?.liveRecords?.[0]?.controls?.find((control) => control.id === 'pause')?.modelRoute).toContain('agent_research_runs pause');
      expect(researchRuns?.liveRecords?.[0]?.controls?.find((control) => control.id === 'resume')?.modelRoute).toContain('agent_research_runs resume');
      expect(researchRuns?.liveRecords?.[0]?.logTail?.join('\n')).toContain('Waiting on source review before synthesis.');
      expect(researchRuns?.liveRecords?.[0]?.sourceIds).toContain('source-a');
      expect(researchRuns?.liveRecords?.[0]?.nextSteps).toContain('Review source-a');
      expect(hostTasks?.status).toBe('attention');
      expect(hostTasks?.cancellable).toBe(true);
      expect(hostTasks?.cancelRoute).toContain('tasks.cancel');
      expect(hostTasks?.liveRecords?.[0]?.id).toBe('host-task-live');
      expect(hostTasks?.liveRecords?.[0]?.inspectRoute).toBe('/tasks show host-task-live');
      expect(hostTasks?.liveRecords?.[0]?.cancelRoute).toContain('tasks.cancel');
      expect(hostTasks?.liveRecords?.[0]?.availableControls).toContain('cancel');
      expect(hostTasks?.liveRecords?.[0]?.controls?.find((control) => control.id === 'cancel')?.confirmationRequired).toBe(true);
      expect(hostTasks?.liveRecords?.[0]?.controls?.find((control) => control.id === 'cancel')?.modelRoute).toContain('tasks.cancel');
      const failedHostTask = hostTasks?.liveRecords?.find((record) => record.id === 'host-task-failed');
      expect(failedHostTask?.status).toBe('failed');
      expect(failedHostTask?.availableControls).toContain('retry');
      expect(failedHostTask?.controls?.find((control) => control.id === 'retry')?.modelRoute).toContain('tasks.retry');
      expect(failedHostTask?.logTail?.join('\n')).toContain('network timeout');
      expect(approvals?.owner).toBe('connected-host');
      expect(approvals?.status).toBe('attention');
      expect(approvals?.cancelRoute).toContain('approval-cancel');
      expect(approvals?.liveRecords?.[0]?.id).toBe('approval-live-1');
      expect(approvals?.liveRecords?.[0]?.status).toBe('pending');
      expect(approvals?.liveRecords?.[0]?.cancelRoute).toContain('approvals.cancel');
      expect(approvals?.liveRecords?.[0]?.availableControls).toContain('approve');
      expect(approvals?.liveRecords?.[0]?.controls?.find((control) => control.id === 'deny')?.modelRoute).toContain('approvals.deny');
      expect(approvals?.liveRecords?.[0]?.nextSteps?.join('\n')).toContain('approvals.approve');
      expect(approvals?.liveRecords?.[0]?.nextSteps?.join('\n')).toContain('approvals.deny');
      expect(automation?.status).toBe('active');
      expect(automation?.liveRecords?.[0]?.id).toBe('auto-run-1');
      expect(automation?.liveRecords?.[0]?.cancelRoute).toContain('automation.runs.cancel');
      expect(automation?.liveRecords?.[0]?.availableControls).toContain('cancel');
      expect(automation?.liveRecords?.[0]?.controls?.find((control) => control.id === 'retry')?.state).toBe('unavailable');
      expect(automation?.liveRecords?.[0]?.sourceIds).toContain('sched-live-1');
      expect(autonomousScheduleRequests?.modelRoute).toBe('agent_autonomy_schedule');
      expect(autonomousScheduleRequests?.createRoute).toContain('successCriteria');
      expect(schedules?.status).toBe('active');
      expect(schedules?.cancellable).toBe(true);
      expect(schedules?.cancelRoute).toContain('schedules.disable');
      expect(schedules?.liveRecords?.[0]?.id).toBe('sched-live-1');
      expect(schedules?.liveRecords?.[0]?.nextSteps?.join('\n')).toContain('schedules.run');
      expect(schedules?.liveRecords?.[0]?.nextSteps?.join('\n')).toContain('agent_schedule_edit');
      expect(schedules?.liveRecords?.[0]?.nextSteps?.join('\n')).toContain('schedules.disable');
      expect(schedules?.liveRecords?.[0]?.nextSteps?.join('\n')).toContain('schedules.delete');
      expect(schedules?.liveRecords?.[0]?.cancelRoute).toContain('schedules.disable');
      expect(schedules?.liveRecords?.[0]?.availableControls).toContain('run');
      expect(schedules?.liveRecords?.[0]?.controls?.find((control) => control.id === 'delete')?.confirmationRequired).toBe(true);
      expect(schedules?.modelRoute).toContain('agent_schedule_edit');
      expect(schedules?.createRoute).toContain('agent_autonomy_schedule');
      expect(routines?.inspectRoute).toContain('schedule-receipts');

      const item = await executeHarnessJson<{
        readonly queueItemId: string;
        readonly routes?: { readonly inspect: string; readonly cancel: string | null };
        readonly liveRecords?: readonly { readonly id: string; readonly cancelRoute?: string }[];
      }>(fixture, { mode: 'autonomy_queue_item', queueItemId: 'automation-runs' });
      expect(item.queueItemId).toBe('automation-runs');
      expect(item.routes?.cancel).toContain('automation-run-cancel');
      expect(item.liveRecords?.[0]?.id).toBe('auto-run-1');
      expect(item.liveRecords?.[0]?.cancelRoute).toContain('automation.runs.cancel');

      const researchItem = await executeHarnessJson<{
        readonly queueItemId: string;
        readonly liveRecords?: readonly { readonly id: string; readonly logTail?: readonly string[] }[];
      }>(fixture, { mode: 'autonomy_queue_item', queueItemId: 'research-runs' });
      expect(researchItem.queueItemId).toBe('research-runs');
      expect(researchItem.liveRecords?.[0]?.id).toBe('market-map-research');
      expect(researchItem.liveRecords?.[0]?.logTail?.join('\n')).toContain('Waiting on source review before synthesis.');

      const action = await executeHarnessJson<{
        readonly id: string;
        readonly modelRoute?: string;
      }>(fixture, { mode: 'workspace_action', actionId: 'personal-ops-autonomy-queue' });
      expect(action.id).toBe('personal-ops-autonomy-queue');
      expect(action.modelRoute).toBe('agent_harness mode:"autonomy_queue"');
    } finally {
      fixture.cleanup();
    }
  });

  test('routes ongoing-work requests through a conservative autonomy intake selector', async () => {
    const fixture = makeFixture();
    try {
      const missing = await executeHarnessJson<{
        readonly status: string;
        readonly usage?: string;
        readonly queueRoute?: string;
      }>(fixture, { mode: 'autonomy_intake' });
      expect(missing.status).toBe('missing_request');
      expect(missing.usage).toContain('query');
      expect(missing.queueRoute).toBe('agent_harness mode:"autonomy_queue"');

      const reminder = await executeHarnessJson<{
        readonly status: string;
        readonly preferred: {
          readonly id: string;
          readonly modelRoute: string;
          readonly requiresConfirmation: boolean;
          readonly missingFields?: readonly string[];
        };
        readonly policy: string;
      }>(fixture, {
        mode: 'autonomy_intake',
        query: 'Remind me every 2 hours to check the deploy.',
        includeParameters: true,
      });
      expect(reminder.status).toBe('ready');
      expect(reminder.preferred.id).toBe('one-reminder-or-simple-recurring-reminder');
      expect(reminder.preferred.modelRoute).toContain('agent_reminder_schedule');
      expect(reminder.preferred.modelRoute).toContain('scheduleKind:"every"');
      expect(reminder.preferred.modelRoute).toContain('scheduleValue:"2h"');
      expect(reminder.preferred.requiresConfirmation).toBe(true);
      expect(reminder.preferred.missingFields).toBeUndefined();
      expect(reminder.policy).toContain('Autonomy intake is read-only');

      const autonomousSchedule = await executeHarnessJson<{
        readonly preferred: {
          readonly id: string;
          readonly modelRoute: string;
          readonly missingFields?: readonly string[];
          readonly userQuestion?: string;
        };
      }>(fixture, {
        mode: 'autonomy_intake',
        query: 'Run a daily operator report.',
        includeParameters: true,
      });
      expect(autonomousSchedule.preferred.id).toBe('confirmed-autonomous-schedule');
      expect(autonomousSchedule.preferred.modelRoute).toContain('agent_autonomy_schedule');
      expect(autonomousSchedule.preferred.modelRoute).toContain('successCriteria');
      expect(autonomousSchedule.preferred.missingFields).toContain('scheduleValue');
      expect(autonomousSchedule.preferred.missingFields).toContain('successCriteria');
      expect(autonomousSchedule.preferred.userQuestion).toContain('success criteria');

      const routine = await executeHarnessJson<{
        readonly preferred: {
          readonly id: string;
          readonly modelRoute: string;
          readonly missingFields?: readonly string[];
          readonly userQuestion?: string;
        };
      }>(fixture, {
        mode: 'autonomy_intake',
        query: 'Run the weekly operator report as a reviewed routine.',
        includeParameters: true,
      });
      expect(routine.preferred.id).toBe('reviewed-routine-schedule');
      expect(routine.preferred.modelRoute).toContain('promote routine');
      expect(routine.preferred.missingFields).toContain('routineId');
      expect(routine.preferred.missingFields).toContain('scheduleValue');
      expect(routine.preferred.userQuestion).toContain('reviewed routine');

      const control = await executeHarnessJson<{
        readonly preferred: {
          readonly id: string;
          readonly modelRoute: string;
          readonly missingFields?: readonly string[];
        };
      }>(fixture, {
        mode: 'autonomy_intake',
        query: 'Cancel the running automation run.',
      });
      expect(control.preferred.id).toBe('automation-control');
      expect(control.preferred.modelRoute).toContain('queueItemId:"automation-runs"');
      expect(control.preferred.missingFields?.join('\n')).toContain('runId');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes a local-first execution posture before delegation', async () => {
    const fixture = makeFixture();
    try {
      for (const name of ['read', 'edit', 'exec', 'fetch', 'web_search']) registerStubTool(fixture.toolRegistry, name);

      const posture = await executeHarnessJson<{
        readonly summary: {
          readonly localFirstPolicy: string;
          readonly delegationPolicy: string;
          readonly browserControl: string;
          readonly executionHistory: string;
          readonly browserControlSetup: {
            readonly status: string;
            readonly setupRoute: string;
            readonly recommendedRoute: string;
            readonly toolMatches: readonly string[];
            readonly needsReview: boolean;
            readonly workflows: readonly { readonly id: string; readonly status: string; readonly inspectRoute: string; readonly safety: string }[];
            readonly setupChecklist: readonly string[];
            readonly fallbackRoutes: readonly string[];
          };
          readonly supervision: {
            readonly processMonitorAvailable: boolean;
            readonly liveTailAvailable: boolean;
            readonly toolInspectorAvailable: boolean;
          };
          readonly delegationDecisionCards: readonly { readonly lane: string }[];
          readonly registeredExecutionTools: readonly string[];
        };
        readonly decisionRules: readonly string[];
        readonly routes: readonly {
          readonly executionRouteId: string;
          readonly availability: string;
          readonly modelRoute: string;
          readonly nextStep?: string;
          readonly supervisionRoutes?: readonly {
            readonly id: string;
            readonly available: boolean;
            readonly modelRoute: string;
          }[];
        }[];
      }>(fixture, {
        mode: 'execution_posture',
        includeParameters: true,
      });
      expect(posture.summary.localFirstPolicy).toContain('Use local read/edit/exec');
      expect(posture.summary.delegationPolicy).toContain('isolation');
      expect(posture.summary.browserControl).toBe('setup-needed');
      expect(posture.summary.executionHistory).toContain('execution_history');
      expect(posture.summary.browserControlSetup.setupRoute).toContain('browser-desktop-control');
      expect(posture.summary.browserControlSetup.recommendedRoute).toContain('mcp_servers');
      expect(posture.summary.browserControlSetup.needsReview).toBe(false);
      expect(posture.summary.browserControlSetup.workflows[0]?.id).toBe('browser-navigation');
      expect(posture.summary.browserControlSetup.workflows[0]?.status).toBe('setup-needed');
      expect(posture.summary.browserControlSetup.workflows[0]?.inspectRoute).toContain('setup_item');
      expect(posture.summary.browserControlSetup.setupChecklist.join('\n')).toContain('constrained trust');
      expect(posture.summary.browserControlSetup.fallbackRoutes.join('\n')).toContain('web-fetch-research');
      expect(posture.summary.supervision.processMonitorAvailable).toBe(true);
      expect(posture.summary.supervision.liveTailAvailable).toBe(true);
      expect(posture.summary.registeredExecutionTools).toEqual(expect.arrayContaining(['read', 'edit', 'exec', 'fetch', 'web_search']));
      expect(posture.decisionRules.join('\n')).toContain('Do not delegate ordinary local implementation');

      const shell = posture.routes.find((route) => route.executionRouteId === 'local-shell-command');
      expect(shell?.availability).toBe('ready');
      expect(shell?.modelRoute).toBe('exec');
      expect(shell?.supervisionRoutes?.map((route) => route.id)).toEqual(expect.arrayContaining(['process-monitor', 'live-tail', 'tool-inspector']));
      expect(shell?.supervisionRoutes?.find((route) => route.id === 'process-monitor')?.available).toBe(true);
      expect(shell?.supervisionRoutes?.find((route) => route.id === 'live-tail')?.modelRoute).toContain('open_ui_surface');

      const edit = posture.routes.find((route) => route.executionRouteId === 'local-edit-write');
      expect(edit?.availability).toBe('ready');
      expect(edit?.modelRoute).toBe('edit/write');
      expect(JSON.stringify(edit)).toContain('file_recovery');
      expect(edit?.supervisionRoutes?.map((route) => route.id)).toContain('tool-inspector');

      const browser = posture.routes.find((route) => route.executionRouteId === 'browser-or-desktop-control');
      expect(browser?.availability).toBe('setup-needed');

      const inspectedBrowser = await executeHarnessJson<{
        readonly executionRouteId: string;
        readonly availability: string;
        readonly browserControl?: {
          readonly status: string;
          readonly workflows: readonly { readonly id: string; readonly status: string; readonly setupRoute: string }[];
          readonly policy: string;
        };
      }>(fixture, {
        mode: 'execution_route',
        executionRouteId: 'browser-or-desktop-control',
      });
      expect(inspectedBrowser.executionRouteId).toBe('browser-or-desktop-control');
      expect(inspectedBrowser.availability).toBe('setup-needed');
      expect(inspectedBrowser.browserControl?.workflows[0]?.status).toBe('setup-needed');
      expect(inspectedBrowser.browserControl?.workflows[0]?.setupRoute).toContain('browser-desktop-control');
      expect(inspectedBrowser.browserControl?.policy).toContain('no live UI control is assumed');

      const mcpApi = fixture.context.clients?.mcpApi as {
        listServerSecurity: () => readonly unknown[];
      };
      mcpApi.listServerSecurity = () => [{
        name: 'browser-stale',
        connected: true,
        trustMode: 'blocked',
        role: 'browser',
        schemaFreshness: 'stale',
        quarantineReason: null,
        quarantineDetail: null,
        allowedPaths: [],
        allowedHosts: ['browser.example.test'],
      }];
      const attentionPosture = await executeHarnessJson<{
        readonly summary: {
          readonly browserControl: string;
          readonly browserControlSetup: {
            readonly configured: boolean;
            readonly needsReview: boolean;
            readonly mcpServers: readonly { readonly name: string; readonly readiness: string }[];
            readonly workflows: readonly { readonly status: string; readonly inspectRoute: string }[];
          };
        };
      }>(fixture, { mode: 'execution_posture' });
      expect(attentionPosture.summary.browserControl).toBe('attention');
      expect(attentionPosture.summary.browserControlSetup.configured).toBe(false);
      expect(attentionPosture.summary.browserControlSetup.needsReview).toBe(true);
      expect(attentionPosture.summary.browserControlSetup.mcpServers[0]?.readiness).toBe('attention');
      expect(attentionPosture.summary.browserControlSetup.workflows[0]?.status).toBe('attention');

      const attentionBrowserSetup = await executeHarnessJson<{
        readonly setupItemId: string;
        readonly status: string;
        readonly signals?: readonly string[];
      }>(fixture, { mode: 'setup_item', setupItemId: 'browser-desktop-control' });
      expect(attentionBrowserSetup.setupItemId).toBe('browser-desktop-control');
      expect(attentionBrowserSetup.status).toBe('check');
      expect(attentionBrowserSetup.signals?.join('\n')).toContain('attention');

      registerStubTool(fixture.toolRegistry, 'browser_screenshot');
      const configuredPosture = await executeHarnessJson<{
        readonly summary: {
          readonly browserControl: string;
          readonly browserControlSetup: {
            readonly toolMatches: readonly string[];
            readonly recommendedRoute: string;
            readonly workflows: readonly { readonly status: string; readonly inspectRoute: string }[];
          };
        };
        readonly routes: readonly {
          readonly executionRouteId: string;
          readonly availability: string;
        }[];
      }>(fixture, { mode: 'execution_posture' });
      expect(configuredPosture.summary.browserControl).toBe('ready');
      expect(configuredPosture.summary.browserControlSetup.toolMatches).toContain('browser_screenshot');
      expect(configuredPosture.summary.browserControlSetup.recommendedRoute).toContain('execution_route');
      expect(configuredPosture.summary.browserControlSetup.workflows[0]?.status).toBe('ready');
      expect(configuredPosture.summary.browserControlSetup.workflows[0]?.inspectRoute).toContain('execution_route');
      expect(configuredPosture.routes.find((route) => route.executionRouteId === 'browser-or-desktop-control')?.availability).toBe('ready');

      const configuredBrowserSetup = await executeHarnessJson<{
        readonly setupItemId: string;
        readonly status: string;
        readonly modelRoute: string;
        readonly signals?: readonly string[];
      }>(fixture, { mode: 'setup_item', setupItemId: 'browser-desktop-control' });
      expect(configuredBrowserSetup.setupItemId).toBe('browser-desktop-control');
      expect(configuredBrowserSetup.status).toBe('ready');
      expect(configuredBrowserSetup.modelRoute).toContain('execution_route');
      expect(configuredBrowserSetup.signals?.join('\n')).toContain('browser_screenshot');

      const delegated = posture.routes.find((route) => route.executionRouteId === 'delegation-isolation-parallel-remote');
      expect(delegated?.availability).toBe('ready');
      expect(delegated?.nextStep).toContain('delegation_posture');
      expect(posture.summary.delegationDecisionCards.map((card) => card.lane)).toEqual(expect.arrayContaining([
        'local-first',
        'tui-shared-session',
        'delegated-review',
        'remote-runner',
        'hidden-fanout-blocked',
      ]));

      const inspectedShell = await executeHarnessJson<{
        readonly executionRouteId: string;
        readonly availability: string;
        readonly safety: string;
        readonly useInsteadWhen?: string;
      }>(fixture, {
        mode: 'execution_route',
        executionRouteId: 'local-shell-command',
      });
      expect(inspectedShell.executionRouteId).toBe('local-shell-command');
      expect(inspectedShell.availability).toBe('ready');
      expect(inspectedShell.safety).toContain('foreground serial');
      expect(inspectedShell.useInsteadWhen).toContain('delegation');

      const inspectedDelegation = await executeHarnessJson<{
        readonly executionRouteId: string;
        readonly preferredWhen: string;
        readonly useInsteadWhen?: string;
        readonly delegationDecisionCards?: readonly {
          readonly id: string;
          readonly lane: string;
          readonly requiredFields: readonly string[];
          readonly confirmationBoundary: string;
        }[];
      }>(fixture, {
        mode: 'execution_route',
        executionRouteId: 'delegation-isolation-parallel-remote',
      });
      expect(inspectedDelegation.preferredWhen).toContain('remote host');
      expect(inspectedDelegation.useInsteadWhen).toContain('Use local read/edit/exec');
      expect(inspectedDelegation.delegationDecisionCards?.find((card) => card.lane === 'tui-shared-session')?.requiredFields.join('\n')).toContain('delegation reason');
      expect(inspectedDelegation.delegationDecisionCards?.find((card) => card.lane === 'hidden-fanout-blocked')?.confirmationBoundary).toContain('never confirmed');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes local execution history records with supervision and recovery routes', async () => {
    const fixture = makeFixture();
    try {
      const now = Date.now();
      const target = join(fixture.root, 'history-edit.txt');
      writeFileSync(target, 'after', 'utf-8');
      fixture.context.workspace.fileUndoManager?.snapshot({
        path: target,
        beforeContent: 'before',
        afterContent: 'after',
        tool: 'edit',
      });
      fixture.executionRecords.push(
        {
          id: 'call-shell',
          callId: 'call-shell',
          turnId: 'turn-1',
          tool: 'exec',
          routeKind: 'shell',
          status: 'succeeded',
          phase: 'TOOL_SUCCEEDED',
          receivedAt: now - 2000,
          updatedAt: now - 1000,
          completedAt: now - 1000,
          durationMs: 1000,
          permissionApproved: true,
          argsPreview: '{"command":"bun test","apiKey":"[redacted]"}',
          argsKeys: ['command'],
          commandPreview: 'bun test src/test/tools/agent-harness-tool.test.ts',
          resultSummary: { kind: 'text', byteSize: 42, preview: '84 pass, 0 fail' },
        },
        {
          id: 'call-edit',
          callId: 'call-edit',
          turnId: 'turn-1',
          tool: 'edit',
          routeKind: 'write',
          status: 'succeeded',
          phase: 'TOOL_SUCCEEDED',
          receivedAt: now - 4000,
          updatedAt: now - 3000,
          completedAt: now - 3000,
          durationMs: 1000,
          argsPreview: '{"path":"history-edit.txt","content":"after"}',
          argsKeys: ['content', 'path'],
          targetPreview: 'history-edit.txt',
          resultSummary: { kind: 'json', byteSize: 18, preview: '{"ok":true}' },
        },
      );

      const summary = await executeHarnessJson<{
        readonly summary: {
          readonly records: number;
          readonly succeeded: number;
          readonly routeKinds: { readonly shell: number; readonly write: number };
        };
        readonly records: readonly {
          readonly executionRecordId: string;
          readonly tool: string;
          readonly routeKind: string;
          readonly commandPreview?: string;
          readonly argsPreview: string;
          readonly resultSummary?: { readonly preview?: string };
          readonly supervisionRoutes?: readonly { readonly id: string; readonly modelRoute: string }[];
          readonly recoveryRoute?: string;
        }[];
      }>(fixture, { mode: 'execution_history', includeParameters: true });
      expect(summary.summary.records).toBe(2);
      expect(summary.summary.succeeded).toBe(2);
      expect(summary.summary.routeKinds.shell).toBe(1);
      expect(summary.summary.routeKinds.write).toBe(1);
      expect(summary.records.find((record) => record.executionRecordId === 'call-shell')?.commandPreview).toContain('bun test');
      expect(summary.records.find((record) => record.executionRecordId === 'call-shell')?.argsPreview).toContain('[redacted]');
      expect(summary.records.find((record) => record.executionRecordId === 'call-shell')?.resultSummary?.preview).toContain('84 pass');
      expect(summary.records.find((record) => record.executionRecordId === 'call-shell')?.supervisionRoutes?.map((route) => route.id)).toEqual(expect.arrayContaining(['process-monitor', 'live-tail']));
      expect(summary.records.find((record) => record.executionRecordId === 'call-edit')?.recoveryRoute).toContain('file_recovery');

      const searched = await executeHarnessJson<{
        readonly records: readonly { readonly executionRecordId: string }[];
      }>(fixture, { mode: 'execution_history', query: 'bun test' });
      expect(searched.records.map((record) => record.executionRecordId)).toEqual(['call-shell']);

      const inspected = await executeHarnessJson<{
        readonly executionRecordId: string;
        readonly policy?: { readonly effect: string; readonly values: string };
        readonly modelAccess?: { readonly toolInspector: string; readonly fileRecovery: string };
        readonly lookup?: { readonly resolvedBy?: string };
      }>(fixture, { mode: 'execution_history_item', executionRecordId: 'call-edit' });
      expect(inspected.executionRecordId).toBe('call-edit');
      expect(inspected.lookup?.resolvedBy).toBe('id');
      expect(inspected.policy?.effect).toBe('read-only');
      expect(inspected.policy?.values).toContain('redacted args');
      expect(inspected.modelAccess?.fileRecovery).toContain('file_recovery');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes confirmed local file edit recovery from FileUndoManager snapshots', async () => {
    const fixture = makeFixture();
    try {
      const target = join(fixture.root, 'recoverable.txt');
      writeFileSync(target, 'after content', 'utf-8');
      fixture.context.workspace.fileUndoManager?.snapshot({
        path: target,
        beforeContent: 'before content',
        afterContent: 'after content',
        tool: 'edit',
      });

      const posture = await executeHarnessJson<{
        readonly summary: {
          readonly fileRecovery?: { readonly undoDepth: number; readonly redoDepth: number };
        };
      }>(fixture, { mode: 'execution_posture' });
      expect(posture.summary.fileRecovery?.undoDepth).toBe(1);
      expect(posture.summary.fileRecovery?.redoDepth).toBe(0);

      const recovery = await executeHarnessJson<{
        readonly status: string;
        readonly summary: {
          readonly undoDepth: number;
          readonly redoDepth: number;
          readonly nextUndo?: { readonly path: string; readonly tool: string };
        };
        readonly actions: readonly { readonly recoveryAction: string; readonly available: boolean; readonly modelRoute: string }[];
      }>(fixture, { mode: 'file_recovery', includeParameters: true });
      expect(recovery.status).toBe('available');
      expect(recovery.summary.undoDepth).toBe(1);
      expect(recovery.summary.redoDepth).toBe(0);
      expect(recovery.summary.nextUndo).toMatchObject({ path: 'recoverable.txt', tool: 'edit' });
      expect(recovery.actions.find((action) => action.recoveryAction === 'undo')?.available).toBe(true);
      expect(recovery.actions.find((action) => action.recoveryAction === 'undo')?.modelRoute).toBe('agent_harness mode:"run_file_recovery"');

      const denied = await fixture.tool.execute({ mode: 'run_file_recovery', recoveryAction: 'undo' });
      expect(denied.success).toBe(false);
      if (denied.success) throw new Error('run_file_recovery unexpectedly succeeded without confirmation');
      expect(denied.error).toContain('explicitUserRequest');

      const undo = await executeHarnessJson<{
        readonly status: string;
        readonly recoveryAction: string;
        readonly path: string;
        readonly tool: string;
        readonly summary: { readonly undoDepth: number; readonly redoDepth: number };
      }>(fixture, {
        mode: 'run_file_recovery',
        recoveryAction: 'undo',
        confirm: true,
        explicitUserRequest: 'Undo the last local file edit.',
      });
      expect(undo).toMatchObject({
        status: 'applied',
        recoveryAction: 'undo',
        path: 'recoverable.txt',
        tool: 'edit',
      });
      expect(readFileSync(target, 'utf-8')).toBe('before content');
      expect(undo.summary.undoDepth).toBe(0);
      expect(undo.summary.redoDepth).toBe(1);

      const redo = await executeHarnessJson<{
        readonly status: string;
        readonly recoveryAction: string;
        readonly path: string;
      }>(fixture, {
        mode: 'run_file_recovery',
        recoveryAction: 'redo',
        confirm: true,
        explicitUserRequest: 'Redo the last local file edit.',
      });
      expect(redo).toMatchObject({ status: 'applied', recoveryAction: 'redo', path: 'recoverable.txt' });
      expect(readFileSync(target, 'utf-8')).toBe('after content');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes a read-only learning curator with ranked local review routes', async () => {
    const fixture = makeFixture();
    try {
      const memoryRegistry = await createMemoryRegistry(fixture.paths, fixture.configManager);
      (fixture.context.clients as Record<string, unknown>).agentKnowledgeApi = { memory: memoryRegistry };
      const memory = await memoryRegistry.add({
        cls: 'fact',
        summary: 'Use the private deployment checklist before release.',
        detail: 'Checklist is useful but still needs review.',
        tags: ['release'],
        review: { state: 'fresh', confidence: 42 },
        provenance: [{ kind: 'event', ref: 'test-learning-curator' }],
      });
      await memoryRegistry.add({
        cls: 'fact',
        summary: 'Use the private deployment checklist before release.',
        detail: 'Duplicate copy adds UX inventory and package verification context.',
        tags: ['release', 'ux-inventory'],
        review: { state: 'fresh', confidence: 84 },
        provenance: [{ kind: 'event', ref: 'test-learning-curator-duplicate' }],
      });
      const noteRegistry = AgentNoteRegistry.fromShellPaths(fixture.paths);
      const sourceNote = noteRegistry.create({
        title: 'Reviewed source note',
        body: 'Durable source note for later knowledge ingest.',
        sourceUrl: 'https://example.test/research',
        tags: ['research'],
        source: 'agent',
      });
      noteRegistry.markReviewed(sourceNote.id);
      const workflowNote = noteRegistry.create({
        title: 'Release checklist workflow',
        body: 'Repeat before release: check package verification, review UX inventory, and summarize residual risks.',
        tags: ['workflow', 'learned'],
        source: 'agent',
      });
      noteRegistry.markReviewed(workflowNote.id);
      const decisionNote = noteRegistry.create({
        title: 'Renderer decision memory',
        body: 'Decision: keep the existing renderer as the Agent UI foundation.',
        tags: ['decision', 'memory'],
        source: 'agent',
      });
      noteRegistry.markReviewed(decisionNote.id);
      const completedWork = fixture.context.workspace.workPlanStore!.addItem('Release readiness workflow', {
        status: 'done',
        owner: 'agent',
        source: 'test-learning-curator',
        notes: 'Repeat before release: run package verification, check UX inventory, and summarize residual risks.',
      });
      const completedDecision = fixture.context.workspace.workPlanStore!.addItem('Renderer decision capture', {
        status: 'done',
        owner: 'agent',
        source: 'test-learning-curator',
        notes: 'Decision: use the existing renderer for the autonomous Agent harness.',
      });
      const researchRunRegistry = AgentResearchRunRegistry.fromShellPaths(fixture.paths);
      const researchRun = researchRunRegistry.create({
        title: 'Research report procedure',
        question: 'How should deep research reports stay sourced and reviewable?',
        goal: 'Define a reusable research report procedure.',
        plan: ['Review source credibility', 'Track citation coverage', 'Save report artifact'],
        provenance: 'test-learning-curator',
      });
      researchRunRegistry.start(researchRun.id, 'Started source review.');
      researchRunRegistry.checkpoint(researchRun.id, {
        phase: 'synthesizing',
        progress: 80,
        note: 'Procedure: check citation coverage before saving the report.',
        sourceIds: ['source-alpha'],
        nextSteps: ['Save report artifact'],
      });
      const completedResearch = researchRunRegistry.complete(researchRun.id, {
        note: 'Procedure: review source credibility, citation coverage, and report artifact before closing deep research.',
        reportArtifactId: 'artifact-research-1',
        sourceIds: ['source-alpha'],
      });
      const savedLearningSession = {
        name: 'session-release-review',
        title: 'Release review lesson session',
        model: 'gpt-4.1',
        provider: 'openai',
        timestamp: Date.now(),
        messageCount: 6,
        filePath: fixture.paths.resolveUserPath('sessions', 'session-release-review.json'),
      };
      (fixture.context.session as unknown as Record<string, unknown>).sessionManager = {
        list: () => [savedLearningSession],
        search: (query: string) => [savedLearningSession]
          .filter((session) => [session.name, session.title].join('\n').toLowerCase().includes(query.toLowerCase()))
          .map((session) => ({ session, matchCount: 1, snippets: ['Lesson: validate release evidence before closing.'] })),
        load: (name: string) => {
          if (name !== savedLearningSession.name) throw new Error(`Unknown session ${name}`);
          return {
            meta: { title: savedLearningSession.title },
            messages: [
              { role: 'user', content: 'Prepare the release review.' },
              { role: 'assistant', content: 'Lesson: when asked to prepare release review, run typecheck, package verification, UX inventory, and summarize residual risks.' },
            ],
          };
        },
      };
      const personaRegistry = AgentPersonaRegistry.fromShellPaths(fixture.paths);
      const persona = personaRegistry.create({
        name: 'Fresh operator persona',
        description: 'Fresh active behavior.',
        body: 'Prefer concise operational answers.',
        source: 'agent',
      });
      personaRegistry.setActive(persona.id);
      const skillRegistry = AgentSkillRegistry.fromShellPaths(fixture.paths);
      skillRegistry.create({
        name: 'Missing command skill',
        description: 'Needs an unavailable command before use.',
        procedure: 'Run the missing command and summarize results.',
        requirements: [{ kind: 'command', name: 'definitely-missing-goodvibes-agent-test-command' }],
        enabled: true,
        source: 'agent',
      });
      skillRegistry.create({
        name: 'Missing command skill!',
        description: 'Duplicate skill adds package verification and UX inventory notes.',
        procedure: 'Run package verification, check UX inventory, then summarize results.',
        triggers: ['release'],
        tags: ['release', 'verification'],
        source: 'agent',
      });

      const summary = await executeHarnessJson<{
        readonly learningCurator?: { readonly candidates: number; readonly needsReview: number; readonly needsSetup: number; readonly needsConsolidation: number; readonly lowConfidence: number; readonly proposedBehavior: number; readonly readOnly: boolean };
      }>(fixture, { mode: 'summary' });
      expect(summary.learningCurator?.candidates).toBeGreaterThan(3);
      expect(summary.learningCurator?.needsReview).toBeGreaterThan(0);
      expect(summary.learningCurator?.needsSetup).toBeGreaterThan(0);
      expect(summary.learningCurator?.needsConsolidation).toBeGreaterThan(0);
      expect(summary.learningCurator?.lowConfidence).toBeGreaterThan(0);
      expect(summary.learningCurator?.proposedBehavior).toBeGreaterThan(5);
      expect(summary.learningCurator?.readOnly).toBe(true);

      const curator = await executeHarnessJson<{
        readonly summary: { readonly candidates: number; readonly needsReview: number; readonly needsSetup: number; readonly needsConsolidation: number; readonly lowConfidence: number; readonly proposedBehavior: number; readonly readyToPromote: number };
        readonly consolidationBatch?: {
          readonly status: string;
          readonly candidates: number;
          readonly duplicateRecords: number;
          readonly domains: readonly { readonly domain: string; readonly candidates: number; readonly duplicateRecords: number }[];
          readonly routes: { readonly reviewQueue: string; readonly candidateDetail: string; readonly survivorRecord: string };
          readonly phases: readonly { readonly id: string; readonly route: string }[];
          readonly topCandidates: readonly {
            readonly candidateId: string;
            readonly survivorId: string;
            readonly duplicateIds?: readonly string[];
            readonly diffFields: readonly string[];
            readonly detailRoute: string;
            readonly updateRoute?: string;
            readonly staleRoutes?: readonly string[];
            readonly deleteRoutes?: readonly string[];
            readonly rollbackRoutes?: readonly string[];
          }[];
          readonly policy: string;
        };
        readonly candidates: readonly {
          readonly candidateId: string;
          readonly label: string;
          readonly domain: string;
          readonly status: string;
          readonly proposalTarget?: string;
          readonly proposalFields?: Record<string, string>;
          readonly priority: number;
          readonly scores: { readonly usefulness: number; readonly freshness: number; readonly sourceQuality: number; readonly risk: number };
          readonly inspectRoute: string;
          readonly reviewRoute?: string;
          readonly updateRoute?: string;
          readonly createRoute?: string;
          readonly cleanupRoutes?: readonly string[];
          readonly rollbackRoutes?: readonly string[];
          readonly consolidation?: {
            readonly survivorId: string;
            readonly duplicateIds: readonly string[];
            readonly diffs: readonly { readonly field: string; readonly survivor: string; readonly merged: string }[];
          };
        }[];
        readonly policy: string;
      }>(fixture, { mode: 'learning_curator', includeParameters: true });
      expect(curator.summary.candidates).toBeGreaterThan(3);
      expect(curator.summary.readyToPromote).toBeGreaterThan(0);
      expect(curator.summary.proposedBehavior).toBeGreaterThan(5);
      expect(curator.summary.needsConsolidation).toBeGreaterThan(0);
      expect(curator.policy).toContain('duplicate consolidation');
      expect(curator.consolidationBatch?.status).toBe('ready');
      expect(curator.consolidationBatch?.candidates).toBeGreaterThan(0);
      expect(curator.consolidationBatch?.duplicateRecords).toBeGreaterThan(0);
      expect(curator.consolidationBatch?.domains.some((domain) => domain.domain === 'skill')).toBe(true);
      expect(curator.consolidationBatch?.routes.reviewQueue).toContain('query:"consolidation"');
      expect(curator.consolidationBatch?.routes.candidateDetail).toContain('learning_candidate');
      expect(curator.consolidationBatch?.phases.map((phase) => phase.id)).toEqual([
        'inspect',
        'merge-survivor',
        'stale-duplicates',
        'verify',
        'delete-after-approval',
      ]);
      expect(curator.consolidationBatch?.topCandidates.some((candidate) => candidate.candidateId.includes('consolidation:skill'))).toBe(true);
      expect(curator.consolidationBatch?.topCandidates.some((candidate) => candidate.updateRoute?.includes('action:"update"'))).toBe(true);
      expect(curator.consolidationBatch?.topCandidates.some((candidate) => candidate.staleRoutes?.join('\n').includes('action:"stale"'))).toBe(true);
      expect(curator.consolidationBatch?.topCandidates.some((candidate) => candidate.deleteRoutes?.join('\n').includes('confirm:true'))).toBe(true);
      expect(curator.consolidationBatch?.topCandidates.some((candidate) => candidate.rollbackRoutes?.join('\n').includes('rollback-learning-curator-consolidation'))).toBe(true);
      expect(curator.consolidationBatch?.policy).toContain('no hidden batch mutation');
      expectRowsHaveCompactModelRoutes(curator.candidates);
      const memoryCandidate = curator.candidates.find((candidate) => candidate.candidateId === `memory:${memory.id}:low-confidence`);
      const personaCandidate = curator.candidates.find((candidate) => candidate.domain === 'persona' && candidate.status === 'needs-review');
      const setupCandidate = curator.candidates.find((candidate) => candidate.domain === 'skill' && candidate.status === 'needs-setup');
      const promoteCandidate = curator.candidates.find((candidate) => candidate.candidateId === `note-promote:${sourceNote.id}`);
      const proposalCandidate = curator.candidates.find((candidate) => candidate.candidateId === `note-proposal:routine:${workflowNote.id}`);
      const memoryNoteCandidate = curator.candidates.find((candidate) => candidate.candidateId === `note-proposal:memory:${decisionNote.id}`);
      const completedCandidate = curator.candidates.find((candidate) => candidate.candidateId === `work-plan-proposal:routine:${completedWork.id}`);
      const completedMemoryCandidate = curator.candidates.find((candidate) => candidate.candidateId === `work-plan-proposal:memory:${completedDecision.id}`);
      const researchCandidate = curator.candidates.find((candidate) => candidate.candidateId === `research-run-proposal:skill:${completedResearch.id}`);
      const sessionCandidate = curator.candidates.find((candidate) => candidate.candidateId === `session-proposal:skill:${savedLearningSession.name}`);
      const consolidationCandidate = curator.candidates.find((candidate) => candidate.status === 'needs-consolidation' && candidate.domain === 'skill');
      expect(memoryCandidate?.reviewRoute).toContain('agent_local_registry');
      expect(memoryCandidate?.scores.risk).toBeGreaterThan(0);
      expect(personaCandidate?.label).toContain('Fresh operator persona');
      expect(setupCandidate?.inspectRoute).toContain('domain:"skill"');
      expect(promoteCandidate?.createRoute).toContain('notes-to-knowledge');
      expect(proposalCandidate?.proposalTarget).toBe('routine');
      expect(proposalCandidate?.createRoute).toContain('notes-to-routine');
      expect(memoryNoteCandidate?.proposalTarget).toBe('memory');
      expect(memoryNoteCandidate?.createRoute).toContain('notes-to-memory');
      expect(completedCandidate?.domain).toBe('work_plan');
      expect(completedCandidate?.inspectRoute).toContain('agent_work_plan');
      expect(completedCandidate?.createRoute).toContain('learned-behavior');
      expect(completedCandidate?.proposalTarget).toBe('routine');
      expect(completedCandidate?.proposalFields?.target).toBe('routine');
      expect(completedCandidate?.proposalFields?.notes).toContain('Release readiness workflow');
      expect(completedMemoryCandidate?.proposalTarget).toBe('memory');
      expect(completedMemoryCandidate?.createRoute).toContain('memory-create');
      expect(completedMemoryCandidate?.proposalFields?.cls).toBe('decision');
      expect(completedMemoryCandidate?.proposalFields?.detail).toContain('existing renderer');
      expect(researchCandidate?.domain).toBe('research_run');
      expect(researchCandidate?.inspectRoute).toContain('mode:"research_run"');
      expect(researchCandidate?.createRoute).toContain('learned-behavior');
      expect(researchCandidate?.proposalTarget).toBe('skill');
      expect(researchCandidate?.proposalFields?.notes).toContain('artifact-research-1');
      expect(sessionCandidate?.domain).toBe('session');
      expect(sessionCandidate?.inspectRoute).toContain('mode:"session"');
      expect(sessionCandidate?.createRoute).toContain('learned-behavior');
      expect(sessionCandidate?.proposalTarget).toBe('skill');
      expect(sessionCandidate?.proposalFields?.notes).toContain('typecheck');
      expect(consolidationCandidate?.candidateId).toContain('consolidation:skill');
      expect(consolidationCandidate?.updateRoute).toContain('action:"update"');
      expect(consolidationCandidate?.cleanupRoutes?.join('\n')).toContain('action:"stale"');
      expect(consolidationCandidate?.rollbackRoutes?.join('\n')).toContain('action:"review"');
      expect(consolidationCandidate?.consolidation?.duplicateIds.length).toBeGreaterThan(0);
      expect(consolidationCandidate?.consolidation?.diffs.some((diff) => diff.field === 'description')).toBe(true);

      const candidate = await executeHarnessJson<{
        readonly candidateId: string;
        readonly routes?: { readonly inspect: string; readonly review: string | null };
      }>(fixture, { mode: 'learning_candidate', candidateId: `memory:${memory.id}:low-confidence` });
      expect(candidate.candidateId).toBe(`memory:${memory.id}:low-confidence`);
      expect(candidate.routes?.review).toContain('action:"review"');

      const consolidationDetail = await executeHarnessJson<{
        readonly candidateId: string;
        readonly status: string;
        readonly routes?: { readonly update: string | null; readonly stale: string | null; readonly delete: string | null };
        readonly cleanupRoutes?: readonly string[];
        readonly rollbackRoutes?: readonly string[];
      }>(fixture, { mode: 'learning_candidate', candidateId: consolidationCandidate?.candidateId });
      expect(consolidationDetail.status).toBe('needs-consolidation');
      expect(consolidationDetail.routes?.update).toContain('action:"update"');
      expect(consolidationDetail.routes?.stale).toContain('action:"stale"');
      expect(consolidationDetail.routes?.delete).toContain('confirm:true');
      expect(consolidationDetail.cleanupRoutes?.join('\n')).toContain('Duplicate of');
      expect(consolidationDetail.rollbackRoutes?.join('\n')).toContain('rollback-learning-curator-consolidation');

      const action = await executeHarnessJson<{
        readonly id: string;
        readonly modelRoute?: string;
      }>(fixture, { mode: 'workspace_action', actionId: 'memory-learning-curator' });
      expect(action.id).toBe('memory-learning-curator');
      expect(action.modelRoute).toBe('agent_harness mode:"learning_curator"');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes a read-only research source queue with report handoff routes', async () => {
    const fixture = makeFixture();
    try {
      const registry = AgentResearchSourceRegistry.fromShellPaths(fixture.paths);
      const candidate = registry.create({
        question: 'Which local model route should we try first?',
        title: 'Ollama setup docs',
        url: 'https://example.test/ollama?token=secret-token',
        publisher: 'Ollama',
        summary: 'Official setup docs for a simple local model route.',
        evidence: 'Setup flow is simple and local.',
        tags: ['local-models'],
        provenance: 'test-research-queue',
      });
      const reviewed = registry.review(candidate.id, {
        credibility: 'high',
        score: 91,
        note: 'Official source; useful for report citation.',
      });

      const summary = await executeHarnessJson<{
        readonly researchQueue?: { readonly sources: number; readonly reviewed: number; readonly readOnly: boolean };
      }>(fixture, { mode: 'summary' });
      expect(summary.researchQueue?.sources).toBe(1);
      expect(summary.researchQueue?.reviewed).toBe(1);
      expect(summary.researchQueue?.readOnly).toBe(true);

      const queue = await executeHarnessJson<{
        readonly summary: { readonly sources: number; readonly reviewed: number; readonly candidates: number };
        readonly bundle?: { readonly sources: number; readonly route: string; readonly reportRoute: string };
        readonly sources: readonly {
          readonly sourceId: string;
          readonly status: string;
          readonly credibility: string;
          readonly score: number;
          readonly modelRoute: string;
          readonly bundleRoute?: string;
          readonly reportRoute?: string;
          readonly ingestRoute?: string;
          readonly reportSourceLine: string;
          readonly url?: string;
        }[];
        readonly policy: string;
      }>(fixture, { mode: 'research_queue', includeParameters: true });
      expect(queue.summary.sources).toBe(1);
      expect(queue.summary.reviewed).toBe(1);
      expect(queue.summary.candidates).toBe(0);
      expect(queue.policy).toContain('Research queue is read-only');
      expect(queue.bundle?.sources).toBe(1);
      expect(queue.bundle?.route).toContain('agent_research_sources mode:bundle');
      expect(queue.bundle?.reportRoute).toContain('requireCitationCoverage:true');
      expectRowsHaveCompactModelRoutes(queue.sources);
      expect(queue.sources[0]?.sourceId).toBe(reviewed.id);
      expect(queue.sources[0]?.status).toBe('reviewed');
      expect(queue.sources[0]?.credibility).toBe('high');
      expect(queue.sources[0]?.score).toBe(91);
      expect(queue.sources[0]?.bundleRoute).toContain('mode:bundle');
      expect(queue.sources[0]?.reportRoute).toContain('research-save-report');
      expect(queue.sources[0]?.ingestRoute).toContain('agent_knowledge_ingest');
      expect(queue.sources[0]?.reportSourceLine).toContain('Ollama setup docs');
      expect(queue.sources[0]?.url).toContain('token=%3Credacted%3E');
      expect(queue.sources[0]?.url).not.toContain('secret-token');

      const source = await executeHarnessJson<{
        readonly sourceId: string;
        readonly bundleRoute?: string;
        readonly reportSourceLine: string;
        readonly policy?: string;
      }>(fixture, { mode: 'research_source', sourceId: reviewed.id });
      expect(source.sourceId).toBe(reviewed.id);
      expect(source.bundleRoute).toContain('mode:bundle');
      expect(source.reportSourceLine).toContain('high');
      expect(source.policy).toContain('Research queue rows are local project state only');

      const action = await executeHarnessJson<{
        readonly id: string;
        readonly modelRoute?: string;
      }>(fixture, { mode: 'workspace_action', actionId: 'research-source-queue' });
      expect(action.id).toBe('research-source-queue');
      expect(action.modelRoute).toBe('agent_harness mode:"research_queue"');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes a read-only research run queue with checkpoint and cancel routes', async () => {
    const fixture = makeFixture();
    try {
      const registry = AgentResearchRunRegistry.fromShellPaths(fixture.paths);
      const run = registry.create({
        title: 'Competitor deep research',
        question: 'Which competitor features should GoodVibes Agent match?',
        goal: 'Produce a sourced parity and better-than-parity plan.',
        plan: ['Inventory competitors', 'Review GoodVibes capabilities'],
        nextSteps: ['Collect official sources'],
      });
      const started = registry.start(run.id, 'Starting source collection.');
      const checkpointed = registry.checkpoint(started.id, {
        phase: 'reading',
        progress: 40,
        note: 'Read official docs and captured source ids.',
        nextSteps: ['Draft findings'],
        sourceIds: ['official-docs'],
      });

      const summary = await executeHarnessJson<{
        readonly researchRuns?: { readonly runs: number; readonly running: number; readonly readOnly: boolean };
      }>(fixture, { mode: 'summary' });
      expect(summary.researchRuns?.runs).toBe(1);
      expect(summary.researchRuns?.running).toBe(1);
      expect(summary.researchRuns?.readOnly).toBe(true);

      const queue = await executeHarnessJson<{
        readonly summary: { readonly runs: number; readonly running: number; readonly cancellable: number };
        readonly runs: readonly {
          readonly runId: string;
          readonly status: string;
          readonly phase: string;
          readonly progress: number;
          readonly modelRoute: string;
          readonly checkpointRoute?: string;
          readonly cancelRoute?: string;
          readonly completeRoute?: string;
          readonly logTail: readonly string[];
          readonly runLine: string;
        }[];
        readonly runnerPosture: {
          readonly browserBackedResearch: {
            readonly status: string;
            readonly configured: boolean;
            readonly recommendedRoute: string;
            readonly fallbackRoutes: readonly string[];
            readonly workflows: readonly { readonly id: string; readonly status: string; readonly inspectRoute: string }[];
          };
          readonly sourceQueueRoute: string;
          readonly reportRoute: string;
          readonly policy: string;
        };
        readonly policy: string;
      }>(fixture, { mode: 'research_runs', includeParameters: true });
      expect(queue.summary.runs).toBe(1);
      expect(queue.summary.running).toBe(1);
      expect(queue.summary.cancellable).toBe(1);
      expect(queue.policy).toContain('Research runs are read-only');
      expectRowsHaveCompactModelRoutes(queue.runs);
      expect(queue.runs[0]?.runId).toBe(checkpointed.id);
      expect(queue.runs[0]?.status).toBe('running');
      expect(queue.runs[0]?.phase).toBe('reading');
      expect(queue.runs[0]?.progress).toBe(40);
      expect(queue.runs[0]?.checkpointRoute).toContain('agent_research_runs checkpoint');
      expect(queue.runs[0]?.cancelRoute).toContain('agent_research_runs cancel');
      expect(queue.runs[0]?.completeRoute).toContain('agent_research_runs complete');
      expect(queue.runs[0]?.logTail.join('\n')).toContain('Read official docs and captured source ids.');
      expect(queue.runs[0]?.runLine).toContain('Competitor deep research');
      expect(queue.runnerPosture.browserBackedResearch.status).toBe('setup-needed');
      expect(queue.runnerPosture.browserBackedResearch.configured).toBe(false);
      expect(queue.runnerPosture.browserBackedResearch.recommendedRoute).toContain('mcp_servers');
      expect(queue.runnerPosture.browserBackedResearch.fallbackRoutes.join('\n')).toContain('web-fetch-research');
      expect(queue.runnerPosture.browserBackedResearch.workflows[0]?.id).toBe('browser-navigation');
      expect(queue.runnerPosture.browserBackedResearch.workflows[0]?.inspectRoute).toContain('setup_item');
      expect(queue.runnerPosture.sourceQueueRoute).toBe('agent_harness mode:"research_queue"');
      expect(queue.runnerPosture.reportRoute).toContain('agent_research_report');
      expect(queue.runnerPosture.policy).toContain('browser-backed research');

      const detail = await executeHarnessJson<{
        readonly runId: string;
        readonly sourceIds: readonly string[];
        readonly checkpoints: readonly unknown[];
        readonly logTail: readonly string[];
        readonly policy?: string;
      }>(fixture, { mode: 'research_run', runId: checkpointed.id });
      expect(detail.runId).toBe(checkpointed.id);
      expect(detail.sourceIds).toEqual(['official-docs']);
      expect(detail.checkpoints).toHaveLength(1);
      expect(detail.logTail.join('\n')).toContain('Read official docs and captured source ids.');
      expect(detail.policy).toContain('Research run rows are local visible state only');

      const action = await executeHarnessJson<{
        readonly id: string;
        readonly modelRoute?: string;
      }>(fixture, { mode: 'workspace_action', actionId: 'research-run-queue' });
      expect(action.id).toBe('research-run-queue');
      expect(action.modelRoute).toBe('agent_harness mode:"research_runs"');
    } finally {
      fixture.cleanup();
    }
  });

  test('plans a read-only deep research workflow across run, source, report, and Knowledge routes', async () => {
    const fixture = makeFixture();
    try {
      const runRegistry = AgentResearchRunRegistry.fromShellPaths(fixture.paths);
      const sourceRegistry = AgentResearchSourceRegistry.fromShellPaths(fixture.paths);
      const run = runRegistry.create({
        title: 'Browser control research',
        question: 'How should GoodVibes Agent expose browser-backed research?',
        goal: 'Produce a sourced implementation plan.',
        plan: ['Collect current public sources', 'Review source credibility', 'Save a sourced report'],
        nextSteps: ['Find official browser-control docs'],
      });
      const started = runRegistry.start(run.id, 'Starting public source collection.');
      const candidate = sourceRegistry.create({
        question: started.question,
        title: 'Browser automation docs',
        url: 'https://example.test/browser-automation',
        publisher: 'Example Docs',
        summary: 'Browser automation setup and safety guidance.',
        tags: ['browser', 'research'],
        provenance: 'test-research-workflow',
      });
      const reviewed = sourceRegistry.review(candidate.id, {
        credibility: 'high',
        score: 88,
        note: 'Official-style source useful for report citation.',
      });

      const workflow = await executeHarnessJson<{
        readonly status: string;
        readonly question: string;
        readonly run?: { readonly runId: string; readonly checkpointRoute: string; readonly completeRoute: string };
        readonly sourcePosture: {
          readonly reviewed: number;
          readonly bundleRoute: string;
          readonly reportReadySources: readonly { readonly sourceId: string; readonly reportLine: string }[];
        };
        readonly browserBackedResearch: { readonly status: string; readonly fallbackRoutes: readonly string[] };
        readonly workflow: readonly { readonly id: string; readonly status: string; readonly route: string; readonly reportRoute?: string }[];
        readonly routes: { readonly saveReport: string; readonly completeRun?: string };
        readonly policy: string;
      }>(fixture, { mode: 'research_workflow', runId: started.id, includeParameters: true });
      expect(workflow.status).toBe('ready-to-report');
      expect(workflow.question).toContain('browser-backed research');
      expect(workflow.run?.runId).toBe(started.id);
      expect(workflow.run?.checkpointRoute).toContain('agent_research_runs mode:checkpoint');
      expect(workflow.run?.completeRoute).toContain('agent_research_runs mode:complete');
      expect(workflow.sourcePosture.reviewed).toBe(1);
      expect(workflow.sourcePosture.bundleRoute).toContain('agent_research_sources mode:bundle');
      expect(workflow.sourcePosture.reportReadySources[0]?.sourceId).toBe(reviewed.id);
      expect(workflow.sourcePosture.reportReadySources[0]?.reportLine).toContain('Browser automation docs');
      expect(workflow.browserBackedResearch.status).toBe('setup-needed');
      expect(workflow.browserBackedResearch.fallbackRoutes.join('\n')).toContain('web-fetch-research');
      expect(workflow.workflow.map((step) => step.id)).toEqual(['visible-run', 'collect-sources', 'review-sources', 'save-report', 'promote-knowledge']);
      expect(workflow.workflow.find((step) => step.id === 'save-report')?.status).toBe('ready');
      expect(workflow.workflow.find((step) => step.id === 'save-report')?.reportRoute).toContain('agent_research_report');
      expect(workflow.routes.saveReport).toContain('requireCitationCoverage:true');
      expect(workflow.routes.completeRun).toContain(started.id);
      expect(workflow.policy).toContain('read-only workflow plan');

      const fresh = await executeHarnessJson<{
        readonly status: string;
        readonly workflow: readonly { readonly id: string; readonly status: string; readonly route: string }[];
        readonly routes: { readonly createRun: string };
      }>(fixture, { mode: 'research_workflow', query: 'new competitor research request' });
      expect(fresh.status).toBe('needs-visible-run');
      expect(fresh.workflow.find((step) => step.id === 'visible-run')?.status).toBe('needed');
      expect(fresh.workflow.find((step) => step.id === 'visible-run')?.route).toContain('agent_research_runs mode:create');
      expect(fresh.routes.createRun).toContain('new competitor research request');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes Document Ops readiness with an honest blind comparison runner', async () => {
    const artifacts = createHarnessArtifactStore();
    const fixture = makeFixture({ artifactStore: artifacts.store });
    try {
      registerStubTool(fixture.toolRegistry, 'agent_documents');
      fixture.toolRegistry.register(createAgentArtifactsTool(artifacts.store));
      registerStubTool(fixture.toolRegistry, 'agent_knowledge_ingest');
      registerStubTool(fixture.toolRegistry, 'agent_model_compare');
      const summary = await executeHarnessJson<{
        readonly documentOps?: { readonly lanes: number; readonly ready: number; readonly partial: number; readonly gap: number };
      }>(fixture, { mode: 'summary' });
      expect(summary.documentOps?.lanes).toBe(7);
      expect(summary.documentOps?.ready).toBeGreaterThanOrEqual(2);
      expect(summary.documentOps?.partial).toBeGreaterThanOrEqual(1);
      expect(summary.documentOps?.gap).toBe(0);

      const ops = await executeHarnessJson<{
        readonly lanes: readonly {
          readonly id: string;
          readonly status: string;
          readonly current: string;
          readonly actionIds?: readonly string[];
        }[];
        readonly policy: string;
        readonly nextActions: readonly string[];
      }>(fixture, { mode: 'document_ops', includeParameters: true });
      expect(ops.policy).toContain('model comparison');
      expect(ops.policy).toContain('AI suggestion review');
      expect(ops.nextActions.join('\n')).not.toContain('AI suggestion review');

      const documents = ops.lanes.find((lane) => lane.id === 'documents');
      const uploads = ops.lanes.find((lane) => lane.id === 'uploads');
      const exports = ops.lanes.find((lane) => lane.id === 'exports');
      const sourceLibrary = ops.lanes.find((lane) => lane.id === 'source_library');
      const artifactBrowser = ops.lanes.find((lane) => lane.id === 'artifact_browser');
      const modelCompare = ops.lanes.find((lane) => lane.id === 'model_compare');
      expect(documents?.status).toBe('ready');
      expect(documents?.current).toContain('version history');
      expect(documents?.actionIds).toContain('document-create-draft');
      expect(documents?.actionIds).toContain('document-revise-draft');
      expect(documents?.actionIds).toContain('document-comment-draft');
      expect(documents?.actionIds).toContain('document-resolve-comment');
      expect(documents?.actionIds).toContain('document-suggest-draft');
      expect(documents?.actionIds).toContain('document-accept-suggestion');
      expect(documents?.actionIds).toContain('document-reject-suggestion');
      expect(documents?.actionIds).toContain('document-insert-artifact');
      expect(documents?.actionIds).toContain('document-attach-artifact');
      expect(documents?.actionIds).toContain('document-export-draft');
      expect(exports?.actionIds).toContain('document-export-artifact-file');
      expect(exports?.actionIds).toContain('document-export-artifact-package');
      expect(exports?.actionIds).toContain('artifact-export-file');
      expect(exports?.actionIds).toContain('artifact-export-package');
      expect(uploads?.status).toBe('ready');
      expect(uploads?.actionIds).toContain('document-ingest-file');
      expect(exports?.status).toBe('ready');
      expect(exports?.actionIds).toContain('document-export-conversation');
      expect(sourceLibrary?.status).toBe('ready');
      expect(artifactBrowser?.status).toBe('ready');
      expect(artifactBrowser?.current).toContain('unified artifact browser');
      expect(artifactBrowser?.current).toContain('artifact export-to-file');
      expect(artifactBrowser?.current).toContain('multi-artifact package export');
      expect(artifactBrowser?.current).toContain('artifact-to-Knowledge promotion');
      expect(artifactBrowser?.actionIds).toContain('artifact-browse');
      expect(artifactBrowser?.actionIds).toContain('artifact-show');
      expect(artifactBrowser?.actionIds).toContain('artifact-export-file');
      expect(artifactBrowser?.actionIds).toContain('artifact-export-package');
      expect(artifactBrowser?.actionIds).toContain('artifact-promote-knowledge');
      expect(artifactBrowser?.actionIds).toContain('artifact-insert-document');
      expect(artifactBrowser?.actionIds).toContain('artifact-attach-document');
      expect(artifactBrowser?.actionIds).toContain('document-promote-artifact');
      expect(modelCompare?.status).toBe('partial');
      expect(modelCompare?.current).toContain('confirmed blind comparison runner');
      expect(modelCompare?.actionIds).toContain('document-run-compare');
      expect(modelCompare?.actionIds).toContain('document-review-compare');
      expect(modelCompare?.actionIds).toContain('document-judge-compare');
      expect(modelCompare?.actionIds).toContain('document-compare-analytics');
      expect(modelCompare?.actionIds).toContain('document-apply-compare');
      expect(modelCompare?.actionIds).toContain('document-export-compare');

      const artifactLane = await executeHarnessJson<{
        readonly id: string;
        readonly status: string;
        readonly routes?: { readonly model: string };
      }>(fixture, { mode: 'document_ops_lane', laneId: 'artifact_browser' });
      expect(artifactLane.id).toBe('artifact_browser');
      expect(artifactLane.status).toBe('ready');
      expect(artifactLane.routes?.model).toBe('agent_artifacts + agent_knowledge_ingest');

      const lane = await executeHarnessJson<{
        readonly id: string;
        readonly status: string;
        readonly routes?: { readonly model: string };
      }>(fixture, { mode: 'document_ops_lane', laneId: 'model_compare' });
      expect(lane.id).toBe('model_compare');
      expect(lane.status).toBe('partial');
      expect(lane.routes?.model).toBe('agent_model_compare');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes compact model routes across product posture catalogs', async () => {
    const fixture = makeFixture();
    try {
      fixture.configManager.setDynamic('notifications.webhookUrls', ['https://example.test/hooks/alpha?token=secret']);

      const channels = await executeHarnessJson<{
        readonly channels: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'channels', limit: 3 });
      expectRowsHaveCompactModelRoutes(channels.channels);

      const notifications = await executeHarnessJson<{
        readonly targets: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'notifications' });
      expectRowsHaveCompactModelRoutes(notifications.targets);
      expect(notifications.targets[0]?.value).toBe('<redacted>');

      const providerAccounts = await executeHarnessJson<{
        readonly providers: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'provider_accounts', query: 'openai', limit: 5 });
      expectRowsHaveCompactModelRoutes(providerAccounts.providers);

      const mcpServers = await executeHarnessJson<{
        readonly servers: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'mcp_servers' });
      expectRowsHaveCompactModelRoutes(mcpServers.servers);

      const modelRouting = await executeHarnessJson<{
        readonly routes: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'model_routing', limit: 5 });
      expectRowsHaveCompactModelRoutes(modelRouting.routes);
      expect(modelRouting.routes.filter((route) => route.commands !== undefined || route.uiSurfaces !== undefined)).toEqual([]);

      const execution = await executeHarnessJson<{
        readonly routes: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'execution_posture' });
      expectRowsHaveCompactModelRoutes(execution.routes);

      const fileRecovery = await executeHarnessJson<{
        readonly actions: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'file_recovery' });
      expectRowsHaveCompactModelRoutes(fileRecovery.actions);

      const pairing = await executeHarnessJson<{
        readonly routes: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'pairing_posture' });
      expectRowsHaveCompactModelRoutes(pairing.routes);
      expect(pairing.routes.filter((route) => route.harnessRoute !== undefined)).toEqual([]);

      const delegation = await executeHarnessJson<{
        readonly routes: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'delegation_posture' });
      expectRowsHaveCompactModelRoutes(delegation.routes);
      expect(delegation.routes.filter((route) => route.commandTemplate !== undefined)).toEqual([]);

      const expandedDelegation = await executeHarnessJson<{
        readonly summary: {
          readonly decisionCards: number;
          readonly operatorClientAttached: boolean;
        };
        readonly decisionCards: readonly {
          readonly id: string;
          readonly lane: string;
          readonly status: string;
          readonly supervision: readonly string[];
        }[];
        readonly routes: readonly {
          readonly delegationRouteId: string;
          readonly effect: string;
          readonly lane: string;
          readonly requiredFields: readonly string[];
          readonly statusRoutes: readonly string[];
          readonly recoveryRoutes: readonly string[];
        }[];
      }>(fixture, { mode: 'delegation_posture', includeParameters: true });
      expect(expandedDelegation.summary.decisionCards).toBeGreaterThanOrEqual(5);
      expect(expandedDelegation.summary.operatorClientAttached).toBe(false);
      expect(expandedDelegation.decisionCards.find((card) => card.lane === 'tui-shared-session')?.status).toBe('operator-needed');
      expect(expandedDelegation.decisionCards.find((card) => card.lane === 'remote-runner')?.supervision.join('\n')).toContain('/health remote');
      expect(expandedDelegation.routes.find((route) => route.delegationRouteId === 'delegate-build-task')?.requiredFields.join('\n')).toContain('success criteria');
      expect(expandedDelegation.routes.find((route) => route.delegationRouteId === 'remote-runner-inspection')?.statusRoutes.join('\n')).toContain('/health remote');
      expect(expandedDelegation.routes.find((route) => route.delegationRouteId === 'hidden-local-fanout-blocked')?.effect).toBe('blocked');

      const expandedDelegationRoute = await executeHarnessJson<{
        readonly delegationRouteId: string;
        readonly lane: string;
        readonly requiredFields: readonly string[];
        readonly successEvidence: readonly string[];
        readonly recoveryRoutes: readonly string[];
        readonly modelAccess: { readonly runWorkspaceAction?: string };
      }>(fixture, { mode: 'delegation_route', delegationRouteId: 'delegate-build-task' });
      expect(expandedDelegationRoute.lane).toBe('tui-shared-session');
      expect(expandedDelegationRoute.requiredFields.join('\n')).toContain('delegation reason');
      expect(expandedDelegationRoute.successEvidence.join('\n')).toContain('verification result');
      expect(expandedDelegationRoute.recoveryRoutes.join('\n')).toContain('GoodVibes TUI');
      expect(expandedDelegationRoute.modelAccess.runWorkspaceAction).toContain('delegate-task');

      const security = await executeHarnessJson<{
        readonly findings: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'security_posture' });
      expectRowsHaveCompactModelRoutes(security.findings);

      const bundles = await executeHarnessJson<{
        readonly bundles: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'support_bundles' });
      expectRowsHaveCompactModelRoutes(bundles.bundles);
      expect(bundles.bundles.filter((bundle) => bundle.exportCommand !== undefined || bundle.workspaceActionIds !== undefined)).toEqual([]);

      const media = await executeHarnessJson<{
        readonly providers: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'media_posture' });
      expectRowsHaveCompactModelRoutes(media.providers);

      const sessions = await executeHarnessJson<{
        readonly sessions: readonly Record<string, unknown>[];
        readonly bookmarks: Record<string, unknown>;
      }>(fixture, { mode: 'sessions' });
      expectRowsHaveCompactModelRoutes(sessions.sessions);
      expectCompactModelRoute(sessions.bookmarks.modelRoute);
      expect(sessions.bookmarks.modelRoutes).toBeUndefined();

      const operatorMethods = await executeHarnessJson<{
        readonly methods: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'operator_methods', query: 'schedules.create' });
      expectRowsHaveCompactModelRoutes(operatorMethods.methods);
      expect(operatorMethods.methods[0]?.preferredModelTool).toBeUndefined();

      const service = await executeHarnessJson<{
        readonly modelRoute?: string;
        readonly endpoints: readonly Record<string, unknown>[];
      }>(fixture, { mode: 'service_posture' });
      expectCompactModelRoute(service.modelRoute);
      expectRowsHaveCompactModelRoutes(service.endpoints);

      const expandedMcp = await executeHarnessJson<{
        readonly servers: readonly { readonly modelAccess?: Record<string, unknown> }[];
      }>(fixture, { mode: 'mcp_servers', includeParameters: true });
      expect(expandedMcp.servers[0]?.modelAccess).toMatchObject({
        reviewCommand: '/mcp review',
        serversCommand: '/mcp servers',
        configCommand: '/mcp config',
      });

      const expandedOperatorMethod = await executeHarnessJson<{
        readonly modelRoute?: string;
        readonly preferredModelTool?: string;
      }>(fixture, { mode: 'operator_method', methodId: 'schedules.create' });
      expectCompactModelRoute(expandedOperatorMethod.modelRoute);
      expect(expandedOperatorMethod.preferredModelTool).toContain('agent_operator_method');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes a local model cookbook through model routing and workspace actions', async () => {
    const fixture = makeFixture();
    try {
      const cookbook = await executeHarnessJson<{
        readonly localCookbook: {
          readonly status: string;
          readonly recommendation: string;
          readonly hardwareProfile: {
            readonly ramGb: number;
            readonly cpuThreads: number;
            readonly memoryTier: string;
            readonly acceleratorHint: string;
            readonly privacy: string;
          };
          readonly nextActions: readonly string[];
          readonly readinessRubric?: {
            readonly confidence: string;
            readonly dimensions: readonly { readonly id: string; readonly weight: number }[];
          };
          readonly benchmarkHistory?: {
            readonly status: string;
            readonly count: number;
            readonly saveRoute?: string;
            readonly artifacts?: readonly { readonly artifactId: string; readonly reviewRoute: string }[];
          };
          readonly recipes: readonly {
            readonly id: string;
            readonly fitScore?: number;
            readonly fitLevel?: string;
            readonly readinessScore?: number;
            readonly readinessLevel?: string;
            readonly readiness?: {
              readonly score: number;
              readonly dimensions?: readonly { readonly id: string; readonly score: number; readonly weight: number }[];
              readonly missingSignals?: readonly string[];
              readonly nextStep?: string;
            };
            readonly hardwareMatched?: readonly string[];
            readonly modelRoute?: string;
            readonly setupPlan?: {
              readonly status: string;
              readonly downloadGuidance: readonly string[];
              readonly providerRoutes: readonly string[];
              readonly benchmarkPlan: {
                readonly prompt: string;
                readonly workspaceActionRoute?: string;
                readonly compareRoute: string;
                readonly refreshRoute: string;
                readonly measurements: readonly string[];
              };
              readonly confirmationBoundary: string;
            };
          }[];
        };
        readonly routes: readonly { readonly modelRouteId: string; readonly currentValue?: unknown; readonly modelRoute?: string }[];
      }>(fixture, { mode: 'model_routing', query: 'local', includeParameters: true });
      expect(cookbook.localCookbook.status).toBe('recommendations-only');
      expect(cookbook.localCookbook.recommendation).toContain('Ollama');
      expect(cookbook.localCookbook.hardwareProfile.ramGb).toBeGreaterThan(0);
      expect(cookbook.localCookbook.hardwareProfile.cpuThreads).toBeGreaterThan(0);
      expect(cookbook.localCookbook.hardwareProfile.memoryTier).toBeTruthy();
      expect(cookbook.localCookbook.hardwareProfile.acceleratorHint).toBeTruthy();
      expect(cookbook.localCookbook.hardwareProfile.privacy).toBe('local-only');
      expect(cookbook.localCookbook.nextActions.join('\n')).toContain('Refresh the model catalog');
      expect(cookbook.localCookbook.readinessRubric?.confidence).toContain('estimated');
      expect(cookbook.localCookbook.readinessRubric?.dimensions.map((dimension) => dimension.id)).toEqual([
        'latency',
        'context-window',
        'tool-support',
        'vision',
        'cost',
        'privacy',
      ]);
      expect(cookbook.localCookbook.benchmarkHistory?.status).toBe('unavailable');
      expect(cookbook.localCookbook.benchmarkHistory?.saveRoute).toContain('benchmarkKind:"local-model-route"');
      expect(cookbook.localCookbook.recipes.map((recipe) => recipe.id)).toContain('ollama');
      expect(cookbook.localCookbook.recipes.map((recipe) => recipe.id)).toContain('vllm');
      expect(cookbook.localCookbook.recipes.every((recipe) => typeof recipe.fitScore === 'number')).toBe(true);
      expect(cookbook.localCookbook.recipes.every((recipe) => typeof recipe.fitLevel === 'string')).toBe(true);
      expect(cookbook.localCookbook.recipes.every((recipe) => typeof recipe.readinessScore === 'number')).toBe(true);
      expect(cookbook.localCookbook.recipes.every((recipe) => typeof recipe.readinessLevel === 'string')).toBe(true);
      const ollamaRecipe = cookbook.localCookbook.recipes.find((recipe) => recipe.id === 'ollama');
      expect(ollamaRecipe?.hardwareMatched?.join('\n')).toContain('setup friction');
      expect(ollamaRecipe?.readinessScore).toBeGreaterThan(0);
      expect(ollamaRecipe?.readiness?.dimensions?.map((dimension) => dimension.id)).toContain('privacy');
      expect(ollamaRecipe?.readiness?.missingSignals?.join('\n')).toContain('No live latency benchmark');
      expect(ollamaRecipe?.setupPlan?.downloadGuidance.join('\n')).toContain('ollama pull');
      expect(ollamaRecipe?.setupPlan?.providerRoutes.join('\n')).toContain('/refresh-models');
      expect(ollamaRecipe?.setupPlan?.benchmarkPlan.prompt).toContain('Benchmark this local route');
      expect(ollamaRecipe?.setupPlan?.benchmarkPlan.workspaceActionRoute).toContain('account-run-local-model-benchmark');
      expect(ollamaRecipe?.setupPlan?.benchmarkPlan.compareRoute).toContain('agent_model_compare');
      expect(ollamaRecipe?.setupPlan?.benchmarkPlan.compareRoute).toContain('agent_model_compare run');
      expect(ollamaRecipe?.setupPlan?.benchmarkPlan.measurements.join('\n')).toContain('latency');
      expect(ollamaRecipe?.setupPlan?.confirmationBoundary).toContain('read-only guidance');
      expectRowsHaveCompactModelRoutes(cookbook.localCookbook.recipes);
      const localRoute = cookbook.routes.find((route) => route.modelRouteId === 'local-model-cookbook');
      expect(localRoute?.modelRoute).toBe('agent_harness mode:"model_route" or mode:"run_command"');
      expect(JSON.stringify(localRoute?.currentValue)).toContain('hardwareProfile');

      const inspected = await executeHarnessJson<{
        readonly modelRouteId: string;
        readonly localCookbook?: {
          readonly hardwareProfile?: { readonly ramGb: number };
          readonly recipes: readonly {
            readonly id: string;
            readonly fitScore?: number;
            readonly setup?: readonly string[];
            readonly setupPlan?: { readonly providerRoutes: readonly string[]; readonly benchmarkPlan: { readonly refreshRoute: string } };
          }[];
        };
      }>(fixture, { mode: 'model_route', modelRouteId: 'local-model-cookbook' });
      expect(inspected.modelRouteId).toBe('local-model-cookbook');
      expect(inspected.localCookbook?.hardwareProfile?.ramGb).toBeGreaterThan(0);
      expect(inspected.localCookbook?.recipes.find((recipe) => recipe.id === 'ollama')?.fitScore).toBeGreaterThan(0);
      expect(inspected.localCookbook?.recipes.find((recipe) => recipe.id === 'llama-cpp')?.setup?.join('\n')).toContain('GGUF');
      expect(inspected.localCookbook?.recipes.find((recipe) => recipe.id === 'vllm')?.setupPlan?.providerRoutes.join('\n')).toContain('vllm-local');
      expect(inspected.localCookbook?.recipes.find((recipe) => recipe.id === 'ollama')?.setupPlan?.benchmarkPlan.refreshRoute).toContain('/refresh-models');

      const action = await executeHarnessJson<{
        readonly id: string;
        readonly modelRoute?: string;
      }>(fixture, { mode: 'workspace_action', actionId: 'account-local-model-cookbook' });
      expect(action.id).toBe('account-local-model-cookbook');
      expect(action.modelRoute).toBe('agent_harness mode:"model_routing" query:"local"');

      const benchmarkAction = await executeHarnessJson<{
        readonly id: string;
        readonly modelRoute?: string;
        readonly editor?: { readonly kind: string; readonly fields: readonly { readonly id: string; readonly default?: string }[] };
        readonly modelExecution?: { readonly action?: string; readonly route?: string };
      }>(fixture, { mode: 'workspace_action', actionId: 'account-run-local-model-benchmark' });
      expect(benchmarkAction.id).toBe('account-run-local-model-benchmark');
      expect(benchmarkAction.modelRoute).toBe('agent_model_compare');
      expect(benchmarkAction.editor?.kind).toBe('local-model-benchmark');
      expect(benchmarkAction.editor?.fields.find((field) => field.id === 'benchmarkKind')?.default).toBe('local-model-route');
      expect(benchmarkAction.modelExecution?.action).toBe('run_local_model_benchmark');
    } finally {
      fixture.cleanup();
    }
  });

  test('surfaces saved local model benchmark history in cookbook and setup', async () => {
    const artifacts = createHarnessArtifactStore();
    await artifacts.store.create({
      kind: 'data',
      mimeType: 'application/json',
      filename: 'blind-model-comparison-cmp_local.json',
      text: '{}',
      metadata: {
        purpose: 'agent-model-compare',
        benchmarkKind: 'local-model-route',
        comparisonId: 'cmp_local',
        promptPreview: 'local model benchmark: Ollama',
        candidateCount: 2,
        completedCandidates: 2,
      },
    });
    await artifacts.store.create({
      kind: 'data',
      mimeType: 'application/json',
      filename: 'blind-model-comparison-cmp_other.json',
      text: '{}',
      metadata: {
        purpose: 'agent-model-compare',
        comparisonId: 'cmp_other',
        promptPreview: 'Write a concise product update.',
        candidateCount: 2,
        completedCandidates: 2,
      },
    });
    await artifacts.store.create({
      kind: 'data',
      mimeType: 'application/json',
      filename: 'blind-model-comparison-judgment-jdg_local.json',
      text: '{}',
      metadata: {
        purpose: 'agent-model-compare-judgment',
        judgmentId: 'jdg_local',
        comparisonId: 'cmp_local',
        sourceArtifactId: 'artifact-1',
        winnerBlindId: 'A',
        promptPreview: 'local model benchmark: Ollama',
        revealIncludedInJudgment: true,
        winnerModel: 'ollama:qwen2.5-coder:7b',
      },
    });
    const fixture = makeFixture({ artifactStore: artifacts.store });
    try {
      const cookbook = await executeHarnessJson<{
        readonly localCookbook: {
          readonly benchmarkHistory?: {
            readonly status: string;
            readonly count: number;
            readonly nextAction?: string;
            readonly analyticsRoute?: string;
            readonly evidence?: {
              readonly status: string;
              readonly confidence: string;
              readonly comparisonCount: number;
              readonly revealedJudgmentCount: number;
              readonly winnerStacks: readonly string[];
              readonly winnerModels: readonly { readonly registryKey: string; readonly stack?: string | null; readonly applyRoute: string }[];
            };
            readonly artifacts: readonly {
              readonly artifactId: string;
              readonly comparisonId?: string | null;
              readonly promptPreview?: string;
              readonly completedCandidates?: number | null;
              readonly reviewRoute: string;
              readonly revealRoute: string;
            }[];
            readonly judgments?: readonly {
              readonly artifactId: string;
              readonly winnerModel?: string | null;
              readonly winnerStack?: string | null;
              readonly applyRoute?: string | null;
            }[];
          };
          readonly recipes?: readonly {
            readonly id: string;
            readonly readiness?: {
              readonly confidence?: string;
              readonly missingSignals?: readonly string[];
              readonly nextStep?: string;
            };
          }[];
        };
      }>(fixture, { mode: 'model_routing', query: 'local', includeParameters: true });

      expect(cookbook.localCookbook.benchmarkHistory?.status).toBe('history-found');
      expect(cookbook.localCookbook.benchmarkHistory?.count).toBe(1);
      expect(cookbook.localCookbook.benchmarkHistory?.artifacts.map((artifact) => artifact.artifactId)).toEqual(['artifact-1']);
      expect(cookbook.localCookbook.benchmarkHistory?.artifacts[0]?.comparisonId).toBe('cmp_local');
      expect(cookbook.localCookbook.benchmarkHistory?.artifacts[0]?.completedCandidates).toBe(2);
      expect(cookbook.localCookbook.benchmarkHistory?.artifacts[0]?.reviewRoute).toContain('agent_model_compare review');
      expect(cookbook.localCookbook.benchmarkHistory?.artifacts[0]?.revealRoute).toContain('agent_model_compare reveal');
      expect(cookbook.localCookbook.benchmarkHistory?.judgments?.[0]?.artifactId).toBe('artifact-3');
      expect(cookbook.localCookbook.benchmarkHistory?.judgments?.[0]?.winnerModel).toBe('ollama:qwen2.5-coder:7b');
      expect(cookbook.localCookbook.benchmarkHistory?.judgments?.[0]?.winnerStack).toBe('ollama');
      expect(cookbook.localCookbook.benchmarkHistory?.judgments?.[0]?.applyRoute).toContain('agent_model_compare apply');
      expect(cookbook.localCookbook.benchmarkHistory?.evidence).toMatchObject({
        status: 'reviewed-winner',
        confidence: 'measured',
        comparisonCount: 1,
        revealedJudgmentCount: 1,
      });
      expect(cookbook.localCookbook.benchmarkHistory?.evidence?.winnerStacks).toContain('ollama');
      expect(cookbook.localCookbook.benchmarkHistory?.evidence?.winnerModels[0]?.registryKey).toBe('ollama:qwen2.5-coder:7b');
      expect(cookbook.localCookbook.benchmarkHistory?.nextAction).toContain('revealed saved judgment');
      expect(cookbook.localCookbook.benchmarkHistory?.analyticsRoute).toContain('agent_model_compare analytics');
      const ollamaRecipe = cookbook.localCookbook.recipes?.find((recipe) => recipe.id === 'ollama');
      expect(ollamaRecipe?.readiness?.confidence).toBe('measured');
      expect(ollamaRecipe?.readiness?.missingSignals?.join('\n')).not.toContain('No live latency benchmark');
      expect(ollamaRecipe?.readiness?.nextStep).toContain('saved benchmark judgment');

      const setup = await executeHarnessJson<{
        readonly setupItemId: string;
        readonly localModelReadiness?: {
          readonly benchmarkHistory?: {
            readonly status: string;
            readonly artifacts: readonly { readonly artifactId: string }[];
            readonly evidence?: { readonly status: string; readonly winnerStacks: readonly string[] };
          };
        };
      }>(fixture, { mode: 'setup_item', setupItemId: 'local-model-readiness' });
      expect(setup.setupItemId).toBe('local-model-readiness');
      expect(setup.localModelReadiness?.benchmarkHistory?.status).toBe('history-found');
      expect(setup.localModelReadiness?.benchmarkHistory?.artifacts.map((artifact) => artifact.artifactId)).toEqual(['artifact-1']);
      expect(setup.localModelReadiness?.benchmarkHistory?.evidence?.status).toBe('reviewed-winner');
      expect(setup.localModelReadiness?.benchmarkHistory?.evidence?.winnerStacks).toContain('ollama');
    } finally {
      fixture.cleanup();
    }
  });

  test('scores model route readiness from provider metadata without hiding missing benchmarks', async () => {
    const fixture = makeFixture();
    try {
      const cloudModel = {
        registryKey: 'openai:gpt-4.1',
        modelId: 'gpt-4.1',
        providerId: 'openai',
        displayName: 'GPT 4.1',
        current: true,
        contextWindow: 128_000,
        reasoningEffort: ['low', 'medium', 'high'],
        capabilities: {
          toolCalling: true,
          codeEditing: true,
          reasoning: true,
          multimodal: true,
        },
        tier: 'premium',
        benchmark: {
          compositeScore: 0.82,
          qualityTier: 'S',
        },
      };
      const localModel = {
        registryKey: 'ollama:qwen2.5-coder:7b',
        modelId: 'qwen2.5-coder:7b',
        providerId: 'ollama',
        displayName: 'Qwen local',
        current: false,
        contextWindow: 32_768,
        reasoningEffort: [],
        capabilities: {
          toolCalling: false,
          codeEditing: true,
          reasoning: false,
          multimodal: false,
        },
        tier: 'free',
      };
      (fixture.context.clients as Record<string, unknown>).providerApi = {
        getFavorites: async () => ({ pinned: [cloudModel], recent: [] }),
        getCurrentModel: async () => cloudModel,
        listModels: async () => [cloudModel, localModel],
        listProviderIds: () => ['openai', 'ollama'],
      };

      const routing = await executeHarnessJson<{
        readonly current: {
          readonly currentModel?: {
            readonly readiness?: { readonly score: number; readonly dimensions: readonly { readonly id: string }[] };
            readonly benchmarkCompositeScore?: number | null;
          } | null;
        };
        readonly models: readonly {
          readonly modelRouteId: string;
          readonly tier?: string | null;
          readonly benchmarkCompositeScore?: number | null;
          readonly readinessScore?: number;
          readonly readinessLevel?: string;
          readonly readiness?: {
            readonly score: number;
            readonly level: string;
            readonly confidence: string;
            readonly dimensions: readonly { readonly id: string; readonly score: number }[];
            readonly missingSignals: readonly string[];
            readonly nextStep: string;
          };
        }[];
      }>(fixture, { mode: 'model_routing', includeParameters: true, limit: 10 });

      expect(routing.current.currentModel?.benchmarkCompositeScore).toBe(0.82);
      expect(routing.current.currentModel?.readiness?.dimensions.map((dimension) => dimension.id)).toEqual([
        'latency',
        'context-window',
        'tool-support',
        'vision',
        'cost',
        'privacy',
      ]);
      const cloud = routing.models.find((model) => model.modelRouteId === 'openai:gpt-4.1');
      expect(cloud?.tier).toBe('premium');
      expect(cloud?.benchmarkCompositeScore).toBe(0.82);
      expect(cloud?.readinessScore).toBeGreaterThan(0);
      expect(cloud?.readinessLevel).toBeTruthy();
      expect(cloud?.readiness?.dimensions.find((dimension) => dimension.id === 'tool-support')?.score).toBe(100);
      expect(cloud?.readiness?.dimensions.find((dimension) => dimension.id === 'vision')?.score).toBe(100);
      expect(cloud?.readiness?.missingSignals.join('\n')).toContain('No live latency benchmark');

      const local = routing.models.find((model) => model.modelRouteId === 'ollama:qwen2.5-coder:7b');
      expect(local?.readiness?.dimensions.find((dimension) => dimension.id === 'privacy')?.score).toBe(100);
      expect(local?.readiness?.nextStep).toContain('local benchmark prompt');

      const inspected = await executeHarnessJson<{
        readonly modelRouteId: string;
        readonly readiness?: {
          readonly confidence: string;
          readonly dimensions: readonly { readonly id: string }[];
          readonly missingSignals: readonly string[];
        };
      }>(fixture, { mode: 'model_route', modelRouteId: 'ollama:qwen2.5-coder:7b' });
      expect(inspected.modelRouteId).toBe('ollama:qwen2.5-coder:7b');
      expect(inspected.readiness?.confidence).toBe('estimated');
      expect(inspected.readiness?.dimensions.map((dimension) => dimension.id)).toContain('cost');
      expect(inspected.readiness?.missingSignals.join('\n')).toContain('No live latency benchmark');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes Agent workspace categories, actions, and editor schemas to the model', async () => {
    const fixture = makeFixture();
    try {
      const workspace = await fixture.tool.execute({ mode: 'workspace' });
      expect(workspace.success).toBe(true);
      const workspacePayload = JSON.parse(workspace.output) as {
        readonly categories: readonly { readonly id: string; readonly actions: number }[];
        readonly actions: number;
      };
      expect(workspacePayload.categories.find((entry) => entry.id === 'home')?.actions).toBeGreaterThan(0);
      expect(workspacePayload.categories.find((entry) => entry.id === 'personal-ops')?.actions).toBeGreaterThan(0);
      expect(workspacePayload.categories.find((entry) => entry.id === 'documents')?.actions).toBeGreaterThan(0);
      expect(workspacePayload.actions).toBeGreaterThan(0);
      expectCompactSummaryFields(workspacePayload);

      const categories = await fixture.tool.execute({ mode: 'workspace_categories' });
      expect(categories.success).toBe(true);
      const categoryPayload = JSON.parse(categories.output) as {
        readonly categories: readonly { readonly id: string; readonly actions: number }[];
        readonly actions: number;
      };
      expect(categoryPayload.categories.find((entry) => entry.id === 'memory')?.actions).toBeGreaterThan(0);
      expect(categoryPayload.actions).toBe(workspacePayload.actions);
      expectCompactSummaryFields(categoryPayload);

      const compactSummary = await fixture.tool.execute({ mode: 'summary' });
      expect(compactSummary.success).toBe(true);
      const compactSummaryJson = JSON.parse(compactSummary.output ?? '{}') as { readonly modelAccess?: unknown };
      expect(compactSummaryJson.modelAccess).toBeUndefined();

      const summary = await fixture.tool.execute({ mode: 'summary', includeParameters: true });
      expect(summary.success).toBe(true);
      const summaryJson = JSON.parse(summary.output ?? '{}') as { readonly modelAccess?: { readonly workspace?: string; readonly documentOps?: string } };
      expect(summaryJson.modelAccess?.workspace).toContain('mode:"workspace"');
      expect(summaryJson.modelAccess?.workspace).toContain('mode:"workspace_categories"');
      expect(summaryJson.modelAccess?.documentOps).toContain('mode:"document_ops"');

      const listed = await fixture.tool.execute({ mode: 'workspace_actions', query: 'memory create' });
      expect(listed.success).toBe(true);
      expect(listed.output).toContain('memory-create');
      expect(listed.output).toContain('Create memory');
      const listedPayload = JSON.parse(listed.output) as {
        readonly actions: readonly { readonly id: string; readonly modelRoute?: string }[];
      };
      expectCompactSummaryFields(listedPayload);
      expect(listedPayload.actions.find((entry) => entry.id === 'memory-create')?.modelRoute).toBe('agent_local_registry');

      const allActions = await fixture.tool.execute({ mode: 'workspace_actions' });
      expect(allActions.success).toBe(true);
      const allActionPayload = JSON.parse(allActions.output) as {
        readonly actions: readonly { readonly id: string; readonly modelRoute?: string }[];
        readonly returned: number;
        readonly total: number;
      };
      expect(allActionPayload.returned).toBe(workspacePayload.actions);
      expect(allActionPayload.total).toBe(workspacePayload.actions);
      expect(allActionPayload.actions.length).toBe(workspacePayload.actions);
      expect(allActionPayload.actions.filter((entry) => (
        typeof entry.modelRoute !== 'string'
        || entry.modelRoute.length === 0
        || entry.modelRoute.length > 72
      ))).toEqual([]);
      expect(allActionPayload.actions.find((entry) => entry.id === 'brief')?.modelRoute).toBe('agent_operator_briefing');
      expect(allActionPayload.actions.find((entry) => entry.id === 'assistant-personal-ops-lane')?.modelRoute).toBe('agent_harness mode:"open_ui_surface"');
      expect(allActionPayload.actions.find((entry) => entry.id === 'personal-ops-autonomy-queue')?.modelRoute).toBe('agent_harness mode:"autonomy_queue"');
      expect(allActionPayload.actions.find((entry) => entry.id === 'assistant-research-docs-lane')?.modelRoute).toBe('agent_harness mode:"open_ui_surface"');
      expect(allActionPayload.actions.find((entry) => entry.id === 'account-local-model-cookbook')?.modelRoute).toBe('agent_harness mode:"model_routing" query:"local"');
      expect(allActionPayload.actions.find((entry) => entry.id === 'account-run-local-model-benchmark')?.modelRoute).toBe('agent_model_compare');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-create-draft')?.modelRoute).toBe('agent_documents');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-revise-draft')?.modelRoute).toBe('agent_documents');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-comment-draft')?.modelRoute).toBe('agent_documents');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-resolve-comment')?.modelRoute).toBe('agent_documents');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-suggest-draft')?.modelRoute).toBe('agent_documents');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-accept-suggestion')?.modelRoute).toBe('agent_documents');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-reject-suggestion')?.modelRoute).toBe('agent_documents');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-insert-artifact')?.modelRoute).toBe('agent_documents');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-attach-artifact')?.modelRoute).toBe('agent_documents');
      expect(allActionPayload.actions.find((entry) => entry.id === 'artifact-insert-document')?.modelRoute).toBe('agent_documents');
      expect(allActionPayload.actions.find((entry) => entry.id === 'artifact-attach-document')?.modelRoute).toBe('agent_documents');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-export-draft')?.modelRoute).toBe('agent_documents');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-browse-artifacts')?.modelRoute).toBe('agent_artifacts');
      expect(allActionPayload.actions.find((entry) => entry.id === 'artifact-show')?.modelRoute).toBe('agent_artifacts');
      expect(allActionPayload.actions.find((entry) => entry.id === 'artifact-export-file')?.modelRoute).toBe('agent_artifacts');
      expect(allActionPayload.actions.find((entry) => entry.id === 'artifact-export-package')?.modelRoute).toBe('agent_artifacts');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-export-artifact-file')?.modelRoute).toBe('agent_artifacts');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-export-artifact-package')?.modelRoute).toBe('agent_artifacts');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-promote-artifact')?.modelRoute).toBe('agent_knowledge_ingest');
      expect(allActionPayload.actions.find((entry) => entry.id === 'artifact-promote-knowledge')?.modelRoute).toBe('agent_knowledge_ingest');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-ingest-file')?.modelRoute).toBe('agent_knowledge_ingest');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-generate-media')?.modelRoute).toBe('agent_media_generate');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-run-compare')?.modelRoute).toBe('agent_model_compare');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-review-compare')?.modelRoute).toBe('agent_model_compare');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-judge-compare')?.modelRoute).toBe('agent_model_compare');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-compare-analytics')?.modelRoute).toBe('agent_model_compare');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-apply-compare')?.modelRoute).toBe('agent_model_compare');
      expect(allActionPayload.actions.find((entry) => entry.id === 'document-export-compare')?.modelRoute).toBe('agent_model_compare');
      expect(allActionPayload.actions.find((entry) => entry.id === 'knowledge-ingest-url')?.modelRoute).toBe('agent_knowledge_ingest');
      expect(allActionPayload.actions.find((entry) => entry.id === 'research-run-queue')?.modelRoute).toBe('agent_harness mode:"research_runs"');
      expect(allActionPayload.actions.find((entry) => entry.id === 'research-start-run')?.modelRoute).toBe('agent_research_runs');
      expect(allActionPayload.actions.find((entry) => entry.id === 'research-source-queue')?.modelRoute).toBe('agent_harness mode:"research_queue"');
      expect(allActionPayload.actions.find((entry) => entry.id === 'research-add-source')?.modelRoute).toBe('agent_research_sources');
      expect(allActionPayload.actions.find((entry) => entry.id === 'research-save-report')?.modelRoute).toBe('agent_research_report');

      const listedWithEditors = await fixture.tool.execute({ mode: 'workspace_actions', query: 'memory create', includeParameters: true });
      expect(listedWithEditors.success).toBe(true);
      expect(listedWithEditors.output).toContain('"editor"');
      expect(listedWithEditors.output).toContain('"summary"');

      const action = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'memory-create' });
      expect(action.success).toBe(true);
      expect(action.output).toContain('"editorKind": "memory"');
      expect(action.output).toContain('agent_local_registry');
      expect(action.output).toContain('"route": "agent_local_registry"');
      expect(action.output).toContain('"summary"');
    } finally {
      fixture.cleanup();
    }
  });

  test('inspects one workspace action from command, target, query, and action id lookups', async () => {
    const fixture = makeFixture();
    try {
      const byCommand = await fixture.tool.execute({ mode: 'workspace_action', command: '/memory list' });
      expect(byCommand.success).toBe(true);
      if (!byCommand.success) throw new Error(byCommand.error);
      const commandPayload = JSON.parse(byCommand.output) as {
        readonly id: string;
        readonly lookup: { readonly source: string; readonly resolvedBy: string };
      };
      expect(commandPayload.id).toBe('memory-list');
      expect(commandPayload.lookup.source).toBe('command');
      expect(commandPayload.lookup.resolvedBy).toBe('command');

      const byTarget = await fixture.tool.execute({ mode: 'workspace_action', target: 'CREATE MEMORY' });
      expect(byTarget.success).toBe(true);
      expect(byTarget.output).toContain('"id": "memory-create"');
      expect(byTarget.output).toContain('"source": "target"');
      expect(byTarget.output).toContain('"resolvedBy": "case-insensitive-label"');

      const byQuery = await fixture.tool.execute({ mode: 'workspace_action', query: 'durable non-secret default knowledge fallback' });
      expect(byQuery.success).toBe(true);
      expect(byQuery.output).toContain('"id": "memory-create"');
      expect(byQuery.output).toContain('"resolvedBy": "search"');
      expect(byQuery.output).toContain('"editorKind": "memory"');

      const byId = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'MEMORY-CREATE' });
      expect(byId.success).toBe(true);
      expect(byId.output).toContain('"resolvedBy": "case-insensitive-id"');

      const ambiguous = await fixture.tool.execute({ mode: 'workspace_action', query: 'memory' });
      expect(ambiguous.success).toBe(false);
      expect(ambiguous.error).toContain('Ambiguous Agent workspace action memory');
      expect(ambiguous.error).toContain('memory-create');
    } finally {
      fixture.cleanup();
    }
  });

  test('uses runtime context for model-visible profile and routine schedule editor schemas', async () => {
    const fixture = makeFixture();
    try {
      const routine = AgentRoutineRegistry.fromShellPaths(fixture.paths).create({
        name: 'Morning Review',
        description: 'Review current operator state.',
        steps: 'Check work plan, approvals, schedules, and Agent Knowledge status.',
        enabled: true,
      });

      const profileAction = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'runtime-profile-create' });
      expect(profileAction.success).toBe(true);
      expect(profileAction.output).toContain('Starter template');

      const routineAction = await fixture.tool.execute({
        mode: 'workspace_action',
        actionId: 'schedule-promote-routine',
        recordId: routine.id,
      });
      expect(routineAction.success).toBe(true);
      expect(routineAction.output).toContain(`Selected: ${routine.id} (${routine.name})`);
      expect(routineAction.output).toContain(`"default": "${routine.id}"`);
      expect(routineAction.output).toContain(`"default": "${routine.name}"`);

      const scheduleEditAction = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'schedule-edit' });
      expect(scheduleEditAction.success).toBe(true);
      expect(scheduleEditAction.output).toContain('"editorKind": "schedule-edit"');
      expect(scheduleEditAction.output).toContain('"modelRoute": "agent_schedule_edit"');
      expect(scheduleEditAction.output).toContain('"id": "scheduleId"');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes command policy metadata for slash-command mirror coverage', async () => {
    const fixture = makeFixture();
    try {
      registerOperatorRuntimeCommands(fixture.commandRegistry);

      const settings = await fixture.tool.execute({ mode: 'command', commandName: 'settings' });
      expect(settings.success).toBe(true);
      const settingsJson = JSON.parse(settings.output ?? '{}') as {
        readonly policy?: {
          readonly effect?: string;
          readonly preferredModelTool?: string;
          readonly boundary?: string;
        };
      };
      expect(settingsJson.policy?.effect).toBe('mixed');
      expect(settingsJson.policy?.preferredModelTool).toBe('agent_harness mode:"settings", mode:"get_setting", mode:"set_setting", mode:"reset_setting"');
      expect(settingsJson.policy?.preferredModelTool).not.toContain('settings/get_setting/set_setting/reset_setting');
      expect(settingsJson.policy?.boundary).toContain('Connected-host lifecycle/listener settings remain read-only');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes every built-in slash command through the model-facing command catalog', async () => {
    const fixture = makeFixture({ builtinCommands: true });
    try {
      const catalog = await fixture.tool.execute({ mode: 'commands', includeParameters: true, limit: 500 });
      expect(catalog.success).toBe(true);
      if (!catalog.success) throw new Error(catalog.error);
      const payload = JSON.parse(catalog.output) as {
        readonly commands: readonly {
          readonly name: string;
          readonly slash: string;
          readonly policy?: {
            readonly effect?: string;
            readonly preferredModelTool?: string;
          };
        }[];
        readonly returned: number;
        readonly total: number;
      };
      const registeredNames = fixture.commandRegistry.list().map((command) => command.name).sort();
      const catalogNames = payload.commands.map((command) => command.name).sort();

      expect(payload.total).toBe(registeredNames.length);
      expect(payload.returned).toBe(registeredNames.length);
      expect(catalogNames).toEqual(registeredNames);
      expect(catalogNames).toEqual(expect.arrayContaining([
        'agent',
        'agent-profile',
        'channels',
        'commands',
        'knowledge',
        'memory',
        'model',
        'qrcode',
        'schedule',
        'settings',
        'tasks',
        'voice',
        'workplan',
      ]));
      for (const hidden of [
        'bridge',
        'daemon',
        'panel',
        'profiles',
        'remote',
        'services',
      ] as const) {
        expect(catalogNames).not.toContain(hidden);
      }
      expect(payload.commands.map((command) => command.slash)).toEqual(payload.commands.map((command) => `/${command.name}`));
      expect(payload.commands.filter((command) => !command.policy?.effect || !command.policy.preferredModelTool)).toEqual([]);
      expectModelFacingText(catalog.output);

      const compactCatalog = await fixture.tool.execute({ mode: 'commands', limit: 500 });
      expect(compactCatalog.success).toBe(true);
      if (!compactCatalog.success) throw new Error(compactCatalog.error);
      const compactPayload = JSON.parse(compactCatalog.output) as {
        readonly commands: readonly { readonly effect?: string; readonly modelRoute?: string }[];
      };
      expectCompactSummaryFields(compactPayload);
      expect(compactPayload.commands.filter((command) => !command.effect || !command.modelRoute)).toEqual([]);
      expect(compactPayload.commands.filter((command) => (command.modelRoute?.length ?? 0) > 72)).toEqual([]);

      const profileAlias = await fixture.tool.execute({ mode: 'command', command: '/agent-profiles list' });
      expect(profileAlias.success).toBe(true);
      if (!profileAlias.success) throw new Error(profileAlias.error);
      const profilePayload = JSON.parse(profileAlias.output) as {
        readonly name: string;
        readonly lookup: { readonly resolvedBy: string; readonly parsedArgs: readonly string[] };
        readonly policy?: { readonly preferredModelTool?: string };
      };
      expect(profilePayload.name).toBe('agent-profile');
      expect(profilePayload.lookup.resolvedBy).toBe('alias');
      expect(profilePayload.lookup.parsedArgs).toEqual(['list']);
      expect(profilePayload.policy?.preferredModelTool).toContain('workspace_actions');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes first-class model tool schemas individually', async () => {
    const fixture = makeFixture();
    try {
      const tool: Tool = {
        definition: {
          name: 'agent_custom_action',
          description: 'Run a confirmed custom Agent action',
          sideEffects: ['state'],
          concurrency: 'serial',
          supportsProgress: true,
          parameters: {
            type: 'object',
            properties: {
              targetId: { type: 'string', description: 'Target record id.' },
              confirm: { type: 'boolean' },
            },
            required: ['targetId'],
            additionalProperties: false,
          },
        },
        execute: async () => ({ success: true, output: 'custom action executed' }),
      };
      fixture.toolRegistry.register(tool);
      fixture.toolRegistry.register({
        definition: {
          name: 'agent_custom_report',
          description: 'Inspect a custom Agent report',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
        execute: async () => ({ success: true, output: 'custom report inspected' }),
      });
      fixture.toolRegistry.register({
        definition: {
          name: 'agent_a_notice_template',
          description: 'Inspect notice template before send',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
        execute: async () => ({ success: true, output: 'notice template inspected' }),
      });
      fixture.toolRegistry.register({
        definition: {
          name: 'agent_z_send_notice',
          description: 'Send one confirmed notice to a configured target',
          sideEffects: ['network'],
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Notice body.' },
              targetId: { type: 'string', description: 'Configured delivery target id.' },
              confirm: { type: 'boolean' },
            },
            required: ['message', 'targetId', 'confirm'],
            additionalProperties: false,
          },
        },
        execute: async () => ({ success: true, output: 'notice sent' }),
      });
      compactRegisteredToolDefinitions(fixture.toolRegistry);

      const summary = await fixture.tool.execute({ mode: 'summary', includeParameters: true });
      expect(summary.success).toBe(true);
      const summaryJson = JSON.parse(summary.output ?? '{}') as { readonly modelAccess?: { readonly tools?: string } };
      expect(summaryJson.modelAccess?.tools).toContain('mode:"tool"');
      expect(summaryJson.modelAccess?.tools).toContain('includeParameters:true');

      const catalog = await fixture.tool.execute({ mode: 'tools', query: 'custom' });
      expect(catalog.success).toBe(true);
      expect(catalog.output).toContain('"name": "agent_custom_action"');
      expect(catalog.output).toContain('"supportsProgress": true');
      expect(catalog.output).not.toContain('"targetId"');
      const catalogJson = JSON.parse(catalog.output ?? '{}') as {
        readonly tools: readonly { readonly summary?: string }[];
      };
      expect(catalogJson.tools.filter((entry) => (entry.summary?.length ?? 0) > 72)).toEqual([]);

      const catalogWithSchemas = await fixture.tool.execute({ mode: 'tools', query: 'confirmed custom Agent action', includeParameters: true });
      expect(catalogWithSchemas.success).toBe(true);
      expect(catalogWithSchemas.output).toContain('"parameters"');
      expect(catalogWithSchemas.output).toContain('"targetId"');

      const taskPhraseCatalog = await fixture.tool.execute({ mode: 'tools', query: 'send notice' });
      expect(taskPhraseCatalog.success).toBe(true);
      const taskPhraseJson = JSON.parse(taskPhraseCatalog.output ?? '{}') as {
        readonly tools: readonly { readonly name: string }[];
      };
      expect(taskPhraseJson.tools[0]?.name).toBe('agent_z_send_notice');

      const parameterCatalog = await fixture.tool.execute({ mode: 'tools', query: 'target id' });
      expect(parameterCatalog.success).toBe(true);
      expect(parameterCatalog.output).toContain('"name": "agent_custom_action"');

      const detail = await fixture.tool.execute({ mode: 'tool', toolName: 'agent_custom_action' });
      expect(detail.success).toBe(true);
      expect(detail.output).toContain('"name": "agent_custom_action"');
      expect(detail.output).toContain('"resolvedBy": "name"');
      expect(detail.output).toContain('"concurrency": "serial"');
      expect(detail.output).toContain('"targetId"');
      expect(detail.output).toContain('Use the returned JSON schema directly');

      const targetLookup = await fixture.tool.execute({ mode: 'tool', target: 'confirmed custom Agent action' });
      expect(targetLookup.success).toBe(true);
      expect(targetLookup.output).toContain('"name": "agent_custom_action"');
      expect(targetLookup.output).toContain('"source": "target"');
      expect(targetLookup.output).toContain('"resolvedBy": "search"');

      const ambiguous = await fixture.tool.execute({ mode: 'tool', query: 'custom Agent' });
      expect(ambiguous.success).toBe(false);
      expect(ambiguous.error).toContain('Ambiguous model tool custom Agent');
      expect(ambiguous.error).toContain('agent_custom_action');
      expect(ambiguous.error).toContain('agent_custom_report');

      const missing = await fixture.tool.execute({ mode: 'tool', toolName: 'not_a_tool' });
      expect(missing.success).toBe(false);
      expect(missing.error).toContain('Unknown model tool');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes release evidence artifacts and readiness inventory lookup to the model', async () => {
    const fixture = makeFixture();
    try {
      const summary = await fixture.tool.execute({ mode: 'summary', includeParameters: true });
      expect(summary.success).toBe(true);
      if (!summary.success) throw new Error(summary.error);
      const summaryJson = JSON.parse(summary.output) as {
        readonly releaseEvidence?: { readonly status?: string; readonly artifacts?: number; readonly available?: number };
        readonly releaseReadiness?: { readonly status?: string; readonly path?: string; readonly items?: number };
        readonly modelAccess?: { readonly releaseEvidence?: string; readonly releaseReadiness?: string };
      };
      expect(summaryJson.releaseEvidence?.status).toBe('available');
      expect(summaryJson.releaseEvidence?.artifacts).toBe(5);
      expect(summaryJson.releaseEvidence?.available).toBe(5);
      expect(summaryJson.releaseReadiness?.status).toBe('available');
      expect(summaryJson.releaseReadiness?.path).toBe('release/release-readiness.json');
      expect(summaryJson.releaseReadiness?.items).toBeGreaterThan(0);
      expect(summaryJson.modelAccess?.releaseEvidence).toContain('mode:"release_evidence"');
      expect(summaryJson.modelAccess?.releaseEvidence).toContain('mode:"release_evidence_artifact"');
      expect(summaryJson.modelAccess?.releaseReadiness).toContain('mode:"release_readiness"');
      expect(summaryJson.modelAccess?.releaseReadiness).toContain('mode:"release_readiness_item"');

      const evidence = await fixture.tool.execute({
        mode: 'release_evidence',
        query: 'live verification',
      });
      expect(evidence.success).toBe(true);
      if (!evidence.success) throw new Error(evidence.error);
      const evidenceJson = JSON.parse(evidence.output) as {
        readonly mode: string;
        readonly artifacts: number;
        readonly available: number;
        readonly filtered: number;
        readonly artifactsList: readonly { readonly id?: string; readonly path?: string; readonly summary?: Record<string, unknown>; readonly content?: string }[];
      };
      expect(evidenceJson.mode).toBe('release_evidence');
      expect(evidenceJson.artifacts).toBe(5);
      expect(evidenceJson.available).toBe(5);
      expect(evidenceJson.filtered).toBe(2);
      expect(evidenceJson.artifactsList.map((artifact) => artifact.id)).toEqual([
        'live-verification-json',
        'live-verification-markdown',
      ]);
      expect(evidenceJson.artifactsList.map((artifact) => artifact.content)).toEqual([undefined, undefined]);

      const notesArtifact = await fixture.tool.execute({
        mode: 'release_evidence_artifact',
        artifactId: 'release-notes',
      });
      expect(notesArtifact.success).toBe(true);
      if (!notesArtifact.success) throw new Error(notesArtifact.error);
      const notesArtifactJson = JSON.parse(notesArtifact.output) as {
        readonly status: string;
        readonly lookup: { readonly source: string; readonly resolvedBy: string };
        readonly artifact: { readonly id: string; readonly path: string; readonly content?: string; readonly summary?: { readonly bullets?: number } };
      };
      expect(notesArtifactJson.status).toBe('found');
      expect(notesArtifactJson.lookup.source).toBe('artifactId');
      expect(notesArtifactJson.lookup.resolvedBy).toBe('id');
      expect(notesArtifactJson.artifact.id).toBe('release-notes');
      expect(notesArtifactJson.artifact.path).toBe('release/release-notes.md');
      expect(notesArtifactJson.artifact.content).toContain('compact model-visible harness pass');
      expect(notesArtifactJson.artifact.summary?.bullets).toBeGreaterThan(0);

      const ambiguousArtifact = await fixture.tool.execute({ mode: 'release_evidence_artifact', query: 'live verification' });
      expect(ambiguousArtifact.success).toBe(false);
      expect(ambiguousArtifact.error).toContain('Ambiguous release evidence artifact live verification');

      const missingArtifact = await fixture.tool.execute({ mode: 'release_evidence_artifact', artifactId: 'not-release-evidence' });
      expect(missingArtifact.success).toBe(false);
      expect(missingArtifact.error).toContain('Unknown release evidence artifact not-release-evidence');

      const inventory = await fixture.tool.execute({
        mode: 'release_readiness',
        query: 'release-quality inventory',
        limit: 5,
      });
      expect(inventory.success).toBe(true);
      if (!inventory.success) throw new Error(inventory.error);
      const inventoryJson = JSON.parse(inventory.output) as {
        readonly mode: string;
        readonly path: string;
        readonly totals: {
          readonly items: number;
          readonly filtered: number;
          readonly requiredQualityDimensions: readonly string[];
          readonly completeQualityDimensions: number;
          readonly expectedQualityDimensions: number;
        };
        readonly items: readonly { readonly id?: string; readonly quality?: unknown }[];
      };
      expect(inventoryJson.mode).toBe('release_readiness');
      expect(inventoryJson.path).toBe('release/release-readiness.json');
      expect(inventoryJson.totals.items).toBeGreaterThan(0);
      expect(inventoryJson.totals.filtered).toBeGreaterThan(0);
      expect(inventoryJson.totals.requiredQualityDimensions).toContain('modelAccess');
      expect(inventoryJson.totals.completeQualityDimensions).toBe(inventoryJson.totals.expectedQualityDimensions);
      expect(inventoryJson.items.map((item) => item.id)).toContain('release-readiness-inventory-gate');
      expect(inventoryJson.items.map((item) => item.quality)).toEqual(Array(inventoryJson.items.length).fill(undefined));

      const inventoryWithQuality = await fixture.tool.execute({
        mode: 'release_readiness',
        query: 'release-quality inventory',
        includeParameters: true,
        limit: 1,
      });
      expect(inventoryWithQuality.success).toBe(true);
      expect(inventoryWithQuality.output).toContain('"quality"');

      const item = await fixture.tool.execute({
        mode: 'release_readiness_item',
        itemId: 'release-readiness-inventory-gate',
      });
      expect(item.success).toBe(true);
      if (!item.success) throw new Error(item.error);
      const itemJson = JSON.parse(item.output) as {
        readonly status: string;
        readonly lookup: { readonly source: string; readonly resolvedBy: string };
        readonly item: { readonly id: string; readonly quality: { readonly modelAccess?: string } };
      };
      expect(itemJson.status).toBe('found');
      expect(itemJson.lookup.source).toBe('itemId');
      expect(itemJson.lookup.resolvedBy).toBe('id');
      expect(itemJson.item.id).toBe('release-readiness-inventory-gate');
      expect(itemJson.item.quality.modelAccess).toContain('release_evidence');
      expect(itemJson.item.quality.modelAccess).toContain('release_readiness');

      const ambiguous = await fixture.tool.execute({ mode: 'release_readiness_item', query: 'Agent' });
      expect(ambiguous.success).toBe(false);
      expect(ambiguous.error).toContain('Ambiguous release readiness item Agent');

      const missing = await fixture.tool.execute({ mode: 'release_readiness_item', itemId: 'not-a-readiness-item' });
      expect(missing.success).toBe(false);
      expect(missing.error).toContain('Unknown release readiness item not-a-readiness-item');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes operator method catalog and service posture as read-only model surfaces', async () => {
    const fixture = makeFixture();
    try {
      fixture.configManager.setDynamic('controlPlane.enabled', false);
      fixture.configManager.setDynamic('danger.httpListener', false);
      fixture.configManager.setDynamic('web.enabled', false);

      const summary = await fixture.tool.execute({ mode: 'summary', includeParameters: true });
      expect(summary.success).toBe(true);
      if (!summary.success) throw new Error(summary.error);
      const summaryJson = JSON.parse(summary.output) as {
        readonly operatorMethods?: { readonly modes?: readonly string[]; readonly methods?: number; readonly readOnlyMethods?: number };
        readonly servicePosture?: { readonly modes?: readonly string[]; readonly endpointIds?: readonly string[]; readonly readOnly?: boolean };
        readonly modelAccess?: { readonly operatorMethods?: string; readonly servicePosture?: string };
      };
      expect(summaryJson.operatorMethods?.modes).toEqual(['operator_methods', 'operator_method']);
      expect(summaryJson.operatorMethods?.methods).toBeGreaterThan(10);
      expect(summaryJson.operatorMethods?.readOnlyMethods).toBeGreaterThan(5);
      expect(summaryJson.servicePosture?.modes).toEqual(['service_posture', 'service_endpoint']);
      expect(summaryJson.servicePosture?.endpointIds).toEqual(['controlPlane', 'httpListener', 'web']);
      expect(summaryJson.servicePosture?.readOnly).toBe(true);
      expect(summaryJson.modelAccess?.operatorMethods).toContain('mode:"operator_methods"');
      expect(summaryJson.modelAccess?.servicePosture).toContain('mode:"service_posture"');

      const catalog = await fixture.tool.execute({
        mode: 'operator_methods',
        query: 'knowledge',
        includeParameters: true,
        limit: 120,
      });
      expect(catalog.success).toBe(true);
      if (!catalog.success) throw new Error(catalog.error);
      const catalogJson = JSON.parse(catalog.output) as {
        readonly methods: readonly { readonly id: string; readonly route: string; readonly preferredModelTool: string; readonly parameters?: readonly unknown[] }[];
      };
      expect(catalogJson.methods.map((method) => method.id)).toContain('knowledge.map');
      expect(catalogJson.methods.map((method) => method.route)).toContain('GET /api/knowledge/connectors/{id}/doctor');
      expect(catalogJson.methods.find((method) => method.id === 'knowledge.ingest.url')?.parameters?.length).toBeGreaterThan(0);

      const schedule = await fixture.tool.execute({ mode: 'operator_method', methodId: 'schedules.create' });
      expect(schedule.success).toBe(true);
      if (!schedule.success) throw new Error(schedule.error);
      const scheduleJson = JSON.parse(schedule.output) as {
        readonly id: string;
        readonly preferredModelTool: string;
        readonly parameters: readonly { readonly name: string; readonly required: boolean }[];
      };
      expect(scheduleJson.id).toBe('schedules.create');
      expect(scheduleJson.preferredModelTool).toContain('agent_operator_method');
      expect(scheduleJson.parameters.map((parameter) => parameter.name)).toEqual(expect.arrayContaining([
        'prompt',
        'kind',
        'every',
        'delivery',
      ]));

      const posture = await fixture.tool.execute({ mode: 'service_posture', includeParameters: true });
      expect(posture.success).toBe(true);
      if (!posture.success) throw new Error(posture.error);
      const postureJson = JSON.parse(posture.output) as {
        readonly readOnly: boolean;
        readonly endpoints: readonly { readonly id: string; readonly policy: { readonly lifecycle: string } }[];
      };
      expect(postureJson.readOnly).toBe(true);
      expect(postureJson.endpoints.map((endpoint) => endpoint.id)).toEqual(['controlPlane', 'httpListener', 'web']);
      expect(postureJson.endpoints[0]?.policy.lifecycle).toContain('confirmed GoodVibes daemon operator methods');

      const endpoint = await fixture.tool.execute({ mode: 'service_endpoint', query: 'browser companion route' });
      expect(endpoint.success).toBe(true);
      if (!endpoint.success) throw new Error(endpoint.error);
      const endpointJson = JSON.parse(endpoint.output) as {
        readonly id: string;
        readonly lookup: { readonly source: string; readonly resolvedBy: string };
        readonly policy: { readonly effect: string; readonly lifecycle: string };
      };
      expect(endpointJson.id).toBe('web');
      expect(endpointJson.lookup).toEqual({
        source: 'query',
        input: 'browser companion route',
        resolvedBy: 'label',
      });
      expect(endpointJson.policy.effect).toBe('read-only');
      expect(endpointJson.policy.lifecycle).toContain('confirmed GoodVibes daemon operator methods');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes top-level CLI mirror metadata without enabling hidden CLI execution', async () => {
    const fixture = makeFixture();
    try {
      const summary = await fixture.tool.execute({ mode: 'summary', includeParameters: true });
      expect(summary.success).toBe(true);
      expect(summary.output).toContain('"cliCommands"');
      const summaryJson = JSON.parse(summary.output ?? '{}') as { readonly modelAccess?: { readonly cliCommands?: string } };
      expect(summaryJson.modelAccess?.cliCommands).toContain('mode:"cli_commands"');

      const catalog = await fixture.tool.execute({ mode: 'cli_commands', query: 'knowledge' });
      expect(catalog.success).toBe(true);
      expect(catalog.output).toContain('"name": "knowledge"');
      expect(catalog.output).toContain('"blockedTokens"');
      expect(catalog.output).toContain('"daemon"');
      expect(catalog.output).toContain('CLI modes are read-only discovery');
      const compactCliJson = JSON.parse(catalog.output) as {
        readonly commands: readonly { readonly name: string; readonly effect?: string; readonly modelRoute?: string }[];
      };
      expect(compactCliJson.commands.filter((command) => (
        command.name === 'knowledge'
        && command.effect === 'mixed'
        && command.modelRoute === 'agent_knowledge or agent_knowledge_ingest'
      ))).toHaveLength(1);
      expect(compactCliJson.commands.filter((command) => (command.modelRoute?.length ?? 0) > 72)).toEqual([]);

      const detailedCatalog = await fixture.tool.execute({ mode: 'cli_commands', query: 'knowledge', includeParameters: true });
      expect(detailedCatalog.success).toBe(true);
      expect(detailedCatalog.output).toContain('agent_knowledge or agent_knowledge_ingest');

      const parsed = await fixture.tool.execute({
        mode: 'cli_command',
        cliCommand: 'goodvibes-agent status --json --config surfaces.slack.botToken=xoxb-secret-value',
      });
      expect(parsed.success).toBe(true);
      expect(parsed.output).toContain('"name": "status"');
      expect(parsed.output).toContain('"resolvedBy": "invocation"');
      expect(parsed.output).toContain('"outputFormat": "json"');
      expect(parsed.output).toContain('surfaces.slack.botToken=<redacted>');
      expect(parsed.output).not.toContain('xoxb-secret-value');

      const lookedUp = await fixture.tool.execute({
        mode: 'cli_command',
        query: 'Call isolated Agent Knowledge routes',
      });
      expect(lookedUp.success).toBe(true);
      expect(lookedUp.output).toContain('"name": "knowledge"');
      expect(lookedUp.output).toContain('"resolvedBy": "search"');
      expect(lookedUp.output).toContain('agent_knowledge or agent_knowledge_ingest');

      const ambiguous = await fixture.tool.execute({
        mode: 'cli_command',
        query: 'Agent',
      });
      expect(ambiguous.success).toBe(true);
      expect(ambiguous.output).toContain('"status": "ambiguous"');
      expect(ambiguous.output).toContain('"candidates"');
      expect(ambiguous.output).toContain('goodvibes-agent');

      const blocked = await fixture.tool.execute({ mode: 'cli_command', cliCommand: 'daemon start' });
      expect(blocked.success).toBe(true);
      expect(blocked.output).toContain('"supported": false');
      expect(blocked.output).toContain('Unsupported command: daemon');
      expect(blocked.output).toContain('connected-host');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes built-in panel catalog state and confirmation-gated routing', async () => {
    const fixture = makeFixture();
    try {
      fixture.panelManager.open('provider-health');

      const summary = await fixture.tool.execute({ mode: 'summary', includeParameters: true });
      expect(summary.success).toBe(true);
      expect(summary.output).toContain('"panels": 3');
      const summaryJson = JSON.parse(summary.output ?? '{}') as { readonly modelAccess?: { readonly panels?: string } };
      expect(summaryJson.modelAccess?.panels).toContain('mode:"panels"');

      const panels = await fixture.tool.execute({ mode: 'panels', category: 'monitoring' });
      expect(panels.success).toBe(true);
      expect(panels.output).toContain('"id": "provider-health"');
      expect(panels.output).toContain('"open": true');
      expect(panels.output).toContain('"command": "/agent"');
      expectCompactSummaryFields(JSON.parse(panels.output));
      expectModelFacingText(panels.output);
      const panelsPayload = JSON.parse(panels.output) as {
        readonly panels: readonly { readonly id?: string; readonly modelRoute?: string }[];
      };
      expect(panelsPayload.panels.filter((panel) => (
        typeof panel.modelRoute !== 'string'
        || panel.modelRoute.length === 0
        || panel.modelRoute.length > 72
      ))).toEqual([]);
      expect(panelsPayload.panels.find((panel) => panel.id === 'provider-health')?.modelRoute).toBe('agent_harness mode:"open_panel" or mode:"workspace_actions"');

      const panel = await fixture.tool.execute({ mode: 'panel', panelId: 'knowledge' });
      expect(panel.success).toBe(true);
      expect(panel.output).toContain('"categoryId": "knowledge"');
      expect(panel.output).toContain('"command": "/agent knowledge"');
      expectModelFacingText(panel.output);
      expect(JSON.parse(panel.output).modelRoute).toBe('agent_harness mode:"open_panel" or mode:"workspace_actions"');

      const panelByQuery = await fixture.tool.execute({ mode: 'panel', query: 'isolated Agent Knowledge' });
      expect(panelByQuery.success).toBe(true);
      const panelByQueryJson = JSON.parse(panelByQuery.output);
      expect(panelByQueryJson.id).toBe('knowledge');
      expect(panelByQueryJson.lookup).toEqual({
        source: 'query',
        input: 'isolated Agent Knowledge',
        resolvedBy: 'search',
      });

      const ambiguousPanel = await fixture.tool.execute({
        mode: 'open_panel',
        query: 'Agent',
        confirm: true,
        explicitUserRequest: 'Open an Agent panel.',
      });
      expect(ambiguousPanel.success).toBe(true);
      expect(ambiguousPanel.output).toContain('"status": "ambiguous_panel"');
      expect(ambiguousPanel.output).toContain('provider-health');
      expect(fixture.routedPanels).toEqual([]);

      const denied = await fixture.tool.execute({
        mode: 'open_panel',
        panelId: 'knowledge',
        explicitUserRequest: 'Show the knowledge panel.',
      });
      expect(denied.success).toBe(false);
      expect(denied.error).toContain('confirm:true');
      expect(fixture.routedPanels).toEqual([]);

      const routed = await fixture.tool.execute({
        mode: 'open_panel',
        panelId: 'knowledge',
        pane: 'bottom',
        confirm: true,
        explicitUserRequest: 'Show the knowledge panel.',
      });
      expect(routed.success).toBe(true);
      expect(routed.output).toContain('"status": "routed"');
      expectModelFacingText(routed.output);
      expect(fixture.routedPanels).toEqual([{ panelId: 'knowledge', pane: 'bottom' }]);
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes modal and picker UI surfaces with confirmation-gated visible routing', async () => {
    const fixture = makeFixture();
    try {
      const summary = await fixture.tool.execute({ mode: 'summary', includeParameters: true });
      expect(summary.success).toBe(true);
      expect(summary.output).toContain('"uiSurfaces"');
      const summaryJson = JSON.parse(summary.output ?? '{}') as { readonly modelAccess?: { readonly uiSurfaces?: string } };
      expect(summaryJson.modelAccess?.uiSurfaces).toContain('mode:"ui_surfaces"');

      const catalog = await fixture.tool.execute({ mode: 'ui_surfaces', query: 'picker' });
      expect(catalog.success).toBe(true);
      expect(catalog.output).toContain('"id": "model-picker"');
      expect(catalog.output).toContain('"id": "provider-picker"');
      expect(catalog.output).toContain('"id": "reasoning-effort-picker"');
      expect(catalog.output).toContain('"id": "tts-provider-picker"');
      expect(catalog.output).toContain('"id": "tts-voice-picker"');
      expect(catalog.output).toContain('"id": "file-picker"');
      expect(catalog.output).toContain('modelRoute');
      expect(catalog.output).not.toContain('preferredModelRoute');
      expectCompactSummaryFields(JSON.parse(catalog.output));
      expectModelFacingText(catalog.output);
      const catalogJson = JSON.parse(catalog.output) as {
        readonly surfaces: readonly { readonly id?: string; readonly modelRoute?: string }[];
      };
      expect(catalogJson.surfaces.filter((surface) => (
        typeof surface.modelRoute !== 'string'
        || surface.modelRoute.length === 0
        || surface.modelRoute.length > 72
      ))).toEqual([]);
      expect(catalogJson.surfaces.find((surface) => surface.id === 'model-picker')?.modelRoute).toBe('agent_harness mode:"settings" or mode:"run_command"');

      const searchSurfaces = await fixture.tool.execute({ mode: 'ui_surfaces', query: 'search' });
      expect(searchSurfaces.success).toBe(true);
      expect(searchSurfaces.output).toContain('"id": "conversation-search"');
      expect(searchSurfaces.output).toContain('"id": "prompt-history-search"');

      const commandSurfaces = await fixture.tool.execute({ mode: 'ui_surfaces', query: 'slash-command' });
      expect(commandSurfaces.success).toBe(true);
      expect(commandSurfaces.output).toContain('"id": "slash-command-mode"');

      const commandBrowserSurfaces = await fixture.tool.execute({ mode: 'ui_surfaces', query: 'command browser' });
      expect(commandBrowserSurfaces.success).toBe(true);
      expect(commandBrowserSurfaces.output).toContain('"id": "command-browser"');

      const blockSurfaces = await fixture.tool.execute({ mode: 'ui_surfaces', query: 'block action' });
      expect(blockSurfaces.success).toBe(true);
      expect(blockSurfaces.output).toContain('"id": "block-actions"');

      const operatorSurfaces = await fixture.tool.execute({ mode: 'ui_surfaces', query: 'operator' });
      expect(operatorSurfaces.success).toBe(true);
      expect(operatorSurfaces.output).toContain('"id": "panel-picker"');
      expect(operatorSurfaces.output).toContain('"id": "security-panel"');
      expect(operatorSurfaces.output).toContain('"id": "knowledge-panel"');
      expect(operatorSurfaces.output).toContain('"id": "subscription-panel"');

      const activitySurfaces = await fixture.tool.execute({ mode: 'ui_surfaces', query: 'activity' });
      expect(activitySurfaces.success).toBe(true);
      expect(activitySurfaces.output).toContain('"id": "process-monitor"');
      expect(activitySurfaces.output).toContain('Visible running-process and live-output monitor.');
      expect(activitySurfaces.output).toContain('first-class tools or agent_harness mode:\\"open_ui_surface\\"');

      const outputSurfaces = await fixture.tool.execute({ mode: 'ui_surfaces', query: 'live-output' });
      expect(outputSurfaces.success).toBe(true);
      expect(outputSurfaces.output).toContain('"id": "live-tail"');

      const settings = await fixture.tool.execute({ mode: 'ui_surface', surfaceId: 'settings' });
      expect(settings.success).toBe(true);
      const settingsJson = JSON.parse(settings.output ?? '{}') as {
        readonly id?: string;
        readonly modelRoute?: string;
        readonly preferredModelRoute?: string;
      };
      expect(settingsJson.id).toBe('settings');
      expect(settingsJson.modelRoute).toBe('agent_harness mode:"settings" or mode:"open_ui_surface"');
      expect(settingsJson.preferredModelRoute).toContain('mode:"settings", mode:"get_setting", mode:"set_setting", mode:"reset_setting"');
      expect(settingsJson.preferredModelRoute).not.toContain('settings/get_setting/set_setting/reset_setting');
      expectModelFacingText(settings.output);

      const settingsByQuery = await fixture.tool.execute({
        mode: 'ui_surface',
        query: 'fullscreen settings workspace',
      });
      expect(settingsByQuery.success).toBe(true);
      const settingsByQueryJson = JSON.parse(settingsByQuery.output);
      expect(settingsByQueryJson.id).toBe('settings');
      expect(settingsByQueryJson.lookup).toEqual({
        source: 'query',
        input: 'fullscreen settings workspace',
        resolvedBy: 'search',
      });

      const denied = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'settings',
        target: 'provider.model',
        explicitUserRequest: 'Open settings for the model setting.',
      });
      expect(denied.success).toBe(false);
      expect(denied.error).toContain('confirm:true');
      expect(fixture.openedSurfaces).toEqual([]);

      const openedSettings = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'settings',
        target: 'provider.model',
        confirm: true,
        explicitUserRequest: 'Open settings for the model setting.',
      });
      expect(openedSettings.success).toBe(true);
      expect(openedSettings.output).toContain('"status": "opened"');
      expectModelFacingText(openedSettings.output);
      expect(fixture.openedSurfaces).toEqual([{ id: 'settings', detail: 'provider.model' }]);

      const ambiguousSurface = await fixture.tool.execute({
        mode: 'open_ui_surface',
        query: 'picker',
        confirm: true,
        explicitUserRequest: 'Open a picker.',
      });
      expect(ambiguousSurface.success).toBe(true);
      expect(ambiguousSurface.output).toContain('"status": "ambiguous_ui_surface"');
      expect(ambiguousSurface.output).toContain('model-picker');
      expect(fixture.openedSurfaces).toEqual([{ id: 'settings', detail: 'provider.model' }]);

      const openedWorkspace = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'agent-workspace',
        categoryId: 'knowledge',
        confirm: true,
        explicitUserRequest: 'Open the Knowledge workspace.',
      });
      expect(openedWorkspace.success).toBe(true);
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'agent-workspace', detail: 'knowledge' });

      const openedPanelPicker = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'panel-picker',
        confirm: true,
        explicitUserRequest: 'Open the operator panel picker.',
      });
      expect(openedPanelPicker.success).toBe(true);
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'panel-picker', detail: 'home' });

      const openedSecurity = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'security-panel',
        confirm: true,
        explicitUserRequest: 'Open the security operator surface.',
      });
      expect(openedSecurity.success).toBe(true);
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'agent-workspace', detail: 'tools' });

      const openedKnowledge = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'knowledge-panel',
        confirm: true,
        explicitUserRequest: 'Open the knowledge operator surface.',
      });
      expect(openedKnowledge.success).toBe(true);
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'agent-workspace', detail: 'knowledge' });

      const openedSubscription = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'subscription-panel',
        confirm: true,
        explicitUserRequest: 'Open the subscription operator surface.',
      });
      expect(openedSubscription.success).toBe(true);
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'agent-workspace', detail: 'setup' });

      const openedProcessMonitor = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'process-monitor',
        confirm: true,
        explicitUserRequest: 'Open the runtime activity monitor.',
      });
      expect(openedProcessMonitor.success).toBe(true);
      expect(openedProcessMonitor.output).toContain('"status": "opened"');
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'process-monitor' });

      const openedLiveTail = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'live-tail',
        target: 'sleep',
        confirm: true,
        explicitUserRequest: 'Open live output for the running sleep process.',
      });
      expect(openedLiveTail.success).toBe(true);
      expect(openedLiveTail.output).toContain('"processId": "bg-test"');
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'live-tail', detail: 'sleep' });

      const openedConversationSearch = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'conversation-search',
        query: 'approval',
        confirm: true,
        explicitUserRequest: 'Open transcript search for approval.',
      });
      expect(openedConversationSearch.success).toBe(true);
      expect(openedConversationSearch.output).toContain('"query": "approval"');
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'conversation-search', detail: 'approval' });

      const openedPromptHistorySearch = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'prompt-history-search',
        query: 'deploy',
        confirm: true,
        explicitUserRequest: 'Open prompt history search for deploy.',
      });
      expect(openedPromptHistorySearch.success).toBe(true);
      expect(openedPromptHistorySearch.output).toContain('"query": "deploy"');
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'prompt-history-search', detail: 'deploy' });

      const openedSlashCommandMode = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'slash-command-mode',
        query: 'help',
        confirm: true,
        explicitUserRequest: 'Open slash command mode for help.',
      });
      expect(openedSlashCommandMode.success).toBe(true);
      expect(openedSlashCommandMode.output).toContain('"query": "help"');
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'slash-command-mode', detail: 'help' });

      const openedCommandBrowser = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'command-browser',
        confirm: true,
        explicitUserRequest: 'Open the command browser.',
      });
      expect(openedCommandBrowser.success).toBe(true);
      expect(openedCommandBrowser.output).toContain('"command": "/commands"');
      expect(fixture.openedSelections.at(-1)).toEqual({
        title: 'Help - Commands',
        itemIds: ['/brief'],
        preSelectId: undefined,
      });

      const openedFilePicker = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'file-picker',
        target: 'inject',
        query: 'src',
        confirm: true,
        explicitUserRequest: 'Open the file picker for raw source injection.',
      });
      expect(openedFilePicker.success).toBe(true);
      expect(openedFilePicker.output).toContain('"mode": "inject"');
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'file-picker', detail: 'inject:src' });

      const openedReasoningEffort = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'reasoning-effort-picker',
        confirm: true,
        explicitUserRequest: 'Open the reasoning effort picker.',
      });
      expect(openedReasoningEffort.success).toBe(true);
      expect(openedReasoningEffort.output).toContain('"model": "Reasoning Model"');
      expect(fixture.openedSelections.at(-1)).toEqual({
        title: 'Reasoning Effort',
        itemIds: ['low', 'medium', 'high'],
        preSelectId: 'medium',
      });

      const openedBlockActions = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'block-actions',
        confirm: true,
        explicitUserRequest: 'Open block actions for the nearest transcript block.',
      });
      expect(openedBlockActions.success).toBe(true);
      expect(openedBlockActions.output).toContain('"surface": "block-actions"');
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'block-actions' });

      fixture.configManager.setDynamic('tts.provider', 'stream-voice');
      fixture.configManager.setDynamic('tts.voice', '');
      const openedTtsProvider = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'tts-provider-picker',
        confirm: true,
        explicitUserRequest: 'Open the TTS provider picker.',
      });
      expect(openedTtsProvider.success).toBe(true);
      expect(openedTtsProvider.output).toContain('"status": "opened"');
      expect(fixture.openedSelections.at(-1)).toEqual({
        title: 'Choose TTS Provider',
        itemIds: ['stream-voice'],
        preSelectId: 'stream-voice',
      });

      const openedTtsProviderByQuery = await fixture.tool.execute({
        mode: 'open_ui_surface',
        query: 'streaming TTS provider picker',
        confirm: true,
        explicitUserRequest: 'Open the TTS provider picker.',
      });
      expect(openedTtsProviderByQuery.success).toBe(true);
      expect(openedTtsProviderByQuery.output).toContain('"status": "opened"');
      expect(openedTtsProviderByQuery.output).toContain('"source": "query"');

      const openedTtsVoice = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'tts-voice-picker',
        target: 'stream-voice',
        confirm: true,
        explicitUserRequest: 'Open the TTS voice picker for stream-voice.',
      });
      expect(openedTtsVoice.success).toBe(true);
      expect(openedTtsVoice.output).toContain('"providerId": "stream-voice"');
      expect(fixture.openedSelections.at(-1)).toEqual({
        title: 'Choose TTS Voice (stream-voice)',
        itemIds: ['__default__', 'stream-voice-voice-a', 'stream-voice-voice-b'],
        preSelectId: '__default__',
      });
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes shortcuts and confirmation-gated keybinding edits', async () => {
    const fixture = makeFixture();
    try {
      const summary = await fixture.tool.execute({ mode: 'summary', includeParameters: true });
      expect(summary.success).toBe(true);
      expect(summary.output).toContain('"shortcuts"');
      const summaryJson = JSON.parse(summary.output ?? '{}') as { readonly modelAccess?: { readonly shortcuts?: string } };
      expect(summaryJson.modelAccess?.shortcuts).toContain('mode:"shortcuts"');
      expect(summaryJson.modelAccess?.shortcuts).toContain('mode:"run_keybinding"');

      const shortcuts = await fixture.tool.execute({ mode: 'shortcuts', query: 'help' });
      expect(shortcuts.success).toBe(true);
      expect(shortcuts.output).toContain('"fixedShortcuts"');
      expect(shortcuts.output).toContain('? / F1');
      expect(shortcuts.output).toContain('"configurableKeybindings"');

      const processShortcut = await fixture.tool.execute({ mode: 'shortcuts', query: 'runtime activity' });
      expect(processShortcut.success).toBe(true);
      expect(processShortcut.output).toContain('"key": "F2"');
      expect(processShortcut.output).toContain('Open runtime activity monitor');

      const shortcutsReference = await fixture.tool.execute({ mode: 'shortcuts', query: 'shortcut reference' });
      expect(shortcutsReference.success).toBe(true);
      expect(shortcutsReference.output).toContain('"key": "/shortcuts"');
      expect(shortcutsReference.output).toContain('Open keyboard shortcut reference');

      const keybinding = await fixture.tool.execute({ mode: 'keybinding', actionId: 'search' });
      expect(keybinding.success).toBe(true);
      expect(keybinding.output).toContain('"action": "search"');
      expect(keybinding.output).toContain('Ctrl+F');
      expect(keybinding.output).toContain('"customized": false');
      expect(keybinding.output).toContain('"modelOperation"');
      expect(keybinding.output).toContain('"preferredMode": "run_keybinding"');
      expect(keybinding.output).toContain('"surfaceId": "conversation-search"');

      const keybindingCatalog = await fixture.tool.execute({ mode: 'keybindings', limit: 500 });
      expect(keybindingCatalog.success).toBe(true);
      expectModelFacingText(shortcuts.output);
      expectModelFacingText(keybindingCatalog.output);
      expectModelFacingText(keybinding.output);

      const keybindingByQuery = await fixture.tool.execute({ mode: 'keybinding', query: 'Ctrl+F' });
      expect(keybindingByQuery.success).toBe(true);
      const keybindingByQueryJson = JSON.parse(keybindingByQuery.output);
      expect(keybindingByQueryJson.action).toBe('search');
      expect(keybindingByQueryJson.lookup).toEqual({
        source: 'query',
        input: 'Ctrl+F',
        resolvedBy: 'search',
      });

      const ambiguousKeybinding = await fixture.tool.execute({ mode: 'keybinding', query: 'workspace' });
      expect(ambiguousKeybinding.success).toBe(true);
      expect(ambiguousKeybinding.output).toContain('"status": "ambiguous"');
      expect(ambiguousKeybinding.output).toContain('panel-picker');

      const runDenied = await fixture.tool.execute({
        mode: 'run_keybinding',
        actionId: 'search',
        explicitUserRequest: 'Open conversation search.',
      });
      expect(runDenied.success).toBe(false);
      expect(runDenied.error).toContain('confirm:true');
      expect(fixture.openedSurfaces.filter((surface) => surface.id === 'conversation-search')).toEqual([]);

      const runSearch = await fixture.tool.execute({
        mode: 'run_keybinding',
        actionId: 'search',
        value: 'release notes',
        confirm: true,
        explicitUserRequest: 'Open conversation search for release notes.',
      });
      expect(runSearch.success).toBe(true);
      expect(runSearch.output).toContain('"status": "executed"');
      expect(runSearch.output).toContain('"effect": "conversation-search-opened"');
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'conversation-search', detail: 'release notes' });

      const dismissFixture = makeFixture({ dismissAgentWorkspace: true });
      try {
        const runDismiss = await dismissFixture.tool.execute({
          mode: 'run_keybinding',
          actionId: 'panel-close',
          confirm: true,
          explicitUserRequest: 'Dismiss the active Agent workspace.',
        });
        expect(runDismiss.success).toBe(true);
        expect(runDismiss.output).toContain('"status": "executed"');
        expect(runDismiss.output).toContain('"effect": "agent-workspace-dismissed"');
        expect(runDismiss.output).toContain('"route": "dismissAgentWorkspace"');
        expect(dismissFixture.openedSurfaces).toEqual([{ id: 'agent-workspace-dismissed', result: true }]);
      } finally {
        dismissFixture.cleanup();
      }

      const surfaceCount = fixture.openedSurfaces.length;
      const unsupportedRun = await fixture.tool.execute({
        mode: 'run_keybinding',
        actionId: 'undo',
        confirm: true,
        explicitUserRequest: 'Undo the last prompt edit.',
      });
      expect(unsupportedRun.success).toBe(true);
      expect(unsupportedRun.output).toContain('"status": "unsupported_keybinding_action"');
      expect(unsupportedRun.output).toContain('"preferredMode": "direct-user-interaction"');
      expect(fixture.openedSurfaces.length).toBe(surfaceCount);

      const denied = await fixture.tool.execute({
        mode: 'set_keybinding',
        actionId: 'search',
        combo: { key: 'g', ctrl: true },
        explicitUserRequest: 'Change search to Ctrl+G.',
      });
      expect(denied.success).toBe(false);
      expect(denied.error).toContain('confirm:true');
      expect(fixture.keybindingsManager.matches('search', { logicalName: 'f', ctrl: true })).toBe(true);

      const updated = await fixture.tool.execute({
        mode: 'set_keybinding',
        query: 'Ctrl+F',
        combo: { key: 'g', ctrl: true },
        confirm: true,
        explicitUserRequest: 'Change search to Ctrl+G.',
      });
      expect(updated.success).toBe(true);
      expect(updated.output).toContain('"status": "updated"');
      expect(updated.output).toContain('Ctrl+G');
      expect(updated.output).toContain('"resolvedBy": "search"');
      expect(updated.output).toContain('"customized": true');
      expect(fixture.keybindingsManager.matches('search', { logicalName: 'g', ctrl: true })).toBe(true);
      expect(fixture.keybindingsManager.matches('search', { logicalName: 'f', ctrl: true })).toBe(false);

      const reset = await fixture.tool.execute({
        mode: 'reset_keybinding',
        target: 'Toggle conversation search',
        confirm: true,
        explicitUserRequest: 'Reset search keybinding.',
      });
      expect(reset.success).toBe(true);
      expect(reset.output).toContain('"status": "reset"');
      expect(reset.output).toContain('Ctrl+F');
      expect(reset.output).toContain('"source": "target"');
      expect(reset.output).toContain('"customized": false');
      expect(fixture.keybindingsManager.matches('search', { logicalName: 'f', ctrl: true })).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  test('keeps keybinding discovery available when the live manager is absent', async () => {
    const fixture = makeFixture({ keybindings: false });
    try {
      const listed = await fixture.tool.execute({ mode: 'keybindings', query: 'conversation search' });
      expect(listed.success).toBe(true);
      const listedJson = JSON.parse(listed.output ?? '{}') as {
        readonly status?: string;
        readonly configPath?: string | null;
        readonly keybindings?: readonly { readonly action?: string; readonly source?: string }[];
      };
      expect(listedJson.status).toBe('degraded');
      expect(listedJson.configPath).toBeNull();
      expect(listedJson.keybindings?.[0]?.action).toBe('search');
      expect(listedJson.keybindings?.[0]?.source).toBe('default-fallback');

      const shortcut = await fixture.tool.execute({ mode: 'shortcuts', query: 'shortcut reference' });
      expect(shortcut.success).toBe(true);
      expect(shortcut.output).toContain('"key": "/shortcuts"');
      expect(shortcut.output).toContain('"status": "degraded"');

      const single = await fixture.tool.execute({ mode: 'keybinding', query: 'Ctrl+F' });
      expect(single.success).toBe(true);
      expect(single.output).toContain('"status": "degraded"');
      expect(single.output).toContain('"action": "search"');
      expect(single.output).toContain('Default keybinding descriptor only');

      const run = await fixture.tool.execute({
        mode: 'run_keybinding',
        actionId: 'search',
        confirm: true,
        explicitUserRequest: 'Open conversation search.',
      });
      expect(run.success).toBe(false);
      expect(run.error).toContain('workspace.keybindingsManager is unavailable');
    } finally {
      fixture.cleanup();
    }
  });

  test('reports connected-host capabilities, boundaries, and model tool availability', async () => {
    const fixture = makeFixture();
    try {
      for (const name of [
        'agent_operator_briefing',
        'agent_operator_action',
        'agent_artifacts',
        'agent_knowledge',
        'agent_knowledge_ingest',
        'agent_channel_send',
        'agent_notify',
        'agent_autonomy_schedule',
        'agent_reminder_schedule',
        'agent_media_generate',
        'agent_model_compare',
        'agent_research_runs',
        'agent_research_sources',
        'agent_research_report',
      ]) {
        registerStubTool(fixture.toolRegistry, name);
      }

      const compactResult = await fixture.tool.execute({ mode: 'connected_host' });
      expect(compactResult.success).toBe(true);
      expect(compactResult.output).toContain('"counts"');
      expect(compactResult.output).not.toContain('/api/goodvibes-agent/knowledge/*');
      const compactJson = JSON.parse(compactResult.output ?? '{}') as { readonly modelRoute?: string };
      expectCompactModelRoute(compactJson.modelRoute);

      const daemonAlias = await fixture.tool.execute({ mode: 'daemon' });
      expect(daemonAlias.success).toBe(true);
      expect(JSON.parse(daemonAlias.output)).toEqual(JSON.parse(compactResult.output));

      const result = await fixture.tool.execute({ mode: 'connected_host', includeParameters: true });
      expect(result.success).toBe(true);
      expect(result.output).toContain('"routeFamilies"');
      expect(result.output).toContain('/api/goodvibes-agent/knowledge/*');
      expect(result.output).toContain('"capabilities"');
      expect(result.output).toContain('"agent_operator_action"');
      expect(result.output).toContain('"available": true');
      const expandedJson = JSON.parse(result.output ?? '{}') as {
        readonly capabilities?: readonly Record<string, unknown>[];
        readonly blockedCapabilities?: readonly Record<string, unknown>[];
        readonly routeFamilies?: readonly Record<string, unknown>[];
      };
      expectRowsHaveCompactModelRoutes(expandedJson.capabilities ?? []);
      expectRowsHaveCompactModelRoutes(expandedJson.blockedCapabilities ?? []);
      expectRowsHaveCompactModelRoutes(expandedJson.routeFamilies ?? []);
      expect(result.output).toContain('"blockedCapabilities"');
      expect(result.output).toContain('connected-host-lifecycle');
      expect(result.output).toContain('arbitrary-connected-host-mutations');

      const allowed = await fixture.tool.execute({
        mode: 'connected_host_capability',
        capabilityId: 'agent-knowledge-read',
      });
      expect(allowed.success).toBe(true);
      expect(allowed.output).toContain('"status": "allowed"');
      expect(allowed.output).toContain('"agent_knowledge"');
      expect(allowed.output).toContain('"sources"');
      expect(allowed.output).toContain('"map"');
      expect(allowed.output).toContain('"connector_doctor"');
      expect(allowed.output).toContain('/api/goodvibes-agent/knowledge/*');
      const allowedJson = JSON.parse(allowed.output ?? '{}') as { readonly modelRoute?: string };
      expect(allowedJson.modelRoute).toBe('agent_knowledge');

      const blocked = await fixture.tool.execute({
        mode: 'connected_host_capability',
        capabilityId: 'connected-host-lifecycle',
      });
      expect(blocked.success).toBe(true);
      expect(blocked.output).toContain('"status": "blocked"');
      expect(blocked.output).toContain('start');
      expect(blocked.output).toContain('not exposed to the model as an Agent operation');
      const blockedJson = JSON.parse(blocked.output ?? '{}') as { readonly modelRoute?: string };
      expectCompactModelRoute(blockedJson.modelRoute);

      const blockedByTarget = await fixture.tool.execute({
        mode: 'connected_host_capability',
        target: 'default-knowledge',
      });
      expect(blockedByTarget.success).toBe(true);
      expect(blockedByTarget.output).toContain('"status": "blocked"');
      expect(blockedByTarget.output).toContain('non-agent-knowledge');

      const ambiguous = await fixture.tool.execute({
        mode: 'connected_host_capability',
        query: 'agent',
      });
      expect(ambiguous.success).toBe(false);
      expect(ambiguous.error).toContain('Ambiguous connected-host capability agent');
      expect(ambiguous.error).toContain('agent-knowledge-read');
      expect(ambiguous.error).toContain('agent-knowledge-ingest');
      expect(ambiguous.error).toContain('modelRoute');

      const missing = await fixture.tool.execute({
        mode: 'connected_host_capability',
        capabilityId: 'not-a-capability',
      });
      expect(missing.success).toBe(false);
      expect(missing.error).toContain('Unknown connected-host capability');
    } finally {
      fixture.cleanup();
    }
  });

  test('describes shared lookup and confirmation parameters for model-visible harness modes', () => {
    const fixture = makeFixture();
    try {
      const properties = (fixture.tool.definition.parameters as {
        readonly properties: Record<string, { readonly description?: string }>;
      }).properties;
      expect(properties.query?.description).toContain('Catalog search text');
      expect(properties.target?.description).toContain('Generic lookup target');
      expect(properties.methodId?.description).toContain('Public operator or Agent Knowledge method id');
      expect(properties.endpointId?.description).toContain('Connected service endpoint id');
      expect(properties.confirm?.description).toContain('confirmed harness effects');
      expect(properties.explicitUserRequest?.description).toContain('confirmed harness effect');
    } finally {
      fixture.cleanup();
    }
  });

  test('reports live connected-host status without exposing the operator token', async () => {
    const fixture = makeFixture();
    const originalFetch = globalThis.fetch;
    const token = 'gvop-test-token-value';
    const requests: Array<{ readonly url: string; readonly authorization: string | null }> = [];
    try {
      writeFileSync(join(fixture.root, '.goodvibes', 'daemon', 'operator-tokens.json'), JSON.stringify({ token }));
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, authorization: readAuthorizationHeader(init?.headers) });
        if (url.endsWith('/status')) {
          return new Response(JSON.stringify({ status: 'running' }), { status: 200 });
        }
        if (url.endsWith('/api/goodvibes-agent/knowledge/status')) {
          return new Response(JSON.stringify({ ready: true }), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }) as typeof globalThis.fetch;

      const result = await fixture.tool.execute({ mode: 'connected_host_status' });
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);
      const payload = JSON.parse(result.output) as {
        readonly modelRoute?: string;
        readonly liveStatus: {
          readonly reachable: boolean;
          readonly compatible: boolean;
          readonly agentKnowledge: { readonly ready: boolean };
        };
        readonly operatorToken: {
          readonly usable: boolean;
          readonly fingerprint: string | null;
        };
      };
      expectCompactModelRoute(payload.modelRoute);
      expect(payload.liveStatus.reachable).toBe(true);
      expect(payload.operatorToken.usable).toBe(true);
      expect(payload.operatorToken.fingerprint?.startsWith('sha256:')).toBe(true);
      expect(result.output).not.toContain(token);

      const alias = await fixture.tool.execute({ mode: 'daemon_status' });
      expect(alias.success).toBe(true);
      if (!alias.success) throw new Error(alias.error);
      const aliasPayload = JSON.parse(alias.output) as typeof payload;
      expectCompactModelRoute(aliasPayload.modelRoute);
      expect(aliasPayload.liveStatus.reachable).toBe(true);
      expect(aliasPayload.operatorToken.usable).toBe(true);
      expect(alias.output).not.toContain(token);
      expect(requests.map((request) => request.url)).toEqual([
        'http://127.0.0.1:3421/status',
        'http://127.0.0.1:3421/api/goodvibes-agent/knowledge/status',
        'http://127.0.0.1:3421/status',
        'http://127.0.0.1:3421/api/goodvibes-agent/knowledge/status',
      ]);
      expect(requests.map((request) => request.authorization)).toEqual(Array(4).fill(`Bearer ${token}`));
    } finally {
      globalThis.fetch = originalFetch;
      fixture.cleanup();
    }
  });

  test('uses the canonical TUI editor schema for learned behavior actions', async () => {
    const fixture = makeFixture();
    try {
      const action = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'learned-behavior' });

      expect(action.success).toBe(true);
      expect(action.output).toContain('"editorKind": "learned-behavior"');
      expect(action.output).toContain('Ctrl-J inserts a new line.');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes a model-visible editor schema for every user-facing workspace editor action', async () => {
    const fixture = makeFixture();
    try {
      const editorActions = AGENT_WORKSPACE_CATEGORIES.flatMap((category) => (
        category.actions
          .filter((action) => action.kind === 'editor' && action.editorKind)
          .map((action) => ({ category, action }))
      ));

      expect(editorActions.length).toBeGreaterThan(0);
      for (const { action } of editorActions) {
        const result = await fixture.tool.execute({ mode: 'workspace_action', actionId: action.id });
        expect(result.success, action.id).toBe(true);
        expect(result.output, action.id).toContain('"editor"');
        expect(result.output, action.id).toContain('"fields"');
        expect(result.output, action.id).toContain('"modelExecution"');
      }

      const compare = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'document-run-compare' });
      expect(compare.success).toBe(true);
      expect(compare.output).toContain('"id": "artifactId"');
      expect(compare.output).toContain('Optional saved text artifact id');
    } finally {
      fixture.cleanup();
    }
  });

  test('classifies workspace editor model execution routes by route type', async () => {
    const fixture = makeFixture();
    try {
      const local = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'memory-create' });
      const commandBacked = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'conversation-save' });
      const promptBacked = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'research-main' });
      const researchRun = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'research-start-run' });
      const researchSource = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'research-add-source' });
      const researchReport = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'research-save-report' });
      const directLocal = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'learned-behavior' });
      const profile = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'runtime-profile-create' });

      expect(local.success).toBe(true);
      expect(commandBacked.success).toBe(true);
      expect(promptBacked.success).toBe(true);
      expect(researchRun.success).toBe(true);
      expect(researchSource.success).toBe(true);
      expect(researchReport.success).toBe(true);
      expect(directLocal.success).toBe(true);
      expect(profile.success).toBe(true);

      expect(JSON.parse(local.output).modelExecution).toMatchObject({
        route: 'agent_local_registry',
        tool: 'agent_local_registry',
        domain: 'memory',
      });
      expect(JSON.parse(commandBacked.output).modelExecution).toMatchObject({
        route: 'slash-command-dispatch',
        dispatcher: 'run_command',
        confirmation: 'required',
      });
      expect(JSON.parse(promptBacked.output).modelExecution).toMatchObject({
        route: 'main-conversation-prompt',
        result: 'prompt',
        confirmation: 'not-required',
      });
      expect(JSON.parse(researchRun.output).modelExecution).toMatchObject({
        route: 'agent_research_runs',
        tool: 'agent_research_runs',
        action: 'create_research_run',
        confirmation: 'required',
      });
      expect(JSON.parse(researchSource.output).modelExecution).toMatchObject({
        route: 'agent_research_sources',
        tool: 'agent_research_sources',
        action: 'add_source_candidate',
        confirmation: 'required',
      });
      expect(JSON.parse(researchReport.output).modelExecution).toMatchObject({
        route: 'agent_research_report',
        tool: 'agent_research_report',
        action: 'save_research_report_artifact',
        confirmation: 'required',
      });
      expect(JSON.parse(directLocal.output).modelExecution).toMatchObject({
        route: 'direct-agent-local-create',
        action: 'create_learned_behavior',
      });
      expect(JSON.parse(profile.output).modelExecution).toMatchObject({
        route: 'slash-command-dispatch',
        command: '/agent-profile create <name> [--template <template>] --yes',
      });
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes model execution metadata for every local workspace action', async () => {
    const fixture = makeFixture();
    try {
      const localActions = AGENT_WORKSPACE_CATEGORIES.flatMap((category) => (
        category.actions
          .filter((action) => action.kind === 'local-selection' || action.kind === 'local-operation')
          .map((action) => ({ category, action }))
      ));

      expect(localActions.length).toBeGreaterThan(0);
      for (const { action } of localActions) {
        const result = await fixture.tool.execute({ mode: 'workspace_action', actionId: action.id });
        expect(result.success, action.id).toBe(true);
        expect(result.output, action.id).toContain('"modelExecution"');
        expect(result.output.includes('agent_local_registry') || result.output.includes('agent_knowledge_ingest'), action.id).toBe(true);
      }
    } finally {
      fixture.cleanup();
    }
  });

  test('requires confirmation before invoking slash commands through the harness', async () => {
    const fixture = makeFixture();
    try {
      const preview = await fixture.tool.execute({
        mode: 'run_command',
        command: '/brief',
        explicitUserRequest: 'Show the briefing.',
      });
      expect(preview.success).toBe(false);
      expect(preview.error).toContain('confirm:true');
      expect(fixture.printed).toEqual([]);

      const executed = await fixture.tool.execute({
        mode: 'run_command',
        command: '/brief',
        confirm: true,
        explicitUserRequest: 'Show the briefing.',
      });
      expect(executed.success).toBe(true);
      expect(executed.output).toContain('Command /brief completed.');
      expect(executed.output).toContain('briefing output');
    } finally {
      fixture.cleanup();
    }
  });

  test('runs slash commands through the shared command lookup resolver', async () => {
    const fixture = makeFixture();
    try {
      fixture.commandRegistry.register({
        name: 'echoargs',
        description: 'Echo command arguments for resolver coverage',
        handler: (args, ctx) => {
          ctx.print(`args:${args.join('|')}`);
        },
      });
      fixture.commandRegistry.register({
        name: 'memory',
        aliases: ['mem'],
        description: 'Manage Agent-local memory records',
        usage: '<action>',
        handler: (_args, ctx) => {
          ctx.print('memory output');
        },
      });
      fixture.commandRegistry.register({
        name: 'memory-review',
        description: 'Review Agent-local memory records',
        usage: '<id>',
        handler: (_args, ctx) => {
          ctx.print('memory review output');
        },
      });

      const byCommandName = await fixture.tool.execute({
        mode: 'run_command',
        commandName: 'ECHOARGS',
        args: ['one', 'two'],
        confirm: true,
        explicitUserRequest: 'Run echoargs with two arguments.',
      });
      expect(byCommandName.success).toBe(true);
      expect(byCommandName.output).toContain('Command /echoargs completed.');
      expect(byCommandName.output).toContain('Resolved by commandName case-insensitive-name.');
      expect(byCommandName.output).toContain('args:one|two');

      const byQuery = await fixture.tool.execute({
        mode: 'run_command',
        query: 'Test briefing command',
        confirm: true,
        explicitUserRequest: 'Show the briefing.',
      });
      expect(byQuery.success).toBe(true);
      expect(byQuery.output).toContain('Command /brief completed.');
      expect(byQuery.output).toContain('Resolved by query description.');
      expect(byQuery.output).toContain('briefing output');

      const ambiguous = await fixture.tool.execute({
        mode: 'run_command',
        query: 'Agent-local memory records',
        confirm: true,
        explicitUserRequest: 'Run the memory command.',
      });
      expect(ambiguous.success).toBe(false);
      expect(ambiguous.error).toContain('Ambiguous slash command');
      expect(ambiguous.error).toContain('"name":"memory"');
      expect(ambiguous.error).toContain('"name":"memory-review"');
      expect(fixture.printed).not.toContain('memory output');
      expect(fixture.printed).not.toContain('memory review output');
    } finally {
      fixture.cleanup();
    }
  });

  test('inspects one slash command from typed command, target, query, and alias lookups', async () => {
    const fixture = makeFixture();
    try {
      fixture.commandRegistry.register({
        name: 'memory',
        aliases: ['mem'],
        description: 'Manage Agent-local memory records',
        usage: '<action>',
        handler: () => {},
      });
      fixture.commandRegistry.register({
        name: 'memory-review',
        description: 'Review Agent-local memory records',
        usage: '<id>',
        handler: () => {},
      });

      const typed = await fixture.tool.execute({ mode: 'command', command: '/mem list --reviewed' });
      expect(typed.success).toBe(true);
      if (!typed.success) throw new Error(typed.error);
      const typedPayload = JSON.parse(typed.output) as {
        readonly name: string;
        readonly lookup: {
          readonly source: string;
          readonly parsedName: string;
          readonly parsedArgs: readonly string[];
          readonly resolvedBy: string;
        };
        readonly policy: { readonly preferredModelTool?: string };
      };
      expect(typedPayload.name).toBe('memory');
      expect(typedPayload.lookup.source).toBe('command');
      expect(typedPayload.lookup.parsedName).toBe('mem');
      expect(typedPayload.lookup.parsedArgs).toEqual(['list', '--reviewed']);
      expect(typedPayload.lookup.resolvedBy).toBe('alias');
      expect(typedPayload.policy.preferredModelTool).toBe('agent_local_registry');

      const target = await fixture.tool.execute({ mode: 'command', target: '/BRIEF' });
      expect(target.success).toBe(true);
      expect(target.output).toContain('"resolvedBy": "case-insensitive-name"');
      expect(target.output).toContain('"name": "brief"');

      const described = await fixture.tool.execute({ mode: 'command', query: 'Test briefing command' });
      expect(described.success).toBe(true);
      expect(described.output).toContain('"resolvedBy": "description"');
      expect(described.output).toContain('"name": "brief"');

      const ambiguous = await fixture.tool.execute({ mode: 'command', query: 'Agent-local memory records' });
      expect(ambiguous.success).toBe(true);
      expect(ambiguous.output).toContain('"status": "ambiguous"');
      expect(ambiguous.output).toContain('"name": "memory"');
      expect(ambiguous.output).toContain('"name": "memory-review"');

      const missing = await fixture.tool.execute({ mode: 'command', query: 'not-a-command' });
      expect(missing.success).toBe(false);
      expect(missing.error).toContain('Unknown slash command');
      expect(missing.error).toContain('mode:"commands"');
    } finally {
      fixture.cleanup();
    }
  });

  test('assigns concrete model policy metadata to every built-in slash command', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const unknownPolicies = registry.list()
      .filter((command) => describeCommandPolicy(command.name).effect === 'unknown')
      .map((command) => command.name)
      .sort((a, b) => a.localeCompare(b));
    expect(unknownPolicies).toEqual([]);

    const missingPreferredRoutes = registry.list()
      .filter((command) => !describeCommandPolicy(command.name).preferredModelTool)
      .map((command) => command.name)
      .sort((a, b) => a.localeCompare(b));
    expect(missingPreferredRoutes).toEqual([]);

    const staleHarnessRoutes = registry.list()
      .map((command) => [command.name, describeCommandPolicy(command.name).preferredModelTool ?? ''] as const)
      .filter(([, route]) => /agent_harness (?!mode:")/.test(route))
      .map(([command, route]) => `${command}: ${route}`)
      .sort((a, b) => a.localeCompare(b));
    expect(staleHarnessRoutes).toEqual([]);

    expect(describeCommandPolicy('agent')).toMatchObject({
      effect: 'ui-navigation',
      preferredModelTool: expect.stringContaining('workspace_actions'),
    });
    expect(describeCommandPolicy('brief')).toMatchObject({
      effect: 'read-only',
      preferredModelTool: 'agent_operator_briefing',
    });
    expect(describeCommandPolicy('refresh-models')).toMatchObject({
      effect: 'external-network',
    });
    expect(describeCommandPolicy('export')).toMatchObject({
      effect: 'local-state',
      preferredModelTool: expect.stringContaining('workspace_actions'),
    });
    expect(describeCommandPolicy('delegate')).toMatchObject({
      effect: 'delegated-work',
      preferredModelTool: expect.stringContaining('run_workspace_action'),
    });
    expect(describeCommandPolicy('next-error')).toMatchObject({
      effect: 'ui-navigation',
      preferredModelTool: 'agent_harness mode:"run_command"',
    });
    expect(describeCommandPolicy('clear')).toMatchObject({
      effect: 'session-lifecycle',
      preferredModelTool: expect.stringContaining('run_command'),
    });
    expect(describeCommandPolicy('notes')).toMatchObject({
      effect: 'ui-navigation',
      preferredModelTool: expect.stringContaining('agent_local_registry'),
    });
    expect(describeCommandPolicy('bookmarks')).toMatchObject({
      effect: 'ui-navigation',
      preferredModelTool: expect.stringContaining('open_ui_surface'),
    });
    expect(describeCommandPolicy('bookmarks').preferredModelTool).toContain('run_command');
    expect(describeCommandPolicy('keybindings')).toMatchObject({
      effect: 'read-only',
      preferredModelTool: expect.stringContaining('run_keybinding'),
    });
  });

  test('assigns preferred model routes to every supported top-level CLI mirror', () => {
    const missingPreferredRoutes = listGoodVibesCliCommands()
      .filter((command) => command !== 'unknown')
      .filter((command) => !describeCliCommandPolicy(command).preferredModelTool)
      .sort((a, b) => a.localeCompare(b));
    expect(missingPreferredRoutes).toEqual([]);

    const staleHarnessRoutes = listGoodVibesCliCommands()
      .filter((command) => command !== 'unknown')
      .map((command) => [command, describeCliCommandPolicy(command).preferredModelTool ?? ''] as const)
      .filter(([, route]) => /agent_harness (?!mode:")/.test(route))
      .map(([command, route]) => `${command}: ${route}`)
      .sort((a, b) => a.localeCompare(b));
    expect(staleHarnessRoutes).toEqual([]);

    expect(describeCliCommandPolicy('run')).toMatchObject({
      effect: 'mixed',
      preferredModelTool: expect.stringContaining('current Agent conversation'),
    });
    expect(describeCliCommandPolicy('delegate')).toMatchObject({
      effect: 'delegated-work',
      preferredModelTool: expect.stringContaining('run_workspace_action'),
    });
    expect(describeCliCommandPolicy('pair')).toMatchObject({
      effect: 'external-network',
      preferredModelTool: expect.stringContaining('workspace_actions'),
    });
    expect(describeCliCommandPolicy('secrets')).toMatchObject({
      effect: 'mixed',
      preferredModelTool: expect.stringContaining('settings'),
    });
    expect(describeCliCommandPolicy('subscription')).toMatchObject({
      effect: 'mixed',
      preferredModelTool: expect.stringContaining('workspace_actions'),
    });
  });

  test('runs command-backed workspace actions through id and command lookups', async () => {
    const fixture = makeFixture();
    const originalFetch = globalThis.fetch;
    try {
      const byId = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'brief',
        confirm: true,
        explicitUserRequest: 'Open the operator briefing.',
      });

      expect(byId.success).toBe(true);
      expect(byId.output).toContain('Command /brief completed.');
      expect(byId.output).toContain('briefing output');

      const byCommand = await fixture.tool.execute({
        mode: 'run_workspace_action',
        command: '/brief',
        confirm: true,
        explicitUserRequest: 'Open the operator briefing.',
      });

      expect(byCommand.success).toBe(true);
      expect(byCommand.output).toContain('Command /brief completed.');
      expect(byCommand.output).toContain('briefing output');

      registerScheduleRuntimeCommands(fixture.commandRegistry);
      writeFileSync(join(fixture.root, '.goodvibes', 'daemon', 'operator-tokens.json'), JSON.stringify({ token: 'schedule-edit-token' }));
      const requests: Array<{ readonly url: string; readonly method: string; readonly body: string }> = [];
      globalThis.fetch = (async (input, init) => {
        requests.push({
          url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
          method: init?.method ?? 'GET',
          body: typeof init?.body === 'string' ? init.body : '',
        });
        return new Response(JSON.stringify({
          id: 'sched-live-1',
          name: 'Daily queue review',
          labels: [],
          createdAt: 1,
          updatedAt: 2,
          status: 'enabled',
          enabled: true,
          schedule: { kind: 'every', intervalMs: 86_400_000 },
          execution: { prompt: 'updated prompt', target: { kind: 'main' } },
          delivery: { mode: 'none', targets: [], fallbackTargets: [], includeSummary: true, includeTranscript: false, includeLinks: true },
          failure: {
            action: 'retry',
            maxConsecutiveFailures: 3,
            cooldownMs: 3_600_000,
            retryPolicy: { maxAttempts: 2, delayMs: 60_000, strategy: 'exponential' },
          },
          source: { id: 'source-sched-live-1', kind: 'schedule', label: 'schedule', enabled: true, createdAt: 1, updatedAt: 2, metadata: {} },
          runCount: 0,
          successCount: 0,
          failureCount: 0,
          deleteAfterRun: false,
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) satisfies typeof fetch;
      const scheduleEdit = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'schedule-edit',
        fields: {
          scheduleId: 'sched-live-1',
          scheduleKind: 'every',
          scheduleValue: '1d',
          scheduleName: 'Daily queue review',
          confirm: 'yes',
        },
        confirm: true,
        explicitUserRequest: 'Change schedule sched-live-1 to every day.',
      });

      expect(scheduleEdit.success).toBe(true);
      expect(scheduleEdit.output).toContain('Updated GoodVibes schedule');
      expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        'PATCH http://127.0.0.1:3421/api/automation/jobs/sched-live-1',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      fixture.cleanup();
    }
  });

  test('previews and applies GoodVibes settings import through workspace action route', async () => {
    const fixture = makeFixture();
    try {
      const nextSaveHistory = !Boolean(fixture.configManager.get('behavior.saveHistory'));
      mkdirSync(fixture.paths.resolveUserPath('tui'), { recursive: true });
      writeFileSync(fixture.paths.resolveUserPath('tui', 'settings.json'), JSON.stringify({
        behavior: { saveHistory: nextSaveHistory },
        surfaces: {
          slack: { botToken: 'xoxb-import-secret' },
        },
      }, null, 2));

      const preview = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'import-goodvibes-tui-settings',
      });
      expect(preview.success).toBe(true);
      expect(preview.output).toContain('"status": "confirmation_required"');
      expect(preview.output).toContain('"settingsToImport": 2');
      expect(preview.output).toContain('<redacted>');
      expect(preview.output).not.toContain('xoxb-import-secret');
      expect(fixture.configManager.get('behavior.saveHistory')).toBe(!nextSaveHistory);

      const missingUserRequest = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'import-goodvibes-tui-settings',
        confirm: true,
      });
      expect(missingUserRequest.success).toBe(false);
      expect(missingUserRequest.error).toContain('explicitUserRequest');

      const applied = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'import-goodvibes-tui-settings',
        confirm: true,
        explicitUserRequest: 'Import my existing GoodVibes settings into Agent.',
      });
      expect(applied.success).toBe(true);
      expect(applied.output).toContain('GoodVibes TUI settings imported');
      expect(applied.output).not.toContain('xoxb-import-secret');
      expect(fixture.configManager.get('behavior.saveHistory')).toBe(nextSaveHistory);
      expect(fixture.configManager.get('surfaces.slack.botToken')).toBe(
        buildGoodVibesSecretRef(buildGoodVibesSecretKey('surfaces.slack.botToken')),
      );
      expect(await fixture.secretsManager?.get(buildGoodVibesSecretKey('surfaces.slack.botToken'))).toBe('xoxb-import-secret');
    } finally {
      fixture.cleanup();
    }
  });

  test('runs workspace actions by target and query without guessing ambiguous requests', async () => {
    const fixture = makeFixture();
    try {
      const memoryRegistry = await createMemoryRegistry(fixture.paths, fixture.configManager);
      fixture.toolRegistry.register(createAgentLocalRegistryTool(fixture.paths, memoryRegistry));

      const targetRun = await fixture.tool.execute({
        mode: 'run_workspace_action',
        categoryId: 'notes',
        target: 'Create note',
        fields: {
          title: 'Lookup mirror note',
          body: 'Target lookup should execute the same workspace editor as an exact action id.',
          tags: 'harness,lookup',
        },
        confirm: true,
        explicitUserRequest: 'Create a note through workspace action lookup.',
      });
      expect(targetRun.success).toBe(true);
      expect(targetRun.output).toContain('"status": "executed_model_tool"');
      expect(targetRun.output).toContain('Created Agent-local note');
      const note = AgentNoteRegistry.fromShellPaths(fixture.paths).get('lookup-mirror-note');
      expect(note?.body).toContain('Target lookup should execute');

      const queryRun = await fixture.tool.execute({
        mode: 'run_workspace_action',
        query: 'durable non-secret default knowledge fallback',
        fields: {
          summary: 'Lookup execution preserves Agent-local memory only.',
          detail: 'Query lookup should execute the same workspace editor as an exact memory action id.',
          tags: 'harness,lookup',
        },
        confirm: true,
        explicitUserRequest: 'Create a memory through workspace action lookup.',
      });
      expect(queryRun.success).toBe(true);
      expect(queryRun.output).toContain('"status": "executed_model_tool"');
      expect(queryRun.output).toContain('Created Agent-local memory');
      expect(memoryRegistry.getAll().map((entry) => entry.summary)).toContain('Lookup execution preserves Agent-local memory only.');

      const ambiguous = await fixture.tool.execute({
        mode: 'run_workspace_action',
        query: 'memory',
        confirm: true,
        explicitUserRequest: 'Run the memory action.',
      });
      expect(ambiguous.success).toBe(false);
      expect(ambiguous.error).toContain('Ambiguous Agent workspace action memory');
      expect(ambiguous.error).toContain('memory-create');
    } finally {
      fixture.cleanup();
    }
  });

  test('routes selection-based local workspace actions through model tools', async () => {
    const fixture = makeFixture();
    try {
      const memoryRegistry = await createMemoryRegistry(fixture.paths, fixture.configManager);
      fixture.toolRegistry.register(createAgentLocalRegistryTool(fixture.paths, memoryRegistry));
      const note = AgentNoteRegistry.fromShellPaths(fixture.paths).create({
        title: 'Daily triage',
        body: 'Read the queue, sort urgent items first, and summarize blocked work.',
        tags: ['workflow'],
        source: 'agent',
        provenance: 'test',
      });

      const preview = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'notes-to-skill',
        recordId: note.id,
      });
      expect(preview.success).toBe(true);
      expect(preview.output).toContain('"status": "editor"');
      expect(preview.output).toContain('Create Skill From Note');
      expect(preview.output).toContain('Read the queue');

      const promoted = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'notes-to-skill',
        recordId: note.id,
        fields: { enabled: 'yes' },
        confirm: true,
        explicitUserRequest: 'Promote the triage note into a skill.',
      });
      expect(promoted.success).toBe(true);
      expect(promoted.output).toContain('executed_model_tool');
      const skill = AgentSkillRegistry.fromShellPaths(fixture.paths).get('daily-triage');
      expect(skill?.procedure).toContain('Read the queue');
      expect(skill?.enabled).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  test('runs direct local create workspace editors through model tools', async () => {
    const fixture = makeFixture();
    try {
      const memoryRegistry = await createMemoryRegistry(fixture.paths, fixture.configManager);
      fixture.toolRegistry.register(createAgentLocalRegistryTool(fixture.paths, memoryRegistry));

      const missingFields = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'notes-create',
        fields: { title: 'Source triage' },
        confirm: true,
        explicitUserRequest: 'Create a source-triage note.',
      });
      expect(missingFields.success).toBe(true);
      expect(missingFields.output).toContain('"status": "missing_required_fields"');
      expect(missingFields.output).toContain('"body"');

      const created = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'notes-create',
        fields: {
          title: 'Source triage',
          body: 'Capture reviewed sources before deciding what belongs in Agent Knowledge.',
          tags: 'research,triage',
        },
        confirm: true,
        explicitUserRequest: 'Create a source-triage note.',
      });
      expect(created.success).toBe(true);
      expect(created.output).toContain('"status": "executed_model_tool"');
      expect(created.output).toContain('Created Agent-local note');

      const note = AgentNoteRegistry.fromShellPaths(fixture.paths).get('source-triage');
      expect(note?.title).toBe('Source triage');
      expect(note?.body).toContain('reviewed sources');
      expect(note?.tags).toEqual(['research', 'triage']);
    } finally {
      fixture.cleanup();
    }
  });

  test('runs Agent document workspace editors through agent_documents', async () => {
    const artifacts = createHarnessArtifactStore();
    const fixture = makeFixture({ artifactStore: artifacts.store });
    try {
      fixture.toolRegistry.register(createAgentDocumentsTool(fixture.paths, artifacts.store));

      const unconfirmed = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-create-draft',
        confirm: true,
        explicitUserRequest: 'Create a launch document draft.',
        fields: {
          title: 'Launch Plan',
          body: 'Initial launch draft.',
          confirm: 'no',
        },
      });
      expect(unconfirmed.success).toBe(true);
      expect(unconfirmed.output).toContain('"status": "not_confirmed"');

      const created = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-create-draft',
        confirm: true,
        explicitUserRequest: 'Create a launch document draft.',
        fields: {
          title: 'Launch Plan',
          body: 'Initial launch draft.',
          tags: 'launch,docs',
          confirm: 'yes',
        },
      });
      expect(created.success).toBe(true);
      expect(created.output).toContain('"tool": "agent_documents"');
      expect(created.output).toContain('Created Agent document');
      expect(created.output).toContain('launch-plan');

      const revised = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-revise-draft',
        confirm: true,
        explicitUserRequest: 'Revise the launch document draft.',
        fields: {
          documentId: 'launch-plan',
          body: 'Initial launch draft.\n\nAdd rollout checklist.',
          changeSummary: 'Added rollout checklist.',
          confirm: 'yes',
        },
      });
      expect(revised.success).toBe(true);
      expect(revised.output).toContain('versions 2');

      const commented = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-comment-draft',
        confirm: true,
        explicitUserRequest: 'Add a review comment to the launch document draft.',
        fields: {
          documentId: 'launch-plan',
          comment: 'Confirm launch owner.',
          confirm: 'yes',
        },
      });
      expect(commented.success).toBe(true);
      expect(commented.output).toContain('"tool": "agent_documents"');
      expect(commented.output).toContain('Added Agent document comment');
      expect(commented.output).toContain('comment c1');

      const resolvedComment = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-resolve-comment',
        confirm: true,
        explicitUserRequest: 'Resolve the launch document review comment.',
        fields: {
          documentId: 'launch-plan',
          commentId: 'c1',
          confirm: 'yes',
        },
      });
      expect(resolvedComment.success).toBe(true);
      expect(resolvedComment.output).toContain('Resolved Agent document comment');

      const suggested = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-suggest-draft',
        confirm: true,
        explicitUserRequest: 'Propose an AI suggestion for the launch document draft.',
        fields: {
          documentId: 'launch-plan',
          body: 'Initial launch draft.\n\nAdd rollout checklist.\n\nOwner: Launch team.',
          changeSummary: 'Added launch owner.',
          suggestionRationale: 'The launch plan needs a visible owner before review.',
          confirm: 'yes',
        },
      });
      expect(suggested.success).toBe(true);
      expect(suggested.output).toContain('"tool": "agent_documents"');
      expect(suggested.output).toContain('Added Agent document suggestion');
      expect(suggested.output).toContain('suggestion s1');
      expect(suggested.output).toContain('versions 2');

      const acceptedSuggestion = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-accept-suggestion',
        confirm: true,
        explicitUserRequest: 'Accept the launch document suggestion.',
        fields: {
          documentId: 'launch-plan',
          suggestionId: 's1',
          confirm: 'yes',
        },
      });
      expect(acceptedSuggestion.success).toBe(true);
      expect(acceptedSuggestion.output).toContain('Accepted Agent document suggestion');
      expect(acceptedSuggestion.output).toContain('versions 3');

      const rejectCandidate = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-suggest-draft',
        confirm: true,
        explicitUserRequest: 'Propose a second launch document suggestion.',
        fields: {
          documentId: 'launch-plan',
          body: 'Rejected launch rewrite.',
          changeSummary: 'Alternative rewrite.',
          suggestionRationale: 'This is a less useful option.',
          confirm: 'yes',
        },
      });
      expect(rejectCandidate.success).toBe(true);
      expect(rejectCandidate.output).toContain('suggestion s2');

      const rejectedSuggestion = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-reject-suggestion',
        confirm: true,
        explicitUserRequest: 'Reject the second launch document suggestion.',
        fields: {
          documentId: 'launch-plan',
          suggestionId: 's2',
          confirm: 'yes',
        },
      });
      expect(rejectedSuggestion.success).toBe(true);
      expect(rejectedSuggestion.output).toContain('Rejected Agent document suggestion');
      expect(rejectedSuggestion.output).toContain('versions 3');

      const sourceArtifact = await artifacts.store.create({
        kind: 'document',
        mimeType: 'text/markdown',
        filename: 'source-note.md',
        text: 'Reusable source note.',
        metadata: { purpose: 'source-note' },
      });
      const attached = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-attach-artifact',
        confirm: true,
        explicitUserRequest: 'Attach the source artifact to the launch document draft.',
        fields: {
          documentId: 'launch-plan',
          artifactId: sourceArtifact.id,
          attachmentLabel: 'Source Note',
          attachmentNote: 'Reusable evidence for this draft.',
          confirm: 'yes',
        },
      });
      expect(attached.success).toBe(true);
      expect(attached.output).toContain('"tool": "agent_documents"');
      expect(attached.output).toContain('Attached artifact to Agent document');
      expect(attached.output).toContain('attachments 1');
      expect(attached.output).toContain('versions 3');

      const inserted = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-insert-artifact',
        confirm: true,
        explicitUserRequest: 'Insert the source artifact into the launch document draft.',
        fields: {
          documentId: 'launch-plan',
          artifactId: sourceArtifact.id,
          sectionTitle: 'Source Note',
          confirm: 'yes',
        },
      });
      expect(inserted.success).toBe(true);
      expect(inserted.output).toContain('"tool": "agent_documents"');
      expect(inserted.output).toContain('Inserted artifact into Agent document');
      expect(inserted.output).toContain('versions 4');

      const exported = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-export-draft',
        confirm: true,
        explicitUserRequest: 'Export the launch document draft.',
        fields: {
          documentId: 'launch-plan',
          confirm: 'yes',
        },
      });
      expect(exported.success).toBe(true);
      expect(exported.output).toContain('Exported Agent document');
      expect(artifacts.store.list(5)[0]?.metadata).toMatchObject({
        purpose: 'agent-document-export',
        documentId: 'launch-plan',
        attachmentIds: [sourceArtifact.id],
      });
    } finally {
      fixture.cleanup();
    }
  });

  test('runs artifact browser workspace editors through agent_artifacts', async () => {
    const artifacts = createHarnessArtifactStore();
    await artifacts.store.create({
      kind: 'data',
      mimeType: 'text/markdown',
      filename: 'comparison-export.md',
      text: 'Saved comparison report\n\nThe winning answer was more concrete.',
      metadata: {
        purpose: 'agent-model-compare-export',
        source: 'agent-model-compare',
        apiKey: 'not-for-transcript',
      },
    });
    await artifacts.store.create({
      kind: 'data',
      mimeType: 'application/json',
      filename: 'comparison-judgment.json',
      text: '{"winner":"A","reason":"More concrete"}',
      metadata: {
        purpose: 'agent-model-compare-judgment',
        source: 'agent-model-compare',
        secretToken: 'not-for-package',
      },
    });
    const fixture = makeFixture({ artifactStore: artifacts.store });
    try {
      fixture.toolRegistry.register(createAgentArtifactsTool(artifacts.store, { projectRoot: fixture.root }));
      registerStubTool(fixture.toolRegistry, 'agent_knowledge_ingest');

      const browse = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'artifact-browse',
        fields: {
          purpose: 'model-compare-export',
          limit: '10',
        },
      });
      expect(browse.success).toBe(true);
      expect(browse.output).toContain('"status": "executed_model_tool"');
      expect(browse.output).toContain('"tool": "agent_artifacts"');
      expect(browse.output).toContain('comparison-export.md');
      expect(browse.output).not.toContain('not-for-transcript');

      const show = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-show-artifact',
        fields: {
          artifactId: 'artifact-1',
          includeContent: 'yes',
          previewBytes: '48',
        },
      });
      expect(show.success).toBe(true);
      expect(show.output).toContain('"status": "executed_model_tool"');
      expect(show.output).toContain('"tool": "agent_artifacts"');
      const showPayload = JSON.parse(show.output ?? '{}') as { readonly output?: string | null };
      expect(showPayload.output).toContain('Saved comparison report');
      expect(showPayload.output).toContain('"apiKey": "<redacted>"');
      expect(showPayload.output).not.toContain('not-for-transcript');

      const unconfirmedExport = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'artifact-export-file',
        confirm: true,
        explicitUserRequest: 'Export the reviewed comparison artifact to a workspace file.',
        fields: {
          artifactId: 'artifact-1',
          destinationPath: 'exports/comparison-export.md',
          confirm: 'no',
        },
      });
      expect(unconfirmedExport.success).toBe(true);
      expect(unconfirmedExport.output).toContain('"status": "not_confirmed"');

      const artifactExport = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-export-artifact-file',
        confirm: true,
        explicitUserRequest: 'Export the reviewed comparison artifact to a workspace file.',
        fields: {
          artifactId: 'artifact-1',
          destinationPath: 'exports/comparison-export.md',
          confirm: 'yes',
        },
      });
      expect(artifactExport.success).toBe(true);
      expect(artifactExport.output).toContain('"tool": "agent_artifacts"');
      expect(artifactExport.output).toContain('Exported Agent artifact');
      expect(readFileSync(join(fixture.root, 'exports', 'comparison-export.md'), 'utf-8')).toContain('Saved comparison report');

      const unconfirmedPackage = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'artifact-export-package',
        confirm: true,
        explicitUserRequest: 'Export the reviewed comparison artifacts to a workspace package directory.',
        fields: {
          artifactIds: 'artifact-1\nartifact-2',
          destinationPath: 'exports/comparison-package',
          confirm: 'no',
        },
      });
      expect(unconfirmedPackage.success).toBe(true);
      expect(unconfirmedPackage.output).toContain('"status": "not_confirmed"');

      const packageExport = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-export-artifact-package',
        confirm: true,
        explicitUserRequest: 'Export the reviewed comparison artifacts to a workspace package directory.',
        fields: {
          artifactIds: 'artifact-1\nartifact-2',
          destinationPath: 'exports/comparison-package',
          confirm: 'yes',
        },
      });
      expect(packageExport.success).toBe(true);
      expect(packageExport.output).toContain('"tool": "agent_artifacts"');
      expect(packageExport.output).toContain('Exported Agent artifact package');
      const packageRoot = join(fixture.root, 'exports', 'comparison-package');
      expect(existsSync(join(packageRoot, 'README.md'))).toBe(true);
      const manifest = JSON.parse(readFileSync(join(packageRoot, 'manifest.json'), 'utf-8')) as {
        readonly artifacts: Array<{ readonly id: string; readonly file: string; readonly metadata: Record<string, unknown> }>;
      };
      expect(manifest.artifacts.map((entry) => entry.id)).toEqual(['artifact-1', 'artifact-2']);
      expect(manifest.artifacts[1]?.metadata.secretToken).toBe('<redacted>');
      const packageFile = manifest.artifacts.find((entry) => entry.id === 'artifact-2')?.file;
      expect(readFileSync(join(packageRoot, packageFile ?? ''), 'utf-8')).toContain('"winner"');
      expect(packageExport.output).not.toContain('not-for-package');

      const unconfirmedPromotion = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'artifact-promote-knowledge',
        confirm: true,
        explicitUserRequest: 'Promote the reviewed comparison artifact into Agent Knowledge.',
        fields: {
          artifactId: 'artifact-1',
          confirm: 'no',
        },
      });
      expect(unconfirmedPromotion.success).toBe(true);
      expect(unconfirmedPromotion.output).toContain('"status": "not_confirmed"');
      expect(unconfirmedPromotion.output).toContain('artifact-promote-knowledge');

      const promotion = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-promote-artifact',
        confirm: true,
        explicitUserRequest: 'Promote the reviewed comparison artifact into Agent Knowledge.',
        fields: {
          artifactId: 'artifact-1',
          title: 'Reviewed comparison report',
          tags: 'artifact,reviewed',
          confirm: 'yes',
        },
      });
      expect(promotion.success).toBe(true);
      expect(promotion.output).toContain('"status": "executed_model_tool"');
      expect(promotion.output).toContain('"tool": "agent_knowledge_ingest"');
      expect(promotion.output).toContain('agent_knowledge_ingest executed');
    } finally {
      fixture.cleanup();
    }
  });

  test('runs confirmed research report workspace editor through agent_research_report', async () => {
    const artifacts = createHarnessArtifactStore();
    const fixture = makeFixture({ artifactStore: artifacts.store });
    try {
      fixture.toolRegistry.register(createAgentResearchReportTool(artifacts.store));

      const unconfirmed = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'research-save-report',
        confirm: true,
        explicitUserRequest: 'Save the reviewed local-model research report.',
        fields: {
          title: 'Local Model Options',
          question: 'Which local model route should we try?',
          summary: 'Ollama is easiest.',
          sources: 'Ollama docs | https://example.test/ollama?token=secret | high | Official docs.',
          confirm: 'no',
        },
      });
      expect(unconfirmed.success).toBe(true);
      expect(unconfirmed.output).toContain('"status": "not_confirmed"');
      expect(unconfirmed.output).toContain('research-save-report');

      const saved = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'research-save-report',
        confirm: true,
        explicitUserRequest: 'Save the reviewed local-model research report.',
        fields: {
          title: 'Local Model Options',
          question: 'Which local model route should we try?',
          summary: 'Ollama is easiest.',
          reportMarkdown: 'Ollama is easiest [S1].',
          sources: 'Ollama docs | https://example.test/ollama?token=secret | high | Official docs.',
          findings: 'Use Ollama first.',
          gaps: 'Benchmark latency locally.',
          recommendations: 'Try Ollama before adding another provider.',
          methodology: 'Reviewed only source lines explicitly provided in the form.',
          confidence: 'medium',
          tags: 'research,local',
          confirm: 'yes',
        },
      });
      expect(saved.success).toBe(true);
      expect(saved.output).toContain('"status": "executed_model_tool"');
      expect(saved.output).toContain('"tool": "agent_research_report"');
      expect(saved.output).toContain('Saved Agent research report artifact');
      expect(saved.output).not.toContain('Ollama is easiest [S1].');
      expect(saved.output).not.toContain('token=secret');

      const artifact = artifacts.store.list(1)[0];
      expect(artifact?.filename).toBe('local-model-options.md');
      expect(artifact?.metadata).toMatchObject({
        purpose: 'agent-research-report',
        source: 'agent-research-report',
        title: 'Local Model Options',
        question: 'Which local model route should we try?',
        sourceCount: 1,
        tags: ['research', 'local'],
      });
      expect(JSON.stringify(artifact?.metadata)).toContain('token=%3Credacted%3E');
      expect(JSON.stringify(artifact?.metadata)).not.toContain('token=secret');
    } finally {
      fixture.cleanup();
    }
  });

  test('runs confirmed research source workspace editor through agent_research_sources', async () => {
    const fixture = makeFixture();
    try {
      fixture.toolRegistry.register(createAgentResearchSourcesTool(fixture.paths));

      const unconfirmed = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'research-add-source',
        confirm: true,
        explicitUserRequest: 'Add the reviewed Ollama source to the research queue.',
        fields: {
          question: 'Which local model route should we try?',
          title: 'Ollama docs',
          url: 'https://example.test/ollama?token=secret',
          summary: 'Official docs for the simplest local model setup.',
          confirm: 'no',
        },
      });
      expect(unconfirmed.success).toBe(true);
      expect(unconfirmed.output).toContain('"status": "not_confirmed"');
      expect(unconfirmed.output).toContain('research-add-source');

      const saved = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'research-add-source',
        confirm: true,
        explicitUserRequest: 'Add the reviewed Ollama source to the research queue.',
        fields: {
          question: 'Which local model route should we try?',
          title: 'Ollama docs',
          url: 'https://example.test/ollama?token=secret',
          publisher: 'Ollama',
          publishedAt: '2026-06-01',
          summary: 'Official docs for the simplest local model setup.',
          evidence: 'Setup is local and minimal.',
          credibility: 'high',
          score: '92',
          tags: 'research,local',
          note: 'Official source for the first recommendation.',
          confirm: 'yes',
        },
      });
      expect(saved.success).toBe(true);
      expect(saved.output).toContain('"status": "executed_model_tool"');
      expect(saved.output).toContain('"tool": "agent_research_sources"');
      expect(saved.output).toContain('Added Agent research source');
      expect(saved.output).not.toContain('token=secret');

      const source = AgentResearchSourceRegistry.fromShellPaths(fixture.paths).get('ollama-docs');
      expect(source?.question).toBe('Which local model route should we try?');
      expect(source?.url).toContain('token=%3Credacted%3E');
      expect(source?.url).not.toContain('token=secret');
      expect(source?.credibility).toBe('high');
      expect(source?.status).toBe('reviewed');
      expect(source?.score).toBe(92);
      expect(source?.tags).toEqual(['research', 'local']);
    } finally {
      fixture.cleanup();
    }
  });

  test('runs confirmed research run workspace editor through agent_research_runs', async () => {
    const fixture = makeFixture();
    try {
      fixture.toolRegistry.register(createAgentResearchRunsTool(fixture.paths));

      const unconfirmed = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'research-start-run',
        confirm: true,
        explicitUserRequest: 'Create a visible competitor research run.',
        fields: {
          title: 'Competitor Research',
          question: 'Which competitor features should we match?',
          goal: 'Produce a sourced parity plan.',
          confirm: 'no',
        },
      });
      expect(unconfirmed.success).toBe(true);
      expect(unconfirmed.output).toContain('"status": "not_confirmed"');
      expect(unconfirmed.output).toContain('research-start-run');

      const saved = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'research-start-run',
        confirm: true,
        explicitUserRequest: 'Create a visible competitor research run.',
        fields: {
          title: 'Competitor Research',
          question: 'Which competitor features should we match?',
          goal: 'Produce a sourced parity plan.',
          plan: 'Inventory OpenClaw\nInventory Hermes',
          nextSteps: 'Capture official source ids',
          sourceIds: 'openclaw-docs,hermes-docs',
          note: 'Visible run state only.',
          confirm: 'yes',
        },
      });
      expect(saved.success).toBe(true);
      expect(saved.output).toContain('"status": "executed_model_tool"');
      expect(saved.output).toContain('"tool": "agent_research_runs"');
      expect(saved.output).toContain('Created Agent research run');

      const run = AgentResearchRunRegistry.fromShellPaths(fixture.paths).get('competitor-research');
      expect(run?.question).toBe('Which competitor features should we match?');
      expect(run?.goal).toBe('Produce a sourced parity plan.');
      expect(run?.status).toBe('planned');
      expect(run?.plan).toEqual(['Inventory OpenClaw', 'Inventory Hermes']);
      expect(run?.nextSteps).toEqual(['Capture official source ids']);
      expect(run?.sourceIds).toEqual(['openclaw-docs', 'hermes-docs']);
    } finally {
      fixture.cleanup();
    }
  });

  test('runs confirmed model compare workspace editor through agent_model_compare', async () => {
    const fixture = makeFixture();
    try {
      const modelCompareCalls: Record<string, unknown>[] = [];
      fixture.toolRegistry.register({
        definition: {
          name: 'agent_model_compare',
          description: 'agent_model_compare test tool',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: true,
          },
        },
        execute: async (rawArgs: Record<string, unknown>) => {
          modelCompareCalls.push(rawArgs);
          return { success: true, output: 'agent_model_compare executed' };
        },
      });

      const unconfirmed = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-run-compare',
        fields: {
          prompt: 'Write a release note for the document workflow.',
          confirm: 'no',
        },
        confirm: true,
        explicitUserRequest: 'Compare release-note candidates.',
      });
      expect(unconfirmed.success).toBe(true);
      expect(unconfirmed.output).toContain('"status": "not_confirmed"');

      const executed = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-run-compare',
        fields: {
          prompt: 'Write a release note for the document workflow.',
          modelRefs: 'openai:gpt-4.1, anthropic:claude-sonnet',
          rubric: 'Prefer concise and concrete.',
          confirm: 'yes',
        },
        confirm: true,
        explicitUserRequest: 'Compare release-note candidates.',
      });
      expect(executed.success).toBe(true);
      expect(executed.output).toContain('"status": "executed_model_tool"');
      expect(executed.output).toContain('"tool": "agent_model_compare"');
      expect(executed.output).toContain('agent_model_compare executed');

      const localBenchmark = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'account-run-local-model-benchmark',
        fields: {
          modelRefs: 'ollama:qwen2.5-coder:7b, openai:gpt-4.1',
          confirm: 'yes',
        },
        confirm: true,
        explicitUserRequest: 'Compare this local route before making it default.',
      });
      expect(localBenchmark.success).toBe(true);
      expect(localBenchmark.output).toContain('"status": "executed_model_tool"');
      expect(localBenchmark.output).toContain('"tool": "agent_model_compare"');
      expect(localBenchmark.output).toContain('agent_model_compare executed');
      expect(modelCompareCalls.at(-1)).toMatchObject({
        mode: 'run',
        benchmarkKind: 'local-model-route',
        modelRefs: ['ollama:qwen2.5-coder:7b', 'openai:gpt-4.1'],
        maxTokens: 1024,
        confirm: true,
      });
      expect(String(modelCompareCalls.at(-1)?.prompt)).toContain('Benchmark this local route');

      const review = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-review-compare',
        fields: {
          artifactId: 'artifact-1',
          reveal: 'no',
        },
      });
      expect(review.success).toBe(true);
      expect(review.output).toContain('"status": "executed_model_tool"');
      expect(review.output).toContain('"tool": "agent_model_compare"');
      expect(review.output).toContain('agent_model_compare executed');

      const judgmentUnconfirmed = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-judge-compare',
        fields: {
          artifactId: 'artifact-1',
          winnerBlindId: 'B',
          reasons: 'Candidate B was more concrete.',
          confirm: 'no',
        },
        confirm: true,
        explicitUserRequest: 'Save comparison judgment.',
      });
      expect(judgmentUnconfirmed.success).toBe(true);
      expect(judgmentUnconfirmed.output).toContain('"status": "not_confirmed"');

      const judgment = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-judge-compare',
        fields: {
          artifactId: 'artifact-1',
          winnerBlindId: 'B',
          reasons: 'Candidate B was more concrete.',
          reveal: 'yes',
          confirm: 'yes',
        },
        confirm: true,
        explicitUserRequest: 'Save comparison judgment.',
      });
      expect(judgment.success).toBe(true);
      expect(judgment.output).toContain('"status": "executed_model_tool"');
      expect(judgment.output).toContain('"tool": "agent_model_compare"');
      expect(judgment.output).toContain('agent_model_compare executed');

      const analytics = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-compare-analytics',
        fields: {
          limit: '10',
          includeReasons: 'yes',
        },
      });
      expect(analytics.success).toBe(true);
      expect(analytics.output).toContain('"status": "executed_model_tool"');
      expect(analytics.output).toContain('"tool": "agent_model_compare"');
      expect(analytics.output).toContain('agent_model_compare executed');

      const applyUnconfirmed = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-apply-compare',
        fields: {
          artifactId: 'artifact-2',
          confirm: 'no',
        },
        confirm: true,
        explicitUserRequest: 'Apply comparison winner.',
      });
      expect(applyUnconfirmed.success).toBe(true);
      expect(applyUnconfirmed.output).toContain('"status": "not_confirmed"');

      const apply = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-apply-compare',
        fields: {
          artifactId: 'artifact-2',
          confirm: 'yes',
        },
        confirm: true,
        explicitUserRequest: 'Apply comparison winner.',
      });
      expect(apply.success).toBe(true);
      expect(apply.output).toContain('"status": "executed_model_tool"');
      expect(apply.output).toContain('"tool": "agent_model_compare"');
      expect(apply.output).toContain('agent_model_compare executed');

      const exportUnconfirmed = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-export-compare',
        fields: {
          artifactId: 'artifact-1',
          confirm: 'no',
        },
        confirm: true,
        explicitUserRequest: 'Export comparison report.',
      });
      expect(exportUnconfirmed.success).toBe(true);
      expect(exportUnconfirmed.output).toContain('"status": "not_confirmed"');

      const exportReport = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'document-export-compare',
        fields: {
          artifactId: 'artifact-1',
          reveal: 'yes',
          confirm: 'yes',
        },
        confirm: true,
        explicitUserRequest: 'Export comparison report.',
      });
      expect(exportReport.success).toBe(true);
      expect(exportReport.output).toContain('"status": "executed_model_tool"');
      expect(exportReport.output).toContain('"tool": "agent_model_compare"');
      expect(exportReport.output).toContain('agent_model_compare executed');
    } finally {
      fixture.cleanup();
    }
  });

  test('gates setting mutations and allows daemon setup settings through confirmed harness routes', async () => {
    const fixture = makeFixture();
    try {
      const missingConfirmation = await fixture.tool.execute({
        mode: 'set_setting',
        key: 'provider.model',
        value: 'openai:gpt-4.1',
        explicitUserRequest: 'Use this model.',
      });
      expect(missingConfirmation.success).toBe(false);
      expect(missingConfirmation.error).toContain('confirm:true');

      const set = await fixture.tool.execute({
        mode: 'set_setting',
        key: 'provider.model',
        value: 'openai:gpt-4.1',
        confirm: true,
        explicitUserRequest: 'Use this model.',
      });
      expect(set.success).toBe(true);
      expect(fixture.configManager.get('provider.model')).toBe('openai:gpt-4.1');

      const serviceSetting = await fixture.tool.execute({
        mode: 'set_setting',
        key: 'service.enabled',
        value: true,
        confirm: true,
        explicitUserRequest: 'Turn on the host service.',
      });
      expect(serviceSetting.success).toBe(true);
      expect(fixture.configManager.get('service.enabled')).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  test('resolves settings by key, target, and query without guessing ambiguous matches', async () => {
    const fixture = makeFixture();
    try {
      const summary = await fixture.tool.execute({ mode: 'summary', includeParameters: true });
      expect(summary.success).toBe(true);
      const summaryJson = JSON.parse(summary.output ?? '{}') as { readonly modelAccess?: { readonly settings?: string } };
      expect(summaryJson.modelAccess?.settings).toContain('category');
      expect(summaryJson.modelAccess?.settings).toContain('prefix');
      expect(summaryJson.modelAccess?.settings).toContain('includeHidden:true');

      const defaultSettings = await fixture.tool.execute({ mode: 'settings' });
      expect(defaultSettings.success).toBe(true);
      const defaultPayload = JSON.parse(defaultSettings.output) as {
        readonly settings: readonly { readonly key: string }[];
        readonly returned: number;
        readonly total: number;
      };
      const visibleSettingKeys = CONFIG_SCHEMA
        .filter((setting) => !isAgentHiddenSettingKey(setting.key))
        .map((setting) => setting.key)
        .sort();
      expect(defaultPayload.returned).toBe(visibleSettingKeys.length);
      expect(defaultPayload.total).toBe(visibleSettingKeys.length);
      expect(defaultPayload.settings.map((setting) => setting.key).sort()).toEqual(visibleSettingKeys);

      const allSettings = await fixture.tool.execute({ mode: 'settings', includeHidden: true });
      expect(allSettings.success).toBe(true);
      const allPayload = JSON.parse(allSettings.output) as {
        readonly settings: readonly { readonly key: string; readonly visibleInWorkspace: boolean }[];
        readonly returned: number;
        readonly total: number;
      };
      expect(allPayload.returned).toBe(CONFIG_SCHEMA.length);
      expect(allPayload.total).toBe(CONFIG_SCHEMA.length);
      expect(allPayload.settings.filter((setting) => !setting.visibleInWorkspace).length).toBeGreaterThan(0);

      const filteredSettings = await fixture.tool.execute({
        mode: 'settings',
        category: 'provider',
        prefix: 'provider.',
        query: 'reasoning',
        limit: 5,
      });
      expect(filteredSettings.success).toBe(true);
      const filteredPayload = JSON.parse(filteredSettings.output) as {
        readonly settings: readonly { readonly key: string; readonly modelRoute?: string; readonly writable?: boolean }[];
        readonly returned: number;
      };
      expectCompactSummaryFields(filteredPayload);
      expect(filteredPayload.returned).toBeGreaterThan(0);
      expect(filteredPayload.settings.map((setting) => setting.key)).toContain('provider.reasoningEffort');
      expect(filteredPayload.settings.filter((setting) => !setting.key.startsWith('provider.'))).toEqual([]);
      expect(filteredPayload.settings.filter((setting) => (
        setting.writable !== true
        || setting.modelRoute !== 'agent_harness mode:"set_setting" or mode:"reset_setting"'
      ))).toEqual([]);

      const byTarget = await fixture.tool.execute({
        mode: 'get_setting',
        target: 'PROVIDER.MODEL',
      });
      expect(byTarget.success).toBe(true);
      const targetSetting = JSON.parse(byTarget.output);
      expect(targetSetting.key).toBe('provider.model');
      expect(targetSetting.modelRoute).toBe('agent_harness mode:"set_setting" or mode:"reset_setting"');
      expect(targetSetting.lookup).toEqual({
        source: 'target',
        input: 'PROVIDER.MODEL',
        resolvedBy: 'case-insensitive-key',
      });

      const byQuery = await fixture.tool.execute({
        mode: 'get_setting',
        query: 'reasoning',
        prefix: 'provider.reasoningEffort',
      });
      expect(byQuery.success).toBe(true);
      const querySetting = JSON.parse(byQuery.output);
      expect(querySetting.key).toBe('provider.reasoningEffort');
      expect(querySetting.modelRoute).toBe('agent_harness mode:"set_setting" or mode:"reset_setting"');
      expect(querySetting.lookup).toEqual({
        source: 'query',
        input: 'reasoning',
        resolvedBy: 'search',
      });

      const setByQuery = await fixture.tool.execute({
        mode: 'set_setting',
        query: 'reasoning',
        prefix: 'provider.reasoningEffort',
        value: 'high',
        confirm: true,
        explicitUserRequest: 'Use high reasoning effort.',
      });
      expect(setByQuery.success).toBe(true);
      expect(fixture.configManager.get('provider.reasoningEffort')).toBe('high');
      const setResult = JSON.parse(setByQuery.output);
      expect(setResult.key).toBe('provider.reasoningEffort');
      expect(setResult.lookup.resolvedBy).toBe('search');

      const resetByTarget = await fixture.tool.execute({
        mode: 'reset_setting',
        target: 'PROVIDER.REASONINGEFFORT',
        confirm: true,
        explicitUserRequest: 'Reset reasoning effort.',
      });
      expect(resetByTarget.success).toBe(true);
      expect(fixture.configManager.get('provider.reasoningEffort')).not.toBe('high');
      const resetResult = JSON.parse(resetByTarget.output);
      expect(resetResult.key).toBe('provider.reasoningEffort');
      expect(resetResult.lookup.resolvedBy).toBe('case-insensitive-key');

      const ambiguous = await fixture.tool.execute({
        mode: 'get_setting',
        query: 'provider',
      });
      expect(ambiguous.success).toBe(false);
      expect(ambiguous.error).toContain('Ambiguous setting provider');
      expect(ambiguous.error).toContain('provider.model');
      expect(ambiguous.error).toContain('modelRoute');
    } finally {
      fixture.cleanup();
    }
  });

  test('persists secret-backed setting values through the secret manager and redacts output', async () => {
    const fixture = makeFixture();
    try {
      const result = await fixture.tool.execute({
        mode: 'set_setting',
        key: 'surfaces.slack.botToken',
        value: 'xoxb-secret-value',
        confirm: true,
        explicitUserRequest: 'Set the Slack bot token.',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('<secret-ref>');
      expect(result.output).not.toContain('xoxb-secret-value');
      expect(fixture.configManager.get('surfaces.slack.botToken')).toContain('goodvibes://secrets/');
      expect(await fixture.secretsManager?.get(buildGoodVibesSecretKey('surfaces.slack.botToken'))).toBe('xoxb-secret-value');
    } finally {
      fixture.cleanup();
    }
  });

  test('rejects raw secret-backed setting values when secret storage is unavailable', async () => {
    const fixture = makeFixture({ secrets: false });
    try {
      const result = await fixture.tool.execute({
        mode: 'set_setting',
        key: 'surfaces.slack.botToken',
        value: 'xoxb-secret-value',
        confirm: true,
        explicitUserRequest: 'Set the Slack bot token.',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('secrets manager is unavailable');
      expect(fixture.configManager.get('surfaces.slack.botToken')).toBe('');
    } finally {
      fixture.cleanup();
    }
  });

  test('resets secret-backed settings only when stored secret deletion can run', async () => {
    const fixture = makeFixture();
    try {
      const key = buildGoodVibesSecretKey('surfaces.slack.botToken');
      await fixture.secretsManager?.set(key, 'xoxb-secret-value', { scope: 'user' });
      fixture.configManager.setDynamic('surfaces.slack.botToken', buildGoodVibesSecretRef(key));

      const result = await fixture.tool.execute({
        mode: 'reset_setting',
        key: 'surfaces.slack.botToken',
        confirm: true,
        explicitUserRequest: 'Reset the Slack bot token.',
      });

      expect(result.success).toBe(true);
      expect(fixture.configManager.get('surfaces.slack.botToken')).toBe('');
      expect(await fixture.secretsManager?.get(key)).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  test('rejects reset of secret-backed refs when secret deletion is unavailable', async () => {
    const fixture = makeFixture({ secrets: false });
    try {
      const key = buildGoodVibesSecretKey('surfaces.slack.botToken');
      const ref = buildGoodVibesSecretRef(key);
      fixture.configManager.setDynamic('surfaces.slack.botToken', ref);

      const result = await fixture.tool.execute({
        mode: 'reset_setting',
        key: 'surfaces.slack.botToken',
        confirm: true,
        explicitUserRequest: 'Reset the Slack bot token.',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('secrets manager is unavailable');
      expect(fixture.configManager.get('surfaces.slack.botToken')).toBe(ref);
    } finally {
      fixture.cleanup();
    }
  });

  test('does not echo raw secret values when invoking settings through run_command', async () => {
    const fixture = makeFixture();
    try {
      registerOperatorRuntimeCommands(fixture.commandRegistry);

      const result = await fixture.tool.execute({
        mode: 'run_command',
        command: '/settings set surfaces.slack.botToken xoxb-secret-value --yes',
        confirm: true,
        explicitUserRequest: 'Set the Slack bot token.',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Command /settings completed.');
      expect(result.output).toContain('<secret-ref>');
      expect(result.output).not.toContain('xoxb-secret-value');
      expect(await fixture.secretsManager?.get(buildGoodVibesSecretKey('surfaces.slack.botToken'))).toBe('xoxb-secret-value');
    } finally {
      fixture.cleanup();
    }
  });
});
