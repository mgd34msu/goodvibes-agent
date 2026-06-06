import type {
  AgentWorkspace,
  AgentWorkspaceAction,
  AgentWorkspaceCategory,
  AgentWorkspaceLocalEditor,
  AgentWorkspaceRuntimeSnapshot,
} from '../input/agent-workspace.ts';
import { formatAgentRecordReviewState } from '../agent/record-labels.ts';
import type { Line } from '../types/grid.ts';
import { truncateDisplay, wrapText } from '../utils/terminal-width.ts';
import { GLYPHS } from './ui-primitives.ts';
import {
  getFullscreenWorkspaceMetrics,
  padDisplay,
  renderFullscreenWorkspace,
  stableWindow,
  WORKSPACE_PALETTE as PALETTE,
  type WorkspaceRow,
} from './fullscreen-workspace.ts';
import { actionResultColor, setupStatusColor, type AgentWorkspaceContextLine as ContextLine } from './agent-workspace-style.ts';

function buildLeftRows(workspace: AgentWorkspace, height: number): WorkspaceRow[] {
  const rows: WorkspaceRow[] = [];
  let selectedRenderedIndex = 0;
  let lastGroup = '';

  workspace.categories.forEach((category, index) => {
    if (category.group !== lastGroup) {
      rows.push({ text: category.group, kind: 'group', bold: true });
      lastGroup = category.group;
    }
    const selected = index === workspace.selectedCategoryIndex;
    if (selected) selectedRenderedIndex = rows.length;
    const marker = selected ? GLYPHS.navigation.selected : ' ';
    rows.push({
      text: `  ${marker} ${category.label}`,
      selected: selected && workspace.focusPane === 'categories',
      kind: 'item',
      fg: selected ? PALETTE.text : PALETTE.muted,
      bold: selected,
    });
  });

  const visible = Math.max(1, height);
  const window = stableWindow(rows.length, selectedRenderedIndex, visible);
  const visibleRows = rows.slice(window.start, window.end);
  if (window.start > 0 && visibleRows.length > 0) {
    visibleRows[0] = { text: `${GLYPHS.navigation.moreAbove} ${window.start} more row(s) above`, kind: 'more', fg: PALETTE.dim, dim: true };
  }
  if (window.end < rows.length && visibleRows.length > 0) {
    visibleRows[visibleRows.length - 1] = { text: `${GLYPHS.navigation.moreBelow} ${rows.length - window.end} more row(s) below`, kind: 'more', fg: PALETTE.dim, dim: true };
  }
  while (visibleRows.length < height) visibleRows.push({ text: '', kind: 'empty' });
  return visibleRows.slice(0, height);
}

function actionCommand(action: AgentWorkspaceAction): string {
  if (action.kind === 'workspace') return 'open area';
  if (action.kind === 'editor') return action.editorKind ? `edit ${action.editorKind}` : 'edit form';
  if (action.kind === 'setting') return action.settingKey ? `setting ${action.settingKey}` : 'setting';
  if (action.kind === 'settings-import') return 'import GoodVibes settings';
  if (action.kind === 'model-picker') return action.modelPickerFlow === 'model' ? 'model picker' : 'provider/model picker';
  if (action.kind === 'settings-modal') return action.settingsTarget ? `settings ${action.settingsTarget}` : 'settings';
  if (action.kind === 'local-selection') return action.selectionDelta && action.selectionDelta < 0 ? 'select previous' : 'select next';
  if (action.kind === 'local-operation') return action.localOperation ?? '(local action)';
  if (action.kind === 'onboarding-complete') return 'apply and close';
  return action.command ?? '(guidance)';
}

function setupCounts(snapshot: AgentWorkspaceRuntimeSnapshot): { ready: number; recommended: number; optional: number; blocked: number } {
  return {
    ready: snapshot.setupChecklist.filter((item) => item.status === 'ready').length,
    recommended: snapshot.setupChecklist.filter((item) => item.status === 'recommended').length,
    optional: snapshot.setupChecklist.filter((item) => item.status === 'optional').length,
    blocked: snapshot.setupChecklist.filter((item) => item.status === 'blocked').length,
  };
}

function setupStatusLabel(status: AgentWorkspaceRuntimeSnapshot['setupChecklist'][number]['status']): string {
  return status === 'ready'
    ? 'Ready'
    : status === 'recommended'
      ? 'Recommended'
      : status === 'blocked'
        ? 'Blocked'
        : 'Optional';
}

function formatMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function compactText(text: string, maxWidth = 104): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return '';
  const firstSentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  const source = firstSentence && firstSentence.length <= maxWidth ? firstSentence : normalized;
  return truncateDisplay(source, maxWidth, '...');
}

function actionMetaLine(action: AgentWorkspaceAction): ContextLine {
  return {
    text: `Does: ${actionCommand(action)}`,
    fg: action.safety === 'blocked' ? PALETTE.warn : action.kind === 'command' ? PALETTE.info : PALETTE.muted,
  };
}

function setupAttentionItems(snapshot: AgentWorkspaceRuntimeSnapshot, limit: number): AgentWorkspaceRuntimeSnapshot['setupChecklist'] {
  return [
    ...snapshot.setupChecklist.filter((item) => item.status === 'blocked'),
    ...snapshot.setupChecklist.filter((item) => item.status === 'recommended'),
    ...snapshot.setupChecklist.filter((item) => item.status === 'optional'),
  ].slice(0, limit);
}

function conciseSetupLine(snapshot: AgentWorkspaceRuntimeSnapshot): ContextLine {
  const counts = setupCounts(snapshot);
  return {
    text: `Setup: ${counts.ready}/${snapshot.setupChecklist.length} ready; ${counts.recommended} recommended; ${counts.blocked} blocked.`,
    fg: counts.blocked > 0 ? PALETTE.warn : PALETTE.info,
  };
}

