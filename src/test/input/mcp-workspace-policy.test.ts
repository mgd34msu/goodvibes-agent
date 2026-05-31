import { describe, expect, mock, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpWorkspace } from '../../input/mcp-workspace.ts';
import type { CommandContext } from '../../input/command-registry.ts';
import { createShellPathService } from '../../runtime/index.ts';

function makeContext(calls: {
  readonly reload: ReturnType<typeof mock>;
  readonly upsertServerConfig: ReturnType<typeof mock>;
  readonly removeServerConfig: ReturnType<typeof mock>;
}): CommandContext {
  const root = mkdtempSync(join(tmpdir(), 'gv-mcp-workspace-policy-'));
  const shellPaths = createShellPathService({
    workingDirectory: root,
    homeDirectory: root,
  });
  return {
    session: {} as never,
    provider: {} as never,
    workspace: { shellPaths } as never,
    platform: {} as never,
    ops: {} as never,
    extensions: {} as never,
    clients: {
      mcpApi: {
        getEffectiveConfig: () => ({
          servers: [{
            server: {
              name: 'filesystem',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
              role: 'filesystem',
              trustMode: 'constrained',
            },
            source: { scope: 'project', kind: 'project', path: join(root, '.goodvibes', 'mcp.json') },
          }],
          locations: [{
            scope: 'project',
            kind: 'project',
            path: join(root, '.goodvibes', 'mcp.json'),
            writable: true,
          }],
        }),
        listServerSecurity: () => [{
          name: 'filesystem',
          connected: true,
          role: 'filesystem',
          trustMode: 'constrained',
          schemaFreshness: 'fresh',
          allowedPaths: ['.'],
          allowedHosts: [],
        }],
        listAllTools: async () => [],
        reload: calls.reload,
        upsertServerConfig: calls.upsertServerConfig,
        removeServerConfig: calls.removeServerConfig,
      } as never,
    },
    renderRequest: () => {},
    print: () => {},
    exit: () => {},
  } as unknown as CommandContext;
}

describe('McpWorkspace Agent policy', () => {
  test('blocks workspace reload, save, and remove mutations in favor of explicit /mcp --yes commands', async () => {
    const calls = {
      reload: mock(async () => ({ added: 0, changed: 0, removed: 0, unchanged: 1 })),
      upsertServerConfig: mock(async () => ({ path: 'mcp.json', reload: { added: 0, changed: 0, removed: 0, unchanged: 1 } })),
      removeServerConfig: mock(async () => ({ removed: true, path: 'mcp.json', reload: { added: 0, changed: 0, removed: 1, unchanged: 0 } })),
    };
    const workspace = new McpWorkspace();
    workspace.open(makeContext(calls));

    await workspace.reloadRuntime();
    expect(calls.reload).toHaveBeenCalledTimes(0);
    expect(workspace.status).toContain('/mcp reload --yes');

    workspace.openAddForm();
    workspace.form.name = 'docs';
    workspace.form.command = 'npx';
    workspace.form.args = '-y @modelcontextprotocol/server-filesystem docs';
    await workspace.saveForm();
    expect(calls.upsertServerConfig).toHaveBeenCalledTimes(0);
    expect(workspace.status).toContain('/mcp add docs npx');
    expect(workspace.status).toContain('--yes');

    workspace.requestDelete('filesystem');
    await workspace.confirmDelete();
    expect(calls.removeServerConfig).toHaveBeenCalledTimes(0);
    expect(workspace.status).toContain('/mcp remove filesystem --scope project --yes');
  });
});
