import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  applySettingsSyncBundle,
  clearManagedSettingLock,
  exportSettingsSyncBundle,
  formatResolvedSettingReview,
  resolveSettingsSyncConflict,
  formatStagedManagedBundleReview,
  formatSettingsControlPlaneReview,
  getSettingsControlPlaneSnapshot,
  inspectSettingsSyncBundle,
  recordSettingsSyncEvent,
  recordSettingsSyncFailure,
  setManagedSettingLock,
  type SettingsSyncBundle,
} from '@/runtime/index.ts';
import { getProviderIdFromModel } from '../../config/provider-model.ts';
import { type ConfigKey } from '../../config/index.ts';
import { CONFIG_KEYS } from '@pellux/goodvibes-sdk/platform/config';
import type { CommandRegistry } from '../command-registry.ts';
import { openCommandPanel, requireShellPaths } from './runtime-services.ts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

export function registerSettingsSyncRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'settingssync',
    aliases: ['settings-sync'],
    description: 'Review sync posture, export/import settings-sync bundles, and open the settings sync workspace',
    usage: '[review|panel|show <key>|staged|conflicts|resolve <key> <local|synced> --yes|failures|rollback-history|export <path> --yes|inspect <path>|pull <path> --yes|push <path> --yes|lock <key> <source> <reason...> --yes|unlock <key> --yes]',
    handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const shellPaths = requireShellPaths(ctx);
      const controlPlaneConfigDir = ctx.platform.configManager.getControlPlaneConfigDir();
      const sub = (commandArgs[0] ?? 'review').toLowerCase();
      if (sub === 'panel' || sub === 'open') {
        openCommandPanel(ctx, 'settings-sync');
        return;
      }
      if (sub === 'show') {
        const key = commandArgs[1] as ConfigKey | undefined;
        if (!key || !CONFIG_KEYS.has(key)) {
          ctx.print('Usage: /settingssync show <config-key>');
          return;
        }
        ctx.print(formatResolvedSettingReview(ctx.platform.configManager, key));
        return;
      }
      if (sub === 'staged') {
        ctx.print(formatStagedManagedBundleReview(ctx.platform.configManager));
        return;
      }
      if (sub === 'conflicts') {
        const snapshot = getSettingsControlPlaneSnapshot(ctx.platform.configManager);
        ctx.print(snapshot.conflicts.length > 0
          ? [
              'Settings Sync Conflicts',
              ...snapshot.conflicts.map((conflict) => `  ${conflict.key}  source=${conflict.source}  path=${conflict.path}`),
            ].join('\n')
          : 'Settings Sync Conflicts\n  No settings conflicts recorded.');
        return;
      }
      if (sub === 'resolve') {
        const key = commandArgs[1] as ConfigKey | undefined;
        const resolution = (commandArgs[2] ?? '').toLowerCase();
        if (!key || !CONFIG_KEYS.has(key) || (resolution !== 'local' && resolution !== 'synced')) {
          ctx.print('Usage: /settingssync resolve <config-key> <local|synced> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `resolve synced conflict for ${key}`, '/settingssync resolve <config-key> <local|synced> --yes');
          return;
        }
        const changed = resolveSettingsSyncConflict(ctx.platform.configManager, key, resolution);
        if (!changed) {
          ctx.print(`No synced conflict found for ${key}.`);
          return;
        }
        ctx.session.runtime.model = String(ctx.platform.configManager.get('provider.model'));
        ctx.session.runtime.provider = getProviderIdFromModel(ctx.platform.configManager.get('provider.model'));
        ctx.session.runtime.reasoningEffort = ctx.platform.configManager.get('provider.reasoningEffort') as string;
        ctx.print(`Resolved synced conflict for ${key} using the ${resolution} value.`);
        return;
      }
      if (sub === 'failures') {
        const snapshot = getSettingsControlPlaneSnapshot(ctx.platform.configManager);
        ctx.print(snapshot.recentFailures.length > 0
          ? [
              'Settings Sync Failures',
              ...snapshot.recentFailures.map((failure) => `  ${failure.surface}  ${failure.message}`),
            ].join('\n')
          : 'Settings Sync Failures\n  No recent sync or managed-setting failures recorded.');
        return;
      }
      if (sub === 'rollback-history') {
        const snapshot = getSettingsControlPlaneSnapshot(ctx.platform.configManager);
        ctx.print(snapshot.rollbackHistory.length > 0
          ? [
              'Managed Rollback History',
              ...snapshot.rollbackHistory.map((entry) => (
                `  ${entry.token}  ${entry.profileName}  restored=${entry.restoredKeys.length}  ${new Date(entry.appliedAt).toLocaleString()}`
              )),
            ].join('\n')
          : 'Managed Rollback History\n  No managed apply rollback records yet.');
        return;
      }
      if (sub === 'export' || sub === 'push') {
        const pathArg = commandArgs[1];
        if (!pathArg) {
          ctx.print(`Usage: /settingssync ${sub} <path> --yes`);
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `${sub === 'push' ? 'push' : 'export'} settings sync bundle to ${pathArg}`, `/settingssync ${sub} <path> --yes`);
          return;
        }
        const targetPath = shellPaths.resolveWorkspacePath(pathArg);
        const bundle = exportSettingsSyncBundle(ctx.platform.configManager);
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, JSON.stringify(bundle, null, 2) + '\n', 'utf-8');
        recordSettingsSyncEvent({
          surface: 'settings-sync',
          direction: sub === 'push' ? 'push' : 'export',
          path: targetPath,
          timestamp: Date.now(),
          detail: `${Object.keys(bundle.settings).length} settings exported`,
        }, controlPlaneConfigDir);
        ctx.print(`Settings sync bundle exported to ${targetPath}`);
        return;
      }
      if (sub === 'inspect') {
        const pathArg = commandArgs[1];
        if (!pathArg) {
          ctx.print('Usage: /settingssync inspect <path>');
          return;
        }
        const sourcePath = shellPaths.resolveWorkspacePath(pathArg);
        const bundle = JSON.parse(readFileSync(sourcePath, 'utf-8')) as SettingsSyncBundle;
        ctx.print(inspectSettingsSyncBundle(bundle));
        return;
      }
      if (sub === 'pull') {
        const pathArg = commandArgs[1];
        if (!pathArg) {
          ctx.print('Usage: /settingssync pull <path> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `pull settings sync bundle from ${pathArg}`, '/settingssync pull <path> --yes');
          return;
        }
        const sourcePath = shellPaths.resolveWorkspacePath(pathArg);
        try {
          const bundle = JSON.parse(readFileSync(sourcePath, 'utf-8')) as SettingsSyncBundle;
          const result = applySettingsSyncBundle(ctx.platform.configManager, bundle, sourcePath);
          ctx.print(`Settings sync bundle pulled from ${sourcePath} (${result.appliedCount} applied, ${result.conflictCount} conflicts).`);
        } catch (error) {
          recordSettingsSyncFailure('settings-sync', summarizeError(error), controlPlaneConfigDir);
          ctx.print(summarizeError(error));
        }
        return;
      }
      if (sub === 'lock') {
        const key = commandArgs[1] as ConfigKey | undefined;
        const source = commandArgs[2];
        const reason = commandArgs.slice(3).join(' ').trim();
        if (!key || !source || !reason || !CONFIG_KEYS.has(key)) {
          ctx.print('Usage: /settingssync lock <config-key> <source> <reason...> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `lock managed setting ${key}`, '/settingssync lock <config-key> <source> <reason...> --yes');
          return;
        }
        setManagedSettingLock(key, source, reason, controlPlaneConfigDir);
        ctx.print(`Managed lock recorded for ${key}.`);
        return;
      }
      if (sub === 'unlock') {
        const key = commandArgs[1] as ConfigKey | undefined;
        if (!key || !CONFIG_KEYS.has(key)) {
          ctx.print('Usage: /settingssync unlock <config-key> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `unlock managed setting ${key}`, '/settingssync unlock <config-key> --yes');
          return;
        }
        ctx.print(clearManagedSettingLock(key, controlPlaneConfigDir) ? `Managed lock cleared for ${key}.` : `No managed lock found for ${key}.`);
        return;
      }
      ctx.print(formatSettingsControlPlaneReview(ctx.platform.configManager).join('\n'));
    },
  });
}
