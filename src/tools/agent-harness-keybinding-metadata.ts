import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommandContext } from '../input/command-registry.ts';
import {
  ACTION_DESCRIPTIONS,
  DEFAULT_KEYBINDINGS,
  type KeyAction,
  type KeyCombo,
  type KeybindingsManager,
} from '../input/keybindings.ts';

const FIXED_SHORTCUTS: readonly Record<string, string>[] = [
  { key: 'Enter', description: 'Send prompt' },
  { key: 'Shift+Enter / Ctrl+J', description: 'Insert newline' },
  { key: 'Up / Down', description: 'Navigate input history, lists, and scrollable overlays' },
  { key: 'Tab', description: 'Autocomplete slash command or file mention' },
  { key: 'Esc', description: 'Close overlays, pickers, and transient input modes' },
  { key: '? / F1', description: 'Toggle help overlay' },
  { key: 'F2 / /shortcuts', description: 'Open keyboard shortcut reference' },
  { key: '/keybindings', description: 'List configurable keybindings and config path' },
];

interface HarnessKeybindingArgs {
  readonly query?: unknown;
  readonly actionId?: unknown;
  readonly key?: unknown;
  readonly fields?: unknown;
  readonly combo?: unknown;
  readonly combos?: unknown;
  readonly value?: unknown;
  readonly limit?: unknown;
}

type KeybindingsOverrideFile = Record<string, unknown>;

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function readFieldMap(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry === 'string' ? entry : String(entry)]));
}

function requireKeybindingsManager(context: CommandContext): KeybindingsManager {
  const manager = context.workspace.keybindingsManager;
  if (!manager) throw new Error('workspace.keybindingsManager is unavailable in this Agent runtime');
  return manager;
}

function isKeyAction(action: string): action is KeyAction {
  return Object.hasOwn(ACTION_DESCRIPTIONS, action);
}

function actionFromArgs(args: HarnessKeybindingArgs): KeyAction | null {
  const action = readString(args.actionId || args.key || args.query);
  return action && isKeyAction(action) ? action : null;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'on'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0', 'off'].includes(normalized)) return false;
  return undefined;
}

function normalizeCombo(value: unknown): KeyCombo | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const key = readString(raw.key);
  if (!key) return null;
  const combo: KeyCombo = { key };
  const ctrl = readBoolean(raw.ctrl);
  const shift = readBoolean(raw.shift);
  const alt = readBoolean(raw.alt);
  if (ctrl !== undefined) combo.ctrl = ctrl;
  if (shift !== undefined) combo.shift = shift;
  if (alt !== undefined) combo.alt = alt;
  return combo;
}

function parseComboLabel(value: string): KeyCombo | null {
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const key = parts.at(-1);
  if (!key) return null;
  const combo: KeyCombo = { key: key.length === 1 ? key.toLowerCase() : key.toLowerCase() };
  for (const part of parts.slice(0, -1)) {
    const normalized = part.toLowerCase();
    if (normalized === 'ctrl' || normalized === 'control') combo.ctrl = true;
    else if (normalized === 'shift') combo.shift = true;
    else if (normalized === 'alt' || normalized === 'option') combo.alt = true;
    else return null;
  }
  return combo;
}

function combosFromArgs(args: HarnessKeybindingArgs): KeyCombo[] {
  if (Array.isArray(args.combos)) {
    const combos = args.combos.map(normalizeCombo);
    if (combos.every((combo): combo is KeyCombo => combo !== null)) return combos;
    throw new Error('set_keybinding combos must be objects with key and optional boolean ctrl/shift/alt fields.');
  }
  const combo = normalizeCombo(args.combo);
  if (combo) return [combo];
  const fields = readFieldMap(args.fields);
  const fieldCombo = normalizeCombo(fields);
  if (fieldCombo) return [fieldCombo];
  const labelCombo = parseComboLabel(readString(args.value));
  if (labelCombo) return [labelCombo];
  throw new Error('set_keybinding requires combo, combos, fields.key, or a value such as "Ctrl+G".');
}

function comboFingerprint(combo: KeyCombo): string {
  return `${combo.key}:${combo.ctrl ? 1 : 0}:${combo.shift ? 1 : 0}:${combo.alt ? 1 : 0}`;
}

