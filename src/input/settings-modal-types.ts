import type { ConfigSetting } from '@pellux/goodvibes-sdk/platform/config';
import type { ConfigKey } from '@pellux/goodvibes-sdk/platform/config';
import type { ProviderAuthFreshness, ProviderAuthRoute } from '@/runtime/index.ts';
import type { FeatureSetting, FlagState } from '@/runtime/index.ts';

export interface SettingsModalChange {
  readonly key: ConfigKey;
  readonly previousValue: unknown;
  readonly value: unknown;
}

export interface SettingsModalChangeResult {
  readonly message?: string;
}

export type SettingsModalChangeHandler = (change: SettingsModalChange) => SettingsModalChangeResult | void;

export interface SettingsModalOpenOptions {
  readonly onSettingApplied?: SettingsModalChangeHandler;
}

export type SettingsCategory =
  | 'display'
  | 'ui'
  | 'provider'
  | 'subscriptions'
  | 'behavior'
  | 'profile'
  | 'storage'
  | 'permissions'
  | 'diagnostics'
  | 'tools'
  | 'helper'
  | 'tts'
  | 'surfaces'
  | 'conversationGate'
  | 'automation'
  | 'checkin'
  | 'service'
  | 'controlPlane'
  | 'httpListener'
  | 'danger'
  | 'web'
  | 'watchers'
  | 'relay'
  | 'network'
  | 'orchestration'
  | 'planner'
  | 'runtime'
  | 'sandbox'
  | 'batch'
  | 'cloudflare'
  | 'wrfc'
  | 'telemetry'
  | 'cache'
  | 'mcp'
  | 'flags'
  | 'release'
  | 'daemon'
  | 'atRest'
  | 'learning'
  | 'agents'
  | 'notifications'
  | 'policy'
  | 'fetch'
  | 'security'
  | 'integrations'
  | 'update'
  | 'pricing'
  | 'power'
  | 'fleet'
  | 'voice'
  | 'device'
  | 'cluster'
  | 'memory';

export type SettingsFocusPane = 'categories' | 'settings';

/**
 * Config-key roots that have no category of their own, and the category each
 * one is listed under instead.
 *
 * A setting's category is normally its key's first segment, so a root with no
 * matching category matches nothing and its keys are dropped from the
 * workspace entirely — present in the schema, read by the daemon, and reachable
 * only by hand-editing the config file. Anything listed here is deliberately
 * shown somewhere it makes sense to a reader instead.
 *
 * `push` — the VAPID contact address and the subscription housekeeping bounds
 * describe how a notification is DELIVERED, so they sit with the
 * `notifications.*` keys that decide which events are pushed in the first
 * place.
 *
 * `cluster` — heartbeat timing, the multicast group, the shared secret and the
 * key-rotation windows all describe how this node finds and trusts its peers.
 * That is the same subject `fleet.*` already covers, so they are listed
 * together rather than under a category of their own.
 */
export const CROSS_LISTED_SETTING_ROOTS: Readonly<Record<string, SettingsCategory>> = {
  push: 'notifications',
  cluster: 'fleet',
};

export const SETTINGS_CATEGORY_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly categories: readonly SettingsCategory[];
}> = [
  // `profile` sits with the other categories that decide how the Agent treats
  // HIM: whether it learns what he tells it about himself, whether it says what
  // it recorded, and whether the few harmless facts (his city, his timezone,
  // how he likes replies written) ride along on a turn. That is the same
  // subject `behavior`, `policy` and `permissions` already cover, and the keys
  // are daemon-owned like several others already listed here, so the group's
  // membership does not turn on which process stores the value.
  { label: 'Agent Experience', categories: ['display', 'ui', 'behavior', 'profile', 'agents', 'notifications', 'permissions', 'policy', 'fetch', 'diagnostics', 'power'] },
  { label: 'Models and Providers', categories: ['provider', 'subscriptions', 'helper', 'tools', 'tts', 'voice', 'pricing'] },
  { label: 'Agent-local state', categories: ['storage', 'cache', 'telemetry', 'atRest', 'security', 'learning'] },
  { label: 'Channels and Tools', categories: ['surfaces', 'conversationGate', 'device', 'mcp', 'automation', 'checkin', 'integrations'] },
  // `danger` sits with the other listener/binding categories because that is
  // what it is: danger.httpListener opens an inbound webhook listener. It is
  // rendered like any other setting rather than hidden — the write is gated by
  // the narrow confirmation list in src/tools/agent-settings-write-policy.ts,
  // which can name the key and state the hazard. A hidden key cannot.
  // `cluster` belongs here rather than being hidden. The Agent composes no
  // inbound channel consumer of its own — a guard test holds that — so it is
  // never a candidate in an election. But every cluster.* key is DAEMON-owned
  // (the SDK's config-ownership.ts), so a write from this surface routes to the
  // daemon that acts on it, exactly like every other key in this group. Hiding
  // them would leave the owner unable to configure which of his machines reads
  // the inbox from the surface he actually uses, which is the same mistake the
  // retired host-owned lock made.
  { label: 'Daemon Runtime', categories: ['daemon', 'service', 'controlPlane', 'httpListener', 'danger', 'web', 'watchers', 'network', 'relay', 'cluster', 'update'] },
  { label: 'Advanced Runtime', categories: ['orchestration', 'fleet', 'planner', 'runtime', 'sandbox', 'batch', 'cloudflare', 'wrfc', 'memory'] },
  { label: 'Advanced', categories: ['flags', 'release'] },
];

export const SETTINGS_CATEGORIES: SettingsCategory[] = SETTINGS_CATEGORY_GROUPS.flatMap(group => group.categories);

export interface SettingEntry {
  setting: ConfigSetting;
  currentValue: unknown;
  isDefault: boolean;
  effectiveSource?: 'default' | 'local' | 'synced' | 'managed';
  locked?: boolean;
  conflict?: boolean;
  sourceLabel?: string;
  lockReason?: string;
}

export interface FlagEntry {
  /** The feature as FEATURE_SETTINGS describes it: domain, enablement shape, settings keys, real description. */
  feature: FeatureSetting;
  /** Live gate state from the manager (kill-switch aware); config-derived when no manager is attached. */
  state: FlagState;
  /** The enablement settings key's current config value, rendered on the row. */
  enablementValue: string;
}

export interface McpEntry {
  name: string;
  connected: boolean;
  role: string;
  trustMode: 'constrained' | 'ask-on-risk' | 'allow-all' | 'blocked';
  allowedPaths: string[];
  allowedHosts: string[];
}

export interface SubscriptionEntry {
  provider: string;
  state: 'active' | 'pending' | 'available';
  tokenType?: string;
  expiresAt?: number;
  oauthConfigured: boolean;
  activeRoute?: ProviderAuthRoute;
  preferredRoute?: ProviderAuthRoute;
  authFreshness?: ProviderAuthFreshness;
  routeReason?: string;
  issues?: string[];
  nextActions?: string[];
}
