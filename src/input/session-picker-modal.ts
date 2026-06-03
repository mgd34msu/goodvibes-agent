/**
 * SessionPickerModal — state management for the /sessions picker modal.
 *
 * Lists sessions from SessionManager.list(), tracks selected index,
 * and handles load actions.
 */

import type { SessionInfo, SessionManager } from '@pellux/goodvibes-sdk/platform/sessions';
import type { ConversationManager } from '../core/conversation';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { readConversationMessageSnapshots } from '../core/conversation-message-snapshot.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

function sessionLoadedMessage(name: string, messageCount: number): string {
  return `Loaded session ${name} (${messageCount} messages)`;
}

function sessionDeletionCommandRequiredMessage(name: string): string {
  return `Deletion requires an explicit command: /session delete ${quoteSlashCommandArg(name)} --yes`;
}

export function renderSessionPickerStatePackageText(): string {
  return [
    'Loaded session <session> (<count> messages)',
    'Error',
    'Deletion requires an explicit command: /session delete <session> --yes',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// SessionPickerModal
// ---------------------------------------------------------------------------

export class SessionPickerModal {
  public active = false;
  public sessions: SessionInfo[] = [];
  public selectedIndex = 0;
  public scrollOffset = 0;
  public visibleRows = 8;
  public deleteConfirmationTarget: string | null = null;

  /** Last status message to show in the modal (e.g. error or success). */
  public statusMessage = '';

  public constructor(private readonly sessionManager: SessionManager) {}

  /**
   * Open the modal, loading sessions from SessionManager.
   */
  open(): void {
    this.sessions = this.sessionManager.list();
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.statusMessage = '';
    this.deleteConfirmationTarget = null;
    this.active = true;
  }

  close(): void {
    this.active = false;
    this.statusMessage = '';
    this.deleteConfirmationTarget = null;
  }

  moveUp(): void {
    if (this.sessions.length === 0) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.sessions.length) % this.sessions.length;
    this._clampScroll();
    this.deleteConfirmationTarget = null;
  }

  moveDown(): void {
    if (this.sessions.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.sessions.length;
    this._clampScroll();
    this.deleteConfirmationTarget = null;
  }

  setVisibleRows(rows: number): void {
    this.visibleRows = Math.max(3, rows);
    this._clampScroll();
  }

  getSelected(): SessionInfo | null {
    return this.sessions[this.selectedIndex] ?? null;
  }

  /**
   * Load the currently selected session into the given ConversationManager.
   * Returns true on success, false on error.
   */
  loadSelected(conversationManager: ConversationManager): boolean {
    const session = this.getSelected();
    if (!session) return false;

    try {
      const { meta, messages } = this.sessionManager.load(session.name);
      conversationManager.resetAll();
      conversationManager.fromJSON({ messages: readConversationMessageSnapshots(messages) });
      if (meta.title) conversationManager.title = meta.title;
      conversationManager.rebuildHistory();
      this.statusMessage = sessionLoadedMessage(session.name, messages.length);
      return true;
    } catch (e) {
      this.statusMessage = `Error ${summarizeError(e)}`;
      return false;
    }
  }

  deleteSelected(): boolean {
    const session = this.getSelected();
    if (!session) return false;
    this.deleteConfirmationTarget = null;
    this.statusMessage = sessionDeletionCommandRequiredMessage(session.name);
    return false;
  }

  private _clampScroll(): void {
    const visRows = Math.max(3, this.visibleRows);
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + visRows) {
      this.scrollOffset = this.selectedIndex - visRows + 1;
    }
    const maxOffset = Math.max(0, this.sessions.length - visRows);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
  }
}
