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
  AGENT_EXTERNAL_HOST_SETTING_LOCK_REASON,
  isAgentHiddenSettingKey,
  isExternalHostOwnedSettingKey,
} from '../config/agent-settings-policy.ts';

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
  readonly lockReason?: string;
  readonly description: string;
  readonly enumValues?: readonly string[];
  readonly lookup?: HarnessSettingLookup;
}

export interface HarnessSettingMutationResult {
  readonly key: string;
  readonly action: 'set' | 'reset';
  readonly previous: unknown;
  readonly current: unknown;
}

const DEFAULT_SETTING_LIMIT = 100;
const SENSITIVE_KEY_PATTERN = /(?:secret|token|password|api[-_.]?key|signing)/i;

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clampLimit(value: unknown, fallback = DEFAULT_SETTING_LIMIT): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(value)));
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
  const hostOwned = isExternalHostOwnedSettingKey(setting.key);
  return {
    key: setting.key,
    category: setting.key.split('.')[0] ?? '',
    type: setting.type,
    writable: !hostOwned,
    visibleInWorkspace: !isAgentHiddenSettingKey(setting.key),
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
  if (isSecretConfigKey(key) || SENSITIVE_KEY_PATTERN.test(key)) {
    if (isSecretReferenceValue(value)) return '<secret-ref>';
    return '<redacted>';
  }
  return value;
}

export function describeHarnessSetting(
  configManager: Pick<ConfigManager, 'get'>,
  setting: ConfigSetting,
  options: { readonly lookup?: HarnessSettingLookup } = {},
): HarnessSettingDescriptor {
  const value = configManager.get(setting.key as ConfigKey);
  const hostOwned = isExternalHostOwnedSettingKey(setting.key);
  return {
    key: setting.key,
    category: setting.key.split('.')[0] ?? '',
    type: setting.type,
    value: redactHarnessSettingValue(setting.key, value),
    default: redactHarnessSettingValue(setting.key, setting.default),
    configured: !valuesEqual(value, setting.default),
    writable: !hostOwned,
    visibleInWorkspace: !isAgentHiddenSettingKey(setting.key),
    ...(hostOwned ? { lockReason: AGENT_EXTERNAL_HOST_SETTING_LOCK_REASON } : {}),
    description: setting.description,
    ...(setting.enumValues ? { enumValues: setting.enumValues } : {}),
    ...(options.lookup ? { lookup: options.lookup } : {}),
  };
}

export function listHarnessSettings(
  configManager: Pick<ConfigManager, 'get' | 'getSchema'>,
  filters: HarnessSettingFilters = {},
): readonly HarnessSettingDescriptor[] {
  const key = filters.key?.trim();
  const category = filters.category?.trim();
  const prefix = filters.prefix?.trim();
  const query = filters.query?.trim().toLowerCase();
  const limit = clampLimit(filters.limit);

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
    })
    .map((setting) => describeHarnessSetting(configManager, setting))
    .slice(0, limit);
}

export function getHarnessSetting(
  configManager: Pick<ConfigManager, 'get' | 'getSchema'>,
  key: string,
  lookup?: HarnessSettingLookup,
): HarnessSettingDescriptor | null {
  const setting = findSetting(configManager, key);
  return setting ? describeHarnessSetting(configManager, setting, { lookup }) : null;
}

export function resolveHarnessSetting(
  configManager: Pick<ConfigManager, 'get' | 'getSchema'>,
  args: HarnessSettingLookupArgs,
): HarnessSettingResolution | null {
  const lookup = settingLookupFromArgs(args);
  if (!lookup) return null;

  const exact = findSetting(configManager, lookup.input);
  if (exact) {
    const resolvedLookup = { ...lookup, resolvedBy: 'key' as const };
    return {
      status: 'found',
      setting: describeHarnessSetting(configManager, exact, { lookup: resolvedLookup }),
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
): Promise<HarnessSettingMutationResult> {
  const setting = findSetting(configManager, key);
  if (!setting) throw new Error(`Unknown setting ${key || '<missing>'}.`);
  if (isExternalHostOwnedSettingKey(setting.key)) throw new Error(AGENT_EXTERNAL_HOST_SETTING_LOCK_REASON);

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

  configManager.setDynamic(setting.key as ConfigKey, coerced);
  return {
    key: setting.key,
    action: 'set',
    previous: redactHarnessSettingValue(setting.key, previous),
    current: redactHarnessSettingValue(setting.key, configManager.get(setting.key as ConfigKey)),
  };
}

export async function resetHarnessSetting(
  configManager: ConfigManager,
  secretsManager: Pick<SecretsManager, 'delete'> | null | undefined,
  key: string,
): Promise<HarnessSettingMutationResult> {
  const setting = findSetting(configManager, key);
  if (!setting) throw new Error(`Unknown setting ${key || '<missing>'}.`);
  if (isExternalHostOwnedSettingKey(setting.key)) throw new Error(AGENT_EXTERNAL_HOST_SETTING_LOCK_REASON);

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

export function formatHarnessSettingList(settings: readonly HarnessSettingDescriptor[]): string {
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
    `  current ${String(setting.value)}`,
    `  default ${String(setting.default)}`,
    `  configured ${setting.configured ? 'yes' : 'no'}`,
    `  writable ${setting.writable ? 'yes' : 'no'}`,
    `  workspace visible ${setting.visibleInWorkspace ? 'yes' : 'no'}`,
    ...(setting.enumValues ? [`  values ${setting.enumValues.join(', ')}`] : []),
    ...(setting.lockReason ? [`  lock ${setting.lockReason}`] : []),
    `  ${setting.description}`,
  ].join('\n');
}

export function formatHarnessMutation(result: HarnessSettingMutationResult): string {
  return [
    `Setting ${result.action}`,
    `  key ${result.key}`,
    `  previous ${String(result.previous)}`,
    `  current ${String(result.current)}`,
  ].join('\n');
}

export function formatHarnessError(error: unknown): string {
  return summarizeError(error);
}
