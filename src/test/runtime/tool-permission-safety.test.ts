import { describe, expect, test } from 'bun:test';
import type { PermissionCategory, PermissionCheckResult } from '@pellux/goodvibes-sdk/platform/permissions';
import { fallbackPermissionCategory, installPermissionManagerSafetyGuard } from '../../runtime/tool-permission-safety.ts';

type TestPermissionManager = {
  check(toolName: string, args: Record<string, unknown>): Promise<boolean>;
  checkDetailed(toolName: string, args: Record<string, unknown>): Promise<PermissionCheckResult>;
  getCategory(toolName: string, args?: Record<string, unknown>): PermissionCategory;
};

function throwingPermissionManager(): TestPermissionManager {
  return {
    check: async (_toolName, _args) => {
      throw new Error('category table unavailable');
    },
    checkDetailed: async (_toolName, _args): Promise<PermissionCheckResult> => {
      throw new Error('category table unavailable');
    },
    getCategory: (_toolName, _args): PermissionCategory => {
      throw new Error('category table unavailable');
    },
  };
}

function delegatingPermissionManager(): TestPermissionManager {
  return {
    check: async (_toolName, _args) => false,
    checkDetailed: async (_toolName, _args): Promise<PermissionCheckResult> => ({
      approved: false,
      persisted: false,
      sourceLayer: 'runtime_mode',
      reasonCode: 'config_deny',
      analysis: {
        classification: 'generic',
        riskLevel: 'high',
        summary: 'delegate',
        reasons: [],
      },
    }),
    getCategory: (_toolName, _args): PermissionCategory => 'delegate',
  };
}

describe('Agent tool permission safety guard', () => {
  test('overrides generic delegate categories for known Agent tool modes', () => {
    const manager = delegatingPermissionManager();
    installPermissionManagerSafetyGuard(manager);

    expect(manager.getCategory('agent_harness')).toBe('read');
    expect(manager.getCategory('agent_artifacts', { mode: 'list' })).toBe('read');
    expect(manager.getCategory('agent_artifacts', { mode: 'show' })).toBe('read');
    expect(manager.getCategory('agent_artifacts', { mode: 'export' })).toBe('write');
    expect(manager.getCategory('agent_artifacts', { mode: 'package' })).toBe('write');
    expect(manager.getCategory('unknown_tool')).toBe('delegate');
  });

  test('falls back to stable categories when SDK permission category lookup throws', () => {
    const manager = throwingPermissionManager();
    installPermissionManagerSafetyGuard(manager);

    expect(manager.getCategory('goodvibes_context')).toBe('read');
    expect(manager.getCategory('agent_harness')).toBe('read');
    expect(manager.getCategory('agent_artifacts', { mode: 'list' })).toBe('read');
    expect(manager.getCategory('agent_artifacts', { mode: 'export' })).toBe('write');
    expect(manager.getCategory('agent_artifacts', { mode: 'package' })).toBe('write');
    expect(manager.getCategory('exec')).toBe('execute');
    expect(manager.getCategory('agent_channel_send')).toBe('delegate');
  });

  test('allows read-only fallback tools and denies side-effecting fallback tools without throwing', async () => {
    const manager = throwingPermissionManager();
    installPermissionManagerSafetyGuard(manager);

    await expect(manager.check('goodvibes_context', {})).resolves.toBe(true);
    await expect(manager.check('agent_artifacts', { mode: 'show' })).resolves.toBe(true);
    await expect(manager.check('agent_artifacts', { mode: 'export' })).resolves.toBe(false);
    await expect(manager.check('agent_artifacts', { mode: 'package' })).resolves.toBe(false);
    await expect(manager.check('exec', { commands: [] })).resolves.toBe(false);

    const detailed = await manager.checkDetailed('agent_harness', { mode: 'summary' });
    expect(detailed.approved).toBe(true);
    expect(detailed.analysis.reasons).toContain('permission-manager-exception');
  });

  test('keeps fallback category mapping explicit for registered tool families', () => {
    expect(fallbackPermissionCategory('agent_knowledge')).toBe('read');
    expect(fallbackPermissionCategory('agent_artifacts')).toBe('write');
    expect(fallbackPermissionCategory('agent_work_plan')).toBe('write');
    expect(fallbackPermissionCategory('unknown_tool')).toBe('delegate');
  });
});
