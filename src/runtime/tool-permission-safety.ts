import type { PermissionCategory, PermissionCheckResult } from '@pellux/goodvibes-sdk/platform/permissions';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';

type PermissionManagerLike = {
  check(toolName: string, args: Record<string, unknown>): Promise<boolean>;
  checkDetailed?: (toolName: string, args: Record<string, unknown>) => Promise<PermissionCheckResult>;
  getCategory(toolName: string, args?: Record<string, unknown>): PermissionCategory;
};

const SAFETY_MARKER = Symbol.for('goodvibes-agent.permission-safety-installed');

const READ_TOOL_NAMES = new Set([
  'read',
  'find',
  'fetch',
  'analyze',
  'inspect',
  'state',
  'registry',
  'goodvibes_context',
  'channels',
  'context',
  'device',
  'host',
  'memory',
  'models',
  'personal_ops',
  'research',
  'setup',
  'settings',
  'vibe',
  'agent_harness',
  'agent_knowledge',
  'agent_operator_briefing',
]);

const WRITE_TOOL_NAMES = new Set([
  'write',
  'edit',
  'goodvibes_settings',
  'agent_artifacts',
  'agent_documents',
  'agent_knowledge_ingest',
  'agent_learning_consolidation',
  'agent_local_registry',
  'agent_research_runs',
  'agent_research_sources',
  'agent_research_report',
  'agent_review_packet_presets',
  'agent_work_plan',
]);

const EXECUTE_TOOL_NAMES = new Set(['exec', 'repl', 'terminal', 'process']);
const READ_ONLY_PROCESS_ACTIONS = new Set(['', 'list', 'status', 'poll', 'log', 'output', 'capabilities', 'doctor', 'parity']);
const READ_ONLY_SCHEDULE_ACTIONS = new Set(['', 'list', 'status', 'show']);
const READ_ONLY_SETTINGS_IMPORT_ACTIONS = new Set(['', 'preview', 'inspect', 'show', 'plan']);
const READ_ONLY_SETTINGS_ACTIONS = new Set(['', 'list', 'status', 'settings', 'catalog', 'search', 'find', 'browse', 'get', 'show', 'inspect', 'read', 'setting', 'get_setting', 'import', 'import_settings', 'settings_import', 'import_goodvibes', 'goodvibes_import', 'preview_import']);
const READ_ONLY_SETUP_ACTIONS = new Set(['', 'status', 'summary', 'list', 'item', 'show', 'inspect', 'checkpoint', 'checkpoint_status']);
const READ_ONLY_VIBE_ACTIONS = new Set(['', 'status', 'summary', 'list', 'show', 'file', 'source', 'read', 'inspect']);
const READ_ONLY_PERSONAL_OPS_ACTIONS = new Set(['', 'briefing', 'brief', 'daily', 'daily_brief', 'morning', 'status', 'summary', 'overview', 'map', 'list', 'intake', 'request', 'route', 'plan', 'triage', 'draft', 'lane', 'inspect', 'show']);
const READ_ONLY_RESEARCH_ACTIONS = new Set(['', 'plan', 'workflow', 'research', 'runs', 'list_runs', 'run_list', 'run', 'show_run', 'inspect_run', 'sources', 'queue', 'source_queue', 'source', 'show_source', 'inspect_source', 'bundle', 'bundle_sources', 'source_bundle']);
const READ_ONLY_CHANNELS_ACTIONS = new Set(['', 'status', 'summary', 'list', 'readiness', 'channels', 'channel', 'show', 'inspect', 'setup', 'guide', 'setup_guide', 'channel_setup_guide', 'triage', 'inbox', 'blockers', 'retries', 'channel_triage', 'deliveries', 'delivery', 'receipts', 'history', 'channel_deliveries']);
const READ_ONLY_MEMORY_ACTIONS = new Set(['', 'status', 'summary', 'posture', 'memory_posture', 'recall', 'providers', 'provider', 'memory_provider', 'embedding', 'external', 'external_provider', 'curator', 'learning', 'learning_curator', 'queue', 'review_queue', 'plan', 'candidate', 'learning_candidate', 'card', 'inspect_candidate', 'list', 'records', 'memories', 'search', 'find', 'lookup', 'get', 'show', 'inspect', 'read']);
const READ_ONLY_DEVICE_ACTIONS = new Set(['', 'status', 'map', 'capabilities', 'device', 'devices', 'mobile', 'phone', 'pairing', 'capability', 'route', 'pairing_route', 'show', 'inspect', 'browser', 'pwa', 'cockpit', 'browser_cockpit', 'web', 'control', 'browser_control', 'desktop', 'desktop_control', 'computer_use', 'voice', 'media', 'voice_media', 'workflows', 'provider', 'media_provider', 'voice_provider']);
const READ_ONLY_MODELS_ACTIONS = new Set(['', 'status', 'routing', 'routes', 'models', 'model', 'readiness', 'route_readiness', 'route', 'model_route', 'inspect', 'show', 'candidate', 'endpoint', 'local', 'cookbook', 'local_cookbook', 'recipes', 'recipe', 'ollama', 'llama_cpp', 'llamacpp', 'vllm', 'local_servers', 'providers', 'provider_accounts', 'accounts', 'subscriptions', 'auth', 'logins', 'provider', 'provider_account', 'account', 'subscription', 'auth_status']);

