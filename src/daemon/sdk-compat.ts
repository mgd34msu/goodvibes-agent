import { AGENT_KNOWLEDGE_ASK_PATH, AGENT_KNOWLEDGE_SEARCH_PATH, type DaemonCompatibilityResult, type DaemonDiagnosticResult } from './client.js';
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
    readonly agentSpecificIsolation: 'active';
    readonly activeAskRoute: typeof AGENT_KNOWLEDGE_ASK_PATH;
    readonly activeSearchRoute: typeof AGENT_KNOWLEDGE_SEARCH_PATH;
    readonly routeSwitchAllowed: true;
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
      agentSpecificIsolation: 'active',
      activeAskRoute: AGENT_KNOWLEDGE_ASK_PATH,
      activeSearchRoute: AGENT_KNOWLEDGE_SEARCH_PATH,
      routeSwitchAllowed: true,
      notes: [
        'Agent-specific knowledge isolation is active in the pinned published SDK.',
        'ask/search commands target the GoodVibes Agent knowledge environment.',
        'Memory, skills, and personas remain Agent-local until shared registry contracts are promoted.',
      ],
    },
  };
}
