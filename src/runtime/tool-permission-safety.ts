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
  'agent_artifacts',
  'goodvibes_context',
  'agent_harness',
  'agent_knowledge',
  'agent_operator_briefing',
]);

const WRITE_TOOL_NAMES = new Set([
  'write',
  'edit',
  'goodvibes_settings',
  'agent_knowledge_ingest',
  'agent_local_registry',
  'agent_work_plan',
]);

const EXECUTE_TOOL_NAMES = new Set(['exec', 'repl']);

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
      return originalGetCategory(toolName, args);
    } catch {
      return fallbackPermissionCategory(toolName);
    }
  };

  manager.check = async (toolName, args) => {
    try {
      return await originalCheck(toolName, args);
    } catch {
      return fallbackPermissionCategory(toolName) === 'read';
    }
  };

  if (originalCheckDetailed) {
    manager.checkDetailed = async (toolName, args) => {
      try {
        return await originalCheckDetailed(toolName, args);
      } catch (error) {
        const category = fallbackPermissionCategory(toolName);
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
