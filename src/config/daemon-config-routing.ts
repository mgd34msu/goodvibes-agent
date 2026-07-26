/**
 * daemon-config-routing.ts — the agent's single entry point to config
 * ownership routing.
 *
 * Every setting has an OWNER: the runtime that ACTS on it, not the client that
 * edits it. The agent is a CLIENT of the daemon, so:
 *
 *   - a daemon-owned key (all `surfaces.*`, control-plane binding, `watchers.*`,
 *     `device.*`, `automation.*`, `checkin.*`, `integrations.*`, `atRest.*`,
 *     `relay.*`, `voice.local.*`, `danger.httpListener`) is WRITTEN to and READ
 *     from the daemon, live;
 *   - an agent-owned key (rendering, theme, transcript display, `daemon.*`,
 *     `service.*`, `voice.wake.*`) stays in the agent's own settings file;
 *   - a user-level key (`tts.*`, `provider.model`, `provider.reasoningEffort`)
 *     rides the cross-client shared tier.
 *
 * This exists because the split cost real settings: a Telegram bot username set
 * here reported success, landed in `~/.goodvibes/agent/settings.json`, and
 * configured nothing — Telegram runs in the daemon, which reads a different
 * file. Then the same asymmetry ran backwards: asked to confirm the value, the
 * agent read its own store, found a blank, and reported the setting as not set.
 *
 * Ownership itself is defined ONCE, in the SDK (`config-ownership.ts`). Nothing
 * in this repo re-derives it — `isDaemonOwnedConfigKey` / `configKeyScope` are
 * re-exported here so callers (including the settings policy guard) share one
 * table rather than maintaining a parallel one that will drift.
 */

import {
  applyConfigWrite,
  configKeyScope,

  readControlPlaneBinding,
  readDaemonTierFile,
  readDotPath,
  createEffectiveConfigView,
  isDaemonOwnedConfigKey,
  isClientOwnedConfigKey,
  isUserLevelConfigKey,
  type ConfigScope,
  type ConfigWriteOutcome,
  type DaemonConfigRouterDeps,
  type EffectiveConfigView,
  type LocalConfigReader,
  type LocalConfigWriter,
} from '@pellux/goodvibes-sdk/platform/config';
import { readOperatorTokenFile, resolveDaemonHomeDir } from '@pellux/goodvibes-sdk/platform/workspace';
import { join } from 'node:path';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';

export {
  configKeyScope,
  isClientOwnedConfigKey,
  isDaemonOwnedConfigKey,
  isUserLevelConfigKey,
};
export type { ConfigScope, ConfigWriteOutcome, EffectiveConfigView };

/** Extract the bearer token the daemon's admin routes require, if present. */
function readOperatorToken(daemonHomeDir: string): string | undefined {
  const raw = readOperatorTokenFile(daemonHomeDir);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { token?: unknown }).token === 'string') {
      return (parsed as { token: string }).token;
    }
  } catch {
    // A non-JSON token file is treated as the raw token, matching how the
    // daemon's own reader tolerates both shapes.
    return raw.trim() || undefined;
  }
  return undefined;
}

export interface AgentConfigRoutingOptions {
  /**
   * The home directory the caller's ConfigManager is rooted at. The daemon home
   * is derived from it, so a process running against a non-default home (a
   * test, a second profile) never reaches the machine's real daemon. Only an
   * explicit GOODVIBES_DAEMON_HOME overrides it.
   */
  readonly homeDir?: string | undefined;
  /**
   * An explicitly configured daemon base URL — required when the daemon runs on
   * another machine, where no local file or runtime record exists to discover.
   */
  readonly baseUrl?: string | undefined;
  /** Override the daemon home (honors GOODVIBES_DAEMON_HOME by default). */
  readonly daemonHomeDir?: string | undefined;
  /** True only when THIS process hosts the daemon. The agent normally does not. */
  readonly hostsDaemon?: boolean | undefined;
}

/**
 * Build the routing dependencies for this process. Discovery is deliberately
 * file-free for the VALUE path: the daemon home is consulted only to find where
 * the daemon is listening and which token to present, never to read settings
 * out of the daemon's settings file behind its back.
 */
