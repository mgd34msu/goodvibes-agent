import { existsSync, readFileSync } from 'node:fs';
import type { ConfigKey, ConfigSetting } from '@pellux/goodvibes-sdk/platform/config';
import { setHarnessSetting } from '../agent/harness-control.ts';
import { isExternalHostOwnedSettingKey } from '../config/agent-settings-policy.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from './agent-workspace-snapshot.ts';
import type { CommandContext } from './command-registry.ts';
import type {
  AgentWorkspaceAction,
  AgentWorkspaceActionResult,
  AgentWorkspaceLocalEditor,
  AgentWorkspaceRuntimeSnapshot,
} from './agent-workspace-types.ts';

const GOODVIBES_TUI_SURFACE_ROOT = 'tui';

const TUI_IMPORTABLE_SETTING_PREFIXES = [
  'display.',
  'provider.',
  'behavior.',
  'storage.',
  'permissions.',
  'ui.',
  'tts.',
  'surfaces.',
  'helper.',
  'tools.',
  'release.',
  'automation.',
] as const;

type SettingActionEffect =
  | {
    readonly kind: 'result';
    readonly status: string;
    readonly result: AgentWorkspaceActionResult;
  }
  | {
    readonly kind: 'apply';
    readonly setting: ConfigSetting;
    readonly value: unknown;
  }
  | {
    readonly kind: 'editor';
    readonly editor: AgentWorkspaceLocalEditor;
    readonly status: string;
    readonly result: AgentWorkspaceActionResult;
  };

export interface SettingMutationOutcome {
  readonly status: string;
  readonly result: AgentWorkspaceActionResult;
}

