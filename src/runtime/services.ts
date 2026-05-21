import { loadAgentConfigWithMetadata, type AgentConfig, type AgentConfigMetadata } from '../config.js';
import { AssistantRuntime } from '../assistant/runtime.js';
import { GoodVibesDaemonClient } from '../daemon/client.js';
import { MemoryStore } from '../store/memory.js';
import { PersonaStore } from '../store/personas.js';
import { SkillStore } from '../store/skills.js';
import { DelegationReceiptStore } from '../store/delegations.js';
import { AssistantProfileStore } from '../store/profile.js';

export interface AgentRuntimeServices {
  readonly config: AgentConfig;
  readonly configMetadata: AgentConfigMetadata;
  readonly daemon: GoodVibesDaemonClient;
  readonly memory: MemoryStore;
  readonly personas: PersonaStore;
  readonly skills: SkillStore;
  readonly profile: AssistantProfileStore;
  readonly delegations: DelegationReceiptStore;
  readonly assistant: AssistantRuntime;
}

export function createAgentRuntimeServices(config?: AgentConfig): AgentRuntimeServices {
  const loaded = config
    ? { config, metadata: fallbackMetadata() }
    : loadAgentConfigWithMetadata();
  const resolvedConfig = loaded.config;
  const daemon = new GoodVibesDaemonClient(resolvedConfig);
  const assistant = new AssistantRuntime({ config: resolvedConfig, client: daemon });
  return {
    config: resolvedConfig,
    configMetadata: loaded.metadata,
    daemon,
    memory: assistant.memory,
    personas: assistant.personas,
    skills: assistant.skills,
    profile: assistant.profile,
    delegations: assistant.delegations,
    assistant,
  };
}

function fallbackMetadata(): AgentConfigMetadata {
  return {
    agentHome: '',
    configPath: '',
    configExists: false,
    baseUrlSource: 'default',
    token: { source: 'none', present: false },
  };
}
