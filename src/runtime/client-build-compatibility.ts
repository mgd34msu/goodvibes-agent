/**
 * Client build compatibility — this process's half of the daemon's floor.
 *
 * A daemon update swaps the daemon binary and nothing else. This process keeps
 * running the build it started with: same rules, same bugs, still attached to
 * the same shared session store, still able to execute shared-session work.
 * That is how a behavioral fix can land in the daemon, be verified present in
 * the installed binaries, and still not change what the owner observes — an
 * older process beside the new daemon simply keeps doing the old thing.
 *
 * So the daemon publishes the minimum client build it will let participate, as
 * an `X-Goodvibes-Client-Floor` response header on `/status` — the liveness
 * read this process already performs on a timer. When this build is below that
 * floor it says so plainly and stops taking shared-session work, rather than
 * quietly executing under superseded rules until someone notices.
 *
 * WHERE THIS RULE LIVES
 *
 * The SDK owns it (platform/control-plane/client-compatibility.ts). This file
 * is this product's copy for as long as the pinned SDK (1.14.0) predates that
 * module; the values and the comparison MUST stay identical. On re-pinning to
 * the SDK release that carries it, delete this file and import
 * `evaluateClientCompatibility` / `readClientCompatibilityFloor` /
 * `CLIENT_COMPATIBILITY_FLOOR_HEADER` from
 * '@pellux/goodvibes-sdk/platform/control-plane'.
 */

/** Response header carrying the daemon's minimum acceptable client build. */
export const CLIENT_COMPATIBILITY_FLOOR_HEADER = 'X-Goodvibes-Client-Floor';

export type ClientCompatibilityStatus = 'ok' | 'restart-required' | 'unknown';

export interface ClientCompatibilityVerdict {
  readonly status: ClientCompatibilityStatus;
  readonly message: string;
  readonly clientVersion: string | undefined;
  readonly floor: string | undefined;
}

/** Compare dotted build versions numerically, segment by segment. */
export function compareBuildVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .trim()
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .map((segment) => Number.parseInt(segment, 10))
      .filter((segment) => Number.isFinite(segment));
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Judge this build against a floor. An unreadable client version is 'unknown',
 * not 'ok': a build that cannot prove it carries a required behavior is
 * treated as one that does not. An absent FLOOR is 'ok' — that daemon is too
 * old to be asking for anything.
 */
export function evaluateClientCompatibility(input: {
  readonly clientVersion: string | undefined;
  readonly floor: string | undefined;
}): ClientCompatibilityVerdict {
  const floor = input.floor?.trim();
  const clientVersion = input.clientVersion?.trim();
  if (!floor) {
    return {
      status: 'ok',
      message: 'The daemon publishes no client build floor; nothing to check.',
      clientVersion,
      floor: undefined,
    };
  }
  if (!clientVersion || !/\d/.test(clientVersion)) {
    return {
      status: 'unknown',
      message: `This build does not report a version, so it cannot be checked against the daemon's floor of ${floor}. Restart it from the current install to be sure it is current.`,
      clientVersion,
      floor,
    };
  }
  if (compareBuildVersions(clientVersion, floor) < 0) {
    return {
      status: 'restart-required',
      message: `This goodvibes-agent process is build ${clientVersion}; the daemon requires ${floor} or newer. It has stopped taking shared-session work — restart it to rejoin.`,
      clientVersion,
      floor,
    };
  }
  return {
    status: 'ok',
    message: `Build ${clientVersion} meets the daemon's floor of ${floor}.`,
    clientVersion,
    floor,
  };
}

/** Read the floor a daemon announced, from any `/status` response headers. */
export function readClientCompatibilityFloor(
  headers: { get(name: string): string | null } | undefined,
): string | undefined {
  const value = headers?.get(CLIENT_COMPATIBILITY_FLOOR_HEADER)
    ?? headers?.get(CLIENT_COMPATIBILITY_FLOOR_HEADER.toLowerCase());
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export interface ClientBuildGuardOptions {
  readonly clientVersion: string;
  /**
   * Invoked once, the first time this build is judged below the floor. Wiring
   * it to a visible surface is what turns "the daemon asked for a restart"
   * into something the owner actually sees.
   */
  readonly onRestartRequired?: ((verdict: ClientCompatibilityVerdict) => void) | undefined;
}

/**
 * The live verdict for this process, updated by whatever reads the daemon's
 * floor (the session-spine liveness probe) and consulted by whatever would
 * execute shared-session work (the continuation runner).
 *
 * Latching is deliberate: once a daemon has told this process it is too old,
 * a later probe that fails to read the header (a restart, a truncated
 * response) must not silently re-enable work.
 */
export class ClientBuildGuard {
  private verdict: ClientCompatibilityVerdict;
  private announced = false;

  constructor(private readonly options: ClientBuildGuardOptions) {
    this.verdict = {
      status: 'ok',
      message: 'No daemon floor observed yet.',
      clientVersion: options.clientVersion,
      floor: undefined,
    };
  }

  /** Feed a floor read from a daemon response. */
  observeFloor(floor: string | undefined): ClientCompatibilityVerdict {
    if (this.verdict.status === 'restart-required') return this.verdict;
    const next = evaluateClientCompatibility({ clientVersion: this.options.clientVersion, floor });
    this.verdict = next;
    if (next.status === 'restart-required' && !this.announced) {
      this.announced = true;
      this.options.onRestartRequired?.(next);
    }
    return next;
  }

  /** False once this build has been judged too old for the live daemon. */
  maySharedSessionWork(): boolean {
    return this.verdict.status !== 'restart-required';
  }

  current(): ClientCompatibilityVerdict {
    return this.verdict;
  }
}
