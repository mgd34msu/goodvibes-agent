import { describe, expect, test } from 'bun:test';
import type { ChatRequest, ChatResponse, LLMProvider } from '@pellux/goodvibes-sdk/platform/providers';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import {
  createAgentModelCompareTool,
  registerAgentModelCompareTool,
  type AgentModelCompareCatalogModel,
} from '../../tools/agent-model-compare-tool.ts';

class CompareTestProvider implements LLMProvider {
  readonly models: string[];
  readonly calls: ChatRequest[] = [];

  constructor(
    readonly name: string,
    modelId: string,
    private readonly content: string,
  ) {
    this.models = [modelId];
  }

  async chat(params: ChatRequest): Promise<ChatResponse> {
    this.calls.push(params);
    return {
      content: this.content,
      toolCalls: [],
      usage: { inputTokens: 11, outputTokens: 7 },
      stopReason: 'completed',
    };
  }
}

function fixture() {
  const models: AgentModelCompareCatalogModel[] = [
    {
      modelId: 'gpt-4.1',
      providerId: 'openai',
      registryKey: 'openai:gpt-4.1',
      displayName: 'GPT-4.1',
      selectable: true,
      current: true,
    },
    {
      modelId: 'claude-sonnet',
      providerId: 'anthropic',
      registryKey: 'anthropic:claude-sonnet',
      displayName: 'Claude Sonnet',
      selectable: true,
    },
  ];
  const openai = new CompareTestProvider('openai', 'gpt-4.1', 'Candidate A style answer.');
  const anthropic = new CompareTestProvider('anthropic', 'claude-sonnet', 'Candidate B style answer.');
  const providers = new Map<string, CompareTestProvider>([
    ['openai', openai],
    ['anthropic', anthropic],
  ]);
  const recordedUsage: string[] = [];
  const tool = createAgentModelCompareTool({
    modelCatalog: {
      listModels: () => models,
      getCurrentModel: () => models[0]!,
      recordModelUsage: async (registryKey) => {
        recordedUsage.push(registryKey);
      },
    },
    providerRegistry: {
      getForModel: (modelId, providerId) => {
        const provider = providers.get(providerId ?? '');
        if (!provider || !provider.models.includes(modelId)) throw new Error(`Unknown model ${providerId}:${modelId}`);
        return provider;
      },
    },
  });

  return {
    anthropic,
    openai,
    recordedUsage,
    tool,
  };
}

describe('agent_model_compare tool', () => {
  test('previews without calling providers when confirmation is missing', async () => {
    const item = fixture();

    const result = await item.tool.execute({
      mode: 'run',
      prompt: 'Compare release note drafts.',
      confirm: false,
      explicitUserRequest: 'Compare release notes.',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Agent blind model comparison preview');
    expect(result.error).toContain('confirmation required');
    expect(item.openai.calls).toEqual([]);
    expect(item.anthropic.calls).toEqual([]);
  });

  test('runs identical prompts and hides identities until reveal', async () => {
    const item = fixture();

    const result = await item.tool.execute({
      mode: 'run',
      prompt: 'Write a concise product update.',
      modelRefs: ['openai:gpt-4.1', 'anthropic:claude-sonnet'],
      rubric: 'Prefer accurate, user-facing phrasing.',
      confirm: true,
      explicitUserRequest: 'Compare product update drafts.',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Candidate A');
    expect(result.output).toContain('Candidate B');
    expect(result.output).toContain('Identities hidden');
    expect(result.output).not.toContain('openai:gpt-4.1');
    expect(result.output).not.toContain('anthropic:claude-sonnet');
    expect(item.openai.calls[0]?.messages).toEqual(item.anthropic.calls[0]?.messages);
    expect(item.openai.calls[0]?.messages[0]).toEqual({ role: 'user', content: 'Write a concise product update.' });
    expect(item.recordedUsage.sort()).toEqual(['anthropic:claude-sonnet', 'openai:gpt-4.1']);

    const comparisonId = result.output.match(/cmp_[0-9a-f-]+/)?.[0];
    expect(comparisonId).toBeTruthy();

    const reveal = await item.tool.execute({
      mode: 'reveal',
      comparisonId,
    });
    expect(reveal.success).toBe(true);
    expect(reveal.output).toContain('A: openai:gpt-4.1 (GPT-4.1)');
    expect(reveal.output).toContain('B: anthropic:claude-sonnet (Claude Sonnet)');
  });

  test('can reveal identities immediately when explicitly requested', async () => {
    const item = fixture();

    const result = await item.tool.execute({
      mode: 'run',
      prompt: 'Write a concise product update.',
      candidateCount: 2,
      reveal: true,
      confirm: true,
      explicitUserRequest: 'Compare product update drafts and reveal now.',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Reveal');
    expect(result.output).toContain('A: openai:gpt-4.1 (GPT-4.1)');
    expect(result.output).toContain('No selected model was changed.');
  });

  test('is registered in the model tool registry', () => {
    const item = fixture();
    const registry = new ToolRegistry();

    registerAgentModelCompareTool(registry, {
      modelCatalog: {
        listModels: () => [],
      },
      providerRegistry: {
        getForModel: () => item.openai,
      },
    });

    expect(registry.has('agent_model_compare')).toBe(true);
  });
});