function setupOverviewLines(snapshot: AgentWorkspaceRuntimeSnapshot): ContextLine[] {
  const counts = setupCounts(snapshot);
  const nextItems = setupAttentionItems(snapshot, 3);
  const lines: ContextLine[] = [
    { text: 'Onboarding', fg: PALETTE.title, bold: true },
    { text: `${counts.ready}/${snapshot.setupChecklist.length} ready; ${counts.recommended} recommended; ${counts.optional} optional; ${counts.blocked} blocked.`, fg: counts.blocked > 0 ? PALETTE.warn : PALETTE.info },
    { text: `Chat: ${snapshot.provider} / ${snapshot.modelDisplayName}.`, fg: PALETTE.info },
    { text: `Local: ${snapshot.localPersonaCount} personas, ${snapshot.localSkillCount} skills, ${snapshot.localRoutineCount} routines, ${snapshot.localMemoryCount} memories.`, fg: PALETTE.info },
  ];
  if (nextItems.length > 0) {
    const item = nextItems[0]!;
    lines.push({
      text: `Next: ${item.label} (${setupStatusLabel(item.status).toLowerCase()})`,
      fg: setupStatusColor(item.status),
      bold: item.status === 'blocked',
    });
  }
  return lines;
}

function homeNextActionLines(snapshot: AgentWorkspaceRuntimeSnapshot): ContextLine[] {
  const candidates = setupAttentionItems(snapshot, 3);
  if (candidates.length === 0) {
    return [
      { text: 'Next Actions', fg: PALETTE.title, bold: true },
      { text: 'Core setup is ready. Continue normal assistant work, review Knowledge sources, or tune local skills/routines as needed.', fg: PALETTE.good },
    ];
  }
  const lines: ContextLine[] = [{ text: 'Next Actions', fg: PALETTE.title, bold: true }];
  for (const item of candidates) {
    lines.push({
      text: `${setupStatusLabel(item.status)}: ${item.label}`,
      fg: setupStatusColor(item.status),
      bold: item.status === 'blocked',
    });
  }
  return lines;
}

function companionAccessLine(snapshot: AgentWorkspaceRuntimeSnapshot): ContextLine {
  const access = snapshot.companionAccess;
  const tokenState = access.tokenReadable
    ? `ready sha256:${access.tokenFingerprint ?? 'unknown'}`
    : access.tokenPresent
      ? 'present but unreadable'
      : 'missing';
  const error = access.tokenError ? `; token read error ${access.tokenError}` : '';
  return {
    text: `Companion: ${access.surface}; token ${tokenState}; QR ${access.qrCommand}${error}.`,
    fg: access.pairingReady ? PALETTE.good : PALETTE.warn,
  };
}

function compactLocalLibraryLines(
  title: string,
  items: readonly AgentWorkspaceRuntimeSnapshot['localPersonas'][number][],
  emptyText: string,
  selectedId: string | null,
): ContextLine[] {
  const lines: ContextLine[] = [];
  if (items.length === 0) {
    lines.push({ text: `${title}: 0. ${emptyText}`, fg: PALETTE.warn });
    return lines;
  }
  const selected = items.find((item) => item.id === selectedId) ?? items[0]!;
  const status = [
    selected.active ? 'active' : '',
    selected.enabled === true ? 'enabled' : selected.enabled === false ? 'disabled' : '',
    selected.scope && selected.cls ? `${selected.scope}/${selected.cls}` : '',
    selected.confidence !== undefined ? `${selected.confidence}%` : '',
    selected.requirementCount !== undefined && selected.requirementCount > 0
      ? (selected.missingRequirementCount && selected.missingRequirementCount > 0 ? `needs ${selected.missingRequirementCount}/${selected.requirementCount}` : `ready ${selected.requirementCount}/${selected.requirementCount}`)
      : '',
    formatAgentRecordReviewState(selected.reviewState),
    selected.startCount !== undefined ? `starts ${selected.startCount}` : '',
  ].filter(Boolean).join(', ');
  lines.push({
    text: `${title}: ${items.length}; selected ${selected.name}${status ? ` (${status})` : ''}.`,
    fg: selected.reviewState === 'stale' ? PALETTE.warn : PALETTE.info,
    bold: selected.active === true,
  });
  if (selected.missingRequirements && selected.missingRequirements.length > 0) {
    lines.push({ text: `Missing setup: ${selected.missingRequirements.join(', ')}`, fg: PALETTE.warn });
  }
  return lines;
}

type LocalRoutineItem = AgentWorkspaceRuntimeSnapshot['localRoutines'][number];

function readyRoutineItems(snapshot: AgentWorkspaceRuntimeSnapshot): readonly LocalRoutineItem[] {
  return snapshot.localRoutines.filter((routine) =>
    routine.enabled === true
    && routine.reviewState === 'reviewed'
    && (routine.missingRequirementCount ?? 0) === 0
  );
}

function routinesNeedingSetup(snapshot: AgentWorkspaceRuntimeSnapshot): readonly LocalRoutineItem[] {
  return snapshot.localRoutines.filter((routine) => (routine.missingRequirementCount ?? 0) > 0);
}

function routinesNeedingReview(snapshot: AgentWorkspaceRuntimeSnapshot): readonly LocalRoutineItem[] {
  return snapshot.localRoutines.filter((routine) => routine.reviewState !== 'reviewed');
}

function routineNextActionLine(snapshot: AgentWorkspaceRuntimeSnapshot): ContextLine {
  const discovered = snapshot.discoveredBehavior.routines.count;
  const ready = readyRoutineItems(snapshot);
  const needsSetup = routinesNeedingSetup(snapshot);
  const needsReview = routinesNeedingReview(snapshot);

  if (snapshot.localRoutineCount === 0 && discovered > 0) {
    return { text: 'Next routine action: Discover routine files, preview one, then import it from this workspace.', fg: PALETTE.warn, bold: true };
  }
  if (snapshot.localRoutineCount === 0) {
    return { text: 'Next routine action: Create routine for a repeatable main-conversation workflow.', fg: PALETTE.warn, bold: true };
  }
  if (needsSetup.length > 0) {
    return { text: `Next routine action: Needs setup for ${needsSetup[0]?.id ?? 'a routine'} before it can be trusted for schedule promotion.`, fg: PALETTE.warn, bold: true };
  }
  if (needsReview.length > 0) {
    return { text: `Next routine action: Review selected or inspect ${needsReview[0]?.id ?? 'a routine'} before schedule promotion.`, fg: PALETTE.warn, bold: true };
  }
  if (ready.length > 0 && snapshot.routineScheduleReceiptCount === 0) {
    return { text: `Next routine action: Promote ${ready[0]?.id ?? 'a reviewed routine'} to a connected schedule when you have a real cadence.`, fg: PALETTE.good, bold: true };
  }
  return { text: 'Next routine action: Start selected in the main conversation, inspect receipts, or reconcile connected schedules.', fg: PALETTE.info, bold: true };
}

