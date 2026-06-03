import type { ConfigManager, PersistedFlagState } from '../config/index.ts';
import { surfaceFeatureGateId } from '@/runtime/index.ts';

export const CONTROL_PLANE_FEATURE_FLAG = 'control-plane-gateway';
export const ROUTE_BINDING_FEATURE_FLAG = 'route-binding';
export const DELIVERY_ENGINE_FEATURE_FLAG = 'delivery-engine';
export const SERVICE_MANAGEMENT_FEATURE_FLAG = 'service-management';

const CORE_CHANNEL_FEATURE_FLAGS = [
  CONTROL_PLANE_FEATURE_FLAG,
  ROUTE_BINDING_FEATURE_FLAG,
  DELIVERY_ENGINE_FEATURE_FLAG,
] as const;

export type FeatureFlagConfigKey = 'featureFlags' | `featureFlags.${string}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isFeatureFlagConfigKey(key: string): key is FeatureFlagConfigKey {
  return key === 'featureFlags' || key.startsWith('featureFlags.');
}

function isPersistedFlagState(value: unknown): value is PersistedFlagState {
  return value === 'enabled' || value === 'disabled';
}

export function readFeatureFlagConfigValue(config: Pick<ConfigManager, 'getCategory'>, key: FeatureFlagConfigKey): unknown {
  const flags = config.getCategory('featureFlags');
  if (key === 'featureFlags') return flags;
  return flags[key.slice('featureFlags.'.length)];
}

export function mergeFeatureFlagConfigValue(config: Pick<ConfigManager, 'mergeCategory'>, key: FeatureFlagConfigKey, value: unknown): void {
  if (key === 'featureFlags') {
    if (!isRecord(value)) throw new Error('featureFlags expects an object value.');
    const patch: Partial<Record<string, PersistedFlagState>> = {};
    for (const [flagId, state] of Object.entries(value)) {
      if (!isPersistedFlagState(state)) throw new Error(`featureFlags.${flagId} expects enabled or disabled.`);
      patch[flagId] = state;
    }
    config.mergeCategory('featureFlags', patch);
    return;
  }

  if (!isPersistedFlagState(value)) throw new Error(`${key} expects enabled or disabled.`);
  config.mergeCategory('featureFlags', {
    [key.slice('featureFlags.'.length)]: value,
  });
}

export function getSurfaceFeatureFlag(surfaceId: string): string | null {
  return surfaceFeatureGateId(surfaceId);
}

export function getServerSurfaceFeatureFlags(options: {
  readonly serverBacked?: boolean;
  readonly web?: boolean;
  readonly externalSurfaces?: readonly string[];
}): readonly string[] {
  const flags = new Set<string>();
  const hasExternalSurfaces = (options.externalSurfaces?.length ?? 0) > 0;

  if (options.serverBacked || options.web || hasExternalSurfaces) {
    flags.add(CONTROL_PLANE_FEATURE_FLAG);
    flags.add(SERVICE_MANAGEMENT_FEATURE_FLAG);
  }
  if (options.web) {
    const webFlag = getSurfaceFeatureFlag('web');
    if (webFlag) flags.add(webFlag);
  }

  if (hasExternalSurfaces) {
    for (const flag of CORE_CHANNEL_FEATURE_FLAGS) flags.add(flag);
    for (const surfaceId of options.externalSurfaces ?? []) {
      const surfaceFlag = getSurfaceFeatureFlag(surfaceId);
      if (surfaceFlag) flags.add(surfaceFlag);
    }
  }

  return [...flags].sort((left, right) => left.localeCompare(right));
}

export function isFeatureFlagEnabled(config: Pick<ConfigManager, 'getCategory'>, flagId: string): boolean {
  const flags = config.getCategory('featureFlags');
  return flags[flagId] === 'enabled';
}

export function getMissingSurfaceFeatureFlags(config: Pick<ConfigManager, 'getCategory'>, surfaceId: string): readonly string[] {
  const required = surfaceId === 'web'
    ? getServerSurfaceFeatureFlags({ web: true })
    : getServerSurfaceFeatureFlags({ externalSurfaces: [surfaceId] });
  return required.filter((flagId) => !isFeatureFlagEnabled(config, flagId));
}

export function enableFeatureFlags(config: Pick<ConfigManager, 'mergeCategory'>, flagIds: readonly string[]): void {
  const patch = Object.fromEntries(flagIds.map((flagId) => [flagId, 'enabled'] as const));
  config.mergeCategory('featureFlags', patch);
}
