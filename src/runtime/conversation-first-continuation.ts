/**
 * Conversation-first continuation for the agent's shared sessions.
 *
 * Owner ruling: goodvibes-agent should be conversation driven and should not
 * expect work to start "unless either agreed to or previously scheduled". A
 * message arriving in a session is a message — it gets an answer. It does not
 * silently become a write-review-fix-confirm chain with a reviewer, quality
 * gates, and a second agent.
 *
 * WHERE THIS RULE LIVES
 *
 * The rule is owned by the SDK (platform/agents/conversation-continuation.ts),
 * because the daemon, the terminal UI runtime, and this product each install
 * their own session continuation runner and a copy living in one of them
 * protects only that one. This module is this product's copy for as long as
 * the pinned SDK (1.14.0) predates the shared module: it is written to produce
 * the SAME decision, reusing the SDK's own `isGatedSurface` predicate so the
 * two cannot disagree about what a local surface is.
 *
 * When this product re-pins to the SDK release that carries
 * `conversation-continuation.ts`, delete this file and import
 * `continuationChainOptions` from '@pellux/goodvibes-sdk/platform/agents'.
 *
 * THE RULE, in order:
 *
 * 1. An explicit authorization marker on the input opens a chain — written by
 *    whatever already confirmed the work: an agreed work proposal, a schedule,
 *    a trigger, an on-exit chain.
 * 2. A follow-up on a LOCAL surface (the terminal the operator is sitting in
 *    front of) opens a chain. That is the surface's whole point, and it is the
 *    same exemption the ingress gate makes.
 * 3. Everything else is conversation: it gets a real answer with the chain
 *    suppressed.
 *
 * Absent, malformed, or unrecognized authorization is NOT authorization. The
 * failure mode is an answer where a workstream was wanted, which the owner
 * fixes with one more message; the opposite failure mode is twenty
 * notifications and a review chain nobody asked for.
 *
 * Automation's own spawn path (AutomationManager.spawnTask) does NOT come
 * through here — a scheduled run was authorized when it was scheduled and
 * keeps its chain.
 */
import {
  CONVERSATION_GATE_DEFAULTS,
  isGatedSurface,
  readConversationGateConfig,
  type ConversationGateConfigReader,
} from '@pellux/goodvibes-sdk/platform/agents';

/**
 * Metadata key marking a session input as already-authorized work.
 *
 * Shared BY VALUE across surfaces (like a header name), not by import: the
 * agent reads what the daemon writes, across process and version boundaries.
 * Changing it is a wire-format change, and the value MUST stay identical to
 * the SDK's `WORK_AUTHORIZED_METADATA_KEY`.
 */
export const WORK_AUTHORIZED_METADATA_KEY = 'goodvibes.workAuthorized';

/** Why a continuation was or was not allowed to open a work chain. */
export type ContinuationEscalation =
  | { readonly startsWorkChain: true; readonly reason: 'pre-authorized' | 'local-surface' }
  | { readonly startsWorkChain: false; readonly reason: 'conversation-first' };

export interface ContinuationInputLike {
  readonly metadata?: Record<string, unknown> | undefined;
  readonly surfaceKind?: string | undefined;
  readonly body?: string | undefined;
}

export interface ContinuationEscalationOptions {
  /** Reads `conversationGate.*`; absent = the SDK's shipped defaults. */
  readonly configReader?: ConversationGateConfigReader | undefined;
}

/** True when the input carries the explicit work-authorized marker. */
export function readWorkAuthorization(metadata: Record<string, unknown> | undefined): boolean {
  const marker = metadata?.[WORK_AUTHORIZED_METADATA_KEY];
  // Accept the boolean and the string: the marker crosses a JSON wire and some
  // surfaces stringify metadata values. Nothing else counts.
  return marker === true || marker === 'true';
}

/**
 * Decide whether a session continuation may open a write-review-fix-confirm
 * chain.
 */
export function decideContinuationEscalation(
  input: ContinuationInputLike | undefined,
  options: ContinuationEscalationOptions = {},
): ContinuationEscalation {
  if (readWorkAuthorization(input?.metadata)) {
    return { startsWorkChain: true, reason: 'pre-authorized' };
  }
  const config = options.configReader
    ? readConversationGateConfig(options.configReader)
    : CONVERSATION_GATE_DEFAULTS;
  return isGatedSurface(config, input?.surfaceKind)
    ? { startsWorkChain: false, reason: 'conversation-first' }
    : { startsWorkChain: true, reason: 'local-surface' };
}

/**
 * The spawn-input fragment implementing the decision. Spreading this into an
 * `agentManager.spawn(...)` call is the whole integration:
 *
 *   ...continuationChainOptions(input)
 */
export function continuationChainOptions(
  input: ContinuationInputLike | undefined,
  options: ContinuationEscalationOptions = {},
): { readonly dangerously_disable_wrfc?: true; readonly replyStyle?: 'conversational' } {
  // `replyStyle` rides with the chain decision rather than being derived a
  // second time somewhere else. A continuation that is conversation gets a
  // conversational REPLY: no completion report, no Summary/Changes/Decisions
  // template. Answering a message with a filled-in form is what the owner
  // received on his phone, and suppressing the CHAIN without also changing
  // what the reply LOOKS like is exactly half a fix.
  return decideContinuationEscalation(input, options).startsWorkChain
    ? {}
    : { dangerously_disable_wrfc: true, replyStyle: 'conversational' };
}

/** Mark an input's metadata as authorized work. Used by confirmation paths. */
export function markWorkAuthorized(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...(metadata ?? {}), [WORK_AUTHORIZED_METADATA_KEY]: true };
}
