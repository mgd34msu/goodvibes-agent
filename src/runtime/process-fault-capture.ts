/**
 * process-fault-capture.ts — what the agent leaves behind when it dies.
 *
 * Why this exists: the agent died on an uncaught exception and the stack
 * existed ONLY on the operator's terminal. The activity log had nothing, no
 * crash file was written, and the stack was recovered afterwards purely because
 * a terminal pane happened to have been captured. Before this module the
 * process registered NO `uncaughtException` handler at all (see
 * shell/terminal-focus-mode.ts, which documents relying on Node's default
 * termination), so the one path that actually kills the agent was also the one
 * path that recorded nothing.
 *
 * What it guarantees, in this order, on the way out:
 *   1. a durable crash record — stack, version, pid, active session id,
 *      timestamp — in the bounded crash log under the surface root;
 *   2. a line in the shared activity log, flushed SYNCHRONOUSLY (the logger
 *      batches on a timer that a dying process never reaches);
 *   3. a descriptor write to stderr, which the full-screen output guard cannot
 *      intercept, so the operator sees it even mid-TUI;
 *   4. only then, the exit.
 *
 * Ordering is deliberate and matches cli/tui-startup.ts's fatal-boot path: the
 * cheapest, most durable sink goes first, because each later step is one more
 * chance to fail before anything has landed.
 *
 * `unhandledRejection` keeps its existing non-fatal behaviour — it notifies and
 * the process survives — but now also leaves a crash record, because "the agent
 * misbehaved but stayed up" was equally invisible after the fact.
 *
 * WHY THE RECORD LOGIC LIVES HERE rather than being imported from the SDK: the
 * canonical implementation DOES now live in the SDK
 * (platform/runtime/crash-capture.ts), where it is also registered with the
 * append-only retention registry so the platform janitor bounds it by age and
 * size for every surface. This repo pins a PUBLISHED SDK, so it cannot import
 * an unpublished export and stay green — and the whole point of this change is
 * that the agent stops dying silently NOW, not one release train from now. When
 * the SDK release carrying `crash-capture.ts` lands, this file's record
 * builder, reader and bounded appender should be deleted in favour of the SDK's
 * (the shapes and the caps were written to match exactly); the handler wiring
 * below stays.
 */
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import { createUnhandledRejectionHandler } from './unhandled-rejection-guard.ts';
import { writeFatalLine } from '../utils/fatal-boot-write.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';
import { VERSION } from '../version.ts';

/** Filename of the crash log within the agent's home-anchored surface root. */
export const CRASH_LOG_FILENAME = 'crashes.jsonl';

/**
 * Count cap on retained crash records. Small on purpose: the newest crashes are
 * the ones under investigation, and a human reads this file.
 */
export const CRASH_LOG_MAX_RECORDS = 25;

/** Cap on one record's stack, so a runaway recursion cannot evict the history around it. */
export const CRASH_STACK_MAX_CHARS = 8_000;

/** One captured process-level fault. */
export interface CrashRecord {
  readonly timestamp: string;
  readonly kind: 'uncaughtException' | 'unhandledRejection';
  readonly message: string;
  readonly stack: string | null;
  readonly version: string;
  readonly pid: number;
  readonly sessionId: string | null;
  readonly surface: string;
}

/**
 * Build a crash record from a thrown value. Never throws — a crash handler that
 * itself throws loses the very report it exists to produce, so every field
 * extraction is defensive against exotic throw values.
 */
export function buildCrashRecord(
  kind: 'uncaughtException' | 'unhandledRejection',
  thrown: unknown,
  context: { version: string; surface: string; sessionId: string | null; pid?: number; now?: () => Date },
): CrashRecord {
  let message: string;
  let stack: string | null = null;
  try {
    if (thrown instanceof Error) {
      message = thrown.message;
      stack = typeof thrown.stack === 'string'
        ? (thrown.stack.length > CRASH_STACK_MAX_CHARS
          ? `${thrown.stack.slice(0, CRASH_STACK_MAX_CHARS)}\n… stack truncated at ${CRASH_STACK_MAX_CHARS} characters`
          : thrown.stack)
        : null;
    } else {
      message = String(thrown);
    }
  } catch {
    message = '<unrepresentable throw value>';
  }
  return {
    timestamp: (context.now?.() ?? new Date()).toISOString(),
    kind,
    message,
    stack,
    version: context.version,
    pid: context.pid ?? process.pid,
    sessionId: context.sessionId,
    surface: context.surface,
  };
}

function isCrashRecord(value: unknown): value is CrashRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['timestamp'] === 'string' &&
    (record['kind'] === 'uncaughtException' || record['kind'] === 'unhandledRejection') &&
    typeof record['message'] === 'string' &&
    (record['stack'] === null || typeof record['stack'] === 'string') &&
    typeof record['version'] === 'string' &&
    typeof record['pid'] === 'number' &&
    (record['sessionId'] === null || typeof record['sessionId'] === 'string') &&
    typeof record['surface'] === 'string'
  );
}

