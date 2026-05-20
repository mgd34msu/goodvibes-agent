import { RegistryConflictError, RegistryNotFoundError } from '../store/errors.js';
import { formatJson } from '../utils/format.js';
import { z } from 'zod';

export interface CliSuccess<T> {
  readonly ok: true;
  readonly kind: string;
  readonly data: T;
}

export interface CliFailure {
  readonly ok: false;
  readonly kind: string;
  readonly error: string;
}

export function printSuccess<T>(kind: string, data: T): number {
  console.log(formatJson({ ok: true, kind, data } satisfies CliSuccess<T>));
  return 0;
}

export function printFailure(kind: string, error: string): number {
  console.log(formatJson({ ok: false, kind, error } satisfies CliFailure));
  return 1;
}

export function printCaughtFailure(error: unknown): number {
  if (error instanceof z.ZodError) {
    return printFailure('config_error', formatZodError(error));
  }
  if (error instanceof RegistryNotFoundError || error instanceof RegistryConflictError) {
    return printFailure(error.kind, error.message);
  }
  if (error instanceof Error) return printFailure('error', error.message);
  return printFailure('error', String(error));
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'config';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
