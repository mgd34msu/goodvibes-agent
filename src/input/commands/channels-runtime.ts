import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandRegistry } from '../command-registry.ts';
import type { CommandContext } from '../command-registry.ts';
import type { AgentWorkspaceChannelStatus } from '../agent-workspace-channels.ts';
import { buildAgentWorkspaceChannels } from '../agent-workspace-channels.ts';
import {
  buildAgentChannelDeliveryPreview,
  deliverAgentChannelMessage,
  formatAgentChannelDeliveryPreview,
  formatAgentChannelDeliveryResult,
} from '../../agent/channel-delivery.ts';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

type ChannelFilter = 'all' | 'ready' | 'attention';
type JsonRecord = Record<string, unknown>;

interface ChannelSendArgs {
  readonly message: string;
  readonly title?: string;
  readonly channel?: string;
  readonly route?: string;
  readonly webhook?: string;
  readonly link?: string;
  readonly yes: boolean;
  readonly errors: readonly string[];
}

interface ChannelConnectedHostConnection {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly tokenPath: string;
}

interface ChannelRouteSuccess {
  readonly ok: true;
  readonly route: string;
  readonly body: unknown;
}

interface ChannelRouteFailure {
  readonly ok: false;
  readonly route: string;
  readonly kind: 'auth_required' | 'connected_host_unavailable' | 'connected_host_route_unavailable' | 'connected_host_error';
  readonly baseUrl: string;
  readonly message: string;
}

type ChannelRouteResult = ChannelRouteSuccess | ChannelRouteFailure;

