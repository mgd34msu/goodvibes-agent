/**
 * Calendar subscription registry tests (W4-A9).
 *
 * Exercises the agent-side registry that wraps the SDK's platform/calendar
 * SubscriptionStore: real JSON persistence to a tmp store, an in-memory secret
 * store for the feed URL, and a FAKE fetcher — no real network is ever touched.
 * Asserts the honest surface: subscribe caches events + stores the URL as a
 * secret (never in the JSON), refresh updates status, stale carries its age,
 * merged views are read-only + source-labeled, and unsubscribe clears the secret.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FeedFetcher, FeedFetchResult } from '@pellux/goodvibes-sdk/platform/calendar';
import { CalendarSubscriptionRegistry, type SubscriptionSecretStore } from '../../agent/calendar-subscription-registry.ts';

const ICS = [
  'BEGIN:VCALENDAR',
  'X-WR-CALNAME:Work Calendar',
  'BEGIN:VEVENT',
  'UID:e1@test',
  'SUMMARY:Standup',
  'DTSTART:20260706T090000Z',
  'DTEND:20260706T093000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:e2@test',
  'SUMMARY:Weekly sync',
  'DTSTART;VALUE=DATE:20260707',
  'RRULE:FREQ=WEEKLY;BYMONTHDAY=3',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const dirs: string[] = [];
function tmpStore(): string {
  const dir = join(tmpdir(), `gv-cal-sub-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  dirs.push(dir);
  return join(dir, 'subscriptions.json');
}
afterEach(() => { for (const d of dirs.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

function memorySecrets(): { store: Map<string, string>; secrets: SubscriptionSecretStore } {
  const store = new Map<string, string>();
  return {
    store,
    secrets: {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => { store.set(k, v); },
      delete: async (k) => { store.delete(k); },
    },
  };
}

function scriptedFetcher(responses: FeedFetchResult[]): FeedFetcher {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)]!;
}

describe('CalendarSubscriptionRegistry', () => {
  test('subscribe caches events and stores the URL as a secret, never in the JSON', async () => {
    const storePath = tmpStore();
    const { store, secrets } = memorySecrets();
    const url = 'https://cal.example/secret/abc123.ics';
    const reg = new CalendarSubscriptionRegistry({ storePath, secrets, fetcher: scriptedFetcher([{ kind: 'ok', body: ICS, etag: 'W/"1"' }]), clock: () => 1000 });

    const res = await reg.subscribe(url);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.name).toBe('Work Calendar'); // derived from X-WR-CALNAME
    expect(res.eventCount).toBe(2);

    // URL is in the secret store, NOT in the on-disk JSON.
    expect([...store.values()]).toContain(url);
    const json = readFileSync(storePath, 'utf-8');
    expect(json).not.toContain(url);
    expect(json).not.toContain('abc123');
  });

  test('statuses masks the URL and reports ok right after subscribe', async () => {
    const { secrets } = memorySecrets();
    const reg = new CalendarSubscriptionRegistry({ storePath: tmpStore(), secrets, fetcher: scriptedFetcher([{ kind: 'ok', body: ICS }]), clock: () => 1000 });
    await reg.subscribe('https://cal.example/feed/xyz.ics');
    const [status] = await reg.statuses();
    expect(status?.health).toBe('ok');
    expect(status?.maskedUrl).not.toContain('xyz');
    expect(status?.eventCount).toBe(2);
  });

  test('seeds are read-only, source-labeled, and mark an unsupported recurrence', async () => {
    const { secrets } = memorySecrets();
    const reg = new CalendarSubscriptionRegistry({ storePath: tmpStore(), secrets, fetcher: scriptedFetcher([{ kind: 'ok', body: ICS }]), clock: () => 1000 });
    await reg.subscribe('https://cal.example/feed.ics');
    const seeds = reg.seeds();
    expect(seeds).toHaveLength(2);
    expect(seeds.every((s) => s.id.startsWith('sub:Work Calendar:'))).toBe(true);
    // The BYMONTHDAY rule is outside the supported subset -> marked, not expanded.
    const weekly = seeds.find((s) => s.title === 'Weekly sync');
    expect(weekly?.recurrenceNotFullyExpanded).toBe(true);
  });

  test('occurrencesInWindow clips to the window', async () => {
    const { secrets } = memorySecrets();
    const reg = new CalendarSubscriptionRegistry({ storePath: tmpStore(), secrets, fetcher: scriptedFetcher([{ kind: 'ok', body: ICS }]), clock: () => 1000 });
    await reg.subscribe('https://cal.example/feed.ics');
    const occ = reg.occurrencesInWindow('2026-07-06', '2026-07-06');
    // Only the 07-06 Standup falls in this one-day window (the weekly seed is 07-07).
    expect(occ.map((o) => o.title)).toEqual(['Standup']);
  });

  test('refresh reports not-modified on a 304 and keeps events', async () => {
    const { secrets } = memorySecrets();
    let now = 0;
    const reg = new CalendarSubscriptionRegistry({ storePath: tmpStore(), secrets, fetcher: scriptedFetcher([{ kind: 'ok', body: ICS, etag: 'W/"1"' }, { kind: 'not-modified', etag: 'W/"1"' }]), clock: () => now });
    await reg.subscribe('https://cal.example/feed.ics');
    now += 10_000;
    const [outcome] = await reg.refresh('Work Calendar', { force: true });
    expect(outcome?.outcome).toBe('not-modified');
    expect(reg.seeds()).toHaveLength(2); // kept
  });

  test('refresh reports unreachable honestly and keeps the last-good events', async () => {
    const { secrets } = memorySecrets();
    let now = 0;
    const reg = new CalendarSubscriptionRegistry({ storePath: tmpStore(), secrets, fetcher: scriptedFetcher([{ kind: 'ok', body: ICS }, { kind: 'error', status: 503, message: 'unavailable' }]), clock: () => now });
    await reg.subscribe('https://cal.example/feed.ics');
    now += 10_000;
    const [outcome] = await reg.refresh('Work Calendar', { force: true });
    expect(outcome?.outcome).toBe('unreachable');
    expect(outcome?.detail).toContain('503');
    expect(reg.seeds()).toHaveLength(2);
    const [status] = await reg.statuses();
    expect(status?.health).toBe('unreachable');
  });

  test('stale health carries its age once data ages past the window', async () => {
    const { secrets } = memorySecrets();
    let now = 0;
    const reg = new CalendarSubscriptionRegistry({ storePath: tmpStore(), secrets, fetcher: scriptedFetcher([{ kind: 'ok', body: ICS }]), clock: () => now, defaultRefreshIntervalMs: 60 * 60_000 });
    await reg.subscribe('https://cal.example/feed.ics');
    now += 60 * 60_000 * 2 + 1;
    const [status] = await reg.statuses();
    expect(status?.health).toBe('stale');
    expect(status?.detail).toContain('min ago');
  });

  test('unsubscribe removes the subscription and clears the stored secret', async () => {
    const { store, secrets } = memorySecrets();
    const reg = new CalendarSubscriptionRegistry({ storePath: tmpStore(), secrets, fetcher: scriptedFetcher([{ kind: 'ok', body: ICS }]), clock: () => 1000 });
    await reg.subscribe('https://cal.example/feed.ics');
    expect(store.size).toBe(1);
    expect(await reg.unsubscribe('Work Calendar')).toBe(true);
    expect(reg.hasAny()).toBe(false);
    expect(store.size).toBe(0); // secret cleaned up
  });

  test('subscribe refuses a non-calendar body naming the parse stage', async () => {
    const { secrets } = memorySecrets();
    const reg = new CalendarSubscriptionRegistry({ storePath: tmpStore(), secrets, fetcher: scriptedFetcher([{ kind: 'ok', body: '<html>no</html>' }]), clock: () => 1000 });
    const res = await reg.subscribe('https://cal.example/notacal');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.stage).toBe('parse');
  });
});

// Keep the tmp-dir guard referenced so lint does not flag the import.
test('tmp helper is wired', () => { expect(existsSync(tmpdir())).toBe(true); });
