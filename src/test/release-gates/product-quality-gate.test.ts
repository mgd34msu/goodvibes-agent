import { describe, expect, test } from 'bun:test';
import { FEATURE_FLAGS, NotificationRouter, createFeatureFlagManager } from '@/runtime/index.ts';
import type { Notification, NotificationLevel } from '@/runtime/index.ts';

const REQUIRED_PRODUCT_FLAGS = [
  'permissions-policy-engine',
  'permissions-simulation',
  'hitl-ux-modes',
  'session-compaction',
  'tool-result-reconciliation',
  'fetch-sanitization',
  'runtime-tools-budget-enforcement',
  'otel-foundation',
] as const;

function productNotification(domain: string, level: NotificationLevel, timestamp: number): Notification {
  return {
    id: `${domain}-${level}-${timestamp}`,
    domain,
    title: `${domain} ${level}`,
    body: 'test notification',
    level,
    timestamp,
  };
}

describe('product quality gate', () => {
  test('declares the current product flags with valid runtime metadata', () => {
    const ids = FEATURE_FLAGS.map((flag) => flag.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const flag of FEATURE_FLAGS) {
      expect(flag.id).toMatch(/^[a-z0-9-]+$/);
      expect(flag.name.trim()).not.toBe('');
      expect(flag.description.trim()).not.toBe('');
      expect(flag.tier).toBeGreaterThan(0);
      expect(typeof flag.runtimeToggleable).toBe('boolean');
      expect(['enabled', 'disabled', 'killed']).toContain(flag.defaultState);
    }

    for (const id of REQUIRED_PRODUCT_FLAGS) {
      expect(ids).toContain(id);
    }
    expect(FEATURE_FLAGS.find((flag) => flag.id === 'fetch-sanitization')).toMatchObject({
      defaultState: 'disabled',
      runtimeToggleable: true,
      tier: 8,
    });
    expect(FEATURE_FLAGS.find((flag) => flag.id === 'session-compaction')).toMatchObject({
      defaultState: 'disabled',
      runtimeToggleable: true,
      tier: 6,
    });
  });

  test('feature flag manager enforces runtime lifecycle and transition audit behavior', () => {
    const manager = createFeatureFlagManager();
    const events: string[] = [];
    const unsubscribe = manager.subscribe((id, state) => events.push(`${id}:${state}`));

    expect([...manager.getAll().keys()].sort()).toEqual([...FEATURE_FLAGS.map((flag) => flag.id)].sort());
    expect(manager.isEnabled('fetch-sanitization')).toBe(false);

    manager.enable('fetch-sanitization');
    expect(manager.isEnabled('fetch-sanitization')).toBe(true);

    manager.disable('fetch-sanitization');
    expect(manager.isEnabled('fetch-sanitization')).toBe(false);
    expect(manager.getTransitions().map((entry) => `${entry.flagId}:${entry.next}`)).toEqual([
      'fetch-sanitization:enabled',
      'fetch-sanitization:disabled',
    ]);
    expect(events).toEqual(['fetch-sanitization:enabled', 'fetch-sanitization:disabled']);

    manager.kill('fetch-sanitization', 'emergency disable');
    expect(manager.isKilled('fetch-sanitization')).toBe(true);
    expect(() => manager.enable('fetch-sanitization')).toThrow();

    unsubscribe();
  });

  test('notification routing keeps burst noise out of conversation without hiding critical events', () => {
    const router = new NotificationRouter(undefined, true);
    router.setDefaultDomainVerbosity('minimal');
    const base = 1_000_000;
    const decisions = [
      ...Array.from({ length: 20 }, (_, index) => router.route(productNotification('tools', 'critical', base + index))),
      ...Array.from({ length: 50 }, (_, index) => router.route(productNotification('tools', 'info', base + 20 + index))),
      ...Array.from({ length: 30 }, (_, index) => router.route(productNotification('tools', 'warning', base + 70 + index))),
    ];

    expect(decisions.filter((decision) => decision.target === 'conversation')).toHaveLength(20);
    expect(decisions.filter((decision) => decision.target === 'panel_only')).toHaveLength(80);
    expect(decisions.slice(0, 20).map((decision) => decision.reasonCode)).toEqual(Array(20).fill('allowed'));
  });
});
