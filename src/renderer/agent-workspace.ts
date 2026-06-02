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
  }
  if (items.length > 8) {
    lines.push({ text: `${items.length - 8} more item(s). Open the library command for the full list.`, fg: PALETTE.dim });
  }
  return lines;
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
    lines.push({ text: `${profile.id}${starter}${created}`, fg: PALETTE.info, bold: profile.id === snapshot.activeRuntimeProfile });
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
    );
  } else if (category.id === 'setup') {
    base.push(
      { text: `Connection: ${snapshot.runtimeBaseUrl}`, fg: PALETTE.info },
      { text: 'Agent role: interactive operator TUI; setup changes here are Agent-local.', fg: PALETTE.good },
      ...setupChecklistLines(snapshot),
      { text: '' },
      { text: `Workspace: ${snapshot.workingDirectory}`, fg: PALETTE.muted },
      { text: `Home: ${snapshot.homeDirectory}`, fg: PALETTE.muted },
    );
  } else if (category.id === 'channels') {
    const enabledCount = snapshot.channels.filter((channel) => channel.enabled).length;
    const readyCount = snapshot.channels.filter((channel) => channel.ready).length;
    const configuredDefaults = snapshot.channels.filter((channel) => channel.defaultTarget === 'configured').length;
    const readyChannels = snapshot.channels.filter((channel) => channel.ready).map((channel) => channel.label);
    const needsTarget = snapshot.channels.filter((channel) => channel.setupState === 'needs-target');
    const needsConfig = snapshot.channels.filter((channel) => channel.setupState === 'needs-config');
    const disabledChannels = snapshot.channels.filter((channel) => !channel.enabled).map((channel) => channel.label);
    const disabledPreview = disabledChannels.slice(0, 6).join(', ');
    const disabledSuffix = disabledChannels.length > 6 ? `, +${disabledChannels.length - 6} more` : '';
    const orderedChannels = [
      ...snapshot.channels.filter((channel) => channel.enabled),
      ...snapshot.channels.filter((channel) => !channel.enabled),
    ].slice(0, 6);
    base.push(
      { text: `GoodVibes API: ${snapshot.runtimeBaseUrl}`, fg: PALETTE.info },
      { text: `Readiness: ${readyCount}/${snapshot.channels.length} ready; ${enabledCount} enabled; ${configuredDefaults} default target(s) configured.`, fg: PALETTE.info },
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
    base.push({ text: 'Only config key names and readiness state are rendered here.', fg: PALETTE.muted });
    base.push({ text: 'Pairing: use /pair or /qrcode; inspect notification targets with /notify list and health with /health review.', fg: PALETTE.info });
  } else if (category.id === 'knowledge') {
    base.push(
      { text: `Route family: ${snapshot.knowledgeRoute}/{status,ask,search}`, fg: PALETTE.info },
      { text: `Isolation: ${snapshot.knowledgeIsolation}; no default Knowledge/Wiki or non-Agent fallback`, fg: PALETTE.good },
      { text: 'Ingest: URL, URL-list, and bookmark imports require explicit --yes and write only to Agent Knowledge.', fg: PALETTE.info },
      { text: 'Review: queue, issues, candidates, reports, reindex, and consolidation stay inside the Agent segment.', fg: PALETTE.muted },
      { text: 'Agent-owned content appears here only after explicit Agent knowledge ingestion.', fg: PALETTE.muted },
    );
  } else if (category.id === 'tools') {
    base.push(
      { text: `MCP servers: ${snapshot.mcpConnectedServerCount}/${snapshot.mcpServerCount} connected; quarantined ${snapshot.mcpQuarantinedServerCount}; allow-all ${snapshot.mcpAllowAllServerCount}.`, fg: snapshot.mcpQuarantinedServerCount > 0 || snapshot.mcpAllowAllServerCount > 0 ? PALETTE.warn : PALETTE.info },
      { text: 'Open MCP workspace for live server status, tool inventory, config paths, and command previews.', fg: PALETTE.info },
      { text: 'Add/update requires typed confirmation and dispatches /mcp add ... --yes through the command router.', fg: PALETTE.good },
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
    base.push(
      { text: `Active Agent profile: ${snapshot.activeRuntimeProfile}`, fg: PALETTE.info },
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
      { text: 'Connected GoodVibes services stay shared unless the owning host is configured separately.', fg: PALETTE.warn },
      { text: 'Portable bundles require explicit export/import commands with real paths and --yes.', fg: PALETTE.muted },
    );
  } else if (category.id === 'memory') {
    base.push(
      { text: `Session memories: ${snapshot.sessionMemoryCount}`, fg: PALETTE.info },
      { text: `Agent memory: ${snapshot.localMemoryCount}; prompt-active: ${snapshot.localMemoryPromptActiveCount}; review queue: ${snapshot.localMemoryReviewQueueCount}`, fg: PALETTE.info },
      { text: `Local routines: ${snapshot.localRoutineCount}; enabled: ${snapshot.enabledRoutineCount}`, fg: PALETTE.info },
      { text: `Local skills: ${snapshot.localSkillCount}; enabled: ${snapshot.enabledSkillCount}; bundles: ${snapshot.localSkillBundleCount}; active skills: ${snapshot.activeSkillCount}`, fg: PALETTE.info },
      { text: `Local personas: ${snapshot.localPersonaCount}; active: ${snapshot.activePersonaName}`, fg: PALETTE.info },
      { text: 'Durable memory, routines, skills, and personas remain Agent-local until shared registry contracts exist.', fg: PALETTE.good },
      { text: 'Secrets are rejected/redacted; store secret references instead of secret values.', fg: PALETTE.warn },
      { text: '' },
      ...localLibraryLines('Agent Memory', snapshot.localMemories, 'No Agent memory yet. Create one here with Create memory.', workspace.selectedLocalLibraryItem('memory')?.id ?? null),
    );
  } else if (category.id === 'personas') {
    base.push(
      { text: `Personas: ${snapshot.localPersonaCount}; active: ${snapshot.activePersonaName}`, fg: PALETTE.info },
      { text: 'Personas are local behavior profiles for the serial main-conversation assistant, not spawned agents.', fg: PALETTE.good },
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
    base.push(
      { text: `Routines: ${snapshot.localRoutineCount}; enabled: ${snapshot.enabledRoutineCount}`, fg: PALETTE.info },
      { text: 'Routines are repeatable main-conversation workflows. Starting one does not create hidden jobs.', fg: PALETTE.good },
      { text: 'Scheduling a reviewed routine is explicit and requires a confirmed schedule command.', fg: PALETTE.warn },
      { text: '' },
      ...localLibraryLines('Routine Library', snapshot.localRoutines, 'No local routines yet. Create one here with Create routine.', workspace.selectedLocalLibraryItem('routine')?.id ?? null),
    );
  } else if (category.id === 'work') {
    base.push(
      { text: 'Work plan and approvals are read or explicitly confirmed through public operator routes.', fg: PALETTE.info },
      { text: 'This workspace does not approve, deny, cancel, or mutate requests by selection alone.', fg: PALETTE.good },
    );
  } else if (category.id === 'automation') {
    base.push(
      { text: 'Automation and schedules default to read-only observability.', fg: PALETTE.info },
      { text: 'Confirmed reminders and routine promotion use connected schedules only.', fg: PALETTE.info },
      { text: 'Local scheduler mutation/run controls remain blocked.', fg: PALETTE.warn },
    );
  } else if (category.id === 'delegate') {
    base.push(
      { text: 'Build/fix/review work is handed to GoodVibes TUI/shared-session contracts.', fg: PALETTE.info },
      { text: `WRFC policy: ${snapshot.wrfcPolicy}`, fg: PALETTE.warn },
      { text: 'Agent does not spawn local Engineer/Reviewer/Tester roots.', fg: PALETTE.good },
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
  const value = field.value.length > 0 ? field.value : '(empty)';
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
  rows.push({
    text: `  ${padDisplay('Action', labelWidth)}  ${padDisplay('Safety', safetyWidth)}  ${padDisplay('Command', commandWidth)}`,
    fg: PALETTE.muted,
    bold: true,
  });

  const actions = workspace.actions;
  const visible = Math.max(1, height - 2);
  const window = stableWindow(actions.length, workspace.selectedActionIndex, visible);
  if (window.start > 0) rows.push({ text: `${GLYPHS.navigation.moreAbove} ${window.start} more action(s) above`, kind: 'more', fg: PALETTE.dim, dim: true });

  for (let index = window.start; index < window.end; index += 1) {
    const action = actions[index]!;
    const selected = index === workspace.selectedActionIndex;
    const marker = selected ? GLYPHS.navigation.selected : ' ';
    rows.push({
      text: `${marker} ${padDisplay(action.label, labelWidth)}  ${padDisplay(action.safety, safetyWidth)}  ${padDisplay(actionCommand(action), commandWidth)}`,
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
  const focus = workspace.focusPane === 'categories' ? 'categories' : 'actions';
  return `Agent workspace · focus ${focus} · Up/Down navigate · Left/Right pane · Enter open/action · R refresh · Esc close`;
}

export function renderAgentWorkspace(workspace: AgentWorkspace, width: number, height: number): Line[] {
  const category = workspace.selectedCategory;
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
    stateLabel: workspace.localEditor ? 'Editor' : workspace.focusPane === 'categories' ? 'Categories' : 'Actions',
    leftHeader: 'Operator Areas',
    mainHeader: `${category.label} · ${category.actions.length} action(s)`,
    leftRows: buildLeftRows(workspace, metrics.bodyRows),
    contextRows: buildContextRows(workspace, category, action, metrics.contextWidth),
    controlRows: buildActionRows(workspace, metrics.contextWidth, metrics.controlRows),
    footer: footerText(workspace),
    leftWidth: layoutOptions.leftWidth,
    contextRatio: layoutOptions.contextRatio,
    minContextRows: layoutOptions.minContextRows,
  });
}
