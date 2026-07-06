/**
 * memory-spine-adoption.ts
 *
 * The single policy for deciding whether the agent's memory spine should be
 * routing over the wire (CLIENT mode, an adopted daemon owns the store) or
 * reading/writing its own local store (LOCAL mode) — given the SAME
 * daemon-reachability signal already used by the session spine
 * (services.sessionSpineClient.probeReachability()), per Mike's direction to reuse
 * the agent's existing daemon-adoption signal rather than invent a second one.
 *
 * Extracted out of bootstrap.ts so this decision is unit-testable in isolation and
 * so the boot-time check and the periodic recheck (a daemon can appear or
 * disappear after boot) run through exactly ONE code path, not two copies that
 * could drift apart.
 */
import type { MemorySpineClient, MemoryTransport } from '@pellux/goodvibes-sdk/platform/runtime/memory-spine';

export interface MemorySpineAdoptionOptions {
  /** Only the three methods this policy needs — narrow on purpose so a test double is trivial to write. */
  readonly memorySpineClient: Pick<MemorySpineClient, 'active' | 'activate' | 'deactivate'>;
  readonly transport: MemoryTransport;
  /** The existing daemon-adoption signal — reuse services.sessionSpineClient.probeReachability() in production. */
  readonly probeReachability: () => Promise<'unknown' | 'online' | 'offline'>;
  readonly deactivateReason?: string;
}

/**
 * Runs one reachability check and adopts/releases the daemon accordingly:
 *  - reachable AND not yet active -> activate(transport) (adopt the daemon; every
 *    wire-covered memory op now routes over HTTP and the local store is never
 *    written again, for as long as this holds).
 *  - NOT reachable AND currently active -> deactivate(reason) (hand back to owned
 *    local access — a sustained daemon loss, never guessed from a single call
 *    failure elsewhere; see memory-spine/client.ts's honest-failure contract).
 *  - otherwise: no-op, already in the correct mode.
 *
 * A probe rejection propagates to the caller (it does not swallow errors) — the
 * caller decides how to log a failed reachability check (see bootstrap.ts's
 * onError handling on the deferred startup task and the interval tick).
 */
export async function reconcileMemorySpineAdoption(options: MemorySpineAdoptionOptions): Promise<void> {
  const reachable = (await options.probeReachability()) === 'online';
  if (reachable && !options.memorySpineClient.active) {
    options.memorySpineClient.activate(options.transport);
    return;
  }
  if (!reachable && options.memorySpineClient.active) {
    options.memorySpineClient.deactivate(options.deactivateReason ?? 'daemon unreachable on periodic reachability check');
  }
}
