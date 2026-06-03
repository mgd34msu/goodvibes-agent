import type {
  AgentWorkspace,
  AgentWorkspaceAction,
  AgentWorkspaceActionResult,
  AgentWorkspaceCategory,
  AgentWorkspaceLocalEditor,
  AgentWorkspaceRuntimeSnapshot,
} from '../input/agent-workspace.ts';
import type { Line } from '../types/grid.ts';
import { wrapText } from '../utils/terminal-width.ts';
import { GLYPHS } from './ui-primitives.ts';
import {
  getFullscreenWorkspaceMetrics,
  padDisplay,
  renderFullscreenWorkspace,
  stableWindow,
  WORKSPACE_PALETTE as PALETTE,
  type WorkspaceRow,
} from './fullscreen-workspace.ts';

function safetyColor(action: AgentWorkspaceAction): string {
  if (action.safety === 'safe') return PALETTE.good;
  if (action.safety === 'read-only') return PALETTE.info;
  if (action.safety === 'delegates') return PALETTE.warn;
  return PALETTE.bad;
}

function actionResultColor(result: AgentWorkspaceActionResult): string {
  if (result.kind === 'blocked' || result.kind === 'error') return PALETTE.bad;
  if (result.kind === 'dispatched') return PALETTE.info;
  if (result.kind === 'refreshed') return PALETTE.good;
  return PALETTE.muted;
}

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
  if (action.kind === 'workspace') return action.targetCategoryId ? `open ${action.targetCategoryId}` : '(workspace)';
  if (action.kind === 'editor') return action.editorKind ? `edit ${action.editorKind}` : '(editor)';
  if (action.kind === 'local-selection') return action.selectionDelta && action.selectionDelta < 0 ? 'select previous' : 'select next';
  if (action.kind === 'local-operation') return action.localOperation ?? '(local action)';
  return action.command ?? '(guidance)';
}

type ContextLine = { readonly text: string; readonly fg?: string; readonly bold?: boolean; readonly dim?: boolean };

function setupStatusColor(status: AgentWorkspaceRuntimeSnapshot['setupChecklist'][number]['status']): string {
  if (status === 'ready') return PALETTE.good;
  if (status === 'recommended') return PALETTE.warn;
  if (status === 'blocked') return PALETTE.bad;
  return PALETTE.muted;
}

function setupChecklistLines(snapshot: AgentWorkspaceRuntimeSnapshot): ContextLine[] {
  const readyCount = snapshot.setupChecklist.filter((item) => item.status === 'ready').length;
  const recommendedCount = snapshot.setupChecklist.filter((item) => item.status === 'recommended').length;
  const blockedCount = snapshot.setupChecklist.filter((item) => item.status === 'blocked').length;
  const lines: ContextLine[] = [
    { text: 'Setup Checklist', fg: PALETTE.title, bold: true },
    { text: `${readyCount}/${snapshot.setupChecklist.length} ready; ${recommendedCount} recommended; ${blockedCount} blocked`, fg: blockedCount > 0 ? PALETTE.warn : PALETTE.info },
  ];
  for (const item of snapshot.setupChecklist) {
    const command = item.command ? ` -> ${item.command}` : '';
    lines.push({
      text: `${item.status.toUpperCase()} ${item.label}${command}`,
      fg: setupStatusColor(item.status),
      bold: item.status === 'blocked',
    });
    lines.push({ text: `  ${item.detail}`, fg: PALETTE.muted });
  }
  return lines;
}

function homeNextActionLines(snapshot: AgentWorkspaceRuntimeSnapshot): ContextLine[] {
  const blocked = snapshot.setupChecklist.filter((item) => item.status === 'blocked');
  const recommended = snapshot.setupChecklist.filter((item) => item.status === 'recommended');
  const optional = snapshot.setupChecklist.filter((item) => item.status === 'optional');
  const candidates = [...blocked, ...recommended, ...optional].slice(0, 5);
  if (candidates.length === 0) {
    return [
      { text: 'Next Actions', fg: PALETTE.title, bold: true },
      { text: 'Core setup is ready. Continue normal assistant work, review Knowledge sources, or tune local skills/routines as needed.', fg: PALETTE.good },
    ];
  }
  const lines: ContextLine[] = [{ text: 'Next Actions', fg: PALETTE.title, bold: true }];
  for (const item of candidates) {
    const command = item.command ? ` -> ${item.command}` : '';
    lines.push({
      text: `${item.status.toUpperCase()} ${item.label}${command}`,
      fg: setupStatusColor(item.status),
      bold: item.status === 'blocked',
    });
    lines.push({ text: `  ${item.detail}`, fg: PALETTE.muted });
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
    text: `Companion: ${access.surface}; token ${tokenState}; QR ${access.qrCommand}; manual token text hidden${error}.`,
    fg: access.pairingReady ? PALETTE.good : PALETTE.warn,
  };
}

