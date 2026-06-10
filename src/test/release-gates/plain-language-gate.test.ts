import { describe, expect, test } from 'bun:test';
import { AGENT_WORKSPACE_CATEGORIES } from '../../input/agent-workspace-categories.ts';
import { friendlyToolLabel } from '../../renderer/tool-labels.ts';

/**
 * Plain-language gate — the operator-facing copy must read like a person
 * wrote it for a person. Internal vocabulary (tool syntax, runtime jargon,
 * coding-agent terms) stays on model-facing surfaces, never in labels,
 * summaries, or hints the user reads first.
 *
 * Scope is deliberate: category LABELS and SUMMARIES plus action LABELS are
 * the first-glance copy. Action DETAILS may carry more technical depth, but
 * still must not leak raw runtime jargon (WRFC, daemon, modelRoute).
 */

const FIRST_GLANCE_BANNED: readonly RegExp[] = [
  /\bWRFC\b/,
  /\bdaemon\b/i,
  /\bposture\b/i,
  /\bmodelRoute\b/,
  /\bagent_harness\b/,
  /action:"/,
  /mode:"/,
  /\bcli\b/i,
];

const EVERYWHERE_BANNED: readonly RegExp[] = [
  /\bWRFC\b/,
  /\bmodelRoute\b/,
];

function violations(text: string, rules: readonly RegExp[]): string[] {
  return rules.filter((rule) => rule.test(text)).map((rule) => String(rule));
}

describe('plain-language gate', () => {
  test('workspace category labels and summaries read like plain language', () => {
    const failures: string[] = [];
    for (const category of AGENT_WORKSPACE_CATEGORIES) {
      for (const hit of violations(`${category.label} ${category.summary}`, FIRST_GLANCE_BANNED)) {
        failures.push(`${category.id}: label/summary matches ${hit}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('workspace action labels read like plain language', () => {
    const failures: string[] = [];
    for (const category of AGENT_WORKSPACE_CATEGORIES) {
      for (const action of category.actions) {
        for (const hit of violations(action.label, FIRST_GLANCE_BANNED)) {
          failures.push(`${category.id}/${action.id}: label matches ${hit}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test('workspace action details never leak raw runtime jargon', () => {
    const failures: string[] = [];
    for (const category of AGENT_WORKSPACE_CATEGORIES) {
      for (const action of category.actions) {
        for (const hit of violations(action.detail, EVERYWHERE_BANNED)) {
          failures.push(`${category.id}/${action.id}: detail matches ${hit}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test('home lane details carry no tool syntax at all', () => {
    const home = AGENT_WORKSPACE_CATEGORIES.find((category) => category.id === 'home');
    expect(home).toBeDefined();
    const failures: string[] = [];
    for (const action of home!.actions) {
      for (const hit of violations(`${action.label} ${action.detail}`, FIRST_GLANCE_BANNED)) {
        failures.push(`home/${action.id}: matches ${hit}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('friendly tool labels are human phrases, not identifiers', () => {
    const samples = ['web_search', 'exec', 'personal_ops', 'agent_channel_send', 'agent_harness', 'memory', 'research'];
    for (const name of samples) {
      const label = friendlyToolLabel(name);
      expect(label).not.toMatch(/[_]/);
      expect(label.length).toBeGreaterThan(3);
    }
  });
});
