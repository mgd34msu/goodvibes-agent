import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ShellPathService } from '@/runtime/index.ts';
import {
  SubscriptionStore,
  expandEvent,
  maskFeedUrl,
  DEFAULT_REFRESH_INTERVAL_MS,
  type CalendarEvent,
  type FeedFetcher,
  type SubscriptionHealth,
} from '@pellux/goodvibes-sdk/platform/calendar';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';

/**
 * Agent-side registry for READ-ONLY external calendar SUBSCRIPTIONS (iCalendar
 * feeds — Google "secret address", Outlook published .ics, or any .ics URL).
 *
 * The parse/RRULE/fetch-status engine is the SDK's `platform/calendar`
 * (SubscriptionStore + expandEvent). This class owns the two things the SDK
 * deliberately leaves to the consumer:
 *  - PERSISTENCE. Feed events are cached to a JSON store next to the local
 *    calendar so `/calendar list` merges them with no network call; subscription
 *    metadata (name, cadence, validators, last-status) lives there too.
 *  - SECRET STORAGE. The feed URL is secrets-adjacent (a Google secret address
 *    grants read access to the calendar), so it is stored ONLY through the
 *    SecretsManager under a per-subscription key; the JSON store holds the secret
 *    KEY, never the URL. `maskFeedUrl` is used anywhere a URL would be shown.
 *
 * Consent = subscribing. Nothing here fetches a URL the user did not explicitly
 * add. The subscribe verb states what will be fetched and how often before saving.
 *
 * Subscribed events are READ-ONLY: they carry a `sub:<name>:` id namespace so the
 * local-store edit/delete paths can refuse them with a plain reason.
 */

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

/** The SDK CalendarEvent as cached on disk (structurally identical; JSON-safe). */
export type CachedFeedEvent = CalendarEvent;

interface SubscriptionMeta {
  readonly name: string;
  /** SecretsManager key holding the feed URL. */
  readonly secretKey: string;
  readonly refreshIntervalMs: number;
  readonly lastFetchedAt?: number;
  readonly lastSucceededAt?: number;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly lastResult?: 'ok' | 'not-modified' | 'unreachable' | 'parse-error';
  readonly lastDetail?: string;
  readonly eventCount?: number;
  readonly events: readonly CachedFeedEvent[];
}

interface SubscriptionStoreFile {
  readonly version: 1;
  readonly subscriptions: readonly SubscriptionMeta[];
}

/** A subscription's status as shown by `/calendar subscriptions`. */
export interface SubscriptionStatus {
  readonly name: string;
  readonly maskedUrl: string;
  readonly health: SubscriptionHealth;
  readonly detail?: string;
  readonly refreshIntervalMs: number;
  readonly lastSucceededAt?: number;
  readonly eventCount: number;
}

/** One subscribed occurrence, flattened for a merged, source-labeled view. */
export interface SubscribedOccurrence {
  /** Read-only namespaced id: `sub:<subscriptionName>:<uid>`. */
  readonly id: string;
  readonly subscription: string;
  readonly title: string;
  /** 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss[Z]'. */
  readonly start: string;
  readonly allDay: boolean;
  readonly location?: string;
  readonly tzid?: string;
  /** True when the source RRULE was not fully expanded — shown as a marker. */
  readonly recurrenceNotFullyExpanded: boolean;
}

export type SubscribeResult =
  | { readonly ok: true; readonly name: string; readonly eventCount: number; readonly calendarName?: string; readonly refreshIntervalMs: number }
  | { readonly ok: false; readonly stage: 'fetch' | 'parse' | 'duplicate'; readonly detail: string };

export type ValidateResult =
  | { readonly ok: true; readonly derivedName: string; readonly eventCount: number; readonly calendarName?: string }
  | { readonly ok: false; readonly stage: 'fetch' | 'parse'; readonly detail: string };

export interface RefreshOutcome {
  readonly name: string;
  readonly outcome: 'updated' | 'not-modified' | 'skipped' | 'unreachable' | 'parse-error';
  readonly detail?: string;
  readonly eventCount?: number;
}