function discoverySummaryLine(label: string, summary: AgentWorkspaceRuntimeSnapshot['discoveredBehavior']['personas'], actionLabel: string): ContextLine[] {
  if (summary.count === 0) return [];
  const names = summary.names.length > 0
    ? ` ${summary.names.join(', ')}${summary.count > summary.names.length ? `, +${summary.count - summary.names.length} more` : ''}.`
    : '';
  return [
    { text: `${label}: ${summary.count} discovered; project ${summary.projectLocalCount}; global ${summary.globalCount}.`, fg: PALETTE.info, bold: true },
    { text: `  Choose ${actionLabel} to preview, then use the import form after review.${names}`, fg: PALETTE.muted },
  ];
}

function behaviorDiscoveryLines(snapshot: AgentWorkspaceRuntimeSnapshot): ContextLine[] {
  const lines: ContextLine[] = [
    ...discoverySummaryLine('Discovered personas', snapshot.discoveredBehavior.personas, 'Personas -> Discover persona files'),
    ...discoverySummaryLine('Discovered skills', snapshot.discoveredBehavior.skills, 'Skills -> Discover skill files'),
    ...discoverySummaryLine('Discovered routines', snapshot.discoveredBehavior.routines, 'Routines -> Discover routine files'),
  ];
  if (lines.length === 0) return [];
  return [
    { text: '' },
    { text: 'Discovered Behavior Files', fg: PALETTE.title, bold: true },
    ...lines,
  ];
}

