import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { ShellPathService } from '@/runtime/index.ts';
import type { AgentDaemonConfigReader } from '../agent/routine-schedule-promotion.ts';
import { resolveAgentDaemonConnection } from '../agent/routine-schedule-promotion.ts';
import {
  buildOperatorActionRequest,
  formatOperatorActionFailure,
  formatOperatorActionSuccess,
  formatOperatorActionToolPreview,
  isRecord,
  OPERATOR_ACTIONS,
  postOperatorAction,
  readOperatorActionBoolean,
  readOperatorActionString,
} from '../agent/operator-actions.ts';

interface OperatorActionToolArgs {
  readonly action?: unknown;
  readonly targetId?: unknown;
  readonly approvalId?: unknown;
  readonly jobId?: unknown;
  readonly runId?: unknown;
  readonly scheduleId?: unknown;
  readonly note?: unknown;
  readonly remember?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

export function createAgentOperatorActionTool(
  shellPaths: ShellPathService,
  configManager: AgentDaemonConfigReader,
): Tool {
  return {
    definition: {
      name: 'agent_operator_action',
      description: [
        'Perform one explicit, confirmed connected-host operator action from the main conversation.',
        'Allowed actions are approvals.approve, approvals.deny, approvals.cancel, automation.jobs.run, automation.jobs.pause, automation.jobs.resume, automation.runs.cancel, automation.runs.retry, and schedules.run.',
        'Use only when the user explicitly asks for that exact approval, automation job, automation run, or schedule action.',
        'This tool never creates, edits, deletes, or discovers automation definitions; never manages connected-host hosting; never uses default Knowledge/Wiki, non-Agent knowledge segments, local workers, WRFC, or arbitrary route invocation.',
        'Set confirm:true only for an explicit user request. Otherwise return the preview/confirmation error.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: Object.keys(OPERATOR_ACTIONS),
            description: 'Exact allowlisted public operator method id to execute.',
          },
          targetId: {
            type: 'string',
            description: 'Generic target id. Prefer the specific approvalId, jobId, runId, or scheduleId field when known.',
          },
          approvalId: {
            type: 'string',
            description: 'Approval id for approvals.approve, approvals.deny, or approvals.cancel.',
          },
          jobId: {
            type: 'string',
            description: 'Automation job id for automation.jobs.run, automation.jobs.pause, or automation.jobs.resume.',
          },
          runId: {
            type: 'string',
            description: 'Automation run id for automation.runs.cancel or automation.runs.retry.',
          },
          scheduleId: {
            type: 'string',
            description: 'Schedule id for schedules.run.',
          },
          note: {
            type: 'string',
            description: 'Optional approval note for approval actions.',
          },
          remember: {
            type: 'boolean',
            description: 'Optional approval remember flag for approval actions only.',
          },
          confirm: {
            type: 'boolean',
            description: 'Required true only when the user explicitly asked for this exact operator action.',
          },
          explicitUserRequest: {
            type: 'string',
            description: 'Short quote or summary of the user request that authorized this action.',
          },
        },
        required: ['action', 'confirm', 'explicitUserRequest'],
        additionalProperties: false,
      },
      sideEffects: ['network', 'state'],
    },
    execute: async (rawArgs: unknown) => {
      const request = buildOperatorActionRequest(rawArgs);
      if (!request.ok) {
        return { success: false, error: request.error };
      }
      const args = isRecord(rawArgs) ? rawArgs as OperatorActionToolArgs : {};
      const explicitUserRequest = readOperatorActionString(args.explicitUserRequest);
      if (!explicitUserRequest) {
        return {
          success: false,
          error: formatOperatorActionToolPreview(request, ''),
        };
      }
      if (!readOperatorActionBoolean(args.confirm)) {
        return {
          success: false,
          error: formatOperatorActionToolPreview(request, explicitUserRequest),
        };
      }
      const connection = resolveAgentDaemonConnection(configManager, shellPaths.homeDirectory);
      if (!connection.token) {
        return {
          success: false,
          error: `auth_required: no runtime operator token found at ${connection.tokenPath}`,
        };
      }
      const result = await postOperatorAction(connection, request);
      if (!result.ok) return { success: false, error: formatOperatorActionFailure(result) };
      return {
        success: true,
        output: formatOperatorActionSuccess(connection.baseUrl, result),
      };
    },
  };
}

export function registerAgentOperatorActionTool(
  registry: ToolRegistry,
  shellPaths: ShellPathService,
  configManager: AgentDaemonConfigReader,
): void {
  registry.register(createAgentOperatorActionTool(shellPaths, configManager));
}
