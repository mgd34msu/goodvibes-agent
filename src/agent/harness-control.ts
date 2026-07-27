import type { ConfigKey, ConfigManager, ConfigSetting } from '@pellux/goodvibes-sdk/platform/config';
import { isValidConfigKey } from '@pellux/goodvibes-sdk/platform/config';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import type { SecretsManager } from '../config/secrets.ts';
import {
  buildGoodVibesSecretKey,
  isSecretConfigKey,
  isSecretReferenceValue,
  persistSecretBackedConfigValue,
} from '../config/secret-config.ts';
import {
  isAgentHiddenSettingKey,
} from '../config/agent-settings-policy.ts';
import {
  configKeyScope,
  openEffectiveConfigView,
  routeConfigWrite,
  type AgentConfigRoutingOptions,
  type ConfigScope,
  type EffectiveConfigView,
} from '../config/daemon-config-routing.ts';

export interface HarnessSettingFilters {
  readonly key?: string;
  readonly category?: string;
  readonly prefix?: string;
  readonly query?: string;
  readonly includeHidden?: boolean;
  readonly limit?: number;
}

export type HarnessSettingLookupSource = 'key' | 'target' | 'query';
export type HarnessSettingResolvedBy = 'key' | 'case-insensitive-key' | 'search';

export interface HarnessSettingLookup {
  readonly source: HarnessSettingLookupSource;
  readonly input: string;
  readonly resolvedBy: HarnessSettingResolvedBy;
}

export interface HarnessSettingLookupArgs {
  readonly key?: string;
  readonly target?: string;
  readonly query?: string;
  readonly category?: string;
  readonly prefix?: string;
  readonly includeHidden?: boolean;
}

export interface HarnessSettingCandidate {
  readonly key: string;
  readonly category: string;
  readonly type: ConfigSetting['type'];
  readonly writable: boolean;
  readonly visibleInWorkspace: boolean;
  readonly modelRoute: string;
  readonly description: string;
}

export type HarnessSettingResolution =
  | {
    readonly status: 'found';
    readonly setting: HarnessSettingDescriptor;
    readonly lookup: HarnessSettingLookup;
  }
  | {
    readonly status: 'ambiguous';
    readonly input: string;
    readonly candidates: readonly HarnessSettingCandidate[];
  };

export interface HarnessSettingDescriptor {
  readonly key: string;
  readonly category: string;
  readonly type: ConfigSetting['type'];
  readonly value: unknown;
  readonly default: unknown;
  readonly configured: boolean;
  readonly writable: boolean;
  readonly visibleInWorkspace: boolean;
  readonly modelRoute: string;
  readonly description: string;
  readonly enumValues?: readonly string[];
  readonly lookup?: HarnessSettingLookup;
  /** Which runtime owns this key: 'daemon' | 'client' | 'user'. */
  readonly scope?: ConfigScope;
  /** Which runtime answered the read: 'daemon' | 'local'. */
  readonly valueSource?: string;
  /** The file or daemon base URL the value came from. */
  readonly valueStore?: string;
  /**
   * True when the daemon owns this key and could not be reached, so its current
   * value is genuinely unknown. `value` is undefined and must NOT be presented
   * as the setting's value — the default would read as the current setting.
   */
  readonly valueUnavailable?: boolean;
}

export interface HarnessSettingSummary {
  readonly key: string;
  readonly category: string;
  readonly type: ConfigSetting['type'];
  readonly value: unknown;
  readonly configured: boolean;
  readonly writable: boolean;
  readonly visibleInWorkspace: boolean;
  readonly modelRoute: string;
  readonly summary: string;
  readonly enumValues?: readonly string[];
  /** Which runtime owns this key: 'daemon' | 'client' | 'user'. */
  readonly scope?: ConfigScope;
  /** Which runtime answered the read: 'daemon' | 'local'. */
  readonly valueSource?: string;
  /** The file or daemon base URL the value came from. */
  readonly valueStore?: string;
  /** True when the daemon owns this key and its current value is unknown. */
  readonly valueUnavailable?: boolean;
}

