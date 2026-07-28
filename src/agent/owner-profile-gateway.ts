/**
 * owner-profile-gateway.ts — how this surface reaches the nine `profile.*`
 * control-plane verbs.
 *
 * The owner profile is one Markdown file at daemon scope and the daemon is its
 * single writer (docs/owner-profile.md §3). A surface never opens the file; it
 * calls the verbs. This module is the one place that decides which way the call
 * travels, so no tool or CLI command has to know:
 *
 * - When this process carries the handlers itself — the Agent composes a real
 *   gateway method catalog (runtime/services.ts) — the call runs in-process.
 * - Otherwise the call goes to the connected host over the operator gateway,
 *   the same path `ci`, `principals` and `channel-profiles` already use.
 *
 * The catalog is asked with `hasHandler`, not `get`: a descriptor with no
 * handler answers "not invokable", and silently degrading to that would look
 * like a profile with nothing in it. When neither route is available the caller
 * gets an honest unavailable result naming which route was missing.
 */

import type { GatewayMethodCatalog } from '@pellux/goodvibes-sdk/platform/control-plane';
import type { OperatorMethodId } from '@pellux/goodvibes-sdk/contracts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import type { ProfileMethodId } from '../tools/agent-profile-types.ts';
import {
  formatOperatorGatewayFailure,
  invokeOperatorGatewayMethod,
} from './operator-gateway-call.ts';
import {
  resolveAgentConnectedHostConnection,
  type AgentConnectedHostConfigReader,
} from './routine-schedule-promotion.ts';

export interface ProfileGatewayResult {
  readonly ok: boolean;
  /** Raw daemon payload; the caller narrows it (tools/agent-profile-types.ts). */
  readonly data: unknown;
  /** Present only when `ok` is false. Safe to show him — it never carries a profile value. */
  readonly error?: string;
  /** Which route the call actually took, for honest "where did this answer come from". */
  readonly route: 'in-process' | 'connected-host' | 'unavailable';
}

export type ProfileGatewayInvoke = (
  methodId: ProfileMethodId,
  body: Record<string, unknown>,
) => Promise<ProfileGatewayResult>;

export interface ProfileGatewayOptions {
  /** This process's own catalog, when it carries the profile handlers. */
  readonly gatewayMethods?: GatewayMethodCatalog | undefined;
  readonly configManager: AgentConnectedHostConfigReader;
  readonly homeDirectory: string;
}

/**
 * The nine ids are in the generated operator contract, so this is a widening to
 * the contract's own union rather than a claim about it — the compiler rejects
 * the assignment if a verb is ever renamed or dropped. `invokeOperatorGatewayMethod`
 * resolves the real HTTP binding from the contract the CONNECTED HOST serves,
 * so an older host that does not know the verb answers 404 and is classified as
 * a route-unavailable failure, which is the honest outcome rather than a crash.
 */
function operatorMethodId(methodId: ProfileMethodId): OperatorMethodId {
  return methodId;
}

/** Informational labels only; the SDK resolves the real binding from the contract. */
const PROFILE_ROUTES: Readonly<Record<ProfileMethodId, string>> = {
  'profile.read': 'GET /api/profile',
  'profile.get': 'GET /api/profile/fields/{fieldId}',
  'profile.person': 'POST /api/profile/person',
  'profile.provenance': 'GET /api/profile/fields/{fieldId}/provenance',
  'profile.set': 'POST /api/profile/set',
  'profile.append': 'POST /api/profile/append',
  'profile.forget': 'POST /api/profile/forget',
  'profile.undo': 'POST /api/profile/undo',
  'profile.status': 'GET /api/profile/status',
};

export function profileRouteLabel(methodId: ProfileMethodId): string {
  return PROFILE_ROUTES[methodId];
}

export function createProfileGatewayInvoke(options: ProfileGatewayOptions): ProfileGatewayInvoke {
  return async (methodId, body) => {
    const catalog = options.gatewayMethods;
    if (catalog?.hasHandler(methodId)) {
      try {
        const data = await catalog.invoke(methodId, {
          body,
          context: { clientKind: 'goodvibes-agent', principalKind: 'user' },
        });
        return { ok: true, data, route: 'in-process' };
      } catch (error) {
        return { ok: false, data: null, error: summarizeError(error), route: 'in-process' };
      }
    }

    const connection = resolveAgentConnectedHostConnection(options.configManager, options.homeDirectory);
    const result = await invokeOperatorGatewayMethod<unknown>(
      connection,
      operatorMethodId(methodId),
      profileRouteLabel(methodId),
      body,
    );
    if (!result.ok) {
      return { ok: false, data: null, error: formatOperatorGatewayFailure(result), route: 'connected-host' };
    }
    return { ok: true, data: result.data, route: 'connected-host' };
  };
}
