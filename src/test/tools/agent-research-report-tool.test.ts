import { describe, expect, test } from 'bun:test';
import type { ArtifactCreateInput, ArtifactDescriptor, ArtifactRecord, ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { createAgentResearchReportTool, registerAgentResearchReportTool } from '../../tools/agent-research-report-tool.ts';

class ResearchReportArtifactStore implements Pick<ArtifactStore, 'create'> {
  readonly records: ArtifactRecord[] = [];
  readonly contents = new Map<string, string>();

  async create(input: ArtifactCreateInput): Promise<ArtifactDescriptor> {
    const id = `artifact-${this.records.length + 1}`;
    const text = input.text ?? '';
    const record: ArtifactRecord = {
      id,
      kind: input.kind ?? 'document',
      mimeType: input.mimeType,
      ...(input.filename ? { filename: input.filename } : {}),
      sizeBytes: Buffer.byteLength(text, 'utf-8'),
      sha256: `sha-${id}`,
      createdAt: Date.now(),
      acquisitionMode: input.acquisitionMode ?? 'inline-data',
      fetchMode: input.fetchMode ?? 'not-applicable',
      metadata: input.metadata ?? {},
      contentPath: `/tmp/${id}.md`,
      metadataPath: `/tmp/${id}.json`,
    };
    this.records.push(record);
    this.contents.set(id, text);
    return record;
  }
}

describe('agent_research_report tool', () => {
  test('saves a sourced markdown report artifact without printing report content', async () => {
    const store = new ResearchReportArtifactStore();
    const tool = createAgentResearchReportTool(store);

    const result = await tool.execute({
      title: 'Local Model Options',
      question: 'Which local model serving route should this user try first?',
      summary: 'Ollama is easiest; vLLM is throughput-oriented.',
      reportMarkdown: 'Ollama is easiest for first setup [S1].\n\nvLLM fits throughput-heavy use [S2].',
      sources: [
        {
          title: 'Ollama docs',
          url: 'https://example.test/ollama?token=secret-token',
          credibility: 'high',
          note: 'Official setup docs.',
        },
        'vLLM docs | https://example.test/vllm | medium | Project docs.',
      ],
      findings: ['Use Ollama for first local route.'],
      gaps: ['Benchmark after setup.'],
      recommendations: ['Offer a hardware-aware setup checklist.'],
      methodology: 'Compared official setup paths and operational complexity.',
      confidence: 'medium',
      tags: ['research', 'local-models'],
      confirm: true,
      explicitUserRequest: 'Save the reviewed local model research report.',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Saved Agent research report artifact');
    expect(result.output).toContain('artifact artifact-1');
    expect(result.output).toContain('sources 2');
    expect(result.output).toContain('citationCoverage 2/2 cited; uncited 0; unknown 0');
    expect(result.output).not.toContain('Ollama is easiest for first setup');
    expect(result.output).not.toContain('secret-token');

    const record = store.records[0];
    expect(record?.filename).toBe('local-model-options.md');
    expect(record?.metadata).toMatchObject({
      purpose: 'agent-research-report',
      source: 'agent-research-report',
      title: 'Local Model Options',
      question: 'Which local model serving route should this user try first?',
      confidence: 'medium',
      tags: ['research', 'local-models'],
      sourceCount: 2,
      citationCoverage: {
        sourceCount: 2,
        citedSourceIds: ['S1', 'S2'],
        missingSourceIds: [],
        unknownCitationIds: [],
        repairSuggestions: [],
        coverageRatio: 1,
        pass: true,
      },
    });
    const sources = record?.metadata.sources as Array<{ readonly url?: string }>;
    expect(sources[0]?.url).toContain('token=%3Credacted%3E');
    const content = store.contents.get('artifact-1') ?? '';
    expect(content).toContain('# Local Model Options');
    expect(content).toContain('## Citation Coverage');
    expect(content).toContain('Cited in body: S1, S2');
    expect(content).toContain('Repair suggestions: (none)');
    expect(content).toContain('## Source Map');
    expect(content).toContain('[S1] Ollama docs');
    expect(content).toContain('token=%3Credacted%3E');
    expect(content).not.toContain('secret-token');
  });

  test('requires confirmation and at least one reviewed source', async () => {
    const store = new ResearchReportArtifactStore();
    const tool = createAgentResearchReportTool(store);

    const unconfirmed = await tool.execute({
      title: 'Report',
      question: 'What happened?',
      summary: 'A concise answer.',
      sources: [{ title: 'Source', url: 'https://example.test', credibility: 'high' }],
      explicitUserRequest: 'Save the report.',
    });
    expect(unconfirmed.success).toBe(false);
    expect(unconfirmed.error).toContain('confirm:true');
    expect(store.records).toHaveLength(0);

    const unsourced = await tool.execute({
      title: 'Report',
      question: 'What happened?',
      summary: 'A concise answer.',
      sources: [],
      confirm: true,
      explicitUserRequest: 'Save the report.',
    });
    expect(unsourced.success).toBe(false);
    expect(unsourced.error).toContain('reviewed source');
  });

  test('records citation coverage warnings and can enforce complete body citations', async () => {
    const store = new ResearchReportArtifactStore();
    const tool = createAgentResearchReportTool(store);

    const loose = await tool.execute({
      title: 'Coverage Warnings',
      question: 'Are sources cited?',
      summary: 'Only one source is cited [S1], and one unknown citation appears [S3].',
      sources: [
        { title: 'Source one', url: 'https://example.test/one', credibility: 'high' },
        { title: 'Source two', url: 'https://example.test/two', credibility: 'medium' },
      ],
      confirm: true,
      explicitUserRequest: 'Save the report with coverage metadata.',
    });
    expect(loose.success).toBe(true);
    expect(loose.output).toContain('citationCoverage 1/2 cited; uncited 1; unknown 1');
    expect(loose.output).toContain('citationRepair Add body citation for S2 (Source two). Replace or remove unknown citation S3. Valid source ids are S1-S2.');
    expect(store.records[0]?.metadata).toMatchObject({
      citationCoverage: {
        sourceCount: 2,
        citedSourceIds: ['S1'],
        missingSourceIds: ['S2'],
        unknownCitationIds: ['S3'],
        repairSuggestions: [
          'Add body citation for S2 (Source two).',
          'Replace or remove unknown citation S3. Valid source ids are S1-S2.',
        ],
        coverageRatio: 0.5,
        pass: false,
      },
    });

    const strict = await tool.execute({
      title: 'Strict Coverage',
      question: 'Are sources cited?',
      summary: 'Only one source is cited [S1].',
      sources: [
        { title: 'Source one', url: 'https://example.test/one', credibility: 'high' },
        { title: 'Source two', url: 'https://example.test/two', credibility: 'medium' },
      ],
      requireCitationCoverage: true,
      confirm: true,
      explicitUserRequest: 'Save only if every source is cited.',
    });
    expect(strict.success).toBe(false);
    expect(strict.error).toContain('Citation coverage check failed');
    expect(strict.error).toContain('Missing body citations: S2');
    expect(strict.error).toContain('Repair suggestions: Add body citation for S2 (Source two).');
  });

  test('fails clearly without an artifact store and registers with the tool registry', async () => {
    const unavailable = await createAgentResearchReportTool().execute({
      title: 'Report',
      question: 'What happened?',
      summary: 'A concise answer.',
      sources: [{ title: 'Source', url: 'https://example.test', credibility: 'high' }],
      confirm: true,
      explicitUserRequest: 'Save the report.',
    });
    expect(unavailable.success).toBe(false);
    expect(unavailable.error).toContain('artifact store');

    const registry = new ToolRegistry();
    registerAgentResearchReportTool(registry, new ResearchReportArtifactStore());
    expect(registry.has('agent_research_report')).toBe(true);
  });
});