export interface HarnessSettingMutationResult {
  readonly key: string;
  readonly action: 'set' | 'reset';
  readonly previous: unknown;
  readonly current: unknown;
  /** Which runtime owns the key: 'daemon' | 'client' | 'user'. */
  readonly scope?: ConfigScope | undefined;
  /** Which runtime actually applied it. */
  readonly appliedBy?: 'daemon' | 'local' | undefined;
  /**
   * The file (or daemon) the value landed in. Reported because "saved" is
   * ambiguous until the store is named: a daemon-owned value written into the
   * agent's own settings file configures nothing.
   */
  readonly persistedTo?: string | undefined;
}

// A hard ceiling this far above CONFIG_SCHEMA's current size (509, after
// payments.* + daemon.timezone) leaves headroom for ordinary schema growth
// without silently truncating an unfiltered listing again — that is exactly
// how the previous ceiling of 500 quietly dropped 8 settings from the
// default catalog response the moment the schema passed it.
const DEFAULT_SETTING_LIMIT = 2000;
const MAX_SETTING_LIMIT = 2000;
/**
 * Credential-looking LEAF names. Matched against the last dot segment only, and
 * never against the whole key, so an unrelated ancestor cannot drag a plain
 * value into redaction.
 */
const SENSITIVE_LEAF_PATTERN = /(?:secret|token|password|passphrase|api[-_.]?key|signing)/i;

/**
 * Identifier leaves that merely NAME a credential rather than being one.
 * `surfaces.telegram.discoveredBotTokenId` is the live example: it is the id of
 * a discovered bot, not the bot's token, and redacting it hid the result of the
 * bot-identity discovery from the person who asked for it. An `id` leaf that
 * also says secret/password is still treated as a secret.
 */
const IDENTIFIER_LEAF_PATTERN = /(?:id|ids|name|username|kind|type|mode|source)$/i;

function isSensitiveSettingKey(key: string): boolean {
  const leaf = key.split('.').pop() ?? key;
  if (!SENSITIVE_LEAF_PATTERN.test(leaf)) return false;
  if (/(?:secret|password|passphrase)/i.test(leaf)) return true;
  return !IDENTIFIER_LEAF_PATTERN.test(leaf);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function previewText(value: string, maxLength = 56): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function clampLimit(value: unknown, fallback = DEFAULT_SETTING_LIMIT): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_SETTING_LIMIT, Math.trunc(value)));
}

function findSetting(configManager: Pick<ConfigManager, 'getSchema'>, rawKey: string): ConfigSetting | null {
  if (!rawKey || !isValidConfigKey(rawKey)) return null;
  return configManager.getSchema().find((setting) => setting.key === rawKey) ?? null;
}

function settingLookupText(setting: ConfigSetting): string {
  return [setting.key, setting.description, setting.type, ...(setting.enumValues ?? [])].join('\n').toLowerCase();
}

function settingMatchesSearch(setting: ConfigSetting, query: string): boolean {
  return settingLookupText(setting).includes(query);
}

function settingCandidate(setting: ConfigSetting): HarnessSettingCandidate {
  return {
    key: setting.key,
    category: setting.key.split('.')[0] ?? '',
    type: setting.type,
    // Every setting is writable through this surface now that the blanket
    // host-owned lock is gone. Hazardous keys are not read-only — they are
    // gated at write time by agent-settings-write-policy.ts, which can name the
    // key and state why, and a routed write reports the store it landed in.
    writable: true,
    visibleInWorkspace: !isAgentHiddenSettingKey(setting.key),
    modelRoute: settingModelRoute(setting),
    description: setting.description,
  };
}

function settingLookupFromArgs(args: HarnessSettingLookupArgs): { source: HarnessSettingLookupSource; input: string } | null {
  const key = args.key?.trim();
  if (key) return { source: 'key', input: key };
  const target = args.target?.trim();
  if (target) return { source: 'target', input: target };
  const query = args.query?.trim();
  if (query) return { source: 'query', input: query };
  return null;
}

export function redactHarnessSettingValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value) return value;
  if (isSecretConfigKey(key) || isSensitiveSettingKey(key)) {
    if (isSecretReferenceValue(value)) return '<secret-ref>';
    return '<redacted>';
  }
  return value;
}

