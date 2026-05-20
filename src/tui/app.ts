import { appendMessage, createAgentSession } from '../core/session.js';
import type { AssistantRuntime } from '../assistant/runtime.js';
import { renderApp } from '../renderer/app-renderer.js';
import { ANSI } from '../renderer/ansi.js';
import { decodeKeys, type KeyEvent } from '../input/key-reader.js';

export class AgentTuiApp {
  private session = createAgentSession();
  private input = '';
  private status = 'Enter submits. Ctrl-J inserts newline. Up/Down history. Ctrl-C/Esc exits.';
  private daemonStatus = 'Daemon: checking connection.';
  private busy = false;
  private history: string[] = [];
  private historyIndex: number | null = null;
  private draftBeforeHistory = '';
  private pasteBuffer: string | null = null;
  private stopped = false;
  private terminalActive = false;
  private stopResolve: (() => void) | null = null;
  private readonly dataHandler = (buffer: Buffer) => {
    void this.handleData(buffer);
  };
  private readonly resizeHandler = () => this.render();
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
      if (this.stopped) return;
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
    if (key.type === 'eof' && !this.input) {
      this.stop();
      return;
    }
    if (key.type === 'backspace') {
      this.input = this.input.slice(0, -1);
      this.resetHistoryCursor();
      this.render();
      return;
    }
    if (key.type === 'text') {
      this.input += key.value;
      this.resetHistoryCursor();
      this.render();
      return;
    }
    if (key.type === 'newline') {
      this.input += '\n';
      this.resetHistoryCursor();
      this.render();
      return;
    }
    if (key.type === 'clear-input') {
      this.input = '';
      this.resetHistoryCursor();
      this.render();
      return;
    }
    if (key.type === 'clear-screen') {
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
      const text = this.input.trim();
      this.input = '';
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
        this.status = 'Ready.';
      } catch (error) {
        this.session = appendMessage(this.session, 'assistant', error instanceof Error ? error.message : String(error));
        this.status = 'Last action failed.';
      } finally {
        this.busy = false;
        this.render();
      }
    }
  }

  private render(): void {
    process.stdout.write(renderApp({
      session: this.session,
      input: this.input,
      status: this.status,
      daemonStatus: this.daemonStatus,
      busy: this.busy,
    }));
  }

  private async checkDaemonCompatibility(): Promise<void> {
    const diagnostics = await this.runtime.client.diagnostics();
    if (diagnostics.ok) {
      const version = diagnostics.compatibility?.daemonVersion ?? 'unknown';
      this.daemonStatus = `Daemon: connected ${version} at ${this.runtime.client.baseUrl}`;
      return;
    }
    this.daemonStatus = `Daemon: ${diagnostics.kind} at ${this.runtime.client.baseUrl}`;
    this.session = appendMessage(this.session, 'system', `Daemon warning: ${diagnostics.message}`);
    this.status = 'Daemon connection/auth check failed.';
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
      this.draftBeforeHistory = this.input;
      this.historyIndex = direction < 0 ? this.history.length - 1 : null;
    } else {
      this.historyIndex += direction;
    }
    if (this.historyIndex === null || this.historyIndex >= this.history.length) {
      this.historyIndex = null;
      this.input = this.draftBeforeHistory;
    } else if (this.historyIndex < 0) {
      this.historyIndex = 0;
      this.input = this.history[0] ?? '';
    } else {
      this.input = this.history[this.historyIndex] ?? '';
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
    process.stdout.write(ANSI.bracketedPasteOn);
  }

  private cleanupTerminal(): void {
    if (!this.terminalActive) return;
    this.terminalActive = false;
    process.stdin.off('data', this.dataHandler);
    process.stdout.off('resize', this.resizeHandler);
    process.off('SIGINT', this.sigintHandler);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write(`${ANSI.bracketedPasteOff}${ANSI.showCursor}${ANSI.reset}\n`);
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

function normalizePastedText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
