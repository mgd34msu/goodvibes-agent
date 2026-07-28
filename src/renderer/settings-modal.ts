/**
 * Fullscreen configuration workspace.
 *
 * This intentionally does not use ModalFactory. Configuration needs a stable,
 * roomy workspace with contextual documentation, not a cramped modal list.
 */

import type { Line } from '../types/grid.ts';
import type { SettingsModal, SettingEntry, FlagEntry, McpEntry, SubscriptionEntry, SettingsCategory } from '../input/settings-modal.ts';
import { SETTINGS_CATEGORIES, SETTINGS_CATEGORY_GROUPS } from '../input/settings-modal.ts';
import { getDisplayWidth, wrapText } from '../utils/terminal-width.ts';
import { CATEGORY_LABELS, describeUiRouting, formatValue, getSettingLabel, inferSubscriptionRouteReason, valueColor } from './settings-modal-helpers.ts';
import { isSecretConfigKey } from '../config/secret-config.ts';
import { maskConcealedText } from '../input/concealed-input.ts';
import { formatMoneyForDisplay, isMoneyMinorUnitsConfigKey } from '../config/payments-money-format.ts';
import { CVV_PROMPT_TRADEOFF_WARNING } from '@pellux/goodvibes-sdk/platform/payments';
import { formatProviderAuthRouteId } from '../provider-auth-route-display.ts';
import { GLYPHS } from './ui-primitives.ts';
import {
  clamp,
  getFullscreenWorkspaceMetrics,
  padDisplay,
  renderFullscreenWorkspace,
  stableWindow,
  WORKSPACE_PALETTE as PALETTE,
  type WorkspaceRow,
} from './fullscreen-workspace.ts';

