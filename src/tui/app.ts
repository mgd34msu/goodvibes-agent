import { appendMessage, createAgentSession } from '../core/session.js';
import type { AssistantRuntime } from '../assistant/runtime.js';
import { CompanionChatError } from '../assistant/companion-chat.js';
import { renderAppFrame } from '../renderer/app-renderer.js';
import { ANSI } from '../renderer/ansi.js';
import { Compositor } from '../renderer/compositor.ts';
import { decodeKeys, type KeyEvent } from '../input/key-reader.js';
import {
  backspace,
  createInputBuffer,
  deleteForward,
  insertText,
  moveCursor,
  moveCursorEnd,
  moveCursorHome,
  setCursorEnd,
  type InputBufferState,
} from '../input/edit-buffer.js';
import {
  buildDashboard,
  emptyRemoteState,
  type DashboardRemoteState,
  type RemoteSnapshot,
} from './dashboard.js';
import type { DaemonDiagnosticResult } from '../daemon/client.js';
import { allowTerminalWrite, installTuiTerminalOutputGuard, type TerminalOutputGuard } from '../runtime/terminal-output-guard.ts';
import { CLEAR_SCREEN, terminalEnterSequence, terminalExitSequence } from './terminal-control.ts';

export class AgentTuiApp {
  private session = createAgentSession();
  private inputBuffer: InputBufferState = createInputBuffer();
  private status = 'Enter submits. Ctrl-J newline. Arrows edit/history. Ctrl-C/Esc exits.';
  private daemonStatus = 'Daemon: checking connection.';
  private daemonConnectionStatus = 'Daemon: checking connection.';
  private daemonDiagnostics: DaemonDiagnosticResult | null = null;
  private remoteState: DashboardRemoteState = emptyRemoteState();
  private busy = false;
  private history: string[] = [];
  private historyIndex: number | null = null;
  private draftBeforeHistory = '';
  private pasteBuffer: string | null = null;
  private stopped = false;
  private terminalActive = false;
  private stopResolve: (() => void) | null = null;
  private readonly compositor = new Compositor(process.stdout);
  private terminalOutputGuard: TerminalOutputGuard | null = null;
  private readonly dataHandler = (buffer: Buffer) => {
    void this.handleData(buffer);
  };
  private readonly resizeHandler = () => {
    this.compositor.resetDiff();
    this.render();
  };
  private readonly sigintHandler = () => this.stop();

  constructor(private readonly runtime: AssistantRuntime) {}

  async run(): Promise<void> {
    const stdin = process.stdin;
    if (!stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('The GoodVibes Agent TUI requires an interactive terminal.');
    }
    this.stopped = false;
    this.pasteBuffer = null;
    try {
      this.setupTerminal(stdin);
      this.session = appendMessage(this.session, 'system', 'GoodVibes Agent is a proactive assistant/operator surface. Build/fix work is delegated to GoodVibes TUI.');
      await this.checkDaemonCompatibility();
      await this.refreshDashboard();
      if (this.stopped) return;
      this.updateCompanionStatus();
      this.render();
      await new Promise<void>((resolve) => {
        this.stopResolve = resolve;
        if (this.stopped) resolve();
      });
    } finally {
      this.cleanupTerminal();
      this.stopResolve = null;
    }
  }

  private async handleData(buffer: Buffer): Promise<void> {
    const value = buffer.toString('utf-8');
    if (await this.handleBracketedPaste(value)) return;
    for (const key of decodeKeys(buffer)) {
      await this.handleKey(key);
      if (this.stopped) return;
    }
  }

