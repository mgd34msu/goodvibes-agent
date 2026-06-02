import { beginOpenAICodexLogin, exchangeOpenAICodexCode } from '@pellux/goodvibes-sdk/platform/config';
import { openExternalUrl } from '@pellux/goodvibes-sdk/platform/utils';
import { getProviderIdFromModel } from '../config/provider-model.ts';
import { buildProviderAccountSnapshot } from '@/runtime/index.ts';
import { OnboardingWizardController, type OnboardingWizardAction, type OnboardingWizardApplyFeedback } from './onboarding/onboarding-wizard.ts';
import { applyOnboardingRequest, collectOnboardingSnapshot, verifyOnboardingRequest, writeOnboardingCheckMarker } from '../runtime/onboarding/index.ts';
import type { OnboardingApplyRequest, OnboardingVerificationItem } from '../runtime/onboarding/index.ts';
import type { ModelPickerTarget } from './model-picker.ts';
import { captureOnboardingWizardSnapshot, restoreOnboardingWizardSnapshot } from './handler-ui-state.ts';
import type { InputHandler } from './handler.ts';

export interface OnboardingRuntimePosture {
  readonly externalServiceManaged: true;
  readonly mutationAllowed: false;
}

function extractAuthorizationCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.searchParams.get('code');
  } catch {
    return trimmed;
  }
}

function onboardingVerificationStatusRank(item: OnboardingVerificationItem): number {
  if (item.status === 'fail') return 3;
  if (item.status === 'warn') return 2;
  return 1;
}

function dedupeOnboardingVerificationItems(
  items: readonly OnboardingVerificationItem[],
): OnboardingVerificationItem[] {
  const order: string[] = [];
  const byId = new Map<string, OnboardingVerificationItem>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing) {
      order.push(item.id);
      byId.set(item.id, item);
      continue;
    }
    if (onboardingVerificationStatusRank(item) > onboardingVerificationStatusRank(existing)) {
      byId.set(item.id, item);
    }
  }
  return order.map((id) => byId.get(id)).filter((item): item is OnboardingVerificationItem => Boolean(item));
}

function formatOnboardingApplyCompletionMessage(items: readonly OnboardingVerificationItem[]): string {
  const warnings = items.filter((item) => item.status === 'warn');
  if (warnings.length === 0) return `Onboarding applied and verified ${items.length} item(s).`;
  const passed = items.filter((item) => item.status === 'pass').length;
  return [
    `Onboarding settings applied. ${passed} verification item(s) passed; ${warnings.length} warning(s) need attention.`,
    ...warnings.map((warning) => `  warning ${warning.id}: ${warning.message}`),
  ].join('\n');
}

function showOnboardingApplyFeedbackForHandler(handler: InputHandler, feedback: OnboardingWizardApplyFeedback): void {
    handler.onboardingWizard.setApplyFeedback(feedback);
    const reviewIndex = handler.onboardingWizard.steps.findIndex((step) => step.id === 'review');
    if (reviewIndex >= 0) handler.onboardingWizard.setStep(reviewIndex);
    handler.requestRender();
  }

function continueOnboardingSection(handler: InputHandler): void {
    handler.onboardingWizard.commitEdit();
    handler.onboardingWizard.clearApplyFeedback();
    handler.onboardingWizard.nextStep();
    handler.requestRender();
  }

export function clearOnboardingPendingModelPickerTargetForHandler(handler: InputHandler): void {
    handler.onboardingWizard.clearPendingModelPickerTarget();
  }

export function clearOnboardingModelPickerCancelStateForHandler(handler: InputHandler): void {
    handler.onboardingModelPickerCancelSnapshot = null;
  }

export function restoreOnboardingModelPickerCancelStateForHandler(handler: InputHandler): void {
    if (!handler.onboardingModelPickerCancelSnapshot) return;
    restoreOnboardingWizardSnapshot(handler.onboardingWizard, handler.onboardingModelPickerCancelSnapshot, {
      active: true,
    });
    handler.onboardingModelPickerCancelSnapshot = null;
  }

