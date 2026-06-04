import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { ToolDefinition } from '@pellux/goodvibes-sdk/platform/types';

const DEFAULT_TOOL_DESCRIPTION_LIMIT = 120;

const TOOL_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = {
  agent_harness: 'Harness catalog/control. Start with mode:"modes"; inspect settings, commands, UI, status, tools, and confirmed effects.',
  agent_knowledge: 'Read isolated Agent Knowledge.',
  agent_knowledge_ingest: 'Ingest one confirmed source into isolated Agent Knowledge.',
  agent_local_registry: 'Inspect or update Agent-local memory, notes, personas, skills, bundles, and routines.',
  agent_work_plan: 'Inspect or update the visible Agent-local work plan.',
  agent_operator_briefing: 'Read connected Agent operator state.',
  agent_operator_action: 'Run one confirmed allowlisted operator action.',
  agent_reminder_schedule: 'Schedule one confirmed Agent reminder.',
  agent_channel_send: 'Send one confirmed message through one configured Agent target.',
  agent_notify: 'Send one confirmed plain-text notification.',
  agent_media_generate: 'Generate one confirmed image or video artifact.',
};

function compactText(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  if (limit <= 3) return normalized.slice(0, limit);
  return `${normalized.slice(0, limit - 3).trimEnd()}...`;
}

function stripSchemaDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSchemaDescriptions);
  if (!value || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'description') continue;
    result[key] = stripSchemaDescriptions(entry);
  }
  return result;
}

function compactToolDefinition(definition: ToolDefinition): void {
  definition.description = TOOL_DESCRIPTION_OVERRIDES[definition.name]
    ?? compactText(definition.description, DEFAULT_TOOL_DESCRIPTION_LIMIT);
  definition.parameters = stripSchemaDescriptions(definition.parameters) as Record<string, unknown>;
}

export function compactRegisteredToolDefinitions(toolRegistry: ToolRegistry): void {
  for (const definition of toolRegistry.getToolDefinitions()) {
    compactToolDefinition(definition);
  }
}
