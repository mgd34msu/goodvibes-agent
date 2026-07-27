/**
 * `/google` — the entry point for connecting Gmail and Google Calendar.
 *
 * Why this command exists at all: every module of the Google connector was
 * written, unit-tested and shipped with no importer outside its own tests. The
 * flow executor, the console walkthrough, the three credential intake routes,
 * the app-password fast lane and the credential adoption were all reachable
 * only from a test file, so the shipped agent honestly reported that email and
 * calendar were not wired up — they were not. Tests passing said nothing about
 * whether a person could get to the feature.
 *
 * So the surface is deliberately one command rather than subcommands under
 * `/email` and `/calendar`. One Google account, one OAuth client and one
 * credential serve both mail and calendar; splitting the setup across two
 * commands would have meant two half-flows sharing hidden state, and would
 * have left whichever one the user did not run looking broken.
 *
 * The same reasoning is why this file holds no logic of its own any more. The
 * workspace UI offers these routes as cards, and both surfaces call
 * `google-connection-actions.ts`. This file is the console renderer over those
 * actions: it parses arguments and prints. Anything it decided for itself would
 * be a decision the UI could get differently.
 *
 * Nothing here ever prints a credential.
 */

import type { CommandContext, CommandRegistry } from '../command-registry.ts';
import { requireSecretsManager } from './runtime-services.ts';
import { renderGoogleSetupReport } from '../../agent/google/google-setup-flow.ts';
import type { GoogleClientIntakeChoice } from '../../agent/google/google-setup-actions.ts';
import { renderGoogleSetupRunbook } from '../../agent/google/google-setup-runbook.ts';
import { GOOGLE_CONFIG_KEYS, GOOGLE_SECRET_KEYS } from '../../agent/google/google-setup-plan.ts';
import {
  adoptGoogleCredentials,
  describeGoogleConnection,
  googleConfigPort,
  googleSecretPort,
  runGoogleSetup,
} from './google-connection-actions.ts';
import type {
  GoogleProgressPort,
  GoogleSetupPath,
  GoogleSetupStepSpec,
  GoogleStepResult,
} from '../../agent/google/google-setup-types.ts';

const USAGE = [
  'Usage: /google <subcommand>',
  '',
  '  status                          What is connected, and what is still missing.',
  '  adopt                           Take up Google credentials already on this machine (~/.gmail-mcp).',
  '  setup [--path app-password|oauth]',
  '                                  Run the connection flow. Defaults to the app-password fast lane.',
  '  client-file <path>              Use an OAuth client JSON you already downloaded.',
  '  client <client-id> <client-secret>',
  '                                  Use an OAuth client id and secret you copied from the console.',
  '  account <address>               Set the Gmail address to connect as.',
  '  calendar-address <url>          Store the private iCal address for read-only calendar access.',
  '  runbook                         Print the written step-by-step instructions.',
  '',
  'The same routes are cards in the Agent workspace, under Personal Ops.',
].join('\n');

/** Live progress. A setup run is never a silent grind. */
function progressPort(ctx: CommandContext): GoogleProgressPort {
  return {
    stepStarted: (spec: GoogleSetupStepSpec, index: number, total: number) => {
      ctx.print(`[${index}/${total}] ${spec.title}...`);
    },
    stepFinished: (spec: GoogleSetupStepSpec, result: GoogleStepResult) => {
      ctx.print(`      ${result.outcome}: ${result.detail}`);
    },
    humanActionNeeded: (_spec: GoogleSetupStepSpec, instruction: string) => {
      ctx.print(`      needs you: ${instruction}`);
    },
    note: (message: string) => { ctx.print(`      ${message}`); },
  };
}

function parsePath(args: readonly string[]): GoogleSetupPath {
  const index = args.indexOf('--path');
  const value = index >= 0 ? args[index + 1] : undefined;
  return value === 'oauth' ? 'oauth' : 'app-password';
}

