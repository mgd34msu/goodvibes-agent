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
    expect(manager.getCategory('agent_artifacts', { mode: 'archive' })).toBe('write');
    expect(manager.getCategory('agent_review_packet_presets', { mode: 'list' })).toBe('read');
    expect(manager.getCategory('agent_review_packet_presets', { mode: 'show' })).toBe('read');
    expect(manager.getCategory('agent_review_packet_presets', { mode: 'save' })).toBe('write');
    expect(manager.getCategory('agent_review_packet_presets', { mode: 'refresh' })).toBe('write');
    expect(manager.getCategory('channels', { action: 'triage' })).toBe('read');
    expect(manager.getCategory('channels', { action: 'deliveries' })).toBe('read');
    expect(manager.getCategory('context', { action: 'files' })).toBe('read');
    expect(manager.getCategory('context', { action: 'receipt' })).toBe('read');
    expect(manager.getCategory('device', { action: 'status' })).toBe('read');
    expect(manager.getCategory('device', { action: 'browser' })).toBe('read');
    expect(manager.getCategory('device', { action: 'control' })).toBe('read');
    expect(manager.getCategory('device', { action: 'provider' })).toBe('read');
    expect(manager.getCategory('device', { action: 'open_browser' })).toBe('write');
    expect(manager.getCategory('host', { action: 'status' })).toBe('read');
    expect(manager.getCategory('host', { action: 'methods' })).toBe('read');
    expect(manager.getCategory('models', { action: 'status' })).toBe('read');
    expect(manager.getCategory('models', { action: 'local' })).toBe('read');
    expect(manager.getCategory('models', { action: 'providers' })).toBe('read');
    expect(manager.getCategory('models', { action: 'provider' })).toBe('read');
    expect(manager.getCategory('models', { action: 'smoke' })).toBe('write');
    expect(manager.getCategory('process', { action: 'list' })).toBe('read');
    expect(manager.getCategory('process', { action: 'log' })).toBe('read');
    expect(manager.getCategory('process', { action: 'kill' })).toBe('execute');
    expect(manager.getCategory('terminal', { background: true })).toBe('execute');
    expect(manager.getCategory('personal_ops', { action: 'briefing' })).toBe('read');
    expect(manager.getCategory('personal_ops', { action: 'intake' })).toBe('read');
    expect(manager.getCategory('personal_ops', { action: 'lane' })).toBe('read');
    expect(manager.getCategory('personal_ops', { action: 'read' })).toBe('write');
    expect(manager.getCategory('research', { action: 'plan' })).toBe('read');
    expect(manager.getCategory('research', { action: 'bundle' })).toBe('read');
    expect(manager.getCategory('research', { action: 'create_run' })).toBe('write');
    expect(manager.getCategory('research', { action: 'report' })).toBe('write');
    expect(manager.getCategory('schedule', { action: 'list' })).toBe('read');
    expect(manager.getCategory('schedule', { action: 'pause' })).toBe('execute');
    expect(manager.getCategory('settings', { action: 'list' })).toBe('read');
    expect(manager.getCategory('settings', { action: 'get' })).toBe('read');
    expect(manager.getCategory('settings', { action: 'set' })).toBe('write');
    expect(manager.getCategory('settings', { action: 'reset' })).toBe('write');
    expect(manager.getCategory('settings', { action: 'import' })).toBe('read');
    expect(manager.getCategory('settings', { action: 'import', confirm: true })).toBe('write');
    expect(manager.getCategory('setup', { action: 'status' })).toBe('read');
    expect(manager.getCategory('setup', { action: 'checkpoint' })).toBe('read');
    expect(manager.getCategory('setup', { action: 'smoke' })).toBe('write');
    expect(manager.getCategory('setup', { action: 'finish' })).toBe('write');
    expect(manager.getCategory('vibe', { action: 'status' })).toBe('read');
    expect(manager.getCategory('vibe', { action: 'show' })).toBe('read');
    expect(manager.getCategory('vibe', { action: 'init' })).toBe('write');
    expect(manager.getCategory('vibe', { action: 'import_persona' })).toBe('write');
    expect(manager.getCategory('import_goodvibes_settings', { action: 'preview' })).toBe('read');
    expect(manager.getCategory('import_goodvibes_settings', { action: 'apply' })).toBe('write');
    expect(manager.getCategory('agent_review_packet_share')).toBe('delegate');
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
    expect(manager.getCategory('agent_artifacts', { mode: 'archive' })).toBe('write');
    expect(manager.getCategory('agent_review_packet_presets', { mode: 'list' })).toBe('read');
    expect(manager.getCategory('agent_review_packet_presets', { mode: 'save' })).toBe('write');
    expect(manager.getCategory('agent_review_packet_presets', { mode: 'refresh' })).toBe('write');
    expect(manager.getCategory('channels')).toBe('read');
    expect(manager.getCategory('channels', { mode: 'channel_setup_guide' })).toBe('read');
    expect(manager.getCategory('context')).toBe('read');
    expect(manager.getCategory('context', { mode: 'prompt_context' })).toBe('read');
    expect(manager.getCategory('device')).toBe('read');
    expect(manager.getCategory('device', { mode: 'pairing_route' })).toBe('read');
    expect(manager.getCategory('device', { mode: 'open_tts_voice' })).toBe('write');
    expect(manager.getCategory('host')).toBe('read');
    expect(manager.getCategory('host', { mode: 'daemon_status' })).toBe('read');
    expect(manager.getCategory('models')).toBe('read');
    expect(manager.getCategory('models', { mode: 'route' })).toBe('read');
    expect(manager.getCategory('models', { mode: 'check_local' })).toBe('write');
    expect(manager.getCategory('process', { action: 'poll' })).toBe('read');
    expect(manager.getCategory('process', { action: 'wait' })).toBe('execute');
    expect(manager.getCategory('personal_ops')).toBe('read');
    expect(manager.getCategory('personal_ops', { mode: 'triage' })).toBe('read');
    expect(manager.getCategory('personal_ops', { mode: 'run' })).toBe('write');
    expect(manager.getCategory('research')).toBe('read');
    expect(manager.getCategory('research', { mode: 'source_queue' })).toBe('read');
    expect(manager.getCategory('research', { mode: 'add_source' })).toBe('write');
    expect(manager.getCategory('schedule', { action: 'status' })).toBe('read');
    expect(manager.getCategory('schedule', { action: 'create' })).toBe('execute');
    expect(manager.getCategory('settings')).toBe('read');
    expect(manager.getCategory('settings', { mode: 'show' })).toBe('read');
    expect(manager.getCategory('settings', { mode: 'preview_import' })).toBe('read');
    expect(manager.getCategory('settings', { mode: 'apply_import' })).toBe('write');
    expect(manager.getCategory('settings', { mode: 'change' })).toBe('write');
    expect(manager.getCategory('setup')).toBe('read');
    expect(manager.getCategory('setup', { mode: 'item' })).toBe('read');
    expect(manager.getCategory('setup', { mode: 'import_settings' })).toBe('write');
    expect(manager.getCategory('vibe')).toBe('read');
    expect(manager.getCategory('vibe', { mode: 'show' })).toBe('read');
    expect(manager.getCategory('vibe', { mode: 'import' })).toBe('write');
    expect(manager.getCategory('import_goodvibes_settings')).toBe('read');
    expect(manager.getCategory('import_goodvibes_settings', { mode: 'apply' })).toBe('write');
    expect(manager.getCategory('exec')).toBe('execute');
    expect(manager.getCategory('terminal')).toBe('execute');
    expect(manager.getCategory('agent_channel_send')).toBe('delegate');
    expect(manager.getCategory('agent_review_packet_share')).toBe('delegate');
  });

  test('allows read-only fallback tools and denies side-effecting fallback tools without throwing', async () => {
    const manager = throwingPermissionManager();
    installPermissionManagerSafetyGuard(manager);

    await expect(manager.check('goodvibes_context', {})).resolves.toBe(true);
    await expect(manager.check('agent_artifacts', { mode: 'show' })).resolves.toBe(true);
    await expect(manager.check('agent_artifacts', { mode: 'export' })).resolves.toBe(false);
    await expect(manager.check('agent_artifacts', { mode: 'package' })).resolves.toBe(false);
    await expect(manager.check('agent_artifacts', { mode: 'archive' })).resolves.toBe(false);
    await expect(manager.check('agent_review_packet_presets', { mode: 'show' })).resolves.toBe(true);
    await expect(manager.check('agent_review_packet_presets', { mode: 'save' })).resolves.toBe(false);
    await expect(manager.check('agent_review_packet_presets', { mode: 'refresh' })).resolves.toBe(false);
    await expect(manager.check('channels', { action: 'setup' })).resolves.toBe(true);
    await expect(manager.check('context', { action: 'prompt' })).resolves.toBe(true);
    await expect(manager.check('device', { action: 'voice' })).resolves.toBe(true);
    await expect(manager.check('device', { action: 'open_browser' })).resolves.toBe(false);
    await expect(manager.check('host', { action: 'services' })).resolves.toBe(true);
    await expect(manager.check('models', { action: 'local' })).resolves.toBe(true);
    await expect(manager.check('models', { action: 'smoke' })).resolves.toBe(false);
    await expect(manager.check('process', { action: 'list' })).resolves.toBe(true);
    await expect(manager.check('process', { action: 'kill' })).resolves.toBe(false);
    await expect(manager.check('personal_ops', { action: 'briefing' })).resolves.toBe(true);
    await expect(manager.check('personal_ops', { action: 'read' })).resolves.toBe(false);
    await expect(manager.check('research', { action: 'sources' })).resolves.toBe(true);
    await expect(manager.check('research', { action: 'review_source' })).resolves.toBe(false);
    await expect(manager.check('schedule', { action: 'list' })).resolves.toBe(true);
    await expect(manager.check('schedule', { action: 'run' })).resolves.toBe(false);
    await expect(manager.check('settings', { action: 'list' })).resolves.toBe(true);
    await expect(manager.check('settings', { action: 'get' })).resolves.toBe(true);
    await expect(manager.check('settings', { action: 'import' })).resolves.toBe(true);
    await expect(manager.check('settings', { action: 'set' })).resolves.toBe(false);
    await expect(manager.check('settings', { action: 'import', confirm: true })).resolves.toBe(false);
    await expect(manager.check('setup', { action: 'status' })).resolves.toBe(true);
    await expect(manager.check('setup', { action: 'token' })).resolves.toBe(false);
    await expect(manager.check('vibe', { action: 'status' })).resolves.toBe(true);
    await expect(manager.check('vibe', { action: 'init' })).resolves.toBe(false);
    await expect(manager.check('import_goodvibes_settings', { action: 'preview' })).resolves.toBe(true);
    await expect(manager.check('import_goodvibes_settings', { action: 'apply' })).resolves.toBe(false);
    await expect(manager.check('exec', { commands: [] })).resolves.toBe(false);
    await expect(manager.check('terminal', { background: true })).resolves.toBe(false);

    const detailed = await manager.checkDetailed('agent_harness', { mode: 'summary' });
    expect(detailed.approved).toBe(true);
    expect(detailed.analysis.reasons).toContain('permission-manager-exception');
  });

  test('keeps fallback category mapping explicit for registered tool families', () => {
    expect(fallbackPermissionCategory('agent_knowledge')).toBe('read');
    expect(fallbackPermissionCategory('agent_artifacts')).toBe('write');
    expect(fallbackPermissionCategory('settings')).toBe('read');
    expect(fallbackPermissionCategory('agent_review_packet_presets')).toBe('write');
    expect(fallbackPermissionCategory('agent_review_packet_share')).toBe('delegate');
    expect(fallbackPermissionCategory('agent_work_plan')).toBe('write');
    expect(fallbackPermissionCategory('channels')).toBe('read');
    expect(fallbackPermissionCategory('context')).toBe('read');
    expect(fallbackPermissionCategory('device')).toBe('read');
    expect(fallbackPermissionCategory('host')).toBe('read');
    expect(fallbackPermissionCategory('models')).toBe('read');
    expect(fallbackPermissionCategory('terminal')).toBe('execute');
    expect(fallbackPermissionCategory('process')).toBe('execute');
    expect(fallbackPermissionCategory('personal_ops')).toBe('read');
    expect(fallbackPermissionCategory('research')).toBe('read');
    expect(fallbackPermissionCategory('schedule')).toBe('delegate');
    expect(fallbackPermissionCategory('setup')).toBe('read');
    expect(fallbackPermissionCategory('vibe')).toBe('read');
    expect(fallbackPermissionCategory('unknown_tool')).toBe('delegate');
  });
});
