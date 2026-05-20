import { createAgentRuntimeServices, type AgentRuntimeServices } from './services.js';

export interface AgentBootstrapContext {
  readonly services: AgentRuntimeServices;
  readonly startedAt: number;
}

export function bootstrapAgentRuntime(): AgentBootstrapContext {
  return {
    services: createAgentRuntimeServices(),
    startedAt: Date.now(),
  };
}
