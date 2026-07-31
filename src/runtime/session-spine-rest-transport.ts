/**
 * session-spine-rest-transport.ts
 *
 * As of the 2026-07-30 daemon/TUI split Stage 1 hoist, the REST transport,
 * probe, and receipt consumer this file used to implement now live in the
 * SDK itself (`@pellux/goodvibes-sdk/platform/runtime/session-spine`,
 * `rest-transport.ts` — adopted from this agent's own implementation
 * verbatim, per that module's "Hoist provenance" doc comment). Callers import
 * `createSessionSpineRestTransport` / `createSessionSpineRestProbe` /
 * `createSessionSpineReceiptConsumer` / `extractSessionSpineReceipts`
 * directly from there now.
 *
 * What stays here, per the SDK module's own explicit carve-out ("Kept out of
 * this hoist: the agent's `createSpineConnectionResolver`... a consumer
 * trust-boundary concern the SDK core deliberately never reaches into"):
 * building the daemon base URL from ConfigManager and reading the
 * connected-host operator token off THIS home directory's
 * operator-tokens.json. That is agent-local trust-boundary wiring, not
 * transport logic, and it is exactly what every SDK rest-transport factory's
 * `resolveConnection` option expects a consumer to supply.
 */

import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { readConnectedHostOperatorToken } from './connected-host-auth.ts';

export interface SessionRegistrationConnection {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly tokenPath?: string;
}

/**
 * Builds a per-op connection resolver from the config manager (host/port,
 * default 127.0.0.1:3421) and the connected-host operator token (env
 * overrides + the canonical operator-tokens.json). Re-read every op so a
 * token that appears after boot is picked up.
 */
export function createSpineConnectionResolver(
  configManager: Pick<ConfigManager, 'get'>,
  homeDirectory: string,
): () => SessionRegistrationConnection {
  return () => {
    const hostValue = configManager.get('controlPlane.host');
    const portValue = configManager.get('controlPlane.port');
    const host = typeof hostValue === 'string' && hostValue.trim().length > 0 ? hostValue.trim() : '127.0.0.1';
    const port = typeof portValue === 'number' && Number.isFinite(portValue) ? portValue : 3421;
    const token = readConnectedHostOperatorToken(homeDirectory);
    return { baseUrl: `http://${host}:${port}`, token: token.token, tokenPath: token.path };
  };
}
