import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_SCHEMA } from '@pellux/goodvibes-sdk/platform/config';
import { FEATURE_SETTINGS } from '@pellux/goodvibes-sdk/platform/runtime/state';
import { CommandRegistry } from '../input/command-registry.ts';
import { registerBuiltinCommands } from '../input/commands.ts';
import { SETTINGS_BEHAVIOR_COVERAGE_COUNT } from './settings-behavior-coverage.ts';
import { splitSettingsKeysByLocalConsumer } from './settings-consumed-keys.ts';
import {
  countChannelReadinessSurface,
  countDelegationPostureSurface,
  countHarnessModeCatalogSurface,
  countMcpServerSurface,
  countMediaPostureSurface,
  countModelRoutingSurface,
  countNotificationTargetSurface,
  countOperatorMethodSurface,
  countPairingPostureSurface,
  countProviderAccountSurface,
  countQualityReadinessDimensions,
  countReleaseEvidenceSurface,
  countSecuritySupportSurface,
  countServicePostureSurface,
  countSessionSurface,
  countSetupPostureSurface,
} from './verification-ledger-surfaces.ts';

export interface VerificationLedgerArea {
  readonly area: string;
  readonly total: number;
  readonly localSignalVerified: number;
  readonly localBehaviorVerified: number;
  readonly externalOutcomeRequired: number;
  readonly notes: string;
}

export interface VerificationLedger {
  readonly generatedAt: string;
  readonly areas: readonly VerificationLedgerArea[];
  readonly totals: {
    readonly total: number;
    readonly localSignalVerified: number;
    readonly localBehaviorVerified: number;
    readonly externalOutcomeRequired: number;
    readonly localSignalPercent: number;
    readonly localBehaviorPercent: number;
  };
}

const EXTERNAL_SLASH_COMMANDS = new Set([
  'auth',
  'channels',
  'health',
  'knowledge',
  'mcp',
  'notify',
  'pair',
  'provider',
  'qrcode',
  'secrets',
  'subscription',
  'tts',
  'voice',
]);

const EXTERNAL_CLI_COMMANDS = new Set([
  'auth',
  'knowledge',
  'pair',
  'providers',
  'run',
  'secrets',
  'subscription',
  'tui',
]);

const ONBOARDING_CAPABILITIES = [
  'operator-terminal',
  'provider-access',
  'agent-knowledge',
  'local-behavior',
  'communication-channels',
  'automation-review',
  'tui-delegation',
] as const;

const EXTERNAL_SURFACES = [
  'bluebubbles',
  'discord',
  'googleChat',
  'imessage',
  'matrix',
  'mattermost',
  'msteams',
  'ntfy',
  'signal',
  'slack',
  'telephony',
  'telegram',
  'webhook',
  'whatsapp',
] as const;

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;
}

function listSlashCommands(): string[] {
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry);
  return registry.getAll().map((command) => command.name);
}

function listCliCommands(root: string): string[] {
  const text = readFileSync(join(root, 'src', 'cli', 'types.ts'), 'utf8');
  const match = text.match(/export type GoodVibesCliCommand =([\s\S]*?)export type GoodVibesCliOutputFormat/);
  if (!match) return [];
  return [...match[1].matchAll(/\|\s*'([^']+)'/g)]
    .map((entry) => entry[1])
    .filter((command) => command !== 'unknown');
}

/**
 * The number of CONFIG_SCHEMA entries with local behaviour verification — tests that
 * fail if the setting stops being honoured, as opposed to the structural signal every
 * row trivially satisfies.
 *
 * This is no longer a bare hand-typed integer. It is derived in
 * settings-behavior-coverage.ts as a documented legacy baseline plus one entry per
 * itemised key, where each entry names the test that covers it. Read that file before
 * changing this number: the only way to raise it is to add an evidence row, and rows
 * are validated (real key, real test file, test actually mentions the key) by
 * settings-behavior-coverage.test.ts.
 *
 * The ledger formula uses Math.min(SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE, settings) so that
 * if the schema shrinks below the count, localBehaviorVerified never overstates total.
 * The drift test in verification-ledger.test.ts asserts
 * SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE <= CONFIG_SCHEMA.length — the constant may never
 * claim more verified settings than keys that actually exist.
 */
