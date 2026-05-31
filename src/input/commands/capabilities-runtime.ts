import type { CommandRegistry } from '../command-registry.ts';
import {
  filterOperatorCapabilities,
  renderOperatorCapabilityBenchmark,
  OPERATOR_CAPABILITY_BENCHMARKS,
} from '../../operator/capability-benchmark.ts';

export function registerCapabilitiesRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'capabilities',
    aliases: ['caps', 'benchmark'],
    description: 'Show the OpenClaw/Hermes capability benchmark and Agent readiness',
    usage: '[openclaw|hermes|query]',
    handler(args, ctx) {
      const query = args.join(' ').trim() || undefined;
      const capabilities = filterOperatorCapabilities(OPERATOR_CAPABILITY_BENCHMARKS, query);
      ctx.print(renderOperatorCapabilityBenchmark(capabilities));
    },
  });
}
