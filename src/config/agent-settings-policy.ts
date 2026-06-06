export const AGENT_EXTERNAL_HOST_SETTING_LOCK_REASON = 'This raw daemon/listener danger toggle is protected. Use an explicit confirmed operator action or setup command for lifecycle changes.';

const AGENT_HIDDEN_SETTING_PREFIXES = [
  'danger.',
] as const;

const AGENT_HIDDEN_SETTING_KEYS = new Set<string>([
  'ui.wrfcMessages',
]);

const EXTERNAL_HOST_SETTING_PREFIXES = [
] as const;

const EXTERNAL_HOST_SETTING_KEYS = new Set<string>([
  'danger.daemon',
  'danger.httpListener',
]);

export function isExternalHostOwnedSettingKey(key: string): boolean {
  return EXTERNAL_HOST_SETTING_KEYS.has(key)
    || EXTERNAL_HOST_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function isAgentHiddenSettingKey(key: string): boolean {
  return AGENT_HIDDEN_SETTING_KEYS.has(key)
    || AGENT_HIDDEN_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix));
}
