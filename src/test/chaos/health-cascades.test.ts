/**
 * Chaos: Health cascade simulation.
 *
 * Tests the CascadeEngine under multi-domain failure scenarios:
 * - Recovery-first rules defer cascading when recovery not exhausted
 * - Cascade fires with recoveryExhausted=true when recovery is exhausted
 * - Cascades produce correct effect types per domain rule
 * - Multi-domain failures produce correct combined effect sets
 */

import { describe, test, expect } from 'bun:test';
import { RuntimeHealthAggregator } from '@/runtime/index.ts';
import { CascadeEngine } from '@/runtime/index.ts';
import { CASCADE_RULES } from '@/runtime/index.ts';
import type { HealthDomain } from '@/runtime/index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSystem(recoveryAttempts = 0, maxRecoveryAttempts = 3) {
  const clock = { t: 1000 };
  const aggregator = new RuntimeHealthAggregator(() => clock.t);
  const engine = new CascadeEngine(CASCADE_RULES, aggregator, () => clock.t);

  // Pre-configure recovery attempt counters for domains that need it
  if (recoveryAttempts > 0) {
    for (const domain of ['toolExecution', 'mcp', 'transport', 'compaction', 'turn'] as HealthDomain[]) {
      aggregator.updateDomainHealth(domain, 'unknown', {
        recoveryAttempts,
        maxRecoveryAttempts,
      });
    }
  }

  return { aggregator, engine, clock };
}

type CascadeEvaluation = ReturnType<CascadeEngine['evaluate']>;
type CascadeRecord = CascadeEvaluation['cascades'][number];

function expectCascade(
  cascades: CascadeRecord[],
  ruleId: string,
  label: string,
): CascadeRecord {
  const cascade = cascades.find((entry) => entry.ruleId === ruleId);
  if (cascade === undefined) {
    throw new Error(`Expected ${label} cascade ${ruleId}; got ${cascades.map((entry) => entry.ruleId).join(', ')}`);
  }
  return cascade;
}

// ---------------------------------------------------------------------------
// Recovery-first deferral
// ---------------------------------------------------------------------------

