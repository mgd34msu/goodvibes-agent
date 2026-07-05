/**
 * session-spine-client.ts
 *
 * The in-process coordinator that registers the agent's own sessions into the
 * daemon "spine" over raw REST (see ../agent/session-registration.ts). It sits
 * NEXT TO the in-process SharedSessionBroker, never replacing it: the broker
 * stays the local truth and offline read-model; this client mirrors create /
 * resume / heartbeat / close to the daemon and buffers them when the daemon is
 * unreachable.
 *
 * Discipline (W2A brief):
 *  - Every public method (register / reopen / heartbeat / close / foldLegacyRecords)
 *    is fire-and-forget: it returns void synchronously and never throws into the
 *    caller, even when fetch rejects. Interactive session start/resume never
 *    blocks on the wire.
 *  - Reachability is derived from THIS client's own probe, never from the
 *    hardcoded bootstrap daemonStatus 'external' (which does not probe).
 *  - Offline ops go into a bounded ring (drop-oldest); flush is idempotent
 *    because register is an upsert.
 *  - Heartbeat is debounced/coalesced to at most one wire call per window and
 *    omits the title so it never renames a titled session.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import {
  isRecord,
  postSessionClose,
  postSessionRegister,
  type SessionRegistrationConnection,
  type SessionRegistrationInput,
  type SessionRegistrationParticipant,
} from '../agent/session-registration.ts';
import { readConnectedHostOperatorToken } from './connected-host-auth.ts';

/**
 * The canonical agent participant (TRANSPORT axis). surfaceKind stays 'service';
 * the record kind ('agent') is stamped by the registration builder, not here.
 */
export const AGENT_SPINE_PARTICIPANT: Omit<SessionRegistrationParticipant, 'lastSeenAt'> = {
  surfaceKind: 'service',
  surfaceId: 'surface:goodvibes-agent',
  displayName: 'GoodVibes Agent',
};

export type SpineReachability = 'unknown' | 'online' | 'offline';

export interface SessionSpineRecord {
  readonly sessionId: string;
  readonly project: string;
  readonly title?: string;
  readonly userId?: string;
}

interface QueuedOp {
  readonly type: 'register' | 'close';
  readonly sessionId: string;
  readonly input?: SessionRegistrationInput;
}

type SpineLogger = Pick<typeof logger, 'debug'>;

export interface SessionSpineClientOptions {
  /** Resolves a fresh connection (baseUrl + token) per op — token may appear later. */
  readonly resolveConnection: () => SessionRegistrationConnection;
  readonly now?: () => number;
  readonly queueLimit?: number;
  readonly heartbeatMinIntervalMs?: number;
  readonly registerTimeoutMs?: number;
  readonly closeTimeoutMs?: number;
  readonly probeTimeoutMs?: number;
  /** Override for tests; default does a short GET {baseUrl}/status and calls any HTTP response "reachable". */
  readonly probe?: (connection: SessionRegistrationConnection, timeoutMs: number) => Promise<boolean>;
  readonly log?: SpineLogger;
}

const DEFAULT_QUEUE_LIMIT = 128;
const DEFAULT_HEARTBEAT_MIN_INTERVAL_MS = 45_000;
const DEFAULT_REGISTER_TIMEOUT_MS = 1_500;
const DEFAULT_CLOSE_TIMEOUT_MS = 500;
const DEFAULT_PROBE_TIMEOUT_MS = 1_500;

/**
 * Builds a per-op connection resolver from the config manager (host/port, default
 * 127.0.0.1:3421) and the connected-host operator token (env overrides + the
 * canonical operator-tokens.json). Re-read every op so a token that appears after
 * boot is picked up.
 */
export function createSpineConnectionResolver(
  configManager: Pick<ConfigManager, 'get'>,
  homeDirectory: string,
): () => SessionRegistrationConnection {
  return () => {
    const hostValue = configManager.get('controlPlane.host');
    const portValue = configManager.get('controlPlane.port');
    const host = typeof hostValue === 'string' && hostValue.trim().length > 0 ? hostValue.trim() : '127.0.0.1';
    const port = typeof portValue === 'number' && Number.isFinite(portValue) ? portValue : 3421;
    const token = readConnectedHostOperatorToken(homeDirectory);
    return { baseUrl: `http://${host}:${port}`, token: token.token, tokenPath: token.path };
  };
}

