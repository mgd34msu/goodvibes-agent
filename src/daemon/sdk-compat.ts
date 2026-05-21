import type { DaemonCompatibilityResult, DaemonDiagnosticResult } from './client.js';
import { EXPECTED_GOODVIBES_SDK_VERSION, GOODVIBES_AGENT_PACKAGE_VERSION, GOODVIBES_SDK_PACKAGE_PIN } from '../version.js';

export interface SdkCompatibilityReport {
  readonly agent: {
    readonly version: string;
    readonly sdkPackagePin: string;
    readonly expectedDaemonVersion: string;
  };
  readonly daemon: {
    readonly baseUrl: string;
    readonly reachable: boolean;
    readonly compatible: boolean;
    readonly kind: DaemonDiagnosticResult['kind'];
    readonly daemonVersion: string | null;
    readonly expectedVersion: string;
    readonly reason: string;
  };
  readonly knowledge: {
    readonly agentSpecificIsolation: 'pending_sdk_handoff';
    readonly activeAskRoute: 'knowledge.ask';
    readonly activeSearchRoute: 'knowledge.search';
    readonly routeSwitchAllowed: false;
    readonly notes: readonly string[];
  };
}

export function buildSdkCompatibilityReport(input: {
  readonly baseUrl: string;
  readonly compatibility: DaemonCompatibilityResult | null;
  readonly errorKind?: DaemonDiagnosticResult['kind'] | undefined;
  readonly errorMessage?: string | undefined;
}): SdkCompatibilityReport {
  const compatibility = input.compatibility;
  const compatible = compatibility?.ok === true;
  return {
    agent: {
      version: GOODVIBES_AGENT_PACKAGE_VERSION,
      sdkPackagePin: GOODVIBES_SDK_PACKAGE_PIN,
      expectedDaemonVersion: EXPECTED_GOODVIBES_SDK_VERSION,
    },
    daemon: {
      baseUrl: input.baseUrl,
      reachable: compatibility !== null,
      compatible,
      kind: compatible ? 'ok' : input.errorKind ?? 'version_mismatch',
      daemonVersion: compatibility?.daemonVersion ?? null,
      expectedVersion: compatibility?.expectedVersion ?? EXPECTED_GOODVIBES_SDK_VERSION,
      reason: compatibility?.reason ?? input.errorMessage ?? 'GoodVibes daemon compatibility could not be checked.',
    },
    knowledge: {
      agentSpecificIsolation: 'pending_sdk_handoff',
      activeAskRoute: 'knowledge.ask',
      activeSearchRoute: 'knowledge.search',
      routeSwitchAllowed: false,
      notes: [
        'Agent-specific knowledge isolation is not enabled in the pinned published SDK.',
        'Do not switch routes until SDK/TUI confirm a verified npm release and public route contract.',
        'Current ask/search commands intentionally stay on knowledge.ask and knowledge.search.',
      ],
    },
  };
}