  private async handleKey(key: KeyEvent): Promise<void> {
    if (key.type === 'ctrl-c' || key.type === 'escape') {
      this.stop();
      return;
    }
    if (this.busy) return;
    if (key.type === 'eof' && !this.inputBuffer.text) {
      this.stop();
      return;
    }
    if (key.type === 'backspace') {
      this.inputBuffer = backspace(this.inputBuffer);
      this.resetHistoryCursor();
      this.render();
      return;
    }
    if (key.type === 'delete') {
      this.inputBuffer = deleteForward(this.inputBuffer);
      this.resetHistoryCursor();
      this.render();
      return;
    }
    if (key.type === 'text') {
      this.inputBuffer = insertText(this.inputBuffer, key.value);
      this.resetHistoryCursor();
      this.render();
      return;
    }
    if (key.type === 'newline') {
      this.inputBuffer = insertText(this.inputBuffer, '\n');
      this.resetHistoryCursor();
      this.render();
      return;
    }
    if (key.type === 'cursor-left') {
      this.inputBuffer = moveCursor(this.inputBuffer, -1);
      this.render();
      return;
    }
    if (key.type === 'cursor-right') {
      this.inputBuffer = moveCursor(this.inputBuffer, 1);
      this.render();
      return;
    }
    if (key.type === 'home') {
      this.inputBuffer = moveCursorHome(this.inputBuffer);
      this.render();
      return;
    }
    if (key.type === 'end') {
      this.inputBuffer = moveCursorEnd(this.inputBuffer);
      this.render();
      return;
    }
    if (key.type === 'clear-input') {
      this.inputBuffer = createInputBuffer();
      this.resetHistoryCursor();
      this.render();
      return;
    }
    if (key.type === 'clear-screen') {
      this.forceFullRedraw();
      return;
    }
    if (key.type === 'refresh-status') {
      await this.refreshDashboard();
      this.render();
      return;
    }
    if (key.type === 'history-prev') {
      this.showHistory(-1);
      return;
    }
    if (key.type === 'history-next') {
      this.showHistory(1);
      return;
    }
    if (key.type === 'enter') {
      const text = this.inputBuffer.text.trim();
      this.inputBuffer = createInputBuffer();
      this.resetHistoryCursor();
      if (!text) {
        this.render();
        return;
      }
      if (text === '/quit' || text === '/exit') {
        this.stop();
        return;
      }
      this.pushHistory(text);
      this.session = appendMessage(this.session, 'user', text);
      this.busy = true;
      this.status = 'Working through daemon/knowledge/delegation routes.';
      this.render();
      try {
        const reply = await this.runtime.handleUserText(text);
        if (reply.text.trim()) this.session = appendMessage(this.session, 'assistant', reply.text);
        await this.refreshDashboard();
        this.updateCompanionStatus();
        this.status = 'Ready.';
      } catch (error) {
        this.session = appendMessage(this.session, 'assistant', formatError(error));
        this.status = 'Last action failed.';
      } finally {
        this.busy = false;
        this.render();
      }
    }
  }

  private render(): void {
    renderAppFrame(
      this.compositor,
      {
        session: this.session,
        input: this.inputBuffer.text,
        inputCursor: this.inputBuffer.cursor,
        status: this.status,
        daemonStatus: this.daemonStatus,
        dashboard: buildDashboard({
          runtime: this.runtime,
          daemon: this.daemonDiagnostics,
          remote: this.remoteState,
        }),
        busy: this.busy,
        provider: this.runtime.providerModel.provider ?? 'daemon',
        model: this.runtime.providerModel.model ?? this.runtime.providerModel.modelRegistryKey ?? 'daemon-default',
      },
      {
        width: process.stdout.columns || 100,
        height: process.stdout.rows || 32,
      },
    );
  }

  private forceFullRedraw(): void {
    this.compositor.resetDiff();
    allowTerminalWrite(() => {
      process.stdout.write(CLEAR_SCREEN);
    });
    this.render();
  }

  private async checkDaemonCompatibility(): Promise<void> {
    const diagnostics = await this.runtime.client.diagnostics();
    this.daemonDiagnostics = diagnostics;
    if (diagnostics.ok) {
      const version = diagnostics.compatibility?.daemonVersion ?? 'unknown';
      this.daemonConnectionStatus = `Daemon: connected ${version} at ${this.runtime.client.baseUrl}`;
      this.daemonStatus = this.daemonConnectionStatus;
      return;
    }
    this.daemonConnectionStatus = `Daemon: ${diagnostics.kind} at ${this.runtime.client.baseUrl}`;
    this.daemonStatus = this.daemonConnectionStatus;
    this.session = appendMessage(this.session, 'system', `Daemon warning: ${diagnostics.message}`);
    this.status = 'Daemon connection/auth check failed.';
  }

  private updateCompanionStatus(): void {
    const chat = this.runtime.chatStatus();
    const session = chat.sessionId ?? 'new';
    this.daemonStatus = `${this.daemonConnectionStatus} | Chat: ${session} | Model: ${chat.providerModelDisplay}`;
  }