/** The SecretsManager surface this registry needs. */
export interface SubscriptionSecretStore {
  readonly get: (key: string) => Promise<string | null>;
  readonly set: (key: string, value: string) => Promise<void>;
  readonly delete?: (key: string) => Promise<void>;
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

const STORE_VERSION = 1;
/** Data older than this multiple of the refresh interval reads as stale. */
const STALE_MULTIPLE = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function secretKeyForName(name: string): string {
  const slug = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  return `GOODVIBES_CALENDAR_SUB_${slug || 'FEED'}`;
}

type AgentLocalStorePaths = Pick<ShellPathService, 'resolveUserPath'>;

export function subscriptionStorePath(shellPaths: AgentLocalStorePaths): string {
  return shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'calendar', 'subscriptions.json');
}

/** The real HTTP fetcher — conditional GET with etag/last-modified, mapped to FeedFetchResult. */
export function createHttpFeedFetcher(): FeedFetcher {
  return async (req) => {
    try {
      const headers: Record<string, string> = { Accept: 'text/calendar, text/plain, */*' };
      if (req.etag) headers['If-None-Match'] = req.etag;
      if (req.lastModified) headers['If-Modified-Since'] = req.lastModified;
      const res = await fetch(req.url, { headers, redirect: 'follow' });
      if (res.status === 304) {
        return { kind: 'not-modified', ...(res.headers.get('etag') ? { etag: res.headers.get('etag')! } : {}), ...(res.headers.get('last-modified') ? { lastModified: res.headers.get('last-modified')! } : {}) };
      }
      if (!res.ok) {
        return { kind: 'error', status: res.status, message: res.statusText || `HTTP ${res.status}` };
      }
      const body = await res.text();
      return { kind: 'ok', body, ...(res.headers.get('etag') ? { etag: res.headers.get('etag')! } : {}), ...(res.headers.get('last-modified') ? { lastModified: res.headers.get('last-modified')! } : {}) };
    } catch (error) {
      return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  };
}

// ──────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────

export interface CalendarSubscriptionRegistryOptions {
  readonly storePath: string;
  readonly secrets: SubscriptionSecretStore;
  readonly fetcher: FeedFetcher;
  readonly clock?: () => number;
  readonly defaultRefreshIntervalMs?: number;
}

export class CalendarSubscriptionRegistry {
  private readonly storePath: string;
  private readonly secrets: SubscriptionSecretStore;
  private readonly fetcher: FeedFetcher;
  private readonly clock: () => number;
  private readonly defaultInterval: number;

  public constructor(options: CalendarSubscriptionRegistryOptions) {
    this.storePath = options.storePath;
    this.secrets = options.secrets;
    this.fetcher = options.fetcher;
    this.clock = options.clock ?? (() => Date.now());
    this.defaultInterval = options.defaultRefreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  }

  public static create(shellPaths: AgentLocalStorePaths, secrets: SubscriptionSecretStore, fetcher?: FeedFetcher): CalendarSubscriptionRegistry {
    return new CalendarSubscriptionRegistry({ storePath: subscriptionStorePath(shellPaths), secrets, fetcher: fetcher ?? createHttpFeedFetcher() });
  }

  /** Fetch a feed WITHOUT saving it — the subscribe preview / wizard validate step. */
  public async validate(url: string, requestedName?: string): Promise<ValidateResult> {
    const store = new SubscriptionStore({ fetcher: this.fetcher, clock: this.clock });
    const res = await store.validateByFetch(url, requestedName);
    if (!res.ok) return { ok: false, stage: res.stage, detail: res.detail };
    return { ok: true, derivedName: res.derivedName, eventCount: res.eventCount, ...(res.calendarName !== undefined ? { calendarName: res.calendarName } : {}) };
  }

  /** Subscribe: fetch once, derive the name, store the URL as a secret, and cache events. */
  public async subscribe(url: string, requestedName?: string, refreshIntervalMs?: number): Promise<SubscribeResult> {
    const file = this.readStore();
    const store = new SubscriptionStore({ fetcher: this.fetcher, clock: this.clock, ...(refreshIntervalMs !== undefined ? { defaultRefreshIntervalMs: refreshIntervalMs } : { defaultRefreshIntervalMs: this.defaultInterval }) });
    const result = await store.add({ url, ...(requestedName !== undefined ? { name: requestedName } : {}), ...(refreshIntervalMs !== undefined ? { refreshIntervalMs } : {}) });
    if (!result.ok) return { ok: false, stage: result.stage, detail: result.detail };

    const sub = result.subscription;
    if (file.subscriptions.some((s) => s.name === sub.name)) {
      return { ok: false, stage: 'duplicate', detail: `A subscription named '${sub.name}' already exists — unsubscribe first or pass a different --name.` };
    }

    const secretKey = secretKeyForName(sub.name);
    await this.secrets.set(secretKey, url);

    const events = store.events(sub.name);
    const meta: SubscriptionMeta = {
      name: sub.name,
      secretKey,
      refreshIntervalMs: sub.refreshIntervalMs,
      ...(sub.lastFetchedAt !== undefined ? { lastFetchedAt: sub.lastFetchedAt } : {}),
      ...(sub.lastSucceededAt !== undefined ? { lastSucceededAt: sub.lastSucceededAt } : {}),
      ...(sub.etag !== undefined ? { etag: sub.etag } : {}),
      ...(sub.lastModified !== undefined ? { lastModified: sub.lastModified } : {}),
      lastResult: 'ok',
      ...(sub.detail !== undefined ? { lastDetail: sub.detail } : {}),
      eventCount: events.length,
      events: [...events],
    };
    this.writeStore({ version: STORE_VERSION, subscriptions: [...file.subscriptions, meta] });
    return { ok: true, name: sub.name, eventCount: events.length, ...(refreshIntervalMs !== undefined ? {} : {}), refreshIntervalMs: sub.refreshIntervalMs };
  }

  /** Remove a subscription, its cached events, and its stored URL secret. */
  public async unsubscribe(name: string): Promise<boolean> {
    const file = this.readStore();
    const target = file.subscriptions.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    if (!target) return false;
    if (this.secrets.delete) {
      try { await this.secrets.delete(target.secretKey); } catch { /* best-effort secret cleanup */ }
    }
    this.writeStore({ version: STORE_VERSION, subscriptions: file.subscriptions.filter((s) => s !== target) });
    return true;
  }

  /** Refresh one named subscription (or all when name omitted). Network, on demand / on boot. */
  public async refresh(name?: string, opts: { force?: boolean } = {}): Promise<RefreshOutcome[]> {
    const file = this.readStore();
    const targets = name
      ? file.subscriptions.filter((s) => s.name.toLowerCase() === name.trim().toLowerCase())
      : file.subscriptions;
    if (targets.length === 0) return [];

    const updated: SubscriptionMeta[] = [...file.subscriptions];
    const outcomes: RefreshOutcome[] = [];
    for (const target of targets) {
      const url = await this.secrets.get(target.secretKey);
      if (url === null) {
        outcomes.push({ name: target.name, outcome: 'unreachable', detail: 'Stored feed URL is missing from the secret manager — unsubscribe and re-add.' });
        continue;
      }
      const store = new SubscriptionStore({ fetcher: this.fetcher, clock: this.clock });
      store.restore([{ name: target.name, url, refreshIntervalMs: target.refreshIntervalMs, ...(target.lastFetchedAt !== undefined ? { lastFetchedAt: target.lastFetchedAt } : {}), ...(target.lastSucceededAt !== undefined ? { lastSucceededAt: target.lastSucceededAt } : {}), ...(target.etag !== undefined ? { etag: target.etag } : {}), ...(target.lastModified !== undefined ? { lastModified: target.lastModified } : {}) }]);
      const report = (await store.refresh(target.name, { force: opts.force ?? true }))!;
      const sub = store.get(target.name)!;
      const events = report.outcome === 'updated' ? store.events(target.name) : target.events;
      const idx = updated.findIndex((s) => s === target);
      updated[idx] = {
        name: target.name,
        secretKey: target.secretKey,
        refreshIntervalMs: sub.refreshIntervalMs,
        ...(sub.lastFetchedAt !== undefined ? { lastFetchedAt: sub.lastFetchedAt } : {}),
        ...(sub.lastSucceededAt !== undefined ? { lastSucceededAt: sub.lastSucceededAt } : {}),
        ...(sub.etag !== undefined ? { etag: sub.etag } : {}),
        ...(sub.lastModified !== undefined ? { lastModified: sub.lastModified } : {}),
        lastResult: report.outcome === 'skipped' ? target.lastResult : this.resultOf(report.outcome),
        ...(report.detail !== undefined ? { lastDetail: report.detail } : {}),
        eventCount: events.length,
        events: [...events],
      };
      outcomes.push({ name: target.name, outcome: report.outcome, ...(report.detail !== undefined ? { detail: report.detail } : {}), eventCount: events.length });
    }
    this.writeStore({ version: STORE_VERSION, subscriptions: updated });
    return outcomes;
  }

  /** Subscription statuses for `/calendar subscriptions` — no network, masked URLs. */
  public async statuses(): Promise<readonly SubscriptionStatus[]> {
    const file = this.readStore();
    const now = this.clock();
    const out: SubscriptionStatus[] = [];
    for (const s of file.subscriptions) {
      const url = await this.secrets.get(s.secretKey);
      out.push({
        name: s.name,
        maskedUrl: url ? maskFeedUrl(url) : '(url missing from secret manager)',
        health: this.healthOf(s, now),
        ...(this.detailOf(s, now) !== undefined ? { detail: this.detailOf(s, now)! } : {}),
        refreshIntervalMs: s.refreshIntervalMs,
        ...(s.lastSucceededAt !== undefined ? { lastSucceededAt: s.lastSucceededAt } : {}),
        eventCount: s.eventCount ?? s.events.length,
      });
    }
    return out;
  }

  public hasAny(): boolean {
    return this.readStore().subscriptions.length > 0;
  }

  public names(): readonly string[] {
    return this.readStore().subscriptions.map((s) => s.name);
  }

  /**
   * One row per cached subscribed event (the seed, unexpanded) — the merged
   * `/calendar list` view. A recurring event is marked so the reader knows more
   * occurrences exist; `occurrencesInWindow` is the date-windowed expansion.
   */
  public seeds(): readonly SubscribedOccurrence[] {
    const file = this.readStore();
    const out: SubscribedOccurrence[] = [];
    for (const s of file.subscriptions) {
      for (const event of s.events) {
        const recurring = event.recurrence !== undefined;
        out.push({
          id: `sub:${s.name}:${event.uid}`,
          subscription: s.name,
          title: event.summary,
          start: event.start.value,
          allDay: event.start.kind === 'date',
          ...(event.location !== undefined ? { location: event.location } : {}),
          ...(event.start.zone === 'tzid' && event.start.tzid !== undefined ? { tzid: event.start.tzid } : {}),
          recurrenceNotFullyExpanded: recurring && event.recurrence?.expansion === 'unsupported',
        });
      }
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  }

  /**
   * All subscribed occurrences within [fromDate, toDate] (inclusive, 'YYYY-MM-DD'),
   * flattened and source-labeled for a merged read-only view. Recurring events are
   * expanded through the SDK; an unsupported RRULE surfaces its seed with a marker.
   */
  public occurrencesInWindow(fromDate: string, toDate: string): readonly SubscribedOccurrence[] {
    const file = this.readStore();
    const out: SubscribedOccurrence[] = [];
    for (const s of file.subscriptions) {
      for (const event of s.events) {
        const occ = expandEvent(event, { from: fromDate, to: toDate });
        const notExpanded = event.recurrence?.expansion === 'unsupported';
        for (const o of occ) {
          out.push({
            id: `sub:${s.name}:${event.uid}`,
            subscription: s.name,
            title: event.summary,
            start: o.start,
            allDay: event.start.kind === 'date',
            ...(event.location !== undefined ? { location: event.location } : {}),
            ...(event.start.zone === 'tzid' && event.start.tzid !== undefined ? { tzid: event.start.tzid } : {}),
            recurrenceNotFullyExpanded: notExpanded,
          });
        }
      }
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  }

  // ── internals ────────────────────────────────────────────────────

  private resultOf(outcome: RefreshOutcome['outcome']): SubscriptionMeta['lastResult'] {
    if (outcome === 'updated') return 'ok';
    if (outcome === 'not-modified') return 'not-modified';
    if (outcome === 'unreachable') return 'unreachable';
    if (outcome === 'parse-error') return 'parse-error';
    return 'ok';
  }

  private healthOf(s: SubscriptionMeta, now: number): SubscriptionHealth {
    if (s.lastResult === undefined) return 'never-fetched';
    if (s.lastResult === 'unreachable') return 'unreachable';
    if (s.lastResult === 'parse-error') return 'parse-error';
    if (s.lastSucceededAt === undefined) return 'never-fetched';
    if (now - s.lastSucceededAt > s.refreshIntervalMs * STALE_MULTIPLE) return 'stale';
    return 'ok';
  }

  private detailOf(s: SubscriptionMeta, now: number): string | undefined {
    if (this.healthOf(s, now) === 'stale' && s.lastSucceededAt !== undefined) {
      const ageMin = Math.round((now - s.lastSucceededAt) / 60000);
      return `Last updated ${ageMin} min ago (past the ${Math.round(s.refreshIntervalMs / 60000)} min refresh window).`;
    }
    return s.lastDetail;
  }

  private readStore(): SubscriptionStoreFile {
    if (!existsSync(this.storePath)) return { version: STORE_VERSION, subscriptions: [] };
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.storePath, 'utf-8'));
      if (!isRecord(parsed) || !Array.isArray(parsed.subscriptions)) return { version: STORE_VERSION, subscriptions: [] };
      const subscriptions = parsed.subscriptions.filter(isRecord).map(coerceMeta).filter((m): m is SubscriptionMeta => m !== null);
      return { version: STORE_VERSION, subscriptions };
    } catch (error) {
      throw new Error(`Could not read calendar subscription store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private writeStore(file: SubscriptionStoreFile): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
    renameSync(tmp, this.storePath);
  }
}

function coerceMeta(value: Record<string, unknown>): SubscriptionMeta | null {
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const secretKey = typeof value.secretKey === 'string' ? value.secretKey : '';
  if (!name || !secretKey) return null;
  const refreshIntervalMs = typeof value.refreshIntervalMs === 'number' ? value.refreshIntervalMs : DEFAULT_REFRESH_INTERVAL_MS;
  const events = Array.isArray(value.events) ? (value.events.filter(isRecord) as unknown as CachedFeedEvent[]) : [];
  const lastResult = value.lastResult === 'ok' || value.lastResult === 'not-modified' || value.lastResult === 'unreachable' || value.lastResult === 'parse-error' ? value.lastResult : undefined;
  return {
    name,
    secretKey,
    refreshIntervalMs,
    ...(typeof value.lastFetchedAt === 'number' ? { lastFetchedAt: value.lastFetchedAt } : {}),
    ...(typeof value.lastSucceededAt === 'number' ? { lastSucceededAt: value.lastSucceededAt } : {}),
    ...(typeof value.etag === 'string' ? { etag: value.etag } : {}),
    ...(typeof value.lastModified === 'string' ? { lastModified: value.lastModified } : {}),
    ...(lastResult !== undefined ? { lastResult } : {}),
    ...(typeof value.lastDetail === 'string' ? { lastDetail: value.lastDetail } : {}),
    ...(typeof value.eventCount === 'number' ? { eventCount: value.eventCount } : {}),
    events,
  };
}
