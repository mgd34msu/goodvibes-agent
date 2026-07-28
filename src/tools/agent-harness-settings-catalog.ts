import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { MAX_SETTING_LIMIT, countHarnessSettings, listEffectiveHarnessSettings } from '../agent/harness-control.ts';
import { settingsPolicySummary } from './agent-harness-metadata.ts';
import { CATALOG_QUERIES } from './agent-harness-catalog-filters.ts';
import { catalogEnvelope, catalogFilters, readLimit, readString } from './agent-harness-tool-utils.ts';
import type { AgentHarnessToolArgs } from './agent-harness-tool-types.ts';

/**
 * The `settings` catalog page, with the count of what matched beside it.
 *
 * This mode used to return `{ settings, returned, total }` built by hand, with
 * the page ceiling wired to the shared 500 that the settings catalog had almost
 * outgrown. A page that stopped at the ceiling was indistinguishable from the
 * complete catalog, so a real setting past the cut read as a setting that does
 * not exist. It now takes the settings-specific ceiling and goes out through
 * {@link catalogEnvelope}, which states in words when the page is short of
 * `total` and how to ask for the rest.
 */
export async function harnessSettingsCatalog(
  configManager: ConfigManager,
  args: AgentHarnessToolArgs,
): Promise<Record<string, unknown>> {
  const filters = {
    category: readString(args.category) || undefined,
    prefix: readString(args.prefix) || undefined,
    query: readString(args.query) || undefined,
    includeHidden: args.includeHidden === true,
    limit: readLimit(args.limit, MAX_SETTING_LIMIT, MAX_SETTING_LIMIT),
  };
  // Ownership-aware: daemon-owned keys carry the DAEMON's live value.
  const settings = await listEffectiveHarnessSettings(configManager, { ...filters }, {
    includeParameters: args.includeParameters === true,
  });
  return {
    ...catalogEnvelope(
      'settings',
      settings,
      countHarnessSettings(configManager, filters),
      catalogFilters(args, CATALOG_QUERIES.settings.filters),
      CATALOG_QUERIES.settings.discovery,
    ),
    policy: settingsPolicySummary(),
  };
}
