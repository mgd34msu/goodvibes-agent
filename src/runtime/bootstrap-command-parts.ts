import { getConfigSnapshot } from '../config/index.ts';
import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import type { AdaptivePlanner } from '@pellux/goodvibes-sdk/platform/core';
import type { ConversationManager } from '../core/conversation';
import type { KnowledgeApi } from '@pellux/goodvibes-sdk/platform/knowledge';
import type { AgentPromptContextReceiptStore } from '../agent/prompt-context-receipts.ts';
import type { HookApi } from '@pellux/goodvibes-sdk/platform/hooks';
import type { McpApi } from '@pellux/goodvibes-sdk/platform/mcp';
import type { ProviderApi } from '@pellux/goodvibes-sdk/platform/providers';
import type { OpsApi } from '@/runtime/index.ts';
import type { MutableRuntimeState } from '@/runtime/index.ts';
import type { ProviderRegistry } from '@pellux/goodvibes-sdk/platform/providers';
import type { CommandContext } from '../input/command-registry.ts';
import type { KeybindingsManager } from '../input/keybindings.ts';
import type { PermissionRequestHandler } from '@pellux/goodvibes-sdk/platform/permissions';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { ForensicsRegistry } from '@/runtime/index.ts';
import type { PolicyRuntimeState } from '@/runtime/index.ts';
import type { FileUndoManager } from '@pellux/goodvibes-sdk/platform/state';
import type { McpRegistry } from '@pellux/goodvibes-sdk/platform/mcp';
import type { MemoryRegistry } from '@pellux/goodvibes-sdk/platform/state';
import type { IntegrationHelperService } from '@/runtime/index.ts';
import type { KnowledgeService } from '@pellux/goodvibes-sdk/platform/knowledge';
import type { PluginManager } from '@pellux/goodvibes-sdk/platform/plugins';
import type { HookWorkbench } from '@pellux/goodvibes-sdk/platform/hooks';
import type { WorktreeRegistry } from '@/runtime/index.ts';
import type { SandboxSessionRegistry } from '@/runtime/index.ts';
import type { UiReadModels } from './ui-read-models.ts';
import type { ShellPathService } from '@/runtime/index.ts';
import type {
  ShellAgentManagerService,
  ShellAutomationManagerRuntimeService,
  ShellModeManagerService,
  ShellPlanManagerService,
  ShellSessionOrchestrationService,
  RemoteCommandService,
  PlanRuntimeService,
} from '@/runtime/index.ts';
import type { BootstrapCommandShellServices } from '@/runtime/index.ts';
import type { OperatorClient } from '@/runtime/index.ts';
import type { PeerClient } from '@/runtime/index.ts';
import type { DirectTransport } from '@/runtime/index.ts';
import type { VoiceProviderRegistry, VoiceService } from '@pellux/goodvibes-sdk/platform/voice';
import type { AgentMemoryDiagnostics, AgentVoiceSetupService } from './services.ts';
import type { MediaProviderRegistry } from '@pellux/goodvibes-sdk/platform/media';
import type { ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { ChannelDeliveryRouter } from '@pellux/goodvibes-sdk/platform/channels';
import type { AgentExecutionLedger } from './execution-ledger.ts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import type { ConsolidationReceiptSource } from '../agent/memory-consolidation-proposals.ts';
import { listPendingConsolidationProposals } from '../agent/memory-consolidation-proposals.ts';

export type BootstrapCommandSessionSection = CommandContext['session'];
export type BootstrapCommandProviderSection = CommandContext['provider'];
export type BootstrapCommandWorkspaceSection = CommandContext['workspace'];
export type BootstrapCommandPlatformSection = CommandContext['platform'];
export type BootstrapCommandOpsSection = CommandContext['ops'];
export type BootstrapCommandExtensionSection = CommandContext['extensions'];
export type BootstrapCommandClientSection = NonNullable<CommandContext['clients']>;

export interface BootstrapCommandActionOptions {
  readonly providerRegistry: ProviderRegistry;
  readonly configManager: ConfigManager;
  readonly conversation: ConversationManager;
  readonly runtime: MutableRuntimeState;
  readonly requestRender: () => void;
  readonly loadSystemPrompt: () => string;
  readonly activatePlan: (planId: string, task: string) => void;
  readonly requestPermission: PermissionRequestHandler;
  readonly completeModelSelectionSideEffect?: () => void;
}

export interface BootstrapCommandSectionOptions {
  readonly configManager: ConfigManager;
  readonly providerRegistry: ProviderRegistry;
  readonly conversation: ConversationManager;
  readonly runtime: MutableRuntimeState;
  readonly keybindingsManager?: KeybindingsManager;
  readonly processManager?: import('@pellux/goodvibes-sdk/platform/tools').ProcessManager;
  readonly requestRender: () => void;
  readonly requestPermission: PermissionRequestHandler;
  readonly toolRegistry: ToolRegistry;
  readonly mcpRegistry: McpRegistry;
  readonly voiceProviderRegistry?: VoiceProviderRegistry;
  readonly voiceService?: VoiceService;
  readonly voiceSetup?: AgentVoiceSetupService;
  readonly memoryGovernor?: AgentMemoryDiagnostics;
  readonly mediaProviderRegistry?: MediaProviderRegistry;
  readonly artifactStore?: ArtifactStore;
  readonly channelDeliveryRouter?: ChannelDeliveryRouter;
  readonly forensicsRegistry: ForensicsRegistry;
  readonly policyRuntimeState: PolicyRuntimeState;
  readonly readModels: UiReadModels;
  readonly shellPaths: ShellPathService;
  readonly fileUndoManager: FileUndoManager;
  readonly executionLedger?: AgentExecutionLedger;
  readonly memoryRegistry?: MemoryRegistry;
  readonly integrationHelpers?: IntegrationHelperService;
  readonly knowledgeService?: KnowledgeService;
  readonly projectPlanningService?: import('@pellux/goodvibes-sdk/platform/knowledge').ProjectPlanningService;
  readonly projectPlanningProjectId?: string;
  readonly workPlanStore?: import('../work-plans/work-plan-store.ts').WorkPlanStore;
  readonly pluginManager?: PluginManager;
  readonly hookWorkbench?: HookWorkbench;
  readonly providerOptimizer?: import('@pellux/goodvibes-sdk/platform/providers').ProviderOptimizer;
  readonly sessionManager?: import('@pellux/goodvibes-sdk/platform/sessions').SessionManager;
  readonly profileManager?: import('@pellux/goodvibes-sdk/platform/profiles').ProfileManager;
  readonly bookmarkManager?: import('@pellux/goodvibes-sdk/platform/bookmarks').BookmarkManager;
  readonly favoritesStore?: import('@pellux/goodvibes-sdk/platform/providers').FavoritesStore;
  readonly benchmarkStore?: import('@pellux/goodvibes-sdk/platform/providers').BenchmarkStore;
  readonly subscriptionManager?: import('@pellux/goodvibes-sdk/platform/config').SubscriptionManager;
  readonly secretsManager?: import('../config/secrets.ts').SecretsManager;
  readonly serviceRegistry?: import('@pellux/goodvibes-sdk/platform/config').ServiceRegistry;
  readonly localUserAuthManager?: import('@pellux/goodvibes-sdk/platform/security').UserAuthManager;
  readonly tokenAuditor?: import('@pellux/goodvibes-sdk/platform/security').ApiTokenAuditor;
  readonly replayEngine?: import('@pellux/goodvibes-sdk/platform/core').DeterministicReplayEngine;
  readonly webhookNotifier?: import('@pellux/goodvibes-sdk/platform/integrations').WebhookNotifier;
  readonly sessionMemoryStore?: import('@pellux/goodvibes-sdk/platform/core').SessionMemoryStore;
  readonly sessionLineageTracker?: import('@pellux/goodvibes-sdk/platform/core').SessionLineageTracker;
  readonly changeTracker?: import('@pellux/goodvibes-sdk/platform/sessions').SessionChangeTracker;
  readonly agentManager?: ShellAgentManagerService;
  readonly modeManager?: ShellModeManagerService;
  readonly automationManager?: ShellAutomationManagerRuntimeService;
  readonly planManager?: ShellPlanManagerService;
  readonly adaptivePlanner?: AdaptivePlanner;
  readonly sessionOrchestration?: ShellSessionOrchestrationService;
  readonly remoteRuntime?: RemoteCommandService;
  readonly planRuntime?: PlanRuntimeService;
  readonly operatorClient?: OperatorClient;
  readonly peerClient?: PeerClient;
  readonly providerApi?: ProviderApi;
  readonly agentKnowledgeApi?: KnowledgeApi;
  readonly promptContextReceipts?: AgentPromptContextReceiptStore;
  readonly hookApi?: HookApi;
  readonly mcpApi?: McpApi;
  readonly opsApi?: OpsApi;
  readonly directTransport?: DirectTransport;
  readonly worktreeRegistry: WorktreeRegistry;
  readonly sandboxSessionRegistry: SandboxSessionRegistry;
  /**
   * The runtime's own memory-consolidation scheduler, exposed to the memory
   * review surface (input/commands/recall-review.ts) as
   * clients.memoryConsolidation — see agent/memory-consolidation-proposals.ts.
   */
  readonly memoryConsolidationScheduler?: ConsolidationReceiptSource;
}

function unwiredShellAction(name: string): never {
  throw new Error(`Agent runtime action "${name}" was called before the operator route was attached.`);
}

export function createBootstrapCommandActions(
  options: BootstrapCommandActionOptions,
): Pick<
  CommandContext,
  | 'renderRequest'
  | 'submitInput'
  | 'executeCommand'
  | 'cancelGeneration'
  | 'clearScreen'
  | 'activatePlan'
  | 'requestPermission'
  | 'completeModelSelection'
  | 'jumpToBookmark'
  | 'scrollToLine'
  | 'print'
  | 'exit'
  | 'reloadSystemPrompt'
  | 'openMcpWorkspace'
  | 'openAgentWorkspace'
  | 'dismissAgentWorkspace'
  | 'openSecurityPanel'
  | 'openKnowledgePanel'
  | 'openSubscriptionPanel'
> {
  const {
    providerRegistry,
    configManager,
    conversation,
    runtime,
    requestRender,
    loadSystemPrompt,
    activatePlan,
    requestPermission,
    completeModelSelectionSideEffect,
  } = options;

  const pointToWorkspace = (what: string) => {
    conversation.log(`${what} lives in the Agent workspace — press Ctrl+P or run /agent.`, { fg: '214' });
    requestRender();
  };

  return {
    renderRequest: requestRender,
    submitInput: () => unwiredShellAction('submitInput'),
    executeCommand: async () => unwiredShellAction('executeCommand'),
    cancelGeneration: () => unwiredShellAction('cancelGeneration'),
    clearScreen: () => unwiredShellAction('clearScreen'),
    activatePlan,
    requestPermission: (request) => requestPermission(request),
    completeModelSelection: ({ model, effort, contextCap, target }) => {
      if (!model) return;
      const def = model;
      const key = def.registryKey ?? `${def.provider}:${def.id}`;
      const resolvedTarget = target ?? 'main';
      try {
        if (resolvedTarget === 'helper') {
          // Write to helper config keys and enable the helper
          configManager.set('helper.globalProvider', def.provider);
          configManager.set('helper.globalModel', key);
          configManager.set('helper.enabled', true);
          conversation.log(`Helper model set to: ${def.displayName} (${def.provider})`, { fg: '135' });
        } else if (resolvedTarget === 'tool') {
          // Write to tool LLM config keys and enable the tool LLM
          configManager.set('tools.llmProvider', def.provider);
          configManager.set('tools.llmModel', key);
          configManager.setDynamic('tools.llmEnabled', true);
          conversation.log(`Tool LLM set to: ${def.displayName} (${def.provider})`, { fg: '135' });
        } else if (resolvedTarget === 'tts') {
          configManager.set('tts.llmProvider', def.provider);
          configManager.set('tts.llmModel', key);
          conversation.log(`TTS LLM set to: ${def.displayName} (${def.provider})`, { fg: '135' });
        } else {
          // Default: main provider/model
          if (contextCap != null && contextCap > 0) {
            providerRegistry.setModelContextCap(key, contextCap);
          }
          providerRegistry.setCurrentModel(key);
          runtime.model = key;
          runtime.provider = def.provider;
          runtime.reasoningEffort = effort as 'instant' | 'low' | 'medium' | 'high';
          configManager.set('provider.model', key);
          configManager.set('provider.reasoningEffort', effort as 'instant' | 'low' | 'medium' | 'high');
          const ctxNote = contextCap != null && contextCap > 0
            ? `, context cap: ${contextCap.toLocaleString()}`
            : '';
          conversation.log(`Switched to model: ${def.displayName} (${def.provider}), effort: ${effort}${ctxNote}`, { fg: '135' });
        }
      } catch (e) {
        conversation.log(`Error switching model: ${summarizeError(e)}`, { fg: '#ef4444' });
      }
      completeModelSelectionSideEffect?.();
      requestRender();
    },
    jumpToBookmark: () => unwiredShellAction('jumpToBookmark'),
    scrollToLine: () => unwiredShellAction('scrollToLine'),
    print: (text: string) => {
      conversation.log(text, { fg: '252' });
      requestRender();
    },
    exit: () => unwiredShellAction('exit'),
    reloadSystemPrompt: loadSystemPrompt,
    openMcpWorkspace: () => unwiredShellAction('openMcpWorkspace'),
    openAgentWorkspace: () => unwiredShellAction('openAgentWorkspace'),
    dismissAgentWorkspace: () => unwiredShellAction('dismissAgentWorkspace'),
    openSecurityPanel: () => {
      pointToWorkspace('Security review');
    },
    openKnowledgePanel: () => {
      pointToWorkspace('Knowledge');
    },
    openSubscriptionPanel: () => {
      pointToWorkspace('Provider subscriptions');
    },
  };
}

export function createBootstrapCommandSessionSection(
  options: Pick<
    BootstrapCommandSectionOptions,
    'conversation' | 'runtime' | 'sessionManager' | 'sessionMemoryStore' | 'sessionLineageTracker' | 'changeTracker'
  >,
): BootstrapCommandSessionSection {
  return {
    conversationManager: options.conversation,
    runtime: options.runtime,
    sessionManager: options.sessionManager,
    sessionMemoryStore: options.sessionMemoryStore,
    sessionLineageTracker: options.sessionLineageTracker,
    changeTracker: options.changeTracker,
  };
}

export function createBootstrapCommandProviderSection(
  options: Pick<
    BootstrapCommandSectionOptions,
    'providerRegistry' | 'providerOptimizer' | 'favoritesStore' | 'benchmarkStore'
  >,
): BootstrapCommandProviderSection {
  return {
    providerRegistry: options.providerRegistry,
    providerOptimizer: options.providerOptimizer,
    favoritesStore: options.favoritesStore,
    benchmarkStore: options.benchmarkStore,
  };
}

export function createBootstrapCommandWorkspaceSection(
  options: Pick<
    BootstrapCommandSectionOptions,
    'keybindingsManager' | 'fileUndoManager' | 'profileManager' | 'bookmarkManager'
    | 'processManager' | 'projectPlanningService' | 'projectPlanningProjectId' | 'workPlanStore'
  >,
  shellServices: BootstrapCommandShellServices,
): BootstrapCommandWorkspaceSection {
  return {
    keybindingsManager: options.keybindingsManager,
    fileUndoManager: options.fileUndoManager,
    processManager: options.processManager,
    profileManager: options.profileManager,
    bookmarkManager: options.bookmarkManager,
    projectPlanningService: options.projectPlanningService,
    projectPlanningProjectId: options.projectPlanningProjectId,
    workPlanStore: options.workPlanStore,
    ...shellServices.workspace,
  };
}

export function createBootstrapCommandPlatformSection(
  options: Pick<
    BootstrapCommandSectionOptions,
    'configManager' | 'voiceProviderRegistry' | 'voiceService' | 'voiceSetup' | 'memoryGovernor' | 'mediaProviderRegistry' | 'artifactStore' | 'channelDeliveryRouter'
  >,
  shellServices: BootstrapCommandShellServices,
): BootstrapCommandPlatformSection {
  return {
    config: getConfigSnapshot(options.configManager),
    configManager: options.configManager,
    voiceProviderRegistry: options.voiceProviderRegistry,
    voiceService: options.voiceService,
    voiceSetup: options.voiceSetup,
    memoryGovernor: options.memoryGovernor,
    mediaProviderRegistry: options.mediaProviderRegistry,
    artifactStore: options.artifactStore,
    channelDeliveryRouter: options.channelDeliveryRouter,
    ...shellServices.platform,
  };
}

export function createBootstrapCommandOpsSection(
  shellServices: BootstrapCommandShellServices,
  options: Pick<BootstrapCommandSectionOptions, 'executionLedger'> = {},
): BootstrapCommandOpsSection {
  return {
    ...shellServices.ops,
    executionLedger: options.executionLedger,
  };
}

export function createBootstrapCommandExtensionsSection(
  options: Pick<
    BootstrapCommandSectionOptions,
    'toolRegistry' | 'mcpRegistry'
  >,
  shellServices: BootstrapCommandShellServices,
): BootstrapCommandExtensionSection {
  const shellExtensionServices = shellServices.extensions;
  return {
    toolRegistry: options.toolRegistry,
    mcpRegistry: options.mcpRegistry,
    ...shellExtensionServices,
    agentKnowledgeService: shellExtensionServices.knowledgeService,
  };
}

export function createBootstrapCommandClientsSection(
  options: Pick<
    BootstrapCommandSectionOptions,
    'operatorClient' | 'peerClient' | 'providerApi' | 'agentKnowledgeApi' | 'promptContextReceipts' | 'hookApi' | 'mcpApi' | 'opsApi' | 'directTransport' | 'memoryConsolidationScheduler'
  >,
): BootstrapCommandClientSection {
  const memoryConsolidationScheduler = options.memoryConsolidationScheduler;
  return {
    operator: options.operatorClient,
    peer: options.peerClient,
    providerApi: options.providerApi,
    agentKnowledgeApi: options.agentKnowledgeApi,
    promptContextReceipts: options.promptContextReceipts,
    hookApi: options.hookApi,
    mcpApi: options.mcpApi,
    opsApi: options.opsApi,
    ...(memoryConsolidationScheduler
      ? { memoryConsolidation: { listPendingProposals: () => listPendingConsolidationProposals(memoryConsolidationScheduler) } }
      : {}),
    transport: options.directTransport,
  };
}
