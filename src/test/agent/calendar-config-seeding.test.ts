/**
 * calendar-config-seeding.test.ts, the `calendar` config section is seeded
 * before anything writes into it.
 *
 * `calendar` is a real CONFIG_SCHEMA category as of platform 2.0.8
 * (schema-domain-connectors.ts), with real defaults in `DEFAULT_CONFIG`, so a
 * ConfigManager built the normal way already carries the section and this
 * seeder is a no-op against it. The seeder stays as the backstop for a config
 * object assembled some OTHER way, a hand-built test fixture, a cached
 * snapshot written before the schema migration shipped, where the section can
 * still be genuinely absent and `ConfigManager.resolvePath` would otherwise
 * throw "Invalid config path: section 'calendar' does not exist" on the
 * connector's first read or write. The definition is the SDK's
 * (platform/config/connector-config-sections.ts) and every product calls it, so
 * a capability configured from any surface stays usable everywhere.
 *
 * These tests pin the CONTRACT this product depends on, the section name, the
 * exact default shape (which must agree with the schema's own
 * CALENDAR_CONNECTOR_DEFAULTS, `calendar.google.icsUrl` included), idempotence,
 * and that a host with no live config is left alone, against the SDK's
 * implementation. A change on the SDK side that this product's calendar flow
 * could not survive fails here rather than showing up as a calendar that stops
 * resolving.
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
      google: { clientId: '', clientSecretRef: '', icsUrl: '' },
      microsoft: { clientId: '', clientSecretRef: '' },
    });
  });

  test('the seeded section makes the paths the connector writes resolvable', () => {
    const host = liveConfigHost();
    ensureCalendarConfigDefaults(host);

    // These five are exactly what the SDK connector reaches for; against a
    // config object built without DEFAULT_CONFIG, resolving any of them threw
    // before the seeder ran.
    const calendar = host.config['calendar'] as Record<string, Record<string, unknown>>;
    expect(calendar['google']).toHaveProperty('clientId');
    expect(calendar['google']).toHaveProperty('clientSecretRef');
    expect(calendar['google']).toHaveProperty('icsUrl');
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