function combosEqual(left: readonly KeyCombo[], right: readonly KeyCombo[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((combo, index) => comboFingerprint(combo) === comboFingerprint(right[index]));
}

function describeCombo(manager: KeybindingsManager, combo: KeyCombo): Record<string, unknown> {
  return {
    key: combo.key,
    ctrl: combo.ctrl === true,
    shift: combo.shift === true,
    alt: combo.alt === true,
    label: manager.formatCombo(combo),
  };
}

function bindingMatches(entry: { readonly action: KeyAction; readonly description: string; readonly combos: KeyCombo[] }, query: string): boolean {
  if (!query) return true;
  const haystack = [
    entry.action,
    entry.description,
    ...entry.combos.map((combo) => comboFingerprint(combo)),
  ].join('\n').toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function describeBinding(manager: KeybindingsManager, action: KeyAction, combos: KeyCombo[]): Record<string, unknown> {
  const defaults = DEFAULT_KEYBINDINGS[action];
  const customized = !combosEqual(combos, defaults);
  return {
    action,
    description: ACTION_DESCRIPTIONS[action],
    bindings: combos.map((combo) => describeCombo(manager, combo)),
    labels: combos.map((combo) => manager.formatCombo(combo)),
    defaultBindings: defaults.map((combo) => describeCombo(manager, combo)),
    customized,
    source: customized ? 'custom' : 'default',
  };
}

function readOverrideFile(configPath: string): KeybindingsOverrideFile {
  if (!existsSync(configPath)) return {};
  const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Keybindings config ${configPath} must contain a JSON object.`);
  }
  return parsed as KeybindingsOverrideFile;
}

function writeOverrideFile(configPath: string, overrides: KeybindingsOverrideFile): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(overrides, null, 2)}\n`, 'utf-8');
}

export function totalHarnessKeybindings(context: CommandContext): number {
  return context.workspace.keybindingsManager?.getAll().length ?? 0;
}

export function totalHarnessShortcuts(context: CommandContext): number {
  return totalHarnessKeybindings(context) + FIXED_SHORTCUTS.length;
}

export function listHarnessShortcuts(context: CommandContext, args: HarnessKeybindingArgs): Record<string, unknown> {
  const keybindings = listHarnessKeybindings(context, args);
  const query = readString(args.query).toLowerCase();
  const fixed = FIXED_SHORTCUTS
    .filter((shortcut) => !query || `${shortcut.key}\n${shortcut.description}`.toLowerCase().includes(query))
    .slice(0, readLimit(args.limit, 200))
    .map((shortcut) => ({ ...shortcut, source: 'fixed', userEditable: false }));
  return {
    configPath: keybindings.configPath,
    fixedShortcuts: fixed,
    configurableKeybindings: keybindings.keybindings,
    returned: fixed.length + Number(keybindings.returned ?? 0),
    total: totalHarnessShortcuts(context),
    policy: 'Fixed shortcuts are runtime/editor controls. Configurable keybindings can be changed with set_keybinding/reset_keybinding.',
  };
}

export function listHarnessKeybindings(context: CommandContext, args: HarnessKeybindingArgs): Record<string, unknown> {
  const manager = requireKeybindingsManager(context);
  const query = readString(args.query);
  const entries = manager.getAll()
    .filter((entry) => bindingMatches(entry, query))
    .slice(0, readLimit(args.limit, 200))
    .map((entry) => describeBinding(manager, entry.action, entry.combos));
  return {
    configPath: manager.getConfigPath(),
    keybindings: entries,
    returned: entries.length,
    total: manager.getAll().length,
    policy: 'Reads the live resolved keybindings. set_keybinding/reset_keybinding write the same keybindings.json file the user can edit and reload the runtime manager.',
  };
}

export function describeHarnessKeybinding(context: CommandContext, args: HarnessKeybindingArgs): Record<string, unknown> | null {
  const manager = requireKeybindingsManager(context);
  const action = actionFromArgs(args);
  if (!action) return null;
  const entry = manager.getAll().find((candidate) => candidate.action === action);
  return entry ? {
    configPath: manager.getConfigPath(),
    ...describeBinding(manager, entry.action, entry.combos),
  } : null;
}

export function setHarnessKeybinding(context: CommandContext, args: HarnessKeybindingArgs): Record<string, unknown> {
  const manager = requireKeybindingsManager(context);
  const action = actionFromArgs(args);
  if (!action) throw new Error('set_keybinding requires a valid keybinding action id.');
  const combos = combosFromArgs(args);
  const configPath = manager.getConfigPath();
  const overrides = readOverrideFile(configPath);
  overrides[action] = combos.length === 1 ? combos[0] : combos;
  writeOverrideFile(configPath, overrides);
  manager.loadFromDisk();
  return {
    status: 'updated',
    configPath,
    keybinding: describeHarnessKeybinding(context, { actionId: action }),
  };
}

export function resetHarnessKeybinding(context: CommandContext, args: HarnessKeybindingArgs): Record<string, unknown> {
  const manager = requireKeybindingsManager(context);
  const action = actionFromArgs(args);
  if (!action) throw new Error('reset_keybinding requires a valid keybinding action id.');
  const configPath = manager.getConfigPath();
  const overrides = readOverrideFile(configPath);
  delete overrides[action];
  writeOverrideFile(configPath, overrides);
  manager.loadFromDisk();
  return {
    status: 'reset',
    configPath,
    keybinding: describeHarnessKeybinding(context, { actionId: action }),
  };
}
