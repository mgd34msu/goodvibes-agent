import type { AgentWorkspaceChannelStatus } from './agent-workspace-channels.ts';
import type { AgentWorkspaceSetupChecklistItem } from './agent-workspace-setup.ts';
import type { AgentWorkspaceVoiceMediaReadiness } from './agent-workspace-voice-media.ts';

export const AGENT_WORKSPACE_MODAL_NAME = 'agentWorkspace';

export type AgentWorkspaceFocusPane = 'categories' | 'actions';

export type AgentWorkspaceActionKind = 'command' | 'guidance' | 'workspace' | 'editor' | 'local-selection' | 'local-operation';

export type AgentWorkspaceLocalEditorKind = 'memory' | 'persona' | 'skill' | 'routine' | 'profile';

export type AgentWorkspaceEditorKind =
  | AgentWorkspaceLocalEditorKind
  | 'knowledge-url'
  | 'knowledge-file'
  | 'knowledge-bookmarks'
  | 'knowledge-browser-history'
  | 'knowledge-connector-ingest'
  | 'knowledge-search'
  | 'knowledge-ask'
  | 'mcp-server'
  | 'notify-webhook'
  | 'tts-prompt'
  | 'image-input'
  | 'skill-bundle'
  | 'skill-discovery-import'
  | 'profile-template-export'
  | 'profile-template-import'
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
  readonly browserSurfaceEnabled: boolean;
  readonly browserSurfacePublicBaseUrl: string;
  readonly activeRuntimeProfile: string;
  readonly runtimeProfileCount: number;
  readonly runtimeProfiles: readonly AgentWorkspaceRuntimeProfileItem[];
  readonly runtimeProfileRoot: string;
  readonly runtimeStarterTemplateCount: number;
  readonly localStarterTemplateCount: number;
  readonly runtimeStarterTemplates: readonly AgentWorkspaceRuntimeStarterTemplateItem[];
  readonly configProfileCount: number;
  readonly setupChecklist: readonly AgentWorkspaceSetupChecklistItem[];
  readonly warnings: readonly string[];
}