function compactRoutineReceiptLine(snapshot: AgentWorkspaceRuntimeSnapshot): ContextLine {
  const latest = snapshot.latestRoutineScheduleReceipt;
  if (!latest) {
    return {
      text: `Promotion receipts: ${snapshot.routineScheduleReceiptCount}; none created yet.`,
      fg: PALETTE.muted,
    };
  }
  return {
    text: `Promotion receipts: ${snapshot.routineScheduleReceiptCount}; latest ${latest.status} ${latest.routineId}.`,
    fg: latest.status === 'failed' ? PALETTE.warn : PALETTE.good,
  };
}

function automationNextActionLine(snapshot: AgentWorkspaceRuntimeSnapshot): ContextLine {
  const ready = readyRoutineItems(snapshot);
  const needsSetup = routinesNeedingSetup(snapshot);
  const needsReview = routinesNeedingReview(snapshot);
  if (snapshot.routineScheduleReceiptCount > 0) {
    return { text: 'Next automation action: Reconcile schedules to compare local receipts with the connected host.', fg: PALETTE.info, bold: true };
  }
  if (ready.length > 0) {
    return { text: `Next automation action: Promote ${ready[0]?.id ?? 'a reviewed routine'} or create a one-off reminder.`, fg: PALETTE.good, bold: true };
  }
  if (needsSetup.length > 0) {
    return { text: `Next automation action: Resolve routine setup gaps in ${needsSetup[0]?.id ?? 'Routines'} before promotion, or create a reminder.`, fg: PALETTE.warn, bold: true };
  }
  if (needsReview.length > 0) {
    return { text: `Next automation action: Review ${needsReview[0]?.id ?? 'a routine'} in Routines before schedule promotion, or create a reminder.`, fg: PALETTE.warn, bold: true };
  }
  return { text: 'Next automation action: Create a reminder, or create/import a routine before recurring workflow promotion.', fg: PALETTE.warn, bold: true };
}