function settingModelRoute(setting: ConfigSetting): string {
  // There is no read-only route any more. It existed solely for the retired
  // blanket host-owned lock, and no key resolved to it once that lock's lists
  // were emptied.
  return `settings set|reset key:${setting.key}`;
}

/**
 * Resolve a setting's EFFECTIVE value and name the store it came from.
 *
 * With a view, a daemon-owned key reports the daemon's live value; without one
 * it falls back to the agent's own resolution (the pre-routing behavior, kept
 * so every existing call site still works). When the daemon owns the key and
 * could not be reached, `unavailable` is true and there is deliberately NO
 * value — reporting a default here is what told the owner his bot username was
 * not set when it was.
 */
function resolveSettingValue(
  configManager: Pick<ConfigManager, 'get'>,
  setting: ConfigSetting,
  view: EffectiveConfigView | undefined,
): { value: unknown; unavailable: boolean; source?: string; store?: string } {
  if (!view) return { value: configManager.get(setting.key as ConfigKey), unavailable: false };
  const entry = view.describe(setting.key);
  if (entry.status === 'unavailable') {
    return { value: undefined, unavailable: true, source: entry.source, store: entry.store };
  }
  return { value: entry.value, unavailable: false, source: entry.source, store: entry.store };
}

export function describeHarnessSetting(
  configManager: Pick<ConfigManager, 'get'>,
  setting: ConfigSetting,
  options: { readonly lookup?: HarnessSettingLookup; readonly view?: EffectiveConfigView } = {},
): HarnessSettingDescriptor {
  const resolved = resolveSettingValue(configManager, setting, options.view);
  return {
    key: setting.key,
    category: setting.key.split('.')[0] ?? '',
    type: setting.type,
    value: redactHarnessSettingValue(setting.key, resolved.value),
    default: redactHarnessSettingValue(setting.key, setting.default),
    configured: !resolved.unavailable && !valuesEqual(resolved.value, setting.default),
    writable: true,
    visibleInWorkspace: !isAgentHiddenSettingKey(setting.key),
    modelRoute: settingModelRoute(setting),
    description: setting.description,
    scope: configKeyScope(setting.key),
    ...(resolved.source ? { valueSource: resolved.source } : {}),
    ...(resolved.store ? { valueStore: resolved.store } : {}),
    ...(resolved.unavailable ? { valueUnavailable: true } : {}),
    ...(setting.enumValues ? { enumValues: setting.enumValues } : {}),
    ...(options.lookup ? { lookup: options.lookup } : {}),
  };
}

export function describeHarnessSettingSummary(
  configManager: Pick<ConfigManager, 'get'>,
  setting: ConfigSetting,
  options: { readonly view?: EffectiveConfigView } = {},
): HarnessSettingSummary {
  const resolved = resolveSettingValue(configManager, setting, options.view);
  return {
    key: setting.key,
    category: setting.key.split('.')[0] ?? '',
    type: setting.type,
    value: redactHarnessSettingValue(setting.key, resolved.value),
    configured: !resolved.unavailable && !valuesEqual(resolved.value, setting.default),
    writable: true,
    visibleInWorkspace: !isAgentHiddenSettingKey(setting.key),
    modelRoute: settingModelRoute(setting),
    summary: previewText(setting.description),
    scope: configKeyScope(setting.key),
    ...(resolved.source ? { valueSource: resolved.source } : {}),
    ...(resolved.store ? { valueStore: resolved.store } : {}),
    ...(resolved.unavailable ? { valueUnavailable: true } : {}),
    ...(setting.enumValues ? { enumValues: setting.enumValues } : {}),
  };
}

function filterHarnessSettingSchema(
  configManager: Pick<ConfigManager, 'getSchema'>,
  filters: HarnessSettingFilters = {},
): readonly ConfigSetting[] {
  const key = filters.key?.trim();
  const category = filters.category?.trim();
  const prefix = filters.prefix?.trim();
  const query = filters.query?.trim().toLowerCase();

  return configManager.getSchema()
    .filter((setting) => {
      if (key && setting.key !== key) return false;
      if (category && setting.key.split('.')[0] !== category) return false;
      if (prefix && !setting.key.startsWith(prefix)) return false;
      if (!filters.includeHidden && isAgentHiddenSettingKey(setting.key)) return false;
      if (query) {
        if (!settingMatchesSearch(setting, query)) return false;
      }
      return true;
    });
}

