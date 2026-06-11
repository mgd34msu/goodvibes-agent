/**
 * /email command — direct email access via IMAP/SMTP.
 *
 * Subcommands:
 *   status                                        Show config readiness (redacted, no secrets)
 *   config                                        Show current email config (keys redacted)
 *   set <key> <value> [--yes]                     Set an email config key; --yes required for passwordRef
 *   check [n]                                     List up to n unread inbox summaries (default 10);
 *                                                  includes a 2-line body preview of the newest message
 *   send <to> <subject words> -- <body words> --yes  Send a plain-text email; preview without --yes
 *
 * Settable keys:
 *   email.enabled, email.imapHost, email.imapPort, email.smtpHost, email.smtpPort,
 *   email.smtpSecurity, email.username, email.passwordRef (requires --yes), email.fromAddress
 *
 * Safety policy:
 *   - All inbox reads use EXAMINE (read-only); unread status is never modified.
 *   - Sending requires explicit --yes; previews are shown without it.
 *   - No credential values are ever printed; passwordRef is displayed as [configured].
 *   - email.passwordRef is always stored as a goodvibes:// secret reference; the raw value
 *     is passed to SecretsManager and never written to settings.json.
 */

import type { CommandRegistry } from '../command-registry.ts';
import type { CommandContext } from '../command-registry.ts';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';
import {
  EmailService,
  readEmailConfig,
  validateEmailConfig,
  ensureEmailConfigDefaults,
} from '../../agent/email/email-service.ts';
import { requireSecretsManager } from './runtime-services.ts';
import type { ConfigKey } from '../../config/index.ts';
import { persistSecretBackedConfigValue } from '../../config/secret-config.ts';

/**
 * Whitelist of settable email config fields (without the 'email.' prefix).
 * Reject any key not in this set to prevent accidental writes to unknown paths.
 */
const KNOWN_EMAIL_FIELDS = new Set([
  'enabled',
  'imapHost',
  'imapPort',
  'smtpHost',
  'smtpPort',
  'smtpSecurity',
  'username',
  'passwordRef',
  'fromAddress',
]);

function readLimitArg(arg: string | undefined, fallback: number): number {
  if (!arg) return fallback;
  const n = parseInt(arg, 10);
  return isFinite(n) && n > 0 ? Math.min(n, 100) : fallback;
}

function getConfigManager(ctx: CommandContext): { get: (key: string) => unknown } {
  ensureEmailConfigDefaults(ctx.platform.configManager);
  return ctx.platform.configManager as unknown as { get: (key: string) => unknown };
}

function buildEmailService(ctx: CommandContext): EmailService {
  const secretsManager = requireSecretsManager(ctx);
  const cm = getConfigManager(ctx);
  return new EmailService({
    getConfig: (key: string) => cm.get(key),
    secretsManager,
  });
}

function formatStatus(ctx: CommandContext): void {
  const cm = getConfigManager(ctx);
  const config = readEmailConfig((key) => cm.get(key));
  const errors = validateEmailConfig(config);
  const lines = [
    'Email Status',
    `  enabled: ${config.enabled ? 'yes' : 'no'}`,
    `  imap: ${config.imapHost || '[not set]'}:${config.imapPort}`,
    `  smtp: ${config.smtpHost || '[not set]'}:${config.smtpPort}`,
    `  username: ${config.username || '[not set]'}`,
    `  password: ${config.passwordRef ? '[configured]' : '[missing]'}`,
    `  from: ${config.fromAddress || '[not set]'}`,
    `  ready: ${errors.length === 0 && config.enabled ? 'yes' : 'no'}`,
  ];
  if (errors.length > 0) {
    lines.push(`  issues (${errors.length}):`);
    for (const err of errors) lines.push(`    - ${err}`);
  }
  lines.push('  policy: credentials are never printed; passwordRef displays as [configured]');
  lines.push('  Usage: /email set email.<key> <value> [--yes] — see /email config');
  ctx.print(lines.join('\n'));
}

async function handleCheck(
  args: readonly string[],
  ctx: CommandContext,
): Promise<void> {
  const limit = readLimitArg(args[0], 10);
  const service = buildEmailService(ctx);
  const summaries = await service.checkInbox(limit);

  if (summaries.length === 0) {
    ctx.print('Inbox: no unread messages.');
    return;
  }

  const lines = [
    `Inbox: ${summaries.length} unread message${summaries.length !== 1 ? 's' : ''}`,
    '  policy: read-only; messages are not marked read',
  ];
  for (let i = 0; i < summaries.length; i += 1) {
    const msg = summaries[i];
    if (!msg) continue;
    lines.push(`  ${i + 1}. from=${msg.from || '(unknown)'} subject=${msg.subject || '(none)'} date=${msg.date || '(none)'}`);
  }

  // Wire in body preview for the newest message (MIN-2)
  const newest = summaries[0];
  if (newest?.bodyPreview) {
    const preview = newest.bodyPreview
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 2)
      .join(' … ');
    if (preview) lines.push(`  preview: ${preview}`);
  }

  ctx.print(lines.join('\n'));
}

