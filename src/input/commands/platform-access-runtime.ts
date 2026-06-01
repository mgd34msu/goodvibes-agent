import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommandRegistry } from '../command-registry.ts';
import { listBuiltinSubscriptionProviders } from '@pellux/goodvibes-sdk/platform/config';
import { buildAuthInspectionSnapshot, inspectProviderAuth } from '@/runtime/index.ts';
import { requireSecretsManager, requireServiceRegistry, requireShellPaths, requireSubscriptionManager } from './runtime-services.ts';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

interface AuthReviewBundle {
  readonly version: 1;
  readonly exportedAt: number;
  readonly runtimeLoginUrl: string;
  readonly listenerLoginUrl: string;
  readonly secretKeys: readonly string[];
  readonly activeSubscriptions: readonly string[];
  readonly pendingSubscriptions: readonly string[];
}

type AuthServiceLoginTarget = 'runtime' | 'listener';

function normalizeAuthServiceLoginTarget(value: string | undefined): AuthServiceLoginTarget | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'runtime' || normalized === 'daemon') return 'runtime';
  if (normalized === 'listener' || normalized === 'inbound-listener') return 'listener';
  return null;
}

function authServiceSecretPrefix(target: AuthServiceLoginTarget): string {
  return target === 'runtime' ? 'RUNTIME' : 'LISTENER';
}

function inspectAuthBundle(bundle: AuthReviewBundle): string {
  return [
    'Auth Review Bundle',
    `  exportedAt: ${new Date(bundle.exportedAt).toISOString()}`,
    `  runtimeLoginUrl: ${bundle.runtimeLoginUrl}`,
    `  listenerLoginUrl: ${bundle.listenerLoginUrl}`,
    `  stored secrets: ${bundle.secretKeys.length}`,
    `  active subscriptions: ${bundle.activeSubscriptions.length}`,
    `  pending subscriptions: ${bundle.pendingSubscriptions.length}`,
  ].join('\n');
}

