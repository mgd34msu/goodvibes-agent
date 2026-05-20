export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = Record<string, JsonValue>;

export interface CommandResult {
  readonly ok: boolean;
  readonly output?: string | undefined;
  readonly error?: string | undefined;
  readonly data?: unknown | undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asJsonRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) return {};
  return value as JsonRecord;
}

export function firstString(value: unknown, keys: readonly string[]): string {
  if (!isRecord(value)) return '';
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}
