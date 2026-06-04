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
    expect(harness?.description).toBe('Harness catalog/control. Start with mode:"modes"; inspect settings, commands, UI, status, tools, and confirmed effects.');
    expect(custom?.description.length).toBeLessThanOrEqual(120);

    const parametersJson = JSON.stringify(custom?.parameters);
    expect(parametersJson).toContain('"target"');
    expect(parametersJson).toContain('"required":["target"]');
    expect(parametersJson).not.toContain('"description"');
  });
});