type MarkedPermissionManager = PermissionManagerLike & { [SAFETY_MARKER]?: true };

export function installPermissionManagerSafetyGuard(manager: PermissionManagerLike): void {
  const marked = manager as MarkedPermissionManager;
  if (marked[SAFETY_MARKER]) return;
  marked[SAFETY_MARKER] = true;

  const originalGetCategory = manager.getCategory.bind(manager);
  const originalCheck = manager.check.bind(manager);
  const originalCheckDetailed = manager.checkDetailed?.bind(manager);

  manager.getCategory = (toolName, args = {}) => {
    try {
      const category = originalGetCategory(toolName, args);
      const knownCategory = fallbackPermissionCategoryForArgs(toolName, args);
      return category === 'delegate' && knownCategory !== 'delegate' ? knownCategory : category;
    } catch {
      return fallbackPermissionCategoryForArgs(toolName, args);
    }
  };

  manager.check = async (toolName, args) => {
    try {
      return await originalCheck(toolName, args);
    } catch {
      return fallbackPermissionCategoryForArgs(toolName, args) === 'read';
    }
  };

  if (originalCheckDetailed) {
    manager.checkDetailed = async (toolName, args) => {
      try {
        return await originalCheckDetailed(toolName, args);
      } catch (error) {
        const category = fallbackPermissionCategoryForArgs(toolName, args);
        const approved = category === 'read';
        return {
          approved,
          persisted: false,
          sourceLayer: 'runtime_mode',
          reasonCode: approved ? 'config_allow' : 'config_deny',
          analysis: {
            classification: 'generic',
            riskLevel: category === 'read' ? 'low' : 'high',
            summary: `Permission fallback for ${toolName}: ${summarizeError(error)}`,
            reasons: ['permission-manager-exception'],
          },
        };
      }
    };
  }
}

export function fallbackPermissionCategory(toolName: string): PermissionCategory {
  if (READ_TOOL_NAMES.has(toolName)) return 'read';
  if (WRITE_TOOL_NAMES.has(toolName)) return 'write';
  if (EXECUTE_TOOL_NAMES.has(toolName)) return 'execute';
  return 'delegate';
}

