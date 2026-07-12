import { describe, expect, test } from 'bun:test';
import { FEATURE_SETTINGS, NotificationRouter, createFeatureFlagManager } from '@/runtime/index.ts';
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
  test('declares the current product features with valid settings metadata', () => {
    const ids = FEATURE_SETTINGS.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const feature of FEATURE_SETTINGS) {
      expect(feature.id).toMatch(/^[a-z0-9-]+$/);
      expect(feature.name.trim()).not.toBe('');
      expect(feature.description.trim()).not.toBe('');
      // Every feature lives in a real settings domain, switched by a
      // first-class domain key (the enablement key leads its settings list).
      expect(feature.domain.trim()).not.toBe('');
      expect(feature.enablement.key.startsWith(`${feature.domain}.`)).toBe(true);
      expect(feature.settings[0]).toBe(feature.enablement.key);
      expect(['boolean', 'enum', 'constant']).toContain(feature.enablement.kind);
      expect(typeof feature.restartRequired).toBe('boolean');
      expect(typeof feature.defaultEnabled).toBe('boolean');
    }

    for (const id of REQUIRED_PRODUCT_FLAGS) {
      expect(ids).toContain(id);
    }
    // Default-on posture pins (dissolved feature model): sanitization and
    // compaction ship active with honest off-switch settings keys.
    expect(FEATURE_SETTINGS.find((feature) => feature.id === 'fetch-sanitization')).toMatchObject({
      defaultEnabled: true,
      restartRequired: false,
      domain: 'fetch',
      enablement: { key: 'fetch.sanitizeMode', kind: 'constant' },
    });
    expect(FEATURE_SETTINGS.find((feature) => feature.id === 'session-compaction')).toMatchObject({
      defaultEnabled: true,
      restartRequired: false,
      domain: 'behavior',
      enablement: { key: 'behavior.compactionStrategy', kind: 'enum' },
    });
  });

  test('feature flag manager enforces runtime lifecycle and transition audit behavior', () => {
    const manager = createFeatureFlagManager();
    const events: string[] = [];
    const unsubscribe = manager.subscribe((id, state) => events.push(`${id}:${state}`));

    expect([...manager.getAll().keys()].sort()).toEqual([...FEATURE_SETTINGS.map((feature) => feature.id)].sort());
    // fetch-sanitization defaults ON now (default-on posture).
    expect(manager.isEnabled('fetch-sanitization')).toBe(true);

    manager.disable('fetch-sanitization');
    expect(manager.isEnabled('fetch-sanitization')).toBe(false);

    manager.enable('fetch-sanitization');
    expect(manager.isEnabled('fetch-sanitization')).toBe(true);
    expect(manager.getTransitions().map((entry) => `${entry.flagId}:${entry.next}`)).toEqual([
      'fetch-sanitization:disabled',
      'fetch-sanitization:enabled',
    ]);
    expect(events).toEqual(['fetch-sanitization:disabled', 'fetch-sanitization:enabled']);

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
