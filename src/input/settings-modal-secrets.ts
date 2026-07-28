import type { ConfigKey } from '@pellux/goodvibes-sdk/platform/config';
import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import type { SecretsManager } from '../config/secrets.ts';
import {
  buildSecretBackedConfigUpdate,
  defaultSecretBackedScope,
  getSecretWriteMedium,
} from '../config/secret-config.ts';

export type SettingsSecretsManager = Pick<SecretsManager, 'delete' | 'set'>;

export function setSecretBackedSettingValue(args: {
  key: ConfigKey;
  value: string;
  configManager: ConfigManager;
  secretsManager: SettingsSecretsManager | null;
  setConfigValue: (key: ConfigKey, value: unknown) => void;
}): void {
  const { key, value, configManager, secretsManager, setConfigValue } = args;
  if (!secretsManager) {
    setConfigValue(key, value.trim());
    return;
  }

  const update = buildSecretBackedConfigUpdate(key, value);
  // Daemon-owned keys (surfaces.*, email.*, calendar.*, ...) name a credential
  // the daemon itself reads, so the secret material must land in the daemon
  // scope no matter which client edited it — see secret-config.ts's
  // defaultSecretBackedScope for why splitting the reference from the value
  // makes the write look successful while the daemon finds nothing.
  const scope = defaultSecretBackedScope(key);
  if (update.secretKey && update.secretValue !== undefined) {
    void secretsManager.set(update.secretKey, update.secretValue, {
      scope,
      medium: getSecretWriteMedium(configManager.get('storage.secretPolicy')),
    }).catch((error) => {
      logger.error('SettingsModal: failed to store secret config value', { key, error: summarizeError(error) });
    });
  }
  if (update.clearSecretKey) {
    void secretsManager.delete(update.clearSecretKey, { scope }).catch((error) => {
      logger.error('SettingsModal: failed to clear secret config value', { key, error: summarizeError(error) });
    });
  }
  setConfigValue(key, update.configValue);
}
