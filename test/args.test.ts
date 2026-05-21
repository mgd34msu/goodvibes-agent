import { describe, expect, test } from 'bun:test';
import { getText, hasFlag, parseArgs } from '../src/cli/args.js';

describe('CLI argument parsing', () => {
  test('keeps boolean flags from consuming the following positional text', () => {
    const ask = parseArgs(['ask', '--json', 'What is GoodVibes Agent?']);
    expect(ask.command).toBe('ask');
    expect(hasFlag(ask, 'json')).toBe(true);
    expect(getText(ask)).toBe('What is GoodVibes Agent?');

    const delegate = parseArgs(['delegate', '--wrfc', 'Build a task inbox']);
    expect(delegate.command).toBe('delegate');
    expect(hasFlag(delegate, 'wrfc')).toBe(true);
    expect(getText(delegate)).toBe('Build a task inbox');
  });

  test('keeps value flags for command options', () => {
    const memory = parseArgs(['memory', 'add', 'Use Bun', '--class', 'constraint']);
    expect(getText(memory)).toBe('add Use Bun');
    expect(memory.flags.get('class')).toBe('constraint');
  });
});
