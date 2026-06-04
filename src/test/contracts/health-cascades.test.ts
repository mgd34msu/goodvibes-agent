import { describe, test, expect } from 'bun:test';
import { RuntimeHealthAggregator } from '@/runtime/index.ts';
import { CascadeEngine } from '@/runtime/index.ts';
import { CASCADE_RULES } from '@/runtime/index.ts';
import type { HealthDomain, HealthStatus } from '@/runtime/index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAggregator(clock?: () => number): RuntimeHealthAggregator {
  return new RuntimeHealthAggregator(clock ?? (() => 1000));
}

function makeEngine(aggregator: RuntimeHealthAggregator): CascadeEngine {
  return new CascadeEngine(CASCADE_RULES, aggregator);
}

// ---------------------------------------------------------------------------
// RuntimeHealthAggregator tests
// ---------------------------------------------------------------------------

describe('health-cascades contract', () => {
  describe('RuntimeHealthAggregator', () => {
    test('all domains initialize as unknown', () => {
      const agg = makeAggregator();
      const composite = agg.getCompositeHealth();

      expect(composite.overall).toBe('unknown');
      expect(composite.failedDomains).toHaveLength(0);
      expect(composite.degradedDomains).toHaveLength(0);
    });

    test('composite health is failed when any domain fails', () => {
      const agg = makeAggregator();
      agg.updateDomainHealth('turn', 'failed');

      const composite = agg.getCompositeHealth();
      expect(composite.overall).toBe('failed');
      expect(composite.failedDomains).toContain('turn');
    });

    test('composite health is degraded when a domain is degraded but none failed', () => {
      const agg = makeAggregator();
      agg.updateDomainHealth('mcp', 'healthy');
      agg.updateDomainHealth('turn', 'degraded');

      const composite = agg.getCompositeHealth();
      expect(composite.overall).toBe('degraded');
      expect(composite.degradedDomains).toContain('turn');
    });

    test('getDomainHealth always returns a record', () => {
      const agg = makeAggregator();
      const health = agg.getDomainHealth('turn');

      expect(health.domain).toBe('turn');
      expect(typeof health.status).toBe('string');
      expect(typeof health.recoveryAttempts).toBe('number');
      expect(typeof health.maxRecoveryAttempts).toBe('number');
    });

    test('canExecute returns allowed for healthy domain', () => {
      const agg = makeAggregator();
      agg.updateDomainHealth('tasks', 'healthy');

      const result = agg.canExecute('tasks');
      expect(result.allowed).toBe(true);
    });

    test('canExecute returns not allowed for failed domain', () => {
      const agg = makeAggregator();
      agg.updateDomainHealth('toolExecution', 'failed', { failureReason: 'Tool dispatch crashed' });

      const result = agg.canExecute('toolExecution');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Tool dispatch crashed');
    });

    test('subscriber is notified on health change', () => {
      const agg = makeAggregator();
      const notifications: HealthStatus[] = [];

      agg.subscribe((composite) => notifications.push(composite.overall));
      agg.updateDomainHealth('session', 'healthy');
      agg.updateDomainHealth('session', 'degraded');

      expect(notifications.length).toBeGreaterThanOrEqual(2);
    });

    test('unsubscribe stops notifications', () => {
      const agg = makeAggregator();
      const notifications: number[] = [];

      const unsub = agg.subscribe(() => notifications.push(1));
      agg.updateDomainHealth('turn', 'healthy');
      unsub();
      agg.updateDomainHealth('turn', 'failed');

      expect(notifications).toHaveLength(1);
    });
  });

  describe('CascadeEngine — all 8 rules fire for correct domain+state', () => {
    test('turn:failed fires turn-failed-cancels-tools', () => {
      const agg = makeAggregator();
      const engine = makeEngine(agg);

      const result = engine.evaluate('turn', 'failed');
      const ruleIds = result.cascades.map((c) => c.ruleId);

      expect(ruleIds).toContain('turn-failed-cancels-tools');
    });

    test('toolExecution:failed fires tool-failed-errors-turn (with recoveryFirst)', () => {
      const agg = makeAggregator();
      // Exhaust recovery attempts so it cascades immediately
      agg.updateDomainHealth('toolExecution', 'failed', { recoveryAttempts: 3, maxRecoveryAttempts: 3 });
      const engine = makeEngine(agg);

      const result = engine.evaluate('toolExecution', 'failed');
      const ruleIds = result.cascades.map((c) => c.ruleId);

      expect(ruleIds).toContain('tool-failed-errors-turn');
    });

    test('mcp:failed fires mcp-disconnected-blocks-mcp-tools (pending recovery when not exhausted)', () => {
      const agg = makeAggregator();
      // Recovery NOT exhausted (0 of 3)
      agg.updateDomainHealth('mcp', 'failed', { recoveryAttempts: 0, maxRecoveryAttempts: 3 });
      const engine = makeEngine(agg);

      const result = engine.evaluate('mcp', 'failed');
      const pendingIds = result.pendingRecovery.map((c) => c.ruleId);

      expect(pendingIds).toContain('mcp-disconnected-blocks-mcp-tools');
    });

    test('agents:failed fires agent-failed-marks-child-tasks', () => {
      const agg = makeAggregator();
      const engine = makeEngine(agg);

      const result = engine.evaluate('agents', 'failed');
      const ruleIds = result.cascades.map((c) => c.ruleId);

      expect(ruleIds).toContain('agent-failed-marks-child-tasks');
    });

    test('plugins:failed fires plugin-error-deregisters-tools', () => {
      const agg = makeAggregator();
      const engine = makeEngine(agg);

      const result = engine.evaluate('plugins', 'failed');
      const ruleIds = result.cascades.map((c) => c.ruleId);

      expect(ruleIds).toContain('plugin-error-deregisters-tools');
    });

    test('transport:failed fires transport-disconnected-blocks-remote-tasks (pending recovery when not exhausted)', () => {
      const agg = makeAggregator();
      agg.updateDomainHealth('transport', 'failed', { recoveryAttempts: 0, maxRecoveryAttempts: 3 });
      const engine = makeEngine(agg);

      const result = engine.evaluate('transport', 'failed');
      const pendingIds = result.pendingRecovery.map((c) => c.ruleId);

      expect(pendingIds).toContain('transport-disconnected-blocks-remote-tasks');
    });

    test('session:failed fires session-recovery-failed-unrecoverable', () => {
      const agg = makeAggregator();
      const engine = makeEngine(agg);

      const result = engine.evaluate('session', 'failed');
      const ruleIds = result.cascades.map((c) => c.ruleId);

      expect(ruleIds).toContain('session-recovery-failed-unrecoverable');
    });

    test('compaction:failed fires compaction-failed-blocks-new-turns (pending when not exhausted)', () => {
      const agg = makeAggregator();
      agg.updateDomainHealth('compaction', 'failed', { recoveryAttempts: 0, maxRecoveryAttempts: 3 });
      const engine = makeEngine(agg);

      const result = engine.evaluate('compaction', 'failed');
      const pendingIds = result.pendingRecovery.map((c) => c.ruleId);

      expect(pendingIds).toContain('compaction-failed-blocks-new-turns');
    });
  });

  describe('CascadeEngine.evaluate result structure', () => {
    test('turn failure cascades immediately and leaves no pending recovery', () => {
      const agg = makeAggregator();
      const engine = makeEngine(agg);

      const result = engine.evaluate('turn', 'failed');

      expect(result.cascades.map((cascade) => cascade.ruleId)).toEqual(['turn-failed-cancels-tools']);
      expect(result.pendingRecovery).toEqual([]);
    });

    test('agent failure cascade carries task-marking effect metadata', () => {
      const agg = makeAggregator();
      const engine = makeEngine(agg);

      const result = engine.evaluate('agents', 'failed');
      expect(result.cascades).toEqual([
        expect.objectContaining({
          ruleId: 'agent-failed-marks-child-tasks',
          source: 'agents',
          target: 'tasks',
          recoveryExhausted: false,
          effect: { type: 'MARK_CHILDREN', status: 'failed', notifyParent: true },
        }),
      ]);
      expect(result.cascades[0].timestamp).toBeGreaterThan(0);
    });

    test('recovery-first rules produce pendingRecovery when recovery not exhausted', () => {
      const agg = makeAggregator();
      // 0 attempts out of 3 max — recovery not exhausted
      agg.updateDomainHealth('toolExecution', 'failed', { recoveryAttempts: 0, maxRecoveryAttempts: 3 });
      const engine = makeEngine(agg);

      const result = engine.evaluate('toolExecution', 'failed');
      const pending = result.pendingRecovery.find((r) => r.ruleId === 'tool-failed-errors-turn');

      expect(pending).toEqual(expect.objectContaining({
        ruleId: 'tool-failed-errors-turn',
        recoveryExhausted: false,
      }));
    });

    test('recovery-first rules cascade when recovery is exhausted', () => {
      const agg = makeAggregator();
      // Exhausted — 3 attempts out of 3
      agg.updateDomainHealth('toolExecution', 'failed', { recoveryAttempts: 3, maxRecoveryAttempts: 3 });
      const engine = makeEngine(agg);

      const result = engine.evaluate('toolExecution', 'failed');
      const cascade = result.cascades.find((r) => r.ruleId === 'tool-failed-errors-turn');

      expect(cascade).toEqual(expect.objectContaining({
        ruleId: 'tool-failed-errors-turn',
        recoveryExhausted: true,
      }));
    });

    test('sourceContext is propagated into CascadeResult', () => {
      const agg = makeAggregator();
      const engine = makeEngine(agg);
      const ctx = { pluginId: 'my-plugin' };

      const result = engine.evaluate('plugins', 'failed', ctx);
      expect(result.cascades.map((cascade) => cascade.ruleId)).toEqual(['plugin-error-deregisters-tools']);
      expect(result.cascades[0].sourceContext).toEqual(ctx);
    });
  });

  describe('getRulesForDomain', () => {
    test('returns rules matching domain and state', () => {
      const agg = makeAggregator();
      const engine = makeEngine(agg);

      const rules = engine.getRulesForDomain('turn', 'failed');
      expect(rules.map((rule) => rule.id)).toEqual(['turn-failed-cancels-tools']);
      for (const rule of rules) {
        expect(rule.source).toBe('turn');
        expect(rule.sourceState).toBe('failed');
      }
    });

    test('returns empty array for domains with no matching rules', () => {
      const agg = makeAggregator();
      const engine = makeEngine(agg);

      // 'telemetry' has no cascade rules defined
      const rules = engine.getRulesForDomain('telemetry' as HealthDomain, 'failed');
      expect(rules).toHaveLength(0);
    });
  });
});
