import type { ConfigSetting } from '@pellux/goodvibes-sdk/platform/config';
import type { ConfigKey } from '@pellux/goodvibes-sdk/platform/config';
import type { ProviderAuthFreshness, ProviderAuthRoute } from '@/runtime/index.ts';
import type { FeatureFlag, FlagState } from '@/runtime/index.ts';

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
  | 'tools'
  | 'helper'
  | 'tts'
  | 'surfaces'
  | 'automation'
  | 'service'
  | 'controlPlane'
  | 'httpListener'
  | 'web'
  | 'watchers'
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
  | 'daemon';

export type SettingsFocusPane = 'categories' | 'settings';

export const SETTINGS_CATEGORY_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly categories: readonly SettingsCategory[];
}> = [
  { label: 'Agent Experience', categories: ['display', 'ui', 'behavior', 'permissions'] },
  { label: 'Models and Providers', categories: ['provider', 'subscriptions', 'helper', 'tools', 'tts'] },
  { label: 'Agent-local state', categories: ['storage', 'cache', 'telemetry'] },
  { label: 'Channels and Tools', categories: ['surfaces', 'mcp', 'automation'] },
  { label: 'Daemon Runtime', categories: ['daemon', 'service', 'controlPlane', 'httpListener', 'web', 'watchers', 'network'] },
  { label: 'Advanced Runtime', categories: ['orchestration', 'planner', 'runtime', 'sandbox', 'batch', 'cloudflare', 'wrfc'] },
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
  /**
   * Plain-language note when this setting's displayed value does not match
   * what actually takes effect at runtime, because a separate (often hidden
   * or locked) key takes precedence over it. Currently only populated for
   * daemon.enabled when the deprecated danger.daemon alias is explicitly
   * set — resolveDaemonEnabled() (SDK platform/config) gives danger.daemon
   * precedence whenever it is set, so a user could see daemon.enabled: true
   * here while the daemon actually stays off, with no way to edit
   * danger.daemon from this modal (it is hidden and host-owned/locked).
   */
  overrideNote?: string;
}

export interface FlagEntry {
  flag: FeatureFlag;
  state: FlagState;
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
