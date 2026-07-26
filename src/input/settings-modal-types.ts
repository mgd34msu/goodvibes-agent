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
  | 'memory';

export type SettingsFocusPane = 'categories' | 'settings';

export const SETTINGS_CATEGORY_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly categories: readonly SettingsCategory[];
}> = [
  { label: 'Agent Experience', categories: ['display', 'ui', 'behavior', 'agents', 'notifications', 'permissions', 'policy', 'fetch', 'diagnostics', 'power'] },
  { label: 'Models and Providers', categories: ['provider', 'subscriptions', 'helper', 'tools', 'tts', 'voice', 'pricing'] },
  { label: 'Agent-local state', categories: ['storage', 'cache', 'telemetry', 'atRest', 'security', 'learning'] },
  { label: 'Channels and Tools', categories: ['surfaces', 'conversationGate', 'device', 'mcp', 'automation', 'checkin', 'integrations'] },
  // `danger` sits with the other listener/binding categories because that is
  // what it is: danger.httpListener opens an inbound webhook listener. It is
  // rendered like any other setting rather than hidden — the write is gated by
  // the narrow confirmation list in src/tools/agent-settings-write-policy.ts,
  // which can name the key and state the hazard. A hidden key cannot.
  { label: 'Daemon Runtime', categories: ['daemon', 'service', 'controlPlane', 'httpListener', 'danger', 'web', 'watchers', 'network', 'relay', 'update'] },
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