export interface TuiSettingsImportOutcome extends SettingMutationOutcome {
  readonly runtimeSnapshot: AgentWorkspaceRuntimeSnapshot | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonRecord(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  return isRecord(parsed) ? parsed : null;
}

function readNestedSettingValue(record: Record<string, unknown>, key: string): unknown {
  let cursor: unknown = record;
  for (const part of key.split('.')) {
    if (!isRecord(cursor) || !(part in cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function canImportTuiSetting(key: string): boolean {
  return !isExternalHostOwnedSettingKey(key)
    && TUI_IMPORTABLE_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function valuesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function agentWorkspaceSettingSchema(context: CommandContext | null, key: string): ConfigSetting | null {
  return context?.platform?.configManager
    ?.getSchema()
    .find((setting) => setting.key === key) ?? null;
}

export function isAgentWorkspaceActionVisible(context: CommandContext | null, action: AgentWorkspaceAction): boolean {
  const key = action.visibleWhenSettingKey?.trim();
  if (!key) return true;
  const configManager = context?.platform?.configManager;
  if (!configManager) return false;
  return configManager.get(key as ConfigKey) === action.visibleWhenSettingValue;
}

export function buildAgentWorkspaceSettingActionEffect(
  context: CommandContext | null,
  action: AgentWorkspaceAction,
): SettingActionEffect {
  const settingKey = action.settingKey?.trim();
  const configManager = context?.platform?.configManager;
  if (!settingKey || !configManager) {
    return {
      kind: 'result',
      status: 'Setting is unavailable in this runtime.',
      result: {
        kind: 'error',
        title: 'Setting unavailable',
        detail: action.detail,
        safety: action.safety,
      },
    };
  }
  const setting = agentWorkspaceSettingSchema(context, settingKey);
  if (!setting) {
    return {
      kind: 'result',
      status: `Unknown setting: ${settingKey}`,
      result: {
        kind: 'error',
        title: 'Unknown setting',
        detail: `No Agent setting exists for ${settingKey}.`,
        safety: action.safety,
      },
    };
  }

  if (action.settingValueHint !== undefined) {
    return { kind: 'apply', setting, value: action.settingValueHint };
  }

  const currentValue = configManager.get(setting.key as ConfigKey);
  if (setting.type === 'boolean') {
    return { kind: 'apply', setting, value: !Boolean(currentValue) };
  }
  if (setting.type === 'enum' && setting.enumValues && setting.enumValues.length > 0) {
    const currentIndex = Math.max(0, setting.enumValues.indexOf(String(currentValue)));
    return { kind: 'apply', setting, value: setting.enumValues[(currentIndex + 1) % setting.enumValues.length]! };
  }

  return {
    kind: 'editor',
    editor: createSettingEditor(setting, String(currentValue ?? ''), action),
    status: `Editing ${setting.key}.`,
    result: {
      kind: 'guidance',
      title: `Edit ${setting.key}`,
      detail: setting.description,
      safety: action.safety,
    },
  };
}

export async function applyAgentWorkspaceSettingValue(
  context: CommandContext | null,
  setting: ConfigSetting,
  value: unknown,
): Promise<SettingMutationOutcome> {
  const configManager = context?.platform?.configManager;
  if (!configManager) {
    return {
      status: 'Setting is unavailable in this runtime.',
      result: {
        kind: 'error',
        title: `${setting.key} update failed`,
        detail: 'The Agent workspace has no config manager for this runtime.',
        safety: 'safe',
      },
    };
  }
  try {
    const result = await setHarnessSetting(configManager, context?.platform?.secretsManager, setting.key, value);
    return {
      status: `${result.key} set.`,
      result: {
        kind: 'refreshed',
        title: `${result.key} updated`,
        detail: `Current value: ${String(result.current)}`,
        safety: 'safe',
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: detail,
      result: {
        kind: 'error',
        title: `${setting.key} update failed`,
        detail,
        safety: 'safe',
      },
    };
  }
}

export async function importAgentWorkspaceTuiSettings(context: CommandContext | null): Promise<TuiSettingsImportOutcome> {
  const shellPaths = context?.workspace?.shellPaths;
  const configManager = context?.platform?.configManager;
  if (!shellPaths || !configManager) {
    return {
      status: 'GoodVibes TUI settings import is unavailable in this runtime.',
      runtimeSnapshot: null,
      result: {
        kind: 'error',
        title: 'Import unavailable',
        detail: 'The workspace cannot locate shell paths or the Agent config manager.',
        safety: 'safe',
      },
    };
  }

  const sources = [
    { label: 'user', path: shellPaths.resolveUserPath(GOODVIBES_TUI_SURFACE_ROOT, 'settings.json') },
    { label: 'project', path: shellPaths.resolveProjectPath(GOODVIBES_TUI_SURFACE_ROOT, 'settings.json') },
  ];
  const values = new Map<string, { readonly value: unknown; readonly source: string }>();
  const parseErrors: string[] = [];
  for (const source of sources) {
    try {
      const record = readJsonRecord(source.path);
      if (!record) continue;
      for (const setting of configManager.getSchema()) {
        if (!canImportTuiSetting(setting.key)) continue;
        const value = readNestedSettingValue(record, setting.key);
        if (value !== undefined) values.set(setting.key, { value, source: source.label });
      }
    } catch (error) {
      parseErrors.push(`${source.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (values.size === 0) {
    const detail = parseErrors.length > 0
      ? `No importable settings found. ${parseErrors.join('; ')}`
      : 'No GoodVibes TUI settings file with importable Agent-owned settings was found.';
    return {
      status: 'No GoodVibes TUI settings imported.',
      runtimeSnapshot: null,
      result: {
        kind: parseErrors.length > 0 ? 'error' : 'guidance',
        title: 'Nothing imported',
        detail,
        safety: 'safe',
      },
    };
  }

  const imported: string[] = [];
  const unchanged: string[] = [];
  const skipped: string[] = [];
  for (const [key, entry] of values) {
    const setting = agentWorkspaceSettingSchema(context, key);
    if (!setting) continue;
    if (valuesMatch(configManager.get(setting.key as ConfigKey), entry.value)) {
      unchanged.push(setting.key);
      continue;
    }
    try {
      await setHarnessSetting(configManager, context?.platform?.secretsManager, setting.key, entry.value);
      imported.push(`${setting.key} (${entry.source})`);
    } catch (error) {
      skipped.push(`${setting.key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    status: imported.length > 0 ? `Imported ${imported.length} GoodVibes TUI setting(s).` : 'No GoodVibes TUI settings changed.',
    runtimeSnapshot: context ? buildAgentWorkspaceRuntimeSnapshot(context) : null,
    result: {
      kind: skipped.length > 0 && imported.length === 0 ? 'error' : imported.length > 0 ? 'refreshed' : 'guidance',
      title: imported.length > 0 ? 'GoodVibes TUI settings imported' : 'No settings changed',
      detail: [
        imported.length > 0 ? `Imported: ${imported.slice(0, 10).join(', ')}${imported.length > 10 ? `, +${imported.length - 10} more` : ''}.` : '',
        unchanged.length > 0 ? `${unchanged.length} setting(s) already matched.` : '',
        skipped.length > 0 ? `Skipped: ${skipped.slice(0, 5).join('; ')}${skipped.length > 5 ? `; +${skipped.length - 5} more` : ''}.` : '',
        parseErrors.length > 0 ? `Parse issues: ${parseErrors.join('; ')}.` : '',
      ].filter((line) => line.length > 0).join(' '),
      safety: 'safe',
    },
  };
}

function createSettingEditor(setting: ConfigSetting, currentValue: string, action: AgentWorkspaceAction): AgentWorkspaceLocalEditor {
  const valueHint = setting.type === 'number'
    ? 'Enter a number.'
    : setting.type === 'string'
      ? 'Enter a value. Leave empty to clear it.'
      : setting.enumValues
        ? `Allowed values: ${setting.enumValues.join(', ')}.`
        : action.detail;
  return {
    kind: 'setting-set',
    mode: 'update',
    recordId: setting.key,
    title: `Set ${setting.key}`,
    selectedFieldIndex: 0,
    message: action.detail,
    fields: [
      {
        id: 'value',
        label: setting.key,
        value: currentValue,
        required: false,
        multiline: false,
        hint: action.settingValueHint ?? valueHint,
        redact: /(?:secret|token|password|api[-_.]?key|signing)/i.test(setting.key),
      },
    ],
  };
}
