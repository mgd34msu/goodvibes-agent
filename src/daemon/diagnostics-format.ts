import { isRecord } from '../types.js';
import type { DaemonDiagnosticResult, DaemonCompatibilityResult } from './client.js';

type ReadonlyUnknownRecord = Readonly<Record<string, unknown>>;

export interface AuthSummary {
  readonly authenticated: boolean | null;
  readonly authMode: string | null;
  readonly tokenPresent: boolean | null;
  readonly authorizationHeaderPresent: boolean | null;
  readonly sessionCookiePresent: boolean | null;
  readonly principalId: string | null;
  readonly principalKind: string | null;
  readonly admin: boolean | null;
  readonly scopesCount: number;
  readonly readScopesCount: number;
  readonly writeScopesCount: number;
  readonly scopesPreview: readonly string[];
  readonly rolesCount: number;
  readonly rolesPreview: readonly string[];
}

export interface DaemonCompatibilitySummary {
  readonly ok: boolean;
  readonly daemonVersion: string | null;
  readonly expectedVersion: string;
  readonly reason: string;
}

export interface DaemonDiagnosticSummary {
  readonly ok: boolean;
  readonly kind: DaemonDiagnosticResult['kind'];
  readonly baseUrl: string;
  readonly compatibility: DaemonCompatibilitySummary | null;
  readonly auth: AuthSummary;
  readonly message: string;
}

export function summarizeAuth(auth: unknown): AuthSummary {
  const record = recordOrEmpty(auth);
  const scopes = stringsValue(record, 'scopes');
  const roles = stringsValue(record, 'roles');
  return {
    authenticated: booleanValue(record, 'authenticated'),
    authMode: stringValue(record, 'authMode'),
    tokenPresent: booleanValue(record, 'tokenPresent'),
    authorizationHeaderPresent: booleanValue(record, 'authorizationHeaderPresent'),
    sessionCookiePresent: booleanValue(record, 'sessionCookiePresent'),
    principalId: nullableStringValue(record, 'principalId'),
    principalKind: nullableStringValue(record, 'principalKind'),
    admin: booleanValue(record, 'admin'),
    scopesCount: scopes.length,
    readScopesCount: scopes.filter((scope) => scope.startsWith('read:')).length,
    writeScopesCount: scopes.filter((scope) => scope.startsWith('write:')).length,
    scopesPreview: scopes.slice(0, 8),
    rolesCount: roles.length,
    rolesPreview: roles.slice(0, 8),
  };
}

export function summarizeDaemonDiagnostics(diagnostics: DaemonDiagnosticResult): DaemonDiagnosticSummary {
  return {
    ok: diagnostics.ok,
    kind: diagnostics.kind,
    baseUrl: diagnostics.baseUrl,
    compatibility: diagnostics.compatibility ? summarizeCompatibility(diagnostics.compatibility) : null,
    auth: summarizeAuth(diagnostics.auth),
    message: diagnostics.message,
  };
}

export function formatDaemonDiagnostics(diagnostics: DaemonDiagnosticResult): string {
  const summary = summarizeDaemonDiagnostics(diagnostics);
  const compatibility = summary.compatibility;
  const auth = summary.auth;
  const lines = [
    `Daemon: ${summary.kind} at ${summary.baseUrl}`,
    `Compatibility: ${compatibility ? `${compatibility.daemonVersion ?? 'unknown'} expected ${compatibility.expectedVersion}` : 'unknown'}`,
    `Auth: ${auth.authenticated === true ? 'authenticated' : 'not authenticated'} (${auth.authMode ?? 'unknown'})`,
  ];
  if (auth.principalId || auth.principalKind) {
    lines.push(`Principal: ${auth.principalId ?? 'unknown'}${auth.principalKind ? ` [${auth.principalKind}]` : ''}`);
  }
  lines.push(`Token: ${auth.tokenPresent === true ? 'present' : 'not present'}; header ${auth.authorizationHeaderPresent === true ? 'present' : 'not present'}; cookie ${auth.sessionCookiePresent === true ? 'present' : 'not present'}`);
  lines.push(`Scopes: ${auth.scopesCount} (${auth.readScopesCount} read, ${auth.writeScopesCount} write)`);
  if (auth.rolesCount > 0) lines.push(`Roles: ${auth.rolesPreview.join(', ')}${auth.rolesCount > auth.rolesPreview.length ? ` (+${auth.rolesCount - auth.rolesPreview.length} more)` : ''}`);
  lines.push(summary.message);
  return lines.join('\n');
}

function summarizeCompatibility(compatibility: DaemonCompatibilityResult): DaemonCompatibilitySummary {
  return {
    ok: compatibility.ok,
    daemonVersion: compatibility.daemonVersion ?? null,
    expectedVersion: compatibility.expectedVersion,
    reason: compatibility.reason,
  };
}

function recordOrEmpty(value: unknown): ReadonlyUnknownRecord {
  return isRecord(value) ? value : {};
}

function stringValue(record: ReadonlyUnknownRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableStringValue(record: ReadonlyUnknownRecord, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanValue(record: ReadonlyUnknownRecord, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function stringsValue(record: ReadonlyUnknownRecord, key: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}
