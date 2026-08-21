import type { ConfigManager } from '../config/index.ts';
import { getProviderIdFromModel } from '../config/provider-model.ts';
import type { ConversationManager } from '../core/conversation';
import type { CommandContext } from '../input/command-registry.ts';
import type { InputHandler } from '../input/handler.ts';
import type { ProviderRegistry } from '@pellux/goodvibes-sdk/platform/providers';
import { describeServingEffort, effortPresentationForModel, publishActiveEffortOptions, requestedEffortLevel, servingEffortForLevel, toEffortModel } from '../providers/reasoning-effort-surface.ts';
import type { MutableRuntimeState } from '@/runtime/index.ts';
import type { FeatureFlagManager } from '@/runtime/index.ts';
import type { McpRegistry } from '@pellux/goodvibes-sdk/platform/mcp';
import type { SubscriptionManager } from '@pellux/goodvibes-sdk/platform/config';
import type { SecretsManager } from '@pellux/goodvibes-sdk/platform/config';
import type { ServiceInspectionQuery } from '@/runtime/index.ts';
import type { ModelPickerTargetInfo } from '../input/model-picker.ts';
import { buildLocalFitRecommendations, buildSignInRow, LOCAL_REC_PROVIDER } from '../input/model-picker-local-fit.ts';
import { syncServiceSettingToPlatform } from './service-settings-sync.ts';
import { applyThemeModeSettingChange, THEME_MODE_CONFIG_KEY } from '../renderer/theme-mode-config.ts';

type WireShellUiOpenersOptions = {
  commandContext: CommandContext;
  input: InputHandler;
  conversation: ConversationManager;
  configManager: ConfigManager;
  providerRegistry: ProviderRegistry;
  runtime: MutableRuntimeState;
  featureFlags: FeatureFlagManager;
  mcpRegistry: McpRegistry;
  subscriptionManager: SubscriptionManager;
  secretsManager?: Pick<SecretsManager, 'delete' | 'get' | 'set'>;
  serviceRegistry: Pick<ServiceInspectionQuery, 'getAll'>;
  workingDirectory: string;
  homeDirectory: string;
  getConfiguredProviderIds: () => string[];
  getPinned: () => Promise<string[]>;
  render: () => void;
};

/**
 * Derive the configuredVia tier for a provider.
 * Tier order mirrors SDK provider-routes.ts: env → secrets → subscription → undefined.
 * The preResolvedSecretKeys set is pre-fetched async before the sync picker render cycle.
 */
function deriveConfiguredVia(
  providerId: string,
  configuredIds: Set<string>,
  subscriptionManager: SubscriptionManager,
  preResolvedSecretKeys?: ReadonlySet<string>,
): 'env' | 'secrets' | 'subscription' | 'anonymous' | undefined {
  if (!configuredIds.has(providerId)) return undefined;

  // Tier 1: subscription check (most specific, subscription overrides env for this provider)
  const subs = subscriptionManager.list();
  if (subs.some((s) => s.provider === providerId)) return 'subscription';

  // Tier 2: env-var present (process.env check; anonymous providers don't appear in configuredIds)
  // We don't have BUILTIN_PROVIDER_ENV_KEYS here; if env was used the configuredIds path covers it.
  // The presence in configuredIds and no subscription → either env or secrets.
  // Tier 3: secrets-manager backed (pre-resolved async batch)
  if (preResolvedSecretKeys && preResolvedSecretKeys.has(providerId)) return 'secrets';

  return 'env';
}

/**
 * Build a configuredViaMap for the given provider list.
 * Pass preResolvedSecretKeys (from an async SecretsManager batch) to surface the 'secrets' tier.
 */
function buildConfiguredViaMap(
  providers: string[],
  configuredIds: Set<string>,
  subscriptionManager: SubscriptionManager,
  preResolvedSecretKeys?: ReadonlySet<string>,
): Map<string, 'env' | 'secrets' | 'subscription' | 'anonymous'> {
  const map = new Map<string, 'env' | 'secrets' | 'subscription' | 'anonymous'>();
  for (const p of providers) {
    const via = deriveConfiguredVia(p, configuredIds, subscriptionManager, preResolvedSecretKeys);
    if (via !== undefined) map.set(p, via);
  }
  return map;
}

