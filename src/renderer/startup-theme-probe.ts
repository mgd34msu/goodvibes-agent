/**
 * startup-theme-probe.ts (W4-R4) — install the OSC-11 background probe at
 * startup and wire its resolved mode to the ported theme system.
 *
 * Thin composition seam extracted from main.ts: it binds R2's
 * installBackgroundThemeProbe to theme.ts's setActiveThemeMode (applyThemeMode)
 * so forced dark/light applies before first paint and auto (TTY only) probes and
 * repaints once if light wins. The returned handle's filterInput() must gate the
 * stdin data handler so the OSC-11 reply never reaches the tokenizer.
 */

import { installBackgroundThemeProbe, type ThemeProbeHandle } from './terminal-bg-probe.ts';
import { setActiveThemeMode } from './theme.ts';
import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';

export interface StartupThemeProbeDeps {
  readonly configManager: Pick<ConfigManager, 'get'>;
  readonly stdout: NodeJS.WriteStream;
  /** The caller's terminal-output guard wrapper (allowTerminalWrite). */
  readonly writeAllowed: (write: () => void) => void;
  /** Reset the compositor diff so the repaint after a light reply is full. */
  readonly resetDiff: () => void;
  readonly render: () => void;
}

export function installStartupThemeProbe(deps: StartupThemeProbeDeps): ThemeProbeHandle {
  return installBackgroundThemeProbe({
    configManager: deps.configManager,
    applyThemeMode: setActiveThemeMode,
    isTTY: Boolean(deps.stdout.isTTY),
    env: process.env,
    writeQuery: (b) => deps.writeAllowed(() => deps.stdout.write(b)),
    requestRepaint: () => { deps.resetDiff(); deps.render(); },
  });
}