const CATEGORY_INFO: Record<SettingsCategory, string> = {
  display: 'Presentation settings for the terminal transcript: streaming, line numbers, thinking visibility, reasoning summaries, token speed, and tool previews.',
  ui: 'Controls where operational messages render and whether voice interaction is enabled. These settings change visibility, not provider behavior.',
  provider: 'Default model routing for normal chat turns, embeddings, reasoning effort, and persistent system prompt file.',
  subscriptions: 'Provider subscription login state and routing posture. Active sessions can be reviewed or signed out here; API keys remain managed through secrets.',
  behavior: 'Day-to-day shell behavior: approval posture, compaction, history, guidance, notifications, stale-context warnings, return context, and Human-in-the-Loop mode.',
  storage: 'Local storage posture, including secret storage policy and maximum artifact size for Agent Knowledge, artifacts, and document ingestion.',
  permissions: 'Permission mode and tool-class policy. These settings decide whether the shell prompts before read/write/exec/network/agent actions.',
  diagnostics: 'Post-edit diagnostics behavior: whether a successful file write/edit gets cheap, in-process syntax diagnostics appended to the tool result so the model sees a broken edit immediately. Syntax-level only — not type-checking.',
  helper: 'Helper model defaults used by helper subsystems when they do not use the main chat route.',
  tts: 'Text-to-speech provider, voice, and optional spoken-turn LLM overrides.',
  voice: 'Two independent voice capabilities. Free local voice engines (voice.local.*) as the peer beside the premium provider route above: configurable-not-configured by default, every key ships empty, nothing auto-downloads, and an unset engine reports an honest unconfigured status rather than an error — each engine needs one explicit setup action. Wake-word detection (voice.wake.*, rendered as its own unit below): listening continuously for a spoken wake phrase and handing the utterance that follows to speech-to-text. Off by default, and delivery to THIS surface is off by default too (voice.wake.surfaces.agent), because two terminal surfaces both acting on one spoken utterance is a confusing default. Its published recall figures are measured on synthesised speech only, so no human recording of the phrase is behind them.',
  automation: 'Scheduled and automated run settings, concurrency, timeout, catch-up, cooldown, and retention behavior.',
  checkin: 'Proactive check-in: off by default. When enabled, on a cadence the Agent assembles a compact briefing of current state, asks the model to judge whether anything warrants contacting you, and delivers a message through the configured channel only when the judgment says yes. Every run — delivered, quiet, skipped for quiet hours, or errored — leaves a receipt (checkin.receipts.list) so this automatic behavior stays accountable even when it decides to say nothing.',
  service: 'GoodVibes daemon service posture and restart/autostart preferences.',
  controlPlane: 'Control-plane endpoint, stream, remote access, and TLS settings used by daemon-backed operator routes.',
  httpListener: 'HTTP listener binding, trust proxy, and TLS settings for inbound companion/channel routes.',
  danger: 'Toggles that expose this machine to inbound traffic. Shown rather than hidden so you can see what is on; changing one from the Agent needs your explicit confirmation first.',
  web: 'Web companion surface settings including host, port, public URL, and static asset path.',
  watchers: 'Polling watcher and heartbeat behavior for runtime recovery and periodic checks.',
  network: 'Outbound TLS and remote fetch network policy.',
  relay: 'Outbound zero-knowledge relay reachability for the connected GoodVibes daemon: an end-to-end encrypted tunnel (ECDH P-256 -> HKDF -> AES-256-GCM) that terminates INSIDE the daemon, so the relay operator only ever sees ciphertext plus connection metadata (who paired with whom, byte counts, timing) — never plaintext requests, responses, or the operator token. relay.enabled is the relay-connect feature\'s switch. These are the connected daemon\'s own settings (imported here, not live-shared): changing them in Agent does not itself start or stop the daemon\'s relay registration.',
  cluster: 'Which of your machines reads each inbound surface, for operators running more than one goodvibes daemon on a network. Exactly one machine is elected per surface — one reads the work Slack account, one reads the mailbox — so a message is picked up once rather than answered twice by every copy of you. cluster.enabled is the switch and it is off by default. The group keys, rotation window, beacon and roster intervals decide which machines count as yours and how often they re-prove it. These are the connected daemon\'s own settings: the Agent composes no inbound consumer of its own and never takes part in an election, but it owns the daemon\'s configuration, so changes here reach the runtime that acts on them.',  orchestration: 'Visible agent orchestration limits: sub-agent recursion and its max depth. The active-agent ceiling itself lives under Fleet (fleet.maxSize).',
  fleet: 'Maximum fleet size — the one ceiling on agents this runtime is responsible for: native spawned agents, ACP-hosted agents, and elastic fix-task agents all count against it. Renamed from orchestration.maxActiveAgents.',
  planner: 'Planning-decomposition agent limits: decomposition strategy, max turns, token ceiling, and wall-clock timeout before falling back to the deterministic heuristic path.',
  daemon: 'Whether the local session daemon runs, and whether it is embedded in this surface process instead of spawned as a detached background service.',
  runtime: 'Runtime service limits and event bus settings.',
  sandbox: 'Isolation settings for REPL, MCP, and VM-backed sessions.',
  batch: 'Batch queue backend, limits, and provider batching behavior.',
  cloudflare: 'Cloudflare worker, tunnel, queue, storage, and token-reference settings.',
  wrfc: 'WRFC review/fix chain scoring, fix attempts, and commit preferences.',
  telemetry: 'Telemetry payload policy.',
  cache: 'Provider and model cache behavior, TTL, and hit-rate monitoring.',
  mcp: 'MCP server trust and scope review. Trust changes can expose local files, tools, databases, browsers, or remote automation depending on the server.',
  surfaces: 'Messaging and notification channel accounts such as Slack, Discord, ntfy, Telegram, chat bridges, and delivery providers.',
  conversationGate: 'What a message arriving from a channel does. By default it gets a conversational answer, and work is proposed and waits for your agreement rather than starting on its own; you can instead confirm every run, or restore the old behavior where a message starts work immediately. Also how long a pending proposal stays answerable and how many can wait at once. Schedules, triggers, and on-exit chains were authorized when created and are never gated here.',
  release: 'Update-channel preference.',
  update: "Connected-host self-update posture: whether the daemon checks for, verifies, and swaps in new releases on its own, how often it checks, and where releases are resolved from. The daemon applies these itself; the Agent only edits the shared keys.",
  pricing: 'Manual model prices (USD per 1M tokens, keyed provider:model). A manual price outranks registration, provider-served, and catalog prices in the one pricing resolver; unknown models stay honestly unpriced.',
  power: 'Sleep ownership: the owner keep-awake toggle (independent of work state, survives surfaces closing — the always-visible status line note is the safety mechanism, not a timer), automatic inhibition while real work runs (on by default), and the hard cap in minutes on that automatic inhibitor so a wedged hold cannot pin the host awake forever.',
  tools: 'Tool LLM and helper model routing. Empty provider/model values inherit the active chat route unless a specific helper/tool route is set.',
  flags: 'Every optional capability grouped by its settings domain: each feature is switched through a first-class domain settings key (shown per row), with its full description and related settings under the cursor.',
  atRest: 'Data-at-rest protection: whether stored content is redacted, and retention limits by age and total size.',
  learning: 'Idle-time memory consolidation: dedupe merges, confidence decay of never-referenced records, and review proposals. On by default; runs on the SDK\'s daemon-side scheduler (an idle trigger plus a slow schedule fallback), and every run with something to report leaves a visible notice.',
  agents: 'Agent runtime tuning: the context-window fraction that triggers sub-agent conversation compaction, and the token budget, relevance floor, and code-chunk limit for per-turn passive knowledge/code injection.',
  notifications: 'Adaptive notification-burst suppression: the observation window, trip threshold, and cooldown that collapse a rapid run of same-domain notifications to panel-only. Critical/milestone/alert notifications are always exempt.',
  policy: 'Policy-as-code bundle loading: where the policy registry loads its initial bundle from at startup, and the file path when loading from disk. A loaded bundle is a candidate subject to the divergence gate before promotion.',
  fetch: 'Fetch-tool response sanitization: the default sanitize mode, and default trusted/blocked host lists layered under any per-call overrides. The built-in SSRF-risk block applies independently.',
  security: 'Credential rotation-audit defaults: how often tokens should rotate, how much lead time a warning gets, and whether overdue or over-scoped tokens are blocked from use rather than only reported.',
  integrations: 'Integration delivery reliability: retry ceiling and exponential-backoff bounds for Slack/Discord/webhook delivery, dead-letter queue size, and whether dead-letter events log at error level.',
  device: 'How a paired phone\'s camera, screen, location, clipboard, and device commands are reached. Every capture and effect asks the person first; "always allow" writes one durable grant for that capability on that phone, revocable in the grants surface. Also sets how long a picture the phone took is kept before it is deleted (24 hours by default), how often housekeeping sweeps, and how long a grant lasts before it expires.',
  memory: 'This runtime\'s own memory-pressure defense: the RSS budget (0 = auto: min of 25% of system RAM and 4096 MB), the elevated/high/critical tier thresholds that shed caches and pause deferrable background jobs, the leak tripwire (sustained growth rate that triggers a graceful exit with a receipt), and the absolute hard-limit backstop as a percent of the kill ceiling. Live state under /health memory.',
  payments: 'The payment capability\'s budgets, shipping preference, CVV handling, and the two decision windows: a veto window for in-budget purchases (silence proceeds) and an approval window for above-budget ones (silence denies). The daemon holds the card and executes every purchase; these settings configure it. Card number, expiry and CVV are never entered here — they live in the daemon secret store, write-only across every wire.',
};

