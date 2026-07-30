/**
 * fatal-boot-report.ts — saying why, on a descriptor, before the process stops.
 *
 * ── Provenance ────────────────────────────────────────────────────────────
 *
 * This mirrors the platform SDK's `platform/daemon/fatal-boot-report.ts`, with
 * the same three exported names. It exists locally only because the published
 * `@pellux/goodvibes-sdk` this repository compiles against (1.20.0) predates
 * that export — `reportFatalBootFailure` does not exist in the installed
 * package. Replace this file with the SDK import at the next re-pin, and keep
 * the write loop documented in `fatal-boot-write.ts` (or move it upstream).
 *
 * The primitives live in `fatal-boot-write.ts` and are re-exported here, so
 * that `bin/goodvibes-agent.ts` can share them without pulling the SDK into a
 * package that declares no runtime dependencies. See that file's header.
 *
 * ── The failure this exists to close ──────────────────────────────────────
 *
 * A shipped GoodVibes binary died mute on a fatal boot error: exit 1, zero
 * bytes on stdout, zero bytes on stderr, and no activity log written at all,
 * crash-looping with no signal to the operator beyond everything having
 * stopped. The identical source run under `bun` printed the reason loudly, so
 * every source-level test passed while every shipped build was silent.
 *
 * This surface has its own route to the same silence, and it is not the same
 * mechanism as the daemon's. `src/main.ts` installs a terminal output guard
 * (`runtime/terminal-output-guard.ts`) that REPLACES `process.stdout.write`,
 * `process.stderr.write` and every `console` method, so that stray output
 * cannot corrupt a rendered screen — an intercepted write is recorded to the
 * activity log and swallowed. Any startup failure raised after that install
 * reaches `reportFatalStartupError`, whose stderr write is then intercepted
 * and never reaches a descriptor. Measured on a compiled binary: exit 1, zero
 * bytes on both streams.
 *
 * ── Why `writeSync(2, …)` and not `process.stderr.write` ──────────────────
 *
 * Because the fatal path must not depend on anything a host can replace or
 * defer. `process.stderr.write` is a property on a mutable global, and the
 * guard above replaces it by design. It is also a stream, so a write issued
 * immediately before `process.exit()` can still be in flight when the process
 * stops existing.
 *
 * `writeSync(2, …)` is neither. It is a direct write to the file descriptor the
 * terminal or service journal is attached to, it has completed when it returns,
 * and no amount of monkey-patching upstream can intercept it. That is the whole
 * property this module exists to provide, and it is why every early-exit site
 * on this surface's startup path routes through here.
 */

import { logger, summarizeError, flushActivityLogSync } from '@pellux/goodvibes-sdk/platform/utils';
import { writeExitingStdoutLine, writeFatalLine } from './fatal-boot-write.ts';

export { writeExitingStdoutLine, writeFatalLine };

/**
 * Report a fatal boot failure everywhere it can be found, then leave the exit
 * to the caller.
 *
 * The descriptor write happens FIRST and synchronously. The activity log is
 * attempted after, because it is the part that can fail — it needs a
 * configured destination, a writable directory, and a flush — and the
 * guarantee this function makes is the stderr line, not the log line.
 */
export function reportFatalBootFailure(error: unknown, context = 'goodvibes-agent'): void {
  const summary = summarizeError(error);
  writeFatalLine(`${context} failed: ${summary}`);
  if (error instanceof Error && error.stack) writeFatalLine(error.stack);
  try {
    logger.error(`${context} failed`, { error: summary });
    flushActivityLogSync();
  } catch {
    // The reason is already on stderr, which is the guarantee. A log that
    // cannot be written must not escalate into a different failure.
  }
}
