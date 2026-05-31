import type { CommandRegistry } from '../command-registry.ts';
import {
  filterOperatorCapabilities,
  renderOperatorCapabilityBenchmark,
  OPERATOR_CAPABILITY_BENCHMARKS,
} from '../../operator/capability-benchmark.ts';
import {
  fetchLiveDaemonCapabilityAudit,
  filterDaemonCapabilityAuditAreas,
  renderDaemonCapabilityAudit,
  renderDaemonCapabilityFailure,
} from '../../operator/daemon-capability-audit.ts';
import { resolveAgentDaemonConnection } from '../../agent/routine-schedule-promotion.ts';

export function registerCapabilitiesRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'capabilities',
    aliases: ['caps', 'benchmark'],
    description: 'Show the OpenClaw/Hermes capability benchmark, Agent readiness, and live daemon coverage',
    usage: '[daemon|openclaw|hermes|query]',
    async handler(args, ctx) {
      if (args[0] === 'daemon') {
        const homeDirectory = ctx.platform.configManager.getHomeDirectory() ?? process.cwd();
        const connection = resolveAgentDaemonConnection(ctx.platform.configManager, homeDirectory);
        const audit = await fetchLiveDaemonCapabilityAudit(connection);
        if (!audit.ok) {
          ctx.print(renderDaemonCapabilityFailure(audit));
          return;
        }
        const query = args.slice(1).join(' ').trim() || undefined;
        const areas = filterDaemonCapabilityAuditAreas(audit.areas, query);
        ctx.print(renderDaemonCapabilityAudit(audit, areas));
        return;
      }
      const query = args.join(' ').trim() || undefined;
      const capabilities = filterOperatorCapabilities(OPERATOR_CAPABILITY_BENCHMARKS, query);
      ctx.print(renderOperatorCapabilityBenchmark(capabilities));
    },
  });
}
