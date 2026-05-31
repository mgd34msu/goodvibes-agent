import type { InputToken } from '@pellux/goodvibes-sdk/platform/core';
import type { CommandContext } from './command-registry.ts';
import { AgentPersonaRegistry } from '../agent/persona-registry.ts';
import { AgentRoutineRegistry } from '../agent/routine-registry.ts';
import { AgentSkillRegistry } from '../agent/skill-registry.ts';

export const AGENT_WORKSPACE_MODAL_NAME = 'agentWorkspace';

export type AgentWorkspaceFocusPane = 'categories' | 'actions';

export type AgentWorkspaceActionKind = 'command' | 'guidance';

export interface AgentWorkspaceAction {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly command?: string;
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

type AgentWorkspaceConfigReader = {
  get(key: string): unknown;
};

export interface AgentWorkspaceRuntimeSnapshot {
  readonly provider: string;
  readonly model: string;
  readonly modelDisplayName: string;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly homeDirectory: string;
  readonly daemonBaseUrl: string;
  readonly daemonOwnership: 'external';
  readonly sessionMemoryCount: number;
  readonly localRoutineCount: number;
  readonly enabledRoutineCount: number;
  readonly localSkillCount: number;
  readonly enabledSkillCount: number;
  readonly localPersonaCount: number;
  readonly activePersonaName: string;
  readonly knowledgeRoute: '/api/goodvibes-agent/knowledge';
  readonly knowledgeIsolation: 'agent-only';
  readonly executionPolicy: 'serial-proactive';
  readonly wrfcPolicy: 'explicit-build-delegation-only';
  readonly warnings: readonly string[];
}

function readConfigString(context: CommandContext, key: string, fallback: string): string {
  try {
    const configManager = context.platform?.configManager as unknown as AgentWorkspaceConfigReader | undefined;
    const value = configManager?.get(key);
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
  } catch {
    return fallback;
  }
}

function readConfigNumber(context: CommandContext, key: string, fallback: number): number {
  try {
    const configManager = context.platform?.configManager as unknown as AgentWorkspaceConfigReader | undefined;
    const value = configManager?.get(key);
    const numberValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
  } catch {
    return fallback;
  }
}

export function buildAgentWorkspaceRuntimeSnapshot(context: CommandContext): AgentWorkspaceRuntimeSnapshot {
  const host = readConfigString(context, 'controlPlane.host', '127.0.0.1');
  const port = readConfigNumber(context, 'controlPlane.port', 3421);
  const model = context.session?.runtime?.model ?? 'unknown';
  const provider = context.session?.runtime?.provider ?? 'unknown';
  const currentModel = (() => {
    try {
      return context.provider?.providerRegistry?.getCurrentModel?.();
    } catch {
      return null;
    }
  })();
  const sessionMemoryCount = (() => {
    try {
      return context.session?.sessionMemoryStore?.list?.().length ?? 0;
    } catch {
      return 0;
    }
  })();
  const personaSnapshot = (() => {
    try {
      const shellPaths = context.workspace?.shellPaths;
      if (!shellPaths) return { count: 0, activeName: '(none)' };
      const snapshot = AgentPersonaRegistry.fromShellPaths(shellPaths).snapshot();
      return { count: snapshot.personas.length, activeName: snapshot.activePersona?.name ?? '(none)' };
    } catch {
      return { count: 0, activeName: '(unavailable)' };
    }
  })();
  const skillSnapshot = (() => {
    try {
      const shellPaths = context.workspace?.shellPaths;
      if (!shellPaths) return { count: 0, enabled: 0 };
      const snapshot = AgentSkillRegistry.fromShellPaths(shellPaths).snapshot();
      return { count: snapshot.skills.length, enabled: snapshot.enabledSkills.length };
    } catch {
      return { count: 0, enabled: 0 };
    }
  })();
  const routineSnapshot = (() => {
    try {
      const shellPaths = context.workspace?.shellPaths;
      if (!shellPaths) return { count: 0, enabled: 0 };
      const snapshot = AgentRoutineRegistry.fromShellPaths(shellPaths).snapshot();
      return { count: snapshot.routines.length, enabled: snapshot.enabledRoutines.length };
    } catch {
      return { count: 0, enabled: 0 };
    }
  })();
  const warnings: string[] = [];
  if (provider === 'unknown' || model === 'unknown') warnings.push('Provider/model unavailable in this runtime context.');
  if (!context.executeCommand) warnings.push('Command dispatch is unavailable; workspace actions will show guidance only.');

  return {
    provider,
    model,
    modelDisplayName: currentModel?.displayName ?? model,
    sessionId: context.session?.runtime?.sessionId ?? 'unknown',
    workingDirectory: context.workspace?.shellPaths?.workingDirectory ?? 'unavailable',
    homeDirectory: context.workspace?.shellPaths?.homeDirectory ?? 'unavailable',
    daemonBaseUrl: `http://${host}:${port}`,
    daemonOwnership: 'external',
    sessionMemoryCount,
    localRoutineCount: routineSnapshot.count,
    enabledRoutineCount: routineSnapshot.enabled,
    localSkillCount: skillSnapshot.count,
    enabledSkillCount: skillSnapshot.enabled,
    localPersonaCount: personaSnapshot.count,
    activePersonaName: personaSnapshot.activeName,
    knowledgeRoute: '/api/goodvibes-agent/knowledge',
    knowledgeIsolation: 'agent-only',
    executionPolicy: 'serial-proactive',
    wrfcPolicy: 'explicit-build-delegation-only',
    warnings,
  };
}

export const AGENT_WORKSPACE_CATEGORIES: readonly AgentWorkspaceCategory[] = [
  {
    id: 'home',
    group: 'OPERATE',
    label: 'Home',
    summary: 'Main operator surface for normal assistant work.',
    detail: 'Use this as the Agent front door: chat in the main conversation, inspect state, choose model/provider, and open setup surfaces without switching into coding-TUI behavior.',
    actions: [
      { id: 'chat', label: 'Continue assistant chat', detail: 'Close this workspace and type a normal message. Agent work stays serial in the main conversation.', kind: 'guidance', safety: 'safe' },
      { id: 'model', label: 'Choose model', detail: 'Open the model/provider workspace for the Agent chat route.', command: '/model', kind: 'command', safety: 'safe' },
      { id: 'help', label: 'Browse commands', detail: 'Open registry-driven command help.', command: '/help', kind: 'command', safety: 'safe' },
      { id: 'health', label: 'Review health', detail: 'Show the local health review surface without starting or mutating daemon services.', command: '/health review', kind: 'command', safety: 'read-only' },
    ],
  },
  {
    id: 'setup',
    group: 'SETUP',
    label: 'Setup',
    summary: 'Configuration, auth, provider, and onboarding surfaces.',
    detail: 'Agent connects to an external daemon and owns local assistant configuration only. Daemon lifecycle and listener posture remain external.',
    actions: [
      { id: 'config', label: 'Open config workspace', detail: 'Use the TUI-derived fullscreen settings workspace.', command: '/config', kind: 'command', safety: 'safe' },
      { id: 'onboarding', label: 'Open setup wizard', detail: 'Review Agent runtime settings in the fullscreen setup flow.', command: '/onboarding', kind: 'command', safety: 'safe' },
      { id: 'provider', label: 'Provider status', detail: 'Review provider/model posture.', command: '/provider', kind: 'command', safety: 'read-only' },
      { id: 'auth', label: 'Auth review', detail: 'Review authentication posture without printing token values.', command: '/auth review', kind: 'command', safety: 'read-only' },
    ],
  },
  {
    id: 'knowledge',
    group: 'KNOW',
    label: 'Knowledge',
    summary: 'Agent Knowledge/Wiki and source-backed lookup.',
    detail: 'Agent knowledge calls must use the isolated /api/goodvibes-agent/knowledge routes. Default regular wiki and HomeGraph are not the Agent knowledge environment.',
    actions: [
      { id: 'knowledge-status', label: 'Knowledge status', detail: 'Inspect Agent knowledge readiness and counts.', command: '/knowledge status', kind: 'command', safety: 'read-only' },
      { id: 'knowledge-open', label: 'Open knowledge surface', detail: 'Open the knowledge panel/surface when available.', command: '/knowledge', kind: 'command', safety: 'read-only' },
      { id: 'knowledge-ask', label: 'Ask Agent knowledge', detail: 'Close this workspace and run /knowledge ask <question> or ask normally in chat.', kind: 'guidance', safety: 'read-only' },
    ],
  },
  {
    id: 'memory',
    group: 'LEARN',
    label: 'Memory & Skills',
    summary: 'Local assistant memory, routines, skills, and reusable behavior.',
    detail: 'Memory, routines, skills, and personas stay Agent-local until stable shared daemon registry contracts exist. Secrets must not be stored as memory.',
    actions: [
      { id: 'memory', label: 'Open memory', detail: 'Inspect local/session memory commands and surfaces.', command: '/memory', kind: 'command', safety: 'read-only' },
      { id: 'routines', label: 'Routine library', detail: 'Create, review, enable, and start local Agent routines in the main conversation.', command: '/routines', kind: 'command', safety: 'safe' },
      { id: 'skills', label: 'Local skill library', detail: 'Create, review, and enable local Agent reusable procedures.', command: '/agent-skills', kind: 'command', safety: 'safe' },
      { id: 'personas', label: 'Persona library', detail: 'Use local Agent personas to shape serial assistant behavior without spawning background agents.', command: '/personas', kind: 'command', safety: 'safe' },
    ],
  },
  {
    id: 'work',
    group: 'TRACK',
    label: 'Work & Approvals',
    summary: 'Visible task state, work plan, and approval posture.',
    detail: 'Use these surfaces to inspect active operator state. Side-effecting approval decisions require explicit commands and confirmation outside this workspace.',
    actions: [
      { id: 'workplan', label: 'Open work plan', detail: 'Open the workspace-scoped work plan panel.', command: '/workplan panel', kind: 'command', safety: 'read-only' },
      { id: 'workplan-list', label: 'List work plan', detail: 'Print a concise work plan summary.', command: '/workplan list', kind: 'command', safety: 'read-only' },
      { id: 'approvals', label: 'Review approvals', detail: 'Open/read approval posture. This workspace does not approve or deny requests.', command: '/approval open', kind: 'command', safety: 'read-only' },
    ],
  },
  {
    id: 'automation',
    group: 'WATCH',
    label: 'Automation',
    summary: 'Read-only automation and schedule observability.',
    detail: 'Agent does not create, run, enable, disable, or remove local automation jobs. Schedule mutations wait for an Agent-safe public route and explicit approval.',
    actions: [
      { id: 'schedule-list', label: 'List schedules', detail: 'Inspect configured jobs and history without running or mutating them.', command: '/schedule list', kind: 'command', safety: 'read-only' },
      { id: 'schedule-policy', label: 'Mutation blocked', detail: 'Schedule add/run/remove/enable/disable are intentionally blocked in Agent.', kind: 'guidance', safety: 'blocked' },
      { id: 'health-services', label: 'Service health', detail: 'Inspect service readiness without starting, stopping, or restarting daemon services.', command: '/health services', kind: 'command', safety: 'read-only' },
    ],
  },
  {
    id: 'delegate',
    group: 'BUILD',
    label: 'Build Delegation',
    summary: 'Explicit handoff to GoodVibes TUI for code work.',
    detail: 'Agent does not become the coding TUI. Build, implement, fix, patch, and review work must be handed to GoodVibes TUI with the full original ask and WRFC only when explicitly requested.',
    actions: [
      { id: 'delegate-guidance', label: 'Delegation rule', detail: 'For build/fix/review work, delegate one request to GoodVibes TUI instead of spawning local Engineer/Reviewer/Tester roots.', kind: 'guidance', safety: 'delegates' },
      { id: 'review-command', label: 'Review delegation command', detail: 'Use /delegate --wrfc <task> only when the user explicitly asks for code review/build execution. Close this workspace and include the actual task text.', kind: 'guidance', safety: 'delegates' },
      { id: 'remote-policy', label: 'Remote runner policy', detail: 'Remote dispatch/rerun is blocked in Agent; TUI owns runner topology for delegated build work.', command: '/remote dispatch', kind: 'command', safety: 'blocked' },
    ],
  },
];

function parseCommand(command: string): { readonly name: string; readonly args: readonly string[] } {
  const trimmed = command.trim().replace(/^\//, '');
  if (!trimmed) return { name: '', args: [] };
  const parts = trimmed.split(/\s+/);
  return { name: parts[0] ?? '', args: parts.slice(1) };
}

export class AgentWorkspace {
  public active = false;
  public focusPane: AgentWorkspaceFocusPane = 'actions';
  public selectedCategoryIndex = 0;
  public selectedActionIndex = 0;
  public status = 'Ready. Choose an operator flow; ordinary assistant work stays in the main conversation.';
  public runtimeSnapshot: AgentWorkspaceRuntimeSnapshot | null = null;
  public lastActionResult: AgentWorkspaceActionResult | null = null;
  private context: CommandContext | null = null;
  private dispatchCommand: AgentWorkspaceCommandDispatcher | null = null;

  open(context: CommandContext, dispatchCommand: AgentWorkspaceCommandDispatcher): void {
    this.context = context;
    this.dispatchCommand = dispatchCommand;
    this.runtimeSnapshot = buildAgentWorkspaceRuntimeSnapshot(context);
    this.active = true;
    this.focusPane = 'actions';
    this.status = 'Ready. Choose an operator flow; ordinary assistant work stays in the main conversation.';
    this.lastActionResult = null;
    this.clampSelection();
  }

  reopen(): void {
    this.active = true;
    this.clampSelection();
  }

  close(): void {
    this.active = false;
  }

  get categories(): readonly AgentWorkspaceCategory[] {
    return AGENT_WORKSPACE_CATEGORIES;
  }

  get selectedCategory(): AgentWorkspaceCategory {
    return this.categories[this.selectedCategoryIndex] ?? this.categories[0]!;
  }

  get actions(): readonly AgentWorkspaceAction[] {
    return this.selectedCategory.actions;
  }

  get selectedAction(): AgentWorkspaceAction | null {
    return this.actions[this.selectedActionIndex] ?? null;
  }

  focusCategories(): void {
    this.focusPane = 'categories';
  }

  focusActions(): void {
    this.focusPane = 'actions';
  }

  toggleFocusPane(): void {
    this.focusPane = this.focusPane === 'categories' ? 'actions' : 'categories';
  }

  moveUp(): void {
    if (this.focusPane === 'categories') {
      this.selectedCategoryIndex = Math.max(0, this.selectedCategoryIndex - 1);
      this.selectedActionIndex = 0;
    } else {
      this.selectedActionIndex = Math.max(0, this.selectedActionIndex - 1);
    }
    this.clampSelection();
  }

  moveDown(): void {
    if (this.focusPane === 'categories') {
      this.selectedCategoryIndex = Math.min(this.categories.length - 1, this.selectedCategoryIndex + 1);
      this.selectedActionIndex = 0;
    } else {
      this.selectedActionIndex = Math.min(this.actions.length - 1, this.selectedActionIndex + 1);
    }
    this.clampSelection();
  }

  jumpHome(): void {
    if (this.focusPane === 'categories') this.selectedCategoryIndex = 0;
    else this.selectedActionIndex = 0;
    this.clampSelection();
  }

  jumpEnd(): void {
    if (this.focusPane === 'categories') this.selectedCategoryIndex = this.categories.length - 1;
    else this.selectedActionIndex = this.actions.length - 1;
    this.clampSelection();
  }

  refreshRuntimeSnapshot(): void {
    if (!this.context) {
      this.status = 'Runtime context is unavailable.';
      this.lastActionResult = {
        kind: 'error',
        title: 'Context refresh failed',
        detail: 'The Agent workspace has no command context to inspect.',
      };
      return;
    }
    this.runtimeSnapshot = buildAgentWorkspaceRuntimeSnapshot(this.context);
    this.status = 'Runtime context refreshed.';
    this.lastActionResult = {
      kind: 'refreshed',
      title: 'Runtime context refreshed',
      detail: 'Provider, model, session, local memory, daemon URL, and Agent knowledge route posture were re-read from the live command context.',
    };
  }

  activateSelected(): void {
    if (this.focusPane === 'categories') {
      this.focusActions();
      return;
    }
    const action = this.selectedAction;
    if (!action) return;
    if (action.kind === 'guidance' || !action.command) {
      this.status = action.detail;
      this.lastActionResult = {
        kind: 'guidance',
        title: action.label,
        detail: action.detail,
        safety: action.safety,
      };
      return;
    }
    if (action.safety === 'blocked') {
      this.status = `Blocked here: ${action.label}.`;
      this.lastActionResult = {
        kind: 'blocked',
        title: `${action.label} is blocked in Agent`,
        detail: action.detail,
        command: action.command,
        safety: action.safety,
      };
      return;
    }
    const parsed = parseCommand(action.command);
    if (!parsed.name) {
      this.status = `No command is configured for ${action.label}.`;
      this.lastActionResult = {
        kind: 'error',
        title: 'Command unavailable',
        detail: `No command is configured for ${action.label}.`,
        safety: action.safety,
      };
      return;
    }
    if (/<[^>\s]+(?:\s+[^>]*)?>/.test(action.command)) {
      this.status = `Placeholder command not dispatched: ${action.command}.`;
      this.lastActionResult = {
        kind: 'guidance',
        title: `${action.label} needs details`,
        detail: 'This action is a command template. Close the workspace and run it with real task text instead of placeholder values.',
        command: action.command,
        safety: action.safety,
      };
      return;
    }
    if (!this.context?.executeCommand || !this.dispatchCommand) {
      this.status = `Command dispatch is not available for ${action.command}.`;
      this.lastActionResult = {
        kind: 'error',
        title: 'Command dispatch unavailable',
        detail: `The command ${action.command} cannot be opened from this runtime.`,
        command: action.command,
        safety: action.safety,
      };
      return;
    }
    this.status = `Opening ${action.command}.`;
    this.lastActionResult = {
      kind: 'dispatched',
      title: `Opening ${action.label}`,
      detail: 'The workspace handed this safe or read-only command to the shell-owned command router.',
      command: action.command,
      safety: action.safety,
    };
    this.dispatchCommand(action.command);
  }

  private clampSelection(): void {
    this.selectedCategoryIndex = Math.max(0, Math.min(this.selectedCategoryIndex, this.categories.length - 1));
    this.selectedActionIndex = Math.max(0, Math.min(this.selectedActionIndex, this.actions.length - 1));
  }
}

export function handleAgentWorkspaceToken(
  workspace: AgentWorkspace,
  token: InputToken,
  handleEscape: () => void,
  requestRender: () => void,
): boolean {
  if (!workspace.active) return false;

  if (token.type === 'key') {
    if (token.logicalName === 'escape') {
      handleEscape();
      return true;
    }
    if (token.logicalName === 'enter' || token.logicalName === 'space') workspace.activateSelected();
    else if (token.logicalName === 'left') workspace.focusCategories();
    else if (token.logicalName === 'right') workspace.focusActions();
    else if (token.logicalName === 'up') workspace.moveUp();
    else if (token.logicalName === 'down') workspace.moveDown();
    else if (token.logicalName === 'tab') workspace.toggleFocusPane();
    else if (token.logicalName === 'home') workspace.jumpHome();
    else if (token.logicalName === 'end') workspace.jumpEnd();
  } else if (token.type === 'text') {
    if (token.value === 'h') workspace.focusCategories();
    else if (token.value === 'l') workspace.focusActions();
    else if (token.value === 'j') workspace.moveDown();
    else if (token.value === 'k') workspace.moveUp();
    else if (token.value === 'r' || token.value === 'R') workspace.refreshRuntimeSnapshot();
    else if (token.value === ' ') workspace.activateSelected();
  }

  requestRender();
  return true;
}
