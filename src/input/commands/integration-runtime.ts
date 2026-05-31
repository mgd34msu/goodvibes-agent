import { resolve } from 'path';
import type { PluginStatus } from '@pellux/goodvibes-sdk/platform/plugins';
import { getPluginDirectories, getUserPluginDirectory } from '../../plugins/loader';
import type { CommandRegistry } from '../command-registry.ts';
import {
  installEcosystemCatalogEntry,
  listInstalledEcosystemEntries,
  loadEcosystemCatalog,
  removeEcosystemCatalogEntry,
  reviewEcosystemCatalogEntry,
  searchEcosystemCatalog,
  updateInstalledEcosystemEntry,
  upsertEcosystemCatalogEntry,
  uninstallEcosystemCatalogEntry,
} from '@/runtime/index.ts';
import { requireEcosystemCatalogPaths, requirePluginPathOptions } from './runtime-services.ts';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

export function registerIntegrationRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'plugin',
    aliases: [],
    description: 'Manage plugins, trust, review, and ecosystem paths',
    usage: 'list | dirs | inspect <name> | review | installed | catalog-review <id> | publish-local <id> <path> <summary...> --yes | unpublish <id> --yes | install <id> [project|user] --yes | update <id> [project|user] --yes | uninstall <id> [project|user] --yes | enable <name> --yes | disable <name> --yes | reload --yes',
    argsHint: 'list | dirs | inspect | review | installed | catalog-review | publish-local --yes | unpublish --yes | install --yes | update --yes | uninstall --yes | enable --yes | disable --yes | reload --yes',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const pluginManager = ctx.extensions.pluginManager;
      const ecosystemPaths = requireEcosystemCatalogPaths(ctx);
      const pluginPaths = requirePluginPathOptions(ctx);
      if (!pluginManager) {
        ctx.print('Plugin manager is not available in this runtime.');
        return;
      }
      const sub = commandArgs[0];

      if (!sub || sub === 'open' || sub === 'panel') {
        if (ctx.showPanel) ctx.showPanel('plugins');
        return;
      }

      if (sub === 'list') {
        const plugins = pluginManager.list() as PluginStatus[];
        if (plugins.length === 0) {
          const directories = getPluginDirectories(pluginPaths)
            .map((dir) => `  ${dir}`)
            .join('\n');
          ctx.print(
            `No plugins installed.\nPlugin search directories:\n${directories}\nPlace a plugin folder in one of those locations with manifest.json and index.ts.`
          );
          return;
        }
        const lines: string[] = ['Installed plugins:'];
        for (const p of plugins) {
          const statusIcon = p.active ? '[active]  ' : p.enabled ? '[loading] ' : '[disabled]';
          lines.push(`  ${statusIcon}  ${p.name.padEnd(24)} v${p.version}  —  ${p.description}`);
          if (p.author) lines.push(`            by ${p.author}`);
        }
        lines.push('');
        lines.push('Use /plugin enable <name> --yes or /plugin disable <name> --yes to toggle plugins.');
        ctx.print(lines.join('\n'));
        return;
      }
      if (sub === 'dirs') {
        const directories = getPluginDirectories(pluginPaths);
        ctx.print([
          'Plugin Search Directories',
          ...directories.map((dir) => `  ${dir}`),
          '',
          `User plugin directory: ${getUserPluginDirectory(pluginPaths)}`,
        ].join('\n'));
        return;
      }
      if (sub === 'inspect') {
        const name = commandArgs[1];
        if (!name) {
          ctx.print('Usage: /plugin inspect <name>');
          return;
        }
        const status = pluginManager.list().find((plugin) => plugin.name === name);
        if (!status) {
          ctx.print(`Error: Plugin '${name}' not found.`);
          return;
        }
        const capabilities = pluginManager.capabilities(name);
        const trust = pluginManager.getTrustRecord(name);
        const quarantine = pluginManager.getQuarantineRecord(name);
        ctx.print([
          `Plugin ${name}`,
          `  version: ${status.version}`,
          `  state: ${status.active ? 'active' : status.enabled ? 'enabled' : 'disabled'}`,
          `  trustTier: ${status.trustTier}`,
          `  quarantined: ${status.quarantined ? 'yes' : 'no'}`,
          `  requestedCapabilities: ${capabilities?.requested.length ?? 0}`,
          `  highRiskCapabilities: ${capabilities?.highRisk.length ?? 0}`,
          `  blockedCapabilities: ${capabilities?.blocked.length ?? 0}`,
          `  signedFingerprint: ${trust?.signatureFingerprint ?? 'n/a'}`,
          `  quarantineReason: ${quarantine?.reason ?? 'n/a'}`,
        ].join('\n'));
        return;
      }
      if (sub === 'review') {
        const plugins = pluginManager.list();
        ctx.print([
          'Plugin Security Review',
          `  total: ${plugins.length}`,
          `  active: ${plugins.filter((plugin) => plugin.active).length}`,
          `  trusted: ${plugins.filter((plugin) => plugin.trustTier === 'trusted').length}`,
          `  limited: ${plugins.filter((plugin) => plugin.trustTier === 'limited').length}`,
          `  untrusted: ${plugins.filter((plugin) => plugin.trustTier === 'untrusted').length}`,
          `  quarantined: ${plugins.filter((plugin) => plugin.quarantined).length}`,
        ].join('\n'));
        return;
      }
      if (sub === 'browse' || sub === 'catalog') {
        const query = commandArgs.slice(1).join(' ');
        const entries = query
          ? searchEcosystemCatalog('plugin', query, ecosystemPaths)
          : loadEcosystemCatalog('plugin', ecosystemPaths);
        if (entries.length === 0) {
          ctx.print(query
            ? `No curated plugin catalog entries matched "${query}".`
            : 'No curated plugin catalog entries found. Add .goodvibes/agent/ecosystem/plugins.json to publish a local-first plugin catalog.');
          return;
        }
        ctx.print([
          `Curated Plugin Catalog (${entries.length})`,
          ...entries.map((entry) => `  ${entry.id}  ${entry.name}  [${entry.tags.join(', ') || 'untagged'}]  ${entry.summary}`),
        ].join('\n'));
        return;
      }
      if (sub === 'installed') {
        const receipts = listInstalledEcosystemEntries('plugin', ecosystemPaths);
        if (receipts.length === 0) {
          ctx.print('No curated plugins installed from local catalogs yet.');
          return;
        }
        ctx.print([
          `Installed Curated Plugins (${receipts.length})`,
          ...receipts.map((receipt) => `  ${receipt.entry.id}  ${receipt.scope}  ${receipt.targetPath}`),
        ].join('\n'));
        return;
      }
      if (sub === 'catalog-review') {
        const entryId = commandArgs[1];
        if (!entryId) {
          ctx.print('Usage: /plugin catalog-review <catalog-id>');
          return;
        }
        const entry = loadEcosystemCatalog('plugin', ecosystemPaths).find((candidate) => candidate.id === entryId);
        if (!entry) {
          ctx.print(`Unknown curated plugin entry: ${entryId}`);
          return;
        }
        const review = reviewEcosystemCatalogEntry(entry, ecosystemPaths);
        ctx.print([
          `Plugin Catalog Review: ${entry.name}`,
          `  id: ${entry.id}`,
          `  source: ${entry.source}`,
          `  sourceKind: ${review.sourceKind}`,
          `  sourceExists: ${review.sourceExists ? 'yes' : 'no'}`,
          `  recommendedScope: ${review.recommendedScope}`,
          `  risk: ${review.riskLevel}`,
          `  trust notes: ${entry.trustNotes ?? '(none)'}`,
          `  provenance: ${entry.provenance ?? '(none)'}`,
          `  update hint: ${entry.updateHint ?? '(none)'}`,
        ].join('\n'));
        return;
      }
      if (sub === 'install-hint') {
        const entryId = commandArgs[1];
        if (!entryId) {
          ctx.print('Usage: /plugin install-hint <catalog-id>');
          return;
        }
        const entry = loadEcosystemCatalog('plugin', ecosystemPaths).find((candidate) => candidate.id === entryId);
        if (!entry) {
          ctx.print(`Unknown curated plugin entry: ${entryId}`);
          return;
        }
        ctx.print([
          `Plugin Install Guidance: ${entry.name}`,
          `  id: ${entry.id}`,
          `  source: ${entry.source}`,
          `  tags: ${entry.tags.join(', ') || '(none)'}`,
          `  trust notes: ${entry.trustNotes ?? '(none)'}`,
          `  install hint: ${entry.installHint ?? 'Place the plugin under a configured plugin search directory and use /plugin reload --yes.'}`,
        ].join('\n'));
        return;
      }
      if (sub === 'publish-local') {
        const entryId = commandArgs[1];
        const sourcePath = commandArgs[2];
        const summary = commandArgs.slice(3).join(' ').trim();
        if (!entryId || !sourcePath || !summary) {
          ctx.print('Usage: /plugin publish-local <catalog-id> <path> <summary...> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `publish curated plugin ${entryId}`, '/plugin publish-local <catalog-id> <path> <summary...> --yes');
          return;
        }
        const result = upsertEcosystemCatalogEntry({
          id: entryId,
          kind: 'plugin',
          name: entryId.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
          summary,
          source: sourcePath,
          tags: ['local-first', 'published'],
          provenance: 'operator-published',
          updateHint: 'Use /plugin publish-local again to refresh catalog metadata after edits.',
        }, ecosystemPaths);
        ctx.print(result.ok
          ? `Published curated plugin ${entryId} into ${result.path}`
          : `Error: ${result.error}`);
        return;
      }
      if (sub === 'unpublish') {
        const entryId = commandArgs[1];
        if (!entryId) {
          ctx.print('Usage: /plugin unpublish <catalog-id> --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `unpublish curated plugin ${entryId}`, '/plugin unpublish <catalog-id> --yes');
          return;
        }
        const result = removeEcosystemCatalogEntry('plugin', entryId, ecosystemPaths);
        ctx.print(result.ok
          ? `Removed curated plugin ${entryId} from ${result.path}`
          : `Error: ${result.error}`);
        return;
      }
      if (sub === 'install') {
        const entryId = commandArgs[1];
        const scopeArg = commandArgs[2];
        if (!entryId) {
          ctx.print('Usage: /plugin install <catalog-id> [project|user] --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `install curated plugin ${entryId}`, '/plugin install <catalog-id> [project|user] --yes');
          return;
        }
        const scope = scopeArg === 'user' ? 'user' : 'project';
        const result = installEcosystemCatalogEntry('plugin', entryId, { ...ecosystemPaths, scope });
        ctx.print(result.ok
          ? `Installed curated plugin ${entryId} into ${result.receipt.targetPath}`
          : `Error: ${result.error}`);
        return;
      }
      if (sub === 'update') {
        const entryId = commandArgs[1];
        const scopeArg = commandArgs[2];
        if (!entryId) {
          ctx.print('Usage: /plugin update <catalog-id> [project|user] --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `update curated plugin ${entryId}`, '/plugin update <catalog-id> [project|user] --yes');
          return;
        }
        const scope = scopeArg === 'user' ? 'user' : 'project';
        const result = updateInstalledEcosystemEntry('plugin', entryId, { ...ecosystemPaths, scope });
        ctx.print(result.ok
          ? `Updated curated plugin ${entryId} in ${result.receipt.targetPath}`
          : `Error: ${result.error}`);
        return;
      }
      if (sub === 'uninstall') {
        const entryId = commandArgs[1];
        const scopeArg = commandArgs[2];
        if (!entryId) {
          ctx.print('Usage: /plugin uninstall <catalog-id> [project|user] --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `uninstall curated plugin ${entryId}`, '/plugin uninstall <catalog-id> [project|user] --yes');
          return;
        }
        const scope = scopeArg === 'user' ? 'user' : 'project';
        const result = uninstallEcosystemCatalogEntry('plugin', entryId, { ...ecosystemPaths, scope });
        ctx.print(result.ok
          ? `Uninstalled curated plugin ${entryId} from ${result.removedPath}`
          : `Error: ${result.error}`);
        return;
      }
      if (sub === 'enable') {
        const name = commandArgs[1];
        if (!name) { ctx.print('Usage: /plugin enable <name> --yes'); return; }
        if (!parsed.yes) {
          requireYesFlag(ctx, `enable plugin ${name}`, '/plugin enable <name> --yes');
          return;
        }
        const result = await pluginManager.enable(name);
        ctx.print(result.ok ? `Plugin '${name}' enabled and activated.` : `Error: ${result.error}`);
        return;
      }
      if (sub === 'disable') {
        const name = commandArgs[1];
        if (!name) { ctx.print('Usage: /plugin disable <name> --yes'); return; }
        if (!parsed.yes) {
          requireYesFlag(ctx, `disable plugin ${name}`, '/plugin disable <name> --yes');
          return;
        }
        const result = await pluginManager.disable(name);
        ctx.print(result.ok ? `Plugin '${name}' disabled.` : `Error: ${result.error}`);
        return;
      }
      if (sub === 'reload') {
        if (!parsed.yes) {
          requireYesFlag(ctx, 'reload plugins', '/plugin reload --yes');
          return;
        }
        ctx.print('Reloading plugins...');
        const { reloaded, failed } = await pluginManager.reload();
        ctx.print(`Done. ${reloaded} plugin(s) reloaded${failed > 0 ? `, ${failed} failed` : ''}.`);
        return;
      }
      if (sub === 'trust') {
        const name = commandArgs[1];
        const rawTier = commandArgs[2];
        if (!name || !rawTier) {
          ctx.print('Usage: /plugin trust <name> <untrusted|limited|trusted> [note] --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `set plugin ${name} trust tier`, '/plugin trust <name> <untrusted|limited|trusted> [note] --yes');
          return;
        }
        if (rawTier !== 'untrusted' && rawTier !== 'limited' && rawTier !== 'trusted') {
          ctx.print(`Error: Invalid trust tier '${rawTier}'. Must be: untrusted, limited, or trusted.`);
          return;
        }
        const tier = rawTier as 'untrusted' | 'limited' | 'trusted';
        const note = commandArgs.slice(3).join(' ') || undefined;
        if (tier === 'trusted') {
          const sigResult = pluginManager.trustSigned(name);
          if (sigResult.ok) {
            ctx.print(`Plugin '${name}' elevated to 'trusted' via signed manifest${sigResult.fingerprint ? ` (fingerprint: ${sigResult.fingerprint})` : ''}.\nReload the plugin to apply updated capability grants.`);
            return;
          }
          ctx.print(`Warning: Signature validation failed (${sigResult.error}).\nGranting 'trusted' tier by operator override. High-risk capabilities will be available on next reload.`);
        }
        const result = pluginManager.trust(name, tier, note);
        ctx.print(result.ok
          ? `Plugin '${name}' trust tier set to '${tier}'.${tier === 'trusted' ? '\nReload the plugin to apply high-risk capability grants.' : ''}`
          : `Error: ${result.error}`);
        return;
      }
      if (sub === 'verify') {
        const name = commandArgs[1];
        if (!name) { ctx.print('Usage: /plugin verify <name>'); return; }
        const result = pluginManager.verify(name);
        if (!result.ok && result.reason?.includes('not found')) {
          ctx.print(`Error: ${result.reason}`);
          return;
        }
        ctx.print(result.valid
          ? `Plugin '${name}' manifest signature is VALID.${result.fingerprint ? `\nFingerprint: ${result.fingerprint}` : ''}`
          : `Plugin '${name}' manifest signature is INVALID.\nReason: ${result.reason ?? 'Unknown'}`);
        return;
      }
      if (sub === 'capabilities') {
        const name = commandArgs[1];
        if (!name) { ctx.print('Usage: /plugin capabilities <name>'); return; }
        const info = pluginManager.capabilities(name);
        if (!info) {
          ctx.print(`Error: Plugin '${name}' not found.`);
          return;
        }
        const lines: string[] = [`Plugin: ${name}`, `Trust tier: ${info.tier}`, '', `Requested capabilities (${info.requested.length}):`];
        if (info.requested.length === 0) lines.push('  (none)');
        else {
          for (const cap of info.requested) {
            const tag = info.blocked.includes(cap)
              ? '[BLOCKED - requires trusted tier]'
              : info.highRisk.includes(cap) ? '[high-risk, granted]' : '[safe]';
            lines.push(`  ${cap.padEnd(32)} ${tag}`);
          }
        }
        if (info.blocked.length > 0) {
          lines.push('');
          lines.push(`${info.blocked.length} high-risk capability/capabilities blocked by trust tier '${info.tier}'.`);
          lines.push(`Use /plugin trust ${name} trusted --yes to escalate.`);
        }
        ctx.print(lines.join('\n'));
        return;
      }
      if (sub === 'quarantine') {
        const name = commandArgs[1];
        const action = commandArgs[2] ?? 'add';
        if (!name) {
          ctx.print('Usage: /plugin quarantine <name> [add|lift] [reason] --yes');
          return;
        }
        if (!parsed.yes) {
          requireYesFlag(ctx, `${action === 'lift' ? 'lift quarantine for' : 'quarantine'} plugin ${name}`, '/plugin quarantine <name> [add|lift] [reason] --yes');
          return;
        }
        if (action === 'lift') {
          const result = pluginManager.liftQuarantine(name);
          ctx.print(result.ok ? `Plugin '${name}' quarantine lifted. Reload to restore safe capabilities.` : `Error: ${result.error}`);
          return;
        }
        const reason = (action === 'add' ? commandArgs.slice(3) : commandArgs.slice(2)).join(' ') || 'quarantined by operator';
        const result = pluginManager.quarantine(name, reason);
        ctx.print(result.ok
          ? `Plugin '${name}' quarantined.\nReason: ${reason}\nHigh-risk capabilities revoked. Reload to fully apply. Use /plugin quarantine <name> lift --yes to restore.`
          : `Error: ${result.error}`);
        return;
      }

      ctx.print(
        'Usage: /plugin <subcommand>\n'
        + '  list                       — show installed plugins and their status\n'
        + '  enable <name> --yes        — enable a plugin\n'
        + '  disable <name> --yes       — disable a plugin\n'
        + '  reload --yes               — reload all enabled plugins\n'
        + '  trust <name> <tier> [note] --yes — set trust tier (untrusted|limited|trusted)\n'
        + '  verify <name>              — inspect a plugin manifest signature\n'
        + '  capabilities <name>        — show capability grants and blocks\n'
        + '  browse [query]             — browse curated local-first plugin catalog entries\n'
        + '  installed                  — list curated catalog installs with provenance receipts\n'
        + '  catalog-review <id>        — review source, provenance, and risk for a curated plugin\n'
        + '  publish-local <id> <path> <summary...> --yes — publish a local plugin directory into the curated catalog\n'
        + '  unpublish <id> --yes       — remove a local curated plugin catalog entry\n'
        + '  install-hint <catalog-id>  — show install guidance for a curated plugin entry\n'
        + '  install <catalog-id> [scope] --yes   — install a local-path curated plugin into project|user scope\n'
        + '  uninstall <catalog-id> [scope] --yes — remove a curated plugin install receipt and target path\n'
        + '  quarantine <name> [reason] --yes — quarantine a plugin (revoke high-risk caps)\n'
        + '  quarantine <name> lift --yes     — lift quarantine from a plugin'
      );
    },
  });
}
