import { describe, expect, test } from 'bun:test';
import { renderCompletion } from '../../cli/completion.ts';
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

    expect(help).not.toContain('tasks                      ');
    expect(help).toContain('profiles                   Manage isolated Agent profile homes');
    expect(help).toContain('routines                   Inspect local routines and explicitly promote one to an external schedule');
    expect(help).toContain('auth                       Inspect Agent auth posture and external runtime token state');
    expect(help).not.toContain('capabilities               ');
    expect(help).not.toContain('auth add-user');
    expect(help).not.toContain('clear-bootstrap');
    expect(help).toContain('--agent-profile <name>');
    expect(help).not.toContain('tasks submit <prompt>');
    expect(help).not.toContain('submit a non-interactive task');
  });

  test('shell completion advertises product commands instead of runtime lifecycle commands', () => {
    const completion = renderCompletion('bash', 'goodvibes-agent');

    expect(completion).toContain('tui');
    expect(completion).toContain('profiles');
    expect(completion).toContain('knowledge');
    expect(completion).toContain('delegate');
    expect(completion).not.toContain(' serve ');
    expect(completion).not.toContain(' service ');
    expect(completion).not.toContain(' surfaces ');
    expect(completion).not.toContain(' listener ');
    expect(completion).not.toContain(' control-plane ');
    expect(completion).not.toContain('--daemon-home');
    expect(completion).not.toContain('--hostname');
    expect(completion).not.toContain('--port');
  });

  test('profiles command help explains isolated profile homes', () => {
    const help = renderGoodVibesCommandHelp('profiles');
    expect(help).toContain('isolated Agent profile homes');
    expect(help).toContain('--agent-profile');
    expect(help).toContain('shared GoodVibes runtime');
  });

  test('routines command help explains explicit external schedule promotion', () => {
    const help = renderGoodVibesCommandHelp('routines');
    expect(help).toContain('promote <id>');
    expect(help).toContain('routines receipts');
    expect(help).toContain('routines reconcile');
    expect(help).toContain('--delivery-channel');
    expect(help).not.toContain('--delivery-surface');
    expect(help).toContain('--delivery-webhook');
    expect(help).toContain('GoodVibes schedule');
    expect(help).toContain('Without --yes');
  });

  test('auth help keeps runtime user administration external', () => {
    const help = renderGoodVibesCommandHelp('auth');
    expect(help).toContain('external runtime token state');
    expect(help).toContain('runtime-owning TUI or host tooling');
    expect(help).not.toContain('auth add-user');
    expect(help).not.toContain('auth clear-bootstrap');
  });

  test('package-facing help uses the Agent executable for command guidance', () => {
    const help = [
      renderGoodVibesHelp(),
      renderGoodVibesCommandHelp('subscription'),
      renderGoodVibesCommandHelp('bundle'),
    ].join('\n');

    expect(help).toContain('goodvibes-agent subscription login openai start --open');
    expect(help).toContain('goodvibes-agent bundle export goodvibes-agent-bundle.json');
    expect(help).not.toContain('Usage: goodvibes subscription');
    expect(help).not.toContain('next: goodvibes subscription');
    expect(help).not.toContain('Usage: goodvibes bundle');
  });
});
