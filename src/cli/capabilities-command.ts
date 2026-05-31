import type { CliCommandOutput } from './types.ts';
import type { CliCommandRuntime } from './management.ts';
import {
  buildOperatorCapabilityBenchmarkReport,
  filterOperatorCapabilities,
  renderOperatorCapabilityBenchmark,
} from '../operator/capability-benchmark.ts';
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
} from '../operator/daemon-capability-audit.ts';
import { resolveAgentDaemonConnection } from '../agent/routine-schedule-promotion.ts';

interface CapabilityCommandArgs {
  readonly mode: 'benchmark' | 'daemon' | 'daemon-gaps' | 'daemon-risk';
  readonly query: string | undefined;
}

function readCapabilityArgs(args: readonly string[]): CapabilityCommandArgs {
  const values = args.filter((arg) => !arg.startsWith('--'));
  if (values[0] === 'gaps') {
    const query = values.slice(1).join(' ').trim();
    return { mode: 'daemon-gaps', query: query.length > 0 ? query : undefined };
  }
  if (values[0] === 'daemon') {
    if (values[1] === 'gaps') {
      const query = values.slice(2).join(' ').trim();
      return { mode: 'daemon-gaps', query: query.length > 0 ? query : undefined };
    }
    if (values[1] === 'risk' || values[1] === 'route-risk') {
      const query = values.slice(2).join(' ').trim();
      return { mode: 'daemon-risk', query: query.length > 0 ? query : undefined };
    }
    const query = values.slice(1).join(' ').trim();
    return { mode: 'daemon', query: query.length > 0 ? query : undefined };
  }
  return { mode: 'benchmark', query: values.length > 0 ? values.join(' ') : undefined };
}

export async function handleCapabilitiesCommand(runtime: CliCommandRuntime): Promise<CliCommandOutput> {
  const args = readCapabilityArgs(runtime.cli.commandArgs);
  if (args.mode === 'daemon') {
    const connection = resolveAgentDaemonConnection(runtime.configManager, runtime.homeDirectory);
    const audit = await fetchLiveDaemonCapabilityAudit(connection);
    if (!audit.ok) {
      return {
        output: runtime.cli.flags.outputFormat === 'json'
          ? JSON.stringify(audit, null, 2)
          : renderDaemonCapabilityFailure(audit),
        exitCode: audit.kind === 'auth_required' || audit.kind === 'daemon_unavailable' ? 1 : 2,
      };
    }
    const areas = filterDaemonCapabilityAuditAreas(audit.areas, args.query);
    return {
      output: runtime.cli.flags.outputFormat === 'json'
        ? JSON.stringify({ ...audit, areas }, null, 2)
        : renderDaemonCapabilityAudit(audit, areas),
      exitCode: 0,
    };
  }
  if (args.mode === 'daemon-gaps') {
    const connection = resolveAgentDaemonConnection(runtime.configManager, runtime.homeDirectory);
    const audit = await fetchLiveDaemonCapabilityAudit(connection);
    if (!audit.ok) {
      return {
        output: runtime.cli.flags.outputFormat === 'json'
          ? JSON.stringify(audit, null, 2)
          : renderDaemonCapabilityFailure(audit),
        exitCode: audit.kind === 'auth_required' || audit.kind === 'daemon_unavailable' ? 1 : 2,
      };
    }
    const report = buildDaemonCapabilityGapReport(audit);
    const gaps = filterDaemonCapabilityGaps(report.gaps, args.query);
    return {
      output: runtime.cli.flags.outputFormat === 'json'
        ? JSON.stringify({ ...report, matchedGapCount: gaps.length, gaps }, null, 2)
        : renderDaemonCapabilityGaps(report, gaps),
      exitCode: 0,
    };
  }
  if (args.mode === 'daemon-risk') {
    const connection = resolveAgentDaemonConnection(runtime.configManager, runtime.homeDirectory);
    const audit = await fetchLiveDaemonCapabilityAudit(connection);
    if (!audit.ok) {
      return {
        output: runtime.cli.flags.outputFormat === 'json'
          ? JSON.stringify(audit, null, 2)
          : renderDaemonCapabilityFailure(audit),
        exitCode: audit.kind === 'auth_required' || audit.kind === 'daemon_unavailable' ? 1 : 2,
      };
    }
    const report = buildDaemonCapabilityRouteRiskReport(audit);
    const areas = filterDaemonCapabilityRouteRiskAreas(report.areas, args.query);
    return {
      output: runtime.cli.flags.outputFormat === 'json'
        ? JSON.stringify({ ...report, matchedAreaCount: areas.length, areas }, null, 2)
        : renderDaemonCapabilityRouteRisk(report, areas),
      exitCode: 0,
    };
  }
  const report = buildOperatorCapabilityBenchmarkReport();
  const capabilities = filterOperatorCapabilities(report.capabilities, args.query);
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
