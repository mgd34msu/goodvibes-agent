import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSkillRegistry, buildEnabledSkillsPrompt } from '../../agent/skill-registry.ts';
import { createShellPathService } from '@/runtime/index.ts';

function tempRegistry(): { readonly registry: AgentSkillRegistry; readonly paths: ReturnType<typeof createShellPathService> } {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-skills-'));
  const paths = createShellPathService({ workingDirectory: root, homeDirectory: root });
  return { registry: AgentSkillRegistry.fromShellPaths(paths), paths };
}

describe('AgentSkillRegistry', () => {
  test('creates, enables, reviews, marks stale, and deletes local skills', () => {
    const { registry } = tempRegistry();
    const skill = registry.create({
      name: 'Morning Brief',
      description: 'Prepare a concise daily briefing.',
      procedure: 'Check calendar, tasks, weather, and unresolved approvals before summarizing.',
      tags: ['daily', 'briefing', 'daily'],
      triggers: ['morning'],
    });

    expect(skill.id).toBe('morning-brief');
    expect(skill.tags).toEqual(['daily', 'briefing']);
    expect(registry.snapshot().enabledSkills).toHaveLength(0);

    expect(registry.setEnabled('morning-brief', true).enabled).toBe(true);
    expect(registry.snapshot().enabledSkills).toHaveLength(1);
    expect(registry.markReviewed('Morning Brief').reviewState).toBe('reviewed');
    expect(registry.markStale('morning-brief', 'Needs a new approval section.').staleReason).toContain('approval');
    expect(registry.deleteSkill('morning-brief').id).toBe('morning-brief');
    expect(registry.list()).toHaveLength(0);
  });

  test('rejects duplicates and secret-looking procedure content', () => {
    const { registry } = tempRegistry();
    registry.create({
      name: 'Status Review',
      description: 'Review visible daemon status.',
      procedure: 'Inspect status and report concise warnings.',
    });

    expect(() => registry.create({
      name: 'status review',
      description: 'Duplicate.',
      procedure: 'Duplicate.',
    })).toThrow('Skill already exists');

    expect(() => registry.create({
      name: 'Secret Skill',
      description: 'Invalid.',
      procedure: 'password=hunter2-value',
    })).toThrow('secret-looking');
  });

  test('builds enabled skill prompt without default or non-Agent knowledge coupling', () => {
    const { registry, paths } = tempRegistry();
    registry.create({
      name: 'Approval Review',
      description: 'Summarize pending approvals.',
      procedure: 'Use read-only approval routes first and ask before approve or deny.',
      triggers: ['approval', 'pending request'],
      enabled: true,
    });

    const prompt = buildEnabledSkillsPrompt(paths);

    expect(prompt).toContain('Enabled GoodVibes Agent Skills');
    expect(prompt).toContain('Approval Review');
    expect(prompt).toContain('same serial assistant conversation');
    expect(prompt).not.toContain('/api/knowledge');
    expect(prompt).not.toContain('non-Agent knowledge fallback');
  });
});