function localLibraryLines(
  title: string,
  items: readonly AgentWorkspaceRuntimeSnapshot['localPersonas'][number][],
  emptyText: string,
  selectedId: string | null,
): ContextLine[] {
  const lines: ContextLine[] = [
    { text: title, fg: PALETTE.title, bold: true },
  ];
  if (items.length === 0) {
    lines.push({ text: emptyText, fg: PALETTE.warn });
    return lines;
  }
  for (const item of items.slice(0, 8)) {
    const selected = item.id === selectedId;
    const status = [
      selected ? 'selected' : '',
      item.active ? 'active' : '',
      item.enabled === true ? 'enabled' : item.enabled === false ? 'disabled' : '',
      item.scope && item.cls ? `${item.scope}/${item.cls}` : '',
      item.confidence !== undefined ? `${item.confidence}%` : '',
      item.requirementCount !== undefined && item.requirementCount > 0
        ? (item.missingRequirementCount && item.missingRequirementCount > 0 ? `needs ${item.missingRequirementCount}/${item.requirementCount}` : `ready ${item.requirementCount}/${item.requirementCount}`)
        : '',
      item.reviewState,
      item.startCount !== undefined ? `starts ${item.startCount}` : '',
    ].filter(Boolean).join(' / ');
    const tags = item.tags.length > 0 ? ` tags=${item.tags.join(',')}` : '';
    const triggers = item.triggers.length > 0 ? ` triggers=${item.triggers.join(',')}` : '';
    const marker = selected ? `${GLYPHS.navigation.selected} ` : '';
    lines.push({
      text: `${marker}${item.id}: ${item.name} (${status})`,
      fg: item.reviewState === 'stale' ? PALETTE.warn : PALETTE.info,
      bold: selected || item.active === true,
    });
    lines.push({ text: `  ${item.description}${tags}${triggers}`, fg: PALETTE.muted });
    if (item.missingRequirements && item.missingRequirements.length > 0) {
      lines.push({ text: `  missing setup: ${item.missingRequirements.join(', ')}`, fg: PALETTE.warn });
    }
  }
  if (items.length > 8) {
    lines.push({ text: `${items.length - 8} more item(s). Open the library command for the full list.`, fg: PALETTE.dim });
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

function routineScheduleReceiptLines(snapshot: AgentWorkspaceRuntimeSnapshot): ContextLine[] {
  const latest = snapshot.latestRoutineScheduleReceipt;
  const lines: ContextLine[] = [
    {
      text: `Promotion receipts: ${snapshot.routineScheduleReceiptCount}; created: ${snapshot.successfulRoutineScheduleReceiptCount}; failed: ${snapshot.failedRoutineScheduleReceiptCount}`,
      fg: snapshot.failedRoutineScheduleReceiptCount > 0 ? PALETTE.warn : PALETTE.info,
    },
  ];
  if (latest) {
    lines.push({
      text: `Latest receipt: ${latest.id} ${latest.status} routine=${latest.routineId} schedule="${latest.scheduleName}" ${latest.scheduleKind} ${latest.scheduleValue}`,
      fg: latest.status === 'failed' ? PALETTE.warn : PALETTE.good,
    });
  } else {
    lines.push({ text: 'No schedule promotion receipts yet. Confirm a routine promotion from Automation when ready.', fg: PALETTE.muted });
  }
  return lines;
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

function profileLines(snapshot: AgentWorkspaceRuntimeSnapshot): ContextLine[] {
  const lines: ContextLine[] = [
    { text: 'Agent Profiles', fg: PALETTE.title, bold: true },
  ];
  if (snapshot.runtimeProfiles.length === 0) {
    lines.push({ text: 'No isolated Agent profiles yet. Use Create Agent profile in this workspace.', fg: PALETTE.warn });
    return lines;
  }
  for (const profile of snapshot.runtimeProfiles.slice(0, 6)) {
    const starter = profile.starterTemplateId ? ` starter=${profile.starterTemplateId}` : ' starter=none';
    const created = profile.createdAt ? ` created=${profile.createdAt.slice(0, 10)}` : '';
    const states = [
      profile.id === snapshot.activeRuntimeProfile ? 'active' : '',
      profile.id === snapshot.selectedRuntimeProfile ? 'default' : '',
    ].filter(Boolean).join(', ');
    const stateText = states ? ` [${states}]` : '';
    lines.push({
      text: `${profile.id}${stateText}${starter}${created}`,
      fg: profile.id === snapshot.selectedRuntimeProfile ? PALETTE.good : PALETTE.info,
      bold: profile.id === snapshot.activeRuntimeProfile || profile.id === snapshot.selectedRuntimeProfile,
    });
    lines.push({ text: `  home: ${profile.homeDirectory}`, fg: PALETTE.muted });
  }
  if (snapshot.runtimeProfiles.length > 6) {
    lines.push({ text: `${snapshot.runtimeProfiles.length - 6} more profile(s).`, fg: PALETTE.dim });
  }
  return lines;
}

function starterTemplateLines(snapshot: AgentWorkspaceRuntimeSnapshot): ContextLine[] {
  const lines: ContextLine[] = [
    { text: 'Starter Templates', fg: PALETTE.title, bold: true },
  ];
  for (const template of snapshot.runtimeStarterTemplates.slice(0, 6)) {
    lines.push({
      text: `${template.id}: ${template.name} [${template.source}]`,
      fg: template.source === 'local' ? PALETTE.good : PALETTE.info,
      bold: template.id === 'research',
    });
    lines.push({
      text: `  ${template.description} Persona ${template.personaName}; skills ${template.skillNames.join(', ')}; routines ${template.routineNames.join(', ')}.`,
      fg: PALETTE.muted,
    });
  }
  if (snapshot.runtimeStarterTemplates.length > 6) {
    lines.push({ text: `${snapshot.runtimeStarterTemplates.length - 6} more starter template(s).`, fg: PALETTE.dim });
  }
  return lines;
}

function snapshotLines(workspace: AgentWorkspace, category: AgentWorkspaceCategory, snapshot: AgentWorkspaceRuntimeSnapshot | null): ContextLine[] {
  if (!snapshot) return [{ text: 'Runtime context is not loaded yet.', fg: PALETTE.warn }];
  const base: ContextLine[] = [{ text: 'Live Agent Context', fg: PALETTE.title, bold: true }];
  if (category.id === 'home') {
    base.push(
      { text: `Chat route: ${snapshot.provider} / ${snapshot.modelDisplayName}`, fg: PALETTE.info },
      { text: `Session: ${snapshot.sessionId}`, fg: PALETTE.muted },
      { text: `Policy: ${snapshot.executionPolicy}; WRFC ${snapshot.wrfcPolicy}`, fg: PALETTE.good },
      { text: `Knowledge: ${snapshot.knowledgeRoute}; ${snapshot.knowledgeIsolation}; no fallback`, fg: PALETTE.good },
      { text: `Local: ${snapshot.localMemoryCount} memory, ${snapshot.localNoteCount} notes, ${snapshot.localPersonaCount} personas, ${snapshot.localSkillCount} skills, ${snapshot.localRoutineCount} routines.`, fg: PALETTE.info },
      { text: `Channels: ${snapshot.channels.filter((channel) => channel.ready).length}/${snapshot.channels.length} ready; MCP ${snapshot.mcpConnectedServerCount}/${snapshot.mcpServerCount} connected; voice/media ${snapshot.voiceProviderCount}/${snapshot.mediaProviderCount}.`, fg: PALETTE.info },
      { text: '' },
      ...homeNextActionLines(snapshot),
    );
  } else if (category.id === 'setup') {
    base.push(
      { text: `Connection: ${snapshot.runtimeBaseUrl}`, fg: PALETTE.info },
      { text: 'Agent role: interactive operator TUI; setup changes here are Agent-local.', fg: PALETTE.good },
      ...setupChecklistLines(snapshot),
      ...behaviorDiscoveryLines(snapshot),
      { text: '' },
      { text: `Workspace: ${snapshot.workingDirectory}`, fg: PALETTE.muted },
      { text: `Home: ${snapshot.homeDirectory}`, fg: PALETTE.muted },
    );
  } else if (category.id === 'artifacts') {
    const mediaReady = snapshot.voiceMediaReadiness.readyMediaProviderCount;
    base.push(
      { text: `Chat route: ${snapshot.provider} / ${snapshot.modelDisplayName}`, fg: PALETTE.info },
      { text: `Agent Knowledge route: ${snapshot.knowledgeRoute}`, fg: PALETTE.info },
      { text: `Media providers: ${mediaReady}/${snapshot.mediaProviderCount} ready; generation-capable ${snapshot.mediaGenerationProviderCount}.`, fg: mediaReady > 0 ? PALETTE.good : PALETTE.warn },
      { text: 'Use this area for concrete files and generated output: attach images, export transcripts, ingest reviewed sources, inspect source records, and generate media.', fg: PALETTE.good },
      { text: 'Agent Knowledge ingest writes only to the isolated Agent segment. Default knowledge and non-Agent routes are not fallback storage.', fg: PALETTE.warn },
      { text: 'Generated media is stored as artifacts and referenced by id; the TUI should not print inline base64.', fg: PALETTE.muted },
      { text: `Workspace path: ${snapshot.workingDirectory}`, fg: PALETTE.muted },
    );
  } else if (category.id === 'channels') {
    const enabledCount = snapshot.channels.filter((channel) => channel.enabled).length;
    const readyCount = snapshot.channels.filter((channel) => channel.ready).length;
    const configuredDefaults = snapshot.channels.filter((channel) => channel.defaultTarget === 'configured').length;
    const readyChannels = snapshot.channels.filter((channel) => channel.ready).map((channel) => channel.label);
    const needsTarget = snapshot.channels.filter((channel) => channel.setupState === 'needs-target');
    const needsConfig = snapshot.channels.filter((channel) => channel.setupState === 'needs-config');
    const nextAttentionChannel = needsConfig[0] ?? needsTarget[0] ?? snapshot.channels.find((channel) => !channel.enabled);
    const disabledChannels = snapshot.channels.filter((channel) => !channel.enabled).map((channel) => channel.label);
    const disabledPreview = disabledChannels.slice(0, 6).join(', ');
    const disabledSuffix = disabledChannels.length > 6 ? `, +${disabledChannels.length - 6} more` : '';
    const orderedChannels = [
      ...snapshot.channels.filter((channel) => channel.enabled),
      ...snapshot.channels.filter((channel) => !channel.enabled),
    ].slice(0, 3);
    base.push(
      { text: `GoodVibes API: ${snapshot.runtimeBaseUrl}`, fg: PALETTE.info },
      companionAccessLine(snapshot),
      { text: `Readiness: ${readyCount}/${snapshot.channels.length} ready; ${enabledCount} enabled; ${configuredDefaults} default target(s) configured.`, fg: PALETTE.info },
      { text: 'Setup path: pair companion -> inspect readiness -> review accounts/policies/status -> fix one channel -> add explicit notification target if needed.', fg: PALETTE.good },
      { text: `Next channel action: ${nextAttentionChannel ? `${nextAttentionChannel.label} - ${nextAttentionChannel.nextStep}` : 'All enabled channels are ready; keep delivery explicit and review policies before sending.'}`, fg: nextAttentionChannel ? PALETTE.warn : PALETTE.good },
      { text: `Ready channels: ${readyChannels.join(', ') || 'none'}.`, fg: readyChannels.length > 0 ? PALETTE.good : PALETTE.warn },
      { text: `Needs default target: ${needsTarget.map((channel) => `${channel.label} -> ${channel.defaultTargetKeys.join('|')}`).join(', ') || 'none'}.`, fg: needsTarget.length > 0 ? PALETTE.warn : PALETTE.muted },
      { text: `Needs config: ${needsConfig.map((channel) => `${channel.label} -> ${channel.missingRequiredKeys.join('|')}`).join(', ') || 'none'}.`, fg: needsConfig.length > 0 ? PALETTE.warn : PALETTE.muted },
      { text: `Disabled channels: ${disabledPreview || 'none'}${disabledSuffix}.`, fg: PALETTE.dim },
      { text: 'Safety: no secret values; sends and public exposure require explicit user action and Agent policy.', fg: PALETTE.warn },
    );
    for (const channel of orderedChannels) {
      const ready = channel.ready ? 'ready' : `${channel.missingConfigCount} missing`;
      base.push({
        text: `${channel.label}: ${channel.setupState}; ${ready}; target ${channel.defaultTarget}; delivery ${channel.delivery}; risk ${channel.risk}.`,
        fg: channel.ready ? PALETTE.good : channel.enabled ? PALETTE.warn : PALETTE.dim,
      });
    }
  } else if (category.id === 'knowledge') {
    base.push(
      { text: `Route family: ${snapshot.knowledgeRoute}/{status,ask,search}`, fg: PALETTE.info },
      { text: `Isolation: ${snapshot.knowledgeIsolation}; no default knowledge or non-Agent fallback`, fg: PALETTE.good },
      { text: 'Ingest: URL, URL-list, and bookmark imports require explicit --yes and write only to Agent Knowledge.', fg: PALETTE.info },
      { text: 'Review: queue, issues, candidates, reports, reindex, and consolidation stay inside the Agent segment.', fg: PALETTE.muted },
      { text: 'Agent-owned content appears here only after explicit Agent knowledge ingestion.', fg: PALETTE.muted },
    );
  } else if (category.id === 'research') {
    base.push(
      { text: `Chat route: ${snapshot.provider} / ${snapshot.modelDisplayName}`, fg: PALETTE.info },
      { text: `Agent Knowledge route: ${snapshot.knowledgeRoute}`, fg: PALETTE.info },
      { text: `Browser tools: ${snapshot.voiceMediaReadiness.browserToolState}; public base URL ${snapshot.browserToolPublicBaseUrl}.`, fg: snapshot.browserToolExposureEnabled ? PALETTE.warn : PALETTE.muted },
      { text: snapshot.voiceMediaReadiness.browserToolNextStep, fg: PALETTE.muted },
      { text: 'Research requests are submitted to the main conversation. Agent may use connected read-only web tools when the user asks.', fg: PALETTE.good },
      { text: 'URL references and web research do not ingest into Agent Knowledge. Ingestion is a separate confirmed Agent Knowledge action.', fg: PALETTE.warn },
      { text: 'Use Agent Knowledge ask/search first for known source-backed context; use web research for current or external sources.', fg: PALETTE.info },
      { text: 'External sends, browser-side effects, package installs, and connected-host mutations are outside this read-only research lane.', fg: PALETTE.warn },
    );
  } else if (category.id === 'tools') {
    base.push(
      { text: `MCP servers: ${snapshot.mcpConnectedServerCount}/${snapshot.mcpServerCount} connected; quarantined ${snapshot.mcpQuarantinedServerCount}; allow-all ${snapshot.mcpAllowAllServerCount}.`, fg: snapshot.mcpQuarantinedServerCount > 0 || snapshot.mcpAllowAllServerCount > 0 ? PALETTE.warn : PALETTE.info },
      { text: 'Open MCP workspace for live server status, tool inventory, config paths, and confirmed add/remove/reload actions.', fg: PALETTE.info },
      { text: 'Add/update requires typed confirmation and dispatches through the TUI command router.', fg: PALETTE.good },
      { text: 'Trust changes remain explicit; allow-all is kept behind the settings workspace.', fg: PALETTE.warn },
      { text: 'Useful first actions: /mcp review, /mcp tools, /mcp config, and Add MCP server.', fg: PALETTE.muted },
      { text: 'Normal assistant chat can use tools serially when policy allows; onboarding does not start hidden tool work.', fg: PALETTE.muted },
    );
  } else if (category.id === 'voice-media') {
    const readiness = snapshot.voiceMediaReadiness;
    const voiceRows = readiness.voiceProviders.slice(0, 6);
    const mediaRows = readiness.mediaProviders.slice(0, 6);
    base.push(
      { text: `Voice providers: ${snapshot.voiceProviderCount}; streaming TTS: ${snapshot.voiceStreamingProviderCount}; STT: ${snapshot.voiceSttProviderCount}; realtime: ${snapshot.voiceRealtimeProviderCount}.`, fg: PALETTE.info },
      { text: `Voice interaction: ${snapshot.voiceSurfaceEnabled ? 'enabled' : 'disabled'}; ready providers ${readiness.readyVoiceProviderCount}/${snapshot.voiceProviderCount}.`, fg: snapshot.voiceSurfaceEnabled ? PALETTE.warn : PALETTE.muted },
      { text: `TTS config: provider ${snapshot.ttsProvider}; voice ${snapshot.ttsVoice}; response model ${snapshot.ttsResponseModel}.`, fg: PALETTE.info },
      { text: `Selected TTS readiness: ${readiness.selectedTtsProviderLabel} -> ${readiness.selectedTtsProviderStatus}; voice ${readiness.ttsVoiceConfigured ? 'configured' : 'default'}; response route ${readiness.ttsResponseRouteConfigured ? 'configured' : 'chat route'}.`, fg: readiness.selectedTtsProviderStatus === 'ready' ? PALETTE.good : PALETTE.warn },
      { text: `Media providers: ${snapshot.mediaProviderCount}; understanding: ${snapshot.mediaUnderstandingProviderCount}; generation: ${snapshot.mediaGenerationProviderCount}.`, fg: PALETTE.info },
      { text: `Ready media providers: ${readiness.readyMediaProviderCount}/${snapshot.mediaProviderCount}.`, fg: readiness.readyMediaProviderCount > 0 ? PALETTE.good : PALETTE.warn },
      { text: `Browser tools: ${readiness.browserToolState}; public base URL ${snapshot.browserToolPublicBaseUrl}.`, fg: snapshot.browserToolExposureEnabled ? PALETTE.warn : PALETTE.muted },
      { text: readiness.browserToolNextStep, fg: PALETTE.muted },
      { text: 'Voice provider readiness', fg: PALETTE.title, bold: true },
    );
    for (const provider of voiceRows) {
      const selected = provider.selected ? 'selected; ' : '';
      const missing = provider.missingSecretKeyOptions.length > 0 ? `; needs ${provider.missingSecretKeyOptions.join('|')}` : '';
      base.push({
        text: `${provider.label}: ${selected}${provider.setupState}; ${provider.features.join(', ') || 'registered'}${missing}.`,
        fg: provider.setupState === 'ready' ? PALETTE.good : provider.setupState === 'needs-secret' ? PALETTE.warn : PALETTE.muted,
      });
    }
    if (snapshot.voiceProviderCount > voiceRows.length) base.push({ text: `${snapshot.voiceProviderCount - voiceRows.length} more voice provider(s).`, fg: PALETTE.dim });
    base.push({ text: 'Media provider readiness', fg: PALETTE.title, bold: true });
    for (const provider of mediaRows) {
      const missing = provider.missingSecretKeyOptions.length > 0 ? `; needs ${provider.missingSecretKeyOptions.join('|')}` : '';
      base.push({
        text: `${provider.label}: ${provider.setupState}; ${provider.features.join(', ') || 'registered'}${missing}.`,
        fg: provider.setupState === 'ready' ? PALETTE.good : provider.setupState === 'needs-secret' ? PALETTE.warn : PALETTE.muted,
      });
    }
    if (snapshot.mediaProviderCount > mediaRows.length) base.push({ text: `${snapshot.mediaProviderCount - mediaRows.length} more media provider(s).`, fg: PALETTE.dim });
    for (const step of readiness.nextSteps.slice(0, 4)) base.push({ text: `Next: ${step}`, fg: PALETTE.info });
    base.push(
      { text: 'No secret values are rendered. Voice, browser, and generated media side effects require explicit user action.', fg: PALETTE.warn },
      { text: 'Image input uses prompt attachments; media generation/provider setup stays behind explicit commands and configured providers.', fg: PALETTE.muted },
    );
  } else if (category.id === 'profiles') {
    const defaultProfile = snapshot.selectedRuntimeProfile
      ? `${snapshot.selectedRuntimeProfile}${snapshot.selectedRuntimeProfileExists ? '' : ' (missing)'}`
      : '(base Agent home)';
    base.push(
      { text: `Active Agent profile: ${snapshot.activeRuntimeProfile}`, fg: PALETTE.info },
      { text: `Default for next launch: ${defaultProfile}`, fg: snapshot.selectedRuntimeProfileExists || !snapshot.selectedRuntimeProfile ? PALETTE.info : PALETTE.warn },
      { text: `Agent profiles under this home: ${snapshot.runtimeProfileCount}`, fg: PALETTE.info },
      { text: `Starter templates: ${snapshot.runtimeStarterTemplateCount}; local custom: ${snapshot.localStarterTemplateCount}`, fg: PALETTE.info },
      { text: `Starter ids: ${snapshot.runtimeStarterTemplates.map((template) => template.id).join(', ') || 'none'}`, fg: PALETTE.info },
      { text: 'Starter Templates', fg: PALETTE.title, bold: true },
      { text: `Agent profile root: ${snapshot.runtimeProfileRoot}`, fg: PALETTE.muted },
      { text: '' },
      ...profileLines(snapshot),
      { text: '' },
      ...starterTemplateLines(snapshot),
      { text: '' },
      { text: 'Named Agent profiles isolate local config, sessions, memory, personas, skills, routines, setup, and bundles.', fg: PALETTE.good },
      { text: 'Starter authoring: browse, export, edit, import, and create Agent profiles from inside this workspace.', fg: PALETTE.info },
      { text: 'The connected GoodVibes host stays shared unless that host is configured separately.', fg: PALETTE.warn },
      { text: 'Portable bundles require explicit export/import commands with real paths and --yes.', fg: PALETTE.muted },
    );
  } else if (category.id === 'memory') {
    base.push(
      { text: `Session memories: ${snapshot.sessionMemoryCount}`, fg: PALETTE.info },
      { text: `Agent memory: ${snapshot.localMemoryCount}; prompt-active: ${snapshot.localMemoryPromptActiveCount}; review queue: ${snapshot.localMemoryReviewQueueCount}`, fg: PALETTE.info },
      { text: `Scratchpad notes: ${snapshot.localNoteCount}; review queue: ${snapshot.localNoteReviewQueueCount}`, fg: PALETTE.info },
      { text: `Local routines: ${snapshot.localRoutineCount}; enabled: ${snapshot.enabledRoutineCount}`, fg: PALETTE.info },
      { text: `Local skills: ${snapshot.localSkillCount}; enabled: ${snapshot.enabledSkillCount}; bundles: ${snapshot.localSkillBundleCount}; active skills: ${snapshot.activeSkillCount}`, fg: PALETTE.info },
      { text: `Local personas: ${snapshot.localPersonaCount}; active: ${snapshot.activePersonaName}`, fg: PALETTE.info },
      { text: 'Durable memory, scratchpad notes, routines, skills, and personas remain Agent-local until shared registry contracts exist.', fg: PALETTE.good },
      { text: 'Secrets are rejected/redacted; store secret references instead of secret values.', fg: PALETTE.warn },
      { text: '' },
      ...localLibraryLines('Agent Memory', snapshot.localMemories, 'No Agent memory yet. Create one here with Create memory.', workspace.selectedLocalLibraryItem('memory')?.id ?? null),
    );
  } else if (category.id === 'notes') {
    base.push(
      { text: `Scratchpad notes: ${snapshot.localNoteCount}; review queue: ${snapshot.localNoteReviewQueueCount}`, fg: PALETTE.info },
      { text: 'Notes are Agent-local working context for source triage, temporary decisions, and operator handoff.', fg: PALETTE.good },
      { text: 'Notes do not become memory and are not ingested into Agent Knowledge unless the user takes a separate explicit action.', fg: PALETTE.warn },
      { text: 'Use reviewed notes to prefill durable memory, skills, routines, or personas, or to decide that a reviewed source deserves Agent Knowledge ingest.', fg: PALETTE.muted },
      { text: '' },
      ...localLibraryLines('Scratchpad Notes', snapshot.localNotes, 'No local notes yet. Create one here with Create note.', workspace.selectedLocalLibraryItem('note')?.id ?? null),
    );
  } else if (category.id === 'personas') {
    base.push(
      { text: `Personas: ${snapshot.localPersonaCount}; active: ${snapshot.activePersonaName}`, fg: PALETTE.info },
      { text: 'Personas are local behavior profiles for the serial main-conversation assistant, not separate Agent jobs.', fg: PALETTE.good },
      { text: 'Use them for tone, role, domain constraints, tool posture, and repeatable operating preferences.', fg: PALETTE.muted },
      { text: '' },
      ...localLibraryLines('Persona Library', snapshot.localPersonas, 'No local personas yet. Create one here with Create persona.', workspace.selectedLocalLibraryItem('persona')?.id ?? null),
    );
  } else if (category.id === 'skills') {
    base.push(
      { text: `Skills: ${snapshot.localSkillCount}; enabled: ${snapshot.enabledSkillCount}; bundles: ${snapshot.localSkillBundleCount}; enabled bundles: ${snapshot.enabledSkillBundleCount}; active skills: ${snapshot.activeSkillCount}`, fg: PALETTE.info },
      { text: 'Skills are reusable local procedures the assistant can apply from the main conversation.', fg: PALETTE.good },
      { text: 'Enabled skills and enabled bundles are injected as operating guidance; secret-looking content is rejected.', fg: PALETTE.warn },
      { text: '' },
      ...localLibraryLines('Skill Library', snapshot.localSkills, 'No local skills yet. Create one here with Create skill.', workspace.selectedLocalLibraryItem('skill')?.id ?? null),
      { text: '' },
      ...localLibraryLines('Skill Bundles', snapshot.localSkillBundles, 'No local skill bundles yet. Use Skill bundles and Create bundle after creating skills.', null),
    );
  } else if (category.id === 'routines') {
    const ready = readyRoutineItems(snapshot);
    const needsSetup = routinesNeedingSetup(snapshot);
    const needsReview = routinesNeedingReview(snapshot);
    base.push(
      { text: `Routines: ${snapshot.localRoutineCount}; enabled: ${snapshot.enabledRoutineCount}`, fg: PALETTE.info },
      { text: `Schedule-ready routines: ${ready.length}; setup gaps: ${needsSetup.length}; review needed: ${needsReview.length}`, fg: needsSetup.length > 0 || needsReview.length > 0 ? PALETTE.warn : PALETTE.good },
      { text: 'Routines are repeatable main-conversation workflows. Starting one does not create hidden jobs.', fg: PALETTE.good },
      { text: 'Scheduling a reviewed routine is explicit and requires a confirmed schedule command.', fg: PALETTE.warn },
      routineNextActionLine(snapshot),
      ...routineScheduleReceiptLines(snapshot),
      { text: '' },
      ...localLibraryLines('Routine Library', snapshot.localRoutines, 'No local routines yet. Create one here with Create routine.', workspace.selectedLocalLibraryItem('routine')?.id ?? null),
    );
  } else if (category.id === 'work') {
    base.push(
      { text: 'Work plan and approvals are read or explicitly confirmed through public operator routes.', fg: PALETTE.info },
      { text: 'This workspace does not approve, deny, cancel, or mutate requests by selection alone.', fg: PALETTE.good },
      { text: 'Approve, deny, and cancel forms require an approval id and typed confirmation.', fg: PALETTE.warn },
    );
  } else if (category.id === 'automation') {
    const ready = readyRoutineItems(snapshot);
    base.push(
      { text: 'Automation and schedules default to read-only observability; side effects require confirmed forms.', fg: PALETTE.info },
      { text: 'Confirmed reminders and routine promotion use connected schedules only.', fg: PALETTE.info },
      { text: 'Local scheduler mutation controls remain blocked; job/run/schedule controls go through the connected host.', fg: PALETTE.warn },
      { text: 'Reminder path: Create reminder -> choose at/every/cron -> optional delivery target -> confirm yes.', fg: PALETTE.good },
      { text: 'Operator path: choose job/run/schedule action -> enter id -> type yes -> dispatch once.', fg: PALETTE.good },
      { text: 'Routine path: Routines -> resolve setup -> review selected -> Promote routine -> Reconcile schedules.', fg: PALETTE.good },
      { text: `Schedule-ready routines: ${ready.length}; local promotion receipts: ${snapshot.routineScheduleReceiptCount}`, fg: ready.length > 0 ? PALETTE.good : PALETTE.warn },
      automationNextActionLine(snapshot),
      ...routineScheduleReceiptLines(snapshot),
    );
  } else if (category.id === 'delegate') {
    base.push(
      { text: 'Build/fix/review work is handed to GoodVibes TUI/shared-session contracts.', fg: PALETTE.info },
      { text: `WRFC policy: ${snapshot.wrfcPolicy}`, fg: PALETTE.warn },
      { text: 'Agent does not create coding-role Agent jobs.', fg: PALETTE.good },
    );
  }
  if (snapshot.warnings.length > 0) {
    base.push({ text: '', dim: true }, { text: 'Warnings', fg: PALETTE.warn, bold: true });
    for (const warning of snapshot.warnings) base.push({ text: warning, fg: PALETTE.warn });
  }
  return base;
}

function editorContextLines(editor: AgentWorkspaceLocalEditor): ContextLine[] {
  const selected = editor.fields[editor.selectedFieldIndex];
  const lines: ContextLine[] = [
    { text: editor.title, fg: PALETTE.title, bold: true },
    { text: editor.message, fg: editor.message.includes('required') || editor.message.includes('cannot') || editor.message.includes('Cannot') ? PALETTE.warn : PALETTE.info },
    { text: 'Enter advances fields and saves from the final field. Ctrl-J adds a line inside multiline fields. Esc cancels without writing.', fg: PALETTE.muted },
  ];
  if (selected) {
    lines.push(
      { text: '' },
      { text: `Editing: ${selected.label}${selected.required ? ' (required)' : ''}`, fg: PALETTE.title, bold: true },
      { text: selected.hint, fg: PALETTE.muted },
    );
  }
  return lines;
}

function buildContextRows(workspace: AgentWorkspace, category: AgentWorkspaceCategory, action: AgentWorkspaceAction | null, width: number): WorkspaceRow[] {
  const lines: ContextLine[] = [
    { text: category.label, fg: PALETTE.title, bold: true },
    { text: category.summary, fg: PALETTE.subtitle },
    { text: '' },
    { text: category.detail, fg: PALETTE.text },
    { text: '' },
    ...(workspace.actionSearchActive ? [
      { text: 'Action Search', fg: PALETTE.title, bold: true },
      {
        text: workspace.actionSearchQuery.length > 0
          ? `Query: ${workspace.actionSearchQuery} (${workspace.actionSearchResults.length} result${workspace.actionSearchResults.length === 1 ? '' : 's'})`
          : 'Type to search every Agent workspace action.',
        fg: workspace.actionSearchQuery.length > 0 && workspace.actionSearchResults.length === 0 ? PALETTE.warn : PALETTE.info,
      },
      { text: 'Enter opens the selected result. Esc clears search and returns to normal workspace navigation.', fg: PALETTE.muted },
      { text: '' },
    ] satisfies ContextLine[] : []),
    ...(workspace.localEditor ? editorContextLines(workspace.localEditor) : []),
    ...(workspace.localEditor ? [{ text: '' }] : []),
    ...snapshotLines(workspace, category, workspace.runtimeSnapshot),
  ];

  if (action) {
    lines.push(
      { text: '' },
      { text: `Selected: ${action.label}`, fg: PALETTE.title, bold: true },
      { text: action.detail, fg: PALETTE.text },
      { text: `Command: ${actionCommand(action)}`, fg: action.kind === 'command' ? PALETTE.info : PALETTE.muted },
      { text: `Safety: ${action.safety}`, fg: safetyColor(action) },
    );
  }

  if (workspace.lastActionResult) {
    lines.push(
      { text: '' },
      { text: 'Action Result', fg: PALETTE.title, bold: true },
      { text: workspace.lastActionResult.title, fg: actionResultColor(workspace.lastActionResult), bold: true },
      { text: workspace.lastActionResult.detail, fg: PALETTE.text },
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
  const labelWidth = Math.min(28, Math.max(16, Math.floor(width * 0.30)));
  const safetyWidth = 10;
  const commandWidth = Math.max(10, width - labelWidth - safetyWidth - 9);
  if (workspace.actionSearchActive) {
    rows.push({
      text: `  Search: ${workspace.actionSearchQuery || '(type to filter actions)'}`,
      fg: workspace.actionSearchQuery.length > 0 && workspace.actions.length === 0 ? PALETTE.warn : PALETTE.info,
      bold: true,
    });
  }
  rows.push({
    text: `  ${padDisplay(workspace.actionSearchActive ? 'Result' : 'Action', labelWidth)}  ${padDisplay('Safety', safetyWidth)}  ${padDisplay('Command', commandWidth)}`,
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
      text: `${marker} ${padDisplay(label, labelWidth)}  ${padDisplay(action.safety, safetyWidth)}  ${padDisplay(actionCommand(action), commandWidth)}`,
      selected: selected && workspace.focusPane === 'actions',
      fg: safetyColor(action),
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
  const setupCategory = category.id === 'setup';
  const layoutOptions = {
    width,
    height,
    leftWidth: width < 90 ? undefined : 30,
    contextRatio: setupCategory ? 0.86 : 0.62,
    minContextRows: setupCategory ? 18 : 10,
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
      : `${category.label} · ${category.actions.length} action(s)`,
    leftRows: buildLeftRows(workspace, metrics.bodyRows),
    contextRows: buildContextRows(workspace, category, action, metrics.contextWidth),
    controlRows: buildActionRows(workspace, metrics.contextWidth, metrics.controlRows),
    footer: footerText(workspace),
    leftWidth: layoutOptions.leftWidth,
    contextRatio: layoutOptions.contextRatio,
    minContextRows: layoutOptions.minContextRows,
  });
}