export function registerPlatformAccessRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'login',
    description: 'Front-door login flow for provider subscriptions and local service sessions',
    usage: '[provider <name> start|finish <code> --yes|service <runtime|listener> <baseUrl> <username> <password> [secretKey] --yes]',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const shellPaths = requireShellPaths(ctx);
      const target = (commandArgs[0] ?? '').toLowerCase();
      if (target === 'provider') {
        const provider = commandArgs[1];
        const mode = commandArgs[2]?.toLowerCase();
        if (!provider || !mode) {
          ctx.print('Usage: /login provider <name> start|finish <code> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `${mode} provider subscription login for ${provider}`, '/login provider <name> start|finish <code> --yes');
          return;
        }
        if (ctx.executeCommand) {
          await ctx.executeCommand('subscription', ['login', provider, mode, ...commandArgs.slice(3), '--yes']);
          return;
        }
        ctx.print(`Use /subscription login ${provider} ${mode}${commandArgs[3] ? ` ${commandArgs[3]}` : ''} --yes`);
        return;
      }
      if (target === 'service') {
        if (!parsed.yes) {
          requireYesFlag(ctx, 'store a local service session token', '/login service <runtime|listener> <baseUrl> <username> <password> [secretKey] --yes');
          return;
        }
        if (ctx.executeCommand) {
          await ctx.executeCommand('auth', ['login', ...commandArgs.slice(1), '--yes']);
          return;
        }
        ctx.print('Use /auth login <runtime|listener> <baseUrl> <username> <password> [secretKey] --yes');
        return;
      }
      ctx.print('Usage: /login [provider <name> start|finish <code> --yes|service <runtime|listener> <baseUrl> <username> <password> [secretKey] --yes]');
    },
  });

  registry.register({
    name: 'logout',
    description: 'Front-door logout flow for provider subscription sessions and supported overrides',
    usage: 'provider <name> --yes',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const target = (commandArgs[0] ?? '').toLowerCase();
      if (target !== 'provider' || !commandArgs[1]) {
        ctx.print('Usage: /logout provider <name> --yes');
        return;
      }
      if (!parsed.yes) {
        requireYesFlag(ctx, `log out provider subscription ${commandArgs[1]}`, '/logout provider <name> --yes');
        return;
      }
      if (ctx.executeCommand) {
        await ctx.executeCommand('subscription', ['logout', commandArgs[1], '--yes']);
        return;
      }
      ctx.print(`Use /subscription logout ${commandArgs[1]} --yes`);
    },
  });

  registry.register({
    name: 'auth',
    description: 'Review auth posture and exchange session login tokens with local services',
    usage: '[review|show <provider>|repair <provider>|bundle export <path> --yes|bundle inspect <path>|login <runtime|listener> <baseUrl> <username> <password> [secretKey] --yes]',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const shellPaths = requireShellPaths(ctx);
      const sub = commandArgs[0] ?? 'review';
      const subscriptions = requireSubscriptionManager(ctx);
      const serviceRegistry = requireServiceRegistry(ctx);
      const secretsManager = requireSecretsManager(ctx);
      if (sub === 'local') {
        ctx.print([
          'Local runtime auth management is external to GoodVibes Agent.',
          'Agent connects to an already-running GoodVibes runtime and does not create, delete, rotate, revoke, or clear runtime auth users, sessions, or bootstrap credentials.',
          'Use the runtime-owning GoodVibes TUI or host tooling for runtime auth administration.',
          'Agent auth commands available here: /auth review, /auth show <provider>, /auth repair <provider>, /auth login <runtime|listener> ... --yes.',
        ].join('\n'));
        return;
      }
      if (sub === 'review') {
        const snapshot = await buildAuthInspectionSnapshot({
          serviceRegistry,
          subscriptionManager: subscriptions,
          secretsManager,
        });
        const builtinProviders = listBuiltinSubscriptionProviders().map((entry) => entry.provider);
        ctx.print([
          'Auth Review',
          '  runtime login route: /login',
          '  listener login route: /login',
          `  stored secrets: ${snapshot.secretKeyCount}`,
          `  built-in providers: ${builtinProviders.length}${builtinProviders.length > 0 ? ` (${builtinProviders.join(', ')})` : ''}`,
          `  active subscriptions: ${snapshot.activeSubscriptions}${snapshot.activeSubscriptions > 0 ? ` (${snapshot.providers.filter((provider) => provider.activeSubscription).map((provider) => provider.provider).join(', ')})` : ''}`,
          `  pending subscriptions: ${snapshot.pendingSubscriptions}${snapshot.pendingSubscriptions > 0 ? ` (${snapshot.providers.filter((provider) => provider.pendingLogin).map((provider) => provider.provider).join(', ')})` : ''}`,
          ...snapshot.providers.map((provider) => `  ${provider.provider}  freshness=${provider.freshness}  mode=${provider.callbackMode}  configured=${provider.configured ? 'yes' : 'no'}`),
        ].join('\n'));
        return;
      }

      if (sub === 'show') {
        const provider = commandArgs[1];
        if (!provider) {
          ctx.print('Usage: /auth show <provider>');
          return;
        }
        const inspection = await inspectProviderAuth(provider, {
          serviceRegistry,
          subscriptionManager: subscriptions,
          secretsManager,
        });
        ctx.print([
          `Auth Provider ${provider}`,
          `  configured: ${inspection.configured ? 'yes' : 'no'}`,
          ...(inspection.source ? [`  source: ${inspection.source}`] : []),
          `  freshness: ${inspection.freshness}`,
          `  callbackMode: ${inspection.callbackMode}`,
          ...(inspection.redirectUri ? [`  redirectUri: ${inspection.redirectUri}`] : []),
          ...(inspection.localCallback ? [`  localCallback: ${inspection.localCallback}`] : []),
          `  activeSubscription: ${inspection.activeSubscription ? 'yes' : 'no'}`,
          `  pendingLogin: ${inspection.pendingLogin ? 'yes' : 'no'}`,
          `  overrideAmbientApiKeys: ${inspection.overrideAmbientApiKeys ? 'yes' : 'no'}`,
          ...(inspection.tokenType ? [`  tokenType: ${inspection.tokenType}`] : []),
          ...(inspection.expiresAt ? [`  expiresAt: ${new Date(inspection.expiresAt).toISOString()}`] : []),
          ...inspection.issues.map((issue) => `  issue: ${issue}`),
          ...inspection.nextActions.map((action) => `  next: ${action}`),
        ].join('\n'));
        return;
      }

      if (sub === 'repair') {
        const provider = commandArgs[1];
        if (!provider) {
          ctx.print('Usage: /auth repair <provider>');
          return;
        }
        const inspection = await inspectProviderAuth(provider, {
          serviceRegistry,
          subscriptionManager: subscriptions,
          secretsManager,
        });
        ctx.print([
          `Auth Repair ${provider}`,
          `  configured: ${inspection.configured ? 'yes' : 'no'}`,
          `  freshness: ${inspection.freshness}`,
          `  callbackMode: ${inspection.callbackMode}`,
          ...inspection.issues.map((issue) => `  issue: ${issue}`),
          ...(inspection.nextActions.length > 0
            ? ['  next:', ...inspection.nextActions.map((action) => `    ${action}`)]
            : ['  No active repair actions suggested.']),
        ].join('\n'));
        return;
      }

      if (sub === 'bundle') {
        const mode = commandArgs[1];
        const pathArg = commandArgs[2];
        if ((mode === 'export' || mode === 'inspect') && !pathArg) {
          ctx.print(`Usage: /auth bundle ${mode} <path>${mode === 'export' ? ' --yes' : ''}`);
          return;
        }
        const targetPath = shellPaths.resolveWorkspacePath(pathArg!);
        if (mode === 'export') {
          if (!parsed.yes) {
            requireYesFlag(ctx, `export auth review bundle to ${pathArg}`, '/auth bundle export <path> --yes');
            return;
          }
          const secretKeys = await secretsManager.list();
          const bundle: AuthReviewBundle = {
            version: 1,
            exportedAt: Date.now(),
            runtimeLoginUrl: 'http://127.0.0.1:3421/login',
            listenerLoginUrl: 'http://127.0.0.1:3422/login',
            secretKeys,
            activeSubscriptions: subscriptions.list().map((entry) => entry.provider),
            pendingSubscriptions: subscriptions.listPending().map((entry) => entry.provider),
          };
          mkdirSync(dirname(targetPath), { recursive: true });
          writeFileSync(targetPath, JSON.stringify(bundle, null, 2) + '\n', 'utf-8');
          ctx.print(`Auth review bundle exported to ${targetPath}`);
          return;
        }
        if (mode === 'inspect') {
          const bundle = JSON.parse(readFileSync(targetPath, 'utf-8')) as AuthReviewBundle;
          ctx.print(inspectAuthBundle(bundle));
          return;
        }
      }

      if (sub === 'login') {
        const target = normalizeAuthServiceLoginTarget(commandArgs[1]);
        const baseUrl = commandArgs[2];
        const username = commandArgs[3];
        const password = commandArgs[4];
        const secretKey = commandArgs[5] ?? `${target ? authServiceSecretPrefix(target) : 'SERVICE'}_SESSION_TOKEN`;
        if (!target || !baseUrl || !username || !password) {
          ctx.print('Usage: /auth login <runtime|listener> <baseUrl> <username> <password> [secretKey] --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `store ${target} session token`, '/auth login <runtime|listener> <baseUrl> <username> <password> [secretKey] --yes');
          return;
        }
        const url = new URL('/login', baseUrl).toString();
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (!response.ok) {
          const body = await response.text();
          ctx.print(`Auth login failed (${response.status}): ${body}`);
          return;
        }
        const body = await response.json() as { token?: unknown };
        if (typeof body.token !== 'string') {
          ctx.print('Auth login response did not include a session token.');
          return;
        }
        await requireSecretsManager(ctx).set(secretKey, body.token);
        ctx.print(`Stored ${target} session token in secure storage as ${secretKey}.`);
        return;
      }

      ctx.print('Usage: /auth [review|show <provider>|bundle export <path> --yes|bundle inspect <path>|login <runtime|listener> <baseUrl> <username> <password> [secretKey] --yes]');
    },
  });
}
