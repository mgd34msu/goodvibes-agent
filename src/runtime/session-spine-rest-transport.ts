/**
 * session-spine-rest-transport.ts
 *
 * The agent's REST transport adapter for the SDK's extracted session-spine core
 * (`@pellux/goodvibes-sdk/platform/runtime/session-spine`). The core is
 * transport-agnostic and never assumes a typed sessions client exists — that is
 * exactly why the agent, which compiles against a pinned/version-tolerant npm
 * SDK that may predate `sessions.register`, supplies this hand-rolled REST
 * mirror instead of a typed client (see
 * docs/decisions/2026-07-05-session-spine-sdk-extraction.md, divergence ruling
 * #1). Do not switch this adapter to a typed client.
 *
 * Also agent-local (per the same decision record, ruling #6 and the SDK-side
 * rejection of "pulling token-reading into the SDK"):
 *  - `createSpineConnectionResolver`: builds the daemon base URL from
 *    ConfigManager and reads the connected-host operator token via
 *    ../runtime/connected-host-auth.ts (home-dir-specific, trust-boundary-bound
 *    — the SDK core never reads token files; it only ever receives a
 *    pre-built resolver through this adapter).
 *  - register/close/probe TIMEOUTS: the SDK core no longer makes the wire
 *    call (transport does), so it has nothing to time out. Timeouts are a REST
 *    implementation concern and live here, in the adapter that owns fetch.
 */

import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import type { RegisterSharedSessionInput } from '@pellux/goodvibes-sdk/platform/control-plane';
import type { SpineResult, SpineTransport } from '@pellux/goodvibes-sdk/platform/runtime/session-spine';
import {
  postSessionClose,
  postSessionRegister,
  type SessionCloseResult,
  type SessionRegisterResult,
  type SessionRegistrationConnection,
  type SessionRegistrationInput,
} from '../agent/session-registration.ts';
import { readConnectedHostOperatorToken } from './connected-host-auth.ts';
import { extractDaemonReceipts, type DaemonReceipt } from './daemon-receipts.ts';
import { readClientCompatibilityFloor } from './client-build-compatibility.ts';

const DEFAULT_REGISTER_TIMEOUT_MS = 1_500;
const DEFAULT_CLOSE_TIMEOUT_MS = 500;
const DEFAULT_PROBE_TIMEOUT_MS = 1_500;

/**
 * Builds a per-op connection resolver from the config manager (host/port,
 * default 127.0.0.1:3421) and the connected-host operator token (env
 * overrides + the canonical operator-tokens.json). Re-read every op so a
 * token that appears after boot is picked up.
 */
export function createSpineConnectionResolver(
  configManager: Pick<ConfigManager, 'get'>,
  homeDirectory: string,
): () => SessionRegistrationConnection {
  return () => {
    const hostValue = configManager.get('controlPlane.host');
    const portValue = configManager.get('controlPlane.port');
    const host = typeof hostValue === 'string' && hostValue.trim().length > 0 ? hostValue.trim() : '127.0.0.1';
    const port = typeof portValue === 'number' && Number.isFinite(portValue) ? portValue : 3421;
    const token = readConnectedHostOperatorToken(homeDirectory);
    return { baseUrl: `http://${host}:${port}`, token: token.token, tokenPath: token.path };
  };
}

/** Maps the SDK's canonical register input onto the REST mirror's wire shape. No `kind` field: the REST mirror always stamps SESSION_REGISTER_KIND server-side (see session-registration.ts), matching the SDK's `recordKind` left unset for this participant. */
function toRegistrationInput(input: RegisterSharedSessionInput): SessionRegistrationInput {
  return {
    sessionId: input.sessionId,
    ...(input.project ? { project: input.project } : {}),
    ...(input.title ? { title: input.title } : {}),
    participant: {
      surfaceKind: input.participant.surfaceKind,
      surfaceId: input.participant.surfaceId,
      ...(input.participant.externalId ? { externalId: input.participant.externalId } : {}),
      ...(input.participant.userId ? { userId: input.participant.userId } : {}),
      ...(input.participant.displayName ? { displayName: input.participant.displayName } : {}),
      ...(input.participant.routeId ? { routeId: input.participant.routeId } : {}),
      lastSeenAt: input.participant.lastSeenAt,
    },
    ...(input.reopen ? { reopen: true } : {}),
  };
}

/**
 * Folds the REST mirror's richer failure vocabulary onto the SDK core's
 * ok/offline/rejected outcome (decision-record ruling #5): `ok` stays `ok`;
 * `connected_host_unavailable` (a transient connectivity fault) becomes
 * `offline` so the core enqueues for reconnect replay; every DURABLE refusal
 * (`auth_required`, `connected_host_route_unavailable`, `connected_host_error`)
 * becomes `rejected` so the core logs it and never enqueues it (no
 * retry-forever).
 */
function foldResult(result: SessionRegisterResult | SessionCloseResult): SpineResult {
  if (result.ok) return { outcome: 'ok' };
  if (result.kind === 'connected_host_unavailable') return { outcome: 'offline', error: result.error };
  return { outcome: 'rejected', error: result.error };
}

export interface SpineRestTransportOptions {
  readonly resolveConnection: () => SessionRegistrationConnection;
  readonly registerTimeoutMs?: number;
  readonly closeTimeoutMs?: number;
}

/**
 * The agent's version-tolerant REST transport injected into the SDK
 * `SessionSpineClient` at construction (live-immediately mode). Wraps
 * postSessionRegister/postSessionClose and folds their result kinds onto
 * {@link SpineResult}.
 */
