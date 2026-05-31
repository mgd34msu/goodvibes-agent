import type { CliCommandOutput } from './types.ts';
import type { CliCommandRuntime } from './management.ts';
import {
  buildOperatorCapabilityBenchmarkReport,
  filterOperatorCapabilities,
  renderOperatorCapabilityBenchmark,
} from '../operator/capability-benchmark.ts';

function readCapabilityQuery(args: readonly string[]): string | undefined {
  const values = args.filter((arg) => !arg.startsWith('--'));
  return values.length > 0 ? values.join(' ') : undefined;
}

export async function handleCapabilitiesCommand(runtime: CliCommandRuntime): Promise<CliCommandOutput> {
  const query = readCapabilityQuery(runtime.cli.commandArgs);
  const report = buildOperatorCapabilityBenchmarkReport();
  const capabilities = filterOperatorCapabilities(report.capabilities, query);
  if (runtime.cli.flags.outputFormat === 'json') {
    return {
      output: JSON.stringify({ ...report, capabilities }, null, 2),
      exitCode: 0,
    };
  }
  return {
    output: renderOperatorCapabilityBenchmark(capabilities),
    exitCode: 0,
  };
}
