import type { CommandContext, CommandRegistry } from '../command-registry.ts';
import { openCommandPanel, requireLocalUserAuthManager } from './runtime-services.ts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

function formatRoles(roles: readonly string[]): string {
  return roles.length > 0 ? roles.join(', ') : '(none)';
}

export function handleLocalAuthCommand(args: string[], ctx: CommandContext): void {
  const parsed = stripYesFlag(args);
  const commandArgs = [...parsed.rest];
  const sub = (commandArgs[0] ?? 'review').toLowerCase();
  const auth = requireLocalUserAuthManager(ctx);
  if (sub === 'panel' || sub === 'open') {
    openCommandPanel(ctx, 'local-auth');
    return;
  }

  if (sub === 'add-user') {
    const username = commandArgs[1];
    const password = commandArgs[2];
    const roles = commandArgs[3]?.split(',').map((value) => value.trim()).filter(Boolean) ?? ['admin'];
    if (!username || !password) {
      ctx.print('Usage: /auth local add-user <username> <password> [roles] --yes');
      return;
    }
    if (!parsed.yes) {
      requireYesFlag(ctx, `add local auth user ${username}`, '/auth local add-user <username> <password> [roles] --yes');
      return;
    }
    try {
      const added = auth.addUser(username, password, roles);
      ctx.print(`Added local auth user ${added.username} (${formatRoles(added.roles)}).`);
    } catch (error) {
      ctx.print(summarizeError(error));
    }
    return;
  }

  if (sub === 'delete-user') {
    const username = commandArgs[1];
    if (!username) {
      ctx.print('Usage: /auth local delete-user <username> --yes');
      return;
    }
    if (!parsed.yes) {
      requireYesFlag(ctx, `delete local auth user ${username}`, '/auth local delete-user <username> --yes');
      return;
    }
    try {
      const deleted = auth.deleteUser(username);
      ctx.print(deleted ? `Deleted local auth user ${username}.` : `Unknown local auth user: ${username}`);
    } catch (error) {
      ctx.print(summarizeError(error));
    }
    return;
  }

  if (sub === 'rotate-password') {
    const username = commandArgs[1];
    const password = commandArgs[2];
    if (!username || !password) {
      ctx.print('Usage: /auth local rotate-password <username> <password> --yes');
      return;
    }
    if (!parsed.yes) {
      requireYesFlag(ctx, `rotate password for local auth user ${username}`, '/auth local rotate-password <username> <password> --yes');
      return;
    }
    try {
      auth.rotatePassword(username, password);
      ctx.print(`Rotated password for ${username}. Existing sessions were revoked.`);
    } catch (error) {
      ctx.print(summarizeError(error));
    }
    return;
  }

  if (sub === 'revoke-session') {
    const token = commandArgs[1];
    if (!token) {
      ctx.print('Usage: /auth local revoke-session <token-or-fingerprint> --yes');
      return;
    }
    if (!parsed.yes) {
      requireYesFlag(ctx, 'revoke local auth session', '/auth local revoke-session <token-or-fingerprint> --yes');
      return;
    }
    ctx.print(auth.revokeSession(token) ? `Revoked session ${token.slice(0, 12)}…` : `Unknown session token or fingerprint: ${token}`);
    return;
  }

  if (sub === 'clear-bootstrap-file') {
    if (!parsed.yes) {
      requireYesFlag(ctx, 'clear the local auth bootstrap credential file', '/auth local clear-bootstrap-file --yes');
      return;
    }
    ctx.print(auth.clearBootstrapCredentialFile()
      ? 'Removed bootstrap credential file.'
      : 'No bootstrap credential file was present.');
    return;
  }

  const snapshot = auth.inspect();
  ctx.print([
    'Local Auth Review',
    `  user store: ${snapshot.userStorePath}`,
    `  bootstrap file: ${snapshot.bootstrapCredentialPath}`,
    `  bootstrap credentials: ${snapshot.bootstrapCredentialPresent ? 'present' : 'cleared'}`,
    `  users: ${snapshot.userCount}`,
    `  sessions: ${snapshot.sessionCount}`,
    ...snapshot.users.map((user) => `  user: ${user.username}  roles=${formatRoles(user.roles)}`),
    ...snapshot.sessions.map((session) => `  session: ${session.username}  expires=${new Date(session.expiresAt).toISOString()}  fingerprint=${session.tokenFingerprint}`),
  ].join('\n'));
}

export function registerLocalAuthRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'local-auth',
    aliases: ['auth-local'],
    description: 'Inspect and manage local runtime auth users, sessions, and bootstrap credentials',
    usage: '[review|panel|add-user <username> <password> [roles] --yes|delete-user <username> --yes|rotate-password <username> <password> --yes|revoke-session <token-or-fingerprint> --yes|clear-bootstrap-file --yes]',
    handler(args, ctx) {
      handleLocalAuthCommand(args, ctx);
    },
  });
}