function snapshotLines(workspace: AgentWorkspace, category: AgentWorkspaceCategory, snapshot: AgentWorkspaceRuntimeSnapshot | null): ContextLine[] {
  if (!snapshot) return [{ text: 'Runtime context is not loaded yet.', fg: PALETTE.warn }];
  const base: ContextLine[] = [];
  if (category.id === 'home') {
    base.push(
      { text: `Chat route: ${snapshot.provider} / ${snapshot.modelDisplayName}`, fg: PALETTE.info },
      { text: `Session: ${snapshot.sessionId}`, fg: PALETTE.muted },
      { text: `Policy: ${snapshot.executionPolicy}; delegated review ${snapshot.delegatedReviewPolicy}`, fg: PALETTE.good },
      conciseSetupLine(snapshot),
      ...homeNextActionLines(snapshot),
    );
  } else if (category.id === 'setup') {
    base.push(
      ...setupOverviewLines(snapshot),
    );
  } else if (category.id === 'account-model') {
    base.push(
      { text: `Chat route: ${snapshot.provider} / ${snapshot.modelDisplayName}`, fg: PALETTE.info },
      { text: `Subscriptions: ${snapshot.activeSubscriptionCount} active; ${snapshot.pendingSubscriptionCount} pending; ${snapshot.availableSubscriptionProviderCount} available.`, fg: snapshot.activeSubscriptionCount > 0 ? PALETTE.good : snapshot.pendingSubscriptionCount > 0 ? PALETTE.warn : PALETTE.muted },
      { text: `Embedding: ${snapshot.embeddingProvider}; reasoning ${snapshot.reasoningEffort}.`, fg: PALETTE.info },
      { text: `Helper: ${snapshot.helperEnabled ? 'enabled' : 'disabled'}; Tool LLM: ${snapshot.toolLlmEnabled ? 'enabled' : 'disabled'}.`, fg: snapshot.helperEnabled || snapshot.toolLlmEnabled ? PALETTE.good : PALETTE.muted },
      { text: 'Local cookbook: Ollama first, llama.cpp offline, vLLM for GPU throughput.', fg: PALETTE.good },
      { text: `Cache: ${snapshot.cacheEnabled ? snapshot.cacheStableTtl : 'off'}; monitor ${snapshot.cacheMonitorHitRate ? snapshot.cacheHitRateWarningThreshold : 'off'}; failure hints ${snapshot.providerFailureHints ? 'on' : 'off'}.`, fg: snapshot.cacheEnabled ? PALETTE.info : PALETTE.muted },
    );
  } else if (category.id === 'assistant-behavior') {
    base.push(
      { text: `Interaction: ${snapshot.hitlMode}; guidance ${snapshot.guidanceMode}; history ${snapshot.saveHistory ? 'saved' : 'off'}.`, fg: PALETTE.info },
      { text: `Context: compact at ${snapshot.autoCompactThreshold}; stale warnings ${snapshot.staleContextWarnings ? 'on' : 'off'}.`, fg: PALETTE.info },
      { text: `Reasoning display: thinking ${snapshot.showThinking ? 'on' : 'off'}; summaries ${snapshot.showReasoningSummary ? 'on' : 'off'}.`, fg: PALETTE.muted },
    );
  } else if (category.id === 'tools-permissions') {
    base.push(
      { text: `Permission mode: ${snapshot.permissionMode}.`, fg: snapshot.permissionMode === 'allow-all' ? PALETTE.warn : PALETTE.info },
      { text: `Auto-approve ${snapshot.autoApprove ? 'on' : 'off'}; tool auto-heal ${snapshot.toolAutoHeal ? 'on' : 'off'}; token budget ${snapshot.toolsDefaultTokenBudget}.`, fg: snapshot.autoApprove ? PALETTE.warn : PALETTE.info },
      { text: `Artifact limit ${formatMegabytes(snapshot.artifactMaxBytes)}; raw prompt telemetry ${snapshot.rawPromptTelemetry ? 'on' : 'off'}.`, fg: snapshot.rawPromptTelemetry ? PALETTE.warn : PALETTE.muted },
      { text: `MCP servers: ${snapshot.mcpConnectedServerCount}/${snapshot.mcpServerCount} connected; quarantined ${snapshot.mcpQuarantinedServerCount}.`, fg: snapshot.mcpQuarantinedServerCount > 0 ? PALETTE.warn : PALETTE.info },
      { text: 'MCP and secret setup use forms; selecting a row does not run arbitrary tools.', fg: PALETTE.good },
    );
  } else if (category.id === 'onboarding-display') {
    base.push(
      { text: `Theme: ${snapshot.theme}; streaming ${snapshot.stream ? 'on' : 'off'}; line numbers ${snapshot.lineNumbers}.`, fg: PALETTE.info },
      { text: `Messages: operational ${snapshot.operationalMessages}; system ${snapshot.systemMessages}.`, fg: PALETTE.info },
      { text: `Release channel: ${snapshot.releaseChannel}.`, fg: PALETTE.muted },
    );
  } else if (category.id === 'onboarding-channels') {
    const enabledCount = snapshot.channels.filter((channel) => channel.enabled).length;
    const readyCount = snapshot.channels.filter((channel) => channel.ready).length;
    const needsConfig = snapshot.channels.filter((channel) => channel.setupState === 'needs-config');
    const needsTarget = snapshot.channels.filter((channel) => channel.setupState === 'needs-target');
    base.push(
      { text: `Channels: ${readyCount}/${snapshot.channels.length} ready; ${enabledCount} enabled.`, fg: enabledCount > 0 ? PALETTE.info : PALETTE.muted },
      { text: `Needs config: ${needsConfig.length}; needs target: ${needsTarget.length}.`, fg: needsConfig.length > 0 || needsTarget.length > 0 ? PALETTE.warn : PALETTE.good },
      { text: 'Enable only the channels you want; hidden channel fields appear after the channel is enabled.', fg: PALETTE.good },
    );
  } else if (category.id === 'onboarding-voice-media') {
    const readiness = snapshot.voiceMediaReadiness;
    base.push(
      { text: `Voice: ${snapshot.voiceSurfaceEnabled ? 'enabled' : 'disabled'}; TTS ${snapshot.ttsProvider}; voice ${snapshot.ttsVoice}.`, fg: snapshot.voiceSurfaceEnabled ? PALETTE.good : PALETTE.info },
      { text: `Media readiness: ${readiness.readyMediaProviderCount}/${snapshot.mediaProviderCount}; generation providers ${snapshot.mediaGenerationProviderCount}.`, fg: readiness.readyMediaProviderCount > 0 ? PALETTE.good : PALETTE.muted },
      { text: `Telephony channel: ${snapshot.channels.find((channel) => channel.id === 'telephony')?.setupState ?? 'disabled'}.`, fg: PALETTE.info },
    );
  } else if (category.id === 'onboarding-context') {
    base.push(
      { text: `Local context: ${snapshot.localMemoryCount} memories, ${snapshot.localNoteCount} notes, ${snapshot.localPersonaCount} personas.`, fg: PALETTE.info },
      { text: `Skills: ${snapshot.enabledSkillCount}/${snapshot.localSkillCount} enabled; routines ${snapshot.enabledRoutineCount}/${snapshot.localRoutineCount} enabled.`, fg: PALETTE.info },
      { text: `Discovered files: personas ${snapshot.discoveredBehavior.personas.count}, skills ${snapshot.discoveredBehavior.skills.count}, routines ${snapshot.discoveredBehavior.routines.count}.`, fg: PALETTE.muted },
    );
  } else if (category.id === 'onboarding-automation') {
    base.push(
      { text: `Automation: ${snapshot.automationEnabled ? 'enabled' : 'disabled'}; max ${snapshot.automationMaxConcurrentRuns} concurrent; history ${snapshot.automationRunHistoryLimit}.`, fg: snapshot.automationEnabled ? PALETTE.good : PALETTE.muted },
      { text: `Timeout ${snapshot.automationDefaultTimeoutMs} ms; catch-up ${snapshot.automationCatchUpWindowMinutes} min; cooldown ${snapshot.automationFailureCooldownMs} ms.`, fg: PALETTE.info },
      { text: `Delete one-shot jobs after success: ${snapshot.automationDeleteAfterRun ? 'yes' : 'no'}.`, fg: snapshot.automationDeleteAfterRun ? PALETTE.info : PALETTE.muted },
    );
  } else if (category.id === 'research') {
    base.push(
      { text: `Research route: ${snapshot.provider} / ${snapshot.modelDisplayName}; Knowledge: ${snapshot.knowledgeRoute}.`, fg: PALETTE.info },
      { text: `Browser: ${snapshot.voiceMediaReadiness.browserToolState}; public URL ${snapshot.browserToolPublicBaseUrl}.`, fg: snapshot.browserToolExposureEnabled ? PALETTE.warn : PALETTE.muted },
      { text: `Research runs: ${snapshot.researchRunRunningCount} running; ${snapshot.researchRunPausedCount} paused; ${snapshot.researchRunBlockedCount} blocked; ${snapshot.researchRunPlannedCount} planned.`, fg: snapshot.researchRunRunningCount > 0 || snapshot.researchRunBlockedCount > 0 ? PALETTE.warn : snapshot.researchRunPausedCount > 0 || snapshot.researchRunPlannedCount > 0 ? PALETTE.info : PALETTE.muted },
      { text: `Source queue: ${snapshot.researchSourceCandidateCount} candidate; ${snapshot.researchSourceReviewedCount} reviewed; ${snapshot.researchSourceRejectedCount} rejected; ${snapshot.researchSourceUsedCount} used.`, fg: snapshot.researchSourceCandidateCount > 0 ? PALETTE.warn : snapshot.researchSourceReviewedCount > 0 ? PALETTE.good : PALETTE.muted },
      { text: 'Web and URL inspection stay read-only until the user confirms source ingest.', fg: PALETTE.good },
      { text: 'Run state uses agent_research_runs; source review uses agent_research_sources; reports use agent_research_report.', fg: PALETTE.good },
    );
  } else if (category.id === 'personal-ops') {
    const ready = readyRoutineItems(snapshot);
    const readyChannels = snapshot.channels.filter((channel) => channel.ready).length;
    const enabledChannels = snapshot.channels.filter((channel) => channel.enabled).length;
    const configuredTargets = snapshot.channels.filter((channel) => channel.defaultTarget === 'configured').length;
    base.push(
      { text: `Personal Ops: notes ${snapshot.localNoteCount}; routines ${snapshot.localRoutineCount}/${snapshot.enabledRoutineCount}; schedule-ready ${ready.length}.`, fg: PALETTE.info },
      { text: `Tasks: work plan and host task inspection; reminders via confirmed schedules; receipts ${snapshot.routineScheduleReceiptCount}.`, fg: PALETTE.good },
      { text: 'Autonomy queue: inspect owners, status, and cancel/recovery routes before adding background work.', fg: PALETTE.good },
      { text: `Delivery: ${readyChannels}/${snapshot.channels.length} channels ready; ${enabledChannels} enabled; ${configuredTargets} configured target(s).`, fg: readyChannels > 0 ? PALETTE.good : PALETTE.warn },
      { text: 'Email/calendar: connector setup needed before inbox triage or agenda workflows are first-class.', fg: PALETTE.warn },
      { text: 'Model route: agent_harness mode:"personal_ops" or personal_ops_lane.', fg: PALETTE.muted },
    );
  } else if (category.id === 'artifacts') {
    const mediaReady = snapshot.voiceMediaReadiness.readyMediaProviderCount;
    base.push(
      { text: `Chat: ${snapshot.provider} / ${snapshot.modelDisplayName}; Knowledge: ${snapshot.knowledgeRoute}`, fg: PALETTE.info },
      { text: `Media: ${mediaReady}/${snapshot.mediaProviderCount} ready; generation ${snapshot.mediaGenerationProviderCount}.`, fg: mediaReady > 0 ? PALETTE.good : PALETTE.warn },
      { text: 'Files: attach, export, inspect, ingest reviewed sources, or generate media.', fg: PALETTE.good },
      { text: 'Knowledge ingest and media generation require explicit actions.', fg: PALETTE.warn },
    );
  } else if (category.id === 'channels') {
    const enabledCount = snapshot.channels.filter((channel) => channel.enabled).length;
    const readyCount = snapshot.channels.filter((channel) => channel.ready).length;
    const configuredDefaults = snapshot.channels.filter((channel) => channel.defaultTarget === 'configured').length;
    const needsTarget = snapshot.channels.filter((channel) => channel.setupState === 'needs-target');
    const needsConfig = snapshot.channels.filter((channel) => channel.setupState === 'needs-config');
    const nextAttentionChannel = needsConfig[0] ?? needsTarget[0] ?? snapshot.channels.find((channel) => !channel.enabled);
    base.push(
      { text: `API: ${snapshot.runtimeBaseUrl}`, fg: PALETTE.info },
      companionAccessLine(snapshot),
      { text: `Channels: ${readyCount}/${snapshot.channels.length} ready; ${enabledCount} enabled; ${configuredDefaults} target(s).`, fg: PALETTE.info },
      { text: `Next: ${nextAttentionChannel ? `${nextAttentionChannel.label} - ${compactText(nextAttentionChannel.nextStep)}` : 'All enabled channels ready.'}`, fg: nextAttentionChannel ? PALETTE.warn : PALETTE.good },
      { text: 'Secrets hidden; sends require explicit action.', fg: PALETTE.warn },
    );
  } else if (category.id === 'knowledge') {
    base.push(
      { text: `Route: ${snapshot.knowledgeRoute}; isolation ${snapshot.knowledgeIsolation}.`, fg: PALETTE.info },
      { text: 'Ask/search, ingest, review, reindex, and reports stay Agent-owned.', fg: PALETTE.good },
      { text: 'Ingest requires explicit confirmation.', fg: PALETTE.warn },
    );
  } else if (category.id === 'documents') {
    const mediaReady = snapshot.voiceMediaReadiness.readyMediaProviderCount;
    base.push(
      { text: `Document route: ${snapshot.provider} / ${snapshot.modelDisplayName}; Knowledge: ${snapshot.knowledgeRoute}`, fg: PALETTE.info },
      { text: `Files: attach, paste, source ingest, and export; artifact limit ${formatMegabytes(snapshot.artifactMaxBytes)}.`, fg: PALETTE.good },
      { text: `Media artifacts: ${mediaReady}/${snapshot.mediaProviderCount} providers ready; generation ${snapshot.mediaGenerationProviderCount}.`, fg: mediaReady > 0 ? PALETTE.good : PALETTE.warn },
      { text: 'Versioned drafts, review comments, AI suggestion review, artifact attachment/insertion, artifact browser, and Knowledge promotion are available.', fg: PALETTE.good },
      { text: 'Compare artifact reuse, review/judgment, analytics, export, and route update are available.', fg: PALETTE.good },
      { text: 'Saved artifact export-to-file and package export are available.', fg: PALETTE.good },
      { text: 'Model route: agent_harness mode:"document_ops" or document_ops_lane.', fg: PALETTE.muted },
    );
  } else if (category.id === 'tools') {
    base.push(
      { text: `MCP servers: ${snapshot.mcpConnectedServerCount}/${snapshot.mcpServerCount} connected; quarantined ${snapshot.mcpQuarantinedServerCount}; allow-all ${snapshot.mcpAllowAllServerCount}.`, fg: snapshot.mcpQuarantinedServerCount > 0 || snapshot.mcpAllowAllServerCount > 0 ? PALETTE.warn : PALETTE.info },
      { text: 'Add/update/reload and trust changes require confirmation.', fg: PALETTE.good },
      { text: 'Start: /mcp review, /mcp tools, /mcp config, Add MCP server.', fg: PALETTE.muted },
    );
  } else if (category.id === 'voice-media') {
    const readiness = snapshot.voiceMediaReadiness;
    base.push(
      { text: `Voice: ${readiness.readyVoiceProviderCount}/${snapshot.voiceProviderCount} ready; TTS ${snapshot.ttsProvider}; voice ${snapshot.ttsVoice}.`, fg: readiness.readyVoiceProviderCount > 0 ? PALETTE.good : PALETTE.warn },
      { text: `Media: ${readiness.readyMediaProviderCount}/${snapshot.mediaProviderCount} ready; generation ${snapshot.mediaGenerationProviderCount}.`, fg: readiness.readyMediaProviderCount > 0 ? PALETTE.good : PALETTE.warn },
      { text: `Browser: ${readiness.browserToolState}; public URL ${snapshot.browserToolPublicBaseUrl}.`, fg: snapshot.browserToolExposureEnabled ? PALETTE.warn : PALETTE.muted },
      { text: readiness.nextSteps[0] ? `Next: ${compactText(readiness.nextSteps[0])}` : 'Next: voice/media setup is ready.', fg: readiness.nextSteps.length > 0 ? PALETTE.info : PALETTE.good },
      { text: 'Secrets hidden; voice, browser, and media side effects require explicit action.', fg: PALETTE.warn },
    );
  } else if (category.id === 'profiles') {
    const defaultProfile = snapshot.selectedRuntimeProfile
      ? `${snapshot.selectedRuntimeProfile}${snapshot.selectedRuntimeProfileExists ? '' : ' (missing)'}`
      : '(base Agent home)';
    base.push(
      { text: `Profiles: active ${snapshot.activeRuntimeProfile}; default ${defaultProfile}.`, fg: snapshot.selectedRuntimeProfileExists || !snapshot.selectedRuntimeProfile ? PALETTE.info : PALETTE.warn },
      { text: `Local profiles: ${snapshot.runtimeProfileCount}; starters ${snapshot.runtimeStarterTemplateCount}; custom ${snapshot.localStarterTemplateCount}.`, fg: PALETTE.info },
      { text: `Starter ids: ${truncateDisplay(snapshot.runtimeStarterTemplates.map((template) => template.id).join(', ') || 'none', 96, '...')}`, fg: PALETTE.muted },
      { text: 'Profiles isolate local Agent config, sessions, memory, personas, skills, routines, setup, and bundles.', fg: PALETTE.good },
    );
  } else if (category.id === 'memory') {
    const behaviorNeedsSetup = [
      ...snapshot.localSkills,
      ...snapshot.localSkillBundles,
      ...snapshot.localRoutines,
    ].filter((item) => (item.missingRequirementCount ?? 0) > 0).length;
    const injectedNeedsReview = [
      ...snapshot.localPersonas.filter((item) => item.active),
      ...snapshot.localSkills.filter((item) => item.enabled),
      ...snapshot.localSkillBundles.filter((item) => item.enabled),
      ...snapshot.localRoutines.filter((item) => item.enabled),
    ].filter((item) => item.reviewState !== 'reviewed').length;
    base.push(
      { text: `Memory: ${snapshot.localMemoryCount}; prompt ${snapshot.localMemoryPromptActiveCount}; queue ${snapshot.localMemoryReviewQueueCount}; session ${snapshot.sessionMemoryCount}.`, fg: PALETTE.info },
      { text: `Notes: ${snapshot.localNoteCount}; skills ${snapshot.localSkillCount}/${snapshot.enabledSkillCount}; routines ${snapshot.localRoutineCount}/${snapshot.enabledRoutineCount}; personas ${snapshot.localPersonaCount}.`, fg: PALETTE.info },
      { text: `Learning curator: memory queue ${snapshot.localMemoryReviewQueueCount}; note queue ${snapshot.localNoteReviewQueueCount}; setup gaps ${behaviorNeedsSetup}; injected review ${injectedNeedsReview}.`, fg: behaviorNeedsSetup > 0 || injectedNeedsReview > 0 ? PALETTE.warn : PALETTE.good },
      { text: `Active persona: ${snapshot.activePersonaName}.`, fg: PALETTE.info },
      ...compactLocalLibraryLines('Agent Memory', snapshot.localMemories, 'Create one with Create memory.', workspace.selectedLocalLibraryItem('memory')?.id ?? null),
      { text: 'Secrets are rejected or redacted; use secret references.', fg: PALETTE.warn },
    );
  } else if (category.id === 'notes') {
    base.push(
      { text: `Scratchpad notes: ${snapshot.localNoteCount}; review queue: ${snapshot.localNoteReviewQueueCount}`, fg: PALETTE.info },
      ...compactLocalLibraryLines('Scratchpad Notes', snapshot.localNotes, 'Create one with Create note.', workspace.selectedLocalLibraryItem('note')?.id ?? null),
      { text: 'Notes stay local unless promoted by explicit action.', fg: PALETTE.warn },
    );
  } else if (category.id === 'personas') {
    base.push(
      { text: `Personas: ${snapshot.localPersonaCount}; active: ${snapshot.activePersonaName}`, fg: PALETTE.info },
      ...compactLocalLibraryLines('Persona Library', snapshot.localPersonas, 'Create one with Create persona.', workspace.selectedLocalLibraryItem('persona')?.id ?? null),
      { text: 'Personas shape the serial main-conversation assistant.', fg: PALETTE.good },
    );
  } else if (category.id === 'skills') {
    base.push(
      { text: `Skills: ${snapshot.localSkillCount}; enabled: ${snapshot.enabledSkillCount}; bundles: ${snapshot.localSkillBundleCount}; enabled bundles: ${snapshot.enabledSkillBundleCount}; active skills: ${snapshot.activeSkillCount}`, fg: PALETTE.info },
      ...compactLocalLibraryLines('Skill Library', snapshot.localSkills, 'Create one with Create skill.', workspace.selectedLocalLibraryItem('skill')?.id ?? null),
      ...compactLocalLibraryLines('Skill Bundles', snapshot.localSkillBundles, 'Create one after adding skills.', null),
      { text: 'Enabled skills/bundles become operating guidance; secrets are rejected.', fg: PALETTE.warn },
    );
  } else if (category.id === 'routines') {
    const ready = readyRoutineItems(snapshot);
    const needsSetup = routinesNeedingSetup(snapshot);
    const needsReview = routinesNeedingReview(snapshot);
    base.push(
      { text: `Routines: ${snapshot.localRoutineCount}; enabled: ${snapshot.enabledRoutineCount}`, fg: PALETTE.info },
      { text: `Schedule-ready routines: ${ready.length}; setup gaps: ${needsSetup.length}; review needed: ${needsReview.length}`, fg: needsSetup.length > 0 || needsReview.length > 0 ? PALETTE.warn : PALETTE.good },
      routineNextActionLine(snapshot),
      compactRoutineReceiptLine(snapshot),
      ...compactLocalLibraryLines('Routine Library', snapshot.localRoutines, 'Create one with Create routine.', workspace.selectedLocalLibraryItem('routine')?.id ?? null),
      { text: 'Scheduling requires a confirmed action.', fg: PALETTE.warn },
    );
  } else if (category.id === 'work') {
    base.push(
      { text: 'Work plans and approvals are read or explicitly confirmed.', fg: PALETTE.info },
      { text: 'Autonomy queue covers work plan, host tasks, approvals, automation, schedules, routines, delegation, and delivery.', fg: PALETTE.good },
      { text: 'Selection alone does not approve, deny, cancel, or mutate requests.', fg: PALETTE.good },
      { text: 'Approval actions require id plus typed confirmation.', fg: PALETTE.warn },
    );
  } else if (category.id === 'automation') {
    const ready = readyRoutineItems(snapshot);
    base.push(
      { text: `Automation: ${ready.length} schedule-ready routine(s); receipts ${snapshot.routineScheduleReceiptCount}.`, fg: ready.length > 0 ? PALETTE.good : PALETTE.warn },
      automationNextActionLine(snapshot),
      compactRoutineReceiptLine(snapshot),
      { text: 'Autonomy queue: review visible schedules, runs, receipts, and cancel routes first.', fg: PALETTE.good },
      { text: 'Reminders and routine promotion require confirmation.', fg: PALETTE.warn },
    );
  } else if (category.id === 'delegate') {
    base.push(
      { text: 'Build/fix/review work is handed to GoodVibes TUI.', fg: PALETTE.info },
      { text: `Delegated review policy: ${snapshot.delegatedReviewPolicy}`, fg: PALETTE.warn },
      { text: 'No coding-role Agent jobs are created here.', fg: PALETTE.good },
    );
  } else if (category.id === 'finish') {
    base.push(
      { text: 'Apply & close marks onboarding finished for this user.', fg: PALETTE.good },
      { text: 'Future normal launches start in the main conversation.', fg: PALETTE.info },
      { text: 'Use /agent, /setup, or /onboarding to reopen this workspace later.', fg: PALETTE.muted },
    );
  }
  if (snapshot.warnings.length > 0) {
    base.push({ text: `Warnings: ${snapshot.warnings.map((warning) => compactText(warning, 60)).join('; ')}`, fg: PALETTE.warn });
  }
  return base;
}

