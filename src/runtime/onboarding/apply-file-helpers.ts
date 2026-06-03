import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type RollbackAction = () => Promise<void> | void;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  if (!isPlainObject(parsed)) throw new Error(`Expected an object JSON payload at ${path}.`);
  return parsed;
}

export function writeJsonObject(path: string, payload: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

export function setNestedValue(root: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const parts = key.split('.');
  const next = structuredClone(root);
  let cursor: Record<string, unknown> = next;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]!;
    const existing = cursor[part];
    if (!isPlainObject(existing)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }

  cursor[parts[parts.length - 1]!] = structuredClone(value);
  return next;
}

export function restoreFile(path: string, previous: string | null, reload?: () => void): void {
  if (previous === null) {
    if (existsSync(path)) unlinkSync(path);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, previous, 'utf-8');
  }
  reload?.();
}

export function snapshotFileRollback(path: string, reload?: () => void): RollbackAction {
  const previous = existsSync(path) ? readFileSync(path, 'utf-8') : null;
  return () => restoreFile(path, previous, reload);
}

export async function runRollbacks(rollbacks: readonly RollbackAction[]): Promise<readonly string[]> {
  const errors: string[] = [];
  for (const rollback of [...rollbacks].reverse()) {
    try {
      await rollback();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
}
