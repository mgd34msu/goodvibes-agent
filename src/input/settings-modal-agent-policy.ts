export const AGENT_EXTERNAL_DAEMON_SETTING_LOCK_REASON = 'GoodVibes Agent connects to an external daemon. Change this from GoodVibes TUI or the daemon host; Agent settings are read-only for daemon lifecycle and bind posture.';

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