export const SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE = SETTINGS_BEHAVIOR_COVERAGE_COUNT;

/**
 * Conservative estimate of the number of feature flags that require live external runtime
 * behavior and cannot be behavior-verified locally. The remainder are classed as locally
 * behavior-verified. Update this constant when flag semantics change. See backlog I1.
 */
export const FEATURE_FLAGS_EXTERNAL_ESTIMATE = 4;

export function buildVerificationLedger(root: string): VerificationLedger {
  const slashCommandNames = listSlashCommands();
  const cliCommandNames = listCliCommands(root);
  const slashCommands = slashCommandNames.length;
  const cliCommands = cliCommandNames.length;
  const featureFlags = FEATURE_SETTINGS.length;
  // The settings denominator is the keys THIS repository references, not every
  // key the platform declares anywhere. Counting the latter made the reported
  // percentage fall whenever another product's settings were declared, with
  // this product's verification unchanged — see settings-consumed-keys.ts for
  // the rule and the invariants that hold it in place.
  const settingsKeys = splitSettingsKeysByLocalConsumer(root, CONFIG_SCHEMA.map((entry) => entry.key));
  const settings = settingsKeys.consumed.length;
  const externalSlashCommands = slashCommandNames.filter((command) => EXTERNAL_SLASH_COMMANDS.has(command)).length;
  const externalCliCommands = cliCommandNames.filter((command) => EXTERNAL_CLI_COMMANDS.has(command)).length;
  const releaseEvidence = countReleaseEvidenceSurface(root);
  const servicePosture = countServicePostureSurface(root);
  const channelReadiness = countChannelReadinessSurface(root);
  const notificationTargets = countNotificationTargetSurface(root);
  const providerAccounts = countProviderAccountSurface(root);
  const mcpServers = countMcpServerSurface(root);
  const setupPosture = countSetupPostureSurface(root);
  const modelRouting = countModelRoutingSurface(root);
  const pairingPosture = countPairingPostureSurface(root);
  const delegationPosture = countDelegationPostureSurface(root);
  const securitySupport = countSecuritySupportSurface(root);
  const mediaPosture = countMediaPostureSurface(root);
  const sessionSurface = countSessionSurface(root);
  const operatorMethods = countOperatorMethodSurface(root);
  const harnessModeCatalog = countHarnessModeCatalogSurface(root);
  const qualityReadiness = countQualityReadinessDimensions(root);

  // Use module-level exported constants (defined below buildVerificationLedger).
  // Importing from here keeps test and production in sync — the drift test imports the same constants.

  const areas: VerificationLedgerArea[] = [
    {
      area: 'Settings schema and persistence',
      total: settings,
      localSignalVerified: settings,
      // localBehaviorVerified uses SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE — a documented estimate,
      // not a precise derivation. Drift test in verification-ledger.test.ts guards against silent
      // overstatement when the schema grows past the constant.
      localBehaviorVerified: Math.min(SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE, settings),
      externalOutcomeRequired: Math.max(0, settings - SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE),
      notes: `Counts the ${String(settings)} CONFIG_SCHEMA keys this repository references, not all ${String(CONFIG_SCHEMA.length)} the platform declares: the ${String(settingsKeys.disclaimed.length)} it never mentions are other products' settings and cannot be verified here. Every counted setting can be validated for schema/default/load/write/location; external side effects remain separate. localBehaviorVerified uses a documented estimate (SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE); update the constant when coverage evidence changes.`,
    },
    {
      area: 'Feature settings',
      total: featureFlags,
      localSignalVerified: featureFlags,
      // localBehaviorVerified uses FEATURE_FLAGS_EXTERNAL_ESTIMATE — a documented estimate,
      // not a precise derivation. See backlog I1.
      localBehaviorVerified: Math.max(0, featureFlags - FEATURE_FLAGS_EXTERNAL_ESTIMATE),
      externalOutcomeRequired: Math.min(FEATURE_FLAGS_EXTERNAL_ESTIMATE, featureFlags),
      notes: 'Every feature is enabled through its domain settings key (FEATURE_SETTINGS binding) and can be derived/toggled locally; a small external runtime subset still requires live behavior. localBehaviorVerified uses a documented estimate (FEATURE_FLAGS_EXTERNAL_ESTIMATE); update the constant when feature semantics change.',
    },
    {
      area: 'Slash commands',
      total: slashCommands,
      localSignalVerified: slashCommands,
      localBehaviorVerified: slashCommands - externalSlashCommands,
      externalOutcomeRequired: externalSlashCommands,
      notes: 'Every command can be routed and invoked through an in-process command harness; external/provider/device commands need live outcome checks.',
    },
    {
      area: 'Top-level CLI commands',
      total: cliCommands,
      localSignalVerified: cliCommands,
      localBehaviorVerified: cliCommands - externalCliCommands,
      externalOutcomeRequired: externalCliCommands,
      notes: 'Parser/help/status/package behavior is local; interactive TUI, run, auth, pair, knowledge, provider, subscription, and secret flows require process or external checks.',
    },
    {
      area: 'External surfaces',
      total: EXTERNAL_SURFACES.length,
      localSignalVerified: EXTERNAL_SURFACES.length,
      localBehaviorVerified: 2,
      externalOutcomeRequired: EXTERNAL_SURFACES.length - 2,
      notes: 'Config/readiness can be local for all surfaces; real message delivery is external for most surfaces.',
    },
    {
      area: 'Onboarding capability bundles',
      total: ONBOARDING_CAPABILITIES.length,
      localSignalVerified: ONBOARDING_CAPABILITIES.length,
      localBehaviorVerified: ONBOARDING_CAPABILITIES.length,
      externalOutcomeRequired: 0,
      notes: 'Wizard state derivation/apply is local; connected-host-backed outcomes stay external to Agent ownership.',
    },
    {
      area: 'Model-visible release evidence bundle',
      total: releaseEvidence.artifacts + releaseEvidence.modes,
      localSignalVerified: releaseEvidence.availableArtifacts + releaseEvidence.availableModes,
      localBehaviorVerified: releaseEvidence.availableArtifacts + releaseEvidence.availableModes,
      externalOutcomeRequired: 0,
      notes: `${releaseEvidence.artifacts} packaged release evidence artifacts and ${releaseEvidence.modes} agent_harness modes, release_evidence and release_evidence_artifact, must stay locally inspectable.`,
    },
    {
      area: 'Model-visible service posture',
      total: servicePosture.modes + servicePosture.endpointIds,
      localSignalVerified: servicePosture.availableModes + servicePosture.availableEndpointIds,
      localBehaviorVerified: servicePosture.availableModes + servicePosture.availableEndpointIds,
      externalOutcomeRequired: 0,
      notes: `${servicePosture.modes} agent_harness modes, service_posture and service_endpoint, and ${servicePosture.endpointIds} endpoint ids must stay locally inspectable without lifecycle control.`,
    },
    {
      area: 'Model-visible channel readiness',
      total: channelReadiness.modes + channelReadiness.channelIds,
      localSignalVerified: channelReadiness.availableModes + channelReadiness.availableChannelIds,
      localBehaviorVerified: channelReadiness.availableModes + channelReadiness.availableChannelIds,
      externalOutcomeRequired: 0,
      notes: `${channelReadiness.modes} agent_harness modes, channels, channel, channel_setup_guide, channel_triage, and channel_deliveries, and ${channelReadiness.channelIds} channel ids must stay locally inspectable without sending messages or exposing secret values.`,
    },
    {
      area: 'Model-visible notification targets',
      total: notificationTargets.modes + notificationTargets.sources,
      // availableSources counts source-marker substring hits (signal tier only, not behavior-backed).
      localSignalVerified: notificationTargets.availableModes + notificationTargets.availableSources,
      localBehaviorVerified: notificationTargets.availableModes,
      externalOutcomeRequired: 0,
      notes: `${notificationTargets.modes} agent_harness modes, notifications and notification_target, and ${notificationTargets.sources} notification source markers must stay locally inspectable with webhook values redacted.`,
    },
    {
      area: 'Model-visible provider accounts',
      total: providerAccounts.modes + providerAccounts.sources,
      localSignalVerified: providerAccounts.availableModes + providerAccounts.availableSources,
      localBehaviorVerified: providerAccounts.availableModes,
      externalOutcomeRequired: 0,
      notes: `${providerAccounts.modes} agent_harness modes, provider_accounts and provider_account, and ${providerAccounts.sources} provider-account source markers must stay locally inspectable without exposing tokens or authorization codes.`,
    },
    {
      area: 'Model-visible MCP servers',
      total: mcpServers.modes + mcpServers.sources,
      localSignalVerified: mcpServers.availableModes + mcpServers.availableSources,
      localBehaviorVerified: mcpServers.availableModes,
      externalOutcomeRequired: 0,
      notes: `${mcpServers.modes} agent_harness modes, mcp_servers and mcp_server, and ${mcpServers.sources} MCP source markers must stay locally inspectable without exposing env or secret values.`,
    },
    {
      area: 'Model-visible setup and onboarding posture',
      total: setupPosture.modes + setupPosture.sources,
      localSignalVerified: setupPosture.availableModes + setupPosture.availableSources,
      localBehaviorVerified: setupPosture.availableModes,
      externalOutcomeRequired: 0,
      notes: `${setupPosture.modes} agent_harness modes, setup_posture, setup_item, setup_checkpoint, mark_setup_checkpoint, clear_setup_checkpoint, provision_connected_host_token, and run_setup_smoke, and ${setupPosture.sources} setup/onboarding source markers must stay locally inspectable while confirmed setup effects avoid exposing secret values.`,
    },
    {
      area: 'Model-visible model routing posture',
      total: modelRouting.modes + modelRouting.sources,
      localSignalVerified: modelRouting.availableModes + modelRouting.availableSources,
      localBehaviorVerified: modelRouting.availableModes,
      externalOutcomeRequired: 0,
      notes: `${modelRouting.modes} agent_harness modes, model_routing, model_route, run_local_model_smoke, and ${modelRouting.sources} provider/model source markers must stay locally inspectable while route changes stay visible user flows.`,
    },
    {
      area: 'Model-visible pairing posture',
      total: pairingPosture.modes + pairingPosture.sources,
      localSignalVerified: pairingPosture.availableModes + pairingPosture.availableSources,
      localBehaviorVerified: pairingPosture.availableModes,
      externalOutcomeRequired: 0,
      notes: `${pairingPosture.modes} agent_harness modes, pairing_posture and pairing_route, and ${pairingPosture.sources} pairing source markers must stay locally inspectable without returning raw tokens or QR payloads.`,
    },
    {
      area: 'Model-visible delegation posture',
      total: delegationPosture.modes + delegationPosture.sources,
      localSignalVerified: delegationPosture.availableModes + delegationPosture.availableSources,
      localBehaviorVerified: delegationPosture.availableModes,
      externalOutcomeRequired: 0,
      notes: `${delegationPosture.modes} agent_harness modes, delegation_posture and delegation_route, and ${delegationPosture.sources} delegation source markers must stay locally inspectable while delegated work submission remains an explicit visible flow.`,
    },
    {
      area: 'Model-visible security and support bundles',
      total: securitySupport.modes + securitySupport.sources,
      localSignalVerified: securitySupport.availableModes + securitySupport.availableSources,
      localBehaviorVerified: securitySupport.availableModes,
      externalOutcomeRequired: 0,
      notes: `${securitySupport.modes} agent_harness modes, security_posture, security_finding, support_bundles, and support_bundle, and ${securitySupport.sources} security/support source markers must stay locally inspectable without exposing token, secret, or raw config values.`,
    },
    {
      area: 'Model-visible voice and media posture',
      total: mediaPosture.modes + mediaPosture.sources,
      localSignalVerified: mediaPosture.availableModes + mediaPosture.availableSources,
      localBehaviorVerified: mediaPosture.availableModes,
      externalOutcomeRequired: 0,
      notes: `${mediaPosture.modes} agent_harness modes, media_posture and media_provider, and ${mediaPosture.sources} voice/media source markers must stay locally inspectable without exposing secret values or media payloads.`,
    },
    {
      area: 'Model-visible sessions and bookmarks',
      total: sessionSurface.modes + sessionSurface.sources,
      localSignalVerified: sessionSurface.availableModes + sessionSurface.availableSources,
      localBehaviorVerified: sessionSurface.availableModes,
      externalOutcomeRequired: 0,
      notes: `${sessionSurface.modes} agent_harness modes, sessions and session, and ${sessionSurface.sources} session/bookmark source markers must stay locally inspectable while save/resume/export/delete/bookmark writes stay visible user flows.`,
    },
    {
      area: 'Model-visible operator method catalog',
      total: operatorMethods.modes + operatorMethods.sources,
      localSignalVerified: operatorMethods.availableModes + operatorMethods.availableSources,
      localBehaviorVerified: operatorMethods.availableModes,
      externalOutcomeRequired: 0,
      notes: `${operatorMethods.modes} agent_harness modes, operator_methods and operator_method, and ${operatorMethods.sources} SDK-backed method source markers must stay locally inspectable with exact-route invocation gated by agent_operator_method confirmation policy.`,
    },
    {
      area: 'Model-visible harness mode catalog',
      total: harnessModeCatalog.modes + harnessModeCatalog.descriptors + harnessModeCatalog.behaviorMarkers,
      localSignalVerified: harnessModeCatalog.availableModes + harnessModeCatalog.availableDescriptors + harnessModeCatalog.availableBehaviorMarkers,
      localBehaviorVerified: harnessModeCatalog.availableModes + harnessModeCatalog.availableDescriptors + harnessModeCatalog.availableBehaviorMarkers,
      externalOutcomeRequired: 0,
      notes: `${harnessModeCatalog.descriptors} agent_harness mode descriptors plus modes and mode discovery routes must stay locally inspectable so the model can discover every harness capability.`,
    },
    {
      area: 'Release quality readiness dimensions',
      total: qualityReadiness.dimensions,
      localSignalVerified: qualityReadiness.completeDimensions,
      localBehaviorVerified: qualityReadiness.completeDimensions,
      externalOutcomeRequired: qualityReadiness.blockerItems,
      notes: `${qualityReadiness.items} release-readiness items must carry capabilityCoverage, userAccess, modelAccess, safetyBoundary, and releaseEvidence with zero blocker statuses.`,
    },
  ];

  const total = areas.reduce((sum, area) => sum + area.total, 0);
  const localSignalVerified = areas.reduce((sum, area) => sum + area.localSignalVerified, 0);
  const localBehaviorVerified = areas.reduce((sum, area) => sum + area.localBehaviorVerified, 0);
  const externalOutcomeRequired = areas.reduce((sum, area) => sum + area.externalOutcomeRequired, 0);

  return {
    generatedAt: new Date().toISOString(),
    areas,
    totals: {
      total,
      localSignalVerified,
      localBehaviorVerified,
      externalOutcomeRequired,
      localSignalPercent: percent(localSignalVerified, total),
      localBehaviorPercent: percent(localBehaviorVerified, total),
    },
  };
}

