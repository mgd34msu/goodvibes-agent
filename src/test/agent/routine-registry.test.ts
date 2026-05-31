import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRoutineRegistry, buildEnabledRoutinesPrompt } from '../../agent/routine-registry.ts';
import { createShellPathService } from '@/runtime/index.ts';

function tempRegistry(): { readonly registry: AgentRoutineRegistry; readonly paths: ReturnType<typeof createShellPathService> } {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-routines-'));
  const paths = createShellPathService({ workingDirectory: root, homeDirectory: root });
  return { registry: AgentRoutineRegistry.fromShellPaths(paths), paths };
}

describe('AgentRoutineRegistry', () => {
  test('creates, enables, starts, reviews, marks stale, and deletes local routines', () => {
    const { registry } = tempRegistry();
    const routine = registry.create({
      name: 'Evening Review',
      description: 'Review open work before shutdown.',
      steps: 'Check work plan, pending approvals, and unresolved reminders. Summarize only.',
      tags: ['daily', 'review', 'daily'],
      triggers: ['evening'],
    });

    expect(routine.id).toBe('evening-review');
    expect(routine.tags).toEqual(['daily', 'review']);
    expect(registry.snapshot().enabledRoutines).toHaveLength(0);

    expect(registry.setEnabled('evening-review', true).enabled).toBe(true);
    expect(registry.snapshot().enabledRoutines).toHaveLength(1);
    const started = registry.markStarted('Evening Review');
    expect(started.startCount).toBe(1);
    expect(started.lastStartedAt).toBeDefined();
    expect(registry.markReviewed('evening-review').reviewState).toBe('reviewed');
    expect(registry.markStale('evening-review', 'Needs reminder coverage.').staleReason).toContain('reminder');
    expect(registry.deleteRoutine('evening-review').id).toBe('evening-review');
    expect(registry.list()).toHaveLength(0);
  });

  test('rejects duplicates and secret-looking routine steps', () => {
    const { registry } = tempRegistry();
    registry.create({
      name: 'Status Sweep',
      description: 'Inspect visible state.',
      steps: 'Read status, work plan, and approvals before responding.',
    });

    expect(() => registry.create({
      name: 'status sweep',
      description: 'Duplicate.',
      steps: 'Duplicate.',
    })).toThrow('Routine already exists');

    expect(() => registry.create({
      name: 'Secret Routine',
      description: 'Invalid.',
      steps: 'api_key=secret-value',
    })).toThrow('secret-looking');
  });

  test('builds enabled routine prompt without background jobs or default knowledge coupling', () => {
    const { registry, paths } = tempRegistry();
    registry.create({
      name: 'Daily Operator Brief',
      description: 'Summarize operator state.',
      steps: 'Use read-only status, work plan, approvals, and Agent Knowledge status before summarizing.',
      triggers: ['daily', 'briefing'],
      enabled: true,
    });

    const prompt = buildEnabledRoutinesPrompt(paths);

    expect(prompt).toContain('Enabled GoodVibes Agent Routines');
    expect(prompt).toContain('Daily Operator Brief');
    expect(prompt).toContain('same serial assistant conversation');
    expect(prompt).toContain('Do not start hidden background jobs');
    expect(prompt).not.toContain('/api/knowledge');
    expect(prompt).not.toContain('non-Agent knowledge fallback');
  });
});
