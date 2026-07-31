/**
 * The Google connection actions, owned in one place so every surface runs the
 * same code.
 *
 * `/google` was the first caller and for a while the only one. The workspace UI
 * now offers the same routes as cards, and the rule that made this file
 * necessary is that neither surface may carry its own copy: a second
 * implementation of "adopt the credentials on this machine" is a second thing
 * that can be wrong, and the two would drift the moment one of them was fixed.
 * So the ports, the status report, the adoption and the flow run all live here,
 * and the command and the workspace editors are thin renderers over them.
 *
 * The split is deliberate about what each side owns: this module decides what
 * happens and returns text; the caller decides where that text goes — the
 * console for the command, an action result panel for the workspace.
 *
 * The connector itself is `@pellux/goodvibes-sdk/platform/google` — the flows,
 * the step plan, the credential handling and the browser-driven pages all live
 * there now, so the daemon can run them too. What stayed here is the wiring
 * that only this product can supply: config and secret access through the
 * running shell, and a browser built from the agent's own untrusted-content
 * ledger. This file composes those; it implements none of them.
 *
 * Nothing here ever returns a credential. Values go from a flow straight into
 * the encrypted secret store; the status text reports presence, provenance,
 * scopes and expiry only.
 */

import type { CommandContext } from '../command-registry.ts';
import { requirePlatform, requireSecretsManager, requireShellPaths } from './runtime-services.ts';
import {
  adoptExistingGoogleCredentials,
  adoptGmailMcpCredentials,
  buildGoogleSetupRunners,
  createGoogleBrowserPort,
  describeGoogleSetupState,
  detectGoogleSetupState,
  runGoogleSetupFlow,
  summarizeCredentials,
  type GoogleBrowserPort,
  type GoogleClientIntakeChoice,
  type GoogleConfigPort,
  type GoogleProgressPort,
  type GoogleSecretPort,
  type GoogleSetupActionDeps,
  type GoogleSetupPath,
  type GoogleSetupReport,
} from '@pellux/goodvibes-sdk/platform/google';
import {
  createProcessCommandPort,
  nodeGoogleFilePort,
  startLoopbackListener,
} from '@pellux/goodvibes-sdk/platform/google/node';
import { ensureConnectorConfigSections } from '@pellux/goodvibes-sdk/platform/config';
import {
  agentBrowserProfileRoot,
  agentBrowserScreenshotRoot,
  createAgentBrowserEngine,
} from '../../runtime/agent-browser.ts';

// ---------------------------------------------------------------------------
// Ports built from the running shell
// ---------------------------------------------------------------------------

export function googleConfigPort(ctx: CommandContext): GoogleConfigPort {
  const raw = requirePlatform(ctx).configManager;
  // The flow spans three app-layer config sections. Seed all of them before any
  // access: resolvePath throws on a section that is not there. One call rather
  // than three: seeding a subset is how the connector came to work on one
  // surface and throw on the others.
  ensureConnectorConfigSections(raw);
  const manager = raw as {
    get: (key: string) => unknown;
    setDynamic: (key: string, value: unknown) => void;
  };
  return {
    get: (key) => manager.get(key),
    set: (key, value) => { manager.setDynamic(key, value); },
  };
}

/**
 * Encrypted secret storage for the connector's credentials.
 *
 * No scope is passed, and that is the whole point. Every name in
 * `GOOGLE_SECRET_KEYS` derives from a daemon-owned config path, so the store
 * files it in the daemon tier by itself. Forcing a surface scope here — which
 * this did until now — overrode that and hid the credential from the daemon,
 * and from any node that later took the work over. The daemon is a consumer of
 * this connector, not a bystander to it.
 */
export function googleSecretPort(ctx: CommandContext): GoogleSecretPort {
  const manager = requireSecretsManager(ctx) as {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
  };
  return {
    get: (key) => manager.get(key),
    set: (key, value) => manager.set(key, value),
  };
}

/** Plain node file reads. Adoption never writes, so there is no write side. */
export const googleFilePort = nodeGoogleFilePort;

/**
 * A browser, created only when a step actually needs one.
 *
 * The profile is named and persistent on purpose: Google blocks automated
 * browsers at its sign-in wall, so the person signs in by hand exactly once and
 * every later run reuses that session. This is also why every surface has to
 * warn that the flow will pause — an unattended run cannot get past it.
 */