const ENUM_VALUE_DESCRIPTIONS: Record<string, Record<string, string>> = {
  'behavior.hitlMode': {
    quiet: 'Minimize operational interruptions and surface fewer Human-in-the-Loop prompts.',
    balanced: 'Show important Human-in-the-Loop prompts without turning routine work into noise.',
    operator: 'Surface more operational detail for users actively supervising agents, tools, connected-host posture, and automation.',
  },
  'behavior.guidanceMode': {
    off: 'Do not add extra guidance beyond direct command output.',
    minimal: 'Show concise guidance only when it helps avoid mistakes.',
    guided: 'Provide more explanation and next-step context during configuration and operations.',
  },
  'permissions.mode': {
    prompt: 'Ask before powerful or risky actions according to tool policy.',
    'allow-all': 'Allow actions without prompting. This is fast but removes an important safety gate.',
    custom: 'Use per-tool-class permission settings from the rows below.',
    plan: 'Read-only: every write, execute, or delegate tool call is refused outright (never asked) so the model presents a plan instead of acting.',
    'accept-edits': 'File write/edit tool calls auto-approve without asking; execute and every other risky class still prompt for approval.',
  },
  'permissions.backgroundAgents': {
    inherit: 'Background/subagent tool calls consult the same session permission mode as the foreground turn — prompt/plan/accept-edits/custom apply their matrices, and any resulting ask still brokers through the normal approval prompt with subagent attribution.',
    'allow-all': 'Background/subagent tool calls are exempt from the session permission mode and auto-approve regardless of it.',
  },
  'diagnostics.postEdit': {
    on: 'After a successful file write/edit, append cheap, in-process syntax diagnostics (errors only) to the tool result. Syntax-level only — not type-checking.',
    off: 'Never append post-edit diagnostics to write/edit tool results.',
  },
  'storage.secretPolicy': {
    preferred_secure: 'Use secure secret storage when available, with supported fallback behavior.',
    require_secure: 'Require secure secret storage and reject plaintext fallback.',
    plaintext_allowed: 'Allow plaintext fallback when secure storage is unavailable.',
  },
  'ui.systemMessages': {
    panel: 'Show system messages in panels only.',
    conversation: 'Show system messages inline in the transcript.',
    both: 'Show system messages in both panels and the transcript.',
  },
  'ui.operationalMessages': {
    panel: 'Show operational messages in panels only.',
    conversation: 'Show operational messages inline in the transcript.',
    both: 'Show operational messages in both panels and the transcript.',
  },
  'surfaces.telegram.mode': {
    webhook: 'Receive Telegram updates through externally hosted delivery.',
    polling: 'Poll Telegram for updates from the configured account.',
  },
  'surfaces.whatsapp.provider': {
    'meta-cloud': 'Use Meta Cloud API credentials and identifiers.',
    bridge: 'Use a bridge endpoint URL/token flow instead of direct Meta Cloud API delivery.',
  },
};

function paddedWrapped(text: string, width: number, prefix = ''): string[] {
  const safeWidth = Math.max(1, width - getDisplayWidth(prefix));
  const wrapped = wrapText(text, safeWidth);
  if (prefix.length === 0) return wrapped;
  return wrapped.map((line, index) => `${index === 0 ? prefix : ' '.repeat(getDisplayWidth(prefix))}${line}`);
}

function formatDefaultValue(value: unknown): string {
  if (value === '') return '(empty)';
  if (value === null || value === undefined) return '(unset)';
  return String(value);
}

/** The configured payments.currency, or the schema default before a card is set up. */
function currentPaymentsCurrency(modal: SettingsModal): string {
  const entry = modal.groups.get('payments')?.find((candidate) => candidate.setting.key === 'payments.currency');
  return typeof entry?.currentValue === 'string' && entry.currentValue.length > 0 ? entry.currentValue : 'USD';
}

/** Money-aware Default column: the raw stored default (always 0) shown in the same units as Current. */
function formatDefaultForEntry(modal: SettingsModal, entry: SettingEntry): string {
  if (isMoneyMinorUnitsConfigKey(entry.setting.key) && typeof entry.setting.default === 'number') {
    return formatMoneyForDisplay(entry.setting.default, currentPaymentsCurrency(modal));
  }
  return formatDefaultValue(entry.setting.default);
}

