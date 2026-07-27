/**
 * The Google connection cards.
 *
 * The defect these guard against is the one that produced the whole round: a
 * capability that exists in code but that a person cannot reach. `/google` fixed
 * it for people who type commands; these cards fix it for people who click. So
 * the load-bearing test here is the parity one — every route the command
 * exposes has a card — because that is the assertion that fails if someone adds
 * a seventh subcommand and stops there.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_WORKSPACE_CATEGORIES } from '../../input/agent-workspace-categories.ts';
import { createAgentWorkspaceEditor } from '../../input/agent-workspace-activation.ts';
import { trySubmitDirectHostActionEditor } from '../../input/agent-workspace-direct-editor-submission.ts';
import type { AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from '../../input/agent-workspace-types.ts';

const repoRoot = join(import.meta.dir, '..', '..', '..');

function findAction(id: string) {
  for (const category of AGENT_WORKSPACE_CATEGORIES) {
    const action = category.actions.find((entry) => entry.id === id);
    if (action) return action;
  }
  return undefined;
}

/** Card id -> the `/google` route it is the UI equivalent of. */
const GOOGLE_CARDS = [
  ['personal-ops-google-status', 'google-status', 'status'],
  ['personal-ops-google-app-password', 'google-setup-app-password', 'setup --path app-password'],
  ['personal-ops-google-oauth', 'google-setup-walkthrough', 'setup --path oauth'],
  ['personal-ops-google-adopt', 'google-adopt', 'adopt'],
  ['personal-ops-google-client-file', 'google-client-file', 'client-file'],
  ['personal-ops-google-client-manual', 'google-client-manual', 'client'],
] as const;

/** Cards whose run reaches Google's sign-in wall and therefore stops for a person. */
const BROWSER_CARDS: readonly AgentWorkspaceEditorKind[] = [
  'google-setup-app-password',
  'google-setup-walkthrough',
  'google-client-file',
  'google-client-manual',
];

describe('the Google connection cards', () => {
  test('every route is a real, dispatchable editor card', () => {
    for (const [id, editorKind] of GOOGLE_CARDS) {
      const action = findAction(id);
      expect(action, `missing card ${id}`).toBeDefined();
      expect(action?.kind).toBe('editor');
      expect(action?.editorKind).toBe(editorKind);
      expect(createAgentWorkspaceEditor(editorKind)).not.toBeNull();
    }
  });

  test('the UI covers every intake route the command exposes', () => {
    // Read the command's own declared subcommands rather than a copy of them, so
    // adding a route to /google without adding a card fails here.
    const runtime = readFileSync(join(repoRoot, 'src/input/commands/google-runtime.ts'), 'utf8');
    const argsHint = /argsHint: '([^']+)'/.exec(runtime)?.[1] ?? '';
    const subcommands = argsHint.split('|').map((entry) => entry.trim()).filter(Boolean);
    expect(subcommands.length).toBeGreaterThan(0);

    // `account`, `calendar-address` and `runbook` are inputs to a route rather
    // than routes themselves; the six connection routes are the ones a person
    // picks between, and each has a card.
    const covered = new Set(['account', 'calendar-address', 'runbook']);
    for (const [, , route] of GOOGLE_CARDS) covered.add(route.split(' ')[0] as string);

    for (const sub of subcommands) {
      expect(covered.has(sub), `/google ${sub} has no workspace card`).toBe(true);
    }
  });

  test('every card that opens a browser says the flow pauses for a hand sign-in', () => {
    for (const kind of BROWSER_CARDS) {
      const editor = createAgentWorkspaceEditor(kind);
      const message = (editor?.message ?? '').toLowerCase();
      expect(message, `${kind} does not warn about the pause`).toContain('pause');
      expect(message).toContain('sign in');
    }
  });

  test('the client secret field is redacted and the client id is not', () => {
    const editor = createAgentWorkspaceEditor('google-client-manual');
    const secret = editor?.fields.find((field) => field.id === 'clientSecret');
    const id = editor?.fields.find((field) => field.id === 'clientId');
    expect(secret?.redact).toBe(true);
    expect(id?.redact).not.toBe(true);
  });

  test('the status card is read-only and the flow cards are not', () => {
    expect(findAction('personal-ops-google-status')?.safety).toBe('read-only');
    for (const [id] of GOOGLE_CARDS.filter(([cardId]) => cardId !== 'personal-ops-google-status')) {
      expect(findAction(id)?.safety).toBe('safe');
    }
  });

  test('every Google editor submits as a direct host action, never as a command string', () => {
    // A slash command carrying a client secret would be echoed back into the
    // rendered result. Routing through the direct path is what keeps it out.
    for (const [, editorKind] of GOOGLE_CARDS) {
      const editor = createAgentWorkspaceEditor(editorKind) as AgentWorkspaceLocalEditor;
      const host = { localEditor: null, status: '', lastActionResult: null, runtimeSnapshot: null } as never;
      const handled = trySubmitDirectHostActionEditor(host, editor, null, () => 'yes');
      expect(handled, `${editorKind} fell through to command dispatch`).toBe(true);
    }
  });

  test('a paused setup leads with what needs the person, not with the step log', () => {
    // The result pane cuts from the bottom and has no scroll, so ordering is the
    // only lever: the outstanding step and its fix must come before the verbose
    // transcript, or the part that survives the cut is the part nobody needs.
    const card = readFileSync(join(repoRoot, 'src/input/agent-workspace-google-setup-editor.ts'), 'utf8');
    const detailLine = /detail: \[\.\.\.head, '', \.\.\.transcript, '', renderGoogleSetupReport\(report\)\]/;

    expect(card).toMatch(detailLine);
    expect(card).toContain('Do this: ');
    expect(card).toContain('completed steps are detected and skipped');
    // `head` is built before the detail that consumes it, and names the step.
    expect(card.indexOf('const head =')).toBeLessThan(card.search(detailLine));
  });

  test('both surfaces call one action module rather than each holding a copy', () => {
    const runtime = readFileSync(join(repoRoot, 'src/input/commands/google-runtime.ts'), 'utf8');
    const card = readFileSync(join(repoRoot, 'src/input/agent-workspace-google-setup-editor.ts'), 'utf8');

    for (const source of [runtime, card]) {
      expect(source).toContain('google-connection-actions.ts');
      // The flow is run through the shared helper, not by assembling runners
      // locally — assembling them twice is how the two surfaces would drift.
      expect(source).not.toContain('buildGoogleSetupRunners');
    }
  });
});
