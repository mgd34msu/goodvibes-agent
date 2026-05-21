import { describe, expect, test } from 'bun:test';
import { renderHelp } from '../src/cli/help.js';

describe('CLI help', () => {
  test('groups operator commands by workflow', () => {
    const help = renderHelp();

    expect(help).toContain('Daemon and config');
    expect(help).toContain('goodvibes-agent compat');
    expect(help).not.toContain('goodvibes-agent sdk');
    expect(help).toContain('Assistant work');
    expect(help).toContain('Local memory, skills, and personas');
    expect(help).toContain('Delegation and explicit mutations');
    expect(help).toContain('Normal chat uses companion.chat');
    expect(help).toContain('goodvibes-agent automation run|pause|resume <job-id> --yes');
  });
});