function editorContextLines(editor: AgentWorkspaceLocalEditor): ContextLine[] {
  const selected = editor.fields[editor.selectedFieldIndex];
  const lines: ContextLine[] = [
    { text: editor.title, fg: PALETTE.title, bold: true },
    { text: compactText(editor.message), fg: editor.message.includes('required') || editor.message.includes('cannot') || editor.message.includes('Cannot') ? PALETTE.warn : PALETTE.info },
    { text: 'Enter next/save; Ctrl-J newline; Esc cancel.', fg: PALETTE.muted },
  ];
  if (selected) {
    lines.push(
      { text: `Editing: ${selected.label}${selected.required ? ' (required)' : ''}`, fg: PALETTE.title, bold: true },
      { text: compactText(selected.hint), fg: PALETTE.muted },
    );
  }
  return lines;
}

function buildContextRows(workspace: AgentWorkspace, category: AgentWorkspaceCategory, action: AgentWorkspaceAction | null, width: number): WorkspaceRow[] {
  const lines: ContextLine[] = [
    { text: category.label, fg: PALETTE.title, bold: true },
    { text: category.summary, fg: PALETTE.subtitle },
    ...(workspace.actionSearchActive ? [
      { text: 'Action Search', fg: PALETTE.title, bold: true },
      {
        text: workspace.actionSearchQuery.length > 0
          ? `Query: ${workspace.actionSearchQuery} (${workspace.actionSearchResults.length} result${workspace.actionSearchResults.length === 1 ? '' : 's'})`
          : 'Type to search every Agent workspace action.',
        fg: workspace.actionSearchQuery.length > 0 && workspace.actionSearchResults.length === 0 ? PALETTE.warn : PALETTE.info,
      },
      { text: 'Enter opens; Esc clears.', fg: PALETTE.muted },
    ] satisfies ContextLine[] : []),
    ...(workspace.localEditor ? editorContextLines(workspace.localEditor) : []),
  ];

  const selectedActionLines: ContextLine[] = action
    ? [
      { text: `Selected: ${action.label}`, fg: PALETTE.title, bold: true },
      actionMetaLine(action),
    ]
    : [];
  const snapshotContextLines = snapshotLines(workspace, category, workspace.runtimeSnapshot);
  lines.push(...selectedActionLines, ...snapshotContextLines);

  if (workspace.lastActionResult) {
    lines.push(
      { text: 'Action Result', fg: PALETTE.title, bold: true },
      { text: workspace.lastActionResult.title, fg: actionResultColor(workspace.lastActionResult), bold: true },
      { text: compactText(workspace.lastActionResult.detail), fg: PALETTE.text },
    );
    if (workspace.lastActionResult.command) {
      lines.push({ text: `Command: ${workspace.lastActionResult.command}`, fg: PALETTE.muted });
    }
  }

  return lines.flatMap((entry): WorkspaceRow[] => {
    if (entry.text.length === 0) return [{ text: '', kind: 'empty', dim: true }];
    return wrapText(entry.text, Math.max(1, width)).map((text, index): WorkspaceRow => ({
      text,
      fg: entry.fg,
      bold: entry.bold && index === 0,
      dim: entry.dim,
    }));
  });
}

