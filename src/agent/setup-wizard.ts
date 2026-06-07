export type AgentSetupWizardSourceStatus = 'ready' | 'blocked' | 'recommended' | 'optional' | 'check';
export type AgentSetupWizardStatus = 'complete' | 'active' | 'blocked';
export type AgentSetupWizardStepStatus = 'done' | 'current' | 'pending' | 'blocked';

export interface AgentSetupWizardSourceItem {
  readonly id: string;
  readonly label: string;
  readonly status: AgentSetupWizardSourceStatus;
  readonly detail: string;
  readonly userRoute: string;
  readonly modelRoute: string;
  readonly actionId?: string;
}

export interface AgentSetupWizardBlockedCheckFrequency {
  readonly checkId: string;
  readonly count: number;
}

export interface AgentSetupWizardSmokeHistory {
  readonly status: 'available' | 'none' | 'unavailable';
  readonly total: number;
  readonly trend: string;
  readonly latestResult: string | null;
  readonly previousResult: string | null;
  readonly resultCounts: Readonly<Record<string, number>>;
  readonly blockedCheckFrequency: readonly AgentSetupWizardBlockedCheckFrequency[];
  readonly inspectLatestRoute: string | null;
  readonly rerunRoute: string;
  readonly saveRoute: string;
  readonly reason?: string;
}

export interface AgentSetupWizardRepeatedBlocker {
  readonly setupItemId: string;
  readonly checkId: string;
  readonly count: number;
  readonly summary: string;
}

export interface AgentSetupWizardStep {
  readonly id: string;
  readonly label: string;
  readonly status: AgentSetupWizardStepStatus;
  readonly sourceStatus: AgentSetupWizardSourceStatus;
  readonly detail: string;
  readonly userRoute: string;
  readonly modelRoute: string;
  readonly actionId: string;
  readonly backtrackRoute: string | null;
}

export interface AgentSetupWizard {
  readonly available: true;
  readonly status: AgentSetupWizardStatus;
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly currentStepId: string | null;
  readonly currentStepLabel: string | null;
  readonly progressLabel: string;
  readonly next: string;
  readonly reviewRoute: string;
  readonly repeatedBlocker: AgentSetupWizardRepeatedBlocker | null;
  readonly smokeHistory: AgentSetupWizardSmokeHistory;
  readonly steps: readonly AgentSetupWizardStep[];
}

export interface BuildAgentSetupWizardInput {
  readonly items: readonly AgentSetupWizardSourceItem[];
  readonly smokeHistory?: AgentSetupWizardSmokeHistory;
  readonly repeatedBlockerAliases?: Readonly<Record<string, readonly string[]>>;
  readonly reviewRoute?: string;
}

export const DEFAULT_AGENT_SETUP_WIZARD_REVIEW_ROUTE = 'agent_harness mode:"setup_posture" includeParameters:true';
export const DEFAULT_AGENT_SETUP_WIZARD_RERUN_SMOKE_ROUTE = 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke" confirm:true explicitUserRequest:"..."';
export const DEFAULT_AGENT_SETUP_WIZARD_SAVE_SMOKE_ROUTE = 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke" fields:{...} confirm:true explicitUserRequest:"..."';

export function emptyAgentSetupSmokeHistory(reason = 'No saved setup smoke evidence artifact found.'): AgentSetupWizardSmokeHistory {
  return {
    status: 'none',
    total: 0,
    trend: 'none',
    latestResult: null,
    previousResult: null,
    resultCounts: {},
    blockedCheckFrequency: [],
    inspectLatestRoute: null,
    rerunRoute: DEFAULT_AGENT_SETUP_WIZARD_RERUN_SMOKE_ROUTE,
    saveRoute: DEFAULT_AGENT_SETUP_WIZARD_SAVE_SMOKE_ROUTE,
    reason,
  };
}

function firstAttentionItem(items: readonly AgentSetupWizardSourceItem[]): AgentSetupWizardSourceItem | null {
  return items.find((item) => item.status === 'blocked')
    ?? items.find((item) => item.status === 'check')
    ?? items.find((item) => item.status === 'recommended')
    ?? items.find((item) => item.status === 'optional')
    ?? null;
}

function itemFromRepeatedBlockers(
  items: readonly AgentSetupWizardSourceItem[],
  smokeHistory: AgentSetupWizardSmokeHistory,
  aliases: Readonly<Record<string, readonly string[]>>,
): { readonly item: AgentSetupWizardSourceItem; readonly blocker: AgentSetupWizardRepeatedBlocker } | null {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const frequency of smokeHistory.blockedCheckFrequency) {
    const candidates = aliases[frequency.checkId] ?? [frequency.checkId];
    for (const candidate of candidates) {
      const item = byId.get(candidate);
      if (!item || item.status === 'ready') continue;
      return {
        item,
        blocker: {
          setupItemId: item.id,
          checkId: frequency.checkId,
          count: frequency.count,
          summary: `${item.label} repeated in ${frequency.count} saved setup smoke run(s) as ${frequency.checkId}.`,
        },
      };
    }
  }
  return null;
}

function stepStatus(item: AgentSetupWizardSourceItem, currentId: string | null): AgentSetupWizardStepStatus {
  if (item.status === 'ready') return 'done';
  if (item.id === currentId) return 'current';
  if (item.status === 'blocked' || item.status === 'check') return 'blocked';
  return 'pending';
}

function buildStep(item: AgentSetupWizardSourceItem, currentId: string | null): AgentSetupWizardStep {
  const status = stepStatus(item, currentId);
  return {
    id: item.id,
    label: item.label,
    status,
    sourceStatus: item.status,
    detail: item.detail,
    userRoute: item.userRoute,
    modelRoute: item.modelRoute,
    actionId: item.actionId ?? item.id,
    backtrackRoute: status === 'done' || status === 'current' ? item.modelRoute : null,
  };
}

export function buildAgentSetupWizard(input: BuildAgentSetupWizardInput): AgentSetupWizard {
  const smokeHistory = input.smokeHistory ?? emptyAgentSetupSmokeHistory();
  const repeated = itemFromRepeatedBlockers(input.items, smokeHistory, input.repeatedBlockerAliases ?? {});
  const current = repeated?.item ?? firstAttentionItem(input.items);
  const currentId = current?.id ?? null;
  const steps = input.items.map((item) => buildStep(item, currentId));
  const completedSteps = steps.filter((step) => step.status === 'done').length;
  const status: AgentSetupWizardStatus = completedSteps === steps.length
    ? 'complete'
    : current?.status === 'blocked' || current?.status === 'check'
      ? 'blocked'
      : 'active';
  const next = current
    ? repeated
      ? `${current.label}: ${repeated.blocker.summary} ${current.detail}`
      : `${current.label}: ${current.detail}`
    : 'Setup wizard is complete; rerun setup smoke if this machine was upgraded or moved.';
  return {
    available: true,
    status,
    completedSteps,
    totalSteps: steps.length,
    currentStepId: currentId,
    currentStepLabel: current?.label ?? null,
    progressLabel: `${completedSteps}/${steps.length} setup step(s) ready`,
    next,
    reviewRoute: input.reviewRoute ?? DEFAULT_AGENT_SETUP_WIZARD_REVIEW_ROUTE,
    repeatedBlocker: repeated?.blocker ?? null,
    smokeHistory,
    steps,
  };
}
