/**
 * internal-identifier-rule.ts — architecture-gate rule.
 *
 * Bans internal planning identifiers (wave ids, work-order ids, debt-register
 * ids, UX-workstream ids, and lettered finding/brief ids) from appearing
 * anywhere in this repo's tracked text. These are coordination shorthand for
 * planning documents only — the owner's doctrine, quoted verbatim in the
 * failure message below, is that they must never leak into code, comments,
 * docs, or test names. A sweep removed every instance of these patterns from
 * this repo (cross-repo provenance was rewritten as file paths, commit
 * hashes, or plain mechanism descriptions); this rule exists so a new one
 * can never land again without failing the build.
 *
 * Provenance belongs in decision-record paths, source-file paths, commit
 * hashes, or version numbers instead — so this rule exempts docs/releases/**
 * should that directory ever exist here: dated, self-contained historical
 * records, matching the sibling rule in goodvibes-tui this file was ported
 * from (goodvibes-tui/scripts/internal-identifier-rule.ts).
 *
 * Lettered finding/brief ids: a single capital letter in the A-through-E
 * range immediately followed by one or two digits recurs across the
 * platform's review notes as informal finding shorthand — the same
 * coordination-shorthand problem as the wave/work-order ids above, one
 * letter-range narrower. F is deliberately excluded from that range: an
 * F-plus-digits token is a terminal function key, genuine technical
 * vocabulary this repo uses constantly. Only three SHAPES of this letter-
 * plus-digits token are banned, chosen to be safely unambiguous:
 *   1. the token alone, with nothing else, inside a parenthesized aside;
 *   2. a test/describe/it title whose string literal STARTS with the token
 *      immediately followed by a colon or an em-dash;
 *   3. two or more of the tokens chained by forward slashes.
 * Deliberately NOT banned: the bare token with no surrounding delimiter
 * anywhere in running text — that shape has too many genuine technical uses
 * (the ASCII control-character-set names, quoted-printable/MIME
 * transfer-encoding examples, Slack channel ids — which really do start with
 * a bare letter followed by digits in Slack's own API shape — IMAP command
 * tags, and plain short test-fixture names) to ban without an unacceptable
 * false-positive rate.
 *
 * One pattern is this repo's own addition beyond the ported set: a capital W
 * plus one or two digits plus a single capital letter (the lettered-wave
 * shape a sweep here found in comments). Its letter range is A/B/D/E — C is
 * deliberately excluded because a capital W, the digit three, and a capital
 * C spell the web-standards body's own acronym, a genuine technical token.
 */

import { spawnSync } from 'node:child_process';

const OWNER_DOCTRINE =
  'never put wave/work-order/register ids in outward-facing or in-code text; ' +
  'plain language only; provenance via decision-record paths or versions';