async function runSetup(args: readonly string[], ctx: CommandContext, intake?: GoogleClientIntakeChoice): Promise<void> {
  const report = await runGoogleSetup(parsePath(args), ctx, progressPort(ctx), intake);
  ctx.print(renderGoogleSetupReport(report));
}

async function setAccount(args: readonly string[], ctx: CommandContext): Promise<void> {
  const address = (args[0] ?? '').trim();
  if (address.length === 0 || !address.includes('@')) {
    ctx.print('Give the Gmail address to connect as: /google account <your-address@gmail.com>');
    return;
  }
  const config = googleConfigPort(ctx);
  config.set(GOOGLE_CONFIG_KEYS.emailUsername, address);
  config.set(GOOGLE_CONFIG_KEYS.emailFromAddress, address);
  ctx.print(`Gmail address set to ${address}. Continue with: /google setup`);
}

/**
 * The private iCal address is a credential in URL form — anyone holding it can
 * read the calendar — so it goes to the encrypted store, not to config.
 */
async function setCalendarAddress(args: readonly string[], ctx: CommandContext): Promise<void> {
  const url = (args[0] ?? '').trim();
  if (!url.startsWith('https://')) {
    ctx.print('Give the private iCal address: /google calendar-address <https://calendar.google.com/calendar/ical/.../basic.ics>');
    return;
  }
  // Touch the secrets manager through the same accessor the ports use, so an
  // unavailable secret store fails here rather than half-way through a write.
  requireSecretsManager(ctx);
  await googleSecretPort(ctx).set(GOOGLE_SECRET_KEYS.calendarIcsUrl, url);
  googleConfigPort(ctx).set(GOOGLE_CONFIG_KEYS.calendarIcsUrl, GOOGLE_CONFIG_KEYS.calendarIcsUrl);
  ctx.print('Stored the private calendar address in the encrypted secret store. Read it with: /calendar refresh');
}

export async function runGoogleCommand(args: readonly string[], ctx: CommandContext): Promise<void> {
  const sub = (args[0] ?? 'status').trim().toLowerCase();
  const rest = args.slice(1);

  try {
    if (sub === 'status') {
      ctx.print(await describeGoogleConnection(ctx, '/google adopt'));
      return;
    }
    if (sub === 'adopt') {
      const outcome = await adoptGoogleCredentials(ctx, { setup: '/google setup', status: '/google status' });
      ctx.print(outcome.text);
      return;
    }
    if (sub === 'setup') return await runSetup(rest, ctx);
    if (sub === 'account') return await setAccount(rest, ctx);
    if (sub === 'calendar-address') return await setCalendarAddress(rest, ctx);
    if (sub === 'runbook') {
      ctx.print(renderGoogleSetupRunbook());
      return;
    }
    if (sub === 'client-file') {
      const path = (rest[0] ?? '').trim();
      if (path.length === 0) {
        ctx.print('Give the path to the downloaded client JSON: /google client-file <path>');
        return;
      }
      return await runSetup(['--path', 'oauth'], ctx, { kind: 'client-json-file', path });
    }
    if (sub === 'client') {
      const clientId = (rest[0] ?? '').trim();
      const clientSecret = (rest[1] ?? '').trim();
      if (clientId.length === 0 || clientSecret.length === 0) {
        ctx.print('Give both values: /google client <client-id> <client-secret>');
        return;
      }
      return await runSetup(['--path', 'oauth'], ctx, { kind: 'manual-entry', clientId, clientSecret });
    }
    ctx.print(USAGE);
  } catch (error) {
    ctx.print(`Google setup could not run: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function registerGoogleRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'google',
    aliases: ['gmail'],
    description: 'Connect Gmail and Google Calendar: adopt existing credentials, or run the setup flow',
    usage: 'status | adopt | setup [--path app-password|oauth] | client-file <path> | client <id> <secret> | account <address> | calendar-address <url> | runbook',
    argsHint: 'status|adopt|setup|client-file|client|account|calendar-address|runbook',
    handler: runGoogleCommand,
  });
}
