/**
 * Email service — config, secret resolution, and orchestration.
 *
 * Config namespace: email.*
 * ─────────────────────────
 * The SDK's ConfigKey union is sealed and does not include email keys.
 * Email settings are accessed via ensureEmailConfigDefaults(), which
 * injects the email section into the ConfigManager's live config object
 * before first use. This follows the same pattern as other app-layer
 * categories that extend beyond the SDK's built-in schema.
 *
 * Settings registered:
 *   email.enabled        boolean   — feature gate (default: false)
 *   email.imapHost       string    — IMAP TLS host (default: '')
 *   email.imapPort       number    — default 993
 *   email.smtpHost       string    — SMTP submission host (default: '')
 *   email.smtpPort       number    — 465 (TLS) or 587 (STARTTLS, default)
 *   email.username       string    — login username (default: '')
 *   email.passwordRef    string    — goodvibes:// secret reference only;
 *                                    NEVER a raw password
 *   email.fromAddress    string    — From: address for outbound mail
 *
 * Secret resolution
 * ─────────────────
 * `email.passwordRef` must be a goodvibes secret reference string.
 * The service calls `secretsManager.get(resolvedKey)` using the same
 * SecretsManager instance already wired in CommandContext.platform.
 * Plaintext passwords in config are rejected at validation time.
 */

import { ImapClient, createImapTlsSocket } from './imap-client.ts';
import { SmtpClient, createSmtpTlsSocket, createSmtpStartTlsSocket } from './smtp-client.ts';
import type { ImapEnvelope } from './imap-client.ts';
import type { Socket } from 'node:net';

// ---------------------------------------------------------------------------
// Email defaults injection
// ---------------------------------------------------------------------------

/** Email section defaults — injected once per ConfigManager instance. */
const EMAIL_DEFAULTS = {
  enabled: false,
  imapHost: '',
  imapPort: 993,
  smtpHost: '',
  smtpPort: 587,
  username: '',
  passwordRef: '',
  fromAddress: '',
} as const;

/**
 * Inject the email config section into the ConfigManager's live config
 * object if it is not already present.
 *
 * The SDK's DEFAULT_CONFIG does not include an email section because email
 * is an app-layer feature. ConfigManager.resolvePath() walks the live config
 * object and throws for any section that does not exist. Calling this helper
 * once before any email.* access ensures the traversal succeeds.
 *
 * The helper is safe to call multiple times — it is a no-op after the first
 * call for a given configManager instance.
 */
