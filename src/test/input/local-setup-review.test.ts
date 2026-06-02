import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandContext } from '../../input/command-registry.ts';
import { buildSetupReviewSnapshot } from '../../input/commands/local-setup-review.ts';
import { createShellPathService } from '../../runtime/index.ts';

function makeSetupReviewContext(root: string): CommandContext {
  const shellPaths = createShellPathService({
    workingDirectory: join(root, 'workspace'),
    homeDirectory: join(root, 'home'),
  });

  return {
    workspace: { shellPaths },
    platform: {
      serviceRegistry: {
        getAll: () => ({}),
        inspect: async () => null,
      },
      subscriptionManager: {
        list: () => [],
        listPending: () => [],
      },
      readModels: {
        security: {
          getSnapshot: () => ({
            plugins: [],
            mcpServers: [],
          }),
        },
      },
    },
    clients: {
      providerApi: {
        listModels: async () => [
          { id: 'model', provider: 'provider', registryKey: 'provider:model' },
        ],
      },
    },
    ops: {
      remoteRuntime: {
        listContracts: () => [],
      },
    },
    session: {
      runtime: {
        sessionId: 'session-1',
      },
    },
  } as unknown as CommandContext;
}

describe('local setup review', () => {
  test('does not treat absent host hooks or remote workers as Agent setup gaps', async () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-setup-review-'));
    try {
      const snapshot = await buildSetupReviewSnapshot(makeSetupReviewContext(root));
      const areas = snapshot.issues.map((issue) => issue.area);

      expect(areas).not.toContain('hooks');
      expect(areas).not.toContain('remote');
      expect(snapshot.remoteRunnerCount).toBe(0);
      expect(snapshot.managedHookCount).toBe(0);
      expect(snapshot.managedHookChainCount).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
