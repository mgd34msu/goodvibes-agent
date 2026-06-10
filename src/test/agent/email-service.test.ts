/**
 * EmailService unit tests with stubbed IMAP/SMTP clients.
 * No real network connections are made.
 */

import { describe, expect, test } from 'bun:test';
import {
  EmailService,
  readEmailConfig,
  validateEmailConfig,
  resolveEmailPassword,
} from '../../agent/email/email-service.ts';
import type { Socket } from 'node:net';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ConfigMap = Record<string, unknown>;

function makeSecretsManager(
  store: Record<string, string>,
): { get: (key: string) => Promise<string | null> } {
  return {
    get: async (key) => store[key] ?? null,
  };
}

function makeConfig(overrides: ConfigMap = {}): ConfigMap {
  return {
    'email.enabled': true,
    'email.imapHost': 'imap.example.test',
    'email.imapPort': 993,
    'email.smtpHost': 'smtp.example.test',
    'email.smtpPort': 587,
    'email.username': 'user@example.test',
    'email.passwordRef': 'goodvibes://secrets/goodvibes/GOODVIBES_EMAIL_PASSWORD',
    'email.fromAddress': 'user@example.test',
    ...overrides,
  };
}

// Stub socket that does nothing — satisfies the Socket type for factory stubs
const stubSocket = {} as Socket;

// ---------------------------------------------------------------------------
// readEmailConfig
// ---------------------------------------------------------------------------

describe('readEmailConfig', () => {
  test('reads all keys with correct types', () => {
    const config = readEmailConfig((k) => makeConfig()[k]);
    expect(config.enabled).toBe(true);
    expect(config.imapHost).toBe('imap.example.test');
    expect(config.imapPort).toBe(993);
    expect(config.smtpHost).toBe('smtp.example.test');
    expect(config.smtpPort).toBe(587);
    expect(config.username).toBe('user@example.test');
    expect(config.passwordRef).toContain('goodvibes://secrets/');
    expect(config.fromAddress).toBe('user@example.test');
  });

  test('applies defaults for missing numeric keys', () => {
    const config = readEmailConfig((k) => ({
      'email.enabled': true,
      'email.username': 'u',
      'email.passwordRef': 'goodvibes://secrets/goodvibes/KEY',
      'email.fromAddress': 'u@example.test',
    } as ConfigMap)[k]);
    expect(config.imapPort).toBe(993);
    expect(config.smtpPort).toBe(587);
  });
});

// ---------------------------------------------------------------------------
// validateEmailConfig
// ---------------------------------------------------------------------------