export function openModelPickerWithTargetForHandler(
  handler: InputHandler,
    target: ModelPickerTarget,
    source: 'settings' | 'onboarding' = 'settings',
  ): boolean {
    const openModelPicker = handler.commandContext?.openModelPicker;
    if (!openModelPicker) return false;
    if (source === 'onboarding' && handler.onboardingWizard.active) {
      handler.onboardingModelPickerCancelSnapshot = captureOnboardingWizardSnapshot(handler.onboardingWizard);
    } else {
      handler.clearOnboardingModelPickerCancelState();
    }
    handler.clearOnboardingPendingModelPickerTarget();
    handler.modelPicker.target = target;
    openModelPicker();
    return true;
  }

export function openProviderModelPickerWithTargetForHandler(
  handler: InputHandler,
    target: ModelPickerTarget,
    source: 'settings' | 'onboarding' = 'settings',
  ): boolean {
    const openProviderPicker = handler.commandContext?.openProviderPicker;
    if (!openProviderPicker) return false;
    if (source === 'onboarding' && handler.onboardingWizard.active) {
      handler.onboardingModelPickerCancelSnapshot = captureOnboardingWizardSnapshot(handler.onboardingWizard);
    } else {
      handler.clearOnboardingModelPickerCancelState();
    }
    handler.clearOnboardingPendingModelPickerTarget();
    handler.modelPicker.target = target;
    openProviderPicker();
    return true;
  }

export function handleModelPickerCommitForHandler(handler: InputHandler): boolean {
    if (handler.onboardingModelPickerCancelSnapshot && handler.onboardingWizard.active) {
      const selected = handler.modelPicker.mode === 'effort'
        ? handler.modelPicker.pendingModel
        : handler.modelPicker.mode === 'contextCap'
          ? handler.modelPicker.contextCapPendingModel
          : handler.modelPicker.getSelected();
      if (selected) {
        handler.onboardingWizard.applyModelSelection(handler.modelPicker.target, {
          providerId: selected.provider,
          modelId: selected.registryKey ?? selected.id,
          enabled: true,
        });
        if (handler.modelPicker.target === 'main' && handler.modelPicker.mode === 'effort') {
          const effort = handler.modelPicker.effortLevels[handler.modelPicker.selectedIndex];
          if (effort) handler.onboardingWizard.setFieldValue('default-model.reasoning', effort);
        }
      }
      handler.clearOnboardingPendingModelPickerTarget();
      handler.clearOnboardingModelPickerCancelState();
      return true;
    }
    handler.clearOnboardingPendingModelPickerTarget();
    handler.clearOnboardingModelPickerCancelState();
    return false;
  }

