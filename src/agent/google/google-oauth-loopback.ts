/**
 * google-oauth-loopback.ts — the OAuth 2.0 authorization-code + PKCE flow used
 * by the Path B ("oauth") Google setup, driven through a local loopback
 * redirect (the Desktop app client type; see google-setup-plan.ts).
 *
 * Two of Google's own rules shape this file directly (see the header comment
 * in google-setup-plan.ts for sources): the authorization URL must carry both
 * `access_type=offline` and `prompt=consent`, or Google will not reliably
 * hand back a refresh token — without a refresh token the seven-day Testing
 * expiry (also documented there) has no automatic renewal path at all.
 *
 * Every function returns a typed result and never throws for an expected
 * failure. No token, refresh token, client secret, authorization code, or
 * PKCE verifier ever appears in a returned message, a thrown error, or a log
 * line — `redactSecretsFromMessage` is the one place that scrubs incidental
 * leakage (for example a raw network-error message that happened to echo
 * back part of a request).
 */

import { createHash, randomBytes } from 'node:crypto';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

export interface AuthorizationUrlOptions {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly codeChallenge: string;
  readonly state: string;
}

/**
 * Builds the Google authorization URL for the loopback flow. Always includes
 * `access_type=offline` and `prompt=consent` — both are required for Google
 * to reliably issue a refresh token on this and every later authorization.
 */
