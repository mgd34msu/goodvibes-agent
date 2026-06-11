/**
 * Minimal IMAP4rev1 client over an injectable transport socket.
 *
 * Scope and honest boundaries
 * ────────────────────────────
 * Supported:
 *   - LOGIN with plain credentials (tag AUTH LOGIN user pass)
 *   - EXAMINE INBOX (read-only SELECT; messages are never marked \Seen)
 *   - SEARCH UNSEEN and SEARCH SINCE <date>
 *   - FETCH BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] — envelope
 *   - FETCH BODY.PEEK[TEXT]<0.N> — bounded plain-text body preview
 *   - XOAUTH2 pass-through: if imapPassword starts with 'Bearer ' the client
 *     sends AUTHENTICATE XOAUTH2 with the base64-encoded SASL token; token
 *     acquisition is out of scope.
 *   - {n} literal continuations on server responses
 *   - Per-await timeouts via AbortSignal
 *   - LOGOUT
 *
 * Not supported (document boundaries):
 *   - IDLE / NOTIFY push
 *   - STARTTLS upgrade (use TLS-direct port 993)
 *   - Full MIME multipart decoding; only the first raw text block is returned
 *   - Message UID operations (uses sequence numbers)
 *   - APPEND, COPY, MOVE, EXPUNGE
 *   - Credentials are never logged; callers must not log them either
 *
 * Transport injection
 * ────────────────────
 * Accept a `SocketLike` instead of creating a TLS socket directly so that
 * unit tests can supply a plain net.Socket connected to an in-process fake
 * server.  Production callers pass the result of `createImapTlsSocket()`.
 */

import type { Socket } from 'node:net';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ImapEnvelope {
  readonly uid: number;
  readonly from: string;
  readonly subject: string;
  readonly date: string;
  readonly messageId: string;
}

export interface ImapMessage extends ImapEnvelope {
  readonly bodyPreview: string;
}

export interface ImapClientOptions {
  /** Pre-connected socket (TLS for prod, plain for tests). */
  readonly socket: Socket;
  /** IMAP LOGIN username. */
  readonly username: string;
  /** IMAP LOGIN password or 'Bearer <token>' for XOAUTH2 pass-through. */
  readonly password: string;
  /** Per-operation timeout in milliseconds. Default: 15 000. */
  readonly timeoutMs?: number;
  /** Maximum body preview bytes to fetch. Default: 4096. */
  readonly maxBodyBytes?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 4_096;
const CRLF = '\r\n';

function buildXOAuth2Token(username: string, bearerToken: string): string {
  const sasl = `user=${username}\x01auth=${bearerToken}\x01\x01`;
  return Buffer.from(sasl).toString('base64');
}

/**
 * Wraps a Socket with line-buffered async reading and tagged command writing.
 * Owns a single shared read cursor; callers must not interleave awaits.
 */
// ---------------------------------------------------------------------------
// IMAP credential quoting (SEC-2: LOGIN injection prevention)
// ---------------------------------------------------------------------------

/**
 * Reject credentials containing CR or LF — these cannot be safely represented
 * in any IMAP quoted-string or literal.
 * Then return the credential as an RFC 3501 quoted string:
 *   - backslashes escaped as \\\\
 *   - double-quotes escaped as \\"
 * If the result would contain characters outside of printable US-ASCII
 * (which quoted strings cannot hold per RFC 3501), throw a plain-language error.
 */
export function imapQuoteCredential(value: string, name: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(
      `Invalid IMAP ${name}: credentials must not contain carriage return or newline characters.`,
    );
  }
  // RFC 3501 quoted-string is 7-bit only: only printable US-ASCII (0x20–0x7E) is
  // allowed. Reject anything outside that range — control chars (0x00–0x1F, 0x7F)
  // and 8-bit bytes (0x80–0xFF) both produce malformed wire data.
  if (/[^\x20-\x7e]/.test(value)) {
    throw new Error(
      `Invalid IMAP ${name}: credentials must be printable US-ASCII characters; 8-bit or control characters aren't supported.`,
    );
  }
  // Escape backslash and double-quote per RFC 3501 §4.3
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

class ImapSession {
  private readonly socket: Socket;
  private readonly timeoutMs: number;
  private readonly literalCap: number;
  private buffer = '';
  private tagCounter = 0;

  constructor(socket: Socket, timeoutMs: number, literalCap: number) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.literalCap = literalCap;
    this.socket.setEncoding('utf8');
  }