describe('chaos: health cascades', () => {
  describe('recovery-first rules — deferral when recovery not exhausted', () => {
    test('toolExecution failed with recovery not exhausted: cascade deferred', () => {
      const sys = makeSystem(0, 3); // 0 attempts, max 3
      const result = sys.engine.evaluate('toolExecution', 'failed');

      // tool-failed-errors-turn has recoveryFirst: true
      const toolTurnRule = expectCascade(result.pendingRecovery, 'tool-failed-errors-turn', 'pending recovery');
      expect(toolTurnRule.recoveryExhausted).toBe(false);
    });

    test('mcp failed with recovery not exhausted: mcp-tools cascade deferred', () => {
      const sys = makeSystem(0, 3);
      const result = sys.engine.evaluate('mcp', 'failed');

      const mcpRule = expectCascade(result.pendingRecovery, 'mcp-disconnected-blocks-mcp-tools', 'pending recovery');
      expect(mcpRule.recoveryExhausted).toBe(false);
    });

    test('transport failed with recovery not exhausted: remote tasks cascade deferred', () => {
      const sys = makeSystem(0, 3);
      const result = sys.engine.evaluate('transport', 'failed');

      const transportRule = expectCascade(result.pendingRecovery, 'transport-disconnected-blocks-remote-tasks', 'pending recovery');
      expect(transportRule.recoveryExhausted).toBe(false);
    });

    test('compaction failed with recovery not exhausted: new turns cascade deferred', () => {
      const sys = makeSystem(0, 3);
      const result = sys.engine.evaluate('compaction', 'failed');

      const compactionRule = expectCascade(result.pendingRecovery, 'compaction-failed-blocks-new-turns', 'pending recovery');
      expect(compactionRule.recoveryExhausted).toBe(false);
    });
  });

  describe('recovery-first rules — cascade fires when recovery exhausted', () => {
    test('toolExecution failed with exhausted recovery: cascade fires', () => {
      // Set recovery attempts = max (exhausted)
      const sys = makeSystem(3, 3);
      const result = sys.engine.evaluate('toolExecution', 'failed');

      const toolTurnCascade = expectCascade(result.cascades, 'tool-failed-errors-turn', 'exhausted recovery');
      expect(toolTurnCascade.recoveryExhausted).toBe(true);
    });

    test('mcp failed with exhausted recovery: cascade fires', () => {
      const sys = makeSystem(3, 3);
      sys.aggregator.updateDomainHealth('mcp', 'unknown', { recoveryAttempts: 3, maxRecoveryAttempts: 3 });
      const result = sys.engine.evaluate('mcp', 'failed');

      const mcpCascade = expectCascade(result.cascades, 'mcp-disconnected-blocks-mcp-tools', 'exhausted recovery');
      expect(mcpCascade.recoveryExhausted).toBe(true);
    });
  });

  describe('non-recovery-first rules — immediate cascade', () => {
    test('turn failed immediately cancels all in-flight tools', () => {
      const sys = makeSystem();
      const result = sys.engine.evaluate('turn', 'failed');

      const cascade = expectCascade(result.cascades, 'turn-failed-cancels-tools', 'turn failure');
      expect(cascade.effect.type).toBe('CANCEL_INFLIGHT');
      expect(cascade.recoveryExhausted).toBe(false);
    });

    test('agents failed immediately marks child tasks', () => {
      const sys = makeSystem();
      const result = sys.engine.evaluate('agents', 'failed');

      const cascade = expectCascade(result.cascades, 'agent-failed-marks-child-tasks', 'agent failure');
      expect(cascade.effect.type).toBe('MARK_CHILDREN');
    });

    test('plugins failed immediately deregisters tools', () => {
      const sys = makeSystem();
      const result = sys.engine.evaluate('plugins', 'failed', { pluginId: 'bad-plugin' });

      const cascade = expectCascade(result.cascades, 'plugin-error-deregisters-tools', 'plugin failure');
      expect(cascade.effect.type).toBe('DEREGISTER_TOOLS');
      expect(cascade.sourceContext?.pluginId).toBe('bad-plugin');
    });

    test('session failed emits SESSION_UNRECOVERABLE to ALL', () => {
      const sys = makeSystem();
      const result = sys.engine.evaluate('session', 'failed');

      const cascade = expectCascade(result.cascades, 'session-recovery-failed-unrecoverable', 'session failure');
      expect(cascade.effect.type).toBe('EMIT_EVENT');
      if (cascade.effect.type === 'EMIT_EVENT') {
        expect(cascade.effect.eventType).toBe('SESSION_UNRECOVERABLE');
      }
      expect(cascade.target).toBe('ALL');
    });
  });

  describe('multi-domain failure scenarios', () => {
    test('turn + mcp failure: both cascade sets computed independently', () => {
      const sys = makeSystem(3, 3); // recovery exhausted

      const turnResult = sys.engine.evaluate('turn', 'failed');
      const mcpResult = sys.engine.evaluate('mcp', 'failed');

      // turn cascade fires immediately
      expectCascade(turnResult.cascades, 'turn-failed-cancels-tools', 'turn failure');
      // mcp cascade fires (recovery exhausted)
      expectCascade(mcpResult.cascades, 'mcp-disconnected-blocks-mcp-tools', 'mcp failure');
    });

    test('plugins + agents cascade do not interfere', () => {
      const sys = makeSystem();

      const pluginResult = sys.engine.evaluate('plugins', 'failed', { pluginId: 'my-plugin' });
      const agentsResult = sys.engine.evaluate('agents', 'failed');

      const pluginCascade = expectCascade(pluginResult.cascades, 'plugin-error-deregisters-tools', 'plugin failure');
      const agentsCascade = expectCascade(agentsResult.cascades, 'agent-failed-marks-child-tasks', 'agent failure');

      // Contexts don't bleed into each other
      expect(pluginCascade.sourceContext?.pluginId).toBe('my-plugin');
      expect(agentsCascade.sourceContext).toBeUndefined();
    });
  });

  describe('getRulesForDomain', () => {
    test('returns rules matching domain and status', () => {
      const sys = makeSystem();
      const rules = sys.engine.getRulesForDomain('turn', 'failed');
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.source).toBe('turn');
        expect(rule.sourceState).toBe('failed');
      }
    });

    test('returns empty array for domain with no rules', () => {
      const sys = makeSystem();
      // 'model' domain has no cascade rules in the table
      const rules = sys.engine.getRulesForDomain('model', 'failed');
      expect(rules).toHaveLength(0);
    });

    test('returns empty array for healthy status (no rules trigger on healthy)', () => {
      const sys = makeSystem();
      const rules = sys.engine.getRulesForDomain('turn', 'healthy');
      expect(rules).toHaveLength(0);
    });
  });
});