/**
 * Parse send args with optional body separator.
 * Format: <to> <subject words...> [-- <body words...>]
 * Returns { to, subject, body } or null if to/subject are missing.
 */
function parseSendArgs(args: readonly string[]): { to: string; subject: string; body: string } | null {
  const to = args[0];
  if (!to) return null;

  const rest = args.slice(1);
  const sepIdx = rest.indexOf('--');

  let subjectParts: string[];
  let bodyParts: string[];

  if (sepIdx === -1) {
    subjectParts = rest;
    bodyParts = [];
  } else {
    subjectParts = rest.slice(0, sepIdx);
    bodyParts = rest.slice(sepIdx + 1);
  }

  const subject = subjectParts.join(' ').trim();
  if (!subject) return null;

  const body = bodyParts.join(' ').trim();
  return { to, subject, body };
}

function formatConfig(ctx: CommandContext): void {
  const cm = getConfigManager(ctx);
  const config = readEmailConfig((key) => cm.get(key));
  const lines = [
    'Email Config',
    `  email.enabled:       ${String(config.enabled)}`,
    `  email.imapHost:      ${config.imapHost || '[not set]'}`,
    `  email.imapPort:      ${config.imapPort}`,
    `  email.smtpHost:      ${config.smtpHost || '[not set]'}`,
    `  email.smtpPort:      ${config.smtpPort}`,
    `  email.smtpSecurity:  ${config.smtpSecurity} (tls|starttls|auto)`,
    `  email.username:      ${config.username || '[not set]'}`,
    `  email.passwordRef:   ${config.passwordRef ? '[configured]' : '[not set]'}`,
    `  email.fromAddress:   ${config.fromAddress || '[not set]'}`,
    '',
    '  Settable keys: email.enabled, email.imapHost, email.imapPort, email.smtpHost,',
    '                 email.smtpPort, email.smtpSecurity, email.username,',
    '                 email.passwordRef (--yes required), email.fromAddress',
    '  Usage: /email set email.<key> <value> [--yes]',
  ];
  ctx.print(lines.join('\n'));
}