export function ensureEmailConfigDefaults(
  configManager: object,
): void {
  // Use the internal config object via an opaque cast. This is the sanctioned
  // app-layer extension pattern for categories absent from the SDK schema.
  const cm = configManager as unknown as { config: Record<string, unknown> };
  if (cm.config && !('email' in cm.config)) {
    cm.config['email'] = { ...EMAIL_DEFAULTS };
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EmailConfig {
  readonly enabled: boolean;
  readonly imapHost: string;
  readonly imapPort: number;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly username: string;
  /** Secret reference string — never a raw password. */
  readonly passwordRef: string;
  readonly fromAddress: string;
}

export interface EmailSummary {
  readonly from: string;
  readonly subject: string;
  readonly date: string;
  readonly unread: boolean;
  /** First ~4 KB of the plain-text body, fetched read-only. Empty string when unavailable. */
  readonly bodyPreview: string;
}

export interface SendMailOptions {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  /** Must be true at the call site; the service rejects sends without it. */
  readonly confirm: boolean;
}

export interface EmailServiceDeps {
  /** Untyped config getter — mirrors the pattern used in channels-command tests. */
  readonly getConfig: (key: string) => unknown;
  /** SecretsManager-compatible interface for resolving secret refs. */
  readonly secretsManager: {
    readonly get: (key: string) => Promise<string | null>;
  };
  /** Optional socket factory override for IMAP (injected in tests). */
  readonly imapSocketFactory?: (host: string, port: number) => Promise<Socket>;
  /** Optional socket factory override for SMTP (injected in tests). */
  readonly smtpSocketFactory?: (host: string, port: number) => Promise<Socket>;
}

// ---------------------------------------------------------------------------
// Config reading
// ---------------------------------------------------------------------------

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return isFinite(n) ? n : fallback;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function readEmailConfig(getConfig: (key: string) => unknown): EmailConfig {
  return {
    enabled: readBoolean(getConfig('email.enabled'), false),
    imapHost: readString(getConfig('email.imapHost')),
    imapPort: readNumber(getConfig('email.imapPort'), 993),
    smtpHost: readString(getConfig('email.smtpHost')),
    smtpPort: readNumber(getConfig('email.smtpPort'), 587),
    username: readString(getConfig('email.username')),
    passwordRef: readString(getConfig('email.passwordRef')),
    fromAddress: readString(getConfig('email.fromAddress')),
  };
}

export function validateEmailConfig(config: EmailConfig): string[] {
  const errors: string[] = [];
  if (!config.imapHost) errors.push('email.imapHost is required');
  if (!config.smtpHost) errors.push('email.smtpHost is required');
  if (!config.username) errors.push('email.username is required');
  if (!config.passwordRef) {
    errors.push('email.passwordRef is required (must be a secret reference, not a raw password)');
  } else if (!config.passwordRef.startsWith('goodvibes://secrets/')) {
    errors.push('email.passwordRef must be a goodvibes secret reference (goodvibes://secrets/...)');
  }
  if (!config.fromAddress) errors.push('email.fromAddress is required');
  return errors;
}

// ---------------------------------------------------------------------------
// Secret resolution
// ---------------------------------------------------------------------------

/**
 * Extract the storage key from a goodvibes://secrets/goodvibes/<key> ref.
 * For other secret ref types (env, file, bitwarden, etc.) we cannot resolve
 * them directly — the user should configure via the standard secret manager
 * path. We return the raw ref string for those cases so the SecretsManager
 * can attempt its own resolution chain.
 */
function extractSecretKey(passwordRef: string): string {
  const prefix = 'goodvibes://secrets/goodvibes/';
  if (passwordRef.startsWith(prefix)) {
    return decodeURIComponent(passwordRef.slice(prefix.length));
  }
  // Return the full ref for the SDK SecretsManager to resolve
  return passwordRef;
}

export async function resolveEmailPassword(
  passwordRef: string,
  secretsManager: { readonly get: (key: string) => Promise<string | null> },
): Promise<string> {
  const key = extractSecretKey(passwordRef);
  const value = await secretsManager.get(key);
  if (!value) {
    throw new Error(
      'Email password secret could not be resolved. ' +
      'Verify that email.passwordRef points to a configured secret.',
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// EmailService
// ---------------------------------------------------------------------------

export class EmailService {
  private readonly deps: EmailServiceDeps;

  constructor(deps: EmailServiceDeps) {
    this.deps = deps;
  }

  /** Returns a redacted status summary — never includes secret values. */
  getStatus(): { config: EmailConfig; errors: string[]; ready: boolean } {
    const config = readEmailConfig(this.deps.getConfig);
    const errors = validateEmailConfig(config);
    return {
      config: {
        ...config,
        // Redact the ref itself for display; keep structural info only
        passwordRef: config.passwordRef ? '[configured]' : '[missing]',
      },
      errors,
      ready: errors.length === 0 && config.enabled,
    };
  }

  /**
   * Fetch up to `limit` inbox summaries.
   * Messages are read via EXAMINE (read-only); unread flag is never modified.
   */
  async checkInbox(limit = 10): Promise<EmailSummary[]> {
    const config = this.getValidatedConfig();
    const password = await resolveEmailPassword(config.passwordRef, this.deps.secretsManager);

    const socketFactory = this.deps.imapSocketFactory ?? createImapTlsSocket;
    const socket = await socketFactory(config.imapHost, config.imapPort);

    const client = new ImapClient({
      socket,
      username: config.username,
      password,
    });

    try {
      await client.open();
      const seqNums = await client.searchUnseen();
      const envelopes: ImapEnvelope[] = await client.fetchEnvelopes(seqNums, limit);

      // Fetch body preview for the newest message only (read-only; BODY.PEEK).
      // Failures are non-fatal — the inbox summary is still returned.
      let newestBodyPreview = '';
      const newestSeq = seqNums[0];
      if (newestSeq !== undefined) {
        try {
          newestBodyPreview = await client.fetchBodyPreview(newestSeq);
        } catch {
          // best-effort: body preview unavailable, proceed without it
        }
      }

      await client.logout();

      return envelopes.map((env, idx) => ({
        from: env.from,
        subject: env.subject,
        date: env.date,
        unread: true,
        bodyPreview: idx === 0 ? newestBodyPreview : '',
      }));
    } catch (err) {
      try { await client.logout(); } catch { /* best-effort */ }
      throw err;
    }
  }

  /**
   * Send a plain-text email.
   * Requires `confirm: true` at the call site — throws without it.
   */
  async sendMail(opts: SendMailOptions): Promise<void> {
    if (!opts.confirm) {
      throw new Error('sendMail requires confirm: true at the call site');
    }

    const config = this.getValidatedConfig();
    const password = await resolveEmailPassword(config.passwordRef, this.deps.secretsManager);

    const socketFactory = this.deps.smtpSocketFactory ?? this.defaultSmtpSocketFactory(config.smtpPort);
    const socket = await socketFactory(config.smtpHost, config.smtpPort);

    const client = new SmtpClient({
      socket,
      hostname: config.smtpHost,
      username: config.username,
      password,
    });

    await client.sendMail({
      from: config.fromAddress,
      to: opts.to,
      subject: opts.subject,
      body: opts.body,
    });
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private getValidatedConfig(): EmailConfig {
    const config = readEmailConfig(this.deps.getConfig);
    if (!config.enabled) {
      throw new Error('Email is not enabled. Set email.enabled = true in config.');
    }
    const errors = validateEmailConfig(config);
    if (errors.length > 0) {
      throw new Error(`Email config is invalid:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    }
    return config;
  }

  private defaultSmtpSocketFactory(
    port: number,
  ): (host: string, p: number) => Promise<Socket> {
    if (port === 465) return createSmtpTlsSocket;
    return createSmtpStartTlsSocket;
  }
}
