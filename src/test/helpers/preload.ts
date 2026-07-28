/**
 * Test environment preload — loaded by bun:test via bunfig.toml [test].preload.
 *
 * Provides globals that are available in the full runtime but absent in the
 * bare bun:test runner. Add only what is genuinely missing; do NOT mock real
 * platform APIs here.
 */

import { makeProjectTempDir } from './project-temp.ts';

// Ensure fetch is available as a global (bun provides it; this is a no-op in
// most bun versions but guards against environments where it isn't set).
if (typeof globalThis.fetch === 'undefined') {
  // @ts-ignore — bun built-in, not in all type-def bundles
  globalThis.fetch = Bun.fetch;
}

/**
 * The test suite must never reach a REAL daemon.
 *
 * Config routing discovers a daemon by reading the daemon home: the operator
 * token to present, and the control-plane binding to dial. Left unset, that
 * resolves to `~/.goodvibes/daemon` — the developer's actual daemon, which is
 * usually running. A test run then does not just read the wrong settings, it
 * reaches a live process and can write to it. This is not hypothetical; it has
 * already happened once here.
 *
 * So the suite is pinned to a throwaway daemon home before any test module is
 * imported. The directory is deliberately left EMPTY: discovery finds no token
 * and no binding, concludes there is no daemon, and every daemon-owned path
 * takes its no-daemon branch. A test that genuinely wants a daemon must stand
 * one up itself and point this at it.
 *
 * An explicit value set by the caller still wins, so a harness that has already
 * arranged its own isolation is not overridden.
 */
if (!process.env['GOODVIBES_DAEMON_HOME']?.trim()) {
  process.env['GOODVIBES_DAEMON_HOME'] = makeProjectTempDir('goodvibes-agent-test-daemon-home');
}