async function handleSet(
  args: readonly string[],
  ctx: CommandContext,
): Promise<void> {
  const parsed = stripYesFlag(args);
  const rawArgs = [...parsed.rest];

  const rawKey = rawArgs[0];
  const rawValue = rawArgs.slice(1).join(' ');

  if (!rawKey) {
    ctx.print(
      'Usage: /email set email.<key> <value> [--yes]\n' +
      'Keys: email.enabled, email.imapHost, email.imapPort, email.smtpHost,\n' +
      '      email.smtpPort, email.username, email.passwordRef (--yes required),\n' +
      '      email.fromAddress',
    );
    return;
  }

  // Accept both "email.imapHost" and "imapHost" forms
  const fieldName = rawKey.startsWith('email.') ? rawKey.slice('email.'.length) : rawKey;
  const configKey = `email.${fieldName}`;

  if (!KNOWN_EMAIL_FIELDS.has(fieldName)) {
    ctx.print(
      `Unknown email config key: ${rawKey}\n` +
      'Valid keys: email.enabled, email.imapHost, email.imapPort, email.smtpHost,\n' +
      '            email.smtpPort, email.username, email.passwordRef (--yes required),\n' +
      '            email.fromAddress',
    );
    return;
  }

  if (rawValue === '') {
    ctx.print(`Usage: /email set ${configKey} <value>\nValue is required.`);
    return;
  }

  // Ensure the email section exists in the config manager before any writes
  ensureEmailConfigDefaults(ctx.platform.configManager);
  const cm = ctx.platform.configManager as unknown as {
    get: (key: string) => unknown;
    setDynamic: (key: string, value: unknown) => void;
    save: () => void;
  };

  if (fieldName === 'passwordRef') {
    // Secret path: --yes is required; raw value is routed through SecretsManager
    if (!parsed.yes) {
      const lines = [
        'Email Password Set Preview',
        `  key: ${configKey}`,
        '  value: [redacted — raw password will be stored as a secure secret]',
        '  policy: the raw password is never written to settings.json; only a',
        '          goodvibes:// reference is stored there',
      ];
      ctx.print(lines.join('\n'));
      requireYesFlag(ctx, 'set email.passwordRef secret', '/email set email.passwordRef <password> --yes');
      return;
    }

    const secretsManager = requireSecretsManager(ctx);
    const configKeyTyped = configKey as unknown as ConfigKey;
    const storedRef = await persistSecretBackedConfigValue(
      cm as unknown as Parameters<typeof persistSecretBackedConfigValue>[0],
      secretsManager,
      configKeyTyped,
      rawValue,
      { scope: 'user' },
    );
    cm.save();
    ctx.print(
      `Email config updated\n` +
      `  key:  ${configKey}\n` +
      `  value: [stored as secret; reference: ${storedRef.slice(0, 40)}...]\n` +
      '  policy: raw password stored in secrets manager; settings.json contains only the goodvibes:// ref',
    );
    return;
  }

  // Non-secret path: coerce value and persist
  let coerced: unknown = rawValue;
  if (fieldName === 'imapPort' || fieldName === 'smtpPort') {
    const n = parseInt(rawValue, 10);
    if (!isFinite(n) || n < 1 || n > 65535) {
      ctx.print(`Invalid port number: ${rawValue}. Must be an integer between 1 and 65535.`);
      return;
    }
    coerced = n;
  } else if (fieldName === 'smtpSecurity') {
    // MIN-2: validate at set time so invalid values never reach the socket factory
    if (rawValue !== 'tls' && rawValue !== 'starttls' && rawValue !== 'auto') {
      ctx.print(
        `Invalid smtpSecurity value: "${rawValue}".\n` +
        'Valid values: tls (direct TLS, e.g. port 465), starttls (STARTTLS upgrade, e.g. port 587), auto (port-based default).',
      );
      return;
    }
    coerced = rawValue;
  } else if (fieldName === 'enabled') {
    const lower = rawValue.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') {
      coerced = true;
    } else if (lower === 'false' || lower === '0' || lower === 'no') {
      coerced = false;
    } else {
      ctx.print(`Invalid boolean value: ${rawValue}. Use true or false.`);
      return;
    }
  }

  cm.setDynamic(configKey as unknown as ConfigKey, coerced);
  cm.save();
  ctx.print(`Email config updated\n  key:   ${configKey}\n  value: ${String(coerced)}`);
}

async function handleSend(
  args: readonly string[],
  ctx: CommandContext,
): Promise<void> {
  const parsed = stripYesFlag(args);
  const remaining = [...parsed.rest];

  const sendArgs = parseSendArgs(remaining);
  if (!sendArgs) {
    ctx.print('Usage: /email send <to> <subject words...> [-- <body words...>] --yes\nRecipient and subject are required.');
    return;
  }

  const { to, subject, body } = sendArgs;

  if (!parsed.yes) {
    const lines = [
      'Email Send Preview',
      `  to: ${to}`,
      `  subject: ${subject}`,
      `  body: ${body || '(empty)'}`,
      '  policy: this is a preview; rerun with --yes to send',
    ];
    ctx.print(lines.join('\n'));
    requireYesFlag(ctx, `send email to ${to}`, `/email send ${to} ${subject}${body ? ` -- ${body}` : ''} --yes`);
    return;
  }

  const service = buildEmailService(ctx);
  await service.sendMail({
    to,
    subject,
    body,
    confirm: true,
  });
  ctx.print(`Email sent to ${to} with subject "${subject}"`);
}

export function registerEmailRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'email',
    aliases: [],
    description: 'Direct IMAP/SMTP email: configure, check inbox, or send a confirmed message',
    hidden: true,
    usage: 'status | config | set <key> <value> [--yes] | check [n] | send <to> <subject...> [-- <body...>] --yes',
    argsHint: 'status|config|set|check|send',
    async handler(args, ctx) {
      const sub = (args[0] ?? 'status').trim().toLowerCase();

      try {
        if (sub === 'status') {
          formatStatus(ctx);
          return;
        }

        if (sub === 'config') {
          formatConfig(ctx);
          return;
        }

        if (sub === 'set') {
          await handleSet(args.slice(1), ctx);
          return;
        }

        if (sub === 'check') {
          await handleCheck(args.slice(1), ctx);
          return;
        }

        if (sub === 'send') {
          await handleSend(args.slice(1), ctx);
          return;
        }

        ctx.print('Usage: /email status | config | set <key> <value> [--yes] | check [n] | send <to> <subject...> [-- <body...>] --yes');
      } catch (err) {
        // MIN-3: print config/validation errors as plain language, never a raw exception
        const msg = err instanceof Error ? err.message : String(err);
        ctx.print(`Email error: ${msg}`);
      }
    },
  });
}
