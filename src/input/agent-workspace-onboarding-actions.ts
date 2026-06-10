import type { AgentWorkspaceActionResult } from './agent-workspace-types.ts';
import type { OnboardingShellPaths } from '../runtime/onboarding/types.ts';
import type { AgentWorkspaceRuntimeSnapshot } from './agent-workspace-types.ts';
import { writeOnboardingCheckMarker, writeOnboardingCompletionMarker } from '../runtime/onboarding/index.ts';
import { computeOnboardingStateFromSnapshot, deriveOnboardingEntry } from './agent-workspace-onboarding-state.ts';
import type { OnboardingState } from '../runtime/onboarding/onboarding-state.ts';

export interface CompleteOnboardingParams {
  readonly awaitingRecapDismiss: boolean;
  readonly runtimeSnapshot: AgentWorkspaceRuntimeSnapshot | null;
  readonly shellPaths: OnboardingShellPaths | undefined;
  readonly dismissAgentWorkspace: (() => boolean) | undefined;
  readonly close: () => void;
}

export interface CompleteOnboardingResult {
  /** True when the dismiss path was taken — caller should close immediately. */
  readonly dismissed: boolean;
  /** New value for _awaitingRecapDismiss (only meaningful when dismissed=false). */
  readonly awaitingRecapDismiss: boolean;
  readonly status: string;
  readonly lastActionResult: AgentWorkspaceActionResult;
}

/**
 * Pure logic for the completeOnboarding() class method.
 * Handles both the initial "write markers + show recap" path and the
 * deferred "dismiss recap" path.
 */
export function completeOnboardingAction(params: CompleteOnboardingParams): CompleteOnboardingResult {
  const { awaitingRecapDismiss, runtimeSnapshot, shellPaths, dismissAgentWorkspace, close } = params;

  // Second activation: dismiss the recap and close the workspace.
  if (awaitingRecapDismiss) {
    if (!dismissAgentWorkspace?.()) close();
    return {
      dismissed: true,
      awaitingRecapDismiss: false,
      status: '',
      lastActionResult: { kind: 'guidance', title: '', detail: '', safety: 'safe' },
    };
  }

  // Shell paths are required to write the completion markers.
  if (!shellPaths) {
    return {
      dismissed: false,
      awaitingRecapDismiss: false,
      status: 'Cannot complete onboarding without Agent shell paths.',
      lastActionResult: {
        kind: 'error',
        title: 'Onboarding completion unavailable',
        detail: 'The Agent workspace cannot locate the user onboarding completion marker path for this runtime.',
        safety: 'safe',
      },
    };
  }

  try {
    const marker = { scope: 'user', source: 'wizard', mode: 'new', workspaceRoot: shellPaths.workingDirectory } as const;
    writeOnboardingCheckMarker(shellPaths, marker);
    writeOnboardingCompletionMarker(shellPaths, marker);
    const obs = computeOnboardingStateFromSnapshot(runtimeSnapshot, shellPaths);
    const headline = obs?.recap.headline ?? 'Onboarding complete';
    const lines: readonly string[] = obs?.recap.lines ?? [];
    return {
      dismissed: false,
      awaitingRecapDismiss: true,
      status: headline,
      lastActionResult: {
        kind: 'recap',
        title: headline,
        detail: lines.join('\n') || 'Saved the user onboarding completion marker.',
        lines,
        safety: 'safe',
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      dismissed: false,
      awaitingRecapDismiss: false,
      status: 'Onboarding completion failed.',
      lastActionResult: { kind: 'error', title: 'Onboarding completion failed', detail, safety: 'safe' },
    };
  }
}

export interface OnSubscriptionLoginSuccessParams {
  readonly onlyGroup: string | null;
  readonly runtimeSnapshot: AgentWorkspaceRuntimeSnapshot | null;
  readonly shellPaths: OnboardingShellPaths | undefined;
  readonly categories: ReadonlyArray<{ readonly id: string }>;
}

export interface OnSubscriptionLoginSuccessResult {
  /** Updated onboarding state, or null when not in ONBOARDING mode. */
  readonly onboardingState: OnboardingState | null;
  /** Category index to navigate to (-1 = no change). */
  readonly selectedCategoryIndex: number;
  readonly status: string;
}

/**
 * Pure logic for the onSubscriptionLoginSuccess() class method.
 * Re-derives onboarding state and computes the next navigation target.
 */
export function onSubscriptionLoginSuccessAction(params: OnSubscriptionLoginSuccessParams): OnSubscriptionLoginSuccessResult {
  const { onlyGroup, runtimeSnapshot, shellPaths, categories } = params;

  if (onlyGroup !== 'ONBOARDING') {
    return { onboardingState: null, selectedCategoryIndex: -1, status: '' };
  }

  const obs = computeOnboardingStateFromSnapshot(runtimeSnapshot, shellPaths);
  if (!obs) {
    return { onboardingState: null, selectedCategoryIndex: -1, status: '' };
  }

  const entry = deriveOnboardingEntry(obs);
  const idx = entry.categoryId ? categories.findIndex((c) => c.id === entry.categoryId) : -1;
  const status = obs.readyToChat
    ? 'Signed in. You are ready to chat — Apply & close when ready.'
    : `Signed in. ${entry.status}`;

  return { onboardingState: obs, selectedCategoryIndex: idx, status };
}
