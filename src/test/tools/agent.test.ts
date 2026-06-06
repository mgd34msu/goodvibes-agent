import { describe, test, expect, beforeEach, spyOn } from 'bun:test';
import { createAgentTool, AgentManager, ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import { AgentMessageBus, WrfcController } from '@pellux/goodvibes-sdk/platform/agents';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import type { OrchestrationEvent } from '@/runtime/index.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import {
  AGENT_ANALYZE_NETWORK_DENIAL_MESSAGE,
  AGENT_BLOCKED_MAIN_CONVERSATION_TOOL_NAMES,
  AGENT_CHANNEL_ACTION_DENIAL_MESSAGE,
  AGENT_CONTROL_MUTATION_DENIAL_MESSAGE,
  AGENT_CONTEXT_TOOL_COMPATIBILITY_MODES,
  AGENT_DURABLE_WORKFLOW_MUTATION_DENIAL_MESSAGE,
  AGENT_EXEC_BACKGROUND_DENIAL_MESSAGE,
  AGENT_FETCH_NETWORK_MUTATION_DENIAL_MESSAGE,
  AGENT_FIND_POLICY_DENIAL_MESSAGE,
  AGENT_INSPECT_WRITE_DENIAL_MESSAGE,
  AGENT_MAX_READ_FILES,
  AGENT_MAX_READ_IMAGE_SIZE_BYTES,
  AGENT_MCP_SECURITY_MUTATION_DENIAL_MESSAGE,
  AGENT_MAIN_CONVERSATION_TOOL_DENIAL_MESSAGE,
  AGENT_LOCAL_SPAWN_DENIAL_MESSAGE,
  AGENT_READ_IMAGE_MODES,
  AGENT_READ_ONLY_ANALYZE_TOOL_MODES,
  AGENT_READ_ONLY_CHANNEL_TOOL_MODES,
  AGENT_READ_ONLY_CONTROL_TOOL_MODES,
  AGENT_READ_ONLY_FETCH_METHODS,
  AGENT_READ_ONLY_FIND_OUTPUT_FORMATS,
  AGENT_READ_ONLY_MCP_TOOL_MODES,
  AGENT_READ_ONLY_PACKET_TOOL_MODES,
  AGENT_READ_ONLY_QUERY_TOOL_MODES,
  AGENT_READ_ONLY_REGISTRY_TOOL_MODES,
  AGENT_READ_ONLY_REMOTE_TOOL_MODES,
  AGENT_READ_ONLY_STATE_ANALYTICS_ACTIONS,
  AGENT_READ_ONLY_STATE_HOOK_ACTIONS,
  AGENT_READ_ONLY_STATE_MEMORY_ACTIONS,
  AGENT_READ_ONLY_STATE_MODE_ACTIONS,
  AGENT_READ_ONLY_STATE_TOOL_MODES,
  AGENT_READ_ONLY_TASK_TOOL_MODES,
  AGENT_READ_ONLY_TEAM_TOOL_MODES,
  AGENT_READ_ONLY_TOOL_MODES,
  AGENT_READ_ONLY_WEB_SEARCH_EVIDENCE_EXTRACTS,
  AGENT_READ_ONLY_WEB_SEARCH_VERBOSITIES,
  AGENT_READ_ONLY_WORKLIST_TOOL_MODES,
  AGENT_READ_POLICY_DENIAL_MESSAGE,
  AGENT_REMOTE_MUTATION_DENIAL_MESSAGE,
  AGENT_REGISTRY_CONTENT_DENIAL_MESSAGE,
  AGENT_SETTINGS_MUTATION_DENIAL_MESSAGE,
  AGENT_STATE_MUTATION_DENIAL_MESSAGE,
  AGENT_WEB_SEARCH_POLICY_DENIAL_MESSAGE,
  installAgentToolPolicyGuard,
  normalizeAgentToolInvocationForAgentPolicy,
  wrapAgentToolForAgentPolicy,
} from '../../tools/agent-tool-policy-guard.ts';

const EXPECTED_AGENT_TEMPLATES = [
  'orchestrator',
  'engineer',
  'reviewer',
  'tester',
  'researcher',
  'integrator',
  'general',
] as const;

// Drain queued microtasks so bus.emit() listeners (OBS-14 async dispatch) run before assertions.
const flushMicrotasks = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentHarness(options: { readonly guarded?: boolean } = {}) {
  const configDir = join(tmpdir(), `gv-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const configManager = new ConfigManager({ surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT, configDir });
  const runtimeBus = new RuntimeEventBus();
  const messageBus = new AgentMessageBus();
  const manager = new AgentManager({
    messageBus,
    configManager,
  });
  manager.setRuntimeBus(runtimeBus);
  const wrfcController = new WrfcController(runtimeBus, messageBus, {
    agentManager: manager,
    configManager,
    projectRoot: configDir,
  });
  manager.setWrfcController(wrfcController);
  const agentTool = createAgentTool({
    manager,
    messageBus,
    configManager,
  });
  if (options.guarded) wrapAgentToolForAgentPolicy(agentTool);
  return { agentTool, manager, messageBus, configManager };
}

function makeNoopTool(name: string): Tool {
  return {
    definition: {
      name,
      description: `${name} test tool`,
      parameters: { type: 'object', properties: {} },
      sideEffects: ['write_fs'],
    },
    execute: async () => ({ success: true, output: `${name} executed` }),
  };
}

function makeModeTool(name: string, modes: readonly string[]): Tool {
  return {
    definition: {
      name,
      description: `${name} mode test tool`,
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: [...modes] },
          createIfMissing: { type: 'boolean' },
          actionId: { type: 'string' },
          toolId: { type: 'string' },
          accountAction: { type: 'string' },
          actorId: { type: 'string' },
        },
      },
      sideEffects: ['state', 'network'],
    },
    execute: async () => ({ success: true, output: `${name} executed` }),
  };
}

function makeFetchModeTool(): Tool {
  return {
    definition: {
      name: 'fetch',
      description: 'fetch test tool',
      parameters: {
        type: 'object',
        properties: {
          urls: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] },
                headers: { type: 'object' },
                body: { type: 'string' },
                body_base64: { type: 'string' },
                body_type: { type: 'string' },
                body_data: { type: 'object' },
                retry_on_auth: { type: 'boolean' },
                service: { type: 'string' },
                auth: { type: 'object' },
              },
            },
          },
          parallel: { type: 'boolean' },
          sanitize_mode: { type: 'string', enum: ['none', 'safe-text', 'strict'] },
          trusted_hosts: { type: 'array', items: { type: 'string' } },
        },
      },
      sideEffects: ['network'],
    },
    execute: async (args) => ({ success: true, output: JSON.stringify(args) }),
  };
}

function makeReadTool(): Tool {
  return {
    definition: {
      name: 'read',
      description: 'read test tool',
      parameters: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            maxItems: 50,
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                extract: { type: 'string', enum: ['content', 'outline', 'symbols', 'ast', 'lines'] },
                image_mode: { type: 'string', enum: ['default', 'unoptimized', 'metadata-only', 'thumbnail-only'] },
              },
            },
          },
          extract: { type: 'string', enum: ['content', 'outline', 'symbols', 'ast', 'lines'] },
          image_mode: { type: 'string', enum: ['default', 'unoptimized', 'metadata-only', 'thumbnail-only'] },
          max_image_size: { type: 'integer', minimum: 1 },
        },
      },
      sideEffects: ['read_fs'],
      concurrency: 'parallel',
    },
    execute: async (args) => ({ success: true, output: JSON.stringify(args) }),
  };
}

function makeStateModeTool(): Tool {
  return {
    definition: {
      name: 'state',
      description: 'state test tool',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['get', 'set', 'list', 'clear', 'budget', 'context', 'memory', 'telemetry', 'hooks', 'mode', 'analytics'],
          },
          keys: { type: 'array' },
          values: { type: 'object' },
          clearKeys: { type: 'array' },
          memoryAction: { type: 'string', enum: ['list', 'get', 'set'] },
          memoryKey: { type: 'string' },
          memoryValue: { type: 'string' },
          hookAction: { type: 'string', enum: ['list', 'enable', 'disable', 'add', 'remove'] },
          hookName: { type: 'string' },
          hookDefinition: { type: 'object' },
          modeAction: { type: 'string', enum: ['get', 'list', 'set'] },
          modeName: { type: 'string' },
          analyticsAction: { type: 'string', enum: ['summary', 'query', 'dashboard', 'record', 'sync', 'export'] },
          analyticsTool: { type: 'string' },
          analyticsArgs: { type: 'object' },
          analyticsResult: { type: 'object' },
          analyticsDuration: { type: 'number' },
          analyticsTokens: { type: 'number' },
          analyticsFormat: { type: 'string' },
        },
      },
      sideEffects: ['state'],
    },
    execute: async (args) => ({ success: true, output: JSON.stringify(args) }),
  };
}

function makeSettingsTool(): Tool {
  return {
    definition: {
      name: 'goodvibes_settings',
      description: 'settings mutation test tool',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['set', 'reset'] },
          key: { type: 'string' },
          value: { type: 'string' },
          confirm: { type: 'boolean' },
        },
      },
      sideEffects: ['state'],
    },
    execute: async () => ({ success: true, output: 'settings mutated' }),
  };
}

function makeContextTool(): Tool {
  return {
    definition: {
      name: 'goodvibes_context',
      description: 'runtime context test tool',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['summary', 'knowledge', ['home', 'graph'].join('')] },
          includeAllSpaces: { type: 'boolean' },
          knowledgeSpaceId: { type: 'string' },
        },
      },
      sideEffects: ['read_fs'],
    },
    execute: async () => ({ success: true, output: 'copied context exposed' }),
  };
}

function makeHarnessAliasTargetTool(): Tool {
  return {
    definition: {
      name: 'agent_harness',
      description: 'harness alias target test tool',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string' },
          query: { type: 'string' },
          target: { type: 'string' },
          includeParameters: { type: 'boolean' },
        },
      },
      sideEffects: ['state'],
    },
    execute: async (args) => ({ success: true, output: JSON.stringify({ received: args }) }),
  };
}

function makeInspectTool(): Tool {
  return {
    definition: {
      name: 'inspect',
      description: 'inspect test tool',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['project', 'api', 'scaffold'] },
          projectRoot: { type: 'string' },
          moduleName: { type: 'string' },
          dryRun: { type: 'boolean' },
        },
      },
      sideEffects: ['read_fs'],
    },
    execute: async (args) => ({ success: true, output: JSON.stringify(args) }),
  };
}

function makeControlTool(): Tool {
  return {
    definition: {
      name: 'control',
      description: 'control test tool',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['commands', 'panels', 'subscriptions', 'sandbox-presets', 'restart-daemon'] },
        },
      },
      sideEffects: ['state'],
    },
    execute: async (args) => ({ success: true, output: JSON.stringify(args) }),
  };
}

function makeAnalyzeTool(): Tool {
  return {
    definition: {
      name: 'analyze',
      description: 'analyze test tool',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: [
              'impact',
              'dependencies',
              'dead_code',
              'security',
              'coverage',
              'bundle',
              'preview',
              'diff',
              'surface',
              'breaking',
              'semantic_diff',
              'upgrade',
              'permissions',
              'env_audit',
              'test_find',
            ],
          },
          packages: { type: 'array', items: { type: 'string' } },
        },
      },
      sideEffects: ['read_fs', 'network'],
    },
    execute: async (args) => ({ success: true, output: JSON.stringify(args) }),
  };
}

function makeRegistryTool(): Tool {
  return {
    definition: {
      name: 'registry',
      description: 'registry test tool',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['search', 'recommend', 'dependencies', 'preview', 'content'] },
          path: { type: 'string' },
          query: { type: 'string' },
        },
      },
      sideEffects: ['read_fs'],
    },
    execute: async (args) => ({ success: true, output: JSON.stringify(args) }),
  };
}

function makeWebSearchTool(): Tool {
  return {
    definition: {
      name: 'web_search',
      description: 'web search test tool',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          maxResults: { type: 'integer', maximum: 25 },
          verbosity: { type: 'string', enum: ['urls_only', 'titles', 'snippets', 'evidence', 'full'] },
          safeSearch: { type: 'string', enum: ['strict', 'moderate', 'off'] },
          includeEvidence: { type: 'boolean' },
          evidenceTopN: { type: 'integer', maximum: 10 },
          evidenceExtract: {
            type: 'string',
            enum: ['raw', 'text', 'json', 'markdown', 'readable', 'code_blocks', 'links', 'metadata', 'structured', 'tables', 'pdf', 'summary'],
          },
        },
      },
      sideEffects: ['network'],
    },
    execute: async (args) => ({ success: true, output: JSON.stringify(args) }),
  };
}

function makeFindTool(): Tool {
  return {
    definition: {
      name: 'find',
      description: 'find test tool',
      parameters: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                mode: { type: 'string', enum: ['files', 'content', 'symbols', 'references', 'structural'] },
                patterns: { type: 'array', items: { type: 'string' } },
                pattern: { type: 'string' },
                path: { type: 'string' },
                follow_symlinks: { type: 'boolean' },
                include_hidden: { type: 'boolean' },
                respect_gitignore: { type: 'boolean' },
              },
            },
          },
          output: {
            type: 'object',
            properties: {
              format: {
                type: 'string',
                enum: [
                  'count_only',
                  'files_only',
                  'locations',
                  'matches',
                  'context',
                  'with_stats',
                  'with_preview',
                  'signatures',
                  'full',
                ],
              },
              preview_lines: { type: 'integer' },
              max_results: { type: 'integer' },
            },
          },
          parallel: { type: 'boolean' },
        },
      },
      sideEffects: ['read_fs'],
      concurrency: 'parallel',
    },
    execute: async (args) => ({ success: true, output: JSON.stringify(args) }),
  };
}

function makeDurableModeTool(name: string, modes: readonly string[], extraProperties: readonly string[]): Tool {
  const properties: Record<string, unknown> = {
    mode: { type: 'string', enum: [...modes] },
    view: { type: 'string' },
    taskId: { type: 'string' },
    teamId: { type: 'string' },
    worklistId: { type: 'string' },
    packetId: { type: 'string' },
    queryId: { type: 'string' },
  };
  for (const key of extraProperties) properties[key] = { type: 'string' };
  return {
    definition: {
      name,
      description: `${name} durable workflow test tool`,
      parameters: {
        type: 'object',
        properties,
      },
      sideEffects: ['workflow', 'state'],
    },
    execute: async () => ({ success: true, output: `${name} executed` }),
  };
}

function getRecordProperty(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function expectPresent<T>(value: T | null | undefined, description: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${description}`);
  }
  return value;
}