function currentSettingValue(modal: SettingsModal, entry: SettingEntry, selected: boolean): string {
  if (selected && modal.editingMode) {
    // Secret-backed keys (payments.cardNumber/.cardCvv/..., surfaces.*.botToken,
    // .signingSecret — see config/secret-config.ts) must never echo the
    // in-progress plaintext buffer: not in the table row, not in the
    // "Current: ..." context line, not in search results. Masking only at rest
    // leaves the value fully readable for the entire time it is being typed,
    // which is the window that matters for someone reading over a shoulder or
    // a terminal recording.
    //
    // Reuses the composer's own concealed-input mask rather than a second
    // implementation, so both entry paths (this modal and /payments card) mask
    // identically — same bullet-per-character shape, so keystrokes still
    // visibly register without revealing content.
    const buffer = isSecretConfigKey(entry.setting.key) ? maskConcealedText(modal.editBuffer) : modal.editBuffer;
    return `${buffer}${GLYPHS.surface.cursor}`;
  }
  if (isMoneyMinorUnitsConfigKey(entry.setting.key) && typeof entry.currentValue === 'number') {
    return formatMoneyForDisplay(entry.currentValue, currentPaymentsCurrency(modal));
  }
  return formatValue(entry);
}

function buildSettingContext(modal: SettingsModal, entry: SettingEntry): string[] {
  const lines: string[] = [
    getSettingLabel(entry),
    `Key: ${entry.setting.key}`,
    `Current: ${currentSettingValue(modal, entry, true)}`,
    `Default: ${formatDefaultForEntry(modal, entry)}`,
    `Type: ${entry.setting.type}${entry.setting.enumValues ? ` with ${entry.setting.enumValues.length} possible value(s)` : ''}`,
    `Source: ${entry.effectiveSource ?? 'default'}${entry.sourceLabel ? ` from ${entry.sourceLabel}` : ''}`,
  ];

  if (entry.locked) lines.push(`Locked: ${entry.lockReason ?? 'This setting is locked by a higher-priority layer.'}`);
  if (entry.conflict) lines.push(`Conflict: inspect with /settings and resolve host-owned sync state in the owning host.`);

  lines.push('', entry.setting.description);

  if (
    entry.setting.key === 'ui.systemMessages'
    || entry.setting.key === 'ui.operationalMessages'
  ) {
    lines.push(`Routing meaning: ${describeUiRouting(String(entry.currentValue))}.`);
  }

  if (entry.setting.type === 'boolean') {
    lines.push('');
    lines.push('Possible values:');
    lines.push('true: enabled or allowed for this setting.');
    lines.push('false: disabled or not allowed for this setting.');
  }

  if (entry.setting.type === 'enum' && entry.setting.enumValues) {
    lines.push('');
    lines.push('Possible values:');
    const descriptions = ENUM_VALUE_DESCRIPTIONS[entry.setting.key] ?? {};
    for (const value of entry.setting.enumValues) {
      lines.push(`${value}: ${descriptions[value] ?? `Use ${value} for this setting.`}`);
    }
  }

  // The SDK's own wording, not authored here, and never shown against 'stored'.
  if (entry.setting.key === 'payments.cvvHandling' && entry.currentValue === 'prompt') {
    lines.push('', CVV_PROMPT_TRADEOFF_WARNING);
  }

  if (isSecretConfigKey(entry.setting.key)) {
    lines.push('');
    lines.push('Secret handling: raw values entered here are stored through the secret manager and the config receives a goodvibes:// secret reference. Empty input clears the config value.');
  }

  if (entry.setting.type === 'number') {
    lines.push('');
    lines.push('Editing: Enter opens inline edit, then type the value and press Enter to save. Arrow keys only navigate.');
  }

  if (entry.setting.type === 'string' && !isSecretConfigKey(entry.setting.key)) {
    lines.push('');
    lines.push('Editing: Enter opens inline edit. Delete the current text to save an empty value when that is valid for the setting.');
  }

  return lines;
}

function formatSubscriptionRoute(route: SubscriptionEntry['activeRoute'] | SubscriptionEntry['preferredRoute']): string {
  return route ? formatProviderAuthRouteId(route) : 'n/a';
}

function describeFeatureEnablement(entry: FlagEntry): string {
  const { key, kind, enabledValues } = entry.feature.enablement;
  if (kind === 'boolean') return `Switch: ${key} (true/false).`;
  if (kind === 'enum') return `Switch: ${key} — active while set to ${(enabledValues ?? []).join(' or ')}.`;
  return `Always available; its settings (${entry.feature.settings.join(', ')}) govern runtime activation directly.`;
}

function buildFlagContext(entry: FlagEntry | null): string[] {
  if (!entry) return ['Feature Controls', 'No feature control is selected.'];
  return [
    entry.feature.name,
    `ID: ${entry.feature.id}`,
    `Domain: ${entry.feature.domain}`,
    `State: ${entry.state}`,
    `Default: ${entry.feature.defaultEnabled ? 'enabled' : 'disabled'}`,
    `Current value: ${entry.feature.enablement.key} = ${entry.enablementValue}`,
    `Live toggleable: ${entry.feature.restartRequired ? 'no' : 'yes'}`,
    '',
    entry.feature.description,
    '',
    describeFeatureEnablement(entry),
    `Settings: ${entry.feature.settings.join(', ')}`,
    '',
    entry.feature.restartRequired
      ? 'Impact: the domain settings key is saved now and takes effect on the next Agent launch or owning-host reload.'
      : 'Impact: changes to the domain settings key apply immediately through the live settings bridge.',
  ];
}

