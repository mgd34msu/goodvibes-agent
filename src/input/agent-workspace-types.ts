import type { AgentWorkspaceChannelStatus } from './agent-workspace-channels.ts';
import type { AgentWorkspaceSetupChecklistItem } from './agent-workspace-setup.ts';
import type { AgentWorkspaceVoiceMediaReadiness } from './agent-workspace-voice-media.ts';
import type { AgentBehaviorDiscoverySnapshot } from '../agent/behavior-discovery-summary.ts';

export const AGENT_WORKSPACE_MODAL_NAME = 'agentWorkspace';

export type AgentWorkspaceFocusPane = 'categories' | 'actions';

export type AgentWorkspaceActionKind = 'command' | 'guidance' | 'workspace' | 'editor' | 'local-selection' | 'local-operation';

export type AgentWorkspaceLocalEditorKind = 'memory' | 'persona' | 'skill' | 'routine' | 'profile';

export type AgentWorkspaceEditorKind =
  | AgentWorkspaceLocalEditorKind
  | 'knowledge-url'
  | 'knowledge-urls'
  | 'knowledge-file'
  | 'knowledge-bookmarks'
  | 'knowledge-browser-history'
  | 'knowledge-connector-ingest'
  | 'knowledge-reindex'
  | 'knowledge-search'
  | 'knowledge-ask'
  | 'knowledge-get'
  | 'knowledge-review-issue'
  | 'knowledge-consolidate'
  | 'knowledge-packet'
  | 'knowledge-explain'
  | 'memory-search'
  | 'memory-get'
  | 'memory-explain'
  | 'memory-promote'
  | 'memory-link'
  | 'memory-export'
  | 'memory-import'
  | 'memory-handoff-export'
  | 'memory-handoff-inspect'
  | 'memory-handoff-import'
  | 'memory-vector-rebuild'
  | 'persona-search'
  | 'persona-show'
  | 'skill-search'
  | 'skill-show'
  | 'routine-search'
  | 'routine-show'
  | 'plan-seed'
  | 'mcp-server'
  | 'mcp-tools-server'
  | 'mcp-repair'
  | 'notify-webhook'
  | 'notify-webhook-remove'
  | 'notify-webhook-clear'
  | 'notify-webhook-test'
  | 'secret-set'
  | 'secret-link'
  | 'secret-test'
  | 'secret-delete'
  | 'tts-prompt'
  | 'image-input'
  | 'skill-bundle'
  | 'skill-bundle-search'
  | 'skill-bundle-show'
  | 'skill-bundle-update'
  | 'skill-bundle-enable'
  | 'skill-bundle-disable'
  | 'skill-bundle-review'
  | 'skill-bundle-stale'
  | 'skill-bundle-delete'
  | 'persona-discovery-import'
  | 'routine-discovery-import'
  | 'skill-discovery-import'
  | 'learned-behavior'
  | 'profile-template-export'
  | 'profile-template-import'
  | 'profile-template-show'
  | 'profile-template-from-discovered'
  | 'profile-from-discovered'
  | 'profile-default'
  | 'profile-default-clear'
  | 'profile-delete'
  | 'provider-add'
  | 'provider-remove'
  | 'provider-use'
  | 'provider-inspect'
  | 'provider-routes'
  | 'provider-account-repair'
  | 'auth-show'
  | 'auth-repair'
  | 'auth-bundle-export'
  | 'auth-bundle-inspect'
  | 'trust-bundle-export'
  | 'trust-bundle-inspect'
  | 'support-bundle-export'
  | 'support-bundle-inspect'
  | 'support-bundle-import'
  | 'subscription-inspect'
  | 'subscription-login-start'
  | 'subscription-login-finish'
  | 'subscription-logout'
  | 'subscription-bundle-export'
  | 'subscription-bundle-inspect'
  | 'voice-enable'
  | 'voice-disable'
  | 'voice-bundle-export'
  | 'voice-bundle-inspect'
  | 'conversation-export'
  | 'channel-show'
  | 'channel-doctor'
  | 'channel-setup'
  | 'session-save'
  | 'session-load'
  | 'session-rename'
  | 'session-resume'
  | 'session-info'
  | 'session-export-saved'
  | 'session-search'
  | 'session-delete'
  | 'task-list-filter'
  | 'task-show'
  | 'task-output'
  | 'plan-show'
  | 'plan-approve'
  | 'plan-override'
  | 'plan-clear'
  | 'health-repair'
  | 'approval-review'
  | 'routine-receipt'
  | 'schedule-receipt'
  | 'mode-preset'
  | 'mode-domain'
  | 'model-pin'
  | 'model-unpin'
  | 'delegate-task'
  | 'workplan-add'
  | 'workplan-show'
  | 'workplan-status'
  | 'workplan-delete'
  | 'workplan-clear-completed'
  | 'routine-schedule'
  | 'reminder-schedule';

export type AgentWorkspaceLocalOperation =
  | 'memory-edit'
  | 'memory-review'
  | 'memory-stale'
  | 'memory-delete'
  | 'persona-edit'
  | 'persona-use'
  | 'persona-review'
  | 'persona-clear'
  | 'persona-delete'
  | 'skill-edit'
  | 'skill-enable'
  | 'skill-disable'
  | 'skill-review'
  | 'skill-delete'
  | 'routine-edit'
  | 'routine-start'
  | 'routine-enable'
  | 'routine-disable'
  | 'routine-review'
  | 'routine-delete';

export interface AgentWorkspaceEditorField {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly required: boolean;
  readonly multiline: boolean;
  readonly hint: string;
  readonly redact?: boolean;
}