export function listHarnessSettings(
  configManager: Pick<ConfigManager, 'get' | 'getSchema'>,
  filters: HarnessSettingFilters = {},
  options: { readonly includeParameters?: boolean; readonly view?: EffectiveConfigView } = {},
): readonly (HarnessSettingDescriptor | HarnessSettingSummary)[] {
  const limit = clampLimit(filters.limit);
  const view = options.view;

  return filterHarnessSettingSchema(configManager, filters)
    .map((setting) => options.includeParameters
      ? describeHarnessSetting(configManager, setting, { ...(view ? { view } : {}) })
      : describeHarnessSettingSummary(configManager, setting, { ...(view ? { view } : {}) }))
    .slice(0, limit);
}

/**
 * The effective merged settings view: daemon-owned keys carry the DAEMON's live
 * value, everything else the agent's own, each entry naming the store it came
 * from. One daemon round-trip for the whole listing.
 *
 * This is the read counterpart of ownership-routed writes. Listing only the
 * agent's own store is what made the same key name read blank in one place and
 * set in another with nothing explaining why.
 */
export async function listEffectiveHarnessSettings(
  configManager: ConfigManager,
  filters: HarnessSettingFilters = {},
  options: { readonly includeParameters?: boolean; readonly routing?: AgentConfigRoutingOptions } = {},
): Promise<readonly (HarnessSettingDescriptor | HarnessSettingSummary)[]> {
  const view = await openEffectiveConfigView(configManager, {
    homeDir: configManager.getHomeDirectory() ?? undefined,
    ...(options.routing ?? {}),
  });
  return listHarnessSettings(configManager, filters, {
    ...(options.includeParameters === undefined ? {} : { includeParameters: options.includeParameters }),
    view,
  });
}

export function countHarnessSettings(
  configManager: Pick<ConfigManager, 'getSchema'>,
  filters: HarnessSettingFilters = {},
): number {
  return filterHarnessSettingSchema(configManager, filters).length;
}

export function getHarnessSetting(
  configManager: Pick<ConfigManager, 'get' | 'getSchema'>,
  key: string,
  lookup?: HarnessSettingLookup,
  view?: EffectiveConfigView,
): HarnessSettingDescriptor | null {
  const setting = findSetting(configManager, key);
  return setting ? describeHarnessSetting(configManager, setting, { lookup, ...(view ? { view } : {}) }) : null;
}

/**
 * Read one setting from whichever runtime OWNS it — the daemon for a
 * daemon-owned key, the agent's own store otherwise. The descriptor carries
 * `valueStore` (where the answer came from) and `valueUnavailable` (the daemon
 * owns it and could not be reached, so its value is unknown rather than
 * defaulted).
 */
export async function getEffectiveHarnessSetting(
  configManager: ConfigManager,
  key: string,
  options: { readonly lookup?: HarnessSettingLookup; readonly routing?: AgentConfigRoutingOptions } = {},
): Promise<HarnessSettingDescriptor | null> {
  const view = await openEffectiveConfigView(configManager, {
    homeDir: configManager.getHomeDirectory() ?? undefined,
    ...(options.routing ?? {}),
  });
  return getHarnessSetting(configManager, key, options.lookup, view);
}

