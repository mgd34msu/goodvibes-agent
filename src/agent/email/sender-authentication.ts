/**
 * Reading the receiving server's sender-authentication verdict.
 *
 * `Authentication-Results` (RFC 8601) is where a receiving mail server records
 * whether a message travelled the path its domain publishes: DKIM signature,
 * SPF envelope, DMARC alignment. It answers a question about ROUTING.
 *
 * It does not answer whether the message may direct the agent. That is a
 * question about the SURFACE, and email is input-only regardless of how
 * impeccably a message authenticates. Everything here feeds
 * `describeSenderClaim`, whose `commandAuthority` is the literal `'none'` and
 * cannot be anything else. Nothing in this module returns a permission, and
 * nothing downstream may branch on its output to widen one.
 *
 * The top-most-only rule, again
 * ----------------------------
 * A sender can put their own `Authentication-Results:` line in the message
 * they submit. It lands BELOW the one the receiving server prepends, exactly
 * like a forged `Delivered-To`. So only the top-most header is read, and every
 * occurrence after it is discarded rather than searched for a better answer —
 * searching would hand the forgery back the moment a real check said `fail`.
 *
 * This is only as trustworthy as the server that stamped it. Reading Gmail
 * over IMAP, that is Gmail. Pointed at a mail server that stamps nothing, the
 * result is `unverified`, which is the honest answer rather than a default of
 * "fine".
 */

import type { SenderAuthenticationChecks, SenderProtocolResult } from '../untrusted-content.ts';

/** The methods worth surfacing. Others in the header are ignored. */
const METHODS = ['dkim', 'spf', 'dmarc'] as const;

type SenderAuthenticationMethod = (typeof METHODS)[number];

/**
 * Map an RFC 8601 result keyword onto the three outcomes the display layer
 * distinguishes.
 *
 * `softfail`, `permerror` and `policy` are folded into `fail` deliberately:
 * each means the domain's own published policy was not satisfied, and a
 * reader deserves to see that as a failure rather than as an absence. The
 * genuinely-absent cases (`none`, `neutral`, `temperror`) stay `none`, because
 * "we could not tell" must never render as "it passed".
 */
function readResult(keyword: string): SenderProtocolResult {
  const normalized = keyword.trim().toLowerCase();
  if (normalized === 'pass') return 'pass';
  if (normalized === 'fail' || normalized === 'softfail' || normalized === 'permerror' || normalized === 'policy') {
    return 'fail';
  }
  return 'none';
}

/**
 * Parse one `Authentication-Results` value.
 *
 * Tolerant by design: the header is free-form enough in practice that a strict
 * grammar would reject real mail. Anything unrecognised yields no result for
 * that method, which surfaces as `unverified` rather than as a false pass.
 */
export function parseAuthenticationResults(headerValue: string): SenderAuthenticationChecks {
  const checks: {
    dkim?: SenderProtocolResult;
    spf?: SenderProtocolResult;
    dmarc?: SenderProtocolResult;
  } = {};

  if (typeof headerValue !== 'string' || headerValue.trim().length === 0) return checks;

  for (const method of METHODS) {
    // `dkim=pass`, `dkim = pass`, `dkim=pass (good signature)`. The first
    // occurrence of each method wins; a repeated method later in the same
    // header does not get to overwrite it.
    const match = new RegExp(`(?:^|[;\\s])${method}\\s*=\\s*([a-z]+)`, 'i').exec(headerValue);
    if (match?.[1] === undefined) continue;
    checks[method] = readResult(match[1]);
  }

  return checks;
}

/**
 * Parse the top-most `Authentication-Results` header, and only that one.
 *
 * @param headerValues every occurrence in the message, top-most first, exactly
 *   as `ImapEnvelope.authenticationResults` supplies them.
 */
export function readSenderAuthentication(
  headerValues: readonly string[],
): SenderAuthenticationChecks {
  const topMost = headerValues[0];
  return topMost === undefined ? {} : parseAuthenticationResults(topMost);
}

/**
 * True when the receiving server recorded any verdict at all. Used to tell
 * "checked and passed" apart from "nobody checked", which read identically
 * before this existed.
 */
export function hasAnySenderVerdict(checks: SenderAuthenticationChecks): boolean {
  return checks.dkim !== undefined || checks.spf !== undefined || checks.dmarc !== undefined;
}