const CHANNEL_FAILURE_LABELS: Record<ChannelRouteFailure['kind'], string> = {
  auth_required: 'auth required',
  connected_host_unavailable: 'connected host unavailable',
  connected_host_route_unavailable: 'connected host route unavailable',
  connected_host_error: 'connected host error',
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string, fallback = ''): string {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

function readBoolean(record: JsonRecord, key: string, fallback = false): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readRecordArray(record: JsonRecord, key: string): readonly JsonRecord[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readFlagValue(args: readonly string[], index: number, flag: string, errors: string[]): string | null {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    errors.push(`${flag} requires a value.`);
    return null;
  }
  return value;
}

function parseChannelSendArgs(args: readonly string[]): ChannelSendArgs {
  const parsed = stripYesFlag([...args]);
  const errors: string[] = [];
  const messageParts: string[] = [];
  let title: string | undefined;
  let channel: string | undefined;
  let route: string | undefined;
  let webhook: string | undefined;
  let link: string | undefined;

  for (let index = 0; index < parsed.rest.length; index += 1) {
    const arg = parsed.rest[index];
    if (arg === '--title' || arg === '--message' || arg === '--channel' || arg === '--route' || arg === '--webhook' || arg === '--link') {
      const value = readFlagValue(parsed.rest, index, arg, errors);
      index += 1;
      if (!value) continue;
      if (arg === '--title') title = value;
      else if (arg === '--message') messageParts.push(value);
      else if (arg === '--channel') channel = value;
      else if (arg === '--route') route = value;
      else if (arg === '--webhook') webhook = value;
      else link = value;
    } else if (arg?.startsWith('--')) {
      errors.push(`Unknown channel send flag ${arg}`);
    } else if (arg) {
      messageParts.push(arg);
    }
  }

  const message = messageParts.join(' ').trim();
  if (!message) errors.push('Channel send message is required.');
  return {
    message,
    ...(title ? { title } : {}),
    ...(channel ? { channel } : {}),
    ...(route ? { route } : {}),
    ...(webhook ? { webhook } : {}),
    ...(link ? { link } : {}),
    yes: parsed.yes,
    errors,
  };
}

function resolveChannelConnectedHostConnection(context: CommandContext): ChannelConnectedHostConnection {
  const hostValue = context.platform?.configManager?.get('controlPlane.host');
  const portValue = context.platform?.configManager?.get('controlPlane.port');
  const host = typeof hostValue === 'string' && hostValue.trim().length > 0 ? hostValue.trim() : '127.0.0.1';
  const port = typeof portValue === 'number' && Number.isFinite(portValue) ? portValue : 3421;
  const homeDirectory = context.workspace?.shellPaths?.homeDirectory ?? process.env.HOME ?? '';
  const tokenPath = join(homeDirectory, '.goodvibes', 'daemon', 'operator-tokens.json');
  if (!existsSync(tokenPath)) return { baseUrl: `http://${host}:${port}`, token: null, tokenPath };
  try {
    const parsed = JSON.parse(readFileSync(tokenPath, 'utf-8')) as unknown;
    const token = isRecord(parsed) && typeof parsed.token === 'string' ? parsed.token : null;
    return { baseUrl: `http://${host}:${port}`, token, tokenPath };
  } catch {
    return { baseUrl: `http://${host}:${port}`, token: null, tokenPath };
  }
}

async function fetchChannelRoute(context: CommandContext, route: string): Promise<ChannelRouteResult> {
  const connection = resolveChannelConnectedHostConnection(context);
  if (!connection.token) {
    return {
      ok: false,
      route,
      kind: 'auth_required',
      baseUrl: connection.baseUrl,
      message: `No connected-host operator token found at ${connection.tokenPath}`,
    };
  }

  try {
    const response = await fetch(`${connection.baseUrl}${route}`, {
      headers: { authorization: `Bearer ${connection.token}` },
    });
    const text = await response.text();
    let body: unknown = text;
    if (text.trim().length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      const detail = isRecord(body) && typeof body.error === 'string' ? body.error : text;
      return {
        ok: false,
        route,
        kind: response.status === 401 || response.status === 403
          ? 'auth_required'
          : response.status === 404
            ? 'connected_host_route_unavailable'
            : 'connected_host_error',
        baseUrl: connection.baseUrl,
        message: `HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      };
    }
    return { ok: true, route, body };
  } catch (error) {
    return {
      ok: false,
      route,
      kind: 'connected_host_unavailable',
      baseUrl: connection.baseUrl,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatChannelRouteFailure(title: string, failure: ChannelRouteFailure): string {
  return [
    `${title}: unavailable`,
    `  status: ${CHANNEL_FAILURE_LABELS[failure.kind]}`,
    `  kind: ${failure.kind}`,
    `  connected host: ${failure.baseUrl}`,
    `  route: ${failure.route}`,
    `  error: ${failure.message}`,
    '  policy: read-only; no channel send/action route was called',
  ].join('\n');
}

function formatChannelLine(channel: AgentWorkspaceChannelStatus): string {
  const missing = channel.missingRequiredKeys.length > 0
    ? ` missing=${channel.missingRequiredKeys.join('|')}`
    : '';
  const target = channel.configuredDefaultTargetKeys.length > 0
    ? ` target=${channel.configuredDefaultTargetKeys.join('|')}`
    : channel.defaultTargetKeys.length > 0
      ? ` target=missing(${channel.defaultTargetKeys.join('|')})`
      : ' target=not-required';
  return [
    `  ${channel.label}: ${channel.setupState}`,
    `ready=${channel.ready ? 'yes' : 'no'}`,
    `delivery=${channel.delivery}`,
    `risk=${channel.risk}`,
    target,
    missing,
  ].join(' ');
}

function filterChannels(
  channels: readonly AgentWorkspaceChannelStatus[],
  filter: ChannelFilter,
): readonly AgentWorkspaceChannelStatus[] {
  if (filter === 'ready') return channels.filter((channel) => channel.ready);
  if (filter === 'attention') return channels.filter((channel) => channel.enabled && channel.setupState !== 'ready');
  return channels;
}

function printChannelSummary(
  print: (message: string) => void,
  channels: readonly AgentWorkspaceChannelStatus[],
  filter: ChannelFilter,
): void {
  const ready = channels.filter((channel) => channel.ready);
  const enabled = channels.filter((channel) => channel.enabled);
  const needsTarget = channels.filter((channel) => channel.setupState === 'needs-target');
  const needsConfig = channels.filter((channel) => channel.setupState === 'needs-config');
  const filtered = filterChannels(channels, filter);
  const title = filter === 'ready'
    ? 'Channel Readiness: Ready'
    : filter === 'attention'
      ? 'Channel Readiness: Needs Attention'
      : 'Channel Readiness';
  const lines: string[] = [
    title,
    `  ready: ${ready.length}/${channels.length}`,
    `  enabled: ${enabled.length}/${channels.length}`,
    `  needs target: ${needsTarget.length}`,
    `  needs config: ${needsConfig.length}`,
    '  policy: read-only inspection; sends require explicit user action and Agent policy',
    '  details: /channels show <id>',
    '',
    ...(filtered.length > 0
      ? filtered.map(formatChannelLine)
      : [`  No ${filter === 'ready' ? 'ready' : 'attention'} channels matched.`]),
  ];
  print(lines.join('\n'));
}

function printChannelDetail(
  print: (message: string) => void,
  channel: AgentWorkspaceChannelStatus,
): void {
  print([
    `Channel: ${channel.label} (${channel.id})`,
    `  state: ${channel.setupState}`,
    `  enabled: ${channel.enabled ? 'yes' : 'no'}`,
    `  ready: ${channel.ready ? 'yes' : 'no'}`,
    `  delivery: ${channel.delivery}`,
    `  risk: ${channel.risk} (${channel.riskLabel})`,
    `  required config keys: ${channel.requiredKeys.join(', ') || 'none'}`,
    `  missing config keys: ${channel.missingRequiredKeys.join(', ') || 'none'}`,
    `  default target keys: ${channel.defaultTargetKeys.join(', ') || 'not required'}`,
    `  configured target keys: ${channel.configuredDefaultTargetKeys.join(', ') || 'none'}`,
    `  next: ${channel.nextStep}`,
    '  policy: this command never prints secret values and never sends messages',
  ].join('\n'));
}

function formatChannelAccounts(body: unknown): string {
  const root = isRecord(body) ? body : {};
  const accounts = readRecordArray(root, 'accounts');
  const lines = [
    'Channel Accounts',
    `  accounts ${accounts.length}`,
    '  policy read-only account posture; secret values are never shown',
    '',
  ];
  if (accounts.length === 0) return [...lines, '  No channel accounts reported by connected host.'].join('\n');
  for (const account of accounts.slice(0, 20)) {
    const surface = readString(account, 'surface', 'unknown');
    const accountId = readString(account, 'accountId', '');
    const authState = readString(account, 'authState', readString(account, 'state', 'unknown'));
    const configured = readBoolean(account, 'configured') ? 'configured' : 'not-configured';
    const linked = readBoolean(account, 'linked') ? 'linked' : 'not-linked';
    const secretFields = readRecordArray(account, 'secrets')
      .map((secret) => readString(secret, 'field', 'secret'))
      .join(', ') || 'none';
    lines.push(`  ${surface}${accountId ? `/${accountId}` : ''}: ${configured}; ${linked}; auth=${authState}; secret refs=${secretFields === 'none' ? 'none' : secretFields.split(', ').map((field) => `${field}:config`).join(',')}`);
  }
  if (accounts.length > 20) lines.push(`  ${accounts.length - 20} more account(s) omitted.`);
  return lines.join('\n');
}

function formatChannelPolicies(body: unknown): string {
  const root = isRecord(body) ? body : {};
  const policies = readRecordArray(root, 'policies');
  const lines = [
    'Channel Policies',
    `  policies ${policies.length}`,
    '  policy read-only policy posture; use exact confirmed commands for changes',
    '',
  ];
  if (policies.length === 0) return [...lines, '  No channel policies reported by connected host.'].join('\n');
  for (const policy of policies.slice(0, 20)) {
    const surface = readString(policy, 'surface', 'unknown');
    const direct = readBoolean(policy, 'allowDirectMessages') ? 'direct=yes' : 'direct=no';
    const users = Array.isArray(policy.allowlistUserIds) ? policy.allowlistUserIds.length : 0;
    const groups = Array.isArray(policy.allowlistGroupIds) ? policy.allowlistGroupIds.length : 0;
    const groupPolicies = readRecordArray(policy, 'groupPolicies').length;
    lines.push(`  ${surface}: ${direct}; allowlist users=${users}; groups=${groups}; group policies=${groupPolicies}`);
  }
  if (policies.length > 20) lines.push(`  ${policies.length - 20} more policy record(s) omitted.`);
  return lines.join('\n');
}

function formatChannelStatus(body: unknown): string {
  const root = isRecord(body) ? body : {};
  const channels = readRecordArray(root, 'channels');
  const lines = [
    'Connected Channel Status',
    `  channels ${channels.length}`,
    '  policy read-only connected-host status',
    '',
  ];
  if (channels.length === 0) return [...lines, '  No connected channel status reported.'].join('\n');
  for (const channel of channels.slice(0, 20)) {
    const surface = readString(channel, 'surface', 'unknown');
    const state = readString(channel, 'state', readString(channel, 'status', 'unknown'));
    const enabled = readBoolean(channel, 'enabled') ? 'enabled' : 'disabled';
    const ready = readBoolean(channel, 'ready') ? 'ready' : 'not-ready';
    lines.push(`  ${surface}: ${enabled}; ${ready}; state=${state}`);
  }
  if (channels.length > 20) lines.push(`  ${channels.length - 20} more channel(s) omitted.`);
  return lines.join('\n');
}

function formatChannelDoctor(surface: string, body: unknown): string {
  const root = isRecord(body) ? body : {};
  const checks = readRecordArray(root, 'checks');
  const repairActions = readRecordArray(root, 'repairActions');
  const lines = [
    `Channel Doctor: ${readString(root, 'surface', surface)}`,
    `  checks ${checks.length}`,
    `  repair actions ${repairActions.length}`,
    '  policy read-only doctor report; repair actions are not run here',
    '',
  ];
  if (checks.length === 0) lines.push('  No doctor checks reported.');
  for (const check of checks.slice(0, 20)) {
    lines.push(`  ${readString(check, 'id', 'check')}: ${readString(check, 'status', 'unknown')}`);
  }
  if (repairActions.length > 0) {
    lines.push('', '  Available repair action ids:');
    for (const action of repairActions.slice(0, 12)) lines.push(`  - ${readString(action, 'id', 'action')}`);
  }
  return lines.join('\n');
}

function formatChannelSetup(surface: string, body: unknown): string {
  const root = isRecord(body) ? body : {};
  const fields = readRecordArray(root, 'fields');
  const secretTargets = readRecordArray(root, 'secretTargets');
  const lines = [
    `Channel Setup Schema: ${readString(root, 'surface', surface)}`,
    `  version ${typeof root.version === 'number' ? root.version : 'unknown'}`,
    `  fields ${fields.length}`,
    `  secret targets ${secretTargets.length}`,
    '  policy read-only setup form; no credentials or values are printed',
    '',
  ];
  if (fields.length > 0) {
    lines.push('  Fields');
    for (const field of fields.slice(0, 20)) lines.push(`  - ${readString(field, 'id', 'field')}`);
  }
  if (secretTargets.length > 0) {
    lines.push('', '  Secret targets');
    for (const target of secretTargets.slice(0, 12)) {
      const required = readBoolean(target, 'required') ? 'required' : 'optional';
      lines.push(`  - ${readString(target, 'id', 'secret')} (${required})`);
    }
  }
  return lines.join('\n');
}

async function printReadOnlyChannelRoute(
  context: CommandContext,
  title: string,
  route: string,
  format: (body: unknown) => string,
): Promise<void> {
  const result = await fetchChannelRoute(context, route);
  if (!result.ok) {
    context.print(formatChannelRouteFailure(title, result));
    return;
  }
  context.print(format(result.body));
}

export function registerChannelsRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'channels',
    aliases: ['channel'],
    description: 'Inspect Agent channel readiness or send an explicitly confirmed delivery message',
    usage: '[list|readiness|ready|attention|show <id>|send --channel <id> --message <text> --yes|accounts|policies|status|doctor <id>|setup <id>]',
    argsHint: 'list|readiness|ready|attention|show|send|accounts|policies|status|doctor|setup',
    async handler(args, ctx) {
      const channels = buildAgentWorkspaceChannels(ctx);
      const subcommand = (args[0] ?? 'readiness').trim().toLowerCase();

      if (subcommand === 'list' || subcommand === 'readiness') {
        printChannelSummary(ctx.print, channels, 'all');
        return;
      }

      if (subcommand === 'ready') {
        printChannelSummary(ctx.print, channels, 'ready');
        return;
      }

      if (subcommand === 'attention' || subcommand === 'issues') {
        printChannelSummary(ctx.print, channels, 'attention');
        return;
      }

      if (subcommand === 'show') {
        const channelId = args[1]?.trim().toLowerCase();
        if (!channelId) {
          ctx.print('Usage: /channels show <id>');
          return;
        }
        const channel = channels.find((entry) => entry.id.toLowerCase() === channelId || entry.label.toLowerCase() === channelId);
        if (!channel) {
          ctx.print(`Unknown channel ${channelId}\nUse /channels list to see available channel ids.`);
          return;
        }
        printChannelDetail(ctx.print, channel);
        return;
      }

      if (subcommand === 'send') {
        const router = ctx.platform.channelDeliveryRouter;
        if (!router) {
          ctx.print('Channel delivery is not available in this Agent runtime.');
          return;
        }
        const parsed = parseChannelSendArgs(args.slice(1));
        if (parsed.errors.length > 0) {
          ctx.print(`[channels] ${parsed.errors.join('\n[channels] ')}`);
          return;
        }
        let preview: ReturnType<typeof buildAgentChannelDeliveryPreview>;
        try {
          preview = buildAgentChannelDeliveryPreview(parsed);
        } catch (error) {
          ctx.print(`[channels] ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
        if (!parsed.yes) {
          ctx.print(formatAgentChannelDeliveryPreview(preview, router.listStrategies().length));
          requireYesFlag(ctx, 'send a channel delivery message', '/channels send --channel <surface[:route[:label]]> --message <text> --yes');
          return;
        }
        try {
          ctx.print(formatAgentChannelDeliveryResult(await deliverAgentChannelMessage(router, parsed)));
        } catch (error) {
          ctx.print(`[channels] Send failed ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }

      if (subcommand === 'accounts') {
        await printReadOnlyChannelRoute(ctx, 'Channel accounts', '/api/channels/accounts', formatChannelAccounts);
        return;
      }

      if (subcommand === 'policies') {
        await printReadOnlyChannelRoute(ctx, 'Channel policies', '/api/channels/policies', formatChannelPolicies);
        return;
      }

      if (subcommand === 'status') {
        await printReadOnlyChannelRoute(ctx, 'Channel status', '/api/channels/status', formatChannelStatus);
        return;
      }

      if (subcommand === 'doctor' || subcommand === 'setup') {
        const channelId = args[1]?.trim().toLowerCase();
        if (!channelId) {
          ctx.print(`Usage: /channels ${subcommand} <id>`);
          return;
        }
        const encoded = encodeURIComponent(channelId);
        if (subcommand === 'doctor') {
          await printReadOnlyChannelRoute(ctx, 'Channel doctor', `/api/channels/doctor/${encoded}`, (body) => formatChannelDoctor(channelId, body));
          return;
        }
        await printReadOnlyChannelRoute(ctx, 'Channel setup', `/api/channels/setup/${encoded}`, (body) => formatChannelSetup(channelId, body));
        return;
      }

      ctx.print('Usage: /channels [list|readiness|ready|attention|show <id>|send --channel <id> --message <text> --yes|accounts|policies|status|doctor <id>|setup <id>]');
    },
  });
}
