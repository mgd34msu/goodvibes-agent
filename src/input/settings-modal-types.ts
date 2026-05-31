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
  | 'orchestration'
  | 'wrfc'
  | 'tools'
  | 'helper'
  | 'tts'
  | 'service'
  | 'controlPlane'
  | 'httpListener'
  | 'web'
  | 'network'
  | 'surfaces'
  | 'batch'
  | 'automation'
  | 'watchers'
  | 'runtime'
  | 'telemetry'
  | 'cache'
  | 'mcp'
  | 'flags'
  | 'release'
  | 'danger';

export type SettingsFocusPane = 'categories' | 'settings';

export const SETTINGS_CATEGORY_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly categories: readonly SettingsCategory[];
}> = [
  { label: 'Interface', categories: ['display', 'ui', 'behavior', 'permissions'] },
  { label: 'AI Routing', categories: ['provider', 'subscriptions', 'helper', 'tools', 'tts'] },
  { label: 'Service & Network', categories: ['service', 'network', 'controlPlane', 'httpListener', 'web'] },
  { label: 'Surfaces & Integrations', categories: ['surfaces', 'mcp'] },
  { label: 'Automation', categories: ['batch', 'automation', 'watchers', 'orchestration', 'wrfc'] },
  { label: 'Runtime & Data', categories: ['storage', 'runtime', 'cache', 'telemetry'] },
  { label: 'Advanced', categories: ['flags', 'release', 'danger'] },
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
