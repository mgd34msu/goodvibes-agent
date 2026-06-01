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
  readonly externalRuntimeAuth: 'managed-outside-agent';
  readonly secretKeys: readonly string[];
  readonly activeSubscriptions: readonly string[];
  readonly pendingSubscriptions: readonly string[];
}

function inspectAuthBundle(bundle: AuthReviewBundle): string {
  return [
    'Auth Review Bundle',
    `  exportedAt: ${new Date(bundle.exportedAt).toISOString()}`,
    `  externalRuntimeAuth: ${bundle.externalRuntimeAuth}`,
    `  stored secrets: ${bundle.secretKeys.length}`,
    `  active subscriptions: ${bundle.activeSubscriptions.length}`,
    `  pending subscriptions: ${bundle.pendingSubscriptions.length}`,
  ].join('\n');
}

export function registerPlatformAccessRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'login',
    description: 'Front-door login flow for provider subscriptions',
    usage: 'provider <name> start|finish <code> --yes',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
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
      if (target === 'service' || target === 'runtime' || target === 'listener' || target === 'daemon') {
        ctx.print([
          'Runtime service login is external to GoodVibes Agent.',
          'Agent does not create, exchange, store, rotate, revoke, or clear runtime/listener service sessions.',
          'Use the runtime-owning GoodVibes TUI or host tooling for runtime auth administration.',
          'Agent login supports provider subscriptions only: /login provider <name> start|finish <code> --yes.',
        ].join('\n'));
        return;
      }
      ctx.print('Usage: /login provider <name> start|finish <code> --yes');
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
    description: 'Review provider auth posture and export redacted auth review bundles',
    usage: '[review|show <provider>|repair <provider>|bundle export <path> --yes|bundle inspect <path>]',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const sub = commandArgs[0] ?? 'review';
      if (sub === 'local') {
        ctx.print([
          'Local runtime auth management is external to GoodVibes Agent.',
          'Agent connects to an already-running GoodVibes runtime and does not create, delete, rotate, revoke, or clear runtime auth users, sessions, or bootstrap credentials.',
          'Use the runtime-owning GoodVibes TUI or host tooling for runtime auth administration.',
          'Agent auth commands available here: /auth review, /auth show <provider>, /auth repair <provider>, /auth bundle export <path> --yes, /auth bundle inspect <path>.',
        ].join('\n'));
        return;
      }
      if (sub === 'login') {
        ctx.print([
          'Runtime service login is external to GoodVibes Agent.',
          'Agent does not create, exchange, store, rotate, revoke, or clear runtime/listener service sessions.',
          'Use the runtime-owning GoodVibes TUI or host tooling for runtime auth administration.',
        ].join('\n'));
        return;
      }

      const shellPaths = requireShellPaths(ctx);
      const subscriptions = requireSubscriptionManager(ctx);
      const serviceRegistry = requireServiceRegistry(ctx);
      const secretsManager = requireSecretsManager(ctx);
      if (sub === 'review') {
        const snapshot = await buildAuthInspectionSnapshot({
          serviceRegistry,
          subscriptionManager: subscriptions,
          secretsManager,
        });
        const builtinProviders = listBuiltinSubscriptionProviders().map((entry) => entry.provider);
        ctx.print([
          'Auth Review',
          '  runtime auth: managed outside goodvibes-agent',
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
            externalRuntimeAuth: 'managed-outside-agent',
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
      ctx.print('Usage: /auth [review|show <provider>|bundle export <path> --yes|bundle inspect <path>]');
    },
  });
}