  // -------------------------------------------------------------------------
  // Low-level I/O
  // -------------------------------------------------------------------------

  /** Read lines until the predicate returns the accumulated lines or null. */
  private async readUntil(
    predicate: (lines: string[]) => string[] | null,
  ): Promise<string[]> {
    const lines: string[] = [];

    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('IMAP read timeout'));
      }, this.timeoutMs);

      const onData = (chunk: string): void => {
        this.buffer += chunk;
        let pos: number;
        while ((pos = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, pos).replace(/\r$/, '');
          this.buffer = this.buffer.slice(pos + 1);
          lines.push(line);
          const result = predicate(lines);
          if (result !== null) {
            cleanup();
            resolve(result);
            return;
          }
        }
      };

      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };

      const onClose = (): void => {
        cleanup();
        reject(new Error('IMAP connection closed unexpectedly'));
      };

      const cleanup = (): void => {
        clearTimeout(timer);
        this.socket.off('data', onData);
        this.socket.off('error', onError);
        this.socket.off('close', onClose);
      };

      this.socket.on('data', onData);
      this.socket.on('error', onError);
      this.socket.on('close', onClose);

      // Flush any already-buffered data
      if (this.buffer.length > 0) {
        onData('');
      }
    });
  }

  /** Read the server greeting. */
  async readGreeting(): Promise<void> {
    await this.readUntil((lines) => {
      const last = lines[lines.length - 1] ?? '';
      if (last.startsWith('* OK') || last.startsWith('* PREAUTH')) return lines;
      if (last.startsWith('* BYE')) return lines; // rejected
      return null;
    });
  }

  /** Send a tagged IMAP command and collect all response lines through completion. */
  async command(text: string): Promise<string[]> {
    this.tagCounter += 1;
    const tag = `A${String(this.tagCounter).padStart(4, '0')}`;
    const raw = `${tag} ${text}${CRLF}`;

    await this.write(raw);
    return this.readTaggedResponse(tag);
  }

  /**
   * Collect response lines for a tagged command, handling {n} literals.
   * A literal is signalled by a server response line ending with {<n>}.
   * We read exactly n bytes of literal data then continue line reading.
   */
  private async readTaggedResponse(tag: string): Promise<string[]> {
    const lines: string[] = [];

    return new Promise<string[]>((resolve, reject) => {
      let literalBytesRemaining = 0;
      let literalAccum = '';
      let literalOwnerLine = '';
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`IMAP command ${tag} timed out`));
      }, this.timeoutMs);

      const flush = (): void => {
        let pos: number;
        while (this.buffer.length > 0) {
          if (literalBytesRemaining > 0) {
            const take = Math.min(literalBytesRemaining, this.buffer.length);
            literalAccum += this.buffer.slice(0, take);
            this.buffer = this.buffer.slice(take);
            literalBytesRemaining -= take;
            if (literalBytesRemaining === 0) {
              lines.push(`${literalOwnerLine}${literalAccum}`);
              literalAccum = '';
              literalOwnerLine = '';
            }
            continue;
          }

          pos = this.buffer.indexOf('\n');
          if (pos === -1) break;

          const line = this.buffer.slice(0, pos).replace(/\r$/, '');
          this.buffer = this.buffer.slice(pos + 1);

          // Check for literal continuation
          const literalMatch = /\{(\d+)\}$/.exec(line);
          if (literalMatch) {
            const requested = parseInt(literalMatch[1] ?? '0', 10);
            // SEC-3: cap server-supplied literal size to prevent memory DoS
            if (requested > this.literalCap) {
              cleanup();
              reject(new Error(
                `IMAP server sent an oversized literal ({${requested}} bytes, ` +
                `max allowed: ${this.literalCap}). The operation has been aborted.`,
              ));
              return;
            }
            literalBytesRemaining = requested;
            literalOwnerLine = line.slice(0, line.lastIndexOf('{')) + ' ';
            continue;
          }

          lines.push(line);

          // Tagged completion
          if (line.startsWith(`${tag} OK`) || line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) {
            cleanup();
            if (line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) {
              reject(new Error(`IMAP command failed: ${line}`));
            } else {
              resolve(lines);
            }
            return;
          }
        }
      };

      const onData = (chunk: string): void => {
        this.buffer += chunk;
        flush();
      };

      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };

      const onClose = (): void => {
        cleanup();
        reject(new Error('IMAP connection closed during command'));
      };

      const cleanup = (): void => {
        clearTimeout(timer);
        this.socket.off('data', onData);
        this.socket.off('error', onError);
        this.socket.off('close', onClose);
      };

      this.socket.on('data', onData);
      this.socket.on('error', onError);
      this.socket.on('close', onClose);

      // Flush already-buffered data
      flush();
    });
  }

  private write(data: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.socket.write(data, 'utf8', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  destroy(): void {
    try {
      this.socket.destroy();
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Header parsing helpers
// ---------------------------------------------------------------------------

function extractHeader(rawHeaders: string, name: string): string {
  const lower = rawHeaders.toLowerCase();
  const needle = `\n${name.toLowerCase()}:`;
  let start = lower.indexOf(needle);
  if (start === -1) {
    // Check beginning of string too
    if (lower.startsWith(`${name.toLowerCase()}:`)) {
      start = -1 * name.length; // will handle below
    } else {
      return '';
    }
  }
  const valueStart = start === -1
    ? name.length + 1
    : start + needle.length;
  const rawSlice = rawHeaders.slice(valueStart);
  // Fold continuation lines (RFC 2822 folding)
  const end = rawSlice.search(/\n(?![\t ])/);
  const raw = end === -1 ? rawSlice : rawSlice.slice(0, end);
  return raw.replace(/\r?\n[\t ]+/g, ' ').trim();
}

function parseSequenceNumbers(searchResponse: readonly string[]): number[] {
  const nums: number[] = [];
  for (const line of searchResponse) {
    if (!line.startsWith('* SEARCH')) continue;
    const parts = line.slice(9).trim().split(/\s+/);
    for (const part of parts) {
      const n = parseInt(part, 10);
      if (!isNaN(n) && n > 0) nums.push(n);
    }
  }
  return nums;
}

function parseFetchHeaders(fetchLines: readonly string[]): Record<number, string> {
  const result: Record<number, string> = {};
  let seqNum = 0;
  let headerAccum = '';
  let inBody = false;

  for (const line of fetchLines) {
    const fetchStart = /^\* (\d+) FETCH/.exec(line);
    if (fetchStart) {
      seqNum = parseInt(fetchStart[1] ?? '0', 10);
      headerAccum = '';
      inBody = true;
      // The literal content may be appended after the header-fields marker on the same line
      const afterFetch = line.slice(fetchStart[0].length);
      const literalAfter = afterFetch.indexOf(' ') !== -1 ? afterFetch.slice(afterFetch.indexOf(' ') + 1) : '';
      if (literalAfter && !literalAfter.startsWith('(')) {
        headerAccum += literalAfter + '\n';
      }
      continue;
    }
    if (inBody) {
      if (line === ')') {
        if (seqNum > 0) result[seqNum] = headerAccum;
        inBody = false;
        seqNum = 0;
        headerAccum = '';
      } else {
        headerAccum += line + '\n';
      }
    }
  }
  return result;
}

function parseFetchBody(fetchLines: readonly string[]): Record<number, string> {
  const result: Record<number, string> = {};
  let seqNum = 0;
  let bodyAccum = '';
  let inBody = false;

  for (const line of fetchLines) {
    const fetchStart = /^\* (\d+) FETCH/.exec(line);
    if (fetchStart) {
      seqNum = parseInt(fetchStart[1] ?? '0', 10);
      bodyAccum = '';
      inBody = true;
      // literal content appended after BODY.PEEK[TEXT] tag
      const afterLiteral = line.slice(line.indexOf(' ', fetchStart[0].length) + 1);
      if (afterLiteral && !afterLiteral.includes('BODY')) {
        bodyAccum += afterLiteral + '\n';
      }
      continue;
    }
    if (inBody) {
      if (line === ')') {
        if (seqNum > 0) result[seqNum] = bodyAccum;
        inBody = false;
        seqNum = 0;
        bodyAccum = '';
      } else {
        bodyAccum += line + '\n';
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Formatted date for SINCE queries
// ---------------------------------------------------------------------------

const IMAP_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function formatImapDate(date: Date): string {
  const d = date.getDate();
  const m = IMAP_MONTHS[date.getMonth()] ?? 'Jan';
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
}

// ---------------------------------------------------------------------------
// Public client
// ---------------------------------------------------------------------------

export class ImapClient {
  private readonly options: ImapClientOptions;

  constructor(options: ImapClientOptions) {
    this.options = options;
  }

  /**
   * Connect and authenticate. Must be called before any fetch operations.
   * Uses EXAMINE (read-only) so messages are never marked \Seen.
   */
  async open(): Promise<void> {
    const session = this.session();
    await session.readGreeting();
    await this.authenticate(session);
    await session.command('EXAMINE INBOX');
  }

  /**
   * Search for unseen messages. Returns sequence numbers.
   * Pass sinceDate to restrict to messages since a date.
   */
  async searchUnseen(sinceDate?: Date): Promise<number[]> {
    const session = this.session();
    const criterion = sinceDate
      ? `UNSEEN SINCE ${formatImapDate(sinceDate)}`
      : 'UNSEEN';
    const lines = await session.command(`SEARCH ${criterion}`);
    return parseSequenceNumbers(lines);
  }

  /**
   * Fetch envelope headers for an array of sequence numbers.
   * Uses BODY.PEEK so messages remain unread.
   * Returns at most `limit` messages (most recent first, approximate).
   */
  async fetchEnvelopes(seqNums: readonly number[], limit = 20): Promise<ImapEnvelope[]> {
    if (seqNums.length === 0) return [];
    const session = this.session();
    const bounded = seqNums.slice(-limit); // take the last N (highest seq = newest)
    const set = bounded.join(',');
    const lines = await session.command(
      `FETCH ${set} BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)]`,
    );
    const headersMap = parseFetchHeaders(lines);
    const envelopes: ImapEnvelope[] = [];
    for (const seqNum of bounded) {
      const raw = headersMap[seqNum] ?? '';
      envelopes.push({
        uid: seqNum,
        from: extractHeader(raw, 'From'),
        subject: extractHeader(raw, 'Subject'),
        date: extractHeader(raw, 'Date'),
        messageId: extractHeader(raw, 'Message-ID'),
      });
    }
    return envelopes;
  }

  /**
   * Fetch a bounded body preview for a single message.
   * Uses BODY.PEEK[TEXT]<0.N> so message stays unread.
   */
  async fetchBodyPreview(seqNum: number): Promise<string> {
    const session = this.session();
    const maxBytes = this.options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const lines = await session.command(
      `FETCH ${seqNum} BODY.PEEK[TEXT]<0.${maxBytes}>`,
    );
    const bodyMap = parseFetchBody(lines);
    return (bodyMap[seqNum] ?? '').slice(0, maxBytes);
  }

  /** Send LOGOUT and destroy the socket. */
  async logout(): Promise<void> {
    const session = this.session();
    try {
      await session.command('LOGOUT');
    } finally {
      session.destroy();
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private session(): ImapSession {
    const maxBodyBytes = this.options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    // SEC-3: cap literal size at the larger of 1 MB or 4× the configured body preview limit
    const literalCap = Math.max(1_048_576, 4 * maxBodyBytes);
    return new ImapSession(
      this.options.socket,
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      literalCap,
    );
  }

  private async authenticate(session: ImapSession): Promise<void> {
    const { username, password } = this.options;
    if (password.startsWith('Bearer ')) {
      // XOAUTH2 pass-through
      const token = buildXOAuth2Token(username, password.slice(7));
      await session.command(`AUTHENTICATE XOAUTH2 ${token}`);
    } else {
      // LOGIN — credentials are quoted per RFC 3501 to prevent injection (SEC-2).
      // Credentials are not logged anywhere in this module.
      const quotedUser = imapQuoteCredential(username, 'username');
      const quotedPass = imapQuoteCredential(password, 'password');
      await session.command(`LOGIN ${quotedUser} ${quotedPass}`);
    }
  }
}

// ---------------------------------------------------------------------------
// TLS socket factory (production)
// ---------------------------------------------------------------------------

/**
 * Creates a TLS socket connected to an IMAP server on port 993 (or custom).
 * Returns a connected Socket ready to pass to ImapClient.
 */
export function createImapTlsSocket(
  host: string,
  port: number,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const { connect } = require('node:tls') as typeof import('node:tls');
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`IMAP TLS connect timeout to ${host}:${port}`));
    }, timeoutMs);

    const sock = connect({ host, port, servername: host }, () => {
      clearTimeout(timer);
      resolve(sock as unknown as Socket);
    });

    sock.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