let harness = makeAgentHarness();

async function runAgent(args: Record<string, unknown>) {
  const result = await harness.agentTool.execute(args);
  if (!result.success) throw new Error(result.error ?? 'agent tool failed');
  return JSON.parse(result.output!) as Record<string, unknown>;
}

async function runAgentMayFail(args: Record<string, unknown>) {
  return harness.agentTool.execute(args);
}

// ---------------------------------------------------------------------------
// Setup: reset shared test helper state between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  harness = makeAgentHarness();
  harness.configManager.set('orchestration.maxActiveAgents', 8);
  harness.configManager.set('orchestration.maxDepth', 1);
  harness.configManager.set('orchestration.recursionEnabled', true);
});

// ---------------------------------------------------------------------------
// spawn
// ---------------------------------------------------------------------------

describe('spawn mode', () => {
  test('cohort spawn emits orchestration graph events on the runtime bus', async () => {
    const bus = new RuntimeEventBus();
    const manager = harness.manager;
    manager.setRuntimeBus(bus);
    const seen: string[] = [];

    const unsub = bus.onDomain('orchestration', (event) => {
      seen.push(event.type);
    });

    manager.spawn({
      mode: 'spawn',
      task: 'Stuck task',
      cohort: 'alpha',
      template: 'engineer',
      tools: [],
    });

    await flushMicrotasks();
    unsub();
    expect(seen).toContain('ORCHESTRATION_GRAPH_CREATED');
    expect(seen).toContain('ORCHESTRATION_NODE_ADDED');
    expect(seen).toContain('ORCHESTRATION_NODE_STARTED');
  });

  test('spawn creates agent with correct ID format', async () => {
    const result = await runAgent({ mode: 'spawn', task: 'Implement user auth' });
    expect(typeof result.agentId).toBe('string');
    expect((result.agentId as string).startsWith('agent-')).toBe(true);
    // agent-XXXXXXXX (8 hex chars after prefix)
    const suffix = (result.agentId as string).slice('agent-'.length);
    expect(suffix.length).toBe(8);
  });

  test('spawn returns spawned status', async () => {
    const result = await runAgent({ mode: 'spawn', task: 'Write tests' });
    expect(result.status).toBe('spawned');
  });

  test('spawn returns task in result', async () => {
    const task = 'Refactor the database layer';
    const result = await runAgent({ mode: 'spawn', task });
    expect(result.task).toBe(task);
  });

  test('plain spawn does not implicitly start WRFC', async () => {
    const result = await runAgent({
      mode: 'spawn',
      task: 'Inspect one thing with a normal agent',
      reviewMode: 'none',
      dangerously_disable_wrfc: true,
    });
    const record = await runAgent({ mode: 'get', agentId: result.agentId as string });
    expect(record.reviewMode).toBe('none');
  });

  test('spawn with engineer template uses engineer defaults', async () => {
    const result = await runAgent({ mode: 'spawn', task: 'Build API', template: 'engineer' });
    expect(result.template).toBe('engineer');
    const tools = result.tools as string[];
    expect(tools).toContain('read');
    expect(tools).toContain('write');
    expect(tools).toContain('exec');
    expect(tools).toContain('analyze');
  });

  test('spawn with reviewer template normalizes into a WRFC owner chain', async () => {
    const result = await runAgent({ mode: 'spawn', task: 'Review code', template: 'reviewer' });
    expect(result.template).toBe('engineer');
    expect(result.reviewMode).toBe('wrfc');
    expect(result.task).toBe('Review code');
    expect(result.authoritativeWrfcChain).toBe(true);
    expect(result.continueRootSpawning).toBe(false);
    expect(result.orchestrationStopSignal).toBe('wrfc_owner_chain_started');
    expect(result.wrfcRole).toBe('owner');
    expect(result.wrfcRouteReason).toBe('root-review-role-normalized');
    expect(result.successCriteria).toContain('Keep the work as one WRFC owner chain; review, test, verification, and fix phases must remain lifecycle children.');
  });

  test('exact WRFC review root request from live repro normalizes into owner chain', async () => {
    const result = await runAgent({
      mode: 'spawn',
      task: 'WRFC review for a token bucket rate limiter',
      template: 'reviewer',
      reviewMode: 'wrfc',
      tools: ['read', 'find'],
      restrictTools: true,
    });

    expect(result.template).toBe('engineer');
    expect(result.reviewMode).toBe('wrfc');
    expect(result.task).toBe('WRFC review for a token bucket rate limiter');
    expect(result.authoritativeWrfcChain).toBe(true);
    expect(result.continueRootSpawning).toBe(false);
    expect(result.orchestrationStopSignal).toBe('wrfc_owner_chain_started');
    expect(result.wrfcRole).toBe('owner');
    expect(result.wrfcRouteReason).toBe('root-review-role-normalized');
    expect(result.successCriteria).toContain('Keep the work as one WRFC owner chain; review, test, verification, and fix phases must remain lifecycle children.');
    expect(harness.manager.list().filter((record) => record.parentAgentId == null)).toHaveLength(1);
  });

  test('spawn without template defaults to general', async () => {
    const result = await runAgent({ mode: 'spawn', task: 'Do something' });
    expect(result.template).toBe('general');
  });

  test('spawn with explicit tools merges with template defaults (additive)', async () => {
    const result = await runAgent({
      mode: 'spawn',
      task: 'Custom task',
      template: 'engineer',
      tools: ['read', 'find'],
    });
    // Additive merge: defaults + input tools, deduplicated.
    // ArchetypeLoader built-in for 'engineer': ['read', 'write', 'edit', 'find', 'exec', 'analyze', 'inspect', 'fetch', 'registry']
    // input.tools ['read', 'find'] are already in defaults, so merged = defaults unchanged.
    const engineerDefaults = ['read', 'write', 'edit', 'find', 'exec', 'analyze', 'inspect', 'fetch', 'registry'];
    const expected = [...new Set([...engineerDefaults, 'read', 'find'])];
    expect(result.tools).toEqual(expected);
  });

  test('spawn with restrictTools=true uses only specified tools', async () => {
    const result = await runAgent({
      mode: 'spawn',
      task: 'Custom task',
      template: 'engineer',
      tools: ['read', 'find'],
      restrictTools: true,
    });
    // restrictTools bypasses additive merge — only the specified tools are used
    expect(result.tools).toEqual(['read', 'find']);
    // Template defaults must NOT be present
    const tools = result.tools as string[];
    expect(tools).not.toContain('write');
    expect(tools).not.toContain('exec');
    expect(tools).not.toContain('edit');
    expect(tools).not.toContain('analyze');
  });

  test('batch-spawn with restrictTools propagates to each agent', async () => {
    const result = await runAgent({
      mode: 'batch-spawn',
      reviewMode: 'none',
      dangerously_disable_wrfc: true,
      tasks: [
        { task: 'Batch task A', template: 'engineer', tools: ['read', 'find'], restrictTools: true, reviewMode: 'none', dangerously_disable_wrfc: true },
        { task: 'Batch task B', template: 'engineer', tools: ['read'], restrictTools: true, reviewMode: 'none', dangerously_disable_wrfc: true },
      ],
    });
    const agents = result.agents as Array<{ id: string; task: string }>;
    expect(agents.length).toBe(2);

    // Verify each spawned agent has only the restricted tools
    const statusA = await runAgent({ mode: 'get', agentId: agents[0].id });
    const statusB = await runAgent({ mode: 'get', agentId: agents[1].id });

    expect(statusA.reviewMode).toBe('none');
    expect(statusA.tools).toEqual(['read', 'find']);
    expect((statusA.tools as string[])).not.toContain('write');

    expect(statusB.reviewMode).toBe('none');
    expect(statusB.tools).toEqual(['read']);
    expect((statusB.tools as string[])).not.toContain('write');
  });

  test('collapses batch-spawn WRFC decomposition into one owner root chain', async () => {
    const result = await runAgent({
      mode: 'batch-spawn',
      cohort: 'bad-wrfc-fanout',
      reviewMode: 'wrfc',
      tasks: [
        {
          task: 'Implement the feature as WRFC owner.',
          template: 'engineer',
          tools: ['read', 'find'],
          restrictTools: true,
        },
        {
          task: 'Review the feature at the same time.',
          template: 'reviewer',
          tools: ['read', 'find'],
          restrictTools: true,
        },
      ],
    });
    const agents = result.agents as Array<{ id: string; task: string; template: string; cohort: string }>;

    expect(agents).toHaveLength(1);
    expect(agents[0]?.template).toBe('engineer');
    expect(agents[0]?.cohort).toBe('bad-wrfc-fanout');
    const record = await runAgent({ mode: 'get', agentId: agents[0]!.id });
    expect(record.reviewMode).toBe('wrfc');
    expect(record.wrfcRole).toBe('owner');
    expect(record.task).toBe('Implement the feature as WRFC owner.');
    expect(result.authoritativeWrfcChain).toBe(true);
    expect(result.continueRootSpawning).toBe(false);
    expect(result.orchestrationStopSignal).toBe('wrfc_owner_chain_started');
    expect(harness.manager.list().filter((agent) => agent.parentAgentId == null)).toHaveLength(1);
  });

  test('allows exactly one WRFC owner task to start one chain', async () => {
    const result = await runAgent({
      mode: 'batch-spawn',
      cohort: 'single-wrfc-owner',
      tasks: [
        {
          task: 'Implement the feature as the WRFC owner.',
          template: 'engineer',
          reviewMode: 'wrfc',
          tools: ['read', 'find'],
          restrictTools: true,
        },
      ],
    });
    const agents = result.agents as Array<{ id: string; template: string; cohort: string }>;

    expect(agents).toHaveLength(1);
    expect(agents[0]?.template).toBe('engineer');
    expect(agents[0]?.cohort).toBe('single-wrfc-owner');
  });

  test('normalizes explicit reviewer WRFC root owners instead of blocking', async () => {
    const result = await runAgent({
      mode: 'spawn',
      task: 'Review the feature through WRFC.',
      template: 'reviewer',
      reviewMode: 'wrfc',
      tools: ['read', 'find'],
      restrictTools: true,
    });

    expect(result.template).toBe('engineer');
    expect(result.reviewMode).toBe('wrfc');
    expect(result.task).toBe('Review the feature through WRFC.');
    expect(result.authoritativeWrfcChain).toBe(true);
    expect(result.continueRootSpawning).toBe(false);
    expect(result.orchestrationStopSignal).toBe('wrfc_owner_chain_started');
    expect(result.wrfcRole).toBe('owner');
    expect(result.wrfcRouteReason).toBe('root-review-role-normalized');
    expect(harness.manager.list().filter((agent) => agent.parentAgentId == null)).toHaveLength(1);
  });

  test('Agent runtime guard allows visible local spawn work', async () => {
    const guarded = makeAgentHarness({ guarded: true });
    const result = await guarded.agentTool.execute({
      mode: 'spawn',
      task: 'Build the feature',
      template: 'engineer',
      reviewMode: 'none',
      dangerously_disable_wrfc: true,
    });

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output ?? '{}') as { readonly task?: string; readonly template?: string };
    expect(payload.task).toBe('Build the feature');
    expect(payload.template).toBe('engineer');
    expect(guarded.manager.list()).toHaveLength(1);
  });

  test('Agent runtime guard allows visible batch-spawn fanout', async () => {
    const guarded = makeAgentHarness({ guarded: true });
    const result = await guarded.agentTool.execute({
      mode: 'batch-spawn',
      reviewMode: 'none',
      dangerously_disable_wrfc: true,
      tasks: [
        { task: 'Build the API adapter', template: 'engineer', reviewMode: 'none', dangerously_disable_wrfc: true },
        { task: 'Build the CLI adapter', template: 'engineer', reviewMode: 'none', dangerously_disable_wrfc: true },
      ],
    });

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output ?? '{}') as { readonly agents?: readonly unknown[] };
    expect(payload.agents).toHaveLength(2);
    expect(guarded.manager.list()).toHaveLength(2);
  });

  test('Agent runtime guard advertises visible autonomy modes', () => {
    const guarded = makeAgentHarness({ guarded: true });
    const mode = expectPresent(
      guarded.agentTool.definition.parameters.properties as Record<string, unknown> | undefined,
      'guarded agent schema properties',
    );
    expect(guarded.agentTool.definition.description).toContain('Visible local Agent orchestration');
    const modeProperty = expectPresent(
      getRecordProperty(mode, 'mode'),
      'guarded agent mode property',
    );
    const enumValues = modeProperty.enum;
    expect(enumValues).toEqual([...AGENT_READ_ONLY_TOOL_MODES]);
    expect(enumValues).toContain('spawn');
    expect(enumValues).toContain('batch-spawn');
    expect(enumValues).toContain('wrfc-chains');
    expect(enumValues).toContain('wrfc-history');
  });

  test('Agent runtime guard allows local agent cancellation mode', async () => {
    const guarded = makeAgentHarness({ guarded: true });
    const spawned = await guarded.agentTool.execute({ mode: 'spawn', task: 'Stuck task' });
    expect(spawned.success).toBe(true);
    const spawnedPayload = JSON.parse(spawned.output ?? '{}') as { readonly agentId?: string };
    const result = await guarded.agentTool.execute({
      mode: 'cancel',
      agentId: spawnedPayload.agentId,
    });

    expect(result.success).toBe(true);
    expect(guarded.manager.getStatus(spawnedPayload.agentId ?? '')?.status).toBe('cancelled');
  });

  test('Agent runtime guard leaves read-only agent inspection modes unchanged', () => {
    const normalized = normalizeAgentToolInvocationForAgentPolicy({
      mode: 'list',
      status: 'running',
    });

    expect(normalized).toEqual({
      mode: 'list',
      status: 'running',
    });
  });

  test('Agent runtime guard blocks direct coding mutation and local workflow tools', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    for (const name of AGENT_BLOCKED_MAIN_CONVERSATION_TOOL_NAMES) registry.register(makeNoopTool(name));

    installAgentToolPolicyGuard(registry);

    for (const name of AGENT_BLOCKED_MAIN_CONVERSATION_TOOL_NAMES) {
      const definition = registry.getToolDefinitions().find((tool) => tool.name === name);
      expect(definition?.description).toBe(`Blocked in GoodVibes Agent: ${name}.`);
      expect(definition?.sideEffects).toEqual([]);

      const result = await registry.execute(`call-${name}`, name, {});
      expect(result.success).toBe(false);
      expect(result.error).toBe(AGENT_MAIN_CONVERSATION_TOOL_DENIAL_MESSAGE);
      expect(result.callId).toBe(`call-${name}`);
    }
  });

  test('Agent runtime guard narrows exec to foreground serial commands', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeNoopTool('exec'));

    installAgentToolPolicyGuard(registry);

    const execDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'exec');
    expect(execDefinition?.description).toContain('foreground shell commands serially');
    const properties = execDefinition?.parameters.properties as Record<string, unknown>;
    expect(properties.parallel).toBeUndefined();
    expect(properties.file_ops).toBeUndefined();
    const commandsProperty = getRecordProperty(properties, 'commands');
    const itemSchema = commandsProperty ? getRecordProperty(commandsProperty, 'items') : undefined;
    const commandProperties = itemSchema ? getRecordProperty(itemSchema, 'properties') : undefined;
    expect(commandProperties?.background).toBeUndefined();

    const foreground = await registry.execute('call-exec-foreground', 'exec', {
      commands: [{ cmd: 'echo hello' }],
    });
    expect(foreground.success).toBe(true);
    expect(foreground.output).toBe('exec executed');

    const blockedInputs: ReadonlyArray<Record<string, unknown>> = [
      { commands: [{ cmd: 'sleep 100', background: true }] },
      { commands: [{ cmd: 'bg_status process-1' }] },
      { commands: [{ cmd: 'long setup', until: { pattern: 'ready' } }] },
      { commands: [{ cmd: 'echo ok' }], parallel: true },
      { commands: [{ cmd: 'echo ok' }], file_ops: [{ op: 'delete', source: 'tmp.txt' }] },
    ];

    for (const [index, input] of blockedInputs.entries()) {
      const result = await registry.execute(`call-exec-blocked-${index}`, 'exec', input);
      expect(result.success).toBe(false);
      expect(result.error).toBe(AGENT_EXEC_BACKGROUND_DENIAL_MESSAGE);
    }
  });

  test('Agent runtime guard narrows remote build-host tool to read-only modes', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeModeTool('remote', ['create-pool', 'pools', 'assign', 'unassign', 'contracts', 'artifacts', 'review', 'import-artifact']));

    installAgentToolPolicyGuard(registry);

    const remoteDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'remote');
    expect(remoteDefinition?.description).toContain('Read-only remote build-host inspection');
    expect(remoteDefinition?.description).not.toContain('remote runner');
    const properties = remoteDefinition?.parameters.properties as Record<string, unknown>;
    const modeProperty = getRecordProperty(properties, 'mode');
    expect(modeProperty?.enum).toEqual([...AGENT_READ_ONLY_REMOTE_TOOL_MODES]);

    for (const mode of AGENT_READ_ONLY_REMOTE_TOOL_MODES) {
      const result = await registry.execute(`call-remote-${mode}`, 'remote', { mode });
      expect(result.success).toBe(true);
    }

    const blockedModes = ['create-pool', 'assign', 'unassign', 'import-artifact'] as const;
    for (const mode of blockedModes) {
      const result = await registry.execute(`call-remote-blocked-${mode}`, 'remote', { mode });
      expect(result.success).toBe(false);
      expect(result.error).toBe(AGENT_REMOTE_MUTATION_DENIAL_MESSAGE);
    }
  });

  test('Agent runtime guard narrows channel tool to read-only inspection', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeModeTool('channel', [
      'accounts',
      'account_action',
      'directory',
      'resolve_target',
      'capabilities',
      'tools',
      'agent_tools',
      'run_tool',
      'actions',
      'run_action',
      'authorize',
    ]));

    installAgentToolPolicyGuard(registry);

    const channelDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'channel');
    expect(channelDefinition?.description).toContain('Read-only channel inspection');
    const properties = channelDefinition?.parameters.properties as Record<string, unknown>;
    const modeProperty = getRecordProperty(properties, 'mode');
    expect(modeProperty?.enum).toEqual([...AGENT_READ_ONLY_CHANNEL_TOOL_MODES]);
    expect(properties.createIfMissing).toBeUndefined();
    expect(properties.actionId).toBeUndefined();
    expect(properties.toolId).toBeUndefined();

    for (const mode of AGENT_READ_ONLY_CHANNEL_TOOL_MODES) {
      const result = await registry.execute(`call-channel-${mode}`, 'channel', { mode });
      expect(result.success).toBe(true);
    }

    const blockedModes = ['account_action', 'run_tool', 'run_action', 'authorize'] as const;
    for (const mode of blockedModes) {
      const result = await registry.execute(`call-channel-blocked-${mode}`, 'channel', { mode });
      expect(result.success).toBe(false);
      expect(result.error).toBe(AGENT_CHANNEL_ACTION_DENIAL_MESSAGE);
    }

    const createTarget = await registry.execute('call-channel-create-target', 'channel', {
      mode: 'resolve_target',
      createIfMissing: true,
    });
    expect(createTarget.success).toBe(false);
    expect(createTarget.error).toBe(AGENT_CHANNEL_ACTION_DENIAL_MESSAGE);
  });

  test('Agent runtime guard narrows MCP tool to read-only security inspection', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeModeTool('mcp', [
      'servers',
      'tools',
      'schema',
      'resources',
      'security',
      'auth',
      'approve-quarantine',
      'set-trust',
      'set-role',
    ]));

    installAgentToolPolicyGuard(registry);

    const mcpDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'mcp');
    expect(mcpDefinition?.description).toContain('Read-only MCP inspection');
    const properties = mcpDefinition?.parameters.properties as Record<string, unknown>;
    const modeProperty = getRecordProperty(properties, 'mode');
    expect(modeProperty?.enum).toEqual([...AGENT_READ_ONLY_MCP_TOOL_MODES]);

    for (const mode of AGENT_READ_ONLY_MCP_TOOL_MODES) {
      const result = await registry.execute(`call-mcp-${mode}`, 'mcp', { mode });
      expect(result.success).toBe(true);
    }

    const blockedModes = ['approve-quarantine', 'set-trust', 'set-role'] as const;
    for (const mode of blockedModes) {
      const result = await registry.execute(`call-mcp-blocked-${mode}`, 'mcp', { mode });
      expect(result.success).toBe(false);
      expect(result.error).toBe(AGENT_MCP_SECURITY_MUTATION_DENIAL_MESSAGE);
    }
  });

  test('Agent runtime guard narrows fetch to serial unauthenticated read-only HTTP', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeFetchModeTool());

    installAgentToolPolicyGuard(registry);

    const fetchDefinition = expectPresent(
      registry.getToolDefinitions().find((tool) => tool.name === 'fetch'),
      'fetch tool definition',
    );
    expect(fetchDefinition.description).toContain('serial, read-only HTTP requests');
    const properties = fetchDefinition.parameters.properties as Record<string, unknown>;
    expect(properties.parallel).toBeUndefined();
    expect(properties.trusted_hosts).toBeUndefined();
    const sanitizeModeProperty = getRecordProperty(properties, 'sanitize_mode');
    expect(sanitizeModeProperty?.enum).toEqual(['safe-text', 'strict']);

    const urlsProperty = getRecordProperty(properties, 'urls');
    const itemSchema = urlsProperty ? getRecordProperty(urlsProperty, 'items') : undefined;
    const urlProperties = itemSchema ? getRecordProperty(itemSchema, 'properties') : undefined;
    const fetchUrlProperties = expectPresent(urlProperties, 'fetch URL properties');
    const methodProperty = getRecordProperty(fetchUrlProperties, 'method');
    expect(methodProperty?.enum).toEqual([...AGENT_READ_ONLY_FETCH_METHODS]);
    expect(fetchUrlProperties.body).toBeUndefined();
    expect(fetchUrlProperties.headers).toBeUndefined();
    expect(fetchUrlProperties.auth).toBeUndefined();
    expect(fetchUrlProperties.service).toBeUndefined();

    for (const method of AGENT_READ_ONLY_FETCH_METHODS) {
      const result = await registry.execute(`call-fetch-${method}`, 'fetch', {
        urls: [{ url: 'https://example.com/', method }],
      });
      expect(result.success).toBe(true);
      const normalized = JSON.parse(result.output ?? '{}') as { readonly parallel?: boolean };
      expect(normalized.parallel).toBe(false);
    }

    const blockedInputs: ReadonlyArray<Record<string, unknown>> = [
      { urls: [{ url: 'https://example.com/', method: 'POST' }] },
      { urls: [{ url: 'https://example.com/', method: 'PUT' }] },
      { urls: [{ url: 'https://example.com/', method: 'PATCH' }] },
      { urls: [{ url: 'https://example.com/', method: 'DELETE' }] },
      { urls: [{ url: 'https://example.com/', body: 'payload' }] },
      { urls: [{ url: 'https://example.com/', headers: { authorization: 'Bearer secret' } }] },
      { urls: [{ url: 'https://example.com/', auth: { type: 'bearer', token: 'secret' } }] },
      { urls: [{ url: 'https://example.com/', service: 'private-api' }] },
      { urls: [{ url: 'https://example.com/' }], sanitize_mode: 'none' },
      { urls: [{ url: 'https://example.com/' }], trusted_hosts: ['example.com'] },
      { urls: [{ url: 'https://example.com/' }], parallel: true },
    ];

    for (const [index, input] of blockedInputs.entries()) {
      const result = await registry.execute(`call-fetch-blocked-${index}`, 'fetch', input);
      expect(result.success).toBe(false);
      expect(result.error).toBe(AGENT_FETCH_NETWORK_MUTATION_DENIAL_MESSAGE);
    }
  });

  test('Agent runtime guard narrows read to bounded non-secret project files', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeReadTool());

    installAgentToolPolicyGuard(registry);

    const readDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'read');
    expect(readDefinition?.description).toContain('ordinary non-secret project files');
    expect(readDefinition?.sideEffects).toEqual(['read_fs']);
    expect(readDefinition?.concurrency).toBe('serial');

    const properties = readDefinition?.parameters.properties as Record<string, unknown>;
    const files = getRecordProperty(properties, 'files');
    expect(files?.maxItems).toBe(AGENT_MAX_READ_FILES);
    const itemSchema = files ? getRecordProperty(files, 'items') : undefined;
    const fileProperties = itemSchema ? getRecordProperty(itemSchema, 'properties') : undefined;
    const fileImageMode = fileProperties ? getRecordProperty(fileProperties, 'image_mode') : undefined;
    const globalImageMode = getRecordProperty(properties, 'image_mode');
    const maxImageSize = getRecordProperty(properties, 'max_image_size');
    expect(fileImageMode?.enum).toEqual([...AGENT_READ_IMAGE_MODES]);
    expect(globalImageMode?.enum).toEqual([...AGENT_READ_IMAGE_MODES]);
    expect(maxImageSize?.maximum).toBe(AGENT_MAX_READ_IMAGE_SIZE_BYTES);

    const allowed = await registry.execute('call-read-source', 'read', {
      files: [{ path: 'src/main.ts', extract: 'outline' }],
      image_mode: 'metadata-only',
      max_image_size: AGENT_MAX_READ_IMAGE_SIZE_BYTES,
    });
    expect(allowed.success).toBe(true);

    const tooManyFiles = Array.from({ length: AGENT_MAX_READ_FILES + 1 }, (_, index) => ({
      path: `src/example-${index}.ts`,
    }));
    const blockedInputs: ReadonlyArray<Record<string, unknown>> = [
      { files: [{ path: '.env' }] },
      { files: [{ path: 'src/.hidden/config.ts' }] },
      { files: [{ path: 'secrets/api-token.txt' }] },
      { files: [{ path: 'config/credentials.json' }] },
      { files: [{ path: 'keys/service.pem' }] },
      { files: [{ path: 'assets/diagram.png', image_mode: 'unoptimized' }] },
      { files: [{ path: 'assets/diagram.png' }], image_mode: 'unoptimized' },
      { files: [{ path: 'assets/diagram.png' }], max_image_size: AGENT_MAX_READ_IMAGE_SIZE_BYTES + 1 },
      { files: tooManyFiles },
    ];

    for (const [index, input] of blockedInputs.entries()) {
      const result = await registry.execute(`call-read-blocked-${index}`, 'read', input);
      expect(result.success).toBe(false);
      expect(result.error).toBe(AGENT_READ_POLICY_DENIAL_MESSAGE);
    }
  });

  test('Agent runtime guard narrows state tool to read-only runtime inspection', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeStateModeTool());

    installAgentToolPolicyGuard(registry);

    const stateDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'state');
    expect(stateDefinition?.description).toContain('Inspect runtime-owned state');
    const properties = stateDefinition?.parameters.properties as Record<string, unknown>;
    const modeProperty = getRecordProperty(properties, 'mode');
    expect(modeProperty?.enum).toEqual([...AGENT_READ_ONLY_STATE_TOOL_MODES]);
    expect(properties.values).toBeUndefined();
    expect(properties.clearKeys).toBeUndefined();
    expect(properties.memoryValue).toBeUndefined();
    expect(properties.hookDefinition).toBeUndefined();
    expect(properties.modeName).toBeUndefined();
    expect(properties.analyticsTool).toBeUndefined();

    expect(getRecordProperty(properties, 'memoryAction')?.enum).toEqual([...AGENT_READ_ONLY_STATE_MEMORY_ACTIONS]);
    expect(getRecordProperty(properties, 'hookAction')?.enum).toEqual([...AGENT_READ_ONLY_STATE_HOOK_ACTIONS]);
    expect(getRecordProperty(properties, 'modeAction')?.enum).toEqual([...AGENT_READ_ONLY_STATE_MODE_ACTIONS]);
    expect(getRecordProperty(properties, 'analyticsAction')?.enum).toEqual([...AGENT_READ_ONLY_STATE_ANALYTICS_ACTIONS]);

    const readOnlyInputs: ReadonlyArray<Record<string, unknown>> = [
      { mode: 'get', keys: ['runtime.workingDir'] },
      { mode: 'list' },
      { mode: 'budget' },
      { mode: 'context' },
      { mode: 'memory', memoryAction: 'list' },
      { mode: 'memory', memoryAction: 'get', memoryKey: 'example' },
      { mode: 'telemetry' },
      { mode: 'hooks', hookAction: 'list' },
      { mode: 'mode', modeAction: 'get' },
      { mode: 'mode', modeAction: 'list' },
      { mode: 'analytics', analyticsAction: 'summary' },
      { mode: 'analytics', analyticsAction: 'query' },
      { mode: 'analytics', analyticsAction: 'dashboard' },
    ];

    for (const [index, input] of readOnlyInputs.entries()) {
      const result = await registry.execute(`call-state-read-${index}`, 'state', input);
      expect(result.success).toBe(true);
    }

    const blockedInputs: ReadonlyArray<Record<string, unknown>> = [
      { mode: 'set', values: { key: 'value' } },
      { mode: 'clear', clearKeys: ['key'] },
      { mode: 'get', values: { key: 'value' } },
      { mode: 'memory', memoryAction: 'set', memoryKey: 'memory', memoryValue: 'value' },
      { mode: 'memory', memoryAction: 'list', memoryValue: 'value' },
      { mode: 'hooks', hookAction: 'enable', hookName: 'hook' },
      { mode: 'hooks', hookAction: 'add', hookDefinition: { type: 'command' } },
      { mode: 'mode', modeAction: 'set', modeName: 'verbose' },
      { mode: 'analytics', analyticsAction: 'record', analyticsTool: 'fetch' },
      { mode: 'analytics', analyticsAction: 'sync' },
      { mode: 'analytics', analyticsAction: 'export', analyticsFormat: 'json' },
    ];

    for (const [index, input] of blockedInputs.entries()) {
      const result = await registry.execute(`call-state-blocked-${index}`, 'state', input);
      expect(result.success).toBe(false);
      expect(result.error).toBe(AGENT_STATE_MUTATION_DENIAL_MESSAGE);
    }
  });

  test('Agent runtime guard blocks copied settings mutation tool from the model surface', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeSettingsTool());

    installAgentToolPolicyGuard(registry);

    const settingsDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'goodvibes_settings');
    expect(settingsDefinition?.description).toBe('Blocked in GoodVibes Agent: configuration mutation.');
    expect(settingsDefinition?.sideEffects).toEqual([]);
    const properties = settingsDefinition?.parameters.properties as Record<string, unknown>;
    expect(properties.mode).toBeUndefined();
    expect(properties.key).toBeUndefined();
    expect(properties.value).toBeUndefined();
    expect(properties.confirm).toBeUndefined();
    expect(settingsDefinition?.parameters.additionalProperties).toBe(false);

    const result = await registry.execute('call-settings-blocked', 'goodvibes_settings', {
      mode: 'set',
      key: 'controlPlane.enabled',
      value: true,
      confirm: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(AGENT_SETTINGS_MUTATION_DENIAL_MESSAGE);
  });

  test('Agent runtime guard routes copied runtime context tool to Agent capabilities', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeContextTool());

    installAgentToolPolicyGuard(registry);
    registry.register(makeHarnessAliasTargetTool());

    const contextDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'goodvibes_context');
    expect(contextDefinition?.description).toBe('Inspect GoodVibes Agent harness capabilities.');
    expect(contextDefinition?.sideEffects).toEqual([]);
    const properties = contextDefinition?.parameters.properties as Record<string, unknown>;
    expect((properties.mode as { readonly enum?: readonly string[] }).enum).toEqual([...AGENT_CONTEXT_TOOL_COMPATIBILITY_MODES]);
    expect(properties.includeAllSpaces).toBeUndefined();
    expect(properties.knowledgeSpaceId).toBeUndefined();
    expect(contextDefinition?.parameters.additionalProperties).toBe(false);

    const result = await registry.execute('call-context-alias', 'goodvibes_context', {
      mode: 'capabilities',
      query: 'tools',
    });
    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output ?? '{}') as {
      readonly runtime?: string;
      readonly currentContract?: Record<string, unknown>;
      readonly canDoNow?: readonly Record<string, unknown>[];
      readonly commonRoutes?: Record<string, unknown>;
    };
    expect(payload.runtime).toBe('GoodVibes Agent');
    expect(payload.currentContract?.autonomy).toContain('User-directed operator agent');
    expect(payload.canDoNow?.map((entry) => entry.area)).toContain('Harness operation');
    expect(payload.canDoNow?.map((entry) => entry.area)).toContain('Personal operations');
    expect(payload.canDoNow?.map((entry) => entry.area)).toContain('Documents and artifacts');
    expect(payload.commonRoutes?.personalOps).toContain('agent_harness mode:"personal_ops"');
    expect(payload.commonRoutes?.documentOps).toContain('agent_harness mode:"document_ops"');
    expect(payload.commonRoutes?.researchWorkflow).toContain('agent_harness mode:"research_workflow"');
    expect(payload.commonRoutes?.webResearch).toContain('multi-step: agent_harness mode:"research_workflow"');
    const webResearchCapability = payload.canDoNow?.find((entry) => entry.area === 'Web research') as { readonly inspect?: string } | undefined;
    expect(webResearchCapability?.inspect).toContain('mode:"research_workflow"');

    const legacy = await registry.execute('call-context-legacy', 'goodvibes_context', {
      mode: ['home', 'graph'].join(''),
      includeAllSpaces: true,
    });
    expect(legacy.success).toBe(true);
    expect(legacy.output).not.toContain('copied context exposed');
  });

  test('Agent runtime guard keeps inspect scaffold dry-run-only from the model surface', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeInspectTool());

    installAgentToolPolicyGuard(registry);

    const inspectDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'inspect');
    expect(inspectDefinition?.description).toContain('Inspect and analyze project structure');
    const properties = inspectDefinition?.parameters.properties as Record<string, unknown>;
    expect(properties.dryRun).toBeUndefined();

    const plan = await registry.execute('call-inspect-scaffold-plan', 'inspect', {
      mode: 'scaffold',
      moduleName: 'agent-surface',
    });
    expect(plan.success).toBe(true);
    const normalized = JSON.parse(plan.output ?? '{}') as { readonly dryRun?: boolean };
    expect(normalized.dryRun).toBe(true);

    const project = await registry.execute('call-inspect-project', 'inspect', { mode: 'project' });
    expect(project.success).toBe(true);

    const write = await registry.execute('call-inspect-scaffold-write', 'inspect', {
      mode: 'scaffold',
      moduleName: 'agent-surface',
      dryRun: false,
    });
    expect(write.success).toBe(false);
    expect(write.error).toBe(AGENT_INSPECT_WRITE_DENIAL_MESSAGE);
  });

  test('Agent runtime guard narrows copied control tool to read-only product-control inspection', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeControlTool());

    installAgentToolPolicyGuard(registry);

    const controlDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'control');
    expect(controlDefinition?.description).toContain('Read-only product-control inspection');
    expect(controlDefinition?.sideEffects).toEqual([]);
    const properties = controlDefinition?.parameters.properties as Record<string, unknown>;
    const modeProperty = getRecordProperty(properties, 'mode');
    expect(modeProperty?.enum).toEqual([...AGENT_READ_ONLY_CONTROL_TOOL_MODES]);

    const commands = await registry.execute('call-control-commands', 'control', { mode: 'commands' });
    expect(commands.success).toBe(true);

    const mutation = await registry.execute('call-control-mutation', 'control', { mode: 'restart-daemon' });
    expect(mutation.success).toBe(false);
    expect(mutation.error).toBe(AGENT_CONTROL_MUTATION_DENIAL_MESSAGE);
  });

  test('Agent runtime guard narrows analyze to local static analysis modes', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeAnalyzeTool());

    installAgentToolPolicyGuard(registry);

    const analyzeDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'analyze');
    expect(analyzeDefinition?.description).toContain('local, static project analysis');
    expect(analyzeDefinition?.sideEffects).toEqual(['read_fs']);
    const properties = analyzeDefinition?.parameters.properties as Record<string, unknown>;
    const modeProperty = getRecordProperty(properties, 'mode');
    expect(modeProperty?.enum).toEqual([...AGENT_READ_ONLY_ANALYZE_TOOL_MODES]);
    expect(properties.packages).toBeUndefined();

    const security = await registry.execute('call-analyze-security', 'analyze', { mode: 'security' });
    expect(security.success).toBe(true);

    for (const mode of ['upgrade', 'semantic_diff'] as const) {
      const blocked = await registry.execute(`call-analyze-${mode}`, 'analyze', { mode });
      expect(blocked.success).toBe(false);
      expect(blocked.error).toBe(AGENT_ANALYZE_NETWORK_DENIAL_MESSAGE);
    }
  });

  test('Agent runtime guard narrows registry to discovery and bounded previews', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeRegistryTool());

    installAgentToolPolicyGuard(registry);

    const registryDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'registry');
    expect(registryDefinition?.description).toContain('Discover and preview GoodVibes Agent registry entries');
    expect(registryDefinition?.sideEffects).toEqual(['read_fs']);
    const properties = registryDefinition?.parameters.properties as Record<string, unknown>;
    const modeProperty = getRecordProperty(properties, 'mode');
    expect(modeProperty?.enum).toEqual([...AGENT_READ_ONLY_REGISTRY_TOOL_MODES]);

    const search = await registry.execute('call-registry-search', 'registry', { mode: 'search', query: 'setup' });
    expect(search.success).toBe(true);

    const previewSkill = await registry.execute('call-registry-preview-skill', 'registry', {
      mode: 'preview',
      path: '.goodvibes/skills/setup/SKILL.md',
    });
    expect(previewSkill.success).toBe(true);

    const previewAgent = await registry.execute('call-registry-preview-agent', 'registry', {
      mode: 'preview',
      path: '/tmp/example/.goodvibes/agents/reviewer/AGENT.md',
    });
    expect(previewAgent.success).toBe(true);

    const content = await registry.execute('call-registry-content', 'registry', {
      mode: 'content',
      path: '.goodvibes/skills/setup/SKILL.md',
    });
    expect(content.success).toBe(false);
    expect(content.error).toBe(AGENT_REGISTRY_CONTENT_DENIAL_MESSAGE);

    const arbitraryPreview = await registry.execute('call-registry-arbitrary-preview', 'registry', {
      mode: 'preview',
      path: '.goodvibes/secrets/token.md',
    });
    expect(arbitraryPreview.success).toBe(false);
    expect(arbitraryPreview.error).toBe(AGENT_REGISTRY_CONTENT_DENIAL_MESSAGE);
  });

  test('Agent runtime guard narrows find to serial gitignore-respecting project search', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeFindTool());

    installAgentToolPolicyGuard(registry);

    const findDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'find');
    expect(findDefinition?.description).toContain('serial, gitignore-respecting');
    expect(findDefinition?.sideEffects).toEqual(['read_fs']);
    expect(findDefinition?.concurrency).toBe('serial');

    const properties = findDefinition?.parameters.properties as Record<string, unknown>;
    expect(properties.parallel).toBeUndefined();
    const queries = getRecordProperty(properties, 'queries');
    const itemSchema = queries ? getRecordProperty(queries, 'items') : undefined;
    const queryProperties = itemSchema ? getRecordProperty(itemSchema, 'properties') : undefined;
    expect(queryProperties?.follow_symlinks).toBeUndefined();
    expect(queryProperties?.include_hidden).toBeUndefined();
    expect(queryProperties?.respect_gitignore).toBeUndefined();

    const output = getRecordProperty(properties, 'output');
    const outputProperties = output ? getRecordProperty(output, 'properties') : undefined;
    const format = outputProperties ? getRecordProperty(outputProperties, 'format') : undefined;
    expect(format?.enum).toEqual([...AGENT_READ_ONLY_FIND_OUTPUT_FORMATS]);
    expect(outputProperties?.preview_lines).toBeUndefined();

    const allowed = await registry.execute('call-find-content', 'find', {
      queries: [{ id: 'source', mode: 'content', pattern: 'GoodVibes', path: 'src' }],
      output: { format: 'context', max_results: 10 },
    });
    expect(allowed.success).toBe(true);
    const normalized = JSON.parse(allowed.output ?? '{}') as { readonly parallel?: boolean };
    expect(normalized.parallel).toBe(false);

    for (const args of [
      { queries: [{ id: 'hidden', mode: 'files', patterns: ['**/*'], include_hidden: true }] },
      { queries: [{ id: 'symlink', mode: 'files', patterns: ['**/*'], follow_symlinks: true }] },
      { queries: [{ id: 'ignored', mode: 'files', patterns: ['**/*'], respect_gitignore: false }] },
      { queries: [{ id: 'preview', mode: 'files', patterns: ['**/*'] }], output: { format: 'with_preview' } },
      { queries: [{ id: 'full', mode: 'symbols', query: 'Agent' }], output: { format: 'full' } },
      { queries: [{ id: 'parallel', mode: 'content', pattern: 'Agent' }], parallel: true },
    ] satisfies ReadonlyArray<Record<string, unknown>>) {
      const blocked = await registry.execute(`call-find-blocked-${JSON.stringify(args)}`, 'find', args);
      expect(blocked.success).toBe(false);
      expect(blocked.error).toBe(AGENT_FIND_POLICY_DENIAL_MESSAGE);
    }
  });

  test('Agent runtime guard narrows web search to bounded read-only research', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeWebSearchTool());

    installAgentToolPolicyGuard(registry);

    const webSearchDefinition = registry.getToolDefinitions().find((tool) => tool.name === 'web_search');
    expect(webSearchDefinition?.description).toContain('bounded, read-only web research');
    expect(webSearchDefinition?.sideEffects).toEqual(['network']);
    const properties = webSearchDefinition?.parameters.properties as Record<string, unknown>;
    const verbosity = getRecordProperty(properties, 'verbosity');
    const evidenceExtract = getRecordProperty(properties, 'evidenceExtract');
    const maxResults = getRecordProperty(properties, 'maxResults');
    const evidenceTopN = getRecordProperty(properties, 'evidenceTopN');
    expect(verbosity?.enum).toEqual([...AGENT_READ_ONLY_WEB_SEARCH_VERBOSITIES]);
    expect(evidenceExtract?.enum).toEqual([...AGENT_READ_ONLY_WEB_SEARCH_EVIDENCE_EXTRACTS]);
    expect(maxResults?.maximum).toBe(10);
    expect(evidenceTopN?.maximum).toBe(3);

    const allowed = await registry.execute('call-web-search-snippets', 'web_search', {
      query: 'goodvibes agent',
      maxResults: 5,
      verbosity: 'evidence',
      safeSearch: 'moderate',
      includeEvidence: true,
      evidenceTopN: 3,
      evidenceExtract: 'readable',
    });
    expect(allowed.success).toBe(true);

    const defaultSafeSearch = await registry.execute('call-web-search-default-safe', 'web_search', {
      query: 'goodvibes agent',
    });
    expect(defaultSafeSearch.success).toBe(true);
    expect(defaultSafeSearch.output).toContain('"safeSearch":"moderate"');

    for (const args of [
      { query: 'x', verbosity: 'full' },
      { query: 'x', safeSearch: 'off' },
      { query: 'x', maxResults: 25 },
      { query: 'x', includeEvidence: true, evidenceTopN: 10 },
      { query: 'x', includeEvidence: true, evidenceExtract: 'raw' },
      { query: 'x', includeEvidence: true, evidenceExtract: 'summary' },
    ]) {
      const blocked = await registry.execute(`call-web-search-blocked-${JSON.stringify(args)}`, 'web_search', args);
      expect(blocked.success).toBe(false);
      expect(blocked.error).toBe(AGENT_WEB_SEARCH_POLICY_DENIAL_MESSAGE);
    }
  });

  test('Agent runtime guard narrows copied durable workflow tools to read-only inspection', async () => {
    const registry = new ToolRegistry();
    const guarded = makeAgentHarness();
    registry.register(guarded.agentTool);
    registry.register(makeDurableModeTool('task', ['create', 'list', 'show', 'status', 'depend', 'cancel', 'handoff', 'handoffs'], [
      'title',
      'label',
      'status',
      'dependsOnSessionId',
      'dependsOnTaskId',
      'reason',
      'toSessionId',
    ]));
    registry.register(makeDurableModeTool('team', ['create', 'list', 'show', 'add-member', 'remove-member', 'set-lanes', 'delete'], [
      'name',
      'summary',
      'memberId',
      'role',
      'lanes',
    ]));
    registry.register(makeDurableModeTool('worklist', ['create', 'list', 'show', 'add-item', 'complete-item', 'reopen-item', 'remove-item'], [
      'title',
      'itemId',
      'text',
      'owner',
      'priority',
    ]));
    registry.register(makeDurableModeTool('packet', ['create', 'list', 'show', 'revise', 'publish'], [
      'title',
      'summary',
      'goals',
      'constraints',
      'risks',
      'audience',
    ]));
    registry.register(makeDurableModeTool('query', ['ask', 'list', 'show', 'answer', 'close'], [
      'prompt',
      'askedBy',
      'target',
      'answer',
      'resolution',
    ]));

    installAgentToolPolicyGuard(registry);

    const expectations = [
      {
        name: 'task',
        allowedModes: AGENT_READ_ONLY_TASK_TOOL_MODES,
        blockedModes: ['create', 'status', 'depend', 'cancel', 'handoff'] as const,
        removed: ['title', 'label', 'status', 'dependsOnSessionId', 'dependsOnTaskId', 'reason', 'toSessionId'] as const,
      },
      {
        name: 'team',
        allowedModes: AGENT_READ_ONLY_TEAM_TOOL_MODES,
        blockedModes: ['create', 'add-member', 'remove-member', 'set-lanes', 'delete'] as const,
        removed: ['name', 'summary', 'memberId', 'role', 'lanes'] as const,
      },
      {
        name: 'worklist',
        allowedModes: AGENT_READ_ONLY_WORKLIST_TOOL_MODES,
        blockedModes: ['create', 'add-item', 'complete-item', 'reopen-item', 'remove-item'] as const,
        removed: ['title', 'itemId', 'text', 'owner', 'priority'] as const,
      },
      {
        name: 'packet',
        allowedModes: AGENT_READ_ONLY_PACKET_TOOL_MODES,
        blockedModes: ['create', 'revise', 'publish'] as const,
        removed: ['title', 'summary', 'goals', 'constraints', 'risks', 'audience'] as const,
      },
      {
        name: 'query',
        allowedModes: AGENT_READ_ONLY_QUERY_TOOL_MODES,
        blockedModes: ['ask', 'answer', 'close'] as const,
        removed: ['prompt', 'askedBy', 'target', 'answer', 'resolution'] as const,
      },
    ] as const;

    for (const expectation of expectations) {
      const definition = registry.getToolDefinitions().find((tool) => tool.name === expectation.name);
      expect(definition?.description).toContain('Read-only');
      expect(definition?.description).toContain('Mutations are disabled in Agent.');
      const properties = definition?.parameters.properties as Record<string, unknown>;
      const modeProperty = getRecordProperty(properties, 'mode');
      expect(modeProperty?.enum).toEqual([...expectation.allowedModes]);
      for (const key of expectation.removed) expect(properties[key]).toBeUndefined();

      for (const mode of expectation.allowedModes) {
        const result = await registry.execute(`call-${expectation.name}-${mode}`, expectation.name, { mode });
        expect(result.success).toBe(true);
      }

      for (const mode of expectation.blockedModes) {
        const result = await registry.execute(`call-${expectation.name}-blocked-${mode}`, expectation.name, { mode });
        expect(result.success).toBe(false);
        expect(result.error).toBe(AGENT_DURABLE_WORKFLOW_MUTATION_DENIAL_MESSAGE);
      }
    }
  });

  test('child spawn inherits and enforces the parent capability ceiling', async () => {
    const parent = await runAgent({
      mode: 'spawn',
      task: 'Parent engineer',
      template: 'engineer',
      tools: ['read', 'find'],
      restrictTools: true,
    });

    const child = await runAgent({
      mode: 'spawn',
      task: 'Child researcher',
      template: 'general',
      tools: ['read', 'exec', 'find'],
      restrictTools: true,
      parentAgentId: parent.agentId as string,
      successCriteria: ['answer the question'],
      requiredEvidence: ['file list'],
      writeScope: ['src/runtime'],
      executionProtocol: 'gather-plan-apply',
      reviewMode: 'wrfc',
      communicationLane: 'parent-only',
    });

    expect(child.tools).toEqual(['read', 'find']);
    expect(child.capabilityCeilingTools).toEqual(['read', 'find']);
    expect(child.parentAgentId).toBe(parent.agentId);
    expect(child.successCriteria).toEqual(['answer the question']);
    expect(child.requiredEvidence).toEqual(['file list']);
    expect(child.writeScope).toEqual(['src/runtime']);
    expect(child.executionProtocol).toBe('gather-plan-apply');
    expect(child.reviewMode).toBe('wrfc');
    expect(child.communicationLane).toBe('parent-only');
  });

  test('child spawn fails when parent capability ceiling would remove all tools', async () => {
    const parent = await runAgent({
      mode: 'spawn',
      task: 'Parent engineer',
      template: 'engineer',
      tools: ['read'],
      restrictTools: true,
    });

    const result = await runAgentMayFail({
      mode: 'spawn',
      task: 'Child exec attempt',
      template: 'general',
      tools: ['exec'],
      restrictTools: true,
      parentAgentId: parent.agentId as string,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('capability ceiling');
  });

  test('child spawn is blocked when recursive orchestration is disabled', async () => {
    const parent = await runAgent({
      mode: 'spawn',
      task: 'Parent engineer',
      template: 'engineer',
      tools: ['read', 'find'],
      restrictTools: true,
    });

    harness.configManager.set('orchestration.recursionEnabled', false);
    const result = await runAgentMayFail({
      mode: 'spawn',
      task: 'Blocked child',
      template: 'general',
      tools: ['read'],
      restrictTools: true,
      parentAgentId: parent.agentId as string,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('recursive orchestration is disabled');
  });

  test('grandchild spawn is blocked when depth exceeds policy and emits recursion guard evidence', async () => {
    const bus = new RuntimeEventBus();
    const manager = harness.manager;
    manager.setRuntimeBus(bus);
    const seen: string[] = [];

    const unsub = bus.on<Extract<OrchestrationEvent, { type: 'ORCHESTRATION_RECURSION_GUARD_TRIGGERED' }>>('ORCHESTRATION_RECURSION_GUARD_TRIGGERED', ({ payload }) => {
      seen.push(`${payload.graphId}:${payload.reason}`);
    });

    const parent = manager.spawn({
      mode: 'spawn',
      task: 'Stuck task',
      template: 'engineer',
      tools: ['read', 'find'],
      restrictTools: true,
      cohort: 'alpha',
    });
    const child = manager.spawn({
      mode: 'spawn',
      task: 'Stuck task',
      template: 'engineer',
      tools: ['read'],
      restrictTools: true,
      parentAgentId: parent.id,
      parentNodeId: parent.orchestrationNodeId,
      orchestrationGraphId: parent.orchestrationGraphId,
      orchestrationNodeId: 'child-node',
    });

    expect(() => manager.spawn({
      mode: 'spawn',
      task: 'Stuck task',
      template: 'engineer',
      tools: ['read'],
      restrictTools: true,
      parentAgentId: child.id,
      parentNodeId: child.orchestrationNodeId,
      orchestrationGraphId: child.orchestrationGraphId,
      orchestrationNodeId: 'grandchild-node',
    })).toThrow(/depth/i);

    await flushMicrotasks();
    unsub();
    expect(seen.join('\n')).toContain('cohort:alpha');
  });

  test('cohort spawn emits orchestration node contracts on the runtime bus', async () => {
    const bus = new RuntimeEventBus();
    const manager = harness.manager;
    manager.setRuntimeBus(bus);
    const payloads: Array<Record<string, unknown>> = [];

    const unsub = bus.on('ORCHESTRATION_NODE_ADDED', ({ payload }) => {
      payloads.push(payload as unknown as Record<string, unknown>);
    });

    manager.spawn({
      mode: 'spawn',
      task: 'Stuck task',
      cohort: 'alpha',
      template: 'engineer',
      tools: ['read', 'edit'],
      restrictTools: true,
      successCriteria: ['edit target file'],
      requiredEvidence: ['changed lines'],
      writeScope: ['src/core'],
      executionProtocol: 'gather-plan-apply',
      reviewMode: 'wrfc',
      communicationLane: 'parent-only',
    });

    await flushMicrotasks();
    unsub();
    const node = payloads[0];
    expect(expectPresent(node, 'first orchestration node payload').contract).toEqual({
      allowedTools: ['read', 'edit'],
      capabilityCeiling: ['read', 'edit'],
      successCriteria: ['edit target file'],
      requiredEvidence: ['changed lines'],
      writeScope: ['src/core'],
      executionProtocol: 'gather-plan-apply',
      reviewMode: 'wrfc',
      inheritsParentConstraints: false,
      communicationLane: 'parent-only',
    });
  });

  test('cancel subtree cancels the root and all descendants', () => {
    const manager = harness.manager;
    harness.configManager.set('orchestration.maxDepth', 2);
    const parent = manager.spawn({
      mode: 'spawn',
      task: 'Stuck task',
      template: 'engineer',
      tools: ['read'],
      restrictTools: true,
      cohort: 'alpha',
    });
    const child = manager.spawn({
      mode: 'spawn',
      task: 'Stuck task',
      template: 'engineer',
      tools: ['read'],
      restrictTools: true,
      parentAgentId: parent.id,
      parentNodeId: parent.orchestrationNodeId,
      orchestrationGraphId: parent.orchestrationGraphId,
      orchestrationNodeId: 'child-node',
    });
    const grandchild = manager.spawn({
      mode: 'spawn',
      task: 'Stuck task',
      template: 'engineer',
      tools: ['read'],
      restrictTools: true,
      parentAgentId: child.id,
      parentNodeId: child.orchestrationNodeId,
      orchestrationGraphId: child.orchestrationGraphId,
      orchestrationNodeId: 'grandchild-node',
    });

    const cancelled = manager.cancelSubtree(parent.id);
    expect(cancelled).toEqual([parent.id, child.id, grandchild.id]);
    expect(manager.getStatus(parent.id)?.status).toBe('cancelled');
    expect(manager.getStatus(child.id)?.status).toBe('cancelled');
    expect(manager.getStatus(grandchild.id)?.status).toBe('cancelled');
  });

  test('cancel graph cancels all agents in the target graph only', () => {
    const manager = harness.manager;
    const alphaA = manager.spawn({ mode: 'spawn', task: 'Stuck task', template: 'engineer', tools: ['read'], restrictTools: true, cohort: 'alpha' });
    const alphaB = manager.spawn({ mode: 'spawn', task: 'Stuck task', template: 'engineer', tools: ['read'], restrictTools: true, cohort: 'alpha' });
    const beta = manager.spawn({ mode: 'spawn', task: 'Stuck task', template: 'engineer', tools: ['read'], restrictTools: true, cohort: 'beta' });

    const cancelled = manager.cancelGraph('cohort:alpha');
    expect(cancelled.sort()).toEqual([alphaA.id, alphaB.id].sort());
    expect(manager.getStatus(alphaA.id)?.status).toBe('cancelled');
    expect(manager.getStatus(alphaB.id)?.status).toBe('cancelled');
    expect(manager.getStatus(beta.id)?.status).toBe('pending');
  });

  test('spawn without task returns error', async () => {
    const result = await runAgentMayFail({ mode: 'spawn' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('task');
  });

  test('spawn with empty task returns error', async () => {
    const result = await runAgentMayFail({ mode: 'spawn', task: '   ' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('task');
  });

  test('each spawn produces a unique ID', async () => {
    const r1 = await runAgent({ mode: 'spawn', task: 'Task A' });
    const r2 = await runAgent({ mode: 'spawn', task: 'Task B' });
    expect(r1.agentId).not.toBe(r2.agentId);
  });
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

describe('status mode', () => {
  test('status returns agent info by ID', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Check status' });
    const agentId = spawned.agentId as string;

    const status = await runAgent({ mode: 'status', agentId });
    expect(status.id).toBe(agentId);
    expect(status.task).toBe('Check status');
    // Agent is immediately handed to orchestrator, so status progresses past 'pending'
    expect(['pending', 'running', 'completed', 'failed', 'cancelled']).toContain(status.status as string);
    expect(typeof status.durationMs).toBe('number');
    expect(typeof status.toolCallCount).toBe('number');
  });

  test('status returns error for unknown agent ID', async () => {
    const result = await runAgentMayFail({ mode: 'status', agentId: 'agent-notexist' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agent-notexist');
  });

  test('status without agentId returns error', async () => {
    const result = await runAgentMayFail({ mode: 'status' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agentId');
  });
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

describe('cancel mode', () => {
  test('cancel marks agent as cancelled', async () => {
    // 'Stuck task' prevents the orchestrator from running, keeping the agent in pending state.
    const spawned = await runAgent({ mode: 'spawn', task: 'Stuck task' });
    const agentId = spawned.agentId as string;

    const cancelled = await runAgent({ mode: 'cancel', agentId });
    expect(cancelled.agentId).toBe(agentId);
    expect(cancelled.status).toBe('cancelled');

    // Verify status also shows cancelled
    const status = await runAgent({ mode: 'status', agentId });
    expect(status.status).toBe('cancelled');
  });

  test('cancel unknown agent ID returns error', async () => {
    const result = await runAgentMayFail({ mode: 'cancel', agentId: 'agent-unknown1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agent-unknown1');
  });

  test('cancel without agentId returns error', async () => {
    const result = await runAgentMayFail({ mode: 'cancel' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agentId');
  });

  test('cancel on completed agent reports actual status (not forced cancelled)', async () => {
    // Spawn an agent, then manually advance its status to 'completed' via the manager.
    const spawned = await runAgent({ mode: 'spawn', task: 'Already done task' });
    const agentId = spawned.agentId as string;

    // Simulate completion by directly mutating the manager record.
    const manager = harness.manager;
    const record = manager.getStatus(agentId);
    if (record) {
      record.status = 'completed';
      record.completedAt = Date.now();
    }

    // Cancel should succeed (agent found) but report 'completed' since it was already done.
    const result = await runAgentMayFail({ mode: 'cancel', agentId });
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output!) as Record<string, unknown>;
    // AgentManager.cancel() only overwrites 'pending'/'running' — so status stays 'completed'.
    expect(parsed.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('list mode', () => {
  test('list returns empty array when no agents exist', async () => {
    const result = await runAgent({ mode: 'list' });
    expect(result.agents).toEqual([]);
    expect(result.count).toBe(0);
  });

  test('list returns all spawned agents', async () => {
    await runAgent({ mode: 'spawn', task: 'Task One', reviewMode: 'none', dangerously_disable_wrfc: true });
    await runAgent({ mode: 'spawn', task: 'Task Two', reviewMode: 'none', dangerously_disable_wrfc: true });

    const result = await runAgent({ mode: 'list' });
    const agents = result.agents as Array<Record<string, unknown>>;
    expect(agents.length).toBe(2);
    expect(result.count).toBe(2);

    const tasks = agents.map((a) => a.task);
    expect(tasks).toContain('Task One');
    expect(tasks).toContain('Task Two');
  });

  test('list includes agent status fields', async () => {
    await runAgent({ mode: 'spawn', task: 'Task with fields' });

    const result = await runAgent({ mode: 'list' });
    const agents = result.agents as Array<Record<string, unknown>>;
    const agent = agents[0];
    expect(typeof agent.id).toBe('string');
    expect(typeof agent.task).toBe('string');
    expect(typeof agent.template).toBe('string');
    expect(typeof agent.status).toBe('string');
    expect(typeof agent.startedAt).toBe('number');
    expect(typeof agent.toolCallCount).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

describe('templates mode', () => {
  test('templates returns all built-in templates', async () => {
    const result = await runAgent({ mode: 'templates' });
    const templates = result.templates as Array<{ name: string }>;
    expect(templates.map((t) => t.name)).toEqual(EXPECTED_AGENT_TEMPLATES);
  });

  test('templates includes all role templates', async () => {
    const result = await runAgent({ mode: 'templates' });
    const templates = result.templates as Array<{ name: string }>;
    const names = templates.map((t) => t.name);
    for (const name of EXPECTED_AGENT_TEMPLATES) {
      expect(names).toContain(name);
    }
  });

  test('each template has description and defaultTools', async () => {
    const result = await runAgent({ mode: 'templates' });
    const templates = result.templates as Array<{
      name: string;
      description: string;
      defaultTools: string[];
    }>;
    for (const t of templates) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.defaultTools).toEqual(expect.any(Array));
      expect(t.defaultTools.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe('get mode', () => {
  test('get returns detailed agent info', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Detailed task', template: 'engineer' });
    const agentId = spawned.agentId as string;

    const result = await runAgent({ mode: 'get', agentId });
    expect(result.id).toBe(agentId);
    expect(result.task).toBe('Detailed task');
    expect(result.template).toBe('engineer');
    expect(result.tools).toEqual(expect.any(Array));
    expect(typeof result.status).toBe('string');
    expect(typeof result.durationMs).toBe('number');
    expect(typeof result.toolCallCount).toBe('number');
  });

  test('get includes recentMessages field', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Task with messages' });
    const agentId = spawned.agentId as string;

    const result = await runAgent({ mode: 'get', agentId });
    expect(result.recentMessages).toEqual(expect.any(Array));
  });

  test('get includes messages sent to agent', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Task for messaging' });
    const agentId = spawned.agentId as string;

    // Send a message via the tool
    await runAgent({ mode: 'message', agentId, message: 'Hello agent!' });

    const result = await runAgent({ mode: 'get', agentId });
    const messages = result.recentMessages as Array<{ from: string; content: string; timestamp: number }>;
    expect(messages).toContainEqual(expect.objectContaining({ content: 'Hello agent!' }));
  });

  test('get supports targeted detail views', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Targeted detail', template: 'engineer' });
    const agentId = spawned.agentId as string;
    await runAgent({ mode: 'message', agentId, message: 'Contract only' });

    const summary = await runAgent({ mode: 'get', agentId, detail: 'summary' });
    expect(summary.tools).toBeUndefined();
    expect(summary.recentMessages).toBeUndefined();

    const contract = await runAgent({ mode: 'get', agentId, detail: 'contract' });
    expect(contract.tools).toEqual(expect.any(Array));
    expect(contract.recentMessages).toBeUndefined();

    const messages = await runAgent({ mode: 'get', agentId, detail: 'messages' });
    expect(messages.tools).toBeUndefined();
    expect(messages.recentMessages).toEqual(expect.any(Array));
  });

  test('get returns error for unknown agent', async () => {
    const result = await runAgentMayFail({ mode: 'get', agentId: 'agent-unknown99' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agent-unknown99');
  });

  test('get requires agentId', async () => {
    const result = await runAgentMayFail({ mode: 'get' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agentId');
  });
});

// ---------------------------------------------------------------------------
// budget
// ---------------------------------------------------------------------------

describe('budget mode', () => {
  test('budget returns token usage fields', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Budget task' });
    const agentId = spawned.agentId as string;

    const result = await runAgent({ mode: 'budget', agentId });
    expect(result.agentId).toBe(agentId);
    expect(typeof result.inputTokens).toBe('number');
    expect(typeof result.outputTokens).toBe('number');
    expect(typeof result.totalTokens).toBe('number');
    expect(typeof result.toolCallCount).toBe('number');
    expect(result.totalTokens).toBe((result.inputTokens as number) + (result.outputTokens as number));
  });

  test('budget returns error for unknown agent', async () => {
    const result = await runAgentMayFail({ mode: 'budget', agentId: 'agent-budgetfail' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agent-budgetfail');
  });

  test('budget requires agentId', async () => {
    const result = await runAgentMayFail({ mode: 'budget' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agentId');
  });
});

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

describe('plan mode', () => {
  test('plan returns task, template, and tools', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Plan task', template: 'engineer' });
    const agentId = spawned.agentId as string;

    const result = await runAgent({ mode: 'plan', agentId });
    expect(result.agentId).toBe(agentId);
    expect(result.task).toBe('Plan task');
    expect(result.template).toBe('engineer');
    expect(result.tools).toEqual(expect.any(Array));
    expect(typeof result.templateDescription).toBe('string');
  });

  test('plan returns model and provider as null when not set', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Plan without model' });
    const agentId = spawned.agentId as string;

    const result = await runAgent({ mode: 'plan', agentId });
    expect(result.model).toBeNull();
    expect(result.provider).toBeNull();
  });

  test('plan returns error for unknown agent', async () => {
    const result = await runAgentMayFail({ mode: 'plan', agentId: 'agent-planfail' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agent-planfail');
  });

  test('plan requires agentId', async () => {
    const result = await runAgentMayFail({ mode: 'plan' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agentId');
  });
});

// ---------------------------------------------------------------------------
// wait
// ---------------------------------------------------------------------------

describe('wait mode', () => {
  test('wait returns immediately when agent is already completed', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Already done' });
    const agentId = spawned.agentId as string;

    // Manually mark as completed
    const manager = harness.manager;
    const record = manager.getStatus(agentId);
    if (record) {
      record.status = 'completed';
      record.completedAt = Date.now();
    }

    const result = await runAgent({ mode: 'wait', agentId, timeoutMs: 5000 });
    expect(result.agentId).toBe(agentId);
    expect(result.status).toBe('completed');
    expect(result.timedOut).toBe(false);
  });

  test('wait times out when agent stays pending', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Stuck task' });
    const agentId = spawned.agentId as string;

    // Agent remains 'pending' — wait with very short timeout
    const result = await runAgent({ mode: 'wait', agentId, timeoutMs: 50 });
    expect(result.agentId).toBe(agentId);
    expect(result.timedOut).toBe(true);
  });

  test('wait returns immediately with hint when timeoutMs is 0 (default)', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Stuck task' });
    const agentId = spawned.agentId as string;

    // timeoutMs: 0 means no polling — should return immediately
    const result = await runAgent({ mode: 'wait', agentId, timeoutMs: 0 });
    expect(result.agentId).toBe(agentId);
    expect(result.timedOut).toBe(true);
    expect(result.hint).toContain('poll again');
  });

  test('wait returns immediately when agent is cancelled', async () => {
    // 'Stuck task' prevents the orchestrator from running, keeping the agent in pending state.
    const spawned = await runAgent({ mode: 'spawn', task: 'Stuck task' });
    const agentId = spawned.agentId as string;
    await runAgent({ mode: 'cancel', agentId });

    const result = await runAgent({ mode: 'wait', agentId, timeoutMs: 5000 });
    expect(result.status).toBe('cancelled');
    expect(result.timedOut).toBe(false);
  });

  test('wait returns error for unknown agent', async () => {
    const result = await runAgentMayFail({ mode: 'wait', agentId: 'agent-waitfail' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agent-waitfail');
  });

  test('wait requires agentId', async () => {
    const result = await runAgentMayFail({ mode: 'wait' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agentId');
  });

  test('wait returns deleted status when agent is removed during poll', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Stuck task' });
    const agentId = spawned.agentId as string;

    const manager = harness.manager;
    const originalRecord = manager.getStatus(agentId);

    // On first call return the record (initial existence check passes),
    // then return null for all subsequent calls (agent removed during poll).
    let callCount = 0;
    const spy = spyOn(manager, 'getStatus').mockImplementation((_id: string) => {
      callCount++;
      if (callCount === 1) return originalRecord;
      return null;
    });

    const result = await runAgent({ mode: 'wait', agentId, timeoutMs: 200 });

    spy.mockRestore();

    expect(result.agentId).toBe(agentId);
    expect(result.status).toBe('deleted');
  });
});

// ---------------------------------------------------------------------------
// message
// ---------------------------------------------------------------------------

describe('message mode', () => {
  test('message sends to agent and returns sent=true', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Receive messages' });
    const agentId = spawned.agentId as string;

    const result = await runAgent({ mode: 'message', agentId, message: 'Hello from orchestrator' });
    expect(result.agentId).toBe(agentId);
    expect(result.sent).toBe(true);
    expect(result.content).toBe('Hello from orchestrator');
  });

  test('message is visible via getMessages on the bus', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Bus test' });
    const agentId = spawned.agentId as string;

    await runAgent({ mode: 'message', agentId, message: 'Check the bus' });

    const bus = harness.messageBus;
    const msgs = bus.getMessages(agentId);
    expect(msgs).toContainEqual(expect.objectContaining({ content: 'Check the bus' }));
    expect(msgs.find((m) => m.content === 'Check the bus')?.from).toBe('orchestrator');
  });

  test('message returns error for unknown agent', async () => {
    const result = await runAgentMayFail({
      mode: 'message',
      agentId: 'agent-msgfail',
      message: 'Test',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agent-msgfail');
  });

  test('message requires agentId', async () => {
    const result = await runAgentMayFail({ mode: 'message', message: 'No target' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('agentId');
  });

  test('message requires message content', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Empty msg target' });
    const agentId = spawned.agentId as string;

    const result = await runAgentMayFail({ mode: 'message', agentId });
    expect(result.success).toBe(false);
    expect(result.error).toContain('message');
  });

  test('message with empty string returns error', async () => {
    const spawned = await runAgent({ mode: 'spawn', task: 'Whitespace message target' });
    const agentId = spawned.agentId as string;

    const result = await runAgentMayFail({ mode: 'message', agentId, message: '   ' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('message');
  });
});

// ---------------------------------------------------------------------------
// Error / validation cases
// ---------------------------------------------------------------------------

describe('error cases', () => {
  test('invalid mode returns error', async () => {
    const result = await runAgentMayFail({ mode: 'not_a_valid_mode' });
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  test('missing mode returns error', async () => {
    const result = await runAgentMayFail({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('mode');
  });

  test('spawn with invalid template returns error', async () => {
    const result = await runAgentMayFail({
      mode: 'spawn',
      task: 'Some task',
      template: 'nonexistent-template',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('nonexistent-template');
  });
});
