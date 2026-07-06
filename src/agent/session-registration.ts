/**
 * session-registration.ts
 *
 * Raw-REST mirror of the daemon's shared-session registration surface, written
 * verbatim in the spirit of {@link ./operator-actions.ts}: request/response only,
 * a Bearer token, an AbortController timeout, and the SAME classifyHttpFailure
 * semantics (404 -> route unavailable, 401/403 -> auth required, network -> host
 * unavailable). It deliberately imports NO SDK register/client types so the
 * committed build compiles against the pinned npm @pellux/goodvibes-sdk (0.38.0),
 * which does not ship POST /api/sessions/register at all. Against a 0.38.0 daemon
 * this 404-degrades honestly; against a newer daemon (the sdk-dev overlay) it
 * registers a real kind:'agent' record.
 *
 * Canonical vs transport axis (the S1 TRANSPORT ⊂ CANONICAL split): the record
 * identity kind is ALWAYS 'agent' (see {@link SESSION_REGISTER_KIND}); the
 * participant.surfaceKind carries the transport axis ('service' for this surface)
 * and is NEVER set to 'agent'. `kind` is intentionally absent from the caller
 * input so an unknown kind can never be emitted.
 */

export type JsonRecord = Record<string, unknown>;

/** Only ever emitted value for the canonical record kind. */
export const SESSION_REGISTER_KIND = 'agent' as const;
export const SESSION_REGISTER_PATH = '/api/sessions/register';

/** Default interactive-path wire timeout, mirrors external-runtime.ts fetchJson. */
export const SESSION_REGISTER_TIMEOUT_MS = 1500;
/** Best-effort close-on-shutdown budget; short so it never blocks teardown. */
export const SESSION_CLOSE_TIMEOUT_MS = 500;

export type SessionRegistrationFailureKind =
  | 'auth_required'
  | 'connected_host_unavailable'
  | 'connected_host_route_unavailable'
  | 'connected_host_error';

export interface SessionRegistrationConnection {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly tokenPath?: string;
}

/** The participant triple carried onto the record; surfaceKind is the TRANSPORT axis. */
export interface SessionRegistrationParticipant {
  readonly surfaceKind: string;
  readonly surfaceId: string;
  readonly externalId?: string;
  readonly userId?: string;
  readonly displayName?: string;
  readonly routeId?: string;
  readonly lastSeenAt: number;
}

/**
 * Caller input for a register/heartbeat upsert. NOTE: no `kind` field — the
 * builder always stamps SESSION_REGISTER_KIND. Omitting `title` yields a
 * heartbeat that never renames a titled session; omitting `reopen` keeps a
 * closed session closed.
 */
export interface SessionRegistrationInput {
  readonly sessionId: string;
  readonly project?: string;
  readonly title?: string;
  readonly participant: SessionRegistrationParticipant;
  readonly reopen?: boolean;
}

export interface SessionRegisterRequest {
  readonly path: string;
  readonly method: 'POST';
  readonly body: JsonRecord;
}

export interface SessionMutationRequest {
  readonly path: string;
  readonly method: 'POST';
}

export interface SessionRecordSummary {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly project?: string;
  readonly title?: string;
}

/**
 * Honest outcome discriminator. 'still_closed' is the heartbeat-resurrection
 * guard: a 200 that carries conflict:{status:'closed'} with reopened:false MUST NOT
 * be read as 'registered' or 'reopened'.
 */
export type SessionRegisterOutcome = 'registered' | 'reopened' | 'still_closed';

export interface SessionRegisterSuccess {
  readonly ok: true;
  readonly outcome: SessionRegisterOutcome;
  readonly reopened: boolean;
  readonly conflict?: { readonly status: string };
  readonly session?: SessionRecordSummary;
}

export interface SessionMutationFailure {
  readonly ok: false;
  readonly kind: SessionRegistrationFailureKind;
  readonly status?: number;
  readonly error: string;
}

export type SessionRegisterResult = SessionRegisterSuccess | SessionMutationFailure;
export type SessionCloseResult = { readonly ok: true } | SessionMutationFailure;

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Identical failure classification to operator-actions.ts:246-266 — 401/403 is
 * auth, 404 is a missing route (the 0.38.0 / pre-spine daemon), anything else is
 * a generic connected-host error.
 */