function buildMcpContext(modal: SettingsModal, entry: McpEntry | null): string[] {
  if (!entry) return ['MCP trust', 'No MCP server is selected.'];
  const scope = entry.allowedPaths.length > 0
    ? `Allowed paths: ${entry.allowedPaths.join(', ')}`
    : entry.allowedHosts.length > 0
      ? `Allowed hosts: ${entry.allowedHosts.join(', ')}`
      : 'No explicit path or host scope is configured.';
  const confirmation = modal.mcpAllowAllConfirmationTarget === entry.name
    ? `Confirmation required: type ALLOW ALL ${entry.name} to grant unrestricted trust.`
    : 'Enter edits the trust mode. Valid values are constrained, ask-on-risk, allow-all, and blocked.';
  return [
    entry.name,
    `Connection: ${entry.connected ? 'connected' : 'disconnected'}`,
    `Role: ${entry.role}`,
    `Trust mode: ${entry.trustMode}`,
    confirmation,
    '',
    scope,
    '',
    'Trust meanings:',
    'constrained: keep MCP activity inside declared paths/hosts and prompt on risk.',
    'ask-on-risk: allow routine MCP operations but ask before risky behavior.',
    'allow-all: allow unrestricted MCP operations for this server after explicit confirmation.',
    'blocked: prevent this MCP server from being used.',
  ];
}

function buildSubscriptionContext(modal: SettingsModal, entry: SubscriptionEntry | null): string[] {
  if (!entry) return ['Subscriptions', 'No subscription provider is selected.'];
  const expires = entry.expiresAt ? new Date(entry.expiresAt).toISOString() : 'not reported';
  const routeReason = inferSubscriptionRouteReason(entry);
  const logout = entry.state === 'active' || entry.state === 'pending'
    ? modal.subscriptionLogoutConfirmationTarget === entry.provider
      ? `Press Enter again to sign out ${entry.provider}. Move selection or close config to cancel.`
      : 'Press Enter to review sign-out for this provider session.'
    : `Open Agent Workspace -> Setup and choose Start subscription login for ${entry.provider}.`;
  return [
    entry.provider,
    `State: ${entry.state}`,
    ...(routeReason ? [routeReason] : []),
    logout,
    `Active route: ${formatSubscriptionRoute(entry.activeRoute)}`,
    `Preferred route: ${formatSubscriptionRoute(entry.preferredRoute)}`,
    `OAuth configured: ${entry.oauthConfigured ? 'yes' : 'no'}`,
    `Freshness: ${entry.authFreshness ?? 'n/a'}`,
    `Expires: ${expires}`,
    ...((entry.issues ?? []).length > 0 ? ['', 'Issues:', ...(entry.issues ?? [])] : []),
    ...((entry.nextActions ?? []).length > 0 ? ['', 'Next actions:', ...(entry.nextActions ?? [])] : []),
  ];
}

function buildContextLines(modal: SettingsModal, width: number): string[] {
  const category = modal.currentCategory;
  const lines: string[] = [
    `${CATEGORY_LABELS[category]} configuration`,
  ];

  if (category === 'flags') {
    lines.push(...buildFlagContext(modal.getSelectedFlag()));
  } else if (category === 'mcp') {
    lines.push(...buildMcpContext(modal, modal.getSelectedMcp()));
  } else if (category === 'subscriptions') {
    lines.push(...buildSubscriptionContext(modal, modal.getSelectedSubscription()));
  } else {
    const selected = modal.getSelected();
    if (selected) lines.push(...buildSettingContext(modal, selected));
    else lines.push('No setting is selected in this category.');
  }

  lines.push('', `Category purpose: ${CATEGORY_INFO[category]}`);

  const wrapped: string[] = [];
  for (const line of lines) {
    if (line === '') {
      wrapped.push('');
      continue;
    }
    wrapped.push(...paddedWrapped(line, width));
  }
  return wrapped;
}

function categoryItemCount(modal: SettingsModal, category: SettingsCategory): number {
  if (category === 'flags') return modal.flagEntries.length;
  if (category === 'mcp') return modal.mcpEntries.length;
  if (category === 'subscriptions') return modal.subscriptionEntries.length;
  return modal.groups.get(category)?.length ?? 0;
}

type CategoryRailEntry =
  | { readonly type: 'group'; readonly label: string }
  | { readonly type: 'category'; readonly category: SettingsCategory; readonly index: number };

type CategoryRailRow = {
  readonly text: string;
  readonly type: CategoryRailEntry['type'] | 'more' | 'empty';
  readonly selected: boolean;
};

function buildCategoryRailEntries(): CategoryRailEntry[] {
  const entries: CategoryRailEntry[] = [];
  for (const group of SETTINGS_CATEGORY_GROUPS) {
    const categories = group.categories.filter(category => SETTINGS_CATEGORIES.includes(category));
    if (categories.length === 0) continue;
    entries.push({ type: 'group', label: group.label });
    for (const category of categories) {
      entries.push({
        type: 'category',
        category,
        index: SETTINGS_CATEGORIES.indexOf(category),
      });
    }
  }
  return entries;
}

