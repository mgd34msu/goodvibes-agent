/**
 * Calendar subscription boot refresh (W4-A9 completion).
 *
 * Fires once from bootstrap's Phase-8 area (after first render, like the gated
 * LAN scan and MCP discovery), fully async and non-blocking: boot never waits on
 * the network. Consent was given at subscribe time — the subscribe flow states
 * "this will fetch the calendar from the URL you provided, now and on each
 * refresh" — so refreshing already-subscribed feeds at boot is the promised
 * behavior, not a silent new fetch. Feeds that were never subscribed are never
 * touched; when there are no subscriptions this function does nothing at all
 * (no network, no store write, no activity line).
 *
 * Bounded: only feeds actually DUE per their per-subscription refresh interval
 * are fetched (`force: false` — the SDK store skips the rest without network),
 * and due fetches send stored etag/last-modified validators so an unchanged
 * feed costs one conditional 304 round trip.
 *
 * Honest reporting: ONE aggregate activity line, emitted only when something
 * was actually refreshed or failed — e.g.
 *   [Calendar] refreshed 2 subscriptions; 'work' unreachable — will retry next refresh
 * An all-skipped (nothing due) boot stays silent. Failures keep the last-good
 * cached events, and /calendar subscriptions still shows the honest per-feed
 * health (unreachable / parse-error / stale with age).
 */
import { logger, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import type { ShellPathService } from '@/runtime/index.ts';
import {
  CalendarSubscriptionRegistry,
  createHttpFeedFetcher,
  type RefreshOutcome,
  type SubscriptionSecretStore,
} from '../agent/calendar-subscription-registry.ts';

interface SystemMessageSinkLike {
  low(message: string): void;
}

export interface CalendarBootRefreshOptions {
  readonly shellPaths: Pick<ShellPathService, 'resolveUserPath'>;
  readonly secretsManager: SubscriptionSecretStore;
  readonly systemMessageRouter: SystemMessageSinkLike;
  readonly requestRender: () => void;
  /** Injectable for tests — production callers omit it and get the real registry (real HTTP fetch). */
  readonly buildRegistry?: () => CalendarSubscriptionRegistry;
}

/**
 * Build the single aggregate line from refresh outcomes, or null when nothing
 * user-visible happened (everything skipped as not-due).
 */
export function formatCalendarBootRefreshLine(outcomes: readonly RefreshOutcome[]): string | null {
  const refreshed = outcomes.filter((o) => o.outcome === 'updated' || o.outcome === 'not-modified');
  const failed = outcomes.filter((o) => o.outcome === 'unreachable' || o.outcome === 'parse-error');
  if (refreshed.length === 0 && failed.length === 0) return null;

  const parts: string[] = [];
  if (refreshed.length > 0) {
    parts.push(`refreshed ${refreshed.length} subscription${refreshed.length === 1 ? '' : 's'}`);
  }
  for (const f of failed) {
    const label = f.outcome === 'unreachable' ? 'unreachable' : 'parse error';
    parts.push(`'${f.name}' ${label} — will retry next refresh`);
  }
  return `[Calendar] ${parts.join('; ')}`;
}

/**
 * Kick off the non-blocking boot refresh. Returns a promise that settles when
 * the background pass finishes (bootstrap ignores it; tests await it). Never
 * throws to the caller; failures are logged at debug and reported per-feed in
 * the aggregate line.
 */
export function scheduleCalendarSubscriptionBootRefresh(options: CalendarBootRefreshOptions): Promise<void> {
  const run = async (): Promise<void> => {
    try {
      const registry = options.buildRegistry
        ? options.buildRegistry()
        : CalendarSubscriptionRegistry.create(options.shellPaths, options.secretsManager, createHttpFeedFetcher());
      if (!registry.hasAny()) return; // nothing subscribed -> no network, no line

      // force:false — only feeds due per their own bounded interval are fetched;
      // the rest are skipped without touching the network.
      const outcomes = await registry.refresh(undefined, { force: false });
      const line = formatCalendarBootRefreshLine(outcomes);
      if (line !== null) {
        options.systemMessageRouter.low(line);
        options.requestRender();
      }
    } catch (error) {
      logger.debug('Calendar subscription boot refresh failed', { error: summarizeError(error) });
    }
  };
  return run();
}
