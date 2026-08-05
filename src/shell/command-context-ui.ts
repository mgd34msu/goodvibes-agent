/**
 * command-context-ui.ts — the shell actions a command can invoke that do
 * nothing but change what is on screen.
 *
 * `/clear` wipes the viewport, Ctrl+O pins or unpins the activity sidebar, and
 * a permission ask parks the prompt until someone answers it. Each is a couple
 * of statements over the shell's own state, and each ends the same way: repaint.
 *
 * They live here rather than inline in main.ts because they are the shell's UI
 * verbs rather than part of its startup sequence, and because main.ts is at its
 * size budget — a file that has to stay readable is not the place to keep three
 * unrelated closures that only share the fact that they were convenient there.
 */

import { allowTerminalWrite } from '@pellux/goodvibes-terminal-shell';
import { CLEAR_VIEWPORT_HOME } from '../renderer/terminal-escapes.ts';
import type { PendingPermissionState } from './blocking-input.ts';

/** What a permission ask resolves with once the person answers it. */
export interface PermissionAnswer {
  readonly approved: boolean;
  readonly remember: boolean;
}

export interface CommandContextUiOptions {
  readonly compositor: { resetDiff(): void };
  readonly stdout: { write(chunk: string): unknown };
  readonly render: () => void;
  /** Current terminal width, read at the moment the action runs. */
  readonly terminalWidth: () => number;
  /** Whether the sidebar would be visible at `width` with no override set. */
  readonly sidebarVisibleAt: (width: number) => boolean;
  readonly setSidebarOverride: (visible: boolean) => void;
  readonly setPendingPermission: (pending: PendingPermissionState) => void;
}

export interface CommandContextUi {
  /** Reset the diff and wipe the viewport, then repaint. */
  clearScreen(): void;
  /** Pin the sidebar to the opposite of what it is showing right now. */
  toggleActivitySidebar(): void;
  /**
   * Park a permission ask on screen and resolve once it is answered.
   *
   * The promise is the answer; the repaint is what makes the prompt appear.
   */
  requestPermission(request: Omit<PendingPermissionState, 'resolve'>): Promise<PermissionAnswer>;
}

export function createCommandContextUi(options: CommandContextUiOptions): CommandContextUi {
  return {
    clearScreen: (): void => {
      options.compositor.resetDiff();
      allowTerminalWrite(() => options.stdout.write(CLEAR_VIEWPORT_HOME));
      options.render();
    },
    toggleActivitySidebar: (): void => {
      // Read the width now: the terminal may have been resized since the last
      // paint, and pinning against a stale width would toggle the wrong way.
      options.setSidebarOverride(!options.sidebarVisibleAt(options.terminalWidth()));
      options.render();
    },
    requestPermission: (request) => new Promise<PermissionAnswer>((resolve) => {
      options.setPendingPermission({
        ...request,
        resolve: (approved: boolean, remember = false) => resolve({ approved, remember }),
      } as PendingPermissionState);
      options.render();
    }),
  };
}