/**
 * Read every well-formed record, oldest first. Content-validated, never
 * existence-validated: a line that does not parse or does not carry the record
 * shape is SKIPPED, so the torn tail line a crash-mid-write leaves behind still
 * yields every record before it.
 */
export function readCrashRecords(filePath: string): CrashRecord[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const records: CrashRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (isCrashRecord(parsed)) records.push(parsed);
  }
  return records;
}

/**
 * Append one record, enforcing the count cap. Best-effort by contract: returns
 * false instead of throwing, because the caller still owes an activity-log line,
 * a stderr line and an exit code even on a full or read-only disk.
 */
export function appendCrashRecord(filePath: string, record: CrashRecord): boolean {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  } catch {
    return false;
  }
  try {
    // Only pay for a read+rewrite once the file could plausibly exceed the cap.
    if (statSync(filePath).size < CRASH_LOG_MAX_RECORDS * 1024) return true;
    const records = readCrashRecords(filePath);
    if (records.length <= CRASH_LOG_MAX_RECORDS) return true;
    const kept = records.slice(records.length - CRASH_LOG_MAX_RECORDS);
    writeFileSync(filePath, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(''), { mode: 0o600 });
  } catch {
    // The record itself landed; failing to trim is not worth losing it.
    return true;
  }
  return true;
}

export interface ProcessFaultCaptureDeps {
  /** Surface a high-priority message in the running UI. */
  readonly notifyHigh: (message: string) => void;
  /** Repaint after a non-fatal fault notice. */
  readonly render: () => void;
  /** Resolves the home-anchored surface path for the crash log. */
  readonly shellPaths: { resolveUserPath: (...segments: string[]) => string };
  /** Read at fault time, not at install time — the active session changes. */
  readonly activeSessionId: () => string | null;
  /** Injectable for tests; defaults to the real process exit. */
  readonly exit?: (code: number) => void;
  /** Injectable for tests; defaults to the guaranteed descriptor write. */
  readonly writeStderr?: (line: string) => void;
}

/** Installed handlers, with the registration and teardown the caller drives. */
export interface ProcessFaultCapture {
  /** Register both process-level listeners. */
  register(): void;
  /** Remove both listeners — called from the orderly exit path. */
  dispose(): void;
  /**
   * Record a fault without registering anything. Exposed so a test can drive
   * the exact write path the handlers use.
   */
  capture(kind: 'uncaughtException' | 'unhandledRejection', thrown: unknown): void;
}

export function createProcessFaultHandlers(deps: ProcessFaultCaptureDeps): ProcessFaultCapture {
  const onUnhandledRejectionNotice = createUnhandledRejectionHandler({
    notifyHigh: deps.notifyHigh,
    render: deps.render,
  });
  const exit = deps.exit ?? ((code: number): void => { process.exit(code); });
  const writeStderr = deps.writeStderr ?? writeFatalLine;
  const crashLogPath = deps.shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, CRASH_LOG_FILENAME);

  const capture = (kind: 'uncaughtException' | 'unhandledRejection', thrown: unknown): void => {
    let sessionId: string | null = null;
    try {
      sessionId = deps.activeSessionId();
    } catch {
      // A broken accessor must not cost us the whole record.
    }
    const record = buildCrashRecord(kind, thrown, {
      version: VERSION,
      surface: GOODVIBES_AGENT_SURFACE_ROOT,
      sessionId,
    });
    try {
      appendCrashRecord(crashLogPath, record);
    } catch {
      // appendCrashRecord is already best-effort; belt and braces so a failure
      // here can never prevent the activity-log line and the stderr write.
    }
    try {
      logger.error(`[crash] ${kind}`, {
        message: record.message,
        version: record.version,
        pid: record.pid,
        sessionId: record.sessionId ?? '(none)',
        timestamp: record.timestamp,
        crashLog: crashLogPath,
        ...(record.stack ? { stack: record.stack } : {}),
      });
      // The logger batches on a timer this process will not live to see.
      logger.flushSync();
    } catch {
      // Nothing left to do about a logger that cannot write.
    }
  };

  const onUncaughtException = (error: unknown): void => {
    capture('uncaughtException', error);
    try {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      // A descriptor write cannot be intercepted by the full-screen output
      // guard, which replaces process.stderr.write while the TUI is up.
      writeStderr(`goodvibes-agent crashed: ${message}`);
      writeStderr(`crash record written to ${crashLogPath}`);
    } catch {
      // The record already landed; the console line is the expendable part.
    }
    exit(1);
  };

  const onUnhandledRejection = (reason: unknown): void => {
    capture('unhandledRejection', reason);
    // Existing behaviour preserved: notify, escalate on a cascade, stay up.
    onUnhandledRejectionNotice(reason);
  };

  return {
    register(): void {
      process.on('uncaughtException', onUncaughtException);
      process.on('unhandledRejection', onUnhandledRejection);
    },
    dispose(): void {
      process.removeListener('uncaughtException', onUncaughtException);
      process.removeListener('unhandledRejection', onUnhandledRejection);
    },
    capture,
  };
}
