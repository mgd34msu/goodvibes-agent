import { join } from 'node:path';
import { driverRemediation } from '../browser/browser-driver-remediation.ts';
import { driverSearchDirectories } from '../browser/browser-provision-io.ts';
import { registerCapability, registerFallbackCapability } from './capability-index.ts';
import type { CapabilityDeclaration } from './capability-types.ts';

/**
 * The capabilities this build declares for itself.
 *
 * Two kinds live here. Real ones — browser control — declare the route they are
 * actually invoked through. Placeholders — email and calendar — declare what
 * the agent would need in order to do something it cannot do yet, so the index
 * can answer "not yet, and here is exactly why" instead of "no". A provider
 * that implements one of those ids later registers over the placeholder.
 */

export interface BuiltinCapabilityOptions {
  readonly homeDirectory: string;
  readonly workingDirectory: string;
}

/**
 * Browser control, described the way it actually behaves.
 *
 * The driver prerequisite is deliberately OPTIONAL, and that is the whole point
 * of this declaration. In 1.18.1 it was blocking and probed by module
 * resolution alone, which can never succeed inside a compiled binary — so every
 * binary install reported "the browser driver is missing, reinstall the agent",
 * the model relayed that instead of calling the tool, and the tool's own
 * one-act provisioning (which installs the driver on first use) never got a
 * chance to run. A prerequisite the tool provisions for itself is not something
 * the user has to supply, so it does not block; it only annotates.
 *
 * When the driver genuinely cannot be obtained, the failure is reported at call
 * time by the provisioning policy, which has actually tried and can name what
 * stopped it. That is the honest place for it — a probe cannot know.
 */
function browserControl(options: BuiltinCapabilityOptions): CapabilityDeclaration {
  return {
    id: 'browser.control',
    title: 'Use a web browser',
    summary: 'Open web pages, read them, click, type, fill forms, and take screenshots, with a saved profile that keeps sign-ins between runs. The browser driver and browser install themselves on the first call if they are not already there, which takes a minute or two once.',
    provider: 'goodvibes-agent built-in browser tool',
    invocations: [
      {
        kind: 'model-tool',
        toolName: 'browser',
        modelRoute: 'browser action:"navigate" url:"..."',
        availability: { kind: 'model-tool-registered', toolName: 'browser' },
      },
    ],
    prerequisites: [
      {
        id: 'playwright-driver',
        label: 'The browser driver',
        probe: {
          kind: 'module-resolvable',
          specifier: 'playwright-core',
          label: 'The browser driver',
          // The exact places the runtime loads it from, so the index agrees
          // with what the browser tool will find a moment later.
          searchDirectories: driverSearchDirectories(options.homeDirectory),
        },
        optional: true,
        fix: driverRemediation(),
      },
    ],
  };
}

/**
 * Email, described honestly for a build that cannot send it.
 *
 * Every route is declared with the probe that would make it real, so the moment
 * one exists the index reports it without any other change. Until then the
 * answer names the specific missing piece rather than denying the capability
 * exists.
 */
function emailSend(options: BuiltinCapabilityOptions): CapabilityDeclaration {
  return {
    id: 'email.send',
    title: 'Send email',
    summary: 'Send a message from the owner\'s mailbox.',
    provider: 'goodvibes-agent built-in placeholder',
    invocations: [
      {
        kind: 'operator-method',
        toolName: 'host',
        modelRoute: 'host action:"method" methodId:"email.send"',
        availability: { kind: 'operator-method-served', methodId: 'email.send' },
      },
    ],
    prerequisites: [
      {
        id: 'email-account',
        label: 'A configured mailbox',
        probe: { kind: 'config-value-present', key: 'email.smtpHost', label: 'A configured mailbox' },
        fix: 'Configure the built-in mail account (email.smtpHost, email.username, email.passwordRef, email.fromAddress), or connect an MCP server that provides mail tools.',
      },
    ],
    configurationEvidence: [
      { kind: 'config-value-present', key: 'email.smtpHost', label: 'A configured mailbox' },
      {
        kind: 'any-file-present',
        paths: [
          join(options.homeDirectory, '.gmail-mcp', 'credentials.json'),
          join(options.homeDirectory, '.gmail-mcp', 'gcp-oauth.keys.json'),
        ],
        label: 'Google account credentials',
      },
      // The Google connector's own evidence. This list exists to catch
      // "credentials present, capability silent", and it knew only about the
      // older gmail-mcp credential files — so an install connected through the
      // built-in Google setup left no evidence here at all, which is the very
      // state it was written to detect.
      {
        kind: 'config-value-present',
        key: 'google.oauth.refreshToken',
        label: 'A Google account connected through the built-in setup',
      },
    ],
  };
}

function calendarRead(): CapabilityDeclaration {
  return {
    id: 'calendar.read',
    title: 'Read the calendar',
    summary: 'See what is on the owner\'s calendar.',
    provider: 'goodvibes-agent built-in placeholder',
    invocations: [
      {
        kind: 'operator-method',
        toolName: 'host',
        modelRoute: 'host action:"method" methodId:"calendar.events.list"',
        availability: { kind: 'operator-method-served', methodId: 'calendar.events.list' },
      },
    ],
    prerequisites: [
      {
        id: 'calendar-account',
        label: 'A connected calendar account',
        probe: { kind: 'config-value-present', key: 'calendar.google.clientId', label: 'A connected calendar account' },
        fix: 'Connect a calendar account (calendar.google.clientId and its client secret), or connect an MCP server that provides calendar tools.',
      },
    ],
    configurationEvidence: [
      { kind: 'config-value-present', key: 'calendar.google.clientId', label: 'A connected calendar account' },
      {
        kind: 'config-value-present',
        key: 'google.oauth.refreshToken',
        label: 'A Google account connected through the built-in setup',
      },
      // A private ICS feed reads a calendar without OAuth at all, so an install
      // set up that way is configured even with no client id.
      {
        kind: 'config-value-present',
        key: 'calendar.google.icsUrl',
        label: 'A private calendar feed address',
      },
    ],
  };
}

export function registerBuiltinCapabilities(options: BuiltinCapabilityOptions): void {
  registerCapability(browserControl(options));
  registerFallbackCapability(emailSend(options));
  registerFallbackCapability(calendarRead());
}
