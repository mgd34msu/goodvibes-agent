import type { CliCommandRuntime } from './management.ts';
import { buildCliServicePosture, formatCliServicePosture } from './service-posture.ts';
import type { CliCommandOutput } from './types.ts';

export async function handleServiceCommand(runtime: CliCommandRuntime): Promise<CliCommandOutput> {
  const [sub = 'status'] = runtime.cli.commandArgs;
  const json = runtime.cli.flags.outputFormat === 'json';
  if (sub === 'status' || sub === 'check') {
    const posture = await buildCliServicePosture(runtime, { probe: sub === 'check' });
    return {
      output: formatCliServicePosture(posture, json),
      exitCode: sub === 'check' && posture.issues.length > 0 ? 1 : 0,
    };
  }
  if (sub === 'install' || sub === 'start' || sub === 'restart' || sub === 'stop' || sub === 'uninstall') {
    const text = 'GoodVibes Agent connects to an existing GoodVibes runtime and does not manage runtime lifecycle. Use GoodVibes TUI or host tooling for service mutations.';
    return {
      output: json ? JSON.stringify({ ok: false, kind: 'daemon_lifecycle_external', action: sub, error: text }, null, 2) : text,
      exitCode: 2,
    };
  }
  return {
    output: `Usage: ${runtime.cli.binary} service [status|check]`,
    exitCode: 2,
  };
}