const INTERNAL_IDENTIFIER_PATTERNS: readonly RegExp[] = [
  /\bW[0-9]{1,2}\.[0-9]{1,2}\b/g, // wave.item id: a capital W, 1-2 digits, a dot, 1-2 digits
  /\bW[0-9]{1,2}[ABDE]\b/g, // lettered wave id: a capital W, 1-2 digits, one capital letter (C excluded: see the doc comment)
  /\bwo[0-9]{3,4}\b/gi, // numeric work-order id: lowercase "wo" followed by 3-4 digits
  /\bWO-[A-Z]\b/g, // lettered work-order id: "WO-" followed by one capital letter
  /\bWO-[0-9]{2,4}\b/g, // numbered work-order id: "WO-" followed by 2-4 digits
  /\bDEBT-[0-9]+\b/g, // debt-register id: "DEBT-" followed by digits
  /\bSEC-[0-9]+\b/g, // security-review finding id: "SEC-" followed by digits (a sweep here found these cross-referenced through the email client)
  /\bUX-[A-Z]\b/g, // UX-workstream id: "UX-" followed by one capital letter
  /\bWave[- ][0-9]+\b/g, // wave word-form: "Wave" plus a hyphen or space plus digits
  /\bW[0-9]+-R[0-9]+\b/g, // wave-round id: a capital W, digits, a hyphen, capital R, digits
  /\([A-E][0-9]{1,2}\)/g, // a lettered finding id (A-E, one or two digits) alone inside parentheses — F excluded (function keys)
  /\b(?:describe|test|it)\(\s*['"][A-E][0-9]{1,2}\s*(?::|—)/g, // a test/describe/it title starting with a lettered finding id, immediately followed by a colon or an em-dash
  /\b[A-E][0-9]{1,2}(?:\/[A-E][0-9]{1,2}){1,}\b/g, // two or more lettered finding ids chained by forward slashes
];

export interface InternalIdentifierCandidate {
  readonly relPath: string;
  readonly text: string;
}

/**
 * Reviewed exemptions. Everything here is a DELIBERATE, documented decision,
 * not a scan-scope hole — the doctrine ("never put wave/work-order/register
 * ids in outward-facing or in-code text; plain language only; provenance via
 * decision-record paths or versions") names decision-record paths as the one
 * sanctioned home for that shorthand, matching the sibling exemptions in
 * goodvibes-tui (docs/releases/**) and the SDK
 * (goodvibes-sdk/scripts/check-internal-identifiers.ts, docs/decisions/**):
 *
 *  - docs/releases/** — dated, self-contained historical release records,
 *    should that directory ever exist here (ported exemption).
 *  - .goodvibes/audit/** — this repo's dated historical decision records
 *    (audit rulings and parity matrices). They are the provenance the
 *    doctrine points AT, written before the identifier sweep and kept
 *    verbatim on purpose: rewriting a historical record to satisfy a later
 *    rule would falsify it. Reviewed exemption; new coordination shorthand
 *    still cannot land anywhere else under .goodvibes/ (see
 *    listTrackedGoodvibesTextFiles below and the architecture gate).
 */
function isExempt(relPath: string): boolean {
  const normalized = relPath.split('\\').join('/');
  return normalized.startsWith('docs/releases/') || normalized.startsWith('.goodvibes/audit/');
}

/**
 * The tracked text files under `.goodvibes/` the architecture gate must scan.
 *
 * GIT-TRACKED ONLY, deliberately: at runtime this directory also holds
 * machine-local state (control-plane stores, checkpoints, session files) that
 * is untracked, differs per machine, and can legitimately contain arbitrary
 * text — walking the filesystem here would make the gate nondeterministic.
 * `git ls-files` scopes the scan to exactly what the doctrine governs:
 * tracked text. Extensions are limited to the hand-authored text kinds that
 * exist here (.md, .json). The `.goodvibes/audit/` decision records are
 * INCLUDED in this listing and exempted inside checkNoInternalIdentifiers
 * (see isExempt) — one exemption surface, not two.
 *
 * Returns repo-relative paths. A missing git binary or a non-repo root fails
 * loudly: the architecture gate must never silently scan nothing.
 */
export function listTrackedGoodvibesTextFiles(root: string): string[] {
  const result = spawnSync('git', ['-C', root, 'ls-files', '-z', '--', '.goodvibes'], {
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed for ${root}: ${result.stderr || `exit ${result.status}`}`);
  }
  return result.stdout
    .split('\0')
    .filter((path) => path.length > 0)
    .filter((path) => path.endsWith('.md') || path.endsWith('.json'));
}

export function checkNoInternalIdentifiers(
  candidates: readonly InternalIdentifierCandidate[],
): string[] {
  const violations: string[] = [];
  for (const { relPath, text } of candidates) {
    if (isExempt(relPath)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const pattern of INTERNAL_IDENTIFIER_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(line);
        if (match) {
          violations.push(
            `${relPath}:${i + 1}: internal planning identifier "${match[0]}" — ${OWNER_DOCTRINE} [internal-identifier]`,
          );
          break;
        }
      }
    }
  }
  return violations;
}