export function buildAuthorizationUrl(options: AuthorizationUrlOptions): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', options.scopes.join(' '));
  url.searchParams.set('code_challenge', options.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', options.state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

export interface PkcePair {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

/** Generates an RFC 7636 S256 code-verifier/code-challenge pair. */
export function generatePkcePair(): PkcePair {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Loopback listener
// ---------------------------------------------------------------------------

export interface StartLoopbackListenerOptions {
  /**
   * The `state` value this run generated. A redirect whose `state` does not
   * match is rejected rather than accepted — this is the CSRF defense for the
   * flow and it is enforced here, at the point the redirect is received.
   */
  readonly expectedState: string;
  /** Ephemeral port when omitted (0 asks the OS to pick a free one). */
  readonly port?: number;
  /** Defaults to 127.0.0.1; loopback flows must never bind a public interface. */
  readonly host?: string;
}

export interface LoopbackCodeResult {
  readonly code: string;
  readonly state: string;
}

export interface LoopbackListener {
  readonly redirectUri: string;
  /** Resolves with the captured code, or rejects on error/mismatch/timeout. */
  waitForCode(timeoutMs: number): Promise<LoopbackCodeResult>;
  close(): void;
}

/**
 * Starts the local HTTP listener the browser redirects back to. Resolves as
 * soon as the server is bound; the first well-formed redirect it receives
 * settles `waitForCode()` — later redirects to the same server are ignored.
 */
export function startLoopbackListener(options: StartLoopbackListenerOptions): LoopbackListener {
  const host = options.host ?? '127.0.0.1';
  let settled = false;
  let activeTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveCode!: (result: LoopbackCodeResult) => void;
  let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<LoopbackCodeResult>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // Attach a handler immediately, at creation, so this promise is never
  // reported as an unhandled rejection. `waitForCode` hands back this exact
  // promise (deliberately not a Promise.race derivative — a promise created
  // by racing does not inherit this early handler, and Bun.serve treats an
  // unhandled rejection surfacing during request handling as a fatal error) so
  // callers still observe the real resolution or rejection.
  codePromise.catch(() => undefined);

  const server = Bun.serve({
    hostname: host,
    port: options.port ?? 0,
    fetch(request: Request): Response {
      const url = new URL(request.url);
      const errorParam = url.searchParams.get('error');
      const stateParam = url.searchParams.get('state');
      const codeParam = url.searchParams.get('code');

      if (errorParam) {
        settle(() => rejectCode(new Error(`Google returned an authorization error: ${errorParam}`)));
        return htmlResponse(
          renderErrorPage(`Google reported: ${errorParam}. You can close this tab and try again.`),
          400,
        );
      }
      if (stateParam !== options.expectedState) {
        settle(() =>
          rejectCode(new Error('The redirect state parameter did not match the value this run generated.')),
        );
        return htmlResponse(
          renderErrorPage('This sign-in link does not match the request that started it. Please try again.'),
          400,
        );
      }
      if (!codeParam) {
        settle(() => rejectCode(new Error('Google redirected with no authorization code.')));
        return htmlResponse(renderErrorPage('No authorization code was returned. Please try again.'), 400);
      }
      settle(() => resolveCode({ code: codeParam, state: stateParam }));
      return htmlResponse(renderSuccessPage(), 200);
    },
  });

  function settle(action: () => void): void {
    if (settled) return;
    settled = true;
    if (activeTimer) clearTimeout(activeTimer);
    action();
  }

  const redirectUri = `http://${host}:${server.port}/`;

  return {
    redirectUri,
    waitForCode(timeoutMs: number): Promise<LoopbackCodeResult> {
      activeTimer = setTimeout(() => {
        settle(() => rejectCode(new Error('Timed out waiting for the browser redirect.')));
      }, timeoutMs);
      return codePromise;
    },
    close(): void {
      if (activeTimer) clearTimeout(activeTimer);
      server.stop(true);
    },
  };
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function renderSuccessPage(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connected</title></head>
<body style="font-family: system-ui, sans-serif; text-align: center; padding: 4rem 1rem;">
<h1>You're connected</h1>
<p>You can close this tab; the agent is connected.</p>
</body></html>`;
}

function renderErrorPage(message: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Could not connect</title></head>
<body style="font-family: system-ui, sans-serif; text-align: center; padding: 4rem 1rem;">
<h1>Could not connect</h1>
<p>${escapeHtml(message)}</p>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/** The narrow fetch surface the token calls need, injected so they are testable. */
export interface GoogleFetchPort {
  fetch(url: string, init: RequestInit): Promise<Response>;
}

export interface TokenResponseOk {
  readonly ok: true;
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresInSeconds: number;
  readonly scope: string;
  readonly tokenType: string;
}
export interface TokenResponseFailed {
  readonly ok: false;
  readonly problem: string;
  readonly fix: string;
}
export type TokenResponse = TokenResponseOk | TokenResponseFailed;

export interface ExchangeCodeOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

/** Exchanges an authorization code (+ PKCE verifier) for tokens. */
export async function exchangeCodeForTokens(
  options: ExchangeCodeOptions,
  fetchPort: GoogleFetchPort,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: options.clientId,
    client_secret: options.clientSecret,
    code: options.code,
    code_verifier: options.codeVerifier,
    redirect_uri: options.redirectUri,
    grant_type: 'authorization_code',
  });
  return postToken(fetchPort, body, [options.clientSecret, options.code, options.codeVerifier]);
}

export interface RefreshTokenOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

/** Exchanges a refresh token for a fresh access token. */
export async function refreshAccessToken(
  options: RefreshTokenOptions,
  fetchPort: GoogleFetchPort,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: options.clientId,
    client_secret: options.clientSecret,
    refresh_token: options.refreshToken,
    grant_type: 'refresh_token',
  });
  return postToken(fetchPort, body, [options.clientSecret, options.refreshToken]);
}

async function postToken(
  fetchPort: GoogleFetchPort,
  body: URLSearchParams,
  secretsToRedact: readonly string[],
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetchPort.fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (error) {
    return {
      ok: false,
      problem: `The token request could not be sent: ${redactSecretsFromMessage(describeError(error), secretsToRedact)}`,
      fix: 'Check network access to oauth2.googleapis.com and try again.',
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      problem: 'Google did not return a parseable JSON response from the token endpoint.',
      fix: 'Try the sign-in again; if it keeps happening, check the client id and secret are correct.',
    };
  }

  if (!response.ok) {
    const errorField = isRecord(payload) && typeof payload['error'] === 'string' ? payload['error'] : 'unknown_error';
    const errorDescription =
      isRecord(payload) && typeof payload['error_description'] === 'string' ? payload['error_description'] : '';
    return {
      ok: false,
      problem: redactSecretsFromMessage(
        `Google rejected the token request (${errorField}).${errorDescription ? ` ${errorDescription}` : ''}`,
        secretsToRedact,
      ),
      fix:
        errorField === 'invalid_grant'
          ? 'The authorization code or refresh token is no longer valid — start the sign-in flow again.'
          : 'Check the client id and client secret are correct and try again.',
    };
  }

  if (!isRecord(payload) || typeof payload['access_token'] !== 'string' || typeof payload['expires_in'] !== 'number') {
    return {
      ok: false,
      problem: 'The token response from Google was missing required fields.',
      fix: 'Try the sign-in again; if it keeps happening this may reflect a change in Google\'s token response shape.',
    };
  }

  const refreshTokenValue = typeof payload['refresh_token'] === 'string' ? payload['refresh_token'] : undefined;
  const scope = typeof payload['scope'] === 'string' ? payload['scope'] : '';
  const tokenType = typeof payload['token_type'] === 'string' ? payload['token_type'] : 'Bearer';

  return {
    ok: true,
    accessToken: payload['access_token'],
    ...(refreshTokenValue ? { refreshToken: refreshTokenValue } : {}),
    expiresInSeconds: payload['expires_in'],
    scope,
    tokenType,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Scrubs any of `secrets` out of `message`, replacing each occurrence with
 * `[redacted]`. Used as a last line of defense on incidental strings (for
 * example a network-error message) that might otherwise echo a secret value
 * back into a returned problem string or a log line. Ignores blank or very
 * short candidate values so it never redacts on an empty string.
 */
export function redactSecretsFromMessage(message: string, secrets: readonly (string | undefined)[]): string {
  let redacted = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 4 && redacted.includes(secret)) {
      redacted = redacted.split(secret).join('[redacted]');
    }
  }
  return redacted;
}
