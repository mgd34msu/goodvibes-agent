/**
 * The `google` tool: Gmail and Google Calendar, natively, in this process.
 *
 * Why this exists rather than a daemon operator method: `email.send`,
 * `email.inbox.list` and `calendar.events.list` are cataloged in the operator
 * contract with `invokable: false` — they advertise routes no daemon dispatch
 * chain serves. A capability declared against one of those is unreachable by
 * construction, and no amount of configuration changes that, which is why
 * setting `email.smtpHost` or adopting credentials moved nothing. Declaring the
 * capability against a permanently un-invokable method is the same defect class
 * as a module with no importer.
 *
 * So the capability index points at this tool instead. It is served here, in
 * this process, by the connector that already had a working `sendMessage`,
 * `listEvents` and OAuth refresh — nothing to install, nothing to configure by
 * hand, and no MCP server.
 *
 * Two boundaries are structural rather than advisory:
 *
 *   - Reading mail records an untrusted ingest, exactly as loading a web page
 *     does. Mail is written by whoever knows the address.
 *   - Sending mail and writing calendar events are outward effects, refused for
 *     the rest of a turn in which untrusted content was read unless the owner
 *     asked for that specific action. Content cannot cause a send.
 */

import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import {
  openGoogleConnection,
  nodeGoogleFilePort,
  type GoogleConnection,
  type GoogleConnectionSources,
} from '../agent/google/google-connection.ts';
import {
  evaluateOutwardEffect,
  getSessionUntrustedContentLedger,
  originOf,
} from '../trust/untrusted-content.ts';
import type { GoogleApiFailure, GoogleApiResult } from '../agent/google/google-api-client.ts';
import { getSessionExpectationBook } from '../agent/signup/session-expectations.ts';
import { deliveryEvidenceFromMessage, describeDeliveryEvidence } from '../agent/signup/delivery-evidence.ts';
import { extractVerification } from '../agent/signup/verification-expectations.ts';

const GOOGLE_ACTIONS = [
  'status',
  'mail.list',
  'mail.read',
  'mail.send',
  'calendar.list',
  'calendar.create',
  'mail.verification',
] as const;

/** Actions that only read. Everything else is an outward effect. */
const READ_ONLY_ACTIONS = new Set<string>(['status', 'mail.list', 'mail.read', 'calendar.list', 'mail.verification']);

