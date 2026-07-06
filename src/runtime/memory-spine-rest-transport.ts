/**
 * memory-spine-rest-transport.ts
 *
 * The agent's REST transport adapter for the SDK's memory spine
 * (`@pellux/goodvibes-sdk/platform/runtime/memory-spine`). The daemon's canonical
 * memory store is single-writer: once this agent process has adopted a daemon, every
 * memory operation must go over the wire and the agent must never open its own copy
 * of the store file. This file is the thin REST mirror that realizes that wire —
 * hand-rolled rather than a typed daemon client, for the same version-tolerance
 * reason as session-spine-rest-transport.ts (the agent may run against an older
 * pinned SDK/daemon pair that predates one of these routes).
 *
 * HONEST-FAILURE CONTRACT. Unlike the session mirror (fire-and-forget, degrades to
 * an offline queue), a memory read/write returns data the caller actually uses. So
 * every method here either resolves with the real record/result or REJECTS the
 * promise — it never invents a placeholder success and never silently falls back to
 * a local copy. That fallback decision belongs to the caller (MemorySpineClient),
 * which is deliberately built so its wire branch never touches the local store.
 *
 * Reuses the connection resolver and reachability probe already built for the
 * session spine (session-spine-rest-transport.ts) — same daemon, same connected-host
 * token, one resolver for both spines.
 */

import type {
  MemoryAddOptions,
  MemoryRecord,
  MemorySearchFilter,
} from '@pellux/goodvibes-sdk/platform/state';
import type { HonestMemorySearchOptions, HonestMemorySearchResult } from '@pellux/goodvibes-sdk/platform/state';
import type { MemoryTransport } from '@pellux/goodvibes-sdk/platform/runtime/memory-spine';
import type { SessionRegistrationConnection } from '../agent/session-registration.ts';

// MemoryReviewPatch is not part of the public `platform/state` barrel export (only
// the SDK's internal memory-store module has it), so its shape is derived from the
// MemoryTransport method signature itself rather than importing an unexported type.
type MemoryReviewPatch = Parameters<MemoryTransport['updateReview']>[1];

const DEFAULT_MEMORY_WIRE_TIMEOUT_MS = 2_000;

export interface MemorySpineRestTransportOptions {
  readonly resolveConnection: () => SessionRegistrationConnection;
  readonly timeoutMs?: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorDetail(body: unknown): string {
  return isRecord(body) && typeof body.error === 'string' ? body.error : '';
}

/**
 * The one fetch wrapper every memory-wire call goes through. Throws (never
 * returns an ok:false envelope) on a missing token, a non-2xx response, or a
 * network/timeout failure — the honest-failure contract above.
 */
async function wireFetch(
  connection: SessionRegistrationConnection,
  path: string,
  init: { readonly method: 'GET' | 'POST' | 'DELETE'; readonly body?: JsonRecord },
  timeoutMs: number,
): Promise<unknown> {
  if (!connection.token) {
    throw new Error(connection.tokenPath
      ? `memory spine: no connected-host operator token found at ${connection.tokenPath}`
      : 'memory spine: no connected-host operator token found');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${connection.baseUrl}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${connection.token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    });
    const body = await readJsonBody(response);
    if (!response.ok) {
      const detail = errorDetail(body);
      throw new Error(`memory spine: HTTP ${response.status} on ${path}${detail ? `: ${detail}` : ''}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function requireRecord(body: unknown, path: string): MemoryRecord {
  if (isRecord(body) && isRecord(body.record)) return body.record as unknown as MemoryRecord;
  throw new Error(`memory spine: malformed response from ${path} (missing record)`);
}

/**
 * Builds the wire `MemoryTransport` the agent injects into `MemorySpineClient` once
 * it has confirmed a daemon is adopted. Mirrors the five daemon-owned
 * `memory.records.*` routes exactly (see method-catalog-runtime.ts in the SDK):
 * POST /api/memory/records, POST /api/memory/records/search,
 * GET/DELETE /api/memory/records/{id}, POST /api/memory/records/{id}/review.
 */
export function createMemorySpineRestTransport(options: MemorySpineRestTransportOptions): MemoryTransport {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MEMORY_WIRE_TIMEOUT_MS;

  return {
    async add(opts: MemoryAddOptions): Promise<MemoryRecord> {
      const connection = options.resolveConnection();
      const body = await wireFetch(connection, '/api/memory/records', { method: 'POST', body: opts as unknown as JsonRecord }, timeoutMs);
      return requireRecord(body, '/api/memory/records');
    },

    async honestSearch(filter: MemorySearchFilter, searchOptions?: HonestMemorySearchOptions): Promise<HonestMemorySearchResult> {
      const connection = options.resolveConnection();
      const requestBody: JsonRecord = { ...filter, ...(searchOptions?.recall ? { recall: true } : {}) };
      const body = await wireFetch(connection, '/api/memory/records/search', { method: 'POST', body: requestBody }, timeoutMs);
      if (!isRecord(body) || !Array.isArray(body.records)) {
        throw new Error('memory spine: malformed response from /api/memory/records/search (missing records)');
      }
      return body as unknown as HonestMemorySearchResult;
    },

    async get(id: string): Promise<MemoryRecord | null> {
      const connection = options.resolveConnection();
      try {
        const body = await wireFetch(connection, `/api/memory/records/${encodeURIComponent(id)}`, { method: 'GET' }, timeoutMs);
        return requireRecord(body, '/api/memory/records/{id}');
      } catch (error) {
        // A 404 (unknown id) is an honest "not found", not a transport failure —
        // fold it to null exactly like the local store's `get()` does. Every
        // other failure (network, auth, malformed body) still rejects.
        if (error instanceof Error && error.message.includes('HTTP 404')) return null;
        throw error;
      }
    },

    async updateReview(id: string, patch: MemoryReviewPatch): Promise<MemoryRecord | null> {
      const connection = options.resolveConnection();
      try {
        const body = await wireFetch(connection, `/api/memory/records/${encodeURIComponent(id)}/review`, { method: 'POST', body: patch as unknown as JsonRecord }, timeoutMs);
        return requireRecord(body, '/api/memory/records/{id}/review');
      } catch (error) {
        if (error instanceof Error && error.message.includes('HTTP 404')) return null;
        throw error;
      }
    },

    async delete(id: string): Promise<boolean> {
      const connection = options.resolveConnection();
      const body = await wireFetch(connection, `/api/memory/records/${encodeURIComponent(id)}`, { method: 'DELETE' }, timeoutMs);
      // The route always answers 200 with an honest { id, deleted } boolean (never a
      // 200 that pretends a phantom row was removed) — see integration-routes.ts.
      return isRecord(body) && body.deleted === true;
    },
  };
}
