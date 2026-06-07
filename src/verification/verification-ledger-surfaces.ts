import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const READINESS_PATH = join('release', 'release-readiness.json');
const RELEASE_EVIDENCE_PATHS = [
  'release/release-notes.md',
  'release/performance-snapshot.json',
  'release/release-readiness.json',
  'release/live-verification/live-verification.json',
  'release/live-verification/live-verification.md',
] as const;
const QUALITY_DIMENSIONS = [
  'capabilityCoverage',
  'userAccess',
  'modelAccess',
  'safetyBoundary',
  'releaseEvidence',
] as const;

const HARNESS_RELEASE_EVIDENCE_MODES = ['release_evidence', 'release_evidence_artifact'] as const;
const HARNESS_SERVICE_POSTURE_MODES = ['service_posture', 'service_endpoint'] as const;
const HARNESS_CHANNEL_READINESS_MODES = ['channels', 'channel', 'channel_setup_guide', 'channel_deliveries'] as const;
const HARNESS_NOTIFICATION_TARGET_MODES = ['notifications', 'notification_target'] as const;
const HARNESS_PROVIDER_ACCOUNT_MODES = ['provider_accounts', 'provider_account'] as const;
const HARNESS_MCP_SERVER_MODES = ['mcp_servers', 'mcp_server'] as const;
const HARNESS_SETUP_POSTURE_MODES = [
  'setup_posture',
  'setup_item',
  'setup_checkpoint',
  'mark_setup_checkpoint',
  'clear_setup_checkpoint',
  'provision_connected_host_token',
  'run_setup_smoke',
] as const;
const HARNESS_MODEL_ROUTING_MODES = ['model_routing', 'model_route'] as const;
const HARNESS_PAIRING_POSTURE_MODES = ['pairing_posture', 'pairing_route'] as const;
const HARNESS_DELEGATION_POSTURE_MODES = ['delegation_posture', 'delegation_route'] as const;
const HARNESS_SECURITY_SUPPORT_MODES = ['security_posture', 'security_finding', 'support_bundles', 'support_bundle'] as const;
const HARNESS_MEDIA_POSTURE_MODES = ['media_posture', 'media_provider'] as const;
const HARNESS_SESSION_MODES = ['sessions', 'session'] as const;
const HARNESS_OPERATOR_METHOD_MODES = ['operator_methods', 'operator_method'] as const;
const HARNESS_MODE_CATALOG_MODES = ['modes', 'mode'] as const;
const HARNESS_MODE_CATALOG_SOURCE_MARKERS = [
  'export const HARNESS_MODE_DESCRIPTORS',
  'export function listHarnessModes',
  'export function describeHarnessMode',
  'function harnessModeMatchesSearch',
] as const;
const HARNESS_MODE_CATALOG_DISPATCH_MARKERS = [
  'harnessModes: HARNESS_MODE_DESCRIPTORS.length',
  "if (args.mode === 'modes')",
  "if (args.mode === 'mode')",
  'modeCatalog:',
] as const;
const HARNESS_MODE_CATALOG_MARKERS = [
  ...HARNESS_MODE_CATALOG_SOURCE_MARKERS,
  ...HARNESS_MODE_CATALOG_DISPATCH_MARKERS,
] as const;

export interface CountedSourceSurface {
  readonly modes: number;
  readonly availableModes: number;
  readonly sources: number;
  readonly availableSources: number;
}

export interface CountedReleaseEvidenceSurface {
  readonly artifacts: number;
  readonly availableArtifacts: number;
  readonly modes: number;
  readonly availableModes: number;
}

export interface CountedServicePostureSurface {
  readonly modes: number;
  readonly availableModes: number;
  readonly endpointIds: number;
  readonly availableEndpointIds: number;
}

export interface CountedChannelReadinessSurface {
  readonly modes: number;
  readonly availableModes: number;
  readonly channelIds: number;
  readonly availableChannelIds: number;
}

export interface CountedQualityReadinessDimensions {
  readonly items: number;
  readonly dimensions: number;
  readonly completeDimensions: number;
  readonly blockerItems: number;
}

export interface CountedHarnessModeCatalogSurface {
  readonly modes: number;
  readonly availableModes: number;
  readonly descriptors: number;
  readonly availableDescriptors: number;
  readonly behaviorMarkers: number;
  readonly availableBehaviorMarkers: number;
}

function listHarnessModeSchemaIds(root: string): readonly string[] {
  try {
    const schemaSource = readFileSync(join(root, 'src', 'tools', 'agent-harness-tool-schema.ts'), 'utf8');
    const match = /export const AGENT_HARNESS_MODES = \[([\s\S]*?)\] as const;/.exec(schemaSource);
    if (!match) return [];
    return [...match[1]!.matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]!).sort();
  } catch {
    return [];
  }
}

