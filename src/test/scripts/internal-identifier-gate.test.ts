import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkNoInternalIdentifiers, listTrackedGoodvibesTextFiles } from '../../../scripts/internal-identifier-rule.ts';

// Fixture ids below are built via concatenation rather than written as literal
// substrings, so this test file's own source text never contains a real
// internal identifier that this repo's architecture check would flag.
const wave = 'W' + '9.9';
const waveLettered = 'W' + '9' + 'B';
const workOrderNumeric = 'wo' + '999';
const workOrderLettered = 'WO-' + 'Z';
const workOrderNumbered = 'WO-' + '999';
const debtId = 'DEBT-' + '9';
const secId = 'SEC-' + '9';
const uxId = 'UX-' + 'Z';
const waveWord = 'Wave' + ' 9';
const waveRound = 'W9-' + 'R2';
const findingParen = '(' + 'C6' + ')';
const findingTitleId = 'D1';
const findingChain = 'C2' + '/' + 'C6';

describe('checkNoInternalIdentifiers', () => {
  test('passes plain-language text with no internal identifiers', () => {
    const violations = checkNoInternalIdentifiers([
      { relPath: 'src/runtime/example.ts', text: '// ported from goodvibes-tui core/focus-tracker.ts in a prior cleanup' },
    ]);
    expect(violations).toEqual([]);
  });

  test('fails on a wave.item id, quoting the owner doctrine', () => {
    const violations = checkNoInternalIdentifiers([
      { relPath: 'src/runtime/example.ts', text: `// spine mirror removed in ${wave}` },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('src/runtime/example.ts:1');
    expect(violations[0]).toContain(wave);
    expect(violations[0]).toContain('never put wave/work-order/register ids in outward-facing or in-code text');
    expect(violations[0]).toContain('[internal-identifier]');
  });

  test('fails on a lettered wave id (capital W, digits, one capital letter)', () => {
    const violations = checkNoInternalIdentifiers([
      { relPath: 'src/runtime/example.ts', text: `// ${waveLettered}: mirror the create into the daemon spine` },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(waveLettered);
  });

  test('fails on a numeric work-order id', () => {
    const violations = checkNoInternalIdentifiers([
      { relPath: 'src/runtime/example.ts', text: `// landed on SDK main as ${workOrderNumeric}` },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(workOrderNumeric);
  });

  test('fails on a lettered and a numbered work-order id', () => {
    const lettered = checkNoInternalIdentifiers([
      { relPath: 'src/tools/example.ts', text: `// Group A (${workOrderLettered}) providers subset` },
    ]);
    expect(lettered).toHaveLength(1);
    expect(lettered[0]).toContain(workOrderLettered);

    const numbered = checkNoInternalIdentifiers([
      { relPath: 'scripts/example-rule.ts', text: `// ${workOrderNumbered} architecture-gate rule` },
    ]);
    expect(numbered).toHaveLength(1);
    expect(numbered[0]).toContain(workOrderNumbered);
  });

  test('fails on a debt-register id, a security-review finding id, and a UX-workstream id', () => {
    const debt = checkNoInternalIdentifiers([
      { relPath: 'src/input/example.ts', text: `// this is ${debtId}'s design` },
    ]);
    expect(debt).toHaveLength(1);
    expect(debt[0]).toContain(debtId);

    const sec = checkNoInternalIdentifiers([
      { relPath: 'src/agent/email/example.ts', text: `// ${secId}: cap server-supplied literal size` },
    ]);
    expect(sec).toHaveLength(1);
    expect(sec[0]).toContain(secId);

    const ux = checkNoInternalIdentifiers([
      { relPath: 'src/input/example.ts', text: `// this is ${uxId}'s design` },
    ]);
    expect(ux).toHaveLength(1);
    expect(ux[0]).toContain(uxId);
  });

  test('fails on wave word-forms and wave-round ids', () => {
    const waveWordViolations = checkNoInternalIdentifiers([
      { relPath: 'scripts/example.ts', text: `// consolidated by ${waveWord} tooling` },
    ]);
    expect(waveWordViolations).toHaveLength(1);
    expect(waveWordViolations[0]).toContain(waveWord);

    const waveRoundViolations = checkNoInternalIdentifiers([
      { relPath: 'docs/example.md', text: `Scope: ${waveRound} (scheduled removal)` },
    ]);
    expect(waveRoundViolations).toHaveLength(1);
    expect(waveRoundViolations[0]).toContain(waveRound);
  });

  test('reports one violation per offending line, not per file', () => {
    const violations = checkNoInternalIdentifiers([
      {
        relPath: 'src/runtime/example.ts',
        text: `// first line mentions ${wave}\n// second line is clean\n// third line mentions ${debtId}`,
      },
    ]);
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain(':1:');
    expect(violations[1]).toContain(':3:');
  });

  test('exempts docs/releases/** as dated historical records', () => {
    const violations = checkNoInternalIdentifiers([
      { relPath: 'docs/releases/1.9.1.md', text: `### Render coalescing, landed in ${waveWord}` },
    ]);
    expect(violations).toEqual([]);
  });

  test('exempts .goodvibes/audit/** decision records, but flags every other .goodvibes/ path', () => {
    // The audit decision records are the documented reviewed exemption
    // (historical provenance, kept verbatim on purpose)...
    const exempt = checkNoInternalIdentifiers([
      { relPath: '.goodvibes/audit/2026-07-05-release-train-audit.md', text: `Scope: ${waveRound} (historical ruling)` },
      { relPath: '.goodvibes/audit/2026-07-05-renderer-parity-matrix.json', text: `{"note":"${workOrderNumeric}"}` },
    ]);
    expect(exempt).toEqual([]);

    // ...and the exemption is exactly that directory, never the rest of
    // .goodvibes/ — a new identifier anywhere else there fails.
    const flagged = checkNoInternalIdentifiers([
      { relPath: '.goodvibes/GOODVIBES.md', text: `installed by ${workOrderNumeric}` },
      { relPath: '.goodvibes/skills/example/SKILL.md', text: `- step 3 came from ${wave}` },
      { relPath: '.goodvibes/agents/reviewer.md', text: `review per ${debtId}` },
    ]);
    expect(flagged).toHaveLength(3);
    expect(flagged[0]).toContain('.goodvibes/GOODVIBES.md:1');
    expect(flagged[0]).toContain('never put wave/work-order/register ids in outward-facing or in-code text');
  });

  test('does not flag the F2 keyboard key or unrelated short tokens', () => {
    const violations = checkNoInternalIdentifiers([
      { relPath: 'src/input/example-shortcuts.ts', text: "if (token.logicalName === 'f2') { openProcessModal(); }" },
    ]);
    expect(violations).toEqual([]);
  });

  test('does not flag the web-standards body acronym (the lettered-wave range excludes that letter)', () => {
    const violations = checkNoInternalIdentifiers([
      { relPath: 'docs/example.md', text: 'The W3C trace-context header propagates across daemon calls.' },
    ]);
    expect(violations).toEqual([]);
  });

  // Lettered finding/brief ids (A-E + 1-2 digits). Only three shapes are
  // banned; see the rule file's own doc comment for why the bare-token shape
  // stays legal.
  describe('lettered finding ids (A-E + digits)', () => {
    test('fails when the id sits alone inside parentheses', () => {
      const violations = checkNoInternalIdentifiers([
        { relPath: 'src/runtime/example.ts', text: `// Agent transcript ${findingParen}` },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain(findingParen);
      expect(violations[0]).toContain('never put wave/work-order/register ids in outward-facing or in-code text');
    });

    test('fails when a test/describe/it title starts with the id followed by a colon', () => {
      const violations = checkNoInternalIdentifiers([
        { relPath: 'src/test/example.test.ts', text: `describe('${findingTitleId}: status honestly says auto-approve is on', () => {` },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('[internal-identifier]');
    });

    test('fails when a test/describe/it title starts with the id followed by an em-dash', () => {
      const violations = checkNoInternalIdentifiers([
        { relPath: 'src/test/example.test.ts', text: `test('${findingTitleId} — offline within one probe interval', () => {` },
      ]);
      expect(violations).toHaveLength(1);
    });

    test('fails on a slash-chain of two ids', () => {
      const violations = checkNoInternalIdentifiers([
        { relPath: 'src/runtime/example.ts', text: `// summary has no single conversation (${findingChain})` },
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain(findingChain);
    });

    test('does NOT flag a bare id with no delimiter — the shape stays legal (control-character sets, Slack channel ids, IMAP tags, quoted-printable)', () => {
      const violations = checkNoInternalIdentifiers([
        { relPath: 'src/core/example.ts', text: '// C0 control characters (0x00-0x1f) and DEL (0x7f).' },
        { relPath: 'src/agent/email/example.ts', text: '// CR, LF, and the other C0 and C1 control characters.' },
        { relPath: 'src/test/example.test.ts', text: "expect(routeId).toBe('C1');" },
        { relPath: 'src/test/example.test.ts', text: "expect(socket.writes[0]).toBe('A1 LOGIN\\r\\n');" },
        { relPath: 'src/agent/email/example.ts', text: '// a single `=C3=A9` pair must decode to one UTF-8 character' },
      ]);
      expect(violations).toEqual([]);
    });

    test('does NOT flag a title where the id is not at the very start of the string', () => {
      const violations = checkNoInternalIdentifiers([
        { relPath: 'src/test/example.test.ts', text: "test('a middle-of-sentence C6 reference is not the banned shape', () => {" },
      ]);
      expect(violations).toEqual([]);
    });
  });
});

// The architecture gate's .goodvibes/ scan, proven through the REAL pipeline
// (git ls-files listing + the rule) against a seeded temp repo — a red-test
// that a violation in a non-exempt tracked .goodvibes/ file fails the build,
// while the audit decision records stay a documented reviewed exemption and
// untracked machine-local runtime state is never scanned at all.
describe('listTrackedGoodvibesTextFiles + gate pipeline over .goodvibes/', () => {
  function seedRepo(): string {
    const root = mkdtempSync(join(tmpdir(), 'gv-agent-identifier-gate-'));
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
    git('init', '--quiet');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    mkdirSync(join(root, '.goodvibes', 'audit'), { recursive: true });
    mkdirSync(join(root, '.goodvibes', 'skills'), { recursive: true });
    // A seeded violation in a NON-exempt tracked .goodvibes file...
    writeFileSync(join(root, '.goodvibes', 'skills', 'notes.md'), `- follow-up captured as ${workOrderNumeric}\n`);
    // ...an exempt audit decision record carrying the same class of token...
    writeFileSync(join(root, '.goodvibes', 'audit', '2026-01-01-ruling.md'), `Historical scope: ${waveRound}\n`);
    // ...an untracked runtime-state file that must never be scanned...
    writeFileSync(join(root, '.goodvibes', 'untracked-runtime-state.json'), `{"note":"${workOrderNumeric}"}\n`);
    // ...and a tracked non-text file the extension filter must skip.
    writeFileSync(join(root, '.goodvibes', 'skills', 'asset.bin'), 'binary-ish');
    git('add', '.goodvibes/skills/notes.md', '.goodvibes/audit/2026-01-01-ruling.md', '.goodvibes/skills/asset.bin');
    git('commit', '--quiet', '-m', 'seed');
    return root;
  }

  test('a seeded violation in a non-exempt tracked .goodvibes file fails; audit records and untracked state do not', () => {
    const root = seedRepo();
    try {
      const files = listTrackedGoodvibesTextFiles(root);
      // Tracked text only: the untracked runtime-state json and the non-text
      // asset are absent; the audit record IS listed (exemption lives in the
      // rule, not the listing).
      expect(files.sort()).toEqual(['.goodvibes/audit/2026-01-01-ruling.md', '.goodvibes/skills/notes.md']);

      const violations = checkNoInternalIdentifiers(
        files.map((relPath) => ({ relPath, text: readFileSync(join(root, relPath), 'utf-8') })),
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('.goodvibes/skills/notes.md:1');
      expect(violations[0]).toContain(workOrderNumeric);
      expect(violations[0]).toContain('never put wave/work-order/register ids in outward-facing or in-code text');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a non-repo root fails loudly instead of silently scanning nothing', () => {
    // NOT under tmpdir(): the suite runner points TMPDIR inside this repo, so
    // a tmpdir()-based directory would still resolve to a git repo by walking
    // up and the "non-repo" premise would silently not hold. /tmp itself is
    // never inside a repo on the POSIX platforms this suite runs on.
    const root = mkdtempSync('/tmp/gv-agent-identifier-gate-norepo-');
    try {
      expect(() => listTrackedGoodvibesTextFiles(root)).toThrow(/git ls-files failed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('this repo itself: audit decision records are listed for the scan and are the only .goodvibes files carrying legacy tokens', () => {
    const repoRoot = join(import.meta.dir, '../../..');
    const files = listTrackedGoodvibesTextFiles(repoRoot);
    // The four historical audit records are tracked and scanned-but-exempt.
    expect(files.filter((f) => f.startsWith('.goodvibes/audit/')).length).toBeGreaterThanOrEqual(4);
    // The real gate input over the real repo yields zero violations — the
    // audit exemption covers exactly the files that need it.
    const violations = checkNoInternalIdentifiers(
      files.map((relPath) => ({ relPath, text: readFileSync(join(repoRoot, relPath), 'utf-8') })),
    );
    expect(violations).toEqual([]);
  });
});
