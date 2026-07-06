/**
 * terminal-focus-mode.ts — W4-R3: DECSET ?1004h OS window-focus reporting +
 * the approval-alert wiring that consumes it.
 *
 * Extracted from main.ts (architecture line-count gate: MAX_SOURCE_LINES=800
 * in scripts/check-architecture.ts) — mirrors goodvibes-tui's own precedent of
 * extracting terminal-mode literals out of its entry file (see that repo's
 * src/renderer/terminal-escapes.ts docstring). Behavior is unchanged from an
 * inline version; this is purely a line-count extraction plus the one new
 * behavior (the approval alert) this work order adds.
 *
 * FOCUS_ENABLE/FOCUS_DISABLE: sourced from W4-R2's terminal-escapes.ts (the
 * shared home for the DECSET ?1004 literals — its own docstring names R3 as
 * the importer) and re-exported here so the focus-mode callers (main.ts and
 * the tests) keep one import site for the whole focus-mode surface. This is
 * the R2/R3 convergence the W4-R1 parity matrix pre-ruled: a relocation of
 * the literals, no behavior change.
 *
 * installFocusModeExitGuard(): a last-resort safety net. Node/Bun fire 'exit'
 * listeners synchronously for every process-termination path this app can
 * take — explicit process.exit() calls (normal /exit, double-Ctrl+C via
 * exitApp()) AND the default uncaughtException termination — even though
 * main.ts registers no explicit uncaughtException/SIGTERM handler of its own.
 * Named top-5 risk (W4-R1 matrix): ?1004h MUST be disabled on every exit path
 * or the user's shell inherits focus-reporting escape garbage. The write is
 * idempotent/harmless even on the terminal-launch-error exit path (before
 * terminal mode is ever entered) and even if exitApp() already disabled it
 * moments earlier.
 *
 * wrapRequestPermissionWithApprovalAlert(): fires an unfocused-user alert the
 * moment a tool call becomes a real, user-blocking permission prompt. Ported
 * concept from goodvibes-tui's core/approval-alert.ts, scoped down: that
 * module's config-gated alert-class system (alert-gating.ts's
 * behavior.notifyOnApprovalPending / notifyOnlyWhenUnfocused settings, shared
 * with budget-breach/long-task/chain-failure notifiers) is TUI-specific
 * infrastructure the W4-R1 parity matrix does not list as a PORT item — only
 * core/focus-tracker.ts is. This is the minimal, self-contained wiring the
 * matrix's own text calls for ("route focus in/out events ... to drive
 * awaiting-approval alerts"). PRIVACY: message content is tool name + category
 * only — no args, no file contents, no command strings.
 */
import { logger, notifyCompletion, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import type { PermissionRequestHandler, PermissionPromptRequest } from '@pellux/goodvibes-sdk/platform/permissions';
import type { FocusTracker } from '../core/focus-tracker.ts';

import { FOCUS_DISABLE } from '../renderer/terminal-escapes.ts';
export { FOCUS_ENABLE, FOCUS_DISABLE } from '../renderer/terminal-escapes.ts';

/**
 * notifyCompletion (SDK platform/utils) only rings the bell above 5s of
 * "duration" and only pops a desktop notification above 30s — a heuristic
 * tuned for long-running-turn notifications (ported alongside
 * goodvibes-tui's alert-gating.ts FORCE_NOTIFY_DURATION_MS). The
 * approval-alert wire is a point-in-time event with no natural duration, so
 * it passes this constant as durationMs to force both the bell and the
 * desktop popup unconditionally.
 */
export const FORCE_APPROVAL_NOTIFY_DURATION_MS = 30_001;

/** Registers the process-wide, idempotent ?1004h teardown safety net. Call once at startup. */
export function installFocusModeExitGuard(stdout: Pick<NodeJS.WriteStream, 'write'> = process.stdout): void {
  process.on('exit', () => {
    try { stdout.write(FOCUS_DISABLE); } catch { /* stdout may already be torn down */ }
  });
}

export interface ApprovalAlertDeps {
  readonly focusTracker: Pick<FocusTracker, 'shouldAlertWhenUnfocused'>;
  readonly notify?: typeof notifyCompletion;
}

/**
 * Wrap a PermissionRequestHandler so every call also fires an unfocused-user
 * alert. The wrapped handler's behavior (what it resolves to) is completely
 * unchanged — this only adds a side effect at call time, fired synchronously
 * before the wrapped promise settles (reflects "a prompt just appeared", not
 * "a prompt was just resolved").
 */
export function wrapRequestPermissionWithApprovalAlert(
  original: PermissionRequestHandler,
  deps: ApprovalAlertDeps,
): PermissionRequestHandler {
  const notify = deps.notify ?? notifyCompletion;
  return (request: PermissionPromptRequest) => {
    if (deps.focusTracker.shouldAlertWhenUnfocused()) {
      try {
        notify('GoodVibes — approval needed', `${request.tool} (${request.category}) is waiting for approval`, FORCE_APPROVAL_NOTIFY_DURATION_MS);
      } catch (err) {
        logger.debug('approval-alert: desktop notify error', { error: summarizeError(err) });
      }
    }
    return original(request);
  };
}