export function resolveHarnessSetting(
  configManager: Pick<ConfigManager, 'get' | 'getSchema'>,
  args: HarnessSettingLookupArgs,
  view?: EffectiveConfigView,
): HarnessSettingResolution | null {
  const lookup = settingLookupFromArgs(args);
  if (!lookup) return null;

  const exact = findSetting(configManager, lookup.input);
  if (exact) {
    const resolvedLookup = { ...lookup, resolvedBy: 'key' as const };
    return {
      status: 'found',
      setting: describeHarnessSetting(configManager, exact, { lookup: resolvedLookup, ...(view ? { view } : {}) }),
      lookup: resolvedLookup,
    };
  }

  const inputLower = lookup.input.toLowerCase();
  const schema = configManager.getSchema();
  const caseInsensitiveMatches = schema.filter((setting) => setting.key.toLowerCase() === inputLower);
  if (caseInsensitiveMatches.length === 1) {
    const resolvedLookup = { ...lookup, resolvedBy: 'case-insensitive-key' as const };
    return {
      status: 'found',
      setting: describeHarnessSetting(configManager, caseInsensitiveMatches[0]!, { lookup: resolvedLookup }),
      lookup: resolvedLookup,
    };
  }
  if (caseInsensitiveMatches.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: caseInsensitiveMatches.map(settingCandidate).slice(0, 8),
    };
  }

  const category = args.category?.trim();
  const prefix = args.prefix?.trim();
  const searchMatches = schema.filter((setting) => {
    if (category && setting.key.split('.')[0] !== category) return false;
    if (prefix && !setting.key.startsWith(prefix)) return false;
    if (!args.includeHidden && isAgentHiddenSettingKey(setting.key)) return false;
    return settingMatchesSearch(setting, inputLower);
  });
  if (searchMatches.length === 1) {
    const resolvedLookup = { ...lookup, resolvedBy: 'search' as const };
    return {
      status: 'found',
      setting: describeHarnessSetting(configManager, searchMatches[0]!, { lookup: resolvedLookup }),
      lookup: resolvedLookup,
    };
  }
  if (searchMatches.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: searchMatches.map(settingCandidate).slice(0, 8),
    };
  }

  return null;
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
  }
  throw new Error(`Expected boolean value, got ${String(value)}.`);
}

export function coerceHarnessSettingValue(setting: ConfigSetting, value: unknown): unknown {
  if (setting.type === 'boolean') return coerceBoolean(value);
  if (setting.type === 'number') {
    const parsed = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(parsed)) throw new Error(`Expected numeric value for ${setting.key}.`);
    return parsed;
  }
  if (setting.type === 'enum') {
    const parsed = String(value).trim();
    if (!setting.enumValues?.includes(parsed)) {
      throw new Error(`Invalid value for ${setting.key}. Allowed: ${(setting.enumValues ?? []).join(', ')}.`);
    }
    return parsed;
  }
  return typeof value === 'string' ? value : String(value);
}

export async function setHarnessSetting(
  configManager: ConfigManager,
  secretsManager: Pick<SecretsManager, 'set' | 'delete'> | null | undefined,
  key: string,
  value: unknown,
  routing: AgentConfigRoutingOptions = {},
): Promise<HarnessSettingMutationResult> {
  const setting = findSetting(configManager, key);
  if (!setting) throw new Error(`Unknown setting ${key || '<missing>'}.`);
  const previous = configManager.get(setting.key as ConfigKey);
  const coerced = coerceHarnessSettingValue(setting, value);
  if (setting.type === 'string' && isSecretConfigKey(setting.key)) {
    const secretValue = String(coerced);
    if (secretValue.trim() && !isSecretReferenceValue(secretValue) && !secretsManager?.set) {
      throw new Error(`Cannot store raw secret value for ${setting.key}: secrets manager is unavailable.`);
    }
    const current = await persistSecretBackedConfigValue(
      configManager,
      secretsManager,
      setting.key as ConfigKey,
      secretValue,
      { scope: 'user' },
    );
    return {
      key: setting.key,
      action: 'set',
      previous: redactHarnessSettingValue(setting.key, previous),
      current: redactHarnessSettingValue(setting.key, current),
    };
  }

  // Route by OWNERSHIP, not by who asked. A daemon-owned key goes to the
  // daemon — that is where the runtime which acts on it reads from. An
  // agent-owned key goes to the agent's own store. The only failure case is the
  // daemon genuinely being unreachable, and routeConfigWrite throws rather than
  // writing locally and reporting a success that changed nothing.
  const outcome = await routeConfigWrite(configManager, setting.key, coerced, {
    homeDir: configManager.getHomeDirectory() ?? undefined,
    ...routing,
  });
  return {
    key: setting.key,
    action: 'set',
    previous: redactHarnessSettingValue(setting.key, previous),
    current: redactHarnessSettingValue(setting.key, outcome.value),
    scope: outcome.scope,
    appliedBy: outcome.appliedBy,
    persistedTo: outcome.persistedTo,
  };
}

