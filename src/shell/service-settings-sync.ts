import type { ConfigKey } from '@pellux/goodvibes-sdk/platform/config';
import type { CliServiceRuntime } from '../cli/service-posture.ts';

export const AGENT_EXTERNAL_DAEMON_SERVICE_MESSAGE = 'GoodVibes Agent connects to an external daemon and does not install, start, stop, restart, or uninstall daemon services. Manage daemon lifecycle from GoodVibes TUI or your daemon host tooling.';

export interface ServiceSettingsSyncChange {
  readonly key: ConfigKey;
  readonly previousValue: unknown;
  readonly value: unknown;
}

export interface ServiceSettingsSyncResult {
  readonly handled: boolean;
  readonly action?: 'external-daemon-blocked' | 'unchanged';
  readonly message?: string;
  readonly error?: string;
}

export interface ServiceSettingsSyncOptions {
  readonly allowExternalDaemonMutation?: false;
}

export function syncServiceSettingToPlatform(
  runtime: CliServiceRuntime,
  change: ServiceSettingsSyncChange,
  _options: ServiceSettingsSyncOptions = {},
): ServiceSettingsSyncResult {
  if (!String(change.key).startsWith('service.')) return { handled: false };
  if (change.previousValue === change.value) {
    return {
      handled: true,
      action: 'unchanged',
      message: 'External daemon service setting unchanged',
    };
  }

  runtime.configManager.setDynamic(change.key, change.previousValue);
  return {
    handled: true,
    action: 'external-daemon-blocked',
    message: AGENT_EXTERNAL_DAEMON_SERVICE_MESSAGE,
    error: 'daemon_lifecycle_external',
  };
}