function renderCategories(modal: SettingsModal, width: number, height: number): CategoryRailRow[] {
  const rows: CategoryRailRow[] = [];
  const entries = buildCategoryRailEntries();
  const selectedEntryIndex = Math.max(0, entries.findIndex(entry => entry.type === 'category' && entry.index === modal.categoryIndex));
  const window = stableWindow(entries.length, selectedEntryIndex, height);
  if (window.start > 0) rows.push({ text: `${GLYPHS.navigation.moreAbove} ${window.start} more row(s) above`, type: 'more', selected: false });
  for (let railIndex = window.start; railIndex < window.end; railIndex += 1) {
    const entry = entries[railIndex]!;
    if (entry.type === 'group') {
      rows.push({ text: entry.label.toUpperCase(), type: 'group', selected: false });
      continue;
    }
    const category = entry.category;
    const active = entry.index === modal.categoryIndex;
    const count = categoryItemCount(modal, category);
    const cursor = active ? (modal.focusPane === 'categories' ? GLYPHS.navigation.selected : '•') : ' ';
    rows.push({ text: `  ${cursor} ${CATEGORY_LABELS[category]} (${count})`, type: 'category', selected: active });
  }
  if (window.end < entries.length) rows.push({ text: `${GLYPHS.navigation.moreBelow} ${entries.length - window.end} more row(s) below`, type: 'more', selected: false });
  while (rows.length < height) rows.push({ text: '', type: 'empty', selected: false });
  return rows.slice(0, height);
}

function renderSettingRows(modal: SettingsModal, width: number, height: number): string[] {
  const rows: string[] = [];
  const items = modal.currentItems;
  if (items.length === 0) return ['No settings in this category.'];
  const selectedIndex = clamp(modal.selectedIndex, 0, items.length - 1);
  const typeWidth = 9;
  const sourceWidth = 12;
  const defaultWidth = 12;
  const available = Math.max(24, width - typeWidth - sourceWidth - defaultWidth - 13);
  const keyWidth = clamp(Math.floor(available * 0.56), 18, 52);
  const valueWidth = Math.max(10, available - keyWidth);
  rows.push(`  ${padDisplay('Setting', keyWidth)}  ${padDisplay('Value', valueWidth)}  ${padDisplay('Type', typeWidth)}  ${padDisplay('Source', sourceWidth)}  ${padDisplay('Default', defaultWidth)}`);
  const visibleCount = Math.max(1, height - 2);
  const window = stableWindow(items.length, selectedIndex, visibleCount);
  if (window.start > 0) rows.push(`${GLYPHS.navigation.moreAbove} ${window.start} more setting(s) above`);

  for (let index = window.start; index < window.end; index += 1) {
    const entry = items[index]!;
    const selected = index === selectedIndex;
    const marker = selected ? (modal.focusPane === 'settings' ? GLYPHS.navigation.selected : '•') : entry.isDefault ? ' ' : '◇';
    const value = currentSettingValue(modal, entry, selected);
    const source = `${entry.effectiveSource ?? 'default'}${entry.locked ? ' locked' : ''}${entry.conflict ? ' conflict' : ''}`;
    const label = getSettingLabel(entry);
    rows.push(`${marker} ${padDisplay(label, keyWidth)}  ${padDisplay(value, valueWidth)}  ${padDisplay(entry.setting.type, typeWidth)}  ${padDisplay(source, sourceWidth)}  ${padDisplay(formatDefaultForEntry(modal, entry), defaultWidth)}`);
  }

  if (window.end < items.length) rows.push(`${GLYPHS.navigation.moreBelow} ${items.length - window.end} more setting(s) below`);
  return rows.slice(0, height);
}

function renderFlagRows(modal: SettingsModal, width: number, height: number): string[] {
  const rows: string[] = [];
  const items = modal.flagEntries;
  if (items.length === 0) return ['No features registered.'];
  const selectedIndex = clamp(modal.selectedIndex, 0, items.length - 1);
  const nameWidth = clamp(Math.floor(width * 0.34), 22, 52);
  const stateWidth = 10;
  const domainWidth = 13;
  const runtimeWidth = 10;
  const defaultWidth = 9;
  const settingWidth = Math.max(16, width - nameWidth - stateWidth - domainWidth - runtimeWidth - defaultWidth - 14);
  rows.push(`  ${padDisplay('Feature', nameWidth)}  ${padDisplay('State', stateWidth)}  ${padDisplay('Domain', domainWidth)}  ${padDisplay('Applies', runtimeWidth)}  ${padDisplay('Default', defaultWidth)}  ${padDisplay('Setting', settingWidth)}`);
  const visibleCount = Math.max(1, height - 2);
  const window = stableWindow(items.length, selectedIndex, visibleCount);
  if (window.start > 0) rows.push(`${GLYPHS.navigation.moreAbove} ${window.start} more feature(s) above`);
  for (let index = window.start; index < window.end; index += 1) {
    const entry = items[index]!;
    const selected = index === selectedIndex;
    const marker = selected ? (modal.focusPane === 'settings' ? GLYPHS.navigation.selected : '•') : ' ';
    rows.push(`${marker} ${padDisplay(entry.feature.name, nameWidth)}  ${padDisplay(entry.state, stateWidth)}  ${padDisplay(entry.feature.domain, domainWidth)}  ${padDisplay(entry.feature.restartRequired ? 'next run' : 'now', runtimeWidth)}  ${padDisplay(entry.feature.defaultEnabled ? 'enabled' : 'disabled', defaultWidth)}  ${padDisplay(`${entry.feature.enablement.key}=${entry.enablementValue}`, settingWidth)}`);
  }
  if (window.end < items.length) rows.push(`${GLYPHS.navigation.moreBelow} ${items.length - window.end} more feature(s) below`);
  return rows.slice(0, height);
}

