import { describe, expect, test } from 'bun:test';
import { renderGoodVibesCommandHelp, renderGoodVibesHelp, renderGoodVibesVersion } from '../../cli/help.ts';

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
    expect(help).toContain('capabilities               Show OpenClaw/Hermes benchmark and live daemon coverage');
    expect(help).toContain('profiles                   Manage isolated Agent runtime profile homes');
    expect(help).toContain('routines                   Inspect local routines and explicitly promote one to a daemon schedule');
    expect(help).toContain('--agent-profile <name>');
    expect(help).not.toContain('tasks submit <prompt>');
    expect(help).not.toContain('submit a non-interactive task');
  });

  test('profiles command help explains isolated profile homes', () => {
    const help = renderGoodVibesCommandHelp('profiles');
    expect(help).toContain('isolated Agent runtime profile homes');
    expect(help).toContain('--agent-profile');
    expect(help).toContain('externally owned daemon');
  });

  test('routines command help explains explicit daemon schedule promotion', () => {
    const help = renderGoodVibesCommandHelp('routines');
    expect(help).toContain('promote <id>');
    expect(help).toContain('routines receipts');
    expect(help).toContain('routines reconcile');
    expect(help).toContain('--delivery-surface');
    expect(help).toContain('--delivery-webhook');
    expect(help).toContain('external daemon schedule');
    expect(help).toContain('Without --yes');
  });
});
