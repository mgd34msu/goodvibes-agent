import type { AgentConfig } from '../config.js';

export interface ProviderModelSelection {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly modelRegistryKey?: string | undefined;
  readonly display: string;
}

export function resolveProviderModel(config: AgentConfig): ProviderModelSelection {
  const provider = normalizeOptional(config.provider);
  const registryKey = normalizeOptional(config.model);
  const model = registryKey ? stripModelProviderPrefix(registryKey) : undefined;
  return {
    provider,
    model,
    modelRegistryKey: registryKey,
    display: `${provider ?? 'daemon-default'}/${model ?? registryKey ?? 'daemon-default'}`,
  };
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function stripModelProviderPrefix(model: string): string {
  const colonIndex = model.indexOf(':');
  if (colonIndex < 0) return model;
  const stripped = model.slice(colonIndex + 1).trim();
  return stripped || model;
}
