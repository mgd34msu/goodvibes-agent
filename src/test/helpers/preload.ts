/**
 * Test environment preload — loaded by bun:test via bunfig.toml [test].preload.
 *
 * Provides globals that are available in the full runtime but absent in the
 * bare bun:test runner. Add only what is genuinely missing; do NOT mock real
 * platform APIs here.
 */

// Ensure fetch is available as a global (bun provides it; this is a no-op in
// most bun versions but guards against environments where it isn't set).
if (typeof globalThis.fetch === 'undefined') {
  // @ts-ignore — bun built-in, not in all type-def bundles
  globalThis.fetch = Bun.fetch;
}
