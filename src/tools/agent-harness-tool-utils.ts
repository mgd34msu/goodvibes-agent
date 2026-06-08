import type { AgentHarnessToolArgs } from './agent-harness-tool-types.ts';

export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function settingLookupArgs(args: AgentHarnessToolArgs) {
  return {
    key: readString(args.key) || undefined,
    target: readString(args.target) || undefined,
    query: readString(args.query) || undefined,
    category: readString(args.category) || undefined,
    prefix: readString(args.prefix) || undefined,
    includeHidden: args.includeHidden === true,
  };
}

export function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

export function readFieldMap(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry === 'string' ? entry : String(entry)]));
}

export function output(value: unknown): { readonly success: true; readonly output: string } {
  return {
    success: true,
    output: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  };
}

export function error(message: string): { readonly success: false; readonly error: string } { return { success: false, error: message }; }

export function requireConfirmedAction(args: AgentHarnessToolArgs, action: string): string | null {
  const explicitUserRequest = readString(args.explicitUserRequest);
  if (!explicitUserRequest) return `${action} requires explicitUserRequest with the user's exact request or a short faithful summary.`;
  if (args.confirm !== true) return `${action} requires confirm:true after an explicit user request.`;
  return null;
}
