import { appendMessage, createAgentSession } from '../core/session.js';
import type { AssistantRuntime } from '../assistant/runtime.js';
import { renderApp } from '../renderer/app-renderer.js';
import { ANSI } from '../renderer/ansi.js';
import { decodeKey } from '../input/key-reader.js';

export class AgentTuiApp {
  private session = createAgentSession();
  private input = '';
  private status = 'Type /help for commands. Enter submits. Ctrl-C exits.';
  private busy = false;

  constructor(private readonly runtime: AssistantRuntime) {}

  async run(): Promise<void> {
    const stdin = process.stdin;
    if (!stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('The GoodVibes Agent TUI requires an interactive terminal.');
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', (buffer: Buffer) => {
      void this.handleKey(buffer);
    });
    process.stdout.on('resize', () => this.render());
    this.session = appendMessage(this.session, 'system', 'GoodVibes Agent is a proactive assistant/operator surface. Build/fix work is delegated to GoodVibes TUI.');
    this.render();
    await new Promise<void>((resolve) => {
      const stop = () => {
        stdin.setRawMode(false);
        process.stdout.write(`${ANSI.showCursor}${ANSI.reset}\n`);
        resolve();
      };
      process.once('SIGINT', stop);
    });
  }

  private async handleKey(buffer: Buffer): Promise<void> {
    const key = decodeKey(buffer);
    if (!key || this.busy) return;
    if (key.type === 'ctrl-c' || key.type === 'escape') {
      process.kill(process.pid, 'SIGINT');
      return;
    }
    if (key.type === 'backspace') {
      this.input = this.input.slice(0, -1);
      this.render();
      return;
    }
    if (key.type === 'text') {
      this.input += key.value;
      this.render();
      return;
    }
    if (key.type === 'enter') {
      const text = this.input.trim();
      this.input = '';
      if (!text) {
        this.render();
        return;
      }
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
      busy: this.busy,
    }));
  }
}
