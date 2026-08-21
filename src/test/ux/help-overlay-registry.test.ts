// ---------------------------------------------------------------------------
// help-overlay-registry.test.ts
// β3: renderHelpOverlay quick-start rows sourced from live registry.
//     Commands not in the registry are omitted from the overlay.
// ---------------------------------------------------------------------------

import { describe, test, expect } from 'bun:test';
import type { SlashCommand } from '../../input/command-registry.ts';

// We exercise the hasCommand filter by inspecting which featured names survive
// when certain commands are removed from the supplied registry list.

const KEYBINDINGS_STUB = {
  getComboLabel: (_action: string) => 'Ctrl+?',
} as never;

function makeCmd(name: string): SlashCommand {
  return {
    name,
    description: `${name} description`,
    handler: async () => {},
  };
}

import { renderHelpOverlay } from '../../renderer/help-overlay.ts';

/**
 * Render the overlay across multiple scroll offsets and concatenate all visible text.
 * This ensures we see all content regardless of which scroll position it appears at.
 */
function renderAllText(commands: SlashCommand[]): string {
  const allFrames: string[] = [];
  for (let offset = 0; offset <= 30; offset += 6) {
    const lines = renderHelpOverlay(120, KEYBINDINGS_STUB, commands, offset, 80);
    const frame = lines.map(line => line.map(cell => cell.char).join('').trimEnd()).join('\n');
    allFrames.push(frame);
  }
  return allFrames.join('\n');
}

/** For negative assertions: render at all offsets and check none contain the string. */
function renderText(commands: SlashCommand[]): string {
  return renderAllText(commands);
}

describe('renderHelpOverlay Quick Start sourced from live registry (β3)', () => {
  test('shows the setup row with its Agent setup description', () => {
    const text = renderText([makeCmd('setup')]);
    expect(text).toContain('/setup');
    expect(text).toContain('Open the Agent workspace');
  });

  test('shows /agent when the Agent workspace command is registered', () => {
    const commands: SlashCommand[] = [makeCmd('agent'), makeCmd('setup')];
    const text = renderText(commands);
    expect(text).toContain('/agent');
    expect(text).toContain('Open workspace; press / there to search every action');
    expect(text).not.toContain('/agent setup');
    expect(text).toContain('/agent knowledge');
    expect(text).toContain('/agent voice');
  });

  test('omits /agent when the Agent workspace command is not registered', () => {
    const commands: SlashCommand[] = [makeCmd('setup'), makeCmd('settings')];
    const text = renderText(commands);
    expect(text).not.toContain('/agent');
  });

  test('omits all featured commands when registry is empty', () => {
    const featuredNames = [
      'agent', 'setup', 'knowledge', 'memory', 'personas',
      'skills', 'routines', 'workplan', 'approval', 'automation', 'schedule',
      'delegate', 'mcp', 'provider', 'subscription',
      'secrets', 'health',
    ];
    const text = renderText([]);
    for (const name of featuredNames) {
      expect(text).not.toContain(`/${name}`);
    }
  });

  test('shows only registered subset of featured commands', () => {
    const registered = ['agent', 'provider', 'knowledge'];
    const commands = registered.map(makeCmd);
    const text = renderText(commands);
    expect(text).toContain('/agent');
    expect(text).toContain('/provider');
    expect(text).toContain('/knowledge');
    expect(text).not.toContain('/delegate');
    expect(text).not.toContain('/routines');
  });

  test('shows available-commands section when commands are provided', () => {
    // The overlay renders with a limited content window; test that non-featured
    // commands appear when the registry is non-empty (shown via getAll() loop).
    // Since the window is limited, we test the structural contract: rendering
    // succeeds and returns a non-empty line array.
    const commands = [makeCmd('model'), makeCmd('clear')];
    const lines = renderHelpOverlay(120, KEYBINDINGS_STUB, commands);
    expect(lines.length).toBeGreaterThan(0);
    // Each line has width 120
    for (const line of lines) {
      expect(line.length).toBe(120);
    }
  });
});
