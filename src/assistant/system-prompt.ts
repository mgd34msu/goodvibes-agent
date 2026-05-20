import type { MemoryRecord } from '../store/memory.js';
import type { PersonaRecord } from '../store/personas.js';

export function buildAssistantSystemPrompt(input: {
  readonly persona: PersonaRecord;
  readonly memories: readonly MemoryRecord[];
}): string {
  const memoryBlock = input.memories.length
    ? input.memories.map((memory) => `- [${memory.cls}/${memory.reviewState}] ${memory.summary}`).join('\n')
    : '- No matching durable memories.';
  return [
    input.persona.body,
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
