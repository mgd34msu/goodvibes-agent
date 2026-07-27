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
 * Nothing here ever prints a credential. Values go from a flow straight into
 * the encrypted secret store; status output reports presence, provenance,
 * scopes and expiry only.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { CommandContext, CommandRegistry } from '../command-registry.ts';
import { requirePlatform, requireSecretsManager, requireShellPaths } from './runtime-services.ts';
import { BrowserEngine } from '../../browser/browser-engine.ts';
import { BrowserSessionManager, browserProfileRoot, browserScreenshotRoot } from '../../browser/browser-sessions.ts';
import { createGoogleBrowserPort } from '../../agent/google/google-browser-port.ts';
import { createProcessCommandPort } from '../../agent/google/google-gcloud.ts';
import { runGoogleSetupFlow, renderGoogleSetupReport } from '../../agent/google/google-setup-flow.ts';
import {
  adoptExistingGoogleCredentials,
  buildGoogleSetupRunners,
  type GoogleClientIntakeChoice,
  type GoogleSetupActionDeps,
} from '../../agent/google/google-setup-actions.ts';
import { renderGoogleSetupRunbook } from '../../agent/google/google-setup-runbook.ts';
import { detectGoogleSetupState, describeGoogleSetupState } from '../../agent/google/google-setup-state.ts';
import { GOOGLE_CONFIG_KEYS, GOOGLE_SECRET_KEYS, ensureGoogleConfigDefaults } from '../../agent/google/google-setup-plan.ts';
import { ensureCalendarConfigDefaults } from '../../agent/calendar/calendar-oauth-service.ts';
import { ensureEmailConfigDefaults } from '../../agent/email/email-service.ts';
import {
  adoptGmailMcpCredentials,
  summarizeCredentials,
  type GoogleFilePort,
} from '../../agent/google/google-credential-adoption.ts';
import type {
  GoogleBrowserPort,
  GoogleConfigPort,
  GoogleProgressPort,
  GoogleSecretPort,
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
].join('\n');

// ---------------------------------------------------------------------------
// Ports built from the running shell
// ---------------------------------------------------------------------------

function configPort(ctx: CommandContext): GoogleConfigPort {
  const raw = requirePlatform(ctx).configManager;
  // The flow spans three app-layer config sections. Seed all of them before any
  // access: resolvePath throws on a section that is not there.
  ensureGoogleConfigDefaults(raw);
  ensureCalendarConfigDefaults(raw);
  ensureEmailConfigDefaults(raw);
  const manager = raw as {
    get: (key: string) => unknown;
    setDynamic: (key: string, value: unknown) => void;
  };
  return {
    get: (key) => manager.get(key),
    set: (key, value) => { manager.setDynamic(key, value); },
  };
}

function secretPort(ctx: CommandContext): GoogleSecretPort {
  const manager = requireSecretsManager(ctx) as {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, options?: { scope?: 'user' | 'project' }) => Promise<void>;
  };
  return {
    get: (key) => manager.get(key),
    set: (key, value) => manager.set(key, value, { scope: 'user' }),
  };
}

/** Plain node file reads. Adoption never writes, so there is no write side. */
const filePort: GoogleFilePort = {
  exists: (path) => existsSync(path),
  readText: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
};

/**
 * A browser, created only when a step actually needs one.
 *
 * The profile is named and persistent on purpose: Google blocks automated
 * browsers at its sign-in wall, so the person signs in by hand exactly once and
 * every later run reuses that session.
 */
function browserFactory(ctx: CommandContext): () => Promise<GoogleBrowserPort> {
  const homeDirectory = requireShellPaths(ctx).homeDirectory;
  let port: GoogleBrowserPort | null = null;
  return async () => {
    if (port !== null) return port;
    const engine = new BrowserEngine(
      new BrowserSessionManager({ profileRoot: browserProfileRoot(homeDirectory), homeDirectory }),
      { screenshotDirectory: browserScreenshotRoot(homeDirectory) },
    );
    port = createGoogleBrowserPort(engine, { launch: { profileName: 'google', headless: false } });
    return port;
  };
}

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