export interface AgentWorkspaceLocalEditor {
  readonly kind: AgentWorkspaceEditorKind;
  readonly mode: 'create' | 'update' | 'delete';
  readonly recordId?: string;
  readonly title: string;
  readonly fields: readonly AgentWorkspaceEditorField[];
  readonly selectedFieldIndex: number;
  readonly message: string;
}

export interface AgentWorkspaceAction {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly command?: string;
  readonly targetCategoryId?: string;
  readonly editorKind?: AgentWorkspaceEditorKind;
  readonly localKind?: AgentWorkspaceLocalEditorKind;
  readonly selectionDelta?: number;
  readonly localOperation?: AgentWorkspaceLocalOperation;
  readonly kind: AgentWorkspaceActionKind;
  readonly safety: 'safe' | 'read-only' | 'delegates' | 'blocked';
}

export interface AgentWorkspaceCategory {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  readonly summary: string;
  readonly detail: string;
  readonly actions: readonly AgentWorkspaceAction[];
}

export type AgentWorkspaceCommandDispatcher = (command: string) => void;

export type AgentWorkspaceActionResultKind = 'guidance' | 'blocked' | 'dispatched' | 'refreshed' | 'error';

export interface AgentWorkspaceActionResult {
  readonly kind: AgentWorkspaceActionResultKind;
  readonly title: string;
  readonly detail: string;
  readonly command?: string;
  readonly safety?: AgentWorkspaceAction['safety'];
}

export interface AgentWorkspaceLocalLibraryItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly reviewState: string;
  readonly source: string;
  readonly tags: readonly string[];
  readonly triggers: readonly string[];
  readonly scope?: string;
  readonly cls?: string;
  readonly confidence?: number;
  readonly active?: boolean;
  readonly enabled?: boolean;
  readonly requirementCount?: number;
  readonly missingRequirementCount?: number;
  readonly missingRequirements?: readonly string[];
  readonly startCount?: number;
}

export interface AgentWorkspaceRuntimeProfileItem {
  readonly id: string;
  readonly homeDirectory: string;
  readonly createdAt: string | null;
  readonly starterTemplateId?: string;
  readonly starterTemplateName?: string;
}

export interface AgentWorkspaceRuntimeStarterTemplateItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly personaName: string;
  readonly skillNames: readonly string[];
  readonly routineNames: readonly string[];
  readonly source: string;
}

export interface AgentWorkspaceRuntimeSnapshot {
  readonly provider: string;
  readonly model: string;
  readonly modelDisplayName: string;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly homeDirectory: string;
  readonly runtimeBaseUrl: string;
  readonly runtimeOwnership: 'external';
  readonly sessionMemoryCount: number;
  readonly localMemoryCount: number;
  readonly localMemoryReviewQueueCount: number;
  readonly localMemoryPromptActiveCount: number;
  readonly localMemories: readonly AgentWorkspaceLocalLibraryItem[];
  readonly localRoutineCount: number;
  readonly enabledRoutineCount: number;
  readonly localRoutines: readonly AgentWorkspaceLocalLibraryItem[];
  readonly localSkillCount: number;
  readonly enabledSkillCount: number;
  readonly localSkillBundleCount: number;
  readonly enabledSkillBundleCount: number;
  readonly activeSkillCount: number;
  readonly localSkillBundles: readonly AgentWorkspaceLocalLibraryItem[];
  readonly localSkills: readonly AgentWorkspaceLocalLibraryItem[];
  readonly localPersonaCount: number;
  readonly activePersonaName: string;
  readonly localPersonas: readonly AgentWorkspaceLocalLibraryItem[];
  readonly discoveredBehavior: AgentBehaviorDiscoverySnapshot;
  readonly knowledgeRoute: '/api/goodvibes-agent/knowledge';
  readonly knowledgeIsolation: 'agent-only';
  readonly executionPolicy: 'serial-proactive';
  readonly wrfcPolicy: 'explicit-build-delegation-only';
  readonly channels: readonly AgentWorkspaceChannelStatus[];
  readonly voiceProviderCount: number;
  readonly voiceStreamingProviderCount: number;
  readonly voiceSttProviderCount: number;
  readonly voiceRealtimeProviderCount: number;
  readonly ttsProvider: string;
  readonly ttsVoice: string;
  readonly ttsResponseModel: string;
  readonly voiceSurfaceEnabled: boolean;
  readonly mediaProviderCount: number;
  readonly mediaUnderstandingProviderCount: number;
  readonly mediaGenerationProviderCount: number;
  readonly voiceMediaReadiness: AgentWorkspaceVoiceMediaReadiness;
  readonly mcpServerCount: number;
  readonly mcpConnectedServerCount: number;
  readonly mcpQuarantinedServerCount: number;
  readonly mcpAllowAllServerCount: number;
  readonly browserToolExposureEnabled: boolean;
  readonly browserToolPublicBaseUrl: string;
  readonly activeRuntimeProfile: string;
  readonly selectedRuntimeProfile: string | null;
  readonly selectedRuntimeProfileExists: boolean;
  readonly selectedRuntimeProfileSelectedAt: string | null;
  readonly runtimeProfileCount: number;
  readonly runtimeProfiles: readonly AgentWorkspaceRuntimeProfileItem[];
  readonly runtimeProfileRoot: string;
  readonly runtimeStarterTemplateCount: number;
  readonly localStarterTemplateCount: number;
  readonly runtimeStarterTemplates: readonly AgentWorkspaceRuntimeStarterTemplateItem[];
  readonly setupChecklist: readonly AgentWorkspaceSetupChecklistItem[];
  readonly warnings: readonly string[];
}
