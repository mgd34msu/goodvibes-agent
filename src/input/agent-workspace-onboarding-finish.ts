import type { AgentWorkspaceAction, AgentWorkspaceCategory } from './agent-workspace-types.ts';

export const ONBOARDING_CRITICAL_STEP_IDS = ['runtime', 'connected-host-auth', 'provider-model'] as const;

export const ONBOARDING_COMPLETE_SYNTHETIC_ACTION: AgentWorkspaceAction = {
  id: 'onboarding-apply-close',
  label: 'Apply & close',
  detail: 'Acknowledge onboarding as finished, persist the user completion marker, and close the fullscreen Agent workspace.',
  kind: 'onboarding-complete',
  safety: 'safe',
};

export function shouldShowOnboardingFinishFooter(
  category: AgentWorkspaceCategory,
  baseActions: readonly AgentWorkspaceAction[],
): boolean {
  return (
    category.group === 'ONBOARDING'
    && baseActions.every((a) => a.kind !== 'onboarding-complete')
  );
}
