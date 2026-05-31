import type { CommandContext } from './command-registry.ts';

export type AgentWorkspaceChannelRisk = 'dm' | 'group' | 'public' | 'webhook' | 'bridge';

export interface AgentWorkspaceChannelStatus {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly missingConfigCount: number;
  readonly defaultTarget: 'configured' | 'missing' | 'not-required';
  readonly delivery: 'disabled' | 'blocked' | 'explicit-target' | 'default-ready';
  readonly risk: AgentWorkspaceChannelRisk;
  readonly riskLabel: string;
}

interface AgentWorkspaceConfigReader {
  get(key: string): unknown;
}

interface AgentWorkspaceChannelSpec {
  readonly id: string;
  readonly label: string;
  readonly enabledKey: string;
  readonly requiredKeys: readonly string[];
  readonly defaultTargetKeys: readonly string[];
  readonly risk: AgentWorkspaceChannelRisk;
  readonly riskLabel: string;
}

const AGENT_WORKSPACE_CHANNEL_SPECS: readonly AgentWorkspaceChannelSpec[] = [
  {
    id: 'slack',
    label: 'Slack',
    enabledKey: 'surfaces.slack.enabled',
    requiredKeys: ['surfaces.slack.botToken', 'surfaces.slack.signingSecret'],
    defaultTargetKeys: ['surfaces.slack.defaultChannel'],
    risk: 'group',
    riskLabel: 'workspace/group channel',
  },
  {
    id: 'discord',
    label: 'Discord',
    enabledKey: 'surfaces.discord.enabled',
    requiredKeys: ['surfaces.discord.botToken', 'surfaces.discord.publicKey', 'surfaces.discord.applicationId'],
    defaultTargetKeys: ['surfaces.discord.defaultChannelId'],
    risk: 'group',
    riskLabel: 'server/channel delivery',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    enabledKey: 'surfaces.telegram.enabled',
    requiredKeys: ['surfaces.telegram.botToken'],
    defaultTargetKeys: ['surfaces.telegram.defaultChatId'],
    risk: 'dm',
    riskLabel: 'bot DM/group delivery',
  },
  {
    id: 'ntfy',
    label: 'ntfy',
    enabledKey: 'surfaces.ntfy.enabled',
    requiredKeys: ['surfaces.ntfy.baseUrl', 'surfaces.ntfy.chatTopic', 'surfaces.ntfy.agentTopic'],
    defaultTargetKeys: ['surfaces.ntfy.topic'],
    risk: 'public',
    riskLabel: 'topic-based public/private feed',
  },
  {
    id: 'googleChat',
    label: 'Google Chat',
    enabledKey: 'surfaces.googleChat.enabled',
    requiredKeys: ['surfaces.googleChat.webhookUrl', 'surfaces.googleChat.verificationToken'],
    defaultTargetKeys: ['surfaces.googleChat.spaceId'],
    risk: 'group',
    riskLabel: 'space delivery',
  },
  {
    id: 'signal',
    label: 'Signal',
    enabledKey: 'surfaces.signal.enabled',
    requiredKeys: ['surfaces.signal.bridgeUrl', 'surfaces.signal.account'],
    defaultTargetKeys: ['surfaces.signal.defaultRecipient'],
    risk: 'bridge',
    riskLabel: 'private bridge delivery',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    enabledKey: 'surfaces.whatsapp.enabled',
    requiredKeys: ['surfaces.whatsapp.accessToken', 'surfaces.whatsapp.verifyToken', 'surfaces.whatsapp.phoneNumberId'],
    defaultTargetKeys: ['surfaces.whatsapp.defaultRecipient'],
    risk: 'dm',
    riskLabel: 'phone-number delivery',
  },
  {
    id: 'imessage',
    label: 'iMessage',
    enabledKey: 'surfaces.imessage.enabled',
    requiredKeys: ['surfaces.imessage.bridgeUrl', 'surfaces.imessage.account'],
    defaultTargetKeys: ['surfaces.imessage.defaultChatId'],
    risk: 'bridge',
    riskLabel: 'Apple bridge delivery',
  },
  {
    id: 'bluebubbles',
    label: 'BlueBubbles',
    enabledKey: 'surfaces.bluebubbles.enabled',
    requiredKeys: ['surfaces.bluebubbles.serverUrl', 'surfaces.bluebubbles.password'],
    defaultTargetKeys: ['surfaces.bluebubbles.defaultChatGuid'],
    risk: 'bridge',
    riskLabel: 'iMessage bridge delivery',
  },
  {
    id: 'msteams',
    label: 'Microsoft Teams',
    enabledKey: 'surfaces.msteams.enabled',
    requiredKeys: ['surfaces.msteams.appId', 'surfaces.msteams.appPassword'],
    defaultTargetKeys: ['surfaces.msteams.defaultConversationId', 'surfaces.msteams.defaultChannelId'],
    risk: 'group',
    riskLabel: 'tenant/channel delivery',
  },
  {
    id: 'mattermost',
    label: 'Mattermost',
    enabledKey: 'surfaces.mattermost.enabled',
    requiredKeys: ['surfaces.mattermost.baseUrl', 'surfaces.mattermost.botToken'],
    defaultTargetKeys: ['surfaces.mattermost.defaultChannelId'],
    risk: 'group',
    riskLabel: 'team/channel delivery',
  },
  {
    id: 'matrix',
    label: 'Matrix',
    enabledKey: 'surfaces.matrix.enabled',
    requiredKeys: ['surfaces.matrix.homeserverUrl', 'surfaces.matrix.accessToken'],
    defaultTargetKeys: ['surfaces.matrix.defaultRoomId'],
    risk: 'group',
    riskLabel: 'room delivery',
  },
  {
    id: 'webhook',
    label: 'Webhook',
    enabledKey: 'surfaces.webhook.enabled',
    requiredKeys: ['surfaces.webhook.defaultTarget'],
    defaultTargetKeys: ['surfaces.webhook.defaultTarget'],
    risk: 'webhook',
    riskLabel: 'external HTTP delivery',
  },
];