export function buildAgentConfigRouting(options: AgentConfigRoutingOptions = {}): DaemonConfigRouterDeps {
  const daemonHomeDir = options.daemonHomeDir ?? resolveAgentDaemonHome(options.homeDir);
  const token = readOperatorToken(daemonHomeDir);
  const trimmedBaseUrl = options.baseUrl?.trim();
  return {
    hostsDaemon: options.hostsDaemon ?? false,
    daemonHomeDir,
    token,
    // Where the daemon listens is DERIVED from its own control-plane binding,
    // never from a stored base-URL string (which drifts on port, scheme and
    // host — see the SDK's control-plane-base-url.ts). This is also what makes
    // a foreground daemon discoverable: it writes no detached-daemon record, so
    // without this a live daemon looked absent and daemon-owned writes went to
    // the local file while it was running.
    readDaemonBinding: () => readDaemonBindingFromStore(daemonHomeDir),
    ...(trimmedBaseUrl
      ? { endpoint: { baseUrl: trimmedBaseUrl, token, source: 'configured controlPlane base URL' } }
      : {}),
  };
}

/**
 * The daemon home for a caller rooted at `homeDir`. An explicit
 * GOODVIBES_DAEMON_HOME still wins (it is a deliberate operator override);
 * otherwise the daemon home follows the CALLER's home rather than the process
 * user's, so a config manager on a different home never talks to the machine's
 * real daemon by accident.
 */
function resolveAgentDaemonHome(homeDir: string | undefined): string {
  if (process.env['GOODVIBES_DAEMON_HOME']?.trim()) return resolveDaemonHomeDir();
  if (homeDir?.trim()) return join(homeDir, '.goodvibes', 'daemon');
  return resolveDaemonHomeDir();
}

/**
 * Read the daemon's control-plane binding out of the daemon's own settings
 * store. This is address discovery, not value reading: settings VALUES always
 * come from the daemon over the wire.
 */
function readDaemonBindingFromStore(daemonHomeDir: string) {
  try {
    const stored = readDaemonTierFile(join(daemonHomeDir, 'settings.json'));
    const read = (key: string): unknown => readDotPath(stored, key).value;
    if (readDotPath(stored, 'controlPlane.port').present === false
      && readDotPath(stored, 'controlPlane.hostMode').present === false) {
      return null;
    }
    return readControlPlaneBinding(read);
  } catch {
    return null;
  }
}

/**
 * A synchronous, ownership-aware view over config: daemon-owned keys carry the
 * DAEMON's live value, everything else the agent's own. One daemon round-trip
 * up front, so a settings listing stays a single call.
 *
 * `view.unavailable` names the keys whose live value could not be read. Callers
 * must report those as unknown rather than falling back to a default — a
 * default presented as the current setting is indistinguishable from a lie.
 */
export async function openEffectiveConfigView(
  configManager: LocalConfigReader,
  options: AgentConfigRoutingOptions = {},
): Promise<EffectiveConfigView> {
  return await createEffectiveConfigView(configManager, buildAgentConfigRouting(options));
}

/**
 * Write a config value to whichever runtime owns it.
 *
 * Daemon-owned → the daemon. Agent-owned → the agent's own store. The ONLY
 * failure case is the daemon genuinely being unreachable, and it is reported
 * plainly: the write throws rather than persisting locally and claiming
 * success, because a local write does not reach the runtime that acts on the
 * key.
 */
export async function routeConfigWrite(
  configManager: LocalConfigWriter,
  key: string,
  value: unknown,
  options: AgentConfigRoutingOptions = {},
): Promise<ConfigWriteOutcome> {
  const outcome = await applyConfigWrite(key, value, configManager, buildAgentConfigRouting(options));
  logger.debug('[config] routed write by ownership', {
    key,
    scope: outcome.scope,
    appliedBy: outcome.appliedBy,
    persistedTo: outcome.persistedTo,
  });
  return outcome;
}

/** One-line description of where a key lives, for tool output and help text. */
export function describeConfigStore(outcome: ConfigWriteOutcome): string {
  return outcome.appliedBy === 'daemon'
    ? `Applied by the daemon and stored in ${outcome.persistedTo}; it takes effect for every client.`
    : `Stored in ${outcome.persistedTo}.`;
}