export function createSpineRestTransport(options: SpineRestTransportOptions): SpineTransport {
  const registerTimeoutMs = options.registerTimeoutMs ?? DEFAULT_REGISTER_TIMEOUT_MS;
  const closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
  return {
    async register(input: RegisterSharedSessionInput): Promise<SpineResult> {
      const connection = options.resolveConnection();
      const result = await postSessionRegister(connection, toRegistrationInput(input), { timeoutMs: registerTimeoutMs });
      return foldResult(result);
    },
    async close(sessionId: string): Promise<SpineResult> {
      const connection = options.resolveConnection();
      const result = await postSessionClose(connection, sessionId, { timeoutMs: closeTimeoutMs });
      return foldResult(result);
    },
  };
}

async function defaultProbe(
  connection: SessionRegistrationConnection,
  timeoutMs: number,
  onDaemonFloor?: (floor: string | undefined) => void,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Any HTTP response (even 401) means the host answered -> reachable. Auth is
    // a separate concern surfaced by register/close results, not the probe.
    //
    // This is a LIVENESS read only. It fetches PLAIN /status, which a current
    // daemon treats as receipt-NEUTRAL: it never delivers (or marks delivered)
    // the daemon's one-shot honesty receipts. Consuming those is a separate,
    // explicit `?receipts=consume` read done exactly once per attach (see
    // createSpineReceiptConsumer), so this frequent keepalive poll can never
    // silently drain them.
    const response = await fetch(`${connection.baseUrl}/status`, {
      headers: connection.token ? { authorization: `Bearer ${connection.token}` } : undefined,
      signal: controller.signal,
    });
    // The daemon announces the minimum client build it accepts as a header on
    // this same read (see runtime/client-build-compatibility.ts). Reading it
    // here is free: it is the one call this process already makes to the
    // daemon on a timer, so a daemon that was updated out from under us is
    // noticed within one probe interval rather than never.
    onDaemonFloor?.(readClientCompatibilityFloor(response.headers));
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface SpineRestProbeOptions {
  readonly resolveConnection: () => SessionRegistrationConnection;
  readonly probeTimeoutMs?: number;
  /** Override for tests; default does a short PLAIN GET {baseUrl}/status. */
  readonly probeImpl?: (
    connection: SessionRegistrationConnection,
    timeoutMs: number,
    onDaemonFloor?: (floor: string | undefined) => void,
  ) => Promise<boolean>;
  /**
   * Receives the minimum client build the daemon announced on this read
   * (`X-Goodvibes-Client-Floor`), or undefined when it announced none —
   * a daemon too old to publish one, or an unreachable read. Wired to the
   * ClientBuildGuard, which latches and pauses shared-session work when this
   * process is below the floor. See runtime/client-build-compatibility.ts.
   */
  readonly onDaemonFloor?: ((floor: string | undefined) => void) | undefined;
}

/**
 * Builds the zero-argument `probe` the SDK core calls directly from
 * `probeReachability()` (its injected-probe shape takes no parameters — the
 * core has no connection to hand it). This closure captures the resolver and
 * timeout so the core stays connection-agnostic. Liveness only — receipt
 * consumption is {@link createSpineReceiptConsumer}, not this.
 */
export function createSpineRestProbe(options: SpineRestProbeOptions): () => Promise<boolean> {
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const probeImpl = options.probeImpl ?? defaultProbe;
  return () => probeImpl(options.resolveConnection(), probeTimeoutMs, options.onDaemonFloor);
}

/**
 * Performs ONE receipt-consuming /status read: it appends `?receipts=consume`,
 * the only read a current daemon delivers (and then marks delivered) its
 * undelivered honesty receipts to — "updated from X to Y", "restarted after a
 * crash at HH:MM", settings-migration notes. A plain /status read (the liveness
 * probe above) is receipt-neutral, so without this explicit consuming read the
 * agent would never surface those lines against a current daemon.
 *
 * Delivery is destructive at the daemon (served exactly once), so this is issued
 * exactly once per attach — never on the frequent liveness cadence. Returns []
 * on any transport failure, a non-2xx status, or a non-JSON body; reachability
 * is the probe's concern, not this read's.
 */
async function defaultConsumeReceipts(
  connection: SessionRegistrationConnection,
  timeoutMs: number,
): Promise<readonly DaemonReceipt[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(`${connection.baseUrl}/status`);
    url.searchParams.set('receipts', 'consume');
    const response = await fetch(url, {
      headers: connection.token ? { authorization: `Bearer ${connection.token}` } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) return [];
    try {
      return extractDaemonReceipts(await response.json());
    } catch {
      return [];
    }
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export interface SpineReceiptConsumerOptions {
  readonly resolveConnection: () => SessionRegistrationConnection;
  readonly consumeTimeoutMs?: number;
  /** Override for tests; default does a short GET {baseUrl}/status?receipts=consume. */
  readonly consumeImpl?: (
    connection: SessionRegistrationConnection,
    timeoutMs: number,
  ) => Promise<readonly DaemonReceipt[]>;
}

/**
 * Builds the zero-argument receipt consumer the agent invokes once per attach
 * (see the memory-spine adoption reconciler's `onAttach`). Captures the
 * connection resolver and timeout; the returned function performs a single
 * `?receipts=consume` read and yields whatever honesty receipts the daemon
 * delivered (empty when there are none, the daemon is old/absent, or the read
 * fails).
 */
export function createSpineReceiptConsumer(
  options: SpineReceiptConsumerOptions,
): () => Promise<readonly DaemonReceipt[]> {
  const consumeTimeoutMs = options.consumeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const consumeImpl = options.consumeImpl ?? defaultConsumeReceipts;
  return () => consumeImpl(options.resolveConnection(), consumeTimeoutMs);
}
