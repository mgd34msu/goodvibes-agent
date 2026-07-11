/**
 * Bridge to the SDK's typed permission-event emitter.
 *
 * The runtime enforces that raw `RuntimeEventBus.emit(...)` calls live only
 * behind typed emitter wrappers (see the GC-ARCH-002 enforcement test); the
 * runtime-owned wrapper for a permission-mode change is the SDK's
 * `emitPermissionModeChanged`. That function is not re-exported through any of
 * the SDK's public `exports` subpaths — it lives only at
 * `platform/runtime/emitters/permissions`, which the package's `exports` map
 * does not list — so this one isolated module reaches the built file directly
 * (the same contained deep-import exception used for the relay step-up service).
 * Callers use `emitPermissionModeChanged` and never touch `bus.emit` themselves.
 */
import type { RuntimeEventBus } from '@/runtime/index.ts';
// eslint-disable-next-line no-restricted-imports -- see file header: SDK gap, isolated here.
import { emitPermissionModeChanged as sdkEmitPermissionModeChanged } from '../../node_modules/@pellux/goodvibes-sdk/dist/platform/runtime/emitters/permissions.js';

/** Minimal emission context the SDK emitter needs (sessionId + source + traceId). */
export interface PermissionEmitterContext {
  readonly sessionId: string;
  readonly source: string;
  readonly traceId: string;
}

/**
 * Emit PERMISSION_MODE_CHANGED on the runtime bus through the SDK's typed
 * emitter, so a mid-session permission-mode change rides the wire and any
 * surface reading the stored mode refreshes live.
 */
export function emitPermissionModeChanged(
  bus: RuntimeEventBus,
  ctx: PermissionEmitterContext,
  data: { readonly mode: string; readonly previousMode: string },
): void {
  sdkEmitPermissionModeChanged(bus, ctx, data);
}
