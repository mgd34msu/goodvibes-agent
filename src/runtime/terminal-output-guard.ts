type WritableStreamLike = {
  write: {
    (buffer: string | Uint8Array, cb?: (error?: Error | null) => void): boolean;
    (buffer: string | Uint8Array, encoding?: BufferEncoding, cb?: (error?: Error | null) => void): boolean;
  };
};

export interface TerminalOutputGuard {
  setActive(active: boolean): void;
  allowTerminalWrite<T>(fn: () => T): T;
  dispose(): void;
}

export interface TerminalOutputGuardOptions {
  readonly stdout: WritableStreamLike;
  readonly stderr?: WritableStreamLike;
  readonly active?: boolean;
  readonly notify?: (message: string) => void;
}

let currentGuard: TerminalOutputGuard | null = null;

export function allowTerminalWrite<T>(fn: () => T): T {
  return currentGuard ? currentGuard.allowTerminalWrite(fn) : fn();
}

export function installTuiTerminalOutputGuard(options: TerminalOutputGuardOptions): TerminalOutputGuard {
  const stdout = options.stdout;
  const stderr = options.stderr ?? process.stderr;
  const originalStdoutWriteMethod = stdout.write;
  const originalStderrWriteMethod = stderr.write;
  const originalStdoutWrite = (...args: readonly unknown[]): boolean =>
    Reflect.apply(originalStdoutWriteMethod, stdout, args) as boolean;
  const originalStderrWrite = (...args: readonly unknown[]): boolean =>
    Reflect.apply(originalStderrWriteMethod, stderr, args) as boolean;
  const originalConsole = {
    error: console.error.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
  };

  let active = options.active ?? true;
  let disposed = false;
  let allowDepth = 0;
  let lastNoticeAt = 0;

  const shouldPassThrough = (): boolean => !active || allowDepth > 0 || disposed;
  const suppress = (source: string, args: readonly unknown[]): boolean => {
    const callback = args[args.length - 1];
    if (typeof callback === 'function') queueMicrotask(() => callback(null));
    const now = Date.now();
    if (options.notify && now - lastNoticeAt > 5_000) {
      lastNoticeAt = now;
      options.notify(`[Terminal] Captured direct ${source} output while the TUI renderer was active.`);
    }
    return true;
  };

  stdout.write = ((...args: readonly unknown[]) => (
    shouldPassThrough() ? originalStdoutWrite(...args) : suppress('stdout', args)
  )) as WritableStreamLike['write'];
  stderr.write = ((...args: readonly unknown[]) => (
    shouldPassThrough() ? originalStderrWrite(...args) : suppress('stderr', args)
  )) as WritableStreamLike['write'];
  console.error = (...args: readonly unknown[]) => {
    if (shouldPassThrough()) return originalConsole.error(...args);
    suppress('console.error', args);
  };
  console.log = (...args: readonly unknown[]) => {
    if (shouldPassThrough()) return originalConsole.log(...args);
    suppress('console.log', args);
  };
  console.warn = (...args: readonly unknown[]) => {
    if (shouldPassThrough()) return originalConsole.warn(...args);
    suppress('console.warn', args);
  };

  const guard: TerminalOutputGuard = {
    setActive(nextActive) {
      active = nextActive;
    },
    allowTerminalWrite<T>(fn: () => T): T {
      allowDepth++;
      try {
        return fn();
      } finally {
        allowDepth--;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stdout.write = originalStdoutWriteMethod;
      stderr.write = originalStderrWriteMethod;
      console.error = originalConsole.error;
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      if (currentGuard === guard) currentGuard = null;
    },
  };
  currentGuard = guard;
  return guard;
}