function actionDeps(ctx: CommandContext, intake?: GoogleClientIntakeChoice): GoogleSetupActionDeps {
  const homeDirectory = requireShellPaths(ctx).homeDirectory;
  return {
    config: configPort(ctx),
    secrets: secretPort(ctx),
    browser: browserFactory(ctx),
    commands: createProcessCommandPort(),
    fetchPort: { fetch: (url, init) => fetch(url, init) },
    files: filePort,
    homeDirectory,
    ...(intake === undefined ? {} : { clientIntake: intake }),
  };
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

/**
 * Status.
 *
 * Reports two independent things and never conflates them: what this product
 * has configured for itself, and what Google credentials already exist on this
 * machine regardless of whether anything is using them. The second is what the
 * shipped build never said out loud.
 */
async function showStatus(ctx: CommandContext): Promise<void> {
  const config = configPort(ctx);
  const secrets = secretPort(ctx);
  const homeDirectory = requireShellPaths(ctx).homeDirectory;

  const state = await detectGoogleSetupState({ config, secrets });
  const lines = ['Google connection', ...describeGoogleSetupState(state).map((line) => `  ${line}`)];

  const adoptable = adoptGmailMcpCredentials(filePort, homeDirectory);
  const summary = summarizeCredentials(adoptable, Date.now());
  lines.push('', 'Credentials already on this machine');
  if (!summary.found) {
    lines.push(`  ${summary.detail}`);
  } else {
    lines.push(`  ${summary.detail}`);
    lines.push(`  refresh token: ${summary.hasRefreshToken ? 'present' : 'absent'}`);
    if (!state.hasRefreshToken) {
      lines.push('  These are not in use yet. Take them up with: /google adopt');
    }
  }

  ctx.print(lines.join('\n'));
}

async function runAdopt(ctx: CommandContext): Promise<void> {
  const outcome = await adoptExistingGoogleCredentials({
    files: filePort,
    config: configPort(ctx),
    secrets: secretPort(ctx),
    homeDirectory: requireShellPaths(ctx).homeDirectory,
  });
  if (!outcome.adopted) {
    ctx.print([
      outcome.detail,
      'Connect an account instead with: /google setup',
    ].join('\n'));
    return;
  }
  ctx.print([
    outcome.detail,
    outcome.scopes.length > 0 ? `Granted scopes: ${outcome.scopes.join(', ')}` : 'The credential lists no scopes.',
    'Check what this enables with: /google status',
  ].join('\n'));
}

function parsePath(args: readonly string[]): GoogleSetupPath {
  const index = args.indexOf('--path');
  const value = index >= 0 ? args[index + 1] : undefined;
  return value === 'oauth' ? 'oauth' : 'app-password';
}

async function runSetup(args: readonly string[], ctx: CommandContext, intake?: GoogleClientIntakeChoice): Promise<void> {
  const path = parsePath(args);
  const deps = actionDeps(ctx, intake);
  const report = await runGoogleSetupFlow(path, {
    progress: progressPort(ctx),
    runners: buildGoogleSetupRunners(path, deps),
  });
  ctx.print(renderGoogleSetupReport(report));
}

async function setAccount(args: readonly string[], ctx: CommandContext): Promise<void> {
  const address = (args[0] ?? '').trim();
  if (address.length === 0 || !address.includes('@')) {
    ctx.print('Give the Gmail address to connect as: /google account <your-address@gmail.com>');
    return;
  }
  const config = configPort(ctx);
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
  await secretPort(ctx).set(GOOGLE_SECRET_KEYS.calendarIcsUrl, url);
  configPort(ctx).set(GOOGLE_CONFIG_KEYS.calendarIcsUrl, GOOGLE_CONFIG_KEYS.calendarIcsUrl);
  ctx.print('Stored the private calendar address in the encrypted secret store. Read it with: /calendar refresh');
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function runGoogleCommand(args: readonly string[], ctx: CommandContext): Promise<void> {
  const sub = (args[0] ?? 'status').trim().toLowerCase();
  const rest = args.slice(1);

  try {
    if (sub === 'status') return await showStatus(ctx);
    if (sub === 'adopt') return await runAdopt(ctx);
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
