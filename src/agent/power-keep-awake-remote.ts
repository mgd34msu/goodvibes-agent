/**
 * power-keep-awake-remote.ts
 *
 * The owner keep-awake toggle (power.keepAwake) must be DAEMON-held in the
 * adopted-external-daemon topology: the agent's own in-process PowerManager
 * (wired in services.ts via wireRuntimePower) holds a LOCAL OS-level
 * inhibitor that releases the moment this agent process exits — exactly the
 * opposite of "the owner keep-awake toggle ... survives surfaces closing"
 * (see the SDK's power/manager.ts doc comment). When an external daemon is
 * adopted (the same reachability signal
 * services.sessionSpineClient.probeReachability() already uses for the
 * memory/session spine), the toggle must ALSO reach the daemon's own
 * PowerManager, which outlives this process.
 *
 * The config-file path does NOT cover this: power.keepAwake is a plain
 * surface-local config key (see the SDK's shared-config-tier.ts —
 * SHARED_CONFIG_KEYS lists only tts.*), so a local configManager.set() writes
 * to THIS surface's own settings.json (~/.goodvibes/agent/settings.json),
 * never the daemon's. Forwarding it explicitly over the wire — the daemon's
 * `power.keepAwake.set` gateway verb, served at POST /api/power/keep-awake
 * (see the SDK's control-plane/method-catalog-power.ts) — is therefore the
 * only mechanism that reaches a durable, out-of-process hold.
 *
 * Written in the same raw-REST style as agent/session-registration.ts:
 * request/response only, a Bearer token, an AbortController timeout, and the
 * SAME classifyHttpFailure semantics (404 -> route unavailable, 401/403 ->
 * auth required, network -> host unavailable) — deliberately NOT the
 * typed operator SDK client, since power.keepAwake.set is a ws-only gateway
 * verb (attachWsOnlyGatewayVerbHandlers), not part of the operator contract.
 */

export type PowerKeepAwakeRemoteFailureKind =
  | 'auth_required'
  | 'connected_host_unavailable'
  | 'connected_host_route_unavailable'
  | 'connected_host_error';

export interface PowerKeepAwakeRemoteConnection {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly tokenPath?: string;
}

export const POWER_KEEP_AWAKE_SET_PATH = '/api/power/keep-awake';
/** Best-effort background forward; short so it never blocks a settings-modal apply. */
export const POWER_KEEP_AWAKE_SET_TIMEOUT_MS = 1500;

export interface PowerKeepAwakeRemoteSuccess {
  readonly ok: true;
}

export interface PowerKeepAwakeRemoteFailure {
  readonly ok: false;
  readonly kind: PowerKeepAwakeRemoteFailureKind;
  readonly status?: number;
  readonly error: string;
}

export type PowerKeepAwakeRemoteResult = PowerKeepAwakeRemoteSuccess | PowerKeepAwakeRemoteFailure;

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Identical failure classification to session-registration.ts's classifyHttpFailure. */
function classifyHttpFailure(status: number, body: unknown): PowerKeepAwakeRemoteFailure {
  const detail = isRecord(body) && typeof body.error === 'string' ? body.error : '';
  return {
    ok: false,
    status,
    kind: status === 401 || status === 403
      ? 'auth_required'
      : status === 404
        ? 'connected_host_route_unavailable'
        : 'connected_host_error',
    error: `HTTP ${status}${detail ? `: ${detail}` : ''}`,
  };
}

/**
 * Forward the owner keep-awake toggle to the adopted daemon's gateway. Never
 * throws — every failure mode (no token on disk, network down, an
 * incompatible/pre-power-verb daemon, a real server error) returns a
 * discriminated failure the caller logs and degrades from; the caller decides
 * whether to also apply locally.
 */
export async function postPowerKeepAwakeSet(
  connection: PowerKeepAwakeRemoteConnection,
  enabled: boolean,
  options: { readonly timeoutMs?: number } = {},
): Promise<PowerKeepAwakeRemoteResult> {
  if (!connection.token) {
    return {
      ok: false,
      kind: 'auth_required',
      error: connection.tokenPath
        ? `no connected-host operator token found at ${connection.tokenPath}`
        : 'no connected-host operator token found',
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? POWER_KEEP_AWAKE_SET_TIMEOUT_MS);
  try {
    const response = await fetch(`${connection.baseUrl}${POWER_KEEP_AWAKE_SET_PATH}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enabled }),
      signal: controller.signal,
    });
    const body = await readResponseBody(response);
    if (!response.ok) return classifyHttpFailure(response.status, body);
    return { ok: true };
  } catch (error) {
    return { ok: false, kind: 'connected_host_unavailable', error: summarizeError(error) };
  } finally {
    clearTimeout(timer);
  }
}

export interface ForwardKeepAwakeDeps {
  /** The existing daemon-adoption signal — reuse services.sessionSpineClient.probeReachability() in production. */
  readonly probeReachability: () => Promise<'unknown' | 'online' | 'offline'>;
  readonly resolveConnection: () => PowerKeepAwakeRemoteConnection;
  readonly post?: typeof postPowerKeepAwakeSet;
}

export type ForwardKeepAwakeOutcome =
  | { readonly attempted: false }
  | { readonly attempted: true; readonly result: PowerKeepAwakeRemoteResult };

/**
 * Forward power.keepAwake to the adopted daemon ONLY when a daemon is
 * actually reachable right now — an unreachable/unknown daemon means there is
 * nothing durable to hold the toggle for this process anyway, so this is a
 * clean no-op (`attempted: false`) rather than a wasted network call. Never
 * throws: a reachability probe rejection is treated the same as "not
 * reachable" (best-effort — a live keep-awake apply must never take down the
 * settings-modal apply path it is called from).
 */
export async function forwardKeepAwakeToAdoptedDaemon(
  enabled: boolean,
  deps: ForwardKeepAwakeDeps,
): Promise<ForwardKeepAwakeOutcome> {
  const post = deps.post ?? postPowerKeepAwakeSet;
  let reachable: 'unknown' | 'online' | 'offline';
  try {
    reachable = await deps.probeReachability();
  } catch {
    reachable = 'offline';
  }
  if (reachable !== 'online') return { attempted: false };
  const result = await post(deps.resolveConnection(), enabled);
  return { attempted: true, result };
}