export interface AgentGoogleToolOptions {
  readonly homeDirectory: string;
  readonly configGet: (key: string) => unknown;
  readonly secretGet: (key: string) => Promise<string | null>;
  /** Injected in tests; production uses the process fetch. */
  readonly fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

type ToolOutput = { readonly success: true; readonly output: string } | { readonly success: false; readonly error: string };

function failure(message: string): ToolOutput {
  return { success: false, error: message };
}

function ok(output: string): ToolOutput {
  return { success: true, output };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

/** Render an API failure with its own fix text rather than a bare error. */
function describeFailure(result: GoogleApiFailure): ToolOutput {
  return failure(`${result.problem} ${result.fix}`);
}

function isFailure<T>(result: GoogleApiResult<T>): result is GoogleApiFailure {
  return !result.ok;
}

const NOT_CONNECTED = [
  'No Google account is connected, and no Google credentials were found on this machine.',
  'Connect one with: /google setup',
  'If credentials already exist here from another tool, take them up with: /google adopt',
].join(' ');

export function createAgentGoogleTool(options: AgentGoogleToolOptions): Tool {
  const sources: GoogleConnectionSources = {
    files: nodeGoogleFilePort,
    homeDirectory: options.homeDirectory,
    configGet: options.configGet,
    secretGet: options.secretGet,
  };
  const fetchImpl = options.fetchImpl ?? ((url: string, init: RequestInit) => fetch(url, init));
  const fetchPort = { fetch: fetchImpl };

  /** Opened per call: credentials can be connected mid-session. */
  async function connect(): Promise<GoogleConnection | null> {
    return openGoogleConnection(sources, { fetch: fetchPort });
  }

  /**
   * Outward-effect gate. Refuses a send for the rest of a turn in which
   * untrusted content was read, so an email body cannot cause a reply.
   */
  function outwardAllowed(action: string, description: string): ToolOutput | null {
    const decision = evaluateOutwardEffect({
      request: { toolName: 'google', action, description },
      ledger: getSessionUntrustedContentLedger(),
    });
    if (decision.allowed) return null;
    return failure(`${decision.reason} ${decision.fix}`);
  }

  return {
    definition: {
      name: 'google',
      description: 'Read and send Gmail; read and write Google Calendar.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [...GOOGLE_ACTIONS],
            description: 'What to do. status reports the connected account.',
          },
          query: { type: 'string', description: 'Gmail search query for mail.list.' },
          id: { type: 'string', description: 'Message id for mail.read or mail.verification.' },
          to: { type: 'string', description: 'Recipient address for mail.send.' },
          subject: { type: 'string', description: 'Subject for mail.send.' },
          body: { type: 'string', description: 'Plain-text body for mail.send.' },
          summary: { type: 'string', description: 'Event title for calendar.create.' },
          start: { type: 'string', description: 'RFC3339 start time for calendar.create.' },
          end: { type: 'string', description: 'RFC3339 end time for calendar.create.' },
          location: { type: 'string', description: 'Optional event location for calendar.create.' },
          description: { type: 'string', description: 'Optional event description for calendar.create.' },
          timeMin: { type: 'string', description: 'RFC3339 lower bound for calendar.list.' },
          timeMax: { type: 'string', description: 'RFC3339 upper bound for calendar.list.' },
          maxResults: { type: 'number', description: 'How many items to return. Defaults to 10.' },
          confirm: { type: 'boolean', description: 'Required true for mail.send and calendar.create.' },
        },
        required: ['action'],
      },
    },
    execute: async (rawArgs: Record<string, unknown>): Promise<ToolOutput> => {
      const action = readString(rawArgs.action).toLowerCase();
      if (!action) return failure(`google needs an action. Use one of: ${GOOGLE_ACTIONS.join(', ')}.`);
      if (!GOOGLE_ACTIONS.includes(action as (typeof GOOGLE_ACTIONS)[number])) {
        return failure(`Unknown google action "${action}". Use one of: ${GOOGLE_ACTIONS.join(', ')}.`);
      }

      const connection = await connect();
      if (connection === null) return failure(NOT_CONNECTED);
      const { client, summary } = connection;

      if (action === 'status') {
        return ok(
          [
            summary.detail,
            `Send mail: ${summary.canSendMail ? 'permitted' : 'not permitted by the granted scopes'}.`,
            `Read mail: ${summary.canReadMail ? 'permitted' : 'not permitted by the granted scopes'}.`,
            `Calendar: ${summary.canWriteCalendar ? 'read and write' : summary.canReadCalendar ? 'read only' : 'not permitted by the granted scopes'}.`,
          ].join('\n'),
        );
      }

      // Confirmation is required before anything leaves this machine.
      if (!READ_ONLY_ACTIONS.has(action) && rawArgs.confirm !== true) {
        return failure(`google action:"${action}" changes something outside this machine. Re-issue it with confirm:true once the user has asked for it.`);
      }

      if (action === 'mail.list') {
        const result = await client.listMessages({
          query: readString(rawArgs.query) || undefined,
          maxResults: readNumber(rawArgs.maxResults, 10),
        });
        if (isFailure(result)) return describeFailure(result);
        // Subject lines and sender names are attacker-controlled text.
        getSessionUntrustedContentLedger().record({
          surface: 'email',
          origin: 'gmail',
          at: new Date().toISOString(),
        });
        if (result.value.length === 0) return ok('No messages matched.');
        return ok(result.value.map((message) => `${message.id}  ${message.from} — ${message.subject}`).join('\n'));
      }

      if (action === 'mail.read') {
        const id = readString(rawArgs.id);
        if (!id) return failure('google action:"mail.read" needs the message id, from mail.list.');
        const result = await client.getMessage(id);
        if (isFailure(result)) return describeFailure(result);
        getSessionUntrustedContentLedger().record({
          surface: 'email',
          origin: originOf(`mailto:${result.value.from}`),
          at: new Date().toISOString(),
        });
        return ok([`From: ${result.value.from}`, `Subject: ${result.value.subject}`, '', result.value.body].join('\n'));
      }

      if (action === 'mail.verification') {
        // The one case where mail may yield something actionable, and only
        // because the agent provoked it. Correlation runs on receiver-written
        // delivery headers; the To: header is never accepted as evidence.
        const id = readString(rawArgs.id);
        if (!id) return failure('google action:"mail.verification" needs the message id, from mail.list.');
        const result = await client.getMessage(id);
        if (isFailure(result)) return describeFailure(result);

        const book = getSessionExpectationBook();
        const aliasMailboxes = new Set(book.list().map((entry) => entry.recipientAddress));
        const deliveredTo = deliveryEvidenceFromMessage(
          { deliveredTo: result.value.deliveredTo },
          aliasMailboxes,
        );
        getSessionUntrustedContentLedger().record({
          surface: 'email',
          origin: originOf(`mailto:${result.value.from}`),
          at: new Date().toISOString(),
        });

        const match = book.matchCandidate(
          {
            messageId: result.value.id,
            from: result.value.from,
            deliveredTo,
            toHeaderClaim: result.value.to,
            subject: result.value.subject,
            body: result.value.body,
          },
          new Date(),
        );

        if (match.kind !== 'matched') {
          return failure(
            `Not treated as a verification: ${match.reason} (${describeDeliveryEvidence(deliveredTo)}). Nothing was extracted from the message.`,
          );
        }

        const extraction = extractVerification(
          {
            messageId: result.value.id,
            from: result.value.from,
            deliveredTo,
            toHeaderClaim: result.value.to,
            subject: result.value.subject,
            body: result.value.body,
          },
          match.expectation,
        );
        const artifact = extraction.artifact;
        if (artifact.kind === 'link') {
          return ok(`Verification link for ${match.expectation.serviceDomain}: ${artifact.url}`);
        }
        if (artifact.kind === 'code') {
          return ok(`Verification code for ${match.expectation.serviceDomain}: ${artifact.code}`);
        }
        if (artifact.kind === 'refused') {
          return failure(artifact.message);
        }
        return failure(`No verification link or code was found in that message: ${artifact.reason}`);
      }

      if (action === 'mail.send') {
        const to = readString(rawArgs.to);
        const subject = readString(rawArgs.subject);
        const body = readString(rawArgs.body);
        if (!to || !subject) return failure('google action:"mail.send" needs to and subject.');
        if (!summary.canSendMail) {
          return failure('The connected Google account was not granted a scope that permits sending mail. Re-authorize with: /google setup --path oauth');
        }
        const refused = outwardAllowed('email.send', `sending mail to ${to}`);
        if (refused !== null) return refused;

        const result = await client.sendMessage({ to, subject, body });
        if (isFailure(result)) return describeFailure(result);
        return ok(`Sent to ${to} (message ${result.value.id}).`);
      }

      if (action === 'calendar.list') {
        const result = await client.listEvents({
          timeMin: readString(rawArgs.timeMin) || undefined,
          timeMax: readString(rawArgs.timeMax) || undefined,
          maxResults: readNumber(rawArgs.maxResults, 10),
        });
        if (isFailure(result)) return describeFailure(result);
        if (result.value.length === 0) return ok('No events in that range.');
        return ok(result.value.map((event) => `${event.start}  ${event.summary}${event.location ? ` (${event.location})` : ''}`).join('\n'));
      }

      const summaryText = readString(rawArgs.summary);
      const start = readString(rawArgs.start);
      const end = readString(rawArgs.end);
      if (!summaryText || !start || !end) {
        return failure('google action:"calendar.create" needs summary, start and end.');
      }
      if (!summary.canWriteCalendar) {
        return failure('The connected Google account was not granted a scope that permits writing to the calendar. Re-authorize with: /google setup --path oauth');
      }
      const refusedEvent = outwardAllowed('calendar.create', `creating the event "${summaryText}"`);
      if (refusedEvent !== null) return refusedEvent;

      const created = await client.createEvent({
        summary: summaryText,
        start,
        end,
        ...(readString(rawArgs.location) ? { location: readString(rawArgs.location) } : {}),
        ...(readString(rawArgs.description) ? { description: readString(rawArgs.description) } : {}),
      });
      if (isFailure(created)) return describeFailure(created);
      return ok(`Created "${created.value.summary}" starting ${created.value.start}.`);
    },
  };
}

export function registerAgentGoogleTool(registry: ToolRegistry, options: AgentGoogleToolOptions): void {
  if (!registry.has('google')) registry.register(createAgentGoogleTool(options));
}
