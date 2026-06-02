import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type JsonRecord = Record<string, unknown>;

export interface ConnectedHostOperatorToken {
  readonly path: string;
  readonly present: boolean;
  readonly token: string | null;
  readonly error?: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function connectedHostOperatorTokenPath(homeDirectory: string): string {
  return join(homeDirectory, '.goodvibes', 'daemon', 'operator-tokens.json');
}

export function readConnectedHostOperatorToken(homeDirectory: string): ConnectedHostOperatorToken {
  const path = connectedHostOperatorTokenPath(homeDirectory);
  if (!existsSync(path)) return { path, present: false, token: null };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    const token = isRecord(parsed) && typeof parsed.token === 'string' && parsed.token.trim().length > 0
      ? parsed.token
      : null;
    return { path, present: true, token };
  } catch (error) {
    return { path, present: true, token: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function connectedHostTokenRequiredMessage(path: string): string {
  return [
    'Connected-host operator token is required.',
    `  token path: ${path}`,
    '  Agent does not create or rotate connected-host auth tokens.',
    '  Start or repair the owning GoodVibes host, then rerun this command.',
  ].join('\n');
}