function configValue(context: CommandContext, key: string): unknown {
  const configManager = context.platform?.configManager as AgentWorkspaceConfigReader | undefined;
  return configManager?.get(key);
}

function readConfigBoolean(context: CommandContext, key: string, fallback: boolean): boolean {
  try {
    const value = configValue(context, key);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function hasConfigValue(context: CommandContext, key: string): boolean {
  try {
    const value = configValue(context, key);
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return value;
    return value !== null && value !== undefined;
  } catch {
    return false;
  }
}

function buildChannelStatus(context: CommandContext, spec: AgentWorkspaceChannelSpec): AgentWorkspaceChannelStatus {
  const enabled = readConfigBoolean(context, spec.enabledKey, false);
  const missingConfigCount = spec.requiredKeys.filter((key) => !hasConfigValue(context, key)).length;
  const defaultTarget = spec.defaultTargetKeys.length === 0
    ? 'not-required'
    : spec.defaultTargetKeys.some((key) => hasConfigValue(context, key))
      ? 'configured'
      : 'missing';
  const ready = enabled && missingConfigCount === 0;
  const delivery = !enabled
    ? 'disabled'
    : !ready
      ? 'blocked'
      : defaultTarget === 'configured'
        ? 'default-ready'
        : 'explicit-target';
  return {
    id: spec.id,
    label: spec.label,
    enabled,
    ready,
    missingConfigCount,
    defaultTarget,
    delivery,
    risk: spec.risk,
    riskLabel: spec.riskLabel,
  };
}

export function buildAgentWorkspaceChannels(context: CommandContext): readonly AgentWorkspaceChannelStatus[] {
  return AGENT_WORKSPACE_CHANNEL_SPECS.map((spec) => buildChannelStatus(context, spec));
}
