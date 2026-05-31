import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentPersonaRegistry, buildActivePersonaPrompt } from '../../agent/persona-registry.ts';
import { createShellPathService } from '@/runtime/index.ts';

function tempRegistry(): { readonly registry: AgentPersonaRegistry; readonly paths: ReturnType<typeof createShellPathService> } {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-personas-'));
  const paths = createShellPathService({ workingDirectory: root, homeDirectory: root });
  return { registry: AgentPersonaRegistry.fromShellPaths(paths), paths };
}

describe('AgentPersonaRegistry', () => {
  test('creates, activates, reviews, marks stale, and deletes local personas', () => {
    const { registry } = tempRegistry();
    const persona = registry.create({
      name: 'Research Analyst',
      description: 'Careful source-backed research behavior.',
      body: 'Prefer source-backed concise answers and track unknowns.',
      tags: ['research', 'careful', 'research'],
      triggers: ['research tasks'],
      source: 'user',
      provenance: 'test',
    });

    expect(persona.id).toBe('research-analyst');
    expect(persona.tags).toEqual(['research', 'careful']);
    expect(registry.list()).toHaveLength(1);

    const active = registry.setActive('research-analyst');
    expect(active.name).toBe('Research Analyst');
    expect(registry.snapshot().activePersona?.id).toBe('research-analyst');

    expect(registry.markReviewed('Research Analyst').reviewState).toBe('reviewed');
    const stale = registry.markStale('research-analyst', 'Needs updated source policy.');
    expect(stale.reviewState).toBe('stale');
    expect(stale.staleReason).toContain('updated source');

    const removed = registry.deletePersona('research-analyst');
    expect(removed.id).toBe('research-analyst');
    expect(registry.snapshot().activePersona).toBeNull();
    expect(registry.list()).toHaveLength(0);
  });

  test('rejects duplicates and secret-looking persona content', () => {
    const { registry } = tempRegistry();
    registry.create({
      name: 'Ops Helper',
      description: 'Operational triage behavior.',
      body: 'Inspect status first and keep changes explicit.',
    });

    expect(() => registry.create({
      name: 'ops helper',
      description: 'Duplicate.',
      body: 'Duplicate.',
    })).toThrow('Persona already exists');

    expect(() => registry.create({
      name: 'Secret Holder',
      description: 'Do not allow secret text.',
      body: 'token=super-secret-value',
    })).toThrow('secret-looking');
  });

  test('builds active persona prompt without default or non-Agent knowledge coupling', () => {
    const { registry, paths } = tempRegistry();
    registry.create({
      name: 'Home Operator',
      description: 'Acts as a calm personal operator.',
      body: 'Keep work serial and ask before destructive actions.',
    });
    registry.setActive('home-operator');

    const prompt = buildActivePersonaPrompt(paths);

    expect(prompt).toContain('Active GoodVibes Agent Persona');
    expect(prompt).toContain('Home Operator');
    expect(prompt).toContain('same serial assistant conversation');
    expect(prompt).not.toContain('/api/knowledge');
    expect(prompt).not.toContain('non-Agent knowledge fallback');
  });
});