export function renderVerificationLedgerMarkdown(ledger: VerificationLedger): string {
  const lines = [
    '# GoodVibes Verification Ledger',
    '',
    `Generated: ${ledger.generatedAt}`,
    '',
    '| Area | Total | Local verification signal | Local behavior | External outcome required | Notes |',
    '|---|---:|---:|---:|---:|---|',
    ...ledger.areas.map((area) => [
      `| ${area.area}`,
      area.total,
      area.localSignalVerified,
      area.localBehaviorVerified,
      area.externalOutcomeRequired,
      area.notes,
    ].join(' | ') + ' |'),
    '',
    '## Totals',
    '',
    `- Total inventory items: ${ledger.totals.total}`,
    `- Local verification signal: ${ledger.totals.localSignalVerified} (${ledger.totals.localSignalPercent}%)`,
    `- Local behavior verified: ${ledger.totals.localBehaviorVerified} (${ledger.totals.localBehaviorPercent}%)`,
    `- External outcome required: ${ledger.totals.externalOutcomeRequired}`,
    '',
    'Local verification signal means the item can be exercised through schema, routing, persistence, render, readiness, connected-host checks, CLI, or real-state checks without relying on an external SaaS/device outcome.',
    'Local behavior verified means the behavior can be completed locally with in-process, CLI, connected-host checks, tmux, or real persisted state.',
    '',
  ];
  return `${lines.join('\n')}\n`;
}
