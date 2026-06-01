import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { evaluateSessionMaintenance } from '@/runtime/index.ts';
import type {
  UiContinuitySnapshot,
  UiLocalAuthSnapshot,
  UiRemoteSnapshot,
  UiSecuritySnapshot,
  UiSessionSnapshot,
  UiSettingsSnapshot,
} from '../runtime/ui-read-models.ts';

export interface HealthDomainSummary {
  readonly name: string;
  readonly level: 'good' | 'warn' | 'bad' | 'info';
  readonly summary: string;
  readonly next: string;
  readonly details: readonly string[];
  readonly nextSteps: readonly string[];
}

export interface ProviderHealthDomainInputs {
  readonly configManager: Pick<ConfigManager, 'get'>;
  readonly auth: UiLocalAuthSnapshot;
  readonly settings: UiSettingsSnapshot;
  readonly remote: UiRemoteSnapshot;
  readonly security: UiSecuritySnapshot;
  readonly continuity: UiContinuitySnapshot;
  readonly session: UiSessionSnapshot;
}

export function buildProviderHealthDomainSummaries(
  input: ProviderHealthDomainInputs,
): HealthDomainSummary[] {
  const summaries: HealthDomainSummary[] = [];
  const {
    configManager,
    auth,
    settings,
    remote,
    security,
    continuity,
    session,
  } = input;

  summaries.push({
    name: 'auth',
    level: auth.bootstrapCredentialPresent ? 'warn' : 'info',
    summary: auth.bootstrapCredentialPresent
      ? 'external runtime bootstrap credential visible in local compatibility state'
      : 'runtime auth administration belongs to the external runtime owner',
    next: '/auth review',
    details: [
      'GoodVibes Agent does not create, delete, rotate, revoke, or clear runtime auth users or sessions.',
      `${auth.userCount} compatibility user record(s) and ${auth.sessionCount} session record(s) are visible for diagnostics only.`,
      auth.bootstrapCredentialPresent ? 'Runtime bootstrap cleanup must be done from the runtime-owning TUI or host tooling.' : '',
    ].filter(Boolean),
    nextSteps: auth.bootstrapCredentialPresent
      ? ['/auth review', '/providers', '/subscription providers']
      : ['/auth review', '/providers'],
  });

  const settingIssueCount = settings.conflictCount + settings.recentFailureCount + (settings.hasStagedManagedBundle ? 1 : 0);
  summaries.push({
    name: 'settings',
    level: !settings.available ? 'info' : settingIssueCount > 0 ? 'warn' : 'good',
    summary: !settings.available
      ? 'settings runtime API unavailable'
      : settingIssueCount > 0
        ? `${settings.conflictCount} conflicts / ${settings.recentFailureCount} failures${settings.hasStagedManagedBundle ? ' / staged bundle' : ''}`
        : 'settings runtime API clean',
    next: settingIssueCount > 0 ? '/settingssync panel' : '/settingssync show <key>',
    details: [
      settings.conflictCount > 0 ? `${settings.conflictCount} unresolved import conflict(s)` : '',
      settings.recentFailureCount > 0 ? `${settings.recentFailureCount} recent sync or managed failure(s)` : '',
      settings.hasStagedManagedBundle ? 'staged managed bundle awaits apply or rollback' : '',
      settings.managedLockCount > 0 ? `${settings.managedLockCount} managed lock(s) enforced` : '',
    ].filter(Boolean),
    nextSteps: settingIssueCount > 0
      ? ['/settingssync panel', '/settingssync show <key>', '/managed staged']
      : ['/settingssync show <key>'],
  });

  summaries.push({
    name: 'remote',
    level: remote.supervisor.degradedConnections > 0 ? 'warn' : remote.supervisor.sessions.length > 0 ? 'good' : 'info',
    summary: remote.supervisor.sessions.length === 0
      ? 'no remote sessions tracked'
      : `${remote.supervisor.sessions.length} sessions / ${remote.supervisor.degradedConnections} degraded`,
    next: remote.supervisor.degradedConnections > 0 ? '/remote recover <workerId>' : '/remote supervisor',
    details: remote.supervisor.sessions.length === 0
      ? ['no remote sessions have been attached yet']
      : remote.supervisor.sessions
          .filter((entry) =>
            entry.transportState === 'degraded'
            || entry.transportState === 'reconnecting'
            || entry.transportState === 'terminal_failure'
            || entry.heartbeat.status !== 'fresh'
            || Boolean(entry.lastError))
          .slice(0, 3)
          .map((entry) => `${entry.runnerId}: transport=${entry.transportState} heartbeat=${entry.heartbeat.status}${entry.lastError ? ` error=${entry.lastError}` : ''}`),
    nextSteps: remote.supervisor.degradedConnections > 0
      ? ['/remote supervisor', '/remote recover <workerId>', '/remote support']
      : ['/remote supervisor'],
  });

  const degradedServers = security.mcpServers.filter((server) =>
    !server.connected
    || server.schemaFreshness !== 'fresh'
    || Boolean(server.quarantineReason)
    || server.trustMode === 'allow-all');
  const connectedServerCount = security.mcpServers.filter((server) => server.connected).length;
  summaries.push({
    name: 'mcp',
    level: degradedServers.length > 0 ? 'warn' : security.mcpServers.length > 0 ? 'good' : 'info',
    summary: security.mcpServers.length === 0
      ? 'no MCP servers configured'
      : `${connectedServerCount}/${security.mcpServers.length} connected, ${degradedServers.length} need review`,
    next: degradedServers.length > 0 ? '/mcp repair' : '/mcp review',
    details: degradedServers.length === 0
      ? (security.mcpServers.length === 0 ? ['no MCP servers registered'] : ['all MCP servers are healthy'])
      : degradedServers
          .slice(0, 3)
          .map((server) => `${server.name}: trust=${server.trustMode} schema=${server.schemaFreshness}${server.quarantineReason ? ` quarantine=${server.quarantineReason}` : ''}`),
    nextSteps: degradedServers.length > 0
      ? ['/mcp review', '/mcp auth-review', '/mcp repair']
      : ['/mcp review'],
  });

  const maintenance = evaluateSessionMaintenance({
    configManager,
    currentTokens: session.estimatedContextTokens,
    contextWindow: session.contextWindow,
    messageCount: session.messageCount,
    session: session.session,
  });
  summaries.push({
    name: 'maintenance',
    level: maintenance.level === 'needs-repair'
      ? 'bad'
      : maintenance.level === 'suggest-compact' || maintenance.level === 'watch'
        ? 'warn'
        : 'good',
    summary: maintenance.summary,
    next: maintenance.nextSteps[0] ?? '/guidance review',
    details: maintenance.reasons.slice(0, 3),
    nextSteps: maintenance.nextSteps,
  });

  summaries.push({
    name: 'continuity',
    level: continuity.recoveryFilePresent ? 'warn' : continuity.lastSessionPointer ? 'good' : 'info',
    summary: continuity.recoveryFilePresent
      ? `recovery file present for ${continuity.sessionId || '(unknown session)'}`
      : continuity.lastSessionPointer ? `last session pointer ${continuity.lastSessionPointer}` : 'no last-session pointer',
    next: continuity.recoveryFilePresent ? '/session resume <id>' : '/session list',
    details: [
      continuity.returnContext ? `last activity: ${continuity.returnContext.activityLabel}` : '',
      continuity.returnContext ? `resume posture: ${continuity.returnContext.statusLabel}` : '',
      !continuity.lastSessionPointer ? 'no persisted last-session pointer recorded' : '',
    ].filter(Boolean),
    nextSteps: continuity.recoveryFilePresent
      ? ['/session list', '/session resume <id>', '/health continuity']
      : ['/session list'],
  });

  return summaries;
}
