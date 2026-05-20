import { loadAgentConfig, type AgentConfig } from '../config.js';
import { AssistantRuntime } from '../assistant/runtime.js';
import { GoodVibesDaemonClient } from '../daemon/client.js';
import { MemoryStore } from '../store/memory.js';
import { PersonaStore } from '../store/personas.js';
import { SkillStore } from '../store/skills.js';

export interface AgentRuntimeServices {
  readonly config: AgentConfig;
  readonly daemon: GoodVibesDaemonClient;
  readonly memory: MemoryStore;
  readonly personas: PersonaStore;
  readonly skills: SkillStore;
  readonly assistant: AssistantRuntime;
}

export function createAgentRuntimeServices(config: AgentConfig = loadAgentConfig()): AgentRuntimeServices {
  const daemon = new GoodVibesDaemonClient(config);
  const assistant = new AssistantRuntime({ config, client: daemon });
  return {
    config,
    daemon,
    memory: assistant.memory,
    personas: assistant.personas,
    skills: assistant.skills,
    assistant,
  };
}
