/**
 * feature-announcements.ts — announce-once receipts for default-on features.
 *
 * Vendored mirror of the SDK's platform/runtime/feature-announcements.ts
 * (which has no public export path). The Agent forks the SDK's runtime
 * composition root (see services.ts), so it must produce the same
 * announce-once receipts the SDK's daemon boot does:
 * - the web surface exposes its URL once per install at boot,
 * - the exec sandbox's first auto-allowed contained run yields a one-time
 *   "commands now run contained; escalations will ask" line.
 *
 * The persisted store lives in the shared control-plane config directory, so
 * an announcement made by ANY process of this install (the daemon, the TUI,
 * or this Agent) is made exactly once. Announcement ids and texts must stay
 * byte-identical to the SDK's so the shared store deduplicates across
 * surfaces.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import type { ConfigManager } from '../config/index.ts';

/** One announce-once line a surface renders verbatim. */
export interface FeatureAnnouncement {
  readonly id: string;
  readonly text: string;
}

/**
 * Persisted announce-once bookkeeping (JSON map of announcement id ->
 * timestamp) under the control-plane config directory, so an announcement
 * made by any process of this install is made exactly once.
 */
export class FeatureAnnouncementStore {
  constructor(private readonly path: string) {}

  private read(): Record<string, number> {
    try {
      if (!existsSync(this.path)) return {};
      const parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as unknown;
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, number>)
        : {};
    } catch {
      return {};
    }
  }

  has(id: string): boolean {
    return id in this.read();
  }

  /**
   * Record an announcement; returns true only on the FIRST record (the caller
   * announces), false when it was already made (the caller stays silent).
   */
  record(id: string): boolean {
    const entries = this.read();
    if (id in entries) return false;
    entries[id] = Date.now();
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
    } catch (err) {
      // An unwritable store must never block the feature; the announcement
      // may repeat on the next start, which is noisy but honest.
      logger.warn('[announcements] could not persist announce-once record', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }
}

/** The store file location for an install (control-plane config directory). */
export function featureAnnouncementsPath(
  configManager: Pick<ConfigManager, 'getControlPlaneConfigDir'>,
): string {
  return join(configManager.getControlPlaneConfigDir(), 'control-plane', 'feature-announcements.json');
}

/** The web surface's reachable URL from its settings. */
export function resolveWebSurfaceUrl(configManager: Pick<ConfigManager, 'get'>): string {
  const publicBaseUrl = configManager.get('web.publicBaseUrl');
  if (publicBaseUrl.trim().length > 0) return publicBaseUrl;
  return `http://${configManager.get('web.host')}:${configManager.get('web.port')}`;
}

export const WEB_SURFACE_ANNOUNCEMENT_ID = 'web-surface-url';
export const SANDBOX_CONTAINED_ANNOUNCEMENT_ID = 'exec-sandbox-contained';

/** The one-time contained-exec line, verbatim (must match the SDK's). */
export const SANDBOX_CONTAINED_ANNOUNCEMENT_TEXT =
  'commands now run contained; escalations will ask';

/**
 * Collect the announce-once lines due at boot. Each returned line is
 * recorded in the store as announced — the caller renders every returned
 * line, exactly once per install.
 */
export function collectStartupAnnouncements(deps: {
  readonly configManager: Pick<ConfigManager, 'get'>;
  readonly store: Pick<FeatureAnnouncementStore, 'record'>;
}): FeatureAnnouncement[] {
  const lines: FeatureAnnouncement[] = [];
  if (deps.configManager.get('web.enabled')) {
    const hostMode = deps.configManager.get('web.hostMode');
    const scope = hostMode === 'local' ? ' — serving this machine only until web.hostMode is widened' : '';
    if (deps.store.record(WEB_SURFACE_ANNOUNCEMENT_ID)) {
      lines.push({
        id: WEB_SURFACE_ANNOUNCEMENT_ID,
        text: `Web surface ready: ${resolveWebSurfaceUrl(deps.configManager)}${scope}`,
      });
    }
  }
  return lines;
}

/**
 * The exec sandbox's first-contained-run announcer: call it on every
 * sandboxed command execution; the FIRST call per install announces once via
 * `onAnnounce` and every later call is silent.
 */
export function createSandboxContainmentAnnouncer(
  store: Pick<FeatureAnnouncementStore, 'record'>,
  onAnnounce: (announcement: FeatureAnnouncement) => void,
): () => void {
  return () => {
    if (store.record(SANDBOX_CONTAINED_ANNOUNCEMENT_ID)) {
      onAnnounce({
        id: SANDBOX_CONTAINED_ANNOUNCEMENT_ID,
        text: SANDBOX_CONTAINED_ANNOUNCEMENT_TEXT,
      });
    }
  };
}
