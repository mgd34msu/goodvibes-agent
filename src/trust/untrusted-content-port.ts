/**
 * untrusted-content-port.ts — the agent's side of the platform browser's
 * untrusted-content contract.
 *
 * `BrowserEngine` moved into the SDK, and it takes its untrusted-content
 * contract as a REQUIRED injected port (`UntrustedContentPort`) rather than
 * reaching for a product's module. That is the right shape: the wording of a
 * trust boundary and the ledger it writes to belong to the surface that has to
 * render and enforce them, and a second copy inside the SDK would drift from
 * this one. It is also why the port is required rather than defaulted — an
 * engine constructed with no port would read pages and label nothing, which is
 * the boundary silently absent instead of a compile error.
 *
 * This module is that port, backed by the agent's own process-wide ledger
 * (`getSessionUntrustedContentLedger`). Sharing the one ledger is the whole
 * point: the browser reads web pages and the email surface reads message
 * bodies, and both write here, so "read a stranger's page, then send mail" is
 * visible to the outward-effect guard as ONE composition rather than two
 * unrelated acts.
 *
 * Nothing here re-implements a decision. `label`, `originOf` and
 * `evaluateOutwardEffect` all delegate to untrusted-content.ts, so the rule
 * text and the refusal wording have exactly one home.
 */

import type { UntrustedContentPort } from '@pellux/goodvibes-sdk/platform/browser';
import {
  evaluateOutwardEffect,
  getSessionUntrustedContentLedger,
  labelUntrustedContent,
  originOf,
  UNTRUSTED_CONTENT_RULE,
  type UntrustedContentLedger,
} from './untrusted-content.ts';

export interface AgentUntrustedContentPortOptions {
  /**
   * The ledger this port records into. Defaults to the process-wide session
   * ledger, which is what production wants; tests pass their own so one test's
   * page read cannot make the next test's outward action refuse.
   */
  readonly ledger?: UntrustedContentLedger;
  /** Clock seam, so envelope timestamps are assertable. */
  readonly now?: () => Date;
}

/**
 * The agent's `UntrustedContentPort`, for handing to `new BrowserEngine(...)`.
 *
 * The `surface` on every envelope is `'web-page'`: this port exists to serve
 * the browser, and mislabelling a page as some other surface would put the
 * wrong provenance in front of the reader.
 */
export function createAgentUntrustedContentPort(
  options: AgentUntrustedContentPortOptions = {},
): UntrustedContentPort {
  const ledger = options.ledger ?? getSessionUntrustedContentLedger();
  return {
    rule: UNTRUSTED_CONTENT_RULE,
    originOf,
    label: (input) =>
      labelUntrustedContent({
        surface: 'web-page',
        origin: input.origin,
        text: input.text,
        ...(input.truncated === undefined ? {} : { truncated: input.truncated }),
        ...(options.now ? { now: options.now } : {}),
      }),
    recordIngest: (input) => {
      ledger.record({ surface: 'web-page', origin: input.origin, at: input.at });
    },
    evaluateOutwardEffect: (input) =>
      evaluateOutwardEffect({
        request: {
          toolName: 'browser',
          action: input.action,
          description: input.description,
        },
        ledger,
        approval: input.approval,
      }),
  };
}
