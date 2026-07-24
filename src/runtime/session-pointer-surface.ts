import { writeLastSessionPointer } from '@/runtime/index.ts';
import type { SessionSurface } from '@/runtime/index.ts';

/**
 * Binds the SDK's two-argument `writeLastSessionPointer(sessionId, options?)`
 * to a single `SessionSurface`, returning a plain `(sessionId: string) => void`.
 *
 * Never pass the raw SDK function reference itself to a `(sessionId: string)
 * => void` slot: a function with an extra optional parameter is structurally
 * assignable there, so it compiles, but every downstream caller
 * (bootstrap-shell.ts -> bootstrap-hook-bridge.ts's resumeSession handler)
 * invokes it with exactly one argument — `options` then comes through
 * `undefined`, hitting the legacy compat path's `requireWorkingDirectory(undefined)`
 * failure, which writeLastSessionPointer's own try/catch swallows into a
 * logged warning. The pointer file then silently never gets written after a
 * resume — the same bug class that broke the TUI's resume journey. See
 * bootstrap-hook-bridge.test.ts's regression test for the on-disk proof.
 */
export function bindWriteLastSessionPointerToSurface(surface: SessionSurface): (sessionId: string) => void {
  return (sessionId: string): void => writeLastSessionPointer(sessionId, { surface });
}
