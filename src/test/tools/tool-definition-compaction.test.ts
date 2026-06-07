import { describe, expect, test } from 'bun:test';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { compactRegisteredToolDefinitions } from '../../tools/tool-definition-compaction.ts';

function makeTool(name: string, description: string): Tool {
  return {
    definition: {
      name,
      description,
      parameters: {
        type: 'object',
        description: 'Top-level schema description that should not be model-visible after compaction.',
        properties: {
          target: {
            type: 'string',
            description: 'Long parameter description that should be discoverable through harness detail, not repeated in every model request.',
          },
          nested: {
            type: 'object',
            description: 'Nested schema description that should also be stripped.',
            properties: {
              value: {
                type: 'string',
                description: 'Nested value description.',
              },
            },
          },
        },
        required: ['target'],
        additionalProperties: false,
      },
    },
    execute: async () => ({ success: true, output: 'ok' }),
  };
}

describe('compactRegisteredToolDefinitions', () => {
  test('uses curated summaries for platform and Agent tools', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('read', 'Verbose read tool description that should never reach the model catalog.'));
    registry.register(makeTool('goodvibes_context', 'Verbose runtime context description that should never reach the model catalog.'));
    registry.register(makeTool('setup', 'Verbose setup tool description that should never reach the model catalog.'));
    registry.register(makeTool('vibe', 'Verbose VIBE.md personality description that should never reach the model catalog.'));
    registry.register(makeTool('agent_local_registry', 'Verbose local registry description that should never reach the model catalog.'));
    registry.register(makeTool('agent_review_packet_presets', 'Verbose review packet preset description that should never reach the model catalog.'));

    compactRegisteredToolDefinitions(registry);

    const descriptions = new Map(registry.getToolDefinitions().map((definition) => [definition.name, definition.description]));
    expect(descriptions.get('read')).toBe('Read files, outlines, symbols, and ranges.');
    expect(descriptions.get('goodvibes_context')).toBe('Inspect current GoodVibes runtime and host harness.');
    expect(descriptions.get('setup')).toBe('Inspect and complete first-run Agent setup.');
    expect(descriptions.get('vibe')).toBe('Inspect/create/import VIBE.md personality.');
    expect(descriptions.get('agent_local_registry')).toBe('Inspect/update Agent memory, notes, skills, routines.');
    expect(descriptions.get('agent_review_packet_presets')).toBe('Save/list/refresh Document Ops packet presets.');
    for (const description of descriptions.values()) {
      expect(description.length).toBeLessThanOrEqual(56);
      expect(description).not.toContain('...');
    }
  });

  test('keeps model-visible tool definitions compact while preserving schema shape', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('agent_harness', 'This description is replaced by the Agent-specific harness override.'));
    registry.register(makeTool(
      'custom_long_description',
      'This custom tool description is intentionally verbose so the compaction pass has to shorten it before the model receives the registered tool catalog.',
    ));

    compactRegisteredToolDefinitions(registry);

    const definitions = registry.getToolDefinitions();
    const harness = definitions.find((definition) => definition.name === 'agent_harness');
    const custom = definitions.find((definition) => definition.name === 'custom_long_description');
    expect(harness?.description).toBe('Harness catalog: modes, settings, commands, UI, tools.');
    expect(harness?.description.length).toBeLessThanOrEqual(56);
    expect(custom?.description.length).toBeLessThanOrEqual(56);

    const parametersJson = JSON.stringify(custom?.parameters);
    expect(parametersJson).toContain('"target"');
    expect(parametersJson).toContain('"required":["target"]');
    expect(parametersJson).not.toContain('"description"');
  });
});