function listHarnessModeDescriptorIds(root: string): readonly string[] {
  try {
    const source = readFileSync(join(root, 'src', 'tools', 'agent-harness-mode-catalog.ts'), 'utf8');
    const match = /const HARNESS_MODE_DESCRIPTORS:[\s\S]*?\] as const;/.exec(source);
    if (!match) return [];
    return [...match[0].matchAll(/\bid:\s*'([a-z_]+)'/g)].map((entry) => entry[1]!).sort();
  } catch {
    return [];
  }
}

function countHarnessModes(root: string, modes: readonly string[]): number {
  const schemaIds = new Set(listHarnessModeSchemaIds(root));
  return modes.filter((mode) => schemaIds.has(mode)).length;
}

function countSourceMarkers(root: string, relativePath: string, markers: readonly string[]): number {
  try {
    const source = readFileSync(join(root, relativePath), 'utf8');
    return markers.filter((marker) => source.includes(marker)).length;
  } catch {
    return 0;
  }
}

function countHarnessSourceSurface(
  root: string,
  modes: readonly string[],
  sourcePath: string,
  markers: readonly string[],
): CountedSourceSurface {
  return {
    modes: modes.length,
    availableModes: countHarnessModes(root, modes),
    sources: markers.length,
    availableSources: countSourceMarkers(root, sourcePath, markers),
  };
}

export function countQualityReadinessDimensions(root: string): CountedQualityReadinessDimensions {
  const fallback = { items: 0, dimensions: 0, completeDimensions: 0, blockerItems: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, READINESS_PATH), 'utf8')) as unknown;
  } catch {
    return fallback;
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { items?: unknown }).items)) {
    return fallback;
  }
  const items = (parsed as { items: readonly unknown[] }).items;
  let completeDimensions = 0;
  let blockerItems = 0;
  for (const item of items) {
    if (typeof item !== 'object' || item === null) {
      blockerItems += 1;
      continue;
    }
    const record = item as Record<string, unknown>;
    const status = typeof record.status === 'string' ? record.status : '';
    if (status === 'gap' || status === 'unknown') blockerItems += 1;
    const quality = typeof record.quality === 'object' && record.quality !== null
      ? record.quality as Record<string, unknown>
      : {};
    for (const dimension of QUALITY_DIMENSIONS) {
      const value = quality[dimension];
      if (typeof value === 'string' && value.trim().length > 0 && !/\b(?:unknown|todo|gap|unverified|unproven)\b/i.test(value)) {
        completeDimensions += 1;
      }
    }
  }
  return {
    items: items.length,
    dimensions: items.length * QUALITY_DIMENSIONS.length,
    completeDimensions,
    blockerItems,
  };
}

export function countReleaseEvidenceSurface(root: string): CountedReleaseEvidenceSurface {
  const availableArtifacts = RELEASE_EVIDENCE_PATHS
    .filter((path) => {
      const absolutePath = join(root, path);
      return existsSync(absolutePath) && statSync(absolutePath).size > 0;
    })
    .length;
  return {
    artifacts: RELEASE_EVIDENCE_PATHS.length,
    availableArtifacts,
    modes: HARNESS_RELEASE_EVIDENCE_MODES.length,
    availableModes: countHarnessModes(root, HARNESS_RELEASE_EVIDENCE_MODES),
  };
}

export function countServicePostureSurface(root: string): CountedServicePostureSurface {
  const endpointIds = ['controlPlane', 'httpListener', 'web'] as const;
  return {
    modes: HARNESS_SERVICE_POSTURE_MODES.length,
    availableModes: countHarnessModes(root, HARNESS_SERVICE_POSTURE_MODES),
    endpointIds: endpointIds.length,
    availableEndpointIds: countSourceMarkers(root, 'src/tools/agent-harness-service-posture.ts', endpointIds),
  };
}