function renderMcpRows(modal: SettingsModal, width: number, height: number): string[] {
  const rows: string[] = [];
  const items = modal.mcpEntries;
  if (items.length === 0) return ['No MCP servers registered.'];
  const selectedIndex = clamp(modal.selectedIndex, 0, items.length - 1);
  const nameWidth = clamp(Math.floor(width * 0.32), 18, 44);
  const trustWidth = 14;
  const roleWidth = 12;
  const statusWidth = 12;
  const scopeWidth = Math.max(12, width - nameWidth - trustWidth - roleWidth - statusWidth - 10);
  rows.push(`  ${padDisplay('Server', nameWidth)}  ${padDisplay('Trust', trustWidth)}  ${padDisplay('Role', roleWidth)}  ${padDisplay('Status', statusWidth)}  ${padDisplay('Scope', scopeWidth)}`);
  const window = stableWindow(items.length, selectedIndex, Math.max(1, height - 2));
  if (window.start > 0) rows.push(`${GLYPHS.navigation.moreAbove} ${window.start} more MCP server(s) above`);
  for (let index = window.start; index < window.end; index += 1) {
    const entry = items[index]!;
    const selected = index === selectedIndex;
    const trust = selected && modal.editingMode ? `${modal.editBuffer}${GLYPHS.surface.cursor}` : entry.trustMode;
    const scope = entry.allowedPaths.length > 0 ? entry.allowedPaths.join(', ') : entry.allowedHosts.length > 0 ? entry.allowedHosts.join(', ') : 'none';
    const marker = selected ? (modal.focusPane === 'settings' ? GLYPHS.navigation.selected : '•') : ' ';
    rows.push(`${marker} ${padDisplay(entry.name, nameWidth)}  ${padDisplay(trust, trustWidth)}  ${padDisplay(entry.role, roleWidth)}  ${padDisplay(entry.connected ? 'connected' : 'offline', statusWidth)}  ${padDisplay(scope, scopeWidth)}`);
  }
  if (window.end < items.length) rows.push(`${GLYPHS.navigation.moreBelow} ${items.length - window.end} more MCP server(s) below`);
  return rows.slice(0, height);
}

function renderSubscriptionRows(modal: SettingsModal, width: number, height: number): string[] {
  const rows: string[] = [];
  const items = modal.subscriptionEntries;
  if (items.length === 0) return ['No provider subscriptions available or configured.'];
  const selectedIndex = clamp(modal.selectedIndex, 0, items.length - 1);
  const providerWidth = clamp(Math.floor(width * 0.28), 14, 36);
  const stateWidth = 10;
  const routeWidth = 16;
  const freshnessWidth = 14;
  const oauthWidth = 8;
  const noteWidth = Math.max(12, width - providerWidth - stateWidth - routeWidth - freshnessWidth - oauthWidth - 12);
  rows.push(`  ${padDisplay('Provider', providerWidth)}  ${padDisplay('State', stateWidth)}  ${padDisplay('Route', routeWidth)}  ${padDisplay('Freshness', freshnessWidth)}  ${padDisplay('OAuth', oauthWidth)}  ${padDisplay('Note', noteWidth)}`);
  const window = stableWindow(items.length, selectedIndex, Math.max(1, height - 2));
  if (window.start > 0) rows.push(`${GLYPHS.navigation.moreAbove} ${window.start} more subscription provider(s) above`);
  for (let index = window.start; index < window.end; index += 1) {
    const entry = items[index]!;
    const selected = index === selectedIndex;
    const marker = selected ? (modal.focusPane === 'settings' ? GLYPHS.navigation.selected : '•') : ' ';
    rows.push(`${marker} ${padDisplay(entry.provider, providerWidth)}  ${padDisplay(entry.state, stateWidth)}  ${padDisplay(formatSubscriptionRoute(entry.activeRoute), routeWidth)}  ${padDisplay(entry.authFreshness ?? 'n/a', freshnessWidth)}  ${padDisplay(entry.oauthConfigured ? 'yes' : 'no', oauthWidth)}  ${padDisplay(inferSubscriptionRouteReason(entry) ?? '', noteWidth)}`);
  }
  if (window.end < items.length) rows.push(`${GLYPHS.navigation.moreBelow} ${items.length - window.end} more subscription provider(s) below`);
  return rows.slice(0, height);
}

function renderControlRows(modal: SettingsModal, width: number, height: number): string[] {
  if (modal.currentCategory === 'flags') return renderFlagRows(modal, width, height);
  if (modal.currentCategory === 'mcp') return renderMcpRows(modal, width, height);
  if (modal.currentCategory === 'subscriptions') return renderSubscriptionRows(modal, width, height);
  return renderSettingRows(modal, width, height);
}

function rowColorForSetting(modal: SettingsModal, rowText: string): string {
  if (rowText.startsWith(GLYPHS.navigation.selected)) return PALETTE.text;
  const selected = modal.getSelected();
  if (!selected) return PALETTE.text;
  return valueColor(selected);
}

