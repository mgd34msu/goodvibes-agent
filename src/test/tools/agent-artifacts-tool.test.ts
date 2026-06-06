import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  test('exports exact artifact bytes to a validated workspace path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-artifact-export-'));
    try {
      const store = new ArtifactBrowserTestStore();
      const bytes = Buffer.from([0, 1, 2, 3, 255]);
      store.add({
        id: 'artifact-image',
        kind: 'image',
        mimeType: 'image/png',
        filename: 'generated.png',
        buffer: bytes,
      });
      const tool = createAgentArtifactsTool(store, { projectRoot: root });

      const exported = await tool.execute({
        mode: 'export',
        artifactId: 'artifact-image',
        destinationPath: 'exports/generated.png',
        confirm: true,
        explicitUserRequest: 'Export the generated image artifact.',
      });

      expect(exported.success).toBe(true);
      expect(exported.output).toContain('Exported Agent artifact');
      expect(exported.output).toContain('artifact artifact-image');
      expect(exported.output).toContain('content not printed');
      expect(readFileSync(join(root, 'exports', 'generated.png'))).toEqual(bytes);

      const existing = await tool.execute({
        mode: 'export',
        artifactId: 'artifact-image',
        destinationPath: 'exports/generated.png',
        confirm: true,
        explicitUserRequest: 'Export the generated image artifact again.',
      });
      expect(existing.success).toBe(false);
      expect(existing.error).toContain('already exists');

      const overwritten = await tool.execute({
        mode: 'export',
        artifactId: 'artifact-image',
        destinationPath: 'exports/generated.png',
        overwrite: true,
        confirm: true,
        explicitUserRequest: 'Replace the generated image export.',
      });
      expect(overwritten.success).toBe(true);
      expect(overwritten.output).toContain('overwrite yes');
      expect(readFileSync(join(root, 'exports', 'generated.png'))).toEqual(bytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('requires confirmation and rejects artifact export outside the workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-artifact-export-'));
    try {
      const store = new ArtifactBrowserTestStore();
      store.add({ id: 'artifact-text', text: 'body' });
      const tool = createAgentArtifactsTool(store, { projectRoot: root });

      const unconfirmed = await tool.execute({
        mode: 'export',
        artifactId: 'artifact-text',
        destinationPath: 'exports/body.txt',
        explicitUserRequest: 'Export the text artifact.',
      });
      expect(unconfirmed.success).toBe(false);
      expect(unconfirmed.error).toContain('confirm:true');

      const escaped = await tool.execute({
        mode: 'export',
        artifactId: 'artifact-text',
        destinationPath: '../escaped.txt',
        confirm: true,
        explicitUserRequest: 'Export the text artifact.',
      });
      expect(escaped.success).toBe(false);
      expect(escaped.error).toContain('outside the project root');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