function buildEditorRows(editor: AgentWorkspaceLocalEditor, width: number, height: number): WorkspaceRow[] {
  const rows: WorkspaceRow[] = [
    { text: editor.title, fg: PALETTE.title, bold: true },
    { text: editor.message, fg: PALETTE.info },
    { text: '' },
  ];
  const footerRows: WorkspaceRow[] = [
    { text: '' },
    { text: 'Enter next/save · Up/Down field · Backspace edit · Ctrl-J newline · Esc cancel', fg: PALETTE.muted },
  ];
  const visibleFields = Math.max(1, Math.floor(Math.max(1, height - rows.length - footerRows.length) / 3));
  const window = stableWindow(editor.fields.length, editor.selectedFieldIndex, visibleFields);
  if (window.start > 0) rows.push({ text: `${GLYPHS.navigation.moreAbove} ${window.start} more field(s) above`, kind: 'more', fg: PALETTE.dim, dim: true });
  for (let index = window.start; index < window.end; index += 1) {
    rows.push(...buildEditorFieldRows(editor, index, width));
  }
  if (window.end < editor.fields.length) rows.push({ text: `${GLYPHS.navigation.moreBelow} ${editor.fields.length - window.end} more field(s) below`, kind: 'more', fg: PALETTE.dim, dim: true });
  rows.push(...footerRows);
  while (rows.length < height) rows.push({ text: '', kind: 'empty' });
  return rows.slice(0, height);
}

