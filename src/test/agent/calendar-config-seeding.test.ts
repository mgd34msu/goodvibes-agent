/**
 * calendar-config-seeding.test.ts — the `calendar` config section is seeded
 * before anything writes into it.
 *
 * `calendar` is an app-layer section, not a CONFIG_SCHEMA category, and
 * ConfigManager.resolvePath throws "Invalid config path: section 'calendar'
 * does not exist" for a section that is not on the live config object. A seeder
 * living in one product, while the SDK's own connector writes
 * `calendar.google.clientId` and `calendar.google.clientSecretRef`, is what
 * would confine the connector to that product: everywhere else — the daemon,
 * the TUI, the web UI — the first write throws. So the definition is the SDK's
 * (platform/config/connector-config-sections.ts) and every product calls it.
 *
 * These tests pin the CONTRACT this product depends on — the section name, the
 * exact default shape, idempotence, and that a host with no live config is left
 * alone — against the SDK's implementation. A change on the SDK side that this
 * product's calendar flow could not survive fails here rather than showing up
 * as a calendar that stops resolving.
 */

import { describe, expect, test } from 'bun:test';
import { ensureCalendarConfigDefaults } from '@pellux/goodvibes-sdk/platform/config';

/** The live-config shape a ConfigManager exposes to a seeder. */
function liveConfigHost(initial: Record<string, unknown> = {}): { config: Record<string, unknown> } {
  return { config: initial };
}

describe('calendar config section seeding', () => {
  test('seeds the section with an entry per OAuth provider', () => {
    const host = liveConfigHost();
    ensureCalendarConfigDefaults(host);

    expect(host.config['calendar']).toEqual({
      google: { clientId: '', clientSecretRef: '' },
      microsoft: { clientId: '', clientSecretRef: '' },
    });
  });

  test('the seeded section makes the paths the connector writes resolvable', () => {
    const host = liveConfigHost();
    ensureCalendarConfigDefaults(host);

    // These four are exactly what the SDK connector reaches for; before the
    // seeder ran, resolving any of them threw.
    const calendar = host.config['calendar'] as Record<string, Record<string, unknown>>;
    expect(calendar['google']).toHaveProperty('clientId');
    expect(calendar['google']).toHaveProperty('clientSecretRef');
    expect(calendar['microsoft']).toHaveProperty('clientId');
    expect(calendar['microsoft']).toHaveProperty('clientSecretRef');
  });

  test('an existing section is left exactly as it was', () => {
    const host = liveConfigHost({ calendar: { google: { clientId: 'already-set', clientSecretRef: '' } } });
    ensureCalendarConfigDefaults(host);

    expect(host.config['calendar']).toEqual({ google: { clientId: 'already-set', clientSecretRef: '' } });
  });

  test('calling it repeatedly is safe', () => {
    const host = liveConfigHost();
    ensureCalendarConfigDefaults(host);
    (host.config['calendar'] as Record<string, Record<string, string>>)['google']!['clientId'] = 'set-later';
    ensureCalendarConfigDefaults(host);

    expect((host.config['calendar'] as Record<string, Record<string, string>>)['google']!['clientId']).toBe('set-later');
  });

  test('each call produces its own object rather than a shared default', () => {
    const first = liveConfigHost();
    const second = liveConfigHost();
    ensureCalendarConfigDefaults(first);
    ensureCalendarConfigDefaults(second);

    (first.config['calendar'] as Record<string, Record<string, string>>)['google']!['clientId'] = 'first-only';

    expect((second.config['calendar'] as Record<string, Record<string, string>>)['google']!['clientId']).toBe('');
  });

  test('a host with no live config object is left alone rather than crashing', () => {
    const host = {} as { config?: Record<string, unknown> };
    expect(() => ensureCalendarConfigDefaults(host)).not.toThrow();
    expect(host.config).toBeUndefined();
  });
});
