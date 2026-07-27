import { join } from 'node:path';
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

function browserControl(): CapabilityDeclaration {
  return {
    id: 'browser.control',
    title: 'Use a web browser',
    summary: 'Open web pages, read them, click, type, fill forms, and take screenshots, with a saved profile that keeps sign-ins between runs.',
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
        probe: { kind: 'module-resolvable', specifier: 'playwright-core', label: 'The browser driver' },
        fix: 'Reinstall the agent so its dependencies are present: bun add -g @pellux/goodvibes-agent',
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
    ],
  };
}

export function registerBuiltinCapabilities(options: BuiltinCapabilityOptions): void {
  registerCapability(browserControl());
  registerFallbackCapability(emailSend(options));
  registerFallbackCapability(calendarRead());
}