export async function resetHarnessSetting(
  configManager: ConfigManager,
  secretsManager: Pick<SecretsManager, 'delete'> | null | undefined,
  key: string,
): Promise<HarnessSettingMutationResult> {
  const setting = findSetting(configManager, key);
  if (!setting) throw new Error(`Unknown setting ${key || '<missing>'}.`);
  const previous = configManager.get(setting.key as ConfigKey);
  if (isSecretConfigKey(setting.key)) {
    if (typeof previous === 'string' && isSecretReferenceValue(previous) && !secretsManager?.delete) {
      throw new Error(`Cannot reset ${setting.key}: secrets manager is unavailable to delete the stored secret.`);
    }
    await secretsManager?.delete?.(buildGoodVibesSecretKey(setting.key), { scope: 'user' });
  }
  configManager.reset(setting.key as ConfigKey);
  return {
    key: setting.key,
    action: 'reset',
    previous: redactHarnessSettingValue(setting.key, previous),
    current: redactHarnessSettingValue(setting.key, configManager.get(setting.key as ConfigKey)),
  };
}

export function formatHarnessSettingList(settings: readonly (HarnessSettingDescriptor | HarnessSettingSummary)[]): string {
  if (settings.length === 0) return 'No settings matched.';
  return [
    `Settings (${settings.length})`,
    ...settings.map((setting) => {
      const status = setting.writable ? 'writable' : 'read-only';
      const visible = setting.visibleInWorkspace ? 'workspace' : 'scriptable';
      return `  ${setting.key}  ${setting.type}  ${status}/${visible}  current=${String(setting.value)}`;
    }),
  ].join('\n');
}

export function formatHarnessSetting(setting: HarnessSettingDescriptor | null): string {
  if (!setting) return 'Unknown setting.';
  return [
    `Setting ${setting.key}`,
    `  category ${setting.category}`,
    `  type ${setting.type}`,
    // An unknown value is printed as unknown. Printing the default here is what
    // reported a configured Telegram bot username as "not set".
    setting.valueUnavailable
      ? `  current UNKNOWN — ${setting.valueStore ?? 'the owning runtime'} could not be reached`
      : `  current ${String(setting.value)}`,
    `  default ${String(setting.default)}`,
    `  configured ${setting.valueUnavailable ? 'unknown' : (setting.configured ? 'yes' : 'no')}`,
    ...(setting.scope ? [`  owner ${setting.scope}`] : []),
    ...(setting.valueStore ? [`  store ${setting.valueStore}`] : []),
    `  writable ${setting.writable ? 'yes' : 'no'}`,
    `  workspace visible ${setting.visibleInWorkspace ? 'yes' : 'no'}`,
    ...(setting.enumValues ? [`  values ${setting.enumValues.join(', ')}`] : []),
    `  ${setting.description}`,
  ].join('\n');
}

export function formatHarnessMutation(result: HarnessSettingMutationResult): string {
  return [
    `Setting ${result.action}`,
    `  key ${result.key}`,
    `  previous ${String(result.previous)}`,
    `  current ${String(result.current)}`,
    // Name the owner and the store. "Saved" alone cannot distinguish a value
    // the acting runtime will read from one written into a file it never opens.
    ...(result.scope ? [`  owner ${result.scope}`] : []),
    ...(result.appliedBy ? [`  applied by ${result.appliedBy}`] : []),
    ...(result.persistedTo ? [`  stored in ${result.persistedTo}`] : []),
  ].join('\n');
}

export function formatHarnessError(error: unknown): string {
  return summarizeError(error);
}

/**
 * Ownership-aware `resolveHarnessSetting`: a daemon-owned key resolves to the
 * DAEMON's live value, with the store named on the descriptor. The
 * synchronous overload above is kept for callers that have no daemon context.
 */
export async function resolveEffectiveHarnessSetting(
  configManager: ConfigManager,
  args: HarnessSettingLookupArgs,
  routing: AgentConfigRoutingOptions = {},
): Promise<HarnessSettingResolution | null> {
  const view = await openEffectiveConfigView(configManager, {
    homeDir: configManager.getHomeDirectory() ?? undefined,
    ...routing,
  });
  return resolveHarnessSetting(configManager, args, view);
}
