import { describe, test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { registerAllTools } from '@pellux/goodvibes-sdk/platform/tools';
import { createTestManagers } from '../helpers/test-managers.ts';
import { CrossSessionTaskRegistry } from '@pellux/goodvibes-sdk/platform/sessions';
import { SandboxSessionRegistry } from '@/runtime/index.ts';
import { RemoteRunnerRegistry } from '@/runtime/index.ts';
import { AgentMessageBus } from '@pellux/goodvibes-sdk/platform/agents';
import { AgentManager } from '@pellux/goodvibes-sdk/platform/tools';
import { OverflowHandler } from '@pellux/goodvibes-sdk/platform/tools';
import { FileUndoManager } from '@pellux/goodvibes-sdk/platform/state';
import { ModeManager } from '@pellux/goodvibes-sdk/platform/state';
import { ProcessManager } from '@pellux/goodvibes-sdk/platform/tools';
import { createWorkflowServices } from '@pellux/goodvibes-sdk/platform/tools';

function registerTools(registry: ToolRegistry): void {
  const services = createTestManagers();
  const workingDirectory = mkdtempSync(join(tmpdir(), 'gv-tool-registry-'));
  const agentManager = new AgentManager({
    messageBus: new AgentMessageBus(),
    configManager: services.configManager,
  });
  const sessionOrchestration = new CrossSessionTaskRegistry(
    join(workingDirectory, '.goodvibes', 'tui', 'sessions', 'task-graph.json'),
  );
  const sandboxSessionRegistry = new SandboxSessionRegistry(workingDirectory);
  const remoteRunnerRegistry = new RemoteRunnerRegistry(agentManager);
  const agentMessageBus = new AgentMessageBus();
  registerAllTools(registry, {
    surfaceRoot: 'tui',
    fileUndoManager: new FileUndoManager(),
    modeManager: new ModeManager(),
    processManager: new ProcessManager(),
    agentManager,
    agentMessageBus,
    configManager: services.configManager,
    providerRegistry: services.providerRegistry,
    toolLLM: services.toolLLM,
    sessionOrchestration,
    sandboxSessionRegistry,
    workingDirectory,
    overflowHandler: new OverflowHandler({ baseDir: workingDirectory }),
    webSearchService: {
      search: async () => [],
    } as never,
    channelRegistry: null,
    remoteRunnerRegistry,
    workflowServices: createWorkflowServices(),
    mcpRegistry: {
      list: () => [],
    } as never,
  });
}

describe('registerAllTools', () => {
  test('registers the expected platform tool roster', () => {
    const registry = new ToolRegistry();
    registerTools(registry);
    const names = registry.list().map((tool) => tool.definition.name).sort();
    expect(names).toEqual([
      'agent',
      'analyze',
      'channel',
      'control',
      'edit',
      'exec',
      'fetch',
      'find',
      'goodvibes_context',
      'goodvibes_settings',
      'inspect',
      'mcp',
      'packet',
      'query',
      'read',
      'registry',
      'remote',
      'repl',
      'state',
      'task',
      'team',
      'web_search',
      'workflow',
      'worklist',
      'write',
    ]);
    expect(registry.has('powershell')).toBe(false);
  });

  test('each tool has a definition with name and description', () => {
    const registry = new ToolRegistry();
    registerTools(registry);
    for (const tool of registry.list()) {
      expect(typeof tool.definition.name).toBe('string');
      expect(tool.definition.name.length).toBeGreaterThan(0);
      expect(typeof tool.definition.description).toBe('string');
      expect(tool.definition.description.length).toBeGreaterThan(0);
      expect(typeof tool.definition.parameters).toBe('object');
    }
  });

  test('each tool has an execute function', () => {
    const registry = new ToolRegistry();
    registerTools(registry);
    for (const tool of registry.list()) {
      expect(typeof tool.execute).toBe('function');
    }
  });
});