export function countChannelReadinessSurface(root: string): CountedChannelReadinessSurface {
  const channelIds = [
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
  let availableChannelIds = 0;
  try {
    const source = readFileSync(join(root, 'src', 'input', 'agent-workspace-channels.ts'), 'utf8');
    availableChannelIds = channelIds.filter((channelId) => source.includes(`id: '${channelId}'`)).length;
  } catch {
    availableChannelIds = 0;
  }
  return {
    modes: HARNESS_CHANNEL_READINESS_MODES.length,
    availableModes: countHarnessModes(root, HARNESS_CHANNEL_READINESS_MODES),
    channelIds: channelIds.length,
    availableChannelIds,
  };
}

export function countNotificationTargetSurface(root: string): CountedSourceSurface {
  return countHarnessSourceSurface(root, HARNESS_NOTIFICATION_TARGET_MODES, 'src/tools/agent-harness-notification-metadata.ts', ['notifications.webhookUrls', 'agent_notify', '/notify list']);
}

export function countProviderAccountSurface(root: string): CountedSourceSurface {
  return countHarnessSourceSurface(root, HARNESS_PROVIDER_ACCOUNT_MODES, 'src/tools/agent-harness-provider-account-metadata.ts', ['buildProviderAccountSnapshot', '/accounts review', '/subscription inspect']);
}

export function countMcpServerSurface(root: string): CountedSourceSurface {
  return countHarnessSourceSurface(root, HARNESS_MCP_SERVER_MODES, 'src/tools/agent-harness-mcp-metadata.ts', ['listServerSecurity', '/mcp review', '/mcp tools']);
}

export function countSetupPostureSurface(root: string): CountedSourceSurface {
  return countHarnessSourceSurface(root, HARNESS_SETUP_POSTURE_MODES, 'src/tools/agent-harness-setup-posture.ts', ['collectOnboardingSnapshot', 'deriveStep1Capabilities', 'buildProviderAccountSnapshot']);
}

export function countModelRoutingSurface(root: string): CountedSourceSurface {
  return countHarnessSourceSurface(root, HARNESS_MODEL_ROUTING_MODES, 'src/tools/agent-harness-model-routing.ts', ['listModels', 'getFavorites', 'provider.reasoningEffort']);
}

export function countPairingPostureSurface(root: string): CountedSourceSurface {
  return countHarnessSourceSurface(root, HARNESS_PAIRING_POSTURE_MODES, 'src/tools/agent-harness-pairing-posture.ts', ['readConnectedHostOperatorToken', 'connectedHostOperatorTokenFingerprint', 'GOODVIBES_AGENT_PAIRING_SURFACE']);
}

export function countDelegationPostureSurface(root: string): CountedSourceSurface {
  return countHarnessSourceSurface(root, HARNESS_DELEGATION_POSTURE_MODES, 'src/tools/agent-harness-delegation-posture.ts', ['delegatedReviewPolicy', 'delegate-build-task', '/delegate --review']);
}

export function countSecuritySupportSurface(root: string): CountedSourceSurface {
  return countHarnessSourceSurface(root, HARNESS_SECURITY_SUPPORT_MODES, 'src/tools/agent-harness-security-posture.ts', ['buildMcpAttackPathReview', 'SUPPORT_BUNDLE_ROUTES', '/security tokens', '/trust review']);
}

export function countMediaPostureSurface(root: string): CountedSourceSurface {
  return countHarnessSourceSurface(root, HARNESS_MEDIA_POSTURE_MODES, 'src/tools/agent-harness-media-posture.ts', ['buildAgentWorkspaceVoiceMediaReadiness', 'agent_media_generate', 'tts.provider']);
}

export function countSessionSurface(root: string): CountedSourceSurface {
  return countHarnessSourceSurface(root, HARNESS_SESSION_MODES, 'src/tools/agent-harness-session-metadata.ts', ['sessionManager', 'bookmarkManager', '/session export']);
}

export function countOperatorMethodSurface(root: string): CountedSourceSurface {
  return countHarnessSourceSurface(root, HARNESS_OPERATOR_METHOD_MODES, 'src/tools/agent-harness-operator-methods.ts', ['getOperatorContract', 'agent_operator_method', 'confirmed-admin-connected-host-state']);
}

export function countHarnessModeCatalogSurface(root: string): CountedHarnessModeCatalogSurface {
  const schemaIds = listHarnessModeSchemaIds(root);
  const descriptorIds = new Set(listHarnessModeDescriptorIds(root));
  const availableDescriptors = schemaIds.filter((id) => descriptorIds.has(id)).length;
  return {
    modes: HARNESS_MODE_CATALOG_MODES.length,
    availableModes: countHarnessModes(root, HARNESS_MODE_CATALOG_MODES),
    descriptors: schemaIds.length,
    availableDescriptors,
    behaviorMarkers: HARNESS_MODE_CATALOG_MARKERS.length,
    availableBehaviorMarkers:
      countSourceMarkers(root, 'src/tools/agent-harness-mode-catalog.ts', HARNESS_MODE_CATALOG_SOURCE_MARKERS) +
      countSourceMarkers(root, 'src/tools/agent-harness-tool.ts', HARNESS_MODE_CATALOG_DISPATCH_MARKERS),
  };
}