export function googleBrowserFactory(ctx: CommandContext): () => Promise<GoogleBrowserPort> {
  const homeDirectory = requireShellPaths(ctx).homeDirectory;
  let port: GoogleBrowserPort | null = null;
  return async () => {
    if (port !== null) return port;
    const engine = createAgentBrowserEngine({
      profileRoot: agentBrowserProfileRoot(homeDirectory),
      screenshotDirectory: agentBrowserScreenshotRoot(homeDirectory),
      homeDirectory,
    });
    port = createGoogleBrowserPort(engine, { launch: { profileName: 'google', headless: false } });
    return port;
  };
}

export function googleActionDeps(ctx: CommandContext, intake?: GoogleClientIntakeChoice): GoogleSetupActionDeps {
  const homeDirectory = requireShellPaths(ctx).homeDirectory;
  return {
    config: googleConfigPort(ctx),
    secrets: googleSecretPort(ctx),
    browser: googleBrowserFactory(ctx),
    commands: createProcessCommandPort(),
    fetchPort: { fetch: (url, init) => fetch(url, init) },
    files: googleFilePort,
    // Binding the port Google redirects back to is real machine I/O, so the
    // connector takes it as a port and the concrete listener is named here.
    loopback: startLoopbackListener,
    homeDirectory,
    ...(intake === undefined ? {} : { clientIntake: intake }),
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Status.
 *
 * Reports two independent things and never conflates them: what this product
 * has configured for itself, and what Google credentials already exist on this
 * machine regardless of whether anything is using them. The second is what the
 * shipped build never said out loud.
 *
 * `adoptHint` names the route the calling surface offers, because the command
 * and the workspace card are reached differently and telling a card user to
 * type a slash command would be the same dead pointer this round removed
 * elsewhere.
 */
export async function describeGoogleConnection(
  ctx: CommandContext,
  adoptHint: string,
): Promise<string> {
  const config = googleConfigPort(ctx);
  const secrets = googleSecretPort(ctx);
  const homeDirectory = requireShellPaths(ctx).homeDirectory;

  const state = await detectGoogleSetupState({ config, secrets });
  const lines = ['Google connection', ...describeGoogleSetupState(state).map((entry) => `  ${entry}`)];

  const adoptable = adoptGmailMcpCredentials(googleFilePort, homeDirectory);
  const summary = summarizeCredentials(adoptable, Date.now());
  lines.push('', 'Credentials already on this machine');
  lines.push(`  ${summary.detail}`);
  if (summary.found) {
    lines.push(`  refresh token: ${summary.hasRefreshToken ? 'present' : 'absent'}`);
    if (!state.hasRefreshToken) {
      lines.push(`  These are not in use yet. Take them up with: ${adoptHint}`);
    }
  }

  return lines.join('\n');
}

export interface GoogleAdoptionOutcome {
  readonly adopted: boolean;
  readonly text: string;
}

/**
 * Take up credentials another tool already put on this machine.
 *
 * `setupHint` and `statusHint` are the calling surface's own next steps, for
 * the same reason `describeGoogleConnection` takes one.
 */
export async function adoptGoogleCredentials(
  ctx: CommandContext,
  hints: { readonly setup: string; readonly status: string },
): Promise<GoogleAdoptionOutcome> {
  const outcome = await adoptExistingGoogleCredentials({
    files: googleFilePort,
    config: googleConfigPort(ctx),
    secrets: googleSecretPort(ctx),
    homeDirectory: requireShellPaths(ctx).homeDirectory,
  });

  if (!outcome.adopted) {
    return {
      adopted: false,
      text: [outcome.detail, `Connect an account instead with: ${hints.setup}`].join('\n'),
    };
  }

  return {
    adopted: true,
    text: [
      outcome.detail,
      outcome.scopes.length > 0 ? `Granted scopes: ${outcome.scopes.join(', ')}` : 'The credential lists no scopes.',
      `Check what this enables with: ${hints.status}`,
    ].join('\n'),
  };
}

/** Run one setup path end to end. The caller supplies where progress goes. */
export async function runGoogleSetup(
  path: GoogleSetupPath,
  ctx: CommandContext,
  progress: GoogleProgressPort,
  intake?: GoogleClientIntakeChoice,
): Promise<GoogleSetupReport> {
  return await runGoogleSetupFlow(path, {
    progress,
    runners: buildGoogleSetupRunners(path, googleActionDeps(ctx, intake)),
  });
}
