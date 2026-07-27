import type { ConfigSetting } from '@pellux/goodvibes-sdk/platform/config';
import type { ModelPickerTarget } from './model-picker.ts';
import {
  formatMinorUnitsForEdit,
  isMoneyMinorUnitsConfigKey,
  parseMajorUnitsToMinorUnits,
} from '../config/payments-money-format.ts';

export type ModelPickerLaunch =
  | { readonly flow: 'providerModel'; readonly target: ModelPickerTarget }
  | { readonly flow: 'model'; readonly target: ModelPickerTarget };

/**
 * Map config keys to the shared provider/model picker flows.
 */
export function modelPickerLaunchForKey(key: string): ModelPickerLaunch | null {
  if (key === 'provider.model') return { flow: 'providerModel', target: 'main' };
  if (key === 'helper.globalProvider') return { flow: 'providerModel', target: 'helper' };
  if (key === 'helper.globalModel') return { flow: 'model', target: 'helper' };
  if (key === 'tools.llmProvider') return { flow: 'providerModel', target: 'tool' };
  if (key === 'tools.llmModel') return { flow: 'model', target: 'tool' };
  if (key === 'tts.llmProvider') return { flow: 'providerModel', target: 'tts' };
  if (key === 'tts.llmModel') return { flow: 'model', target: 'tts' };
  return null;
}

export function roundToPrecision(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function getNumericAdjustmentMeta(setting: ConfigSetting): {
  step: number;
  min?: number;
  max?: number;
  precision: number;
} {
  return { step: 1, precision: 0 };
}

/**
 * The inline-edit buffer's starting text for a number setting. A
 * `payments.*Cents` key shows major units ("19.99") so typing "50" over it
 * means fifty dollars, not fifty cents; every other number setting keeps its
 * raw stored value.
 */
export function moneyEditBufferValue(setting: ConfigSetting, currentValue: unknown, currency: string): string {
  if (isMoneyMinorUnitsConfigKey(setting.key) && typeof currentValue === 'number') {
    return formatMinorUnitsForEdit(currentValue, currency);
  }
  return String(currentValue ?? '');
}

/**
 * Parse a committed number-setting edit buffer. `payments.*Cents` keys parse
 * as major units and convert to integer minor units; every other number
 * setting parses as a plain number. Returns null for anything unparseable.
 */
export function parseMoneyOrNumberEditBuffer(setting: ConfigSetting, buffer: string, currency: string): number | null {
  if (isMoneyMinorUnitsConfigKey(setting.key)) {
    return parseMajorUnitsToMinorUnits(buffer, currency);
  }
  const parsed = Number(buffer);
  return Number.isNaN(parsed) ? null : parsed;
}
