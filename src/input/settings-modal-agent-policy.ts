export const AGENT_EXTERNAL_DAEMON_SETTING_LOCK_REASON = 'GoodVibes Agent connects to an external GoodVibes runtime. Change runtime lifecycle and bind posture from the owning host; Agent settings are read-only for those controls.';

const AGENT_HIDDEN_SETTING_PREFIXES = [
  ['cloud', 'flare.'].join(''),
  ['surfaces.', 'home', 'assistant.'].join(''),
  'batch.',
  'controlPlane.',
  'danger.',
  'httpListener.',
  'network.',
  'orchestration.',
  'runtime.',
  'service.',
  'sandbox.',
  'web.',
  'watchers.',
  'wrfc.',
] as const;

const AGENT_HIDDEN_SETTING_KEYS = new Set<string>([
  'ui.wrfcMessages',
]);

const EXTERNAL_DAEMON_SETTING_PREFIXES = [
  'service.',
  'controlPlane.',
  'httpListener.',
  'web.',
] as const;

const EXTERNAL_DAEMON_SETTING_KEYS = new Set<string>([
  'danger.daemon',
  'danger.httpListener',
]);

export function isExternalDaemonOwnedSettingKey(key: string): boolean {
  return EXTERNAL_DAEMON_SETTING_KEYS.has(key)
    || EXTERNAL_DAEMON_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function isAgentHiddenSettingKey(key: string): boolean {
  return AGENT_HIDDEN_SETTING_KEYS.has(key)
    || AGENT_HIDDEN_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix));
}
