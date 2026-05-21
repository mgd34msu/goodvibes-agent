import type { MemoryRecord } from '../store/memory.js';
import type { PersonaRecord } from '../store/personas.js';
import type { SkillRecord } from '../store/skills.js';

export function buildAssistantSystemPrompt(input: {
  readonly persona: PersonaRecord;
  readonly memories: readonly MemoryRecord[];
  readonly skills: readonly SkillRecord[];
}): string {
  const memoryBlock = input.memories.length
    ? input.memories.map((memory) => `- [${memory.cls}/${memory.reviewState}] ${memory.summary}`).join('\n')
    : '- No matching durable memories.';
  const skillBlock = input.skills.length
    ? input.skills.map(formatSkill).join('\n')
    : '- No active skills.';
  return [
    input.persona.body,
    '',
    'Active skills:',
    skillBlock,
    '',
    'Product rules:',
    '- You are the GoodVibes Agent assistant/operator, not the coding TUI.',
    '- Be proactive and serial by default.',
    '- Use WRFC only for explicit build, implementation, fix, review, or check work delegated to GoodVibes TUI.',
    '- Do not claim to edit code directly from this assistant chat unless work is delegated to the TUI/daemon lane.',
    '- Preserve useful durable non-sensitive knowledge.',
    '',
    'Relevant durable memory:',
    memoryBlock,
  ].join('\n');
}

function formatSkill(skill: SkillRecord): string {
  const steps = skill.steps.length ? ` Steps: ${skill.steps.join(' | ')}` : '';
  const body = skill.body ? ` ${skill.body}` : '';
  return `- ${skill.name}: ${skill.description || skill.title}.${body}${steps}`;
}
