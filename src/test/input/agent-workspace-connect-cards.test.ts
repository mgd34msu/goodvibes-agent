/**
 * W4-A5 dogfood-finding regression test: the "Inbox workflows" and
 * "Calendar workflows" personal-ops cards must be real, dispatchable actions
 * — not the dead kind:'guidance' cards the dogfood audit found (workspace
 * cards implying connect flows that don't exist or dead-end).
 */
import { describe, expect, test } from 'bun:test';
import { AGENT_WORKSPACE_CATEGORIES } from '../../input/agent-workspace-categories.ts';
import { createAgentWorkspaceEditor } from '../../input/agent-workspace-activation.ts';

function findAction(id: string) {
  for (const category of AGENT_WORKSPACE_CATEGORIES) {
    const action = category.actions.find((a) => a.id === id);
    if (action) return action;
  }
  return undefined;
}

describe('W4-A5: inbox/calendar workspace cards are real actions, not dead guidance', () => {
  test('personal-ops-inbox is a real editor action, not kind:guidance', () => {
    const action = findAction('personal-ops-inbox');
    expect(action).toBeDefined();
    expect(action?.kind).toBe('editor');
    expect(action?.editorKind).toBe('email-connect-wizard');
    expect(createAgentWorkspaceEditor(action!.editorKind!)).not.toBeNull();
  });

  test('personal-ops-calendar is the real external-calendar subscribe wizard (W4-A9)', () => {
    const action = findAction('personal-ops-calendar');
    expect(action).toBeDefined();
    expect(action?.kind).toBe('editor');
    expect(action?.editorKind).toBe('calendar-subscribe-wizard');
    expect(createAgentWorkspaceEditor(action!.editorKind!)).not.toBeNull();
  });

  test('the calendar card names the real subscribe mechanism (an iCalendar feed URL), read-only', () => {
    const action = findAction('personal-ops-calendar');
    expect(action?.detail.toLowerCase()).toContain('.ics');
    expect(action?.detail.toLowerCase()).toContain('read-only');
    expect(action?.detail.toLowerCase()).toContain('secret manager');
  });

  test('personal-ops-calendar-add stays a real local add-event editor (W4-A5 preserved)', () => {
    const action = findAction('personal-ops-calendar-add');
    expect(action?.kind).toBe('editor');
    expect(action?.editorKind).toBe('calendar-connect');
    expect(createAgentWorkspaceEditor(action!.editorKind!)).not.toBeNull();
  });

  test('the inbox card names the real, dispatchable mechanism (a connect wizard), not just a description', () => {
    const action = findAction('personal-ops-inbox');
    expect(action?.detail.toLowerCase()).toContain('connect wizard');
  });
});
