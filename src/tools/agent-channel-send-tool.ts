import type { ChannelDeliveryRouter } from '@pellux/goodvibes-sdk/platform/channels';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import {
  buildAgentChannelDeliveryPreview,
  deliverAgentChannelMessage,
  formatAgentChannelDeliveryPreview,
  formatAgentChannelDeliveryResult,
} from '../agent/channel-delivery.ts';

export interface AgentChannelSendToolArgs {
  readonly message?: unknown;
  readonly title?: unknown;
  readonly channel?: unknown;
  readonly route?: unknown;
  readonly webhook?: unknown;
  readonly link?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes';
}

function failure(error: string): { readonly success: false; readonly error: string } {
  return { success: false, error };
}

function output(text: string): { readonly success: true; readonly output: string } {
  return { success: true, output: text };
}

export function createAgentChannelSendTool(
  channelDeliveryRouter: Pick<ChannelDeliveryRouter, 'deliver' | 'listStrategies'>,
): Tool {
  return {
    definition: {
      name: 'agent_channel_send',
      description: 'Send one confirmed message through one configured Agent target.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Plain-text message to deliver.',
          },
          title: {
            type: 'string',
            description: 'Optional delivery title.',
          },
          channel: {
            type: 'string',
            description: 'Optional channel target. Use exactly one target field.',
          },
          route: {
            type: 'string',
            description: 'Optional route id or route:label. Use exactly one target field.',
          },
          webhook: {
            type: 'string',
            description: 'Optional http(s) webhook URL. Use exactly one target field.',
          },
          link: {
            type: 'string',
            description: 'Optional link delivery target. Use exactly one target field.',
          },
          confirm: {
            type: 'boolean',
            description: 'Required true for confirmed delivery.',
          },
          explicitUserRequest: {
            type: 'string',
            description: 'User request authorizing this delivery.',
          },
        },
        required: ['message', 'confirm', 'explicitUserRequest'],
        additionalProperties: false,
      },
      sideEffects: ['network'],
    },
    execute: async (rawArgs: Record<string, unknown>) => {
      const args = rawArgs as AgentChannelSendToolArgs;
      const explicitUserRequest = readString(args.explicitUserRequest);
      if (!explicitUserRequest) {
        return failure('explicitUserRequest is required so channel delivery stays tied to a direct user request.');
      }
      const input = {
        message: readString(args.message) ?? '',
        ...(readString(args.title) ? { title: readString(args.title) } : {}),
        ...(readString(args.channel) ? { channel: readString(args.channel) } : {}),
        ...(readString(args.route) ? { route: readString(args.route) } : {}),
        ...(readString(args.webhook) ? { webhook: readString(args.webhook) } : {}),
        ...(readString(args.link) ? { link: readString(args.link) } : {}),
      };
      let preview: ReturnType<typeof buildAgentChannelDeliveryPreview>;
      try {
        preview = buildAgentChannelDeliveryPreview(input);
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
      if (!readBoolean(args.confirm)) {
        return failure([
          formatAgentChannelDeliveryPreview(preview, channelDeliveryRouter.listStrategies().length),
          '',
          'Model tool confirmation required. Call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to send this channel message.',
        ].join('\n'));
      }
      try {
        return output(formatAgentChannelDeliveryResult(await deliverAgentChannelMessage(channelDeliveryRouter, input)));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function registerAgentChannelSendTool(
  registry: ToolRegistry,
  channelDeliveryRouter: Pick<ChannelDeliveryRouter, 'deliver' | 'listStrategies'>,
): void {
  registry.register(createAgentChannelSendTool(channelDeliveryRouter));
}