  private async refreshDashboard(): Promise<void> {
    const [approvals, workPlan, automation, capacity] = await Promise.all([
      this.remoteSnapshot(() => this.runtime.client.invoke('approvals.list')),
      this.remoteSnapshot(() => this.runtime.client.invoke('projectPlanning.workPlan.snapshot')),
      this.remoteSnapshot(() => this.runtime.client.invoke('automation.integration.snapshot')),
      this.remoteSnapshot(() => this.runtime.client.invoke('scheduler.capacity')),
    ]);
    this.remoteState = { approvals, workPlan, automation, capacity };
  }

  private async remoteSnapshot(load: () => Promise<unknown>): Promise<RemoteSnapshot> {
    try {
      return { data: await withTimeout(load(), 2_500), error: null };
    } catch (error) {
      return { data: null, error: formatError(error) };
    }
  }

  private pushHistory(text: string): void {
    if (this.history[this.history.length - 1] !== text) this.history.push(text);
    if (this.history.length > 200) this.history = this.history.slice(-200);
  }

  private resetHistoryCursor(): void {
    this.historyIndex = null;
    this.draftBeforeHistory = '';
  }

  private showHistory(direction: -1 | 1): void {
    if (this.history.length === 0) return;
    if (this.historyIndex === null) {
      this.draftBeforeHistory = this.inputBuffer.text;
      this.historyIndex = direction < 0 ? this.history.length - 1 : null;
    } else {
      this.historyIndex += direction;
    }
    if (this.historyIndex === null || this.historyIndex >= this.history.length) {
      this.historyIndex = null;
      this.inputBuffer = setCursorEnd(this.draftBeforeHistory);
    } else if (this.historyIndex < 0) {
      this.historyIndex = 0;
      this.inputBuffer = setCursorEnd(this.history[0] ?? '');
    } else {
      this.inputBuffer = setCursorEnd(this.history[this.historyIndex] ?? '');
    }
    this.render();
  }

  private stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cleanupTerminal();
    this.stopResolve?.();
  }

  private setupTerminal(stdin: NodeJS.ReadStream): void {
    this.terminalActive = true;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', this.dataHandler);
    process.stdout.on('resize', this.resizeHandler);
    process.once('SIGINT', this.sigintHandler);
    this.terminalOutputGuard = installTuiTerminalOutputGuard({
      stdout: process.stdout,
      stderr: process.stderr,
      notify: (message) => {
        this.session = appendMessage(this.session, 'system', message);
        this.render();
      },
    });
    allowTerminalWrite(() => {
      process.stdout.write(terminalEnterSequence());
    });
  }

  private cleanupTerminal(): void {
    if (!this.terminalActive) return;
    this.terminalActive = false;
    process.stdin.off('data', this.dataHandler);
    process.stdout.off('resize', this.resizeHandler);
    process.off('SIGINT', this.sigintHandler);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    allowTerminalWrite(() => {
      process.stdout.write(terminalExitSequence() + ANSI.reset);
    });
    this.terminalOutputGuard?.dispose();
    this.terminalOutputGuard = null;
  }

  private async handleBracketedPaste(value: string): Promise<boolean> {
    const start = '\u001b[200~';
    const end = '\u001b[201~';
    if (this.pasteBuffer !== null) {
      const endIndex = value.indexOf(end);
      if (endIndex < 0) {
        this.pasteBuffer += normalizePastedText(value);
        return true;
      }
      const pasted = `${this.pasteBuffer}${normalizePastedText(value.slice(0, endIndex))}`;
      this.pasteBuffer = null;
      await this.handleKey({ type: 'text', value: pasted });
      const rest = value.slice(endIndex + end.length);
      if (rest) await this.handleData(Buffer.from(rest));
      return true;
    }

    const startIndex = value.indexOf(start);
    if (startIndex < 0) return false;

    const before = value.slice(0, startIndex);
    if (before) {
      for (const key of decodeKeys(Buffer.from(before))) await this.handleKey(key);
    }

    const afterStart = value.slice(startIndex + start.length);
    const endIndex = afterStart.indexOf(end);
    if (endIndex < 0) {
      this.pasteBuffer = normalizePastedText(afterStart);
      return true;
    }

    await this.handleKey({ type: 'text', value: normalizePastedText(afterStart.slice(0, endIndex)) });
    const rest = afterStart.slice(endIndex + end.length);
    if (rest) await this.handleData(Buffer.from(rest));
    return true;
  }
}

function formatError(error: unknown): string {
  if (error instanceof CompanionChatError) return `${error.kind}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: Timer | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`status refresh timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizePastedText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
