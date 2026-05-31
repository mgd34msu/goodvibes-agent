import { describe, expect, test } from 'bun:test';
import { renderGoodVibesHelp, renderGoodVibesVersion } from '../../cli/help.ts';

describe('CLI help/version', () => {
  test('does not report the consuming project npm_package_version', () => {
    const previous = process.env.npm_package_version;
    process.env.npm_package_version = '1.0.0';

    try {
      expect(renderGoodVibesVersion()).not.toBe('goodvibes 1.0.0');
    } finally {
      if (previous === undefined) {
        delete process.env.npm_package_version;
      } else {
        process.env.npm_package_version = previous;
      }
    }
  });

  test('does not advertise copied runtime task submission as an Agent workflow', () => {
    const help = renderGoodVibesHelp();

    expect(help).toContain('tasks                      List/show in-process runtime tasks (read-only)');
    expect(help).not.toContain('tasks submit <prompt>');
    expect(help).not.toContain('submit a non-interactive task');
  });
});
