import { describe, expect, test } from 'bun:test';
import type { ArtifactDescriptor, ArtifactRecord, ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { createAgentArtifactsTool, registerAgentArtifactsTool } from '../../tools/agent-artifacts-tool.ts';

class ArtifactBrowserTestStore implements Partial<Pick<ArtifactStore, 'get' | 'list' | 'readContent'>> {
  readonly records: ArtifactRecord[] = [];
  readonly contents = new Map<string, Buffer>();

  add(input: {
    readonly id: string;
    readonly kind?: ArtifactDescriptor['kind'];
    readonly mimeType?: string;
    readonly filename?: string;
    readonly text?: string;
    readonly buffer?: Buffer;
    readonly createdAt?: number;
    readonly metadata?: Record<string, unknown>;
    readonly sourceUri?: string;
  }): ArtifactRecord {
    const buffer = input.buffer ?? Buffer.from(input.text ?? '', 'utf-8');
    const record: ArtifactRecord = {
      id: input.id,
      kind: input.kind ?? 'data',
      mimeType: input.mimeType ?? 'text/plain',
      ...(input.filename ? { filename: input.filename } : {}),
      sizeBytes: buffer.byteLength,
      sha256: `sha-${input.id}`,
      createdAt: input.createdAt ?? Date.now(),
      ...(input.sourceUri ? { sourceUri: input.sourceUri } : {}),
      acquisitionMode: 'inline-data',
      fetchMode: 'not-applicable',
      metadata: input.metadata ?? {},
      contentPath: `/tmp/${input.id}.data`,
      metadataPath: `/tmp/${input.id}.json`,
    };
    this.records.push(record);
    this.contents.set(record.id, buffer);
    return record;
  }

  list(limit = 100): ArtifactDescriptor[] {
    return [...this.records]
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  get(id: string): ArtifactDescriptor | null {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async readContent(id: string): Promise<{ record: ArtifactRecord; buffer: Buffer }> {
    const record = this.records.find((entry) => entry.id === id);
    const buffer = this.contents.get(id);
    if (!record || !buffer) throw new Error(`Unknown artifact: ${id}`);
    return { record, buffer };
  }
}

describe('agent_artifacts tool', () => {
  test('lists saved artifacts with filters and redacted metadata search', async () => {
    const store = new ArtifactBrowserTestStore();
    store.add({
      id: 'artifact-alpha',
      filename: 'blind-model-comparison-cmp-1.json',
      mimeType: 'application/json',
      text: '{"ok":true}',
      createdAt: 2,
      metadata: {
        purpose: 'agent-model-compare',
        source: 'agent-model-compare',
        secretToken: 'should-not-print',
      },
    });
    store.add({
      id: 'artifact-beta',
      filename: 'generated.png',
      kind: 'image',
      mimeType: 'image/png',
      buffer: Buffer.from([1, 2, 3]),
      createdAt: 1,
      metadata: { purpose: 'agent-media-generation', source: 'agent-media-generation' },
    });
    const tool = createAgentArtifactsTool(store);

    const result = await tool.execute({
      mode: 'list',
      purpose: 'model-compare',
      limit: 5,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Agent artifact browser');
    expect(result.output).toContain('artifact-alpha');
    expect(result.output).not.toContain('artifact-beta');
    expect(result.output).toContain('agent_artifacts mode:"show" artifactId:"artifact-alpha"');
    expect(result.output).not.toContain('should-not-print');
  });

  test('shows one text artifact with bounded preview and redacted metadata', async () => {
    const store = new ArtifactBrowserTestStore();
    store.add({
      id: 'artifact-text',
      filename: 'report.md',
      mimeType: 'text/markdown',
      text: 'First line\nSecond line\nThird line',
      metadata: {
        purpose: 'agent-model-compare-export',
        apiKey: 'secret-value',
      },
    });
    const tool = createAgentArtifactsTool(store);

    const result = await tool.execute({
      mode: 'show',
      artifactId: 'artifact-text',
      includeContent: true,
      previewBytes: 12,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Agent artifact');
    expect(result.output).toContain('report.md');
    expect(result.output).toContain('"apiKey": "<redacted>"');
    expect(result.output).toContain('First line');
    expect(result.output).toContain('more)');
    expect(result.output).not.toContain('secret-value');
    expect(result.output).not.toContain('Second line');
  });

  test('does not inline binary artifact content', async () => {
    const store = new ArtifactBrowserTestStore();
    store.add({
      id: 'artifact-image',
      kind: 'image',
      mimeType: 'image/png',
      filename: 'generated.png',
      buffer: Buffer.from([137, 80, 78, 71]),
    });
    const tool = createAgentArtifactsTool(store);

    const result = await tool.execute({
      mode: 'show',
      artifactId: 'artifact-image',
      includeContent: true,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Content preview omitted for non-text MIME type image/png.');
    expect(result.output).not.toContain('iVBOR');
  });

  test('fails clearly without an artifact store and registers with the tool registry', async () => {
    const unavailable = await createAgentArtifactsTool().execute({ mode: 'list' });
    expect(unavailable.success).toBe(false);
    expect(unavailable.error).toContain('artifact store');

    const registry = new ToolRegistry();
    registerAgentArtifactsTool(registry, new ArtifactBrowserTestStore());
    expect(registry.has('agent_artifacts')).toBe(true);
  });
});
