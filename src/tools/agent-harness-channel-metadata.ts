import type { CommandContext } from '../input/command-registry.ts';
import type { AgentWorkspaceChannelStatus } from '../input/agent-workspace-channels.ts';
import { buildAgentWorkspaceChannels } from '../input/agent-workspace-channels.ts';

export interface AgentHarnessChannelArgs {
  readonly channelId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

type ChannelLookupSource = 'channelId' | 'target' | 'query';

type ChannelResolution =
  | { readonly status: 'found'; readonly channel: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function channelLookupFromArgs(args: AgentHarnessChannelArgs): { readonly source: ChannelLookupSource; readonly input: string } | null {
  const channelId = readString(args.channelId);
  if (channelId) return { source: 'channelId', input: channelId };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

function channelSearchText(channel: AgentWorkspaceChannelStatus): string {
  return [
    channel.id,
    channel.label,
    channel.delivery,
    channel.risk,
    channel.riskLabel,
    channel.setupState,
    channel.nextStep,
    ...channel.requiredKeys,
    ...channel.missingRequiredKeys,
    ...channel.defaultTargetKeys,
    ...channel.configuredDefaultTargetKeys,
  ].join('\n').toLowerCase();
}

function describeChannelCandidate(channel: AgentWorkspaceChannelStatus): Record<string, unknown> {
  return {
    channelId: channel.id,
    label: channel.label,
    setupState: channel.setupState,
    ready: channel.ready,
    delivery: channel.delivery,
  };
}

function describeChannel(
  channel: AgentWorkspaceChannelStatus,
  options: { readonly includeParameters?: boolean; readonly lookup?: Record<string, unknown> } = {},
): Record<string, unknown> {
  return {
    id: channel.id,
    label: channel.label,
    enabled: channel.enabled,
    ready: channel.ready,
    setupState: channel.setupState,
    delivery: channel.delivery,
    risk: channel.risk,
    riskLabel: channel.riskLabel,
    missingConfigCount: channel.missingConfigCount,
    defaultTarget: channel.defaultTarget,
    nextStep: channel.nextStep,
    requiredConfigKeys: channel.requiredKeys,
    missingConfigKeys: channel.missingRequiredKeys,
    defaultTargetKeys: channel.defaultTargetKeys,
    configuredDefaultTargetKeys: channel.configuredDefaultTargetKeys,
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(options.includeParameters ? {
      policy: {
        effect: 'read-only',
        values: 'Config key names and target key names are shown; secret values and stored target values are never returned.',
        delivery: 'Use agent_channel_send only for one explicit, confirmed delivery target requested by the user.',
        setup: 'Use connected-host setup/account/policy routes only as read-only diagnostics unless another confirmed first-class tool owns the mutation.',
      },
      modelAccess: {
        sendTool: 'agent_channel_send',
        notificationTool: 'agent_notify',
        reminderTool: 'agent_reminder_schedule',
        slashCommandDetail: `/channels show ${channel.id}`,
        readOnlyConnectedRoutes: [
          '/channels accounts',
          '/channels policies',
          '/channels status',
          `/channels doctor ${channel.id}`,
          `/channels setup ${channel.id}`,
        ],
        settingsFilter: `agent_harness mode:"settings" prefix:"surfaces.${channel.id}" includeHidden:true`,
        connectedHostBoundary: 'agent_harness mode:"connected_host_capability" query:"delivery"',
        deliveryTargetShape: 'surface[:route[:label]]',
        exampleTarget: `${channel.id}:route:Label`,
      },
    } : {}),
  };
}

export function channelReadinessCatalogStatus(context: CommandContext): Record<string, unknown> {
  const channels = buildAgentWorkspaceChannels(context);
  return {
    modes: ['channels', 'channel'],
    channels: channels.length,
    enabled: channels.filter((channel) => channel.enabled).length,
    ready: channels.filter((channel) => channel.ready).length,
    attention: channels.filter((channel) => channel.enabled && channel.setupState !== 'ready').length,
    readOnly: true,
    deliveryTool: 'agent_channel_send',
  };
}

export function listHarnessChannels(context: CommandContext, args: AgentHarnessChannelArgs): Record<string, unknown> {
  const query = readString(args.query).toLowerCase();
  const includeParameters = args.includeParameters === true;
  const limit = readLimit(args.limit, 200);
  const channels = buildAgentWorkspaceChannels(context);
  const filtered = channels
    .filter((channel) => !query || channelSearchText(channel).includes(query))
    .slice(0, limit);
  return {
    channels: filtered.map((channel) => describeChannel(channel, { includeParameters })),
    returned: filtered.length,
    total: channels.length,
    enabled: channels.filter((channel) => channel.enabled).length,
    ready: channels.filter((channel) => channel.ready).length,
    attention: channels.filter((channel) => channel.enabled && channel.setupState !== 'ready').length,
    policy: 'Read-only channel readiness catalog. It returns key names, setup state, delivery posture, and model routes without printing secrets or sending messages.',
  };
}

export function describeHarnessChannel(context: CommandContext, args: AgentHarnessChannelArgs): ChannelResolution {
  const lookup = channelLookupFromArgs(args);
  if (!lookup) {
    return {
      status: 'missing_lookup',
      usage: 'channel requires channelId, target, or query. Use mode:"channels" to inspect available channel ids.',
    };
  }
  const channels = buildAgentWorkspaceChannels(context);
  const normalized = lookup.input.toLowerCase();
  const exact = channels.find((channel) => channel.id === lookup.input);
  if (exact) return { status: 'found', channel: describeChannel(exact, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'id' } }) };
  const insensitiveId = channels.find((channel) => channel.id.toLowerCase() === normalized);
  if (insensitiveId) return { status: 'found', channel: describeChannel(insensitiveId, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-id' } }) };
  const insensitiveLabel = channels.find((channel) => channel.label.toLowerCase() === normalized);
  if (insensitiveLabel) return { status: 'found', channel: describeChannel(insensitiveLabel, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-label' } }) };
  const searched = channels.filter((channel) => channelSearchText(channel).includes(normalized));
  if (searched.length === 1) {
    return { status: 'found', channel: describeChannel(searched[0]!, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'search' } }) };
  }
  if (searched.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: searched.slice(0, 8).map(describeChannelCandidate),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown channel ${lookup.input}. Use mode:"channels" to inspect available channel ids.`,
  };
}