export async function handleOnboardingActionForHandler(handler: InputHandler, action: OnboardingWizardAction): Promise<void> {
    if (action.startsWith('open-agent-workspace:')) {
      const categoryId = action.slice('open-agent-workspace:'.length);
      if (handler.commandContext) handler.openAgentWorkspace(handler.commandContext, categoryId);
      else handler.onboardingWizard.setApplyFeedback({
        severity: 'warning',
        title: 'Workspace unavailable',
        summary: 'The Agent workspace cannot open because the command context is not wired yet.',
        messages: [`Requested workspace: ${categoryId}`],
      });
      return;
    }
    if (action === 'start-openai-subscription') {
      await handler.handleOpenAiSubscriptionStart();
      return;
    }
    if (action === 'finish-openai-subscription') {
      await handler.handleOpenAiSubscriptionFinish();
      return;
    }
    if (action === 'apply-and-continue') {
      if (handler.onboardingApplyPending) return;
      continueOnboardingSection(handler);
      return;
    }
    if (action !== 'apply') return;
    if (handler.onboardingApplyPending) return;
    const blockers = handler.onboardingWizard.getBlockingFieldLabels();
    if (blockers.length > 0) {
      showOnboardingApplyFeedbackForHandler(handler, {
        severity: 'error',
        title: 'Cannot apply yet',
        summary: 'Fix these required or invalid fields, then apply again.',
        messages: blockers,
      });
      return;
    }

    const request = handler.onboardingWizard.buildApplyRequest();
    handler.onboardingWizard.clearApplyFeedback();
    const deps = {
      config: handler.uiServices.platform.configManager,
      secrets: handler.uiServices.platform.secretsManager,
      auth: handler.uiServices.platform.localUserAuthManager,
      shellPaths: handler.uiServices.environment.shellPaths,
      acknowledgementScope: 'project' as const,
    };
    let appliedErrors: string[] = [];
    let verificationItems: readonly OnboardingVerificationItem[] = [];
    let runtimeWarnings: readonly OnboardingVerificationItem[] = [];
    handler.onboardingApplyPending = true;
    try {
      const applied = await applyOnboardingRequest(deps, request);
      if (applied.errors.length > 0) {
        appliedErrors = applied.errors.map((error) => `apply ${error.kind}: ${error.message}`);
      } else {
        const verification = await verifyOnboardingRequest(deps, request);
        verificationItems = verification.items;
        appliedErrors = verification.items
          .filter((item) => item.status === 'fail')
          .map((item) => `verify ${item.id}: ${item.message}`);
      }

      if (appliedErrors.length === 0) {
        const activationVerification = await handler.restartOnboardingExternalServicesIfNeeded(request);
        runtimeWarnings = dedupeOnboardingVerificationItems([...activationVerification, ...handler.verifyOnboardingRuntimePosture(request)]
          .map((item): OnboardingVerificationItem => item.status === 'fail'
            ? { ...item, status: 'warn' }
            : item));
        verificationItems = dedupeOnboardingVerificationItems([...verificationItems, ...runtimeWarnings]);
      }
    } catch (error) {
      showOnboardingApplyFeedbackForHandler(handler, {
        severity: 'error',
        title: 'Apply failed',
        summary: 'The wizard could not persist these settings. No connected-host restart was attempted.',
        messages: [error instanceof Error ? error.message : String(error)],
      });
      return;
    } finally {
      handler.onboardingApplyPending = false;
      handler.requestRender();
    }

    if (appliedErrors.length > 0) {
      showOnboardingApplyFeedbackForHandler(handler, {
        severity: 'error',
        title: 'Apply did not complete',
        summary: 'The settings were not fully applied. Review the messages below and try again.',
        messages: appliedErrors,
      });
      return;
    }

    handler.syncRuntimeFromOnboardingRequest(request);
    handler.onboardingWizard.markApplied();
    let markerWarning: string | null = null;
    try {
      writeOnboardingCheckMarker(handler.uiServices.environment.shellPaths, {
        scope: 'user',
        source: 'wizard',
        mode: request.mode,
      });
    } catch (error) {
      markerWarning = error instanceof Error ? error.message : String(error);
    }
    handler.onboardingWizard.close();
    for (let index = handler.modalStack.length - 1; index >= 0; index -= 1) {
      if (handler.modalStack[index] === 'onboarding') handler.modalStack.splice(index, 1);
    }
    if (handler.modalStack.length === 0) {
      const returnFocus = handler.modalReturnFocus;
      handler.panelFocused = returnFocus === 'panel';
      handler.indicatorFocused = returnFocus === 'indicator';
      handler.modalReturnFocus = 'prompt';
    }
    const completionMessage = formatOnboardingApplyCompletionMessage(verificationItems);
    handler.commandContext?.print?.(markerWarning
      ? `${completionMessage}\nSetup check marker could not be written: ${markerWarning}`
      : completionMessage);
    if (handler.commandContext) {
      handler.openAgentWorkspace(handler.commandContext, 'setup');
      return;
    }
    handler.requestRender();
  }

