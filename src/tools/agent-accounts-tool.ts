/**
 * The `accounts` tool: the durable record of every account the agent created.
 *
 * Creating accounts autonomously, in service of work the owner asked for, is
 * authorized — it is why the agent has its own email address. What was never
 * authorized is doing it invisibly. So the safety mechanism here is visibility,
 * not prohibition: every signup is recorded at creation time, the list is
 * enumerable, and every entry carries the secret-store key name that revocation
 * starts from.
 *
 * `AgentAccountRegistry` had all of this and no caller outside its own test, so
 * an account created today would leave no trace. This is the caller.
 *
 * The credential itself never reaches this tool. Only `credentialSecretKey`,
 * the NAME of the secret-store entry holding it — the registry rejects
 * secret-looking text in every field.
 *
 * The one boundary that does not move: an outward effect refused because
 * untrusted content was read this turn stays refused. A web page describing a
 * signup form cannot cause a signup.
 */

import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import { AgentAccountRegistry, type AgentAccountRecord } from '../agent/signup/account-registry.ts';
import { evaluateOutwardEffect, getSessionUntrustedContentLedger } from '../trust/untrusted-content.ts';

const ACCOUNT_ACTIONS = ['list', 'record', 'forget', 'sweep'] as const;

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

function renderAccount(account: AgentAccountRecord): string {
  return [
    `${account.id}  ${account.serviceDomain}`,
    `    created ${account.createdAt} for ${account.purpose}`,
    `    signed up at ${account.serviceUrl} as ${account.aliasAddress}`,
    `    credential: secret-store key ${account.credentialSecretKey}`,
  ].join('\n');
}

export interface AgentAccountsToolOptions {
  readonly registry: AgentAccountRegistry;
  /** Secret-store key names, so sweep can drop records whose credential is gone. */
  readonly knownSecretKeys?: () => Promise<readonly string[]>;
}

export function createAgentAccountsTool(options: AgentAccountsToolOptions): Tool {
  const { registry } = options;

  return {
    definition: {
      name: 'accounts',
      description: 'The record of accounts created on the owner\'s behalf: list them, record a new one, forget one, or reap stale entries.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [...ACCOUNT_ACTIONS],
            description: 'What to do. Record every account at creation time, before storing its credential.',
          },
          serviceDomain: { type: 'string', description: 'Domain the account was created at, for record.' },
          serviceUrl: { type: 'string', description: 'The http(s) page the account was created at, for record.' },
          aliasAddress: { type: 'string', description: 'The per-signup alias address used, for record.' },
          purpose: { type: 'string', description: 'What the account is for, in plain language, for record.' },
          credentialSecretKey: {
            type: 'string',
            description: 'The NAME of the secret-store entry holding the credential. Never the credential itself.',
          },
          id: { type: 'string', description: 'Account record id, for forget.' },
          maxAgeDays: { type: 'number', description: 'For sweep: drop records older than this.' },
        },
        required: ['action'],
      },
    },
    execute: async (rawArgs: Record<string, unknown>): Promise<ToolOutput> => {
      const action = readString(rawArgs.action).toLowerCase();
      if (!ACCOUNT_ACTIONS.includes(action as (typeof ACCOUNT_ACTIONS)[number])) {
        return failure(`accounts needs one of: ${ACCOUNT_ACTIONS.join(', ')}.`);
      }

      try {
        if (action === 'list') {
          const snapshot = registry.snapshot();
          if (snapshot.accounts.length === 0) {
            return ok(`No accounts have been recorded. The register lives at ${snapshot.path}.`);
          }
          const dropped = snapshot.droppedOnRead > 0
            ? `\n\n${snapshot.droppedOnRead} malformed record(s) were dropped when reading ${snapshot.path}.`
            : '';
          return ok(`${snapshot.accounts.map(renderAccount).join('\n')}${dropped}`);
        }

        if (action === 'record') {
          // Recording is the visible half of an outward effect that already
          // happened, so it is gated the same way the signup itself is: page
          // text cannot drive the agent into registering an account.
          const decision = evaluateOutwardEffect({
            request: {
              toolName: 'accounts',
              action: 'accounts.record',
              description: `recording an account created at ${readString(rawArgs.serviceDomain) || 'a service'}`,
            },
            ledger: getSessionUntrustedContentLedger(),
          });
          if (!decision.allowed) return failure(`${decision.reason} ${decision.fix}`);

          const account = registry.record({
            serviceDomain: readString(rawArgs.serviceDomain),
            serviceUrl: readString(rawArgs.serviceUrl),
            aliasAddress: readString(rawArgs.aliasAddress),
            purpose: readString(rawArgs.purpose),
            credentialSecretKey: readString(rawArgs.credentialSecretKey),
          });
          return ok(`Recorded:\n${renderAccount(account)}`);
        }

        if (action === 'forget') {
          const id = readString(rawArgs.id);
          if (!id) return failure('accounts action:"forget" needs the record id, from accounts action:"list".');
          const removed = registry.forget(id);
          return ok(
            `Forgot the record for ${removed.serviceDomain}. This removed the RECORD only — the account at ${removed.serviceUrl} still exists, and its credential is still under secret-store key ${removed.credentialSecretKey}.`,
          );
        }

        const known = options.knownSecretKeys ? await options.knownSecretKeys() : undefined;
        const maxAgeDays = typeof rawArgs.maxAgeDays === 'number' ? rawArgs.maxAgeDays : undefined;
        const result = registry.sweep({
          ...(known === undefined ? {} : { knownSecretKeys: known }),
          ...(maxAgeDays === undefined ? {} : { maxAgeDays }),
        });
        return ok(
          result.removed.length === 0
            ? `Nothing to reap; ${result.remaining} record(s) remain.`
            : `Reaped ${result.removed.length} record(s) whose credential was gone or which aged out: ${result.removed.map((entry) => entry.id).join(', ')}. ${result.remaining} remain.`,
        );
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function registerAgentAccountsTool(registry: ToolRegistry, options: AgentAccountsToolOptions): void {
  if (!registry.has('accounts')) registry.register(createAgentAccountsTool(options));
}
