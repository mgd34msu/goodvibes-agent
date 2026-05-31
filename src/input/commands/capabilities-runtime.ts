import type { CommandRegistry } from '../command-registry.ts';
import {
  filterOperatorCapabilities,
  renderOperatorCapabilityBenchmark,
  OPERATOR_CAPABILITY_BENCHMARKS,
} from '../../operator/capability-benchmark.ts';
import {
  buildDaemonCapabilityGapReport,
  buildDaemonCapabilityRouteRiskReport,
  fetchLiveDaemonCapabilityAudit,
  filterDaemonCapabilityAuditAreas,
  filterDaemonCapabilityGaps,
  filterDaemonCapabilityRouteRiskAreas,
  renderDaemonCapabilityAudit,
  renderDaemonCapabilityFailure,
  renderDaemonCapabilityGaps,
  renderDaemonCapabilityRouteRisk,
} from '../../operator/daemon-capability-audit.ts';
import { resolveAgentDaemonConnection } from '../../agent/routine-schedule-promotion.ts';

export function registerCapabilitiesRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'capabilities',
    aliases: ['caps', 'benchmark'],
    description: 'Show the OpenClaw/Hermes capability benchmark, Agent readiness, and live daemon coverage',
    usage: '[daemon|gaps|openclaw|hermes|query]',
    async handler(args, ctx) {
      if (args[0] === 'daemon') {
        const homeDirectory = ctx.platform.configManager.getHomeDirectory() ?? process.cwd();
        const connection = resolveAgentDaemonConnection(ctx.platform.configManager, homeDirectory);
        const audit = await fetchLiveDaemonCapabilityAudit(connection);
        if (!audit.ok) {
          ctx.print(renderDaemonCapabilityFailure(audit));
          return;
        }
        if (args[1] === 'gaps') {
          const report = buildDaemonCapabilityGapReport(audit);
          const query = args.slice(2).join(' ').trim() || undefined;
          const gaps = filterDaemonCapabilityGaps(report.gaps, query);
          ctx.print(renderDaemonCapabilityGaps(report, gaps));
          return;
        }
        if (args[1] === 'risk' || args[1] === 'route-risk') {
          const report = buildDaemonCapabilityRouteRiskReport(audit);
          const query = args.slice(2).join(' ').trim() || undefined;
          const areas = filterDaemonCapabilityRouteRiskAreas(report.areas, query);
          ctx.print(renderDaemonCapabilityRouteRisk(report, areas));
          return;
        }
        const query = args.slice(1).join(' ').trim() || undefined;
        const areas = filterDaemonCapabilityAuditAreas(audit.areas, query);
        ctx.print(renderDaemonCapabilityAudit(audit, areas));
        return;
      }
      if (args[0] === 'gaps') {
        const homeDirectory = ctx.platform.configManager.getHomeDirectory() ?? process.cwd();
        const connection = resolveAgentDaemonConnection(ctx.platform.configManager, homeDirectory);
        const audit = await fetchLiveDaemonCapabilityAudit(connection);
        if (!audit.ok) {
          ctx.print(renderDaemonCapabilityFailure(audit));
          return;
        }
        const report = buildDaemonCapabilityGapReport(audit);
        const query = args.slice(1).join(' ').trim() || undefined;
        const gaps = filterDaemonCapabilityGaps(report.gaps, query);
        ctx.print(renderDaemonCapabilityGaps(report, gaps));
        return;
      }
      const query = args.join(' ').trim() || undefined;
      const capabilities = filterOperatorCapabilities(OPERATOR_CAPABILITY_BENCHMARKS, query);
      ctx.print(renderOperatorCapabilityBenchmark(capabilities));
    },
  });
}
