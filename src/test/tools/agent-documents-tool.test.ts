import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import { createShellPathService } from '@/runtime/index.ts';
import { AgentDocumentRegistry } from '../../agent/document-registry.ts';
import { createAgentDocumentsTool, registerAgentDocumentsTool } from '../../tools/agent-documents-tool.ts';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-documents-tool-'));
  const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
  const artifactStore = new ArtifactStore({ rootDir: join(root, 'artifacts') });
  const tool = createAgentDocumentsTool(shellPaths, artifactStore);
  const documents = AgentDocumentRegistry.fromShellPaths(shellPaths);
  return { root, shellPaths, artifactStore, tool, documents };
}

describe('agent_documents tool', () => {
  test('refuses document writes without explicit confirmation', async () => {
    const { tool, documents } = fixture();
    const result = await tool.execute({
      mode: 'create',
      title: 'Unconfirmed Draft',
      body: 'This should not be saved.',
      explicitUserRequest: 'Create a document draft.',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires confirm:true');
    expect(documents.list()).toHaveLength(0);
  });

  test('creates, revises, lists, shows, reviews, and exports versioned drafts', async () => {
    const { artifactStore, tool } = fixture();
    const create = await tool.execute({
      mode: 'create',
      title: 'Launch Plan',
      body: 'Initial launch draft.',
      tags: ['launch', 'docs'],
      confirm: true,
      explicitUserRequest: 'Create a launch plan document draft.',
    });
    expect(create.success).toBe(true);
    expect(create.output).toContain('Created Agent document');
    expect(create.output).toContain('id launch-plan');

    const update = await tool.execute({
      mode: 'update',
      documentId: 'launch-plan',
      body: 'Initial launch draft.\n\nAdd rollout checklist.',
      changeSummary: 'Added rollout checklist.',
      confirm: true,
      explicitUserRequest: 'Revise the launch plan document draft.',
    });
    expect(update.success).toBe(true);
    expect(update.output).toContain('versions 2');

    const list = await tool.execute({ mode: 'list', query: 'rollout' });
    expect(list.success).toBe(true);
    expect(list.output).toContain('launch-plan');
    expect(list.output).toContain('versions 2');

    const show = await tool.execute({ mode: 'show', documentId: 'launch-plan', includeVersions: true });
    expect(show.success).toBe(true);
    expect(show.output).toContain('Add rollout checklist.');
    expect(show.output).toContain('v2');

    const review = await tool.execute({
      mode: 'review',
      documentId: 'launch-plan',
      confirm: true,
      explicitUserRequest: 'Mark the launch plan reviewed.',
    });
    expect(review.success).toBe(true);
    expect(review.output).toContain('status reviewed');

    const exported = await tool.execute({
      mode: 'export',
      documentId: 'launch-plan',
      confirm: true,
      explicitUserRequest: 'Export the reviewed launch plan as an artifact.',
    });
    expect(exported.success).toBe(true);
    expect(exported.output).toContain('Exported Agent document');
    expect(exported.output).toContain('artifact artifact-');
    const artifact = artifactStore.list(5)[0];
    expect(artifact?.metadata).toMatchObject({
      purpose: 'agent-document-export',
      source: 'agent-documents',
      documentId: 'launch-plan',
      status: 'reviewed',
    });
  });

  test('registers in the model tool registry', () => {
    const { shellPaths, artifactStore } = fixture();
    const registry = new ToolRegistry();
    registerAgentDocumentsTool(registry, shellPaths, artifactStore);
    expect(registry.getToolDefinitions().some((definition) => definition.name === 'agent_documents')).toBe(true);
  });
});
