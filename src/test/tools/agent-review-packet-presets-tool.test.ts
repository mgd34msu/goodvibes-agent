import { describe, expect, test } from 'bun:test';
import type { ArtifactCreateInput, ArtifactDescriptor, ArtifactRecord, ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import {
  createAgentReviewPacketPresetsTool,
  registerAgentReviewPacketPresetsTool,
} from '../../tools/agent-review-packet-presets-tool.ts';

function artifactStore() {
  const inputs: ArtifactCreateInput[] = [];
  const records: ArtifactRecord[] = [];
  const contents = new Map<string, Buffer>();
  const store: Pick<ArtifactStore, 'create' | 'list' | 'readContent'> = {
    async create(input: ArtifactCreateInput): Promise<ArtifactDescriptor> {
      inputs.push(input);
      const id = `artifact-${inputs.length}`;
      const buffer = Buffer.from(input.text ?? '', 'utf-8');
      const record: ArtifactRecord = {
        id,
        kind: input.kind ?? 'data',
        mimeType: input.mimeType ?? 'application/json',
        filename: input.filename,
        sizeBytes: buffer.byteLength,
        sha256: `sha-${inputs.length}`,
        createdAt: Date.now() + inputs.length,
        acquisitionMode: 'inline-data',
        fetchMode: 'not-applicable',
        metadata: input.metadata ?? {},
        contentPath: `/tmp/${id}.json`,
        metadataPath: `/tmp/${id}.metadata.json`,
      };
      records.push(record);
      contents.set(id, buffer);
      return record;
    },
    list(limit = 100): ArtifactDescriptor[] {
      return [...records].reverse().slice(0, limit);
    },
    async readContent(id: string): Promise<{ record: ArtifactRecord; buffer: Buffer }> {
      const record = records.find((entry) => entry.id === id);
      const buffer = contents.get(id);
      if (!record || !buffer) throw new Error(`Unknown artifact: ${id}`);
      return { record, buffer };
    },
  };
  return { inputs, records, store };
}

describe('agent_review_packet_presets tool', () => {
  test('previews preset saves until explicitly confirmed', async () => {
    const artifacts = artifactStore();
    const tool = createAgentReviewPacketPresetsTool(artifacts.store);

    const result = await tool.execute({
      mode: 'save',
      name: 'Launch review packet',
      documentId: 'doc_launch',
      revealedJudgmentArtifactId: 'artifact-judge',
      relatedArtifactIds: ['artifact-doc', 'artifact-route'],
      explicitUserRequest: 'Save this packet preset.',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Agent review packet preset preview');
    expect(result.error).toContain('confirmation required');
    expect(artifacts.inputs).toHaveLength(0);
  });

  test('saves, lists, and shows reusable review packet presets', async () => {
    const artifacts = artifactStore();
    const tool = createAgentReviewPacketPresetsTool(artifacts.store);

    const saved = await tool.execute({
      mode: 'save',
      name: 'Launch review packet',
      documentId: 'doc_launch',
      documentTitle: 'Launch Plan',
      documentExportArtifactId: 'artifact-doc',
      comparisonArtifactId: 'artifact-compare',
      judgmentArtifactId: 'artifact-judge-hidden',
      revealedJudgmentArtifactId: 'artifact-judge',
      routeDecisionArtifactId: 'artifact-route',
      routeDecision: 'left-unchanged',
      handoffArtifactId: 'artifact-handoff',
      handoffArchiveArtifactId: 'artifact-archive',
      relatedArtifactIds: ['artifact-doc', 'artifact-route'],
      summary: 'document doc_launch; source artifact-judge; handoff artifact-handoff; 2 related',
      confirm: true,
      explicitUserRequest: 'Save this packet preset.',
    });

    expect(saved.success).toBe(true);
    expect(saved.output).toContain('Review packet preset saved');
    expect(saved.output).toContain('agent_review_packet_presets mode:"show" artifactId:"artifact-1"');
    expect(artifacts.records[0]?.metadata).toMatchObject({
      purpose: 'agent-review-packet-preset',
      name: 'Launch review packet',
      documentId: 'doc_launch',
      revealedJudgmentArtifactId: 'artifact-judge',
      routeDecisionArtifactId: 'artifact-route',
      handoffArtifactId: 'artifact-handoff',
      handoffArchiveArtifactId: 'artifact-archive',
      relatedArtifactIds: ['artifact-doc', 'artifact-route'],
    });

    const stored = await artifacts.store.readContent('artifact-1');
    const body = JSON.parse(stored.buffer.toString('utf-8')) as {
      readonly schema: string;
      readonly policy: { readonly modelRouteChanged: boolean };
      readonly packet: { readonly documentId: string; readonly relatedArtifactIds: readonly string[] };
    };
    expect(body.schema).toBe('goodvibes-agent.review-packet-preset');
    expect(body.policy.modelRouteChanged).toBe(false);
    expect(body.packet.documentId).toBe('doc_launch');
    expect(body.packet.relatedArtifactIds).toEqual(['artifact-doc', 'artifact-route']);

    const listed = await tool.execute({ mode: 'list' });
    expect(listed.success).toBe(true);
    expect(listed.output).toContain('Launch review packet');
    expect(listed.output).toContain('artifact-handoff');

    const shown = await tool.execute({ mode: 'show', artifactId: 'artifact-1' });
    expect(shown.success).toBe(true);
    expect(shown.output).toContain('Saved review packet preset');
    expect(shown.output).toContain('sideBySide agent_model_compare mode:"sideBySide" artifactId:"artifact-judge"');
    expect(shown.output).toContain('handoff agent_model_compare mode:"handoff" artifactId:"artifact-judge"');
    expect(shown.output).toContain('routeDecision agent_model_compare mode:"routeDecision" artifactId:"artifact-judge"');
    expect(shown.output).toContain('archive agent_model_compare mode:"handoffArchive" artifactId:"artifact-handoff"');
  });

  test('registers the preset tool', () => {
    const registry = new ToolRegistry();
    registerAgentReviewPacketPresetsTool(registry, artifactStore().store);

    expect(registry.has('agent_review_packet_presets')).toBe(true);
  });
});
