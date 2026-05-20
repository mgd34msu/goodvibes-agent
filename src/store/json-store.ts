import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export class JsonStore<T> {
  constructor(
    readonly path: string,
    private readonly fallback: T,
  ) {}

  read(): T {
    try {
      if (!existsSync(this.path)) return this.fallback;
      return JSON.parse(readFileSync(this.path, 'utf-8')) as T;
    } catch {
      return this.fallback;
    }
  }

  write(value: T): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600 });
    renameSync(tmp, this.path);
    try {
      chmodSync(this.path, 0o600);
    } catch {
      // Best-effort on platforms where chmod is not meaningful.
    }
  }

  update(mutator: (value: T) => T): T {
    const next = mutator(this.read());
    this.write(next);
    return next;
  }
}