export async function refreshOnboardingHydrationForHandler(handler: InputHandler, options: {
    readonly preserveValues?: boolean;
    readonly targetStepId?: string;
  } = {}): Promise<void> {
    const hydrationSerial = ++handler.onboardingHydrationSerial;
    handler.onboardingWizard.beginRuntimeHydration();
    handler.requestRender();
    try {
      const snapshot = await collectOnboardingSnapshot({
        config: handler.uiServices.platform.configManager,
        shellPaths: handler.uiServices.environment.shellPaths,
        acknowledgementScope: 'project',
        subscriptions: handler.uiServices.platform.subscriptionManager,
        secrets: handler.uiServices.platform.secretsManager,
        auth: handler.uiServices.platform.localUserAuthManager,
        services: handler.uiServices.platform.serviceRegistry,
        surfaces: {
          list: () => handler.uiServices.platform.surfaceRegistry.syncConfiguredSurfaces(),
        },
        providerAccounts: {
          loadSnapshot: () => buildProviderAccountSnapshot({
            providerRegistry: handler.uiServices.providers.providerRegistry,
            serviceRegistry: handler.uiServices.platform.serviceRegistry,
            subscriptionManager: handler.uiServices.platform.subscriptionManager,
            secretsManager: handler.uiServices.platform.secretsManager,
          }),
        },
      });
      if (!handler.onboardingWizard.active || hydrationSerial !== handler.onboardingHydrationSerial) return;
      handler.onboardingWizard.hydrateRuntimeState({ snapshot }, { resetValues: !(options.preserveValues ?? false) });
      if (options.targetStepId) {
        const targetIndex = handler.onboardingWizard.steps.findIndex((step) => step.id === options.targetStepId);
        if (targetIndex >= 0) handler.onboardingWizard.setStep(targetIndex);
      }
      handler.requestRender();
    } catch (error) {
      if (!handler.onboardingWizard.active || hydrationSerial !== handler.onboardingHydrationSerial) return;
      const message = error instanceof Error ? error.message : String(error);
      handler.onboardingWizard.failRuntimeHydration(message);
      handler.requestRender();
    }
  }

export async function handleOpenAiSubscriptionStartForHandler(handler: InputHandler): Promise<void> {
    if (handler.onboardingApplyPending) return;
    handler.onboardingApplyPending = true;
    try {
      const started = await beginOpenAICodexLogin();
      handler.uiServices.platform.subscriptionManager.savePending({
        provider: 'openai',
        state: started.state,
        verifier: started.verifier,
        redirectUri: started.redirectUri,
        createdAt: Date.now(),
      });
      const browserOpened = await openExternalUrl(started.authorizationUrl);
      await handler.refreshOnboardingHydration({ preserveValues: true, targetStepId: 'provider-access' });
      handler.onboardingWizard.setFieldValue('providers.openai-authorization-url', started.authorizationUrl);
      const providerIndex = handler.onboardingWizard.steps.findIndex((step) => step.id === 'provider-access');
      if (providerIndex >= 0) handler.onboardingWizard.setStep(providerIndex);
      handler.requestRender();

      handler.commandContext?.print?.([
        'OpenAI subscription sign-in started from onboarding.',
        `  browser: ${browserOpened ? 'opened' : 'open failed'}`,
        '  completion: paste callback code or URL into the OpenAI callback field',
        '  authorizationUrl: shown in the wizard provider step',
      ].join('\n'));
      handler.requestRender();
    } catch (error) {
      handler.commandContext?.print?.([
        'OpenAI subscription sign-in could not start.',
        `  ${error instanceof Error ? error.message : String(error)}`,
      ].join('\n'));
      handler.requestRender();
    } finally {
      handler.onboardingApplyPending = false;
    }
  }

