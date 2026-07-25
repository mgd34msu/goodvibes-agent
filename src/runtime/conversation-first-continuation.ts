/**
 * Conversation-first continuation for the agent's shared sessions.
 *
 * Owner ruling: goodvibes-agent should be conversation driven and should not
 * expect work to start "unless either agreed to or previously scheduled". A
 * message arriving in a session is a message — it gets an answer. It does not
 * silently become a write-review-fix-confirm chain with a reviewer, quality
 * gates, and a second agent.
 *
 * The agent's session continuation runner (runtime/services.ts) previously
 * spawned every follow-up with the WRFC controller attached, so a one-word
 * message escalated into a full chain. This module owns the single rule that
 * decides otherwise.
 *
 * WHAT COUNTS AS AUTHORIZED
 *
 * Work is authorized when the input carries an explicit marker, which is set
 * by whatever confirmed it:
 * - the conversation gate at channel ingress, once the owner agreed to a
 *   proposal over the channel it was proposed on;
 * - a schedule, trigger, or on-exit chain, which was confirmed when it was
 *   created and must not re-ask at execution time.
 *
 * The marker is a wire-format key on the session input's open metadata record,
 * so it survives the hop between surfaces without a schema change and older
 * readers ignore it. Absent means conversation, which is the safe default:
 * the worst case is an answer instead of a workstream, and the owner can ask
 * for the workstream.
 *
 * Automation's own spawn path (AutomationManager.spawnTask) does NOT come
 * through here — a scheduled run was authorized when it was scheduled and
 * keeps its chain.
 */

/**
 * Metadata key marking a session input as already-authorized work.
 *
 * Shared by value across surfaces (like a header name), not by import: the
 * agent reads what the daemon writes. Changing it is a wire-format change.
 */
export const WORK_AUTHORIZED_METADATA_KEY = 'goodvibes.workAuthorized';

/** Why a continuation was or was not allowed to open a work chain. */
export type ContinuationEscalation =
  | { readonly startsWorkChain: true; readonly reason: 'pre-authorized' }
  | { readonly startsWorkChain: false; readonly reason: 'conversation-first' };

export interface ContinuationInputLike {
  readonly metadata?: Record<string, unknown> | undefined;
}

/**
 * Decide whether a session continuation may open a write-review-fix-confirm
 * chain. Only an explicit authorization marker permits it; everything else is
 * conversation and gets a plain reply.
 */
export function decideContinuationEscalation(input: ContinuationInputLike | undefined): ContinuationEscalation {
  const marker = input?.metadata?.[WORK_AUTHORIZED_METADATA_KEY];
  // Accept the boolean true and the string 'true' — the marker crosses a JSON
  // wire and some surfaces stringify metadata values.
  const authorized = marker === true || marker === 'true';
  return authorized
    ? { startsWorkChain: true, reason: 'pre-authorized' }
    : { startsWorkChain: false, reason: 'conversation-first' };
}

/**
 * The spawn-input fragment implementing the decision. Spreading this into an
 * `agentManager.spawn(...)` call is the whole integration:
 *
 *   ...continuationChainOptions(input)
 */
export function continuationChainOptions(
  input: ContinuationInputLike | undefined,
): { readonly dangerously_disable_wrfc?: true } {
  return decideContinuationEscalation(input).startsWorkChain
    ? {}
    : { dangerously_disable_wrfc: true };
}

/** Mark an input's metadata as authorized work. Used by confirmation paths. */
export function markWorkAuthorized(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...(metadata ?? {}), [WORK_AUTHORIZED_METADATA_KEY]: true };
}
