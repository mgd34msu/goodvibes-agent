export type AgentSetupWizardSourceStatus = 'ready' | 'blocked' | 'recommended' | 'optional' | 'check';
export type AgentSetupWizardStatus = 'complete' | 'active' | 'blocked';
export type AgentSetupWizardStepStatus = 'done' | 'current' | 'pending' | 'blocked';
export type AgentSetupWizardCheckpointStatus = 'available' | 'none' | 'stale' | 'unavailable';
export type AgentSetupWizardCloseoutStatus = 'complete' | 'ready-to-finish' | 'needs-smoke-evidence' | 'blocked';

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

export interface AgentSetupWizardCloseout {
  readonly status: AgentSetupWizardCloseoutStatus;
  readonly label: string;
  readonly summary: string;
  readonly nextAction: string;
  readonly primaryStepId: string | null;
  readonly primaryStepLabel: string | null;
  readonly userRoute: string;
  readonly modelRoute: string;
  readonly requiresConfirmation: boolean;
  readonly evidence: readonly string[];
  readonly policy: string;
}

export interface AgentSetupWizardCheckpoint {
  readonly status: AgentSetupWizardCheckpointStatus;
  readonly currentStepId: string | null;
  readonly currentStepLabel: string | null;
  readonly savedAt: string | null;
  readonly source: string | null;
  readonly resumed: boolean;
  readonly summary: string;
  readonly path: string | null;
  readonly note?: string;
  readonly parseError?: string;
  readonly autoAdvance?: AgentSetupWizardCheckpointAutoAdvance;
  readonly markCurrentRoute: string;
  readonly clearRoute: string;
  readonly inspectRoute: string;
}

export interface AgentSetupWizardCheckpointAutoAdvance {
  readonly status: 'advanced' | 'live-priority';
  readonly fromStepId: string | null;
  readonly fromStepLabel: string | null;
  readonly toStepId: string | null;
  readonly toStepLabel: string | null;
  readonly reason: string;
  readonly evidence: string;
  readonly clearRoute: string;
  readonly inspectRoute: string;
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
  readonly closeout: AgentSetupWizardCloseout;
  readonly checkpoint: AgentSetupWizardCheckpoint;
  readonly steps: readonly AgentSetupWizardStep[];
}

export interface BuildAgentSetupWizardInput {
  readonly items: readonly AgentSetupWizardSourceItem[];
  readonly smokeHistory?: AgentSetupWizardSmokeHistory;
  readonly checkpoint?: AgentSetupWizardCheckpoint;
  readonly closeoutCriticalStepIds?: readonly string[];
  readonly setupMarkerExists?: boolean;
  readonly finishRoute?: string;
  readonly finishUserRoute?: string;
  readonly repeatedBlockerAliases?: Readonly<Record<string, readonly string[]>>;
  readonly reviewRoute?: string;
}

export const DEFAULT_AGENT_SETUP_WIZARD_REVIEW_ROUTE = 'agent_harness mode:"setup_posture" includeParameters:true';
export const DEFAULT_AGENT_SETUP_WIZARD_RERUN_SMOKE_ROUTE = 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke" confirm:true explicitUserRequest:"..."';
export const DEFAULT_AGENT_SETUP_WIZARD_SAVE_SMOKE_ROUTE = 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke" fields:{...} confirm:true explicitUserRequest:"..."';
export const DEFAULT_AGENT_SETUP_WIZARD_MARK_CHECKPOINT_ROUTE = 'agent_harness mode:"mark_setup_checkpoint" confirm:true explicitUserRequest:"..."';
export const DEFAULT_AGENT_SETUP_WIZARD_CLEAR_CHECKPOINT_ROUTE = 'agent_harness mode:"clear_setup_checkpoint" confirm:true explicitUserRequest:"..."';
export const DEFAULT_AGENT_SETUP_WIZARD_INSPECT_CHECKPOINT_ROUTE = 'agent_harness mode:"setup_checkpoint"';
export const DEFAULT_AGENT_SETUP_WIZARD_FINISH_ROUTE = 'agent_harness mode:"run_workspace_action" actionId:"onboarding-apply-close" confirm:true explicitUserRequest:"Finish Agent onboarding after setup smoke evidence is ready."';
export const DEFAULT_AGENT_SETUP_WIZARD_FINISH_USER_ROUTE = 'Agent Workspace -> Finish -> Apply & close';

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

export function emptyAgentSetupWizardCheckpoint(reason = 'No saved setup wizard checkpoint.'): AgentSetupWizardCheckpoint {
  return {
    status: 'none',
    currentStepId: null,
    currentStepLabel: null,
    savedAt: null,
    source: null,
    resumed: false,
    summary: reason,
    path: null,
    markCurrentRoute: DEFAULT_AGENT_SETUP_WIZARD_MARK_CHECKPOINT_ROUTE,
    clearRoute: DEFAULT_AGENT_SETUP_WIZARD_CLEAR_CHECKPOINT_ROUTE,
    inspectRoute: DEFAULT_AGENT_SETUP_WIZARD_INSPECT_CHECKPOINT_ROUTE,
  };
}

