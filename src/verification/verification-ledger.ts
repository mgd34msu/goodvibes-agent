import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_SCHEMA } from '@pellux/goodvibes-sdk/platform/config';
import { FEATURE_FLAG_MAP } from '@pellux/goodvibes-sdk/platform/runtime/state';
import { CommandRegistry } from '../input/command-registry.ts';
import { registerBuiltinCommands } from '../input/commands.ts';
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

function countBuiltinPanels(root: string): number {
  const builtinDir = join(root, 'src', 'panels', 'builtin');
  let count = 0;
  for (const file of readdirSync(builtinDir)) {
    if (!file.endsWith('.ts')) continue;
    const text = readFileSync(join(builtinDir, file), 'utf8');
    count += [...text.matchAll(/registerType\(\s*\{\s*id:\s*['"][^'"]+['"]/g)].length;
  }
  return count;
}

function listCliCommands(root: string): string[] {
  const text = readFileSync(join(root, 'src', 'cli', 'types.ts'), 'utf8');
  const match = text.match(/export type GoodVibesCliCommand =([\s\S]*?)export type GoodVibesCliOutputFormat/);
  if (!match) return [];
  return [...match[1].matchAll(/\|\s*'([^']+)'/g)]
    .map((entry) => entry[1])
    .filter((command) => command !== 'unknown');
}

export function buildVerificationLedger(root: string): VerificationLedger {
  const slashCommandNames = listSlashCommands();
  const cliCommandNames = listCliCommands(root);
  const slashCommands = slashCommandNames.length;
  const panels = countBuiltinPanels(root);
  const cliCommands = cliCommandNames.length;
  const featureFlags = FEATURE_FLAG_MAP.size;
  const settings = CONFIG_SCHEMA.length;
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

  const areas: VerificationLedgerArea[] = [
    {
      area: 'Settings schema and persistence',
      total: settings,
      localSignalVerified: settings,
      localBehaviorVerified: 184,
      externalOutcomeRequired: settings - 184,
      notes: 'Every schema setting can be validated for schema/default/load/write/location; external side effects remain separate.',
    },
    {
      area: 'Feature flags',
      total: featureFlags,
      localSignalVerified: featureFlags,
      localBehaviorVerified: featureFlags - 4,
      externalOutcomeRequired: 4,
      notes: 'All flags can be loaded/toggled; a small external runtime subset still requires live behavior.',
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
      area: 'Built-in panels',
      total: panels,
      localSignalVerified: panels,
      localBehaviorVerified: panels,
      externalOutcomeRequired: 0,
      notes: 'Panels can be rendered and input-tested against test read models and real cached state.',
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
      localSignalVerified: notificationTargets.availableModes + notificationTargets.availableSources,
      localBehaviorVerified: notificationTargets.availableModes + notificationTargets.availableSources,
      externalOutcomeRequired: 0,
      notes: `${notificationTargets.modes} agent_harness modes, notifications and notification_target, and ${notificationTargets.sources} notification source markers must stay locally inspectable with webhook values redacted.`,
    },
    {
      area: 'Model-visible provider accounts',
      total: providerAccounts.modes + providerAccounts.sources,
      localSignalVerified: providerAccounts.availableModes + providerAccounts.availableSources,
      localBehaviorVerified: providerAccounts.availableModes + providerAccounts.availableSources,
      externalOutcomeRequired: 0,
      notes: `${providerAccounts.modes} agent_harness modes, provider_accounts and provider_account, and ${providerAccounts.sources} provider-account source markers must stay locally inspectable without exposing tokens or authorization codes.`,
    },
    {
      area: 'Model-visible MCP servers',
      total: mcpServers.modes + mcpServers.sources,
      localSignalVerified: mcpServers.availableModes + mcpServers.availableSources,
      localBehaviorVerified: mcpServers.availableModes + mcpServers.availableSources,
      externalOutcomeRequired: 0,
      notes: `${mcpServers.modes} agent_harness modes, mcp_servers and mcp_server, and ${mcpServers.sources} MCP source markers must stay locally inspectable without exposing env or secret values.`,
    },
    {
      area: 'Model-visible setup and onboarding posture',
      total: setupPosture.modes + setupPosture.sources,
      localSignalVerified: setupPosture.availableModes + setupPosture.availableSources,
      localBehaviorVerified: setupPosture.availableModes + setupPosture.availableSources,
      externalOutcomeRequired: 0,
      notes: `${setupPosture.modes} agent_harness modes, setup_posture, setup_item, setup_checkpoint, mark_setup_checkpoint, clear_setup_checkpoint, provision_connected_host_token, and run_setup_smoke, and ${setupPosture.sources} setup/onboarding source markers must stay locally inspectable while confirmed setup effects avoid exposing secret values.`,
    },
    {
      area: 'Model-visible model routing posture',
      total: modelRouting.modes + modelRouting.sources,
      localSignalVerified: modelRouting.availableModes + modelRouting.availableSources,
      localBehaviorVerified: modelRouting.availableModes + modelRouting.availableSources,
      externalOutcomeRequired: 0,
      notes: `${modelRouting.modes} agent_harness modes, model_routing, model_route, run_local_model_smoke, and ${modelRouting.sources} provider/model source markers must stay locally inspectable while route changes stay visible user flows.`,
    },
    {
      area: 'Model-visible pairing posture',
      total: pairingPosture.modes + pairingPosture.sources,
      localSignalVerified: pairingPosture.availableModes + pairingPosture.availableSources,
      localBehaviorVerified: pairingPosture.availableModes + pairingPosture.availableSources,
      externalOutcomeRequired: 0,
      notes: `${pairingPosture.modes} agent_harness modes, pairing_posture and pairing_route, and ${pairingPosture.sources} pairing source markers must stay locally inspectable without returning raw tokens or QR payloads.`,
    },
    {
      area: 'Model-visible delegation posture',
      total: delegationPosture.modes + delegationPosture.sources,
      localSignalVerified: delegationPosture.availableModes + delegationPosture.availableSources,
      localBehaviorVerified: delegationPosture.availableModes + delegationPosture.availableSources,
      externalOutcomeRequired: 0,
      notes: `${delegationPosture.modes} agent_harness modes, delegation_posture and delegation_route, and ${delegationPosture.sources} delegation source markers must stay locally inspectable while delegated work submission remains an explicit visible flow.`,
    },
    {
      area: 'Model-visible security and support bundles',
      total: securitySupport.modes + securitySupport.sources,
      localSignalVerified: securitySupport.availableModes + securitySupport.availableSources,
      localBehaviorVerified: securitySupport.availableModes + securitySupport.availableSources,
      externalOutcomeRequired: 0,
      notes: `${securitySupport.modes} agent_harness modes, security_posture, security_finding, support_bundles, and support_bundle, and ${securitySupport.sources} security/support source markers must stay locally inspectable without exposing token, secret, or raw config values.`,
    },
    {
      area: 'Model-visible voice and media posture',
      total: mediaPosture.modes + mediaPosture.sources,
      localSignalVerified: mediaPosture.availableModes + mediaPosture.availableSources,
      localBehaviorVerified: mediaPosture.availableModes + mediaPosture.availableSources,
      externalOutcomeRequired: 0,
      notes: `${mediaPosture.modes} agent_harness modes, media_posture and media_provider, and ${mediaPosture.sources} voice/media source markers must stay locally inspectable without exposing secret values or media payloads.`,
    },
    {
      area: 'Model-visible sessions and bookmarks',
      total: sessionSurface.modes + sessionSurface.sources,
      localSignalVerified: sessionSurface.availableModes + sessionSurface.availableSources,
      localBehaviorVerified: sessionSurface.availableModes + sessionSurface.availableSources,
      externalOutcomeRequired: 0,
      notes: `${sessionSurface.modes} agent_harness modes, sessions and session, and ${sessionSurface.sources} session/bookmark source markers must stay locally inspectable while save/resume/export/delete/bookmark writes stay visible user flows.`,
    },
    {
      area: 'Model-visible operator method catalog',
      total: operatorMethods.modes + operatorMethods.sources,
      localSignalVerified: operatorMethods.availableModes + operatorMethods.availableSources,
      localBehaviorVerified: operatorMethods.availableModes + operatorMethods.availableSources,
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
