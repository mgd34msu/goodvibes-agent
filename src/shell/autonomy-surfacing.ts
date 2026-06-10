import { buildAwayDigest, formatRelativeTime } from '../core/away-digest.ts';
import { LastSeenStore } from '../core/last-seen-store.ts';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';

interface AutomationJobLike {
  readonly name: string;
  readonly enabled: boolean;
  readonly nextRunAt?: number;
  readonly lastRunAt?: number;
  readonly runCount?: number;
}

interface ApprovalLike {
  readonly status: string;
}

interface AutonomyMessageRouter {
  high(message: string): void;
  getFeed(): { push(text: string, priority?: 'high' | 'low', kind?: string): void } | null;
}

export interface AutonomySurfacingOptions {
  readonly shellPaths: Parameters<typeof LastSeenStore.fromShellPaths>[0];
  readonly listAutomationJobs: () => readonly AutomationJobLike[];
  readonly listApprovals: () => readonly ApprovalLike[];
  readonly getTasksSnapshot: () => readonly unknown[];
  readonly router: AutonomyMessageRouter;
  readonly render: () => void;
}

const COMING_UP_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 2500;
const LAST_SEEN_REFRESH_MS = 5 * 60_000;

/**
 * Ambient autonomy surfacing for the shell: the launch "While you were away"
 * digest and the sidebar's Coming up entries. Everything here is best-effort
 * and offline-tolerant — failures are silent and renders are never blocked.
 */
export function createAutonomySurfacing(options: AutonomySurfacingOptions) {
  const lastSeenStore = LastSeenStore.fromShellPaths(options.shellPaths);

  // Refresh lastSeenAt every 5 minutes so rapid restarts still detect activity.
  const lastSeenRefreshInterval = setInterval(() => {
    lastSeenStore.save();
  }, LAST_SEEN_REFRESH_MS);
  lastSeenRefreshInterval.unref();

  const comingUpCache: { items: string[]; fetchedAt: number | null; fetching: boolean } = {
    items: [],
    fetchedAt: null,
    fetching: false,
  };

  function refreshComingUp(): void {
    if (comingUpCache.fetching) return;
    const now = Date.now();
    if (comingUpCache.fetchedAt !== null && now - comingUpCache.fetchedAt < COMING_UP_TTL_MS) return;
    comingUpCache.fetching = true;
    Promise.resolve().then(() => {
      try {
        const jobs = options.listAutomationJobs();
        comingUpCache.items = jobs
          .filter((job) => job.enabled && job.nextRunAt !== undefined && job.nextRunAt > now)
          .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
          .slice(0, 3)
          .map((job) => {
            const when = job.nextRunAt ? formatRelativeTime(job.nextRunAt, now) : '';
            const name = job.name.length > 22 ? `${job.name.slice(0, 20)}…` : job.name;
            return when ? `${name} — ${when}` : name;
          });
        comingUpCache.fetchedAt = Date.now();
      } catch {
        // Offline or manager unavailable — leave cache as-is.
      } finally {
        comingUpCache.fetching = false;
      }
    }).catch(() => {
      comingUpCache.fetching = false;
    });
  }

  function announceAwayDigest(): void {
    void (async () => {
      try {
        const lastSeenAt = lastSeenStore.read();
        const withTimeout = <T>(get: () => T) => Promise.race([
          Promise.resolve(get()),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS)),
        ]);

        const [jobsResult, tasksResult] = await Promise.allSettled([
          withTimeout(options.listAutomationJobs),
          withTimeout(options.getTasksSnapshot),
        ]);
        const jobs = jobsResult.status === 'fulfilled' ? jobsResult.value : [];
        const allTasks = tasksResult.status === 'fulfilled' ? tasksResult.value : [];

        const firedSchedules = lastSeenAt !== null
          ? jobs
            .filter((job) => job.lastRunAt !== undefined && job.lastRunAt > lastSeenAt)
            .map((job) => ({ name: job.name, lastRunAt: job.lastRunAt, runCount: job.runCount ?? 0 }))
          : [];

        const changedTasks = lastSeenAt !== null
          ? allTasks
            .filter((task) => {
              const completedAt = (task as { completedAt?: number }).completedAt;
              return completedAt !== undefined ? completedAt > lastSeenAt : false;
            })
            .map((task) => ({
              title: (task as { title?: string; name?: string }).title
                ?? (task as { name?: string }).name
                ?? 'Task',
              status: (task as { status?: string }).status ?? 'done',
              completedAt: (task as { completedAt?: number }).completedAt,
            }))
          : [];

        const pendingApprovals = options.listApprovals()
          .filter((approval) => approval.status === 'pending').length;

        const digest = buildAwayDigest({
          lastSeenAt,
          schedules: firedSchedules,
          tasks: changedTasks,
          pendingApprovals,
        });

        if (digest !== null) {
          const full = [digest.headline, ...digest.lines].join('\n  ');
          options.router.high(`[Status] ${full}`);
          for (const line of digest.lines) {
            options.router.getFeed()?.push(`[Status] ${line}`, 'low', 'schedule');
          }
          options.render();
        }
      } catch (err) {
        logger.debug('away-digest failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
      }
    })();
  }

  function stop(): void {
    clearInterval(lastSeenRefreshInterval);
    lastSeenStore.save();
  }

  return {
    refreshComingUp,
    announceAwayDigest,
    stop,
    comingUpItems: (): readonly string[] => comingUpCache.items,
  };
}