function firstAttentionItem(items: readonly AgentSetupWizardSourceItem[]): AgentSetupWizardSourceItem | null {
  return items.find((item) => item.status === 'blocked')
    ?? items.find((item) => item.status === 'check')
    ?? items.find((item) => item.status === 'recommended')
    ?? items.find((item) => item.status === 'optional')
    ?? null;
}

function firstBlockingItem(items: readonly AgentSetupWizardSourceItem[]): AgentSetupWizardSourceItem | null {
  return items.find((item) => item.status === 'blocked')
    ?? items.find((item) => item.status === 'check')
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

function itemFromCheckpoint(
  items: readonly AgentSetupWizardSourceItem[],
  checkpoint: AgentSetupWizardCheckpoint,
): AgentSetupWizardSourceItem | null {
  if (checkpoint.status !== 'available' || !checkpoint.currentStepId) return null;
  const item = items.find((candidate) => candidate.id === checkpoint.currentStepId);
  if (!item || item.status === 'ready') return null;
  return item;
}

function buildCheckpoint(
  checkpoint: AgentSetupWizardCheckpoint,
  items: readonly AgentSetupWizardSourceItem[],
  resumedItem: AgentSetupWizardSourceItem | null,
  blockingItem: AgentSetupWizardSourceItem | null,
): AgentSetupWizardCheckpoint {
  const withRoutes: AgentSetupWizardCheckpoint = {
    ...checkpoint,
    markCurrentRoute: checkpoint.markCurrentRoute || DEFAULT_AGENT_SETUP_WIZARD_MARK_CHECKPOINT_ROUTE,
    clearRoute: checkpoint.clearRoute || DEFAULT_AGENT_SETUP_WIZARD_CLEAR_CHECKPOINT_ROUTE,
    inspectRoute: checkpoint.inspectRoute || DEFAULT_AGENT_SETUP_WIZARD_INSPECT_CHECKPOINT_ROUTE,
  };
  if (checkpoint.status !== 'available') return withRoutes;
  if (resumedItem) {
    return {
      ...withRoutes,
      currentStepLabel: checkpoint.currentStepLabel ?? resumedItem.label,
      resumed: true,
      summary: `Resuming ${resumedItem.label} from saved setup checkpoint.`,
    };
  }
  const savedItem = checkpoint.currentStepId
    ? items.find((item) => item.id === checkpoint.currentStepId)
    : null;
  if (savedItem && savedItem.status !== 'ready' && blockingItem) {
    return {
      ...withRoutes,
      currentStepLabel: checkpoint.currentStepLabel ?? savedItem.label,
      resumed: false,
      summary: `Saved setup checkpoint for ${savedItem.label}; live blocker ${blockingItem.label} is taking priority.`,
      autoAdvance: {
        status: 'live-priority',
        fromStepId: savedItem.id,
        fromStepLabel: savedItem.label,
        toStepId: blockingItem.id,
        toStepLabel: blockingItem.label,
        reason: 'A live blocking setup item takes priority over the saved checkpoint.',
        evidence: `${blockingItem.label} is currently ${blockingItem.status}.`,
        clearRoute: withRoutes.clearRoute,
        inspectRoute: withRoutes.inspectRoute,
      },
    };
  }
  const nextItem = firstAttentionItem(items);
  return {
    ...withRoutes,
    status: 'stale',
    resumed: false,
    summary: savedItem?.status === 'ready'
      ? `Saved checkpoint ${savedItem.label} is already ready; live setup posture is taking over.`
      : 'Saved checkpoint no longer matches a current setup step; live setup posture is taking over.',
    autoAdvance: {
      status: 'advanced',
      fromStepId: savedItem?.id ?? checkpoint.currentStepId,
      fromStepLabel: savedItem?.label ?? checkpoint.currentStepLabel,
      toStepId: nextItem?.id ?? null,
      toStepLabel: nextItem?.label ?? null,
      reason: savedItem?.status === 'ready'
        ? 'The saved checkpoint step is ready, so the wizard advanced to live setup posture.'
        : 'The saved checkpoint step is no longer in the live setup plan, so the wizard advanced to live setup posture.',
      evidence: savedItem?.status === 'ready'
        ? `${savedItem.label} source status is ready.`
        : 'No matching live setup item exists for the saved checkpoint id.',
      clearRoute: withRoutes.clearRoute,
      inspectRoute: withRoutes.inspectRoute,
    },
  };
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

function buildCloseout(input: {
  readonly items: readonly AgentSetupWizardSourceItem[];
  readonly smokeHistory: AgentSetupWizardSmokeHistory;
  readonly criticalStepIds: readonly string[];
  readonly setupMarkerExists: boolean;
  readonly reviewRoute: string;
  readonly finishRoute: string;
  readonly finishUserRoute: string;
}): AgentSetupWizardCloseout {
  const critical = new Set(input.criticalStepIds);
  const primaryBlocker = input.items.find((item) => (
    critical.has(item.id) && item.status === 'blocked'
  )) ?? null;
  const smokeReady = input.smokeHistory.status === 'available' && input.smokeHistory.latestResult === 'ready-for-user-run';
  const latestSmoke = input.smokeHistory.status === 'available'
    ? input.smokeHistory.latestResult ?? 'unknown'
    : input.smokeHistory.status;
  const evidence = [
    `critical setup blockers: ${primaryBlocker ? `${primaryBlocker.label} (${primaryBlocker.status})` : 'none'}`,
    `setup marker: ${input.setupMarkerExists ? 'present' : 'missing'}`,
    `latest setup smoke: ${latestSmoke}`,
    `setup smoke history: ${input.smokeHistory.status}; total ${input.smokeHistory.total}; trend ${input.smokeHistory.trend}`,
  ];
  const policy = 'Setup closeout is advisory until a confirmed finish route writes the local onboarding marker. Optional setup recommendations do not block closeout, but unresolved critical blockers or missing ready setup smoke evidence do.';

  if (primaryBlocker) {
    return {
      status: 'blocked',
      label: 'Fix setup blocker',
      summary: `${primaryBlocker.label} is blocking normal Agent use.`,
      nextAction: primaryBlocker.detail,
      primaryStepId: primaryBlocker.id,
      primaryStepLabel: primaryBlocker.label,
      userRoute: primaryBlocker.userRoute,
      modelRoute: primaryBlocker.modelRoute,
      requiresConfirmation: false,
      evidence,
      policy,
    };
  }

  if (!smokeReady) {
    const prior = input.smokeHistory.latestResult === 'blocked'
      ? 'The latest saved setup smoke was blocked; rerun it now that critical setup is ready.'
      : input.smokeHistory.status === 'unavailable'
        ? 'Critical setup is ready, but this runtime cannot prove a saved setup smoke artifact.'
        : 'Critical setup is ready, but no ready setup smoke evidence is saved yet.';
    return {
      status: 'needs-smoke-evidence',
      label: 'Run final setup smoke',
      summary: prior,
      nextAction: 'Run the confirmed setup smoke route, capture user-visible package/status and first-turn output, then save the redacted evidence.',
      primaryStepId: 'install-smoke',
      primaryStepLabel: 'Install smoke',
      userRoute: 'Agent Workspace -> Start -> Install smoke',
      modelRoute: input.smokeHistory.saveRoute,
      requiresConfirmation: true,
      evidence,
      policy,
    };
  }

  if (!input.setupMarkerExists) {
    return {
      status: 'ready-to-finish',
      label: 'Finish setup',
      summary: 'Critical setup is ready and the latest saved setup smoke evidence is ready for user-run closeout.',
      nextAction: 'Write the onboarding completion marker so future launches start in the main conversation instead of first-run setup.',
      primaryStepId: 'finish-onboarding',
      primaryStepLabel: 'Finish onboarding state',
      userRoute: input.finishUserRoute,
      modelRoute: input.finishRoute,
      requiresConfirmation: true,
      evidence,
      policy,
    };
  }

  return {
    status: 'complete',
    label: 'Setup complete',
    summary: 'Critical setup, setup smoke evidence, and the onboarding completion marker are all present.',
    nextAction: 'Use setup only when provider, host, channel, automation, local behavior, or runtime-profile decisions change.',
    primaryStepId: null,
    primaryStepLabel: null,
    userRoute: 'Agent Workspace -> Home',
    modelRoute: input.reviewRoute,
    requiresConfirmation: false,
    evidence,
    policy,
  };
}

export function buildAgentSetupWizard(input: BuildAgentSetupWizardInput): AgentSetupWizard {
  const smokeHistory = input.smokeHistory ?? emptyAgentSetupSmokeHistory();
  const inputCheckpoint = input.checkpoint ?? emptyAgentSetupWizardCheckpoint();
  const repeated = itemFromRepeatedBlockers(input.items, smokeHistory, input.repeatedBlockerAliases ?? {});
  const blocking = firstBlockingItem(input.items);
  const rawCheckpointItem = itemFromCheckpoint(input.items, inputCheckpoint);
  const checkpointItem = blocking && rawCheckpointItem?.id !== blocking.id ? null : rawCheckpointItem;
  const checkpoint = buildCheckpoint(inputCheckpoint, input.items, checkpointItem, blocking);
  const current = repeated?.item ?? blocking ?? checkpointItem ?? firstAttentionItem(input.items);
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
    closeout: buildCloseout({
      items: input.items,
      smokeHistory,
      criticalStepIds: input.closeoutCriticalStepIds ?? [],
      setupMarkerExists: input.setupMarkerExists === true,
      reviewRoute: input.reviewRoute ?? DEFAULT_AGENT_SETUP_WIZARD_REVIEW_ROUTE,
      finishRoute: input.finishRoute ?? DEFAULT_AGENT_SETUP_WIZARD_FINISH_ROUTE,
      finishUserRoute: input.finishUserRoute ?? DEFAULT_AGENT_SETUP_WIZARD_FINISH_USER_ROUTE,
    }),
    checkpoint,
    steps,
  };
}
