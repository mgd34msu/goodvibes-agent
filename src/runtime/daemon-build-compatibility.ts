/**
 * Daemon build compatibility — the other half of the build handshake.
 *
 * client-build-compatibility.ts is this process being judged: the daemon
 * publishes the oldest client it will let participate, and a build below that
 * floor stops taking shared-session work. This file is the reverse, and the
 * exposure it covers is real in a way that is easy to miss.
 *
 * This process talks to a daemon it did not start and cannot see, over a base
 * URL that may point at another machine. Every capability it has is something
 * the daemon performs on its behalf. When the daemon is too old to serve a verb
 * this build depends on, what an operator observes is one call returning 400 or
 * 404 — which reads as a broken feature, not as an old daemon. The Agent keeps
 * running, half-working, against a peer nobody has any reason to suspect.
 *
 * So the daemon's build is checked once per attach against a floor this product
 * declares, using the `version` that `/status` has returned since the route
 * existed. The comparison is the SDK's (`evaluateDaemonStatusCompatibility`);
 * what lives here is this process's state around it — the latch, and the
 * once-only notification — for the same reason the forward guard's does.
 *
 * ON THE FLOOR VALUE
 *
 * `AGENT_DAEMON_BUILD_FLOOR` is deliberately unset. The SDK is explicit that
 * the floor belongs to the consumer, not the platform: "the TUI, the agent and
 * the web UI need different daemon behaviors at different times, and a single
 * SDK-wide constant would either over-refuse for one of them or under-refuse
 * for another. Each consumer passes its own and states, in its own release
 * notes, what it raised the floor for."
 *
 * Raising it costs every operator running an older daemon a forced update, so
 * the number is a decision with a release note attached rather than something
 * to infer. Unset is a supported, meaningful state — the SDK reads it as this
 * client not asking for anything — and it is the honest one until there is a
 * specific daemon behavior this Agent build refuses to run without. The
 * mechanism below is live either way: set the constant, and the check, the
 * latch and the notification all start working with no other change.
 */

import {
  evaluateDaemonStatusCompatibility,
  type DaemonCompatibilityVerdict,
} from '@pellux/goodvibes-sdk/platform/control-plane';

export type { DaemonCompatibilityVerdict };
export { evaluateDaemonStatusCompatibility };

/**
 * The oldest daemon build this Agent will work against, or undefined for "this
 * client is not asking for anything". See the note above before changing it.
 */
export const AGENT_DAEMON_BUILD_FLOOR: string | undefined = undefined;

export interface DaemonBuildGuardOptions {
  /** The floor this client declares. Undefined means it declares none. */
  readonly floor?: string | undefined;
  /**
   * Invoked once, the first time an attached daemon is judged too old. Wiring
   * it to a visible surface is what turns "the daemon needs updating" into
   * something the owner actually sees, rather than a verb that quietly 404s.
   */
  readonly onDaemonUpdateRequired?: ((verdict: DaemonCompatibilityVerdict) => void) | undefined;
}

/**
 * The live verdict about the daemon this process is attached to.
 *
 * Latched, for the mirror image of the forward guard's reason: once a daemon
 * has been judged too old, a later read that cannot determine a version (a
 * restart, a truncated response) must not silently clear the finding.
 *
 * The latch is dropped by `reset()`, which the attach path calls when it moves
 * to a DIFFERENT daemon — a verdict about the old peer says nothing about the
 * new one, and carrying it over would report the wrong machine as stale.
 */
export class DaemonBuildGuard {
  private verdict: DaemonCompatibilityVerdict;
  private announced = false;

  constructor(private readonly options: DaemonBuildGuardOptions = {}) {
    this.verdict = this.initialVerdict();
  }

  private initialVerdict(): DaemonCompatibilityVerdict {
    return {
      status: 'ok',
      message: 'No daemon build observed yet.',
      daemonVersion: undefined,
      floor: this.options.floor,
    };
  }

  /** Feed a parsed `/status` body. `daemonLabel` names the peer in the message. */
  observeStatus(statusPayload: unknown, daemonLabel?: string): DaemonCompatibilityVerdict {
    if (this.verdict.status === 'daemon-update-required') return this.verdict;
    const next = evaluateDaemonStatusCompatibility(statusPayload, this.options.floor, daemonLabel);
    this.verdict = next;
    if (next.status === 'daemon-update-required' && !this.announced) {
      this.announced = true;
      this.options.onDaemonUpdateRequired?.(next);
    }
    return next;
  }

  /** False once the attached daemon has been judged too old for this build. */
  mayUseDaemonCapabilities(): boolean {
    return this.verdict.status !== 'daemon-update-required';
  }

  /** Forget everything observed. For an attach to a different daemon. */
  reset(): void {
    this.verdict = this.initialVerdict();
    this.announced = false;
  }

  current(): DaemonCompatibilityVerdict {
    return this.verdict;
  }
}

export interface DaemonStatusConnection {
  readonly baseUrl: string;
  readonly token: string | null;
}

/**
 * Read `/status` for the daemon's build.
 *
 * Its own read rather than a field pulled off the liveness probe: that probe
 * reports reachability as a boolean and surfaces only the client-floor header,
 * so the body carrying `version` never reaches a caller. Best-effort by
 * design — an unreachable daemon yields null, which the guard reads as
 * "nothing observed" rather than as a verdict.
 */
export async function readDaemonStatusPayload(
  connection: DaemonStatusConnection,
  options: { readonly timeoutMs?: number; readonly fetchImpl?: typeof fetch } = {},
): Promise<unknown | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, options.timeoutMs ?? 2000);
  try {
    const response = await fetchImpl(`${connection.baseUrl}/status`, {
      signal: controller.signal,
      ...(connection.token ? { headers: { authorization: `Bearer ${connection.token}` } } : {}),
    });
    if (!response.ok) return null;
    return await response.json() as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