function footerText(modal: SettingsModal): string {
  if (modal.editingMode) return 'Enter Confirm edit · Esc Cancel edit · text keys edit the selected field';
  if (modal.focusPane === 'categories') return 'Focus categories · Up/Down choose · Right/Enter settings · Tab pane · Esc close';
  if (modal.currentCategory === 'subscriptions') return 'Focus settings · Up/Down provider · Left categories · Tab pane · Enter review/sign out · Esc close';
  if (modal.currentCategory === 'mcp') return 'Focus settings · Up/Down server · Left categories · Tab pane · Enter edit trust · Esc close';
  if (modal.currentCategory === 'flags') return 'Focus features · Up/Down feature · Left categories · Tab pane · Enter/Space toggle · Esc close';
  return 'Focus settings · Up/Down setting · Left categories · Tab pane · Enter/Space edit/toggle · R reset · Esc close';
}

export function renderSettingsModalPackageText(): string {
  const lines: string[] = [
    'Configuration Workspace / Settings',
    'Categories',
    'Setting',
    'Value',
    'Type',
    'Source',
    'Default',
    'Feature',
    'State',
    'Domain',
    'Applies',
    'Server',
    'Trust',
    'Status',
    'Scope',
    'Provider',
    'Route',
    'Freshness',
    'OAuth',
    'Note',
    'No settings in this category.',
    'No features registered.',
    'No MCP servers registered.',
    'No provider subscriptions available or configured.',
    'No setting is selected in this category.',
    'No feature control is selected.',
    'No MCP server is selected.',
    'No subscription provider is selected.',
    'Trust meanings:',
    'constrained: keep MCP activity inside declared paths/hosts and prompt on risk.',
    'ask-on-risk: allow routine MCP operations but ask before risky behavior.',
    'allow-all: allow unrestricted MCP operations for this server after explicit confirmation.',
    'blocked: prevent this MCP server from being used.',
    'Possible values:',
    'true: enabled or allowed for this setting.',
    'false: disabled or not allowed for this setting.',
    'Secret handling: raw values entered here are stored through the secret manager and the config receives a goodvibes:// secret reference. Empty input clears the config value.',
    'Editing: Enter opens inline edit, then type the value and press Enter to save. Arrow keys only navigate.',
    'Editing: Enter opens inline edit. Delete the current text to save an empty value when that is valid for the setting.',
    'Enter Confirm edit · Esc Cancel edit · text keys edit the selected field',
    'Focus categories · Up/Down choose · Right/Enter settings · Tab pane · Esc close',
    'Focus settings · Up/Down provider · Left categories · Tab pane · Enter review/sign out · Esc close',
    'Focus settings · Up/Down server · Left categories · Tab pane · Enter edit trust · Esc close',
    'Focus features · Up/Down feature · Left categories · Tab pane · Enter/Space toggle · Esc close',
    'Read-only connected-host setting · Change from GoodVibes TUI or the owning host · Esc close',
    'Focus settings · Up/Down setting · Left categories · Tab pane · Enter/Space edit/toggle · R reset · Esc close',
  ];

  for (const group of SETTINGS_CATEGORY_GROUPS) {
    lines.push(group.label);
    for (const category of group.categories) {
      lines.push(category, CATEGORY_LABELS[category], CATEGORY_INFO[category]);
    }
  }

  for (const [key, values] of Object.entries(ENUM_VALUE_DESCRIPTIONS)) {
    lines.push(key);
    for (const [value, description] of Object.entries(values)) {
      lines.push(value, description);
    }
  }

  return lines.join('\n');
}

export function renderSettingsModal(
  modal: SettingsModal,
  width: number,
  viewportHeight = 24,
): Line[] {
  const notices = [
    ...(modal.lastSettingEffectMessage ? [modal.lastSettingEffectMessage] : []),
  ];
  const metrics = getFullscreenWorkspaceMetrics({ width, height: viewportHeight });
  const categoryRows = renderCategories(modal, metrics.leftWidth - 2, metrics.bodyRows);
  const contextRows = buildContextLines(modal, metrics.contextWidth).map((text, row): WorkspaceRow => {
    const selectedSetting = modal.getSelected();
    const isTitle = row === 0 || (selectedSetting !== null && text === getSettingLabel(selectedSetting));
    return {
      text,
      fg: row === 0 ? PALETTE.title : text.endsWith(':') ? PALETTE.subtitle : PALETTE.text,
      bold: isTitle,
      dim: text.length === 0,
    };
  });
  const controlRows = renderControlRows(modal, metrics.contextWidth, metrics.controlRows).map((text): WorkspaceRow => {
    const selected = text.startsWith(GLYPHS.navigation.selected);
    return {
      text,
      selected,
      fg: selected
        ? PALETTE.text
        : text.startsWith('value:') || text.trimStart().startsWith('value:')
          ? PALETTE.info
          : rowColorForSetting(modal, text),
      bold: selected,
      dim: text.length === 0,
    };
  });

  return renderFullscreenWorkspace({
    width,
    height: viewportHeight,
    title: 'Configuration Workspace / Settings',
    leftHeader: 'Categories',
    mainHeader: `${CATEGORY_LABELS[modal.currentCategory]} (${categoryItemCount(modal, modal.currentCategory)})${notices.length > 0 ? ` · ${notices.join(' · ')}` : ''}`,
    leftRows: categoryRows.map((row): WorkspaceRow => ({
      text: row.text,
      selected: row.selected,
      kind: row.type === 'group' ? 'group' : row.type === 'more' ? 'more' : row.type === 'empty' ? 'empty' : 'item',
      bold: row.selected || row.type === 'group',
    })),
    contextRows,
    controlRows,
    footer: footerText(modal),
  });
}