async function defaultProbe(connection: SessionRegistrationConnection, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Any HTTP response (even 401) means the host answered → reachable. Auth is a
    // separate concern surfaced by register results, not by the reachability probe.
    await fetch(`${connection.baseUrl}/status`, {
      headers: connection.token ? { authorization: `Bearer ${connection.token}` } : undefined,
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export class SessionSpineClient {
  private readonly resolveConnection: () => SessionRegistrationConnection;
  private readonly now: () => number;
  private readonly queueLimit: number;
  private readonly heartbeatMinIntervalMs: number;
  private readonly registerTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  private readonly probeTimeoutMs: number;
  private readonly probeImpl: (connection: SessionRegistrationConnection, timeoutMs: number) => Promise<boolean>;
  private readonly log: SpineLogger;

  private reachability: SpineReachability = 'unknown';
  private readonly records = new Map<string, SessionRegistrationInput>();
  private readonly queue: QueuedOp[] = [];
  private lastHeartbeatAt = 0;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  /** The most recently registered/reopened session — the target of the timer-driven
   * keepalive heartbeat below. */
  private lastSessionId: string | null = null;
  /** Timer-driven keepalive: fires the heartbeat on a fixed cadence INDEPENDENT of
   * turn activity, so a live-but-idle agent surface (no TURN_SUBMITTED/COMPLETED
   * for a while) keeps its participant lastSeenAt fresh and never falls outside the
   * daemon's idle-empty reaper window (SharedSessionBroker idleEmptyMs, default
   * 10min — see session-broker.ts). Ports goodvibes-tui's D3/#4 fix
   * (bda3cf5f) 1:1; this client has no separate activate()/deactivate() step (it
   * is live for the whole process lifetime once constructed), so the keepalive
   * starts here in the constructor and stops in dispose(). Each tick is just a
   * heartbeat() call, so it rides the SAME bounded offline-queue/reconnect
   * handling as every other op (dispatchRegister → runRegister marks reachability
   * offline and enqueues, drop-oldest, on failure; online + flush on success) —
   * no new retry loop, no faster-than-cadence attempts against a dead daemon. */
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionSpineClientOptions) {
    this.resolveConnection = options.resolveConnection;
    this.now = options.now ?? (() => Date.now());
    this.queueLimit = Math.max(1, options.queueLimit ?? DEFAULT_QUEUE_LIMIT);
    this.heartbeatMinIntervalMs = Math.max(0, options.heartbeatMinIntervalMs ?? DEFAULT_HEARTBEAT_MIN_INTERVAL_MS);
    this.registerTimeoutMs = options.registerTimeoutMs ?? DEFAULT_REGISTER_TIMEOUT_MS;
    this.closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.probeImpl = options.probe ?? defaultProbe;
    this.log = options.log ?? logger;
    this.startKeepalive();
  }

  /** Honest reachability derived from this client's own probe/ops. */
  status(): SpineReachability {
    return this.reachability;
  }

  /** Current bounded offline-queue depth (for diagnostics / tests). */
  get pendingOps(): number {
    return this.queue.length;
  }

  /** The session the keepalive heartbeat currently targets (diagnostics/tests). */
  get keepaliveSessionId(): string | null {
    return this.lastSessionId;
  }

  /** Start the timer-driven keepalive heartbeat (idempotent). Fires at the same
   * cadence as the debounce window so it coalesces with turn-driven beats — at
   * most one wire call per window either way. */
  private startKeepalive(): void {
    if (this.keepaliveTimer !== null || this.heartbeatMinIntervalMs <= 0) return;
    this.keepaliveTimer = setInterval(() => {
      if (this.lastSessionId) this.heartbeat(this.lastSessionId);
    }, this.heartbeatMinIntervalMs);
    this.keepaliveTimer.unref?.();
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  /** CREATE: fire-and-forget initial registration (title stamped once). */
  register(record: SessionSpineRecord): void {
    this.cacheHeartbeatRecord(record);
    this.dispatchRegister(this.buildInput(record, { includeTitle: true }));
  }

  /** RESUME: fire-and-forget reopen (reopen:true, no title) — the only reopen path. */
  reopen(record: SessionSpineRecord): void {
    this.cacheHeartbeatRecord(record);
    this.dispatchRegister(this.buildInput(record, { includeTitle: false, reopen: true }));
  }

  /** HEARTBEAT: debounced re-register, coalesced to one wire call per window, no title, no reopen. */
  heartbeat(sessionId: string): void {
    const cached = this.records.get(sessionId);
    if (!cached) return;
    const now = this.now();
    if (now - this.lastHeartbeatAt >= this.heartbeatMinIntervalMs) {
      this.lastHeartbeatAt = now;
      this.dispatchRegister(this.withFreshLastSeen(cached));
      return;
    }
    if (this.heartbeatTimer) return; // already a trailing beat scheduled → coalesced
    const delay = Math.max(0, this.heartbeatMinIntervalMs - (now - this.lastHeartbeatAt));
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      this.lastHeartbeatAt = this.now();
      const rec = this.records.get(sessionId);
      if (rec) this.dispatchRegister(this.withFreshLastSeen(rec));
    }, delay);
    this.heartbeatTimer.unref?.();
  }

  /** CLOSE: best-effort, fire-and-forget, short timeout; tolerate a racing daemon stop. */
  close(sessionId: string): void {
    this.records.delete(sessionId);
    void this.runClose(sessionId);
  }

  /**
   * LEGACY FOLD: register each per-cwd record; a record whose id is in `closedIds`
   * is registered then closed so a locally-closed session STAYS closed in the
   * daemon (honest history). Idempotent — register is an upsert; closing an
   * already-closed record is a no-op.
   */
  foldLegacyRecords(records: readonly SessionSpineRecord[], closedIds: ReadonlySet<string>): void {
    for (const record of records) {
      this.enqueue({ type: 'register', sessionId: record.sessionId, input: this.buildInput(record, { includeTitle: true }) });
      if (closedIds.has(record.sessionId)) {
        this.enqueue({ type: 'close', sessionId: record.sessionId });
      }
    }
    void this.flush();
  }

  /** Reachability probe — runs OFF the interactive path (deferred startup). Flushes on success. */
  async probeReachability(): Promise<SpineReachability> {
    const connection = this.resolveConnection();
    let reachable = false;
    try {
      reachable = await this.probeImpl(connection, this.probeTimeoutMs);
    } catch {
      reachable = false;
    }
    if (reachable) {
      this.reachability = 'online';
      await this.flush();
    } else {
      this.reachability = 'offline';
    }
    return this.reachability;
  }

  /** Clears the pending heartbeat timer and the keepalive timer; call on shutdown. */
  dispose(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.stopKeepalive();
  }

  private cacheHeartbeatRecord(record: SessionSpineRecord): void {
    // Cache the title-less form so heartbeats never rename a titled session.
    this.records.set(record.sessionId, this.buildInput(record, { includeTitle: false }));
    // Track the newest session as the keepalive-heartbeat target.
    this.lastSessionId = record.sessionId;
  }

  private buildInput(
    record: SessionSpineRecord,
    opts: { readonly includeTitle: boolean; readonly reopen?: boolean },
  ): SessionRegistrationInput {
    const participant: SessionRegistrationParticipant = {
      ...AGENT_SPINE_PARTICIPANT,
      ...(record.userId ? { userId: record.userId } : {}),
      lastSeenAt: this.now(),
    };
    return {
      sessionId: record.sessionId,
      project: record.project,
      ...(opts.includeTitle && record.title ? { title: record.title } : {}),
      participant,
      ...(opts.reopen ? { reopen: true } : {}),
    };
  }

  private withFreshLastSeen(input: SessionRegistrationInput): SessionRegistrationInput {
    return { ...input, participant: { ...input.participant, lastSeenAt: this.now() } };
  }

  private dispatchRegister(input: SessionRegistrationInput): void {
    void this.runRegister(input);
  }

  private async runRegister(input: SessionRegistrationInput): Promise<void> {
    try {
      const connection = this.resolveConnection();
      const result = await postSessionRegister(connection, input, { timeoutMs: this.registerTimeoutMs });
      if (result.ok) {
        this.reachability = 'online';
        await this.flush();
        return;
      }
      if (result.kind === 'connected_host_unavailable') {
        this.reachability = 'offline';
        this.enqueue({ type: 'register', sessionId: input.sessionId, input });
        return;
      }
      // auth_required / route_unavailable / error: honest local-only. Never claim
      // 'registered'; do not queue (these are not transient connectivity faults).
      this.log.debug('session spine register not applied', { kind: result.kind, error: result.error });
    } catch (error) {
      // Fire-and-forget contract: absorb everything.
      this.log.debug('session spine register threw', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async runClose(sessionId: string): Promise<void> {
    try {
      const connection = this.resolveConnection();
      const result = await postSessionClose(connection, sessionId, { timeoutMs: this.closeTimeoutMs });
      if (!result.ok && result.kind === 'connected_host_unavailable') {
        this.reachability = 'offline';
        this.enqueue({ type: 'close', sessionId });
      }
    } catch (error) {
      this.log.debug('session spine close threw', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private enqueue(op: QueuedOp): void {
    if (this.queue.length >= this.queueLimit) this.queue.shift(); // drop-oldest
    this.queue.push(op);
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    try {
      const pending = this.queue.splice(0, this.queue.length);
      for (const op of pending) {
        const connection = this.resolveConnection();
        if (op.type === 'register' && op.input) {
          const result = await postSessionRegister(connection, op.input, { timeoutMs: this.registerTimeoutMs });
          if (!result.ok && result.kind === 'connected_host_unavailable') {
            this.reachability = 'offline';
            this.enqueue(op);
          }
        } else if (op.type === 'close') {
          const result = await postSessionClose(connection, op.sessionId, { timeoutMs: this.closeTimeoutMs });
          if (!result.ok && result.kind === 'connected_host_unavailable') {
            this.reachability = 'offline';
            this.enqueue(op);
          }
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}

export interface FoldLegacySpineStoreOptions {
  readonly storePath: string;
  readonly markerPath: string;
  readonly project: string;
  readonly now?: () => number;
  readonly log?: SpineLogger;
}

export interface FoldLegacySpineStoreResult {
  readonly folded: number;
  readonly skipped: boolean;
}

/**
 * Reads the agent's OWN per-cwd control-plane sessions.json and folds each record
 * into the daemon via the client (register upsert; closed records also closed).
 * Writes a marker so subsequent runs are a no-op ("marked migrated"). Register is
 * idempotent, so even a marker-less re-run is safe. Only folds the store for the
 * cwd it is invoked from — the per-cwd discovery scope (documented, not silently
 * "complete").
 */
export function foldLegacySpineStore(
  client: Pick<SessionSpineClient, 'foldLegacyRecords'>,
  options: FoldLegacySpineStoreOptions,
): FoldLegacySpineStoreResult {
  const log = options.log ?? logger;
  if (existsSync(options.markerPath)) return { folded: 0, skipped: true };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(options.storePath, 'utf-8')) as unknown;
  } catch {
    // No store (or unreadable) → nothing to fold; do not write a marker so a
    // later run with a real store still folds.
    return { folded: 0, skipped: false };
  }

  const sessions = isRecord(raw) && isRecord(raw.sessions) ? raw.sessions : {};
  const records: SessionSpineRecord[] = [];
  const closedIds = new Set<string>();
  for (const [key, value] of Object.entries(sessions)) {
    if (!isRecord(value)) continue;
    const sessionId = typeof value.id === 'string' && value.id.trim().length > 0 ? value.id : key;
    const title = typeof value.title === 'string' ? value.title : undefined;
    records.push({ sessionId, project: options.project, ...(title ? { title } : {}) });
    if (value.status === 'closed') closedIds.add(sessionId);
  }

  client.foldLegacyRecords(records, closedIds);

  try {
    mkdirSync(dirname(options.markerPath), { recursive: true });
    writeFileSync(
      options.markerPath,
      JSON.stringify(
        { migratedAt: (options.now ?? Date.now)(), count: records.length, source: options.storePath },
        null,
        2,
      ),
    );
  } catch (err) {
    log.debug('session spine legacy fold marker write failed', { err });
  }

  return { folded: records.length, skipped: false };
}