function buildEditorFieldRows(editor: AgentWorkspaceLocalEditor, index: number, width: number): WorkspaceRow[] {
  const field = editor.fields[index]!;
  const selected = index === editor.selectedFieldIndex;
  const marker = selected ? GLYPHS.navigation.selected : ' ';
  const required = field.required ? ' *' : '';
  const value = field.value.length > 0
    ? field.redact ? '*'.repeat(Math.min(12, Math.max(6, Array.from(field.value).length))) : field.value
    : '(empty)';
  const color = selected ? PALETTE.text : field.value.length > 0 ? PALETTE.info : PALETTE.muted;
  const rows: WorkspaceRow[] = [{
    text: `${marker} ${field.label}${required}`,
    selected,
    fg: color,
    bold: selected,
  }];
  const valueLines = value.split('\n');
  for (const valueLine of valueLines.slice(0, 4)) {
    for (const wrapped of wrapText(`  ${valueLine}`, Math.max(1, width - 2))) {
      rows.push({ text: wrapped, fg: field.value.length > 0 ? PALETTE.text : PALETTE.dim, dim: field.value.length === 0 });
    }
  }
  if (valueLines.length > 4) rows.push({ text: `  ${valueLines.length - 4} more line(s)`, fg: PALETTE.dim, dim: true });
  rows.push({ text: `  ${field.hint}`, fg: PALETTE.dim, dim: true });
  return rows;
}