function fallbackPermissionCategoryForArgs(toolName: string, args: Record<string, unknown>): PermissionCategory {
  if (toolName === 'process') {
    const action = typeof args.action === 'string'
      ? args.action.trim().toLowerCase()
      : typeof args.processAction === 'string'
        ? args.processAction.trim().toLowerCase()
        : '';
    return READ_ONLY_PROCESS_ACTIONS.has(action) ? 'read' : 'execute';
  }
  if (toolName === 'schedule') {
    const action = typeof args.action === 'string'
      ? args.action.trim().toLowerCase()
      : typeof args.mode === 'string'
        ? args.mode.trim().toLowerCase()
        : '';
    return READ_ONLY_SCHEDULE_ACTIONS.has(action) ? 'read' : 'execute';
  }
  if (toolName === 'import_goodvibes_settings') {
    const action = typeof args.action === 'string'
      ? args.action.trim().toLowerCase()
      : typeof args.mode === 'string'
        ? args.mode.trim().toLowerCase()
        : '';
    return READ_ONLY_SETTINGS_IMPORT_ACTIONS.has(action) ? 'read' : 'write';
  }
  if (toolName === 'settings') {
    const action = typeof args.action === 'string'
      ? args.action.trim().toLowerCase().replace(/-/g, '_')
      : typeof args.mode === 'string'
        ? args.mode.trim().toLowerCase().replace(/-/g, '_')
        : '';
    const confirmed = args.confirm === true || (typeof args.confirm === 'string' && ['true', 'yes', 'apply', 'run'].includes(args.confirm.trim().toLowerCase()));
    if ((action === 'import' || action === 'import_settings' || action === 'settings_import' || action === 'import_goodvibes' || action === 'goodvibes_import') && confirmed) return 'write';
    return READ_ONLY_SETTINGS_ACTIONS.has(action) ? 'read' : 'write';
  }
  if (toolName === 'setup') {
    const action = typeof args.action === 'string'
      ? args.action.trim().toLowerCase().replace(/-/g, '_')
      : typeof args.mode === 'string'
        ? args.mode.trim().toLowerCase().replace(/-/g, '_')
        : '';
    return READ_ONLY_SETUP_ACTIONS.has(action) ? 'read' : 'write';
  }
  if (toolName === 'vibe') {
    const action = typeof args.action === 'string'
      ? args.action.trim().toLowerCase().replace(/-/g, '_')
      : typeof args.mode === 'string'
        ? args.mode.trim().toLowerCase().replace(/-/g, '_')
        : '';
    return READ_ONLY_VIBE_ACTIONS.has(action) ? 'read' : 'write';
  }
  if (toolName === 'personal_ops') {
    const action = typeof args.action === 'string'
      ? args.action.trim().toLowerCase().replace(/-/g, '_')
      : typeof args.mode === 'string'
        ? args.mode.trim().toLowerCase().replace(/-/g, '_')
        : '';
    return READ_ONLY_PERSONAL_OPS_ACTIONS.has(action) ? 'read' : 'write';
  }
  if (toolName === 'research') {
    const action = typeof args.action === 'string'
      ? args.action.trim().toLowerCase().replace(/-/g, '_')
      : typeof args.mode === 'string'
        ? args.mode.trim().toLowerCase().replace(/-/g, '_')
        : '';
    return READ_ONLY_RESEARCH_ACTIONS.has(action) ? 'read' : 'write';
  }
  if (toolName === 'channels') {
    const action = typeof args.action === 'string'
      ? args.action.trim().toLowerCase().replace(/-/g, '_')
      : typeof args.mode === 'string'
        ? args.mode.trim().toLowerCase().replace(/-/g, '_')
        : '';
    return READ_ONLY_CHANNELS_ACTIONS.has(action) ? 'read' : 'write';
  }
  if (toolName === 'memory') {
    const action = typeof args.action === 'string'
      ? args.action.trim().toLowerCase().replace(/-/g, '_')
      : typeof args.mode === 'string'
        ? args.mode.trim().toLowerCase().replace(/-/g, '_')
        : '';
    return READ_ONLY_MEMORY_ACTIONS.has(action) ? 'read' : 'write';
  }
  if (toolName === 'device') {
    const action = typeof args.action === 'string'
      ? args.action.trim().toLowerCase().replace(/-/g, '_')
      : typeof args.mode === 'string'
        ? args.mode.trim().toLowerCase().replace(/-/g, '_')
        : '';
    return READ_ONLY_DEVICE_ACTIONS.has(action) ? 'read' : 'write';
  }
  if (toolName === 'models') {
    const action = typeof args.action === 'string'
      ? args.action.trim().toLowerCase().replace(/-/g, '_')
      : typeof args.mode === 'string'
        ? args.mode.trim().toLowerCase().replace(/-/g, '_')
        : '';
    return READ_ONLY_MODELS_ACTIONS.has(action) ? 'read' : 'write';
  }
  if (toolName === 'agent_artifacts') {
    const mode = typeof args.mode === 'string' ? args.mode.trim() : '';
    return mode === 'list' || mode === 'show' ? 'read' : 'write';
  }
  if (toolName === 'agent_review_packet_presets') {
    const mode = typeof args.mode === 'string' ? args.mode.trim() : '';
    return mode === 'list' || mode === 'show' || mode === '' ? 'read' : 'write';
  }
  return fallbackPermissionCategory(toolName);
}
