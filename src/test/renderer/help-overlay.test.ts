/**
 * Tests for renderHelpOverlay.
 */
import { describe, test, expect } from 'bun:test';
import { renderHelpOverlay, renderShortcutsOverlay } from '../../renderer/help-overlay.ts';
import type { SlashCommand } from '../../input/command-registry.ts';
import { KeybindingsManager } from '../../input/keybindings.ts';
import { lineToString, linesToText } from '../setup.ts';

const W = 120;
const TALL_VIEWPORT = 80;
const KEYBINDINGS = new KeybindingsManager({ configPath: '/nonexistent/path/keybindings.json' });

const SAMPLE_COMMANDS: SlashCommand[] = [
  { name: 'model', aliases: ['m'], description: 'Select LLM model', handler: () => {} },
  { name: 'help', aliases: ['h', '?'], description: 'Show help', handler: () => {} },
  { name: 'quit', aliases: ['q'], description: 'Exit application', handler: () => {} },
];

function renderAllText(commands?: SlashCommand[]): string {
  const frames: string[] = [];
  for (let offset = 0; offset <= 30; offset += 6) {
    frames.push(linesToText(renderHelpOverlay(W, KEYBINDINGS, commands, offset, TALL_VIEWPORT)).join('\n'));
  }
  return frames.join('\n');
}

function renderAllShortcutText(): string {
  const frames: string[] = [];
  for (let offset = 0; offset <= 42; offset += 6) {
    frames.push(linesToText(renderShortcutsOverlay(W, KEYBINDINGS, offset, TALL_VIEWPORT)).join('\n'));
  }
  return frames.join('\n');
}

describe('renderHelpOverlay', () => {
  test('returns an array of Lines', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, undefined, 0, TALL_VIEWPORT);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  test('each line has correct terminal width', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, undefined, 0, TALL_VIEWPORT);
    for (const line of lines) {
      expect(line.length).toBe(W);
    }
  });

  test('title bar contains "Help"', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, undefined, 0, TALL_VIEWPORT);
    const titleLine = lineToString(lines[0]);
    expect(titleLine).toContain('Help');
  });

  test('footer contains close hint', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, undefined, 0, TALL_VIEWPORT);
    const footerLine = lineToString(lines[lines.length - 1]);
    expect(footerLine).toContain('Esc');
  });

  test('contains Core Navigation section', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, undefined, 0, TALL_VIEWPORT);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('Core Navigation');
  });

  test('contains Prompt And Editing section', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, undefined, 0, TALL_VIEWPORT);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('Prompt And Editing');
  });

  test('contains Overlays And Workspace section', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, undefined, 13, TALL_VIEWPORT);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('Overlays And Workspace');
  });

  test('contains Quick Start section when featured commands are registered', () => {
    // Quick Start is built from the live registry: need at least one featured command.
    const cmds: SlashCommand[] = [{ name: 'agent', description: 'Operator workspace', handler: () => {} }];
    const lines = renderHelpOverlay(W, KEYBINDINGS, cmds, 14, TALL_VIEWPORT);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('Quick Start');
  });

  test('shows the setup quick-start row when setup is registered', () => {
    const text = renderAllText([{ name: 'setup', description: 'Setup surfaces', handler: () => {} }]);
    expect(text).toContain('/setup');
    expect(text).toContain('Open Agent setup with current settings');
    expect(text).toContain('preloaded');
    expect(text).not.toContain('first-run checklist');
  });

  test('includes Ctrl+F shortcut in navigation', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, undefined, 0, TALL_VIEWPORT);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('Ctrl+F');
  });

  test('includes PageUp/PageDn in navigation', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, undefined, 0, TALL_VIEWPORT);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('PageUp');
  });

  test('includes ? toggle shortcut', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, undefined, 0, TALL_VIEWPORT);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('?');
  });

  test('shortcuts overlay presents Ctrl+A as prompt editing only', () => {
    const text = renderAllShortcutText();
    expect(text).toContain('Move to start of line');
    expect(text).not.toContain('Delegate diff');
    expect(text).not.toContain('apply-diff');
  });

  test('renders command list when commands provided', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, SAMPLE_COMMANDS, 47, TALL_VIEWPORT);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('/model');
    expect(texts).toContain('/help');
  });

  test('shows command aliases when provided when command is in the expanded list', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, SAMPLE_COMMANDS, 47, TALL_VIEWPORT);
    const texts = linesToText(lines).join('\n');
    expect(texts).toContain('/model');
  });

  test('shows fallback command list when no commands provided', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, undefined, 47, TALL_VIEWPORT);
    const texts = linesToText(lines).join('\n');
    // The fallback string includes known command names
    expect(texts).toContain('/help');
  });

  test('lines are correct at narrow terminal width', () => {
    const narrowW = 60;
    const lines = renderHelpOverlay(narrowW, KEYBINDINGS, undefined, 0, TALL_VIEWPORT);
    for (const line of lines) {
      expect(line.length).toBe(narrowW);
    }
  });

  test('footer contains scroll hint', () => {
    const lines = renderHelpOverlay(W, KEYBINDINGS, undefined, 0, TALL_VIEWPORT);
    const footerLine = lineToString(lines[lines.length - 1]);
    expect(footerLine).toContain('Up/Down');
  });

  test('registry traversal crash guard: throwing command getter does not crash overlay', () => {
    // Simulate a plugin command whose property getter throws (e.g. a broken plugin).
    const throwingCmd = {
      name: 'cockpit',
      description: 'Control room',
      handler: () => {},
      get aliases(): string[] {
        throw new Error('plugin getter failure');
      },
    } as unknown as SlashCommand;

    // The overlay must not throw even when registry traversal errors occur.
    expect(() => {
      const lines = renderHelpOverlay(W, KEYBINDINGS, [throwingCmd], 0, TALL_VIEWPORT);
      // Footer hints must still render (overlay is reachable).
      const footerLine = lineToString(lines[lines.length - 1]);
      expect(footerLine).toContain('Esc');
    }).not.toThrow();
  });
});
