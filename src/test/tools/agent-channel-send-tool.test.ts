import { describe, expect, test } from 'bun:test';
import type { ChannelDeliveryRequest } from '@pellux/goodvibes-sdk/platform/channels';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import {
  createAgentChannelSendTool,
  registerAgentChannelSendTool,
} from '../../tools/agent-channel-send-tool.ts';

function fakeRouter(requests: ChannelDeliveryRequest[]) {
  return {
    listStrategies: () => [{ id: 'fake-channel', canHandle: () => true, deliver: async () => ({}) }],
    deliver: async (request: ChannelDeliveryRequest) => {
      requests.push(request);
      return 'channel-response-1';
    },
  };
}

describe('agent_channel_send tool', () => {
  test('previews without sending when confirmation is missing', async () => {
    const requests: ChannelDeliveryRequest[] = [];
    const tool = createAgentChannelSendTool(fakeRouter(requests));

    const result = await tool.execute({
      message: 'Review the approvals',
      channel: 'slack:ops:Ops',
      confirm: false,
      explicitUserRequest: 'Send a Slack message to ops.',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Agent channel delivery preview');
    expect(result.error).toContain('confirmation required');
    expect(requests).toEqual([]);
  });

  test('requires explicit user request before sending', async () => {
    const requests: ChannelDeliveryRequest[] = [];
    const tool = createAgentChannelSendTool(fakeRouter(requests));

    const result = await tool.execute({
      message: 'Review the approvals',
      channel: 'slack:ops:Ops',
      confirm: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('explicitUserRequest is required');
    expect(requests).toEqual([]);
  });

  test('sends one message after explicit confirmation', async () => {
    const requests: ChannelDeliveryRequest[] = [];
    const tool = createAgentChannelSendTool(fakeRouter(requests));

    const result = await tool.execute({
      message: 'Review the approvals',
      title: 'Approvals',
      channel: 'slack:ops:Ops',
      confirm: true,
      explicitUserRequest: 'Send a Slack message to ops.',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Agent channel delivery sent');
    expect(result.output).toContain('channel-response-1');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.target).toMatchObject({ kind: 'surface', surfaceKind: 'slack', routeId: 'ops', label: 'Ops' });
    expect(requests[0]?.body).toBe('Review the approvals');
  });

  test('rejects ambiguous targets without sending', async () => {
    const requests: ChannelDeliveryRequest[] = [];
    const tool = createAgentChannelSendTool(fakeRouter(requests));

    const result = await tool.execute({
      message: 'Review the approvals',
      channel: 'slack:ops:Ops',
      webhook: 'https://example.test/hook',
      confirm: true,
      explicitUserRequest: 'Send a message.',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Choose exactly one delivery target');
    expect(requests).toEqual([]);
  });

  test('is registered in the model tool registry', () => {
    const registry = new ToolRegistry();

    registerAgentChannelSendTool(registry, fakeRouter([]));

    expect(registry.has('agent_channel_send')).toBe(true);
  });
});