export function wireShellUiOpeners(options: WireShellUiOpenersOptions): void {
  const {
    commandContext,
    input,
    conversation,
    configManager,
    providerRegistry,
    runtime,
    featureFlags,
    mcpRegistry,
    subscriptionManager,
    secretsManager,
    serviceRegistry,
    workingDirectory,
    homeDirectory,
    getConfiguredProviderIds,
    getPinned,
    render,
  } = options;

  /**
   * Pre-resolve which provider IDs have secrets-manager keys (async batch, SDK tier pattern).
   * Returns a set of provider IDs (not env var names) that are secrets-backed.
   * Falls back to empty set if secretsManager is not provided.
   */
  async function resolveSecretProviderIds(): Promise<ReadonlySet<string>> {
    if (!secretsManager) return new Set<string>();
    const configuredIds = new Set(getConfiguredProviderIds());
    // We use provider ID as the lookup key since we don't have BUILTIN_PROVIDER_ENV_KEYS here.
    const results = await Promise.all(
      [...configuredIds].map(async (providerId) => {
        const val = await secretsManager.get(providerId).catch(() => null);
        return val !== null ? providerId : null;
      }),
    );
    return new Set(results.filter((v): v is string => v !== null));
  }

  const getCurrentModelForPickerTarget = (): string => {
    const selectedTarget = input.modelPicker.getSelectedTargetInfo();
    const target = selectedTarget?.target ?? input.modelPicker.target;
    if (target === 'helper') return String(configManager.get('helper.globalModel') || runtime.model);
    if (target === 'tool') return String(configManager.get('tools.llmModel') || runtime.model);
    if (target === 'tts') return String(configManager.get('tts.llmModel') || runtime.model);
    return runtime.model;
  };

  const getCurrentProviderForPickerTarget = (): string => {
    const selectedTarget = input.modelPicker.getSelectedTargetInfo();
    const target = selectedTarget?.target ?? input.modelPicker.target;
    if (target === 'helper') return String(configManager.get('helper.globalProvider') || runtime.provider);
    if (target === 'tool') return String(configManager.get('tools.llmProvider') || runtime.provider);
    if (target === 'tts') return String(configManager.get('tts.llmProvider') || runtime.provider);
    return runtime.provider;
  };

  const buildModelPickerTargets = (): ModelPickerTargetInfo[] => {
    const mainProvider = getProviderIdFromModel(configManager.get('provider.model') || runtime.provider).trim();
    const mainModel = String(configManager.get('provider.model') || runtime.model || '').trim();
    const helperProvider = String(configManager.get('helper.globalProvider') ?? '').trim();
    const helperModel = String(configManager.get('helper.globalModel') ?? '').trim();
    const toolProvider = String(configManager.get('tools.llmProvider') ?? '').trim();
    const toolModel = String(configManager.get('tools.llmModel') ?? '').trim();
    const ttsProvider = String(configManager.get('tts.llmProvider') ?? '').trim();
    const ttsModel = String(configManager.get('tts.llmModel') ?? '').trim();

    return [
      {
        target: 'main',
        label: 'Main Chat',
        description: 'Default provider and model for normal chat turns in this TUI session.',
        provider: mainProvider,
        model: mainModel,
        enabled: true,
        inherited: false,
      },
      {
        target: 'helper',
        label: 'Helper Model',
        description: 'Optional helper route used for supporting work. Empty provider/model values inherit Main Chat.',
        provider: helperProvider || mainProvider,
        model: helperModel || mainModel,
        enabled: Boolean(configManager.get('helper.enabled')),
        inherited: helperProvider.length === 0 && helperModel.length === 0,
      },
      {
        target: 'tool',
        label: 'Tool LLM',
        description: 'Optional LLM route for tool-specific reasoning. Selecting a model enables the tool LLM route.',
        provider: toolProvider || mainProvider,
        model: toolModel || mainModel,
        enabled: Boolean(configManager.get('tools.llmEnabled')),
        inherited: toolProvider.length === 0 && toolModel.length === 0,
      },
      {
        target: 'tts',
        label: 'TTS LLM',
        description: 'Optional LLM override for /tts response generation. Empty values use the current chat model.',
        provider: ttsProvider || mainProvider,
        model: ttsModel || mainModel,
        enabled: true,
        inherited: ttsProvider.length === 0 && ttsModel.length === 0,
      },
    ];
  };

  commandContext.openModelPicker = () => {
    // Picker-open re-check: re-verify each provider's live model list (TTL-
    // respecting) so a freshly-opened picker reflects models the provider
    // started or stopped serving. Fire-and-forget; a completed refresh re-renders
    // so the list updates in place without blocking the open. (Same wiring as
    // the TUI's picker, the fix-everywhere convention for this defect class.)
    void providerRegistry.refreshLiveModelDiscovery?.().then((reports) => {
      if (reports.some((report) => report.added.length > 0 || report.removed.length > 0)) render();
    }).catch(() => {});
    void (async () => {
      const catalogModels = providerRegistry.getSelectableModels();
      const configuredIds = new Set(getConfiguredProviderIds());
      input.modelPicker.configuredProviders = configuredIds;

      // CRITICAL GATE: inject synthetic local recommendations ONLY when zero
      // providers are configured. When any real credential exists these must
      // not be present in the list. The sign-in row is appended last so it
      // is always reachable but does not displace hardware-fit entries.
      const models = configuredIds.size === 0
        ? [...buildLocalFitRecommendations(), buildSignInRow(), ...catalogModels]
        : catalogModels;

      const providerIds = [...new Set(models.map((m) => m.provider).filter((p) => p !== LOCAL_REC_PROVIDER))];
      const secretProviderIds = await resolveSecretProviderIds();
      input.modelPicker.configuredViaMap = buildConfiguredViaMap(providerIds, configuredIds, subscriptionManager, secretProviderIds);
      void getPinned().then((pinned) => {
        input.modelPicker.pinnedIds = new Set(pinned);
      });
      void input.modelPicker.loadRecentModels().catch(() => {}); // best-effort: prefetch for UI, failure is non-visible
      input.modalOpened('modelPicker');
      input.modelPicker.setTargetInfos(buildModelPickerTargets());
      // Pre-select the best-fit local recommendation when no providers are configured.
      const preSelectId = configuredIds.size === 0 && models.length > 0
        ? (models[0]?.registryKey ?? models[0]?.id ?? getCurrentModelForPickerTarget())
        : getCurrentModelForPickerTarget();
      input.modelPicker.openAllModels(models, preSelectId);
      render();
    })().catch((error: unknown) => {
      commandContext.print?.(`Model picker failed to open: ${error instanceof Error ? error.message : String(error)}`);
      render();
    });
  };

  commandContext.openModelPickerWithTarget = (target) => input.openModelPickerWithTarget(target);
  commandContext.openProviderModelPickerWithTarget = (target) => input.openProviderModelPickerWithTarget(target);

  commandContext.openProviderPicker = () => {
    void (async () => {
      const providers = [...new Set(providerRegistry.listModels().map((model) => model.provider))];
      const configuredIds = new Set(getConfiguredProviderIds());
      input.modelPicker.configuredProviders = configuredIds;
      const secretProviderIds = await resolveSecretProviderIds();
      input.modelPicker.configuredViaMap = buildConfiguredViaMap(providers, configuredIds, subscriptionManager, secretProviderIds);
      input.modalOpened('modelPicker');
      input.modelPicker.setTargetInfos(buildModelPickerTargets());
      input.modelPicker.openProviders(providers, getCurrentProviderForPickerTarget());
      render();
    })().catch((error: unknown) => {
      commandContext.print?.(`Provider picker failed to open: ${error instanceof Error ? error.message : String(error)}`);
      render();
    });
  };

  commandContext.openReasoningEffortPicker = () => {
    const currentModel = providerRegistry.getCurrentModel();
    const model = toEffortModel(currentModel);
    // Only this model's real levels, a fallback-sourced guess does not get an
    // automatic picker step, since the SDK's OpenAI/Gemini adapters drop the
    // level entirely for a model nothing recognises.
    publishActiveEffortOptions(model, runtime.sessionId);
    const presentation = effortPresentationForModel(model);
    if (!presentation.configurable) {
      return { opened: false, model: currentModel.displayName, levels: [], reason: 'unsupported' };
    }

    // The user's REQUESTED level, not the session's effective one: this picker
    // re-chooses the preference, so it must preselect what was asked for even
    // while a model that caps lower is serving.
    const requested = requestedEffortLevel(configManager);
    // Open on the level in EFFECT, the requested level snapped to this model.
    // A requested level the model caps below is not in the list at all, and
    // preselecting a missing id lands on the lowest level rather than on what
    // is actually running.
    const current = (requested ? servingEffortForLevel(requested, model).effective : undefined)
      ?? requested
      ?? presentation.choices[0]?.level
      ?? '';
    input.openSelection(
      'Reasoning Effort',
      presentation.choices.map((choice) => ({
        id: choice.level,
        label: choice.level,
        detail: choice.level === current ? `current - ${choice.description}` : choice.description,
      })),
      { preSelectId: current, allowSearch: false },
      (result) => {
        if (!result) return;
        const level = result.item.id;
        // An explicit user choice, the one kind of write that is allowed to
        // change the stored preference.
        configManager.set('provider.reasoningEffort', level);
        const serving = servingEffortForLevel(level, model);
        runtime.reasoningEffort = serving.effective ?? '';
        commandContext.print([
          'Reasoning effort set',
          `  level ${describeServingEffort(serving, model)}`,
        ].join('\n'));
        render();
      },
    );
    return {
      opened: true,
      model: currentModel.displayName,
      levels: presentation.choices.map((choice) => choice.level),
    };
  };

  commandContext.openSelection = (title, items, opts, callback) => {
    input.openSelection(title, items, opts, callback);
  };

  commandContext.openContextInspector = () => {
    input.modalOpened('contextInspector');
    input.contextInspectorModal.open();
    render();
  };

  commandContext.openBookmarkModal = () => {
    input.modalOpened('bookmark');
    input.bookmarkModal.open();
    render();
  };

  commandContext.openProcessModal = () => {
    input.modalOpened('process');
    input.processModal.open();
    render();
  };

  commandContext.openLiveTail = (target?: string) => {
    input.processModal.refresh();
    const entries = input.processModal.entries;
    if (entries.length === 0) {
      return { opened: false, reason: 'no_processes' };
    }

    const normalizedTarget = target?.trim().toLowerCase() ?? '';
    const entry = normalizedTarget.length > 0
      ? entries.find((candidate) => (
        candidate.id.toLowerCase() === normalizedTarget
        || candidate.label.toLowerCase().includes(normalizedTarget)
      ))
      : input.processModal.getSelected() ?? entries[0];

    if (!entry) {
      return { opened: false, reason: 'not_found' };
    }

    input.modalOpened('liveTail');
    input.processModal.close();
    input.liveTailModal.open(entry);
    render();
    return { opened: true, processId: entry.id, label: entry.label };
  };

  commandContext.openConversationSearch = (query?: string) => {
    input.searchManager.open();
    const searchQuery = query?.trim() ?? '';
    if (searchQuery.length > 0) {
      input.searchManager.search(searchQuery, input.getHistory(), conversation);
    }
    render();
  };

  commandContext.openPromptHistorySearch = (query?: string) => {
    input.historySearch.open(input.prompt);
    const searchQuery = query?.trim() ?? '';
    if (searchQuery.length > 0) {
      input.historySearch.search(searchQuery);
    }
    render();
  };

  commandContext.openSlashCommandMode = (query?: string): boolean => {
    const normalizedQuery = query?.trim().replace(/^\/+/, '') ?? '';
    if (input.prompt.length > 0 && !input.prompt.startsWith('/')) {
      return false;
    }

    input.modalOpened('command');
    input.commandMode = true;
    if (input.prompt.length === 0 || !input.prompt.startsWith('/') || normalizedQuery.length > 0) {
      input.saveUndoState();
      input.prompt = `/${normalizedQuery}`;
      input.cursorPos = input.prompt.length;
    }

    const commandQuery = input.prompt.startsWith('/') ? input.prompt.slice(1) : '';
    const hasArgs = commandQuery.includes(' ');
    if (hasArgs) input.autocomplete?.reset();
    else input.autocomplete?.update(commandQuery);
    input.ensureInputCursorVisible();
    input.syncFeedContextMutableFields();
    render();
    return true;
  };

  commandContext.openFilePicker = (options): boolean => {
    const injectMode = Boolean(options?.injectMode);
    const query = options?.query?.trim() ?? '';
    const marker = `${injectMode ? '!@' : '@'}${query}`;
    const insertPos = input.cursorPos;
    input.saveUndoState();
    input.prompt = input.prompt.slice(0, insertPos) + marker + input.prompt.slice(insertPos);
    input.cursorPos = insertPos + marker.length;
    input.modalOpened('filePicker');
    input.filePicker.open(insertPos, injectMode);
    if (query.length > 0) input.filePicker.setQuery(query);
    input.ensureInputCursorVisible();
    input.syncFeedContextMutableFields();
    render();
    return true;
  };

  commandContext.openBlockActions = (): boolean => {
    if (input.prompt.trim().length > 0 || input.commandMode) {
      return false;
    }
    const nearest = conversation.findNearestBlock(input.getScrollTop());
    if (!nearest) {
      return false;
    }
    input.modalOpened('blockActions');
    input.blockActionsMenu.open(nearest);
    render();
    return true;
  };

  commandContext.openHelpOverlay = () => {
    if (!input.helpOverlayActive) input.modalOpened('help');
    input.helpOverlayActive = !input.helpOverlayActive;
    input.helpScrollOffset = 0;
  };

  commandContext.openShortcutsOverlay = () => {
    if (!input.shortcutsOverlayActive) input.modalOpened('shortcuts');
    input.shortcutsOverlayActive = !input.shortcutsOverlayActive;
    input.shortcutsScrollOffset = 0;
    render();
  };

  commandContext.openProfilePicker = () => {
    input.modalOpened('profilePicker');
    input.profilePickerModal.open();
    render();
  };

  commandContext.openSettingsModal = (target?: string) => {
    input.modalOpened('settings');
    input.settingsModal.open(configManager, featureFlags, subscriptionManager, serviceRegistry, mcpRegistry, secretsManager, {
      onSettingApplied: (change) => {
        // Forced dark/light applies immediately (mode flip + full
        // repaint via clearScreen's resetDiff); auto only re-probes at startup,
        // so it takes effect next launch (stated honestly).
        if (String(change.key) === THEME_MODE_CONFIG_KEY) {
          return applyThemeModeSettingChange(change.value, () => commandContext.clearScreen?.());
        }
        // The owner keep-awake toggle no longer needs a bespoke live-apply
        // here: services.ts wires wireRuntimePower's subscribeConfig option
        // (the SDK's own PowerManager config subscription), so setDynamic's
        // persist above already flips the real local inhibitor, and a
        // separate configManager.subscribe('power.keepAwake', ...) in
        // services.ts forwards the toggle to an adopted daemon over the wire
        // when one is reachable, both fire from the config change itself,
        // not from this settings-modal callback.
        return syncServiceSettingToPlatform(
          { configManager, workingDirectory, homeDirectory },
          change,
        );
      },
    });
    input.settingsModal.selectTarget(target);
    render();
  };

  commandContext.openMcpWorkspace = () => {
    input.openMcpWorkspace(commandContext);
    render();
  };

  commandContext.openAgentWorkspace = (categoryId?: string) => {
    input.openAgentWorkspace(commandContext, categoryId);
    render();
  };

  commandContext.dismissAgentWorkspace = () => input.dismissAgentWorkspace();

  commandContext.openSessionPicker = () => {
    input.modalOpened('sessionPicker');
    input.sessionPickerModal.open();
    render();
  };

  commandContext.openWorkspacePicker = () => {
    conversation.setSplashSuppressed(false);
    input.openAgentWorkspace(commandContext, 'home');
    conversation.rebuildHistory();
    render();
  };

  commandContext.focusPrompt = () => {
    input.indicatorFocused = false;
    render();
  };
}