function buildActionRows(workspace: AgentWorkspace, width: number, height: number): WorkspaceRow[] {
  if (workspace.localEditor) return buildEditorRows(workspace.localEditor, width, height);
  const rows: WorkspaceRow[] = [];
  const labelWidth = Math.min(34, Math.max(18, Math.floor(width * 0.38)));
  const commandWidth = Math.max(10, width - labelWidth - 6);
  if (workspace.actionSearchActive) {
    rows.push({
      text: `  Search: ${workspace.actionSearchQuery || '(type to filter actions)'}`,
      fg: workspace.actionSearchQuery.length > 0 && workspace.actions.length === 0 ? PALETTE.warn : PALETTE.info,
      bold: true,
    });
  }
  rows.push({
    text: `  ${padDisplay(workspace.actionSearchActive ? 'Result' : 'Action', labelWidth)}  ${padDisplay('Does', commandWidth)}`,
    fg: PALETTE.muted,
    bold: true,
  });

  const actions = workspace.actions;
  const visible = Math.max(1, height - (workspace.actionSearchActive ? 3 : 2));
  const window = stableWindow(actions.length, workspace.selectedActionIndex, visible);
  if (window.start > 0) rows.push({ text: `${GLYPHS.navigation.moreAbove} ${window.start} more action(s) above`, kind: 'more', fg: PALETTE.dim, dim: true });

  for (let index = window.start; index < window.end; index += 1) {
    const action = actions[index]!;
    const selected = index === workspace.selectedActionIndex;
    const searchResult = workspace.actionSearchActive ? workspace.actionSearchResults[index] : null;
    const label = searchResult ? `${searchResult.category.label} / ${action.label}` : action.label;
    const marker = selected ? GLYPHS.navigation.selected : ' ';
    rows.push({
      text: `${marker} ${padDisplay(label, labelWidth)}  ${padDisplay(actionCommand(action), commandWidth)}`,
      selected: selected && workspace.focusPane === 'actions',
      fg: action.safety === 'blocked' ? PALETTE.warn : selected ? PALETTE.text : PALETTE.info,
      bold: selected,
    });
  }

  if (window.end < actions.length) rows.push({ text: `${GLYPHS.navigation.moreBelow} ${actions.length - window.end} more action(s) below`, kind: 'more', fg: PALETTE.dim, dim: true });
  rows.push({ text: '' });
  rows.push({ text: `Status: ${workspace.status}`, fg: PALETTE.muted });
  if (workspace.lastActionResult) {
    rows.push({ text: '' });
    rows.push({ text: `Action Result: ${workspace.lastActionResult.title}`, fg: actionResultColor(workspace.lastActionResult), bold: true });
    for (const line of wrapText(workspace.lastActionResult.detail, Math.max(1, width - 2))) {
      rows.push({ text: `  ${line}`, fg: PALETTE.text });
    }
    if (workspace.lastActionResult.command) {
      rows.push({ text: `  Command: ${workspace.lastActionResult.command}`, fg: PALETTE.muted });
    }
  }

  while (rows.length < height) rows.push({ text: '', kind: 'empty' });
  return rows.slice(0, height);
}

function footerText(workspace: AgentWorkspace): string {
  if (workspace.localEditor) {
    return `Agent workspace · editing ${workspace.localEditor.kind} · Enter next/save · Ctrl-J newline · Esc cancel`;
  }
  if (workspace.actionSearchActive) {
    return 'Agent workspace · action search · type filter · Up/Down results · Enter open · Esc clear';
  }
  const focus = workspace.focusPane === 'categories' ? 'categories' : 'actions';
  return `Agent workspace · ${focus} · / search · Up/Down · Left/Right · Ctrl+[/] area · Enter open/action · R refresh · Esc close`;
}

export function renderAgentWorkspace(workspace: AgentWorkspace, width: number, height: number): Line[] {
  const category = workspace.selectedActionCategory;
  const action = workspace.selectedAction;
  const layoutOptions = {
    width,
    height,
    leftWidth: width < 90 ? undefined : 30,
    contextRatio: 0.4,
    minContextRows: 10,
  };
  const metrics = getFullscreenWorkspaceMetrics(layoutOptions);

  return renderFullscreenWorkspace({
    width,
    height,
    title: 'GoodVibes Agent / Operator Workspace',
    stateLabel: workspace.localEditor ? 'Editor' : workspace.actionSearchActive ? 'Search' : workspace.focusPane === 'categories' ? 'Categories' : 'Actions',
    leftHeader: 'Operator Areas',
    mainHeader: workspace.actionSearchActive
      ? `Search actions · ${workspace.actions.length} result(s)`
      : `${category.label} · ${workspace.actions.length} action(s)`,
    leftRows: buildLeftRows(workspace, metrics.bodyRows),
    contextRows: buildContextRows(workspace, category, action, metrics.contextWidth),
    controlRows: buildActionRows(workspace, metrics.contextWidth, metrics.controlRows),
    footer: footerText(workspace),
    leftWidth: layoutOptions.leftWidth,
    contextRatio: layoutOptions.contextRatio,
    minContextRows: layoutOptions.minContextRows,
  });
}