export async function handleOpenAiSubscriptionFinishForHandler(handler: InputHandler): Promise<void> {
    if (handler.onboardingApplyPending) return;
    const code = extractAuthorizationCode(handler.onboardingWizard.getTextFieldValue('providers.openai-callback-code'));
    if (!code) {
      handler.commandContext?.print?.('OpenAI subscription sign-in needs a callback code or URL.');
      handler.requestRender();
      return;
    }

    handler.onboardingApplyPending = true;
    try {
      const pending = handler.uiServices.platform.subscriptionManager.getPending('openai');
      if (!pending) {
        handler.commandContext?.print?.('No pending OpenAI subscription sign-in exists in onboarding.');
        handler.requestRender();
        return;
      }

      const token = await exchangeOpenAICodexCode(code, pending.verifier);
      const now = Date.now();
      const existing = handler.uiServices.platform.subscriptionManager.get('openai');
      handler.uiServices.platform.subscriptionManager.saveSubscription({
        provider: 'openai',
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        tokenType: token.tokenType,
        expiresAt: token.expiresAt,
        ...(token.scopes ? { scopes: token.scopes } : {}),
        authMode: 'oauth',
        overrideAmbientApiKeys: false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      handler.uiServices.platform.subscriptionManager.clearPending('openai');
      handler.commandContext?.print?.([
        'OpenAI subscription sign-in completed from onboarding.',
        `  tokenType: ${token.tokenType}`,
        `  expiresAt: ${token.expiresAt ? new Date(token.expiresAt).toISOString() : 'n/a'}`,
      ].join('\n'));
      await handler.refreshOnboardingHydration({ preserveValues: true, targetStepId: 'provider-access' });
    } catch (error) {
      handler.commandContext?.print?.([
        'OpenAI subscription sign-in could not finish.',
        `  ${error instanceof Error ? error.message : String(error)}`,
      ].join('\n'));
      handler.requestRender();
    } finally {
      handler.onboardingApplyPending = false;
    }
  }

export function syncRuntimeFromOnboardingRequestForHandler(handler: InputHandler, request: ReturnType<OnboardingWizardController['buildApplyRequest']>): void {
    const runtime = handler.commandContext?.session?.runtime;
    if (!runtime) return;

    for (const operation of request.operations) {
      if (operation.kind !== 'set-config') continue;
      if (operation.key === 'provider.model' && typeof operation.value === 'string') {
        runtime.model = operation.value;
        runtime.provider = getProviderIdFromModel(operation.value);
      }
      if (operation.key === 'provider.reasoningEffort' && typeof operation.value === 'string') runtime.reasoningEffort = operation.value;
    }
  }

export function getOnboardingConfigValueForHandler(handler: InputHandler, request: OnboardingApplyRequest, key: string): unknown {
    const config = handler.uiServices.platform.configManager;
    for (let index = request.operations.length - 1; index >= 0; index -= 1) {
      const operation = request.operations[index];
      if (operation?.kind === 'set-config' && operation.key === key) return operation.value;
    }
    return config.get(key as never);
  }

export function getOnboardingRuntimePostureForHandler(handler: InputHandler, request: OnboardingApplyRequest): OnboardingRuntimePosture {
    return {
      externalServiceManaged: true,
      mutationAllowed: false,
    };
  }

export async function restartOnboardingExternalServicesIfNeededForHandler(handler: InputHandler, request: OnboardingApplyRequest): Promise<OnboardingVerificationItem[]> {
    const externalServices = handler.uiServices.platform.externalServices;
    const state = externalServices?.inspect();
    const hostStatus = state?.daemonStatus?.reason ?? (state?.daemonRunning ? 'connected GoodVibes host appears active' : 'connected GoodVibes host is not verified from this shell');
    return [{
      id: 'runtime:external-host-owned',
      status: 'pass',
      message: `GoodVibes Agent did not start, stop, restart, or reconfigure the connected host. ${hostStatus}`,
      target: 'host',
    }];
  }

export function verifyOnboardingRuntimePostureForHandler(handler: InputHandler, request: OnboardingApplyRequest): OnboardingVerificationItem[] {
    const externalServices = handler.uiServices.platform.externalServices;
    const externalState = externalServices?.inspect();
    return [{
      id: 'runtime:external-host-owned',
      status: 'pass',
      message: externalState
        ? 'The connected GoodVibes host is managed outside Agent; Agent onboarding did not request shutdown, startup, restart, bind, or surface changes.'
        : 'The connected GoodVibes host is managed outside Agent; no local host controller is required for Agent onboarding.',
      target: 'host',
    }];
  }
