#!/usr/bin/env bun
import {
  parseGoodVibesCli,
  renderGoodVibesDaemonHelp,
  renderGoodVibesVersion,
} from '../cli/index.ts';

function externalDaemonMessage(binary: string): string {
  return [
    `${binary} is disabled in GoodVibes Agent.`,
    'GoodVibes Agent connects to an already-running GoodVibes daemon and never starts, installs, restarts, or owns daemon/listener lifecycle.',
    'Start or manage the daemon from GoodVibes TUI or your daemon host tooling, then run goodvibes-agent against that external daemon.',
  ].join('\n');
}

async function main(): Promise<void> {
  const binary = 'goodvibes-daemon';
  const cli = parseGoodVibesCli(process.argv.slice(2), binary);

  if (cli.errors.length > 0) {
    console.error(cli.errors.join('\n'));
    console.error('');
    console.error(renderGoodVibesDaemonHelp(binary));
    process.exit(2);
  }

  if (cli.flags.help || cli.command === 'help') {
    console.log(renderGoodVibesDaemonHelp(binary));
    process.exit(0);
  }

  if (cli.flags.version || cli.command === 'version') {
    console.log(renderGoodVibesVersion('goodvibes-agent'));
    process.exit(0);
  }

  const message = externalDaemonMessage(binary);
  if (cli.flags.outputFormat === 'json') {
    console.log(JSON.stringify({
      ok: false,
      kind: 'daemon_lifecycle_external',
      command: binary,
      error: message,
    }, null, 2));
  } else {
    console.error(message);
  }
  process.exit(2);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