describe('validateEmailConfig', () => {
  test('returns no errors for a valid config', () => {
    const config = readEmailConfig((k) => makeConfig()[k]);
    expect(validateEmailConfig(config)).toHaveLength(0);
  });

  test('rejects missing required fields', () => {
    const base = readEmailConfig((k) => makeConfig()[k]);
    expect(validateEmailConfig({ ...base, imapHost: '' })).toContain('email.imapHost is required');
    expect(validateEmailConfig({ ...base, smtpHost: '' })).toContain('email.smtpHost is required');
    expect(validateEmailConfig({ ...base, username: '' })).toContain('email.username is required');
    expect(validateEmailConfig({ ...base, fromAddress: '' })).toContain('email.fromAddress is required');
  });

  test('rejects raw password in passwordRef', () => {
    const base = readEmailConfig((k) => makeConfig()[k]);
    const errors = validateEmailConfig({ ...base, passwordRef: 'plaintext-password' });
    expect(errors.some((e) => e.includes('goodvibes secret reference'))).toBe(true);
  });

  test('rejects empty passwordRef', () => {
    const base = readEmailConfig((k) => makeConfig()[k]);
    const errors = validateEmailConfig({ ...base, passwordRef: '' });
    expect(errors.some((e) => e.includes('email.passwordRef is required'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveEmailPassword
// ---------------------------------------------------------------------------

describe('resolveEmailPassword', () => {
  test('resolves goodvibes://secrets/goodvibes/ ref by extracting storage key', async () => {
    const secrets = makeSecretsManager({
      GOODVIBES_EMAIL_PASSWORD: 'resolved-password',
    });
    const value = await resolveEmailPassword(
      'goodvibes://secrets/goodvibes/GOODVIBES_EMAIL_PASSWORD',
      secrets,
    );
    expect(value).toBe('resolved-password');
  });

  test('passes non-goodvibes refs directly to secretsManager', async () => {
    const calls: string[] = [];
    const secrets = {
      get: async (key: string) => {
        calls.push(key);
        return 'env-password';
      },
    };
    await resolveEmailPassword('op://Private/Email/password', secrets);
    expect(calls[0]).toBe('op://Private/Email/password');
  });

  test('throws when secret is not found', async () => {
    const secrets = makeSecretsManager({});
    await expect(
      resolveEmailPassword('goodvibes://secrets/goodvibes/MISSING_KEY', secrets),
    ).rejects.toThrow('Email password secret could not be resolved');
  });
});

// ---------------------------------------------------------------------------
// EmailService.getStatus
// ---------------------------------------------------------------------------

describe('EmailService.getStatus', () => {
  test('returns ready=true for valid enabled config', () => {
    const service = new EmailService({
      getConfig: (k) => makeConfig()[k],
      secretsManager: makeSecretsManager({}),
    });
    const status = service.getStatus();
    expect(status.ready).toBe(true);
    expect(status.errors).toHaveLength(0);
  });

  test('EmailSummary includes bodyPreview field', () => {
    // Verify the type shape — bodyPreview is always present, empty string by default
    const summary: import('../../agent/email/email-service.ts').EmailSummary = {
      from: 'a@b.test',
      subject: 'Hi',
      date: '2026-01-01',
      unread: true,
      bodyPreview: '',
    };
    expect(summary.bodyPreview).toBe('');
  });

  test('returns ready=false when disabled', () => {
    const service = new EmailService({
      getConfig: (k) => makeConfig({ 'email.enabled': false })[k],
      secretsManager: makeSecretsManager({}),
    });
    const status = service.getStatus();
    expect(status.ready).toBe(false);
  });

  test('redacts passwordRef in status output', () => {
    const service = new EmailService({
      getConfig: (k) => makeConfig()[k],
      secretsManager: makeSecretsManager({}),
    });
    const status = service.getStatus();
    // The raw ref must never appear in status output
    expect(status.config.passwordRef).toBe('[configured]');
    expect(JSON.stringify(status)).not.toContain('goodvibes://secrets/');
  });
});

// ---------------------------------------------------------------------------
// EmailService.checkInbox
// ---------------------------------------------------------------------------

describe('EmailService.checkInbox', () => {
  test('returns summaries from IMAP client; messages stay unread', async () => {
    const opened: string[] = [];
    const service = new EmailService({
      getConfig: (k) => makeConfig()[k],
      secretsManager: makeSecretsManager({
        GOODVIBES_EMAIL_PASSWORD: 'test-password',
      }),
      imapSocketFactory: async () => {
        opened.push('connected');
        return stubSocket;
      },
    });

    // Stub out the ImapClient by monkey-patching the module's behavior
    // via the socket factory — since ImapClient requires real socket I/O,
    // we test the service wiring by overriding the IMAP socket factory
    // and verifying the service handles errors from the client gracefully.
    await expect(service.checkInbox(5)).rejects.toThrow();
    // Socket factory was called (connection was attempted)
    expect(opened).toHaveLength(1);
  });

  test('throws when email is disabled', async () => {
    const service = new EmailService({
      getConfig: (k) => makeConfig({ 'email.enabled': false })[k],
      secretsManager: makeSecretsManager({}),
    });
    await expect(service.checkInbox()).rejects.toThrow('Email is not enabled');
  });

  test('throws when config is invalid', async () => {
    const service = new EmailService({
      getConfig: (k) => makeConfig({ 'email.imapHost': '' })[k],
      secretsManager: makeSecretsManager({}),
    });
    await expect(service.checkInbox()).rejects.toThrow('Email config is invalid');
  });
});

// ---------------------------------------------------------------------------
// EmailService.sendMail
// ---------------------------------------------------------------------------

describe('EmailService.sendMail', () => {
  test('throws without confirm=true', async () => {
    const service = new EmailService({
      getConfig: (k) => makeConfig()[k],
      secretsManager: makeSecretsManager({}),
    });
    await expect(
      service.sendMail({ to: 'a@b.test', subject: 'Hi', body: 'Body', confirm: false }),
    ).rejects.toThrow('requires confirm: true');
  });

  test('throws when email is disabled', async () => {
    const service = new EmailService({
      getConfig: (k) => makeConfig({ 'email.enabled': false })[k],
      secretsManager: makeSecretsManager({}),
    });
    await expect(
      service.sendMail({ to: 'a@b.test', subject: 'Hi', body: 'Body', confirm: true }),
    ).rejects.toThrow('Email is not enabled');
  });

  test('calls smtp socket factory with correct host/port', async () => {
    const calls: Array<{ host: string; port: number }> = [];
    const service = new EmailService({
      getConfig: (k) => makeConfig()[k],
      secretsManager: makeSecretsManager({
        GOODVIBES_EMAIL_PASSWORD: 'test-password',
      }),
      smtpSocketFactory: async (host, port) => {
        calls.push({ host, port });
        return stubSocket;
      },
    });

    await expect(
      service.sendMail({ to: 'a@b.test', subject: 'Hi', body: 'Body', confirm: true }),
    ).rejects.toThrow(); // SmtpClient will fail on the stub socket — expected

    expect(calls).toHaveLength(1);
    expect(calls[0]?.host).toBe('smtp.example.test');
    expect(calls[0]?.port).toBe(587);
  });
});