function classifyHttpFailure(status: number, body: unknown): SessionMutationFailure {
  const detail = isRecord(body) && typeof body.error === 'string' ? body.error : '';
  return {
    ok: false,
    status,
    kind: status === 401 || status === 403
      ? 'auth_required'
      : status === 404
        ? 'connected_host_route_unavailable'
        : 'connected_host_error',
    error: `HTTP ${status}${detail ? `: ${detail}` : ''}`,
  };
}

export function buildSessionRegisterRequest(input: SessionRegistrationInput): SessionRegisterRequest {
  const participant: JsonRecord = {
    surfaceKind: input.participant.surfaceKind,
    surfaceId: input.participant.surfaceId,
    lastSeenAt: input.participant.lastSeenAt,
  };
  if (input.participant.externalId) participant.externalId = input.participant.externalId;
  if (input.participant.userId) participant.userId = input.participant.userId;
  if (input.participant.displayName) participant.displayName = input.participant.displayName;
  if (input.participant.routeId) participant.routeId = input.participant.routeId;

  const body: JsonRecord = {
    sessionId: input.sessionId,
    kind: SESSION_REGISTER_KIND,
    participant,
  };
  if (input.project) body.project = input.project;
  if (input.title) body.title = input.title;
  // reopen is sent ONLY when explicitly true — the user resume verb. A heartbeat
  // (reopen omitted) leaves a closed session closed.
  if (input.reopen === true) body.reopen = true;

  return { path: SESSION_REGISTER_PATH, method: 'POST', body };
}

export function buildSessionCloseRequest(sessionId: string): SessionMutationRequest {
  return { path: `/api/sessions/${encodeURIComponent(sessionId)}/close`, method: 'POST' };
}

function summarizeSession(value: unknown): SessionRecordSummary | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === 'string' ? value.id : '';
  if (!id) return undefined;
  return {
    id,
    kind: typeof value.kind === 'string' ? value.kind : '',
    status: typeof value.status === 'string' ? value.status : '',
    ...(typeof value.project === 'string' ? { project: value.project } : {}),
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
  };
}

function interpretRegisterResponse(body: unknown): SessionRegisterSuccess {
  const record = isRecord(body) ? body : {};
  const reopened = record.reopened === true;
  const conflict = isRecord(record.conflict) && typeof record.conflict.status === 'string'
    ? { status: record.conflict.status }
    : undefined;
  const session = summarizeSession(record.session);
  const outcome: SessionRegisterOutcome = reopened
    ? 'reopened'
    : conflict?.status === 'closed'
      ? 'still_closed'
      : 'registered';
  return {
    ok: true,
    outcome,
    reopened,
    ...(conflict ? { conflict } : {}),
    ...(session ? { session } : {}),
  };
}

export async function postSessionRegister(
  connection: SessionRegistrationConnection,
  input: SessionRegistrationInput,
  options: { readonly timeoutMs?: number } = {},
): Promise<SessionRegisterResult> {
  if (!connection.token) {
    return {
      ok: false,
      kind: 'auth_required',
      error: connection.tokenPath
        ? `no connected-host operator token found at ${connection.tokenPath}`
        : 'no connected-host operator token found',
    };
  }
  const request = buildSessionRegisterRequest(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SESSION_REGISTER_TIMEOUT_MS);
  try {
    const response = await fetch(`${connection.baseUrl}${request.path}`, {
      method: request.method,
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    const body = await readResponseBody(response);
    if (!response.ok) return classifyHttpFailure(response.status, body);
    return interpretRegisterResponse(body);
  } catch (error) {
    return { ok: false, kind: 'connected_host_unavailable', error: summarizeError(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function postSessionClose(
  connection: SessionRegistrationConnection,
  sessionId: string,
  options: { readonly timeoutMs?: number } = {},
): Promise<SessionCloseResult> {
  if (!connection.token) {
    return {
      ok: false,
      kind: 'auth_required',
      error: connection.tokenPath
        ? `no connected-host operator token found at ${connection.tokenPath}`
        : 'no connected-host operator token found',
    };
  }
  const request = buildSessionCloseRequest(sessionId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SESSION_CLOSE_TIMEOUT_MS);
  try {
    const response = await fetch(`${connection.baseUrl}${request.path}`, {
      method: request.method,
      headers: { authorization: `Bearer ${connection.token}` },
      signal: controller.signal,
    });
    const body = await readResponseBody(response);
    if (!response.ok) return classifyHttpFailure(response.status, body);
    return { ok: true };
  } catch (error) {
    return { ok: false, kind: 'connected_host_unavailable', error: summarizeError(error) };
  } finally {
    clearTimeout(timer);
  }
}
