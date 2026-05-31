import type { ModelPickerTarget } from '../model-picker.ts';
import { areSelectionsEqual, clamp, cloneSelection, isMalformedGoodVibesSecretReferenceValue, normalizeText } from './onboarding-wizard-helpers.ts';
import type { OnboardingWizardController } from './onboarding-wizard.ts';
import type { OnboardingWizardFieldDefinition, OnboardingWizardModelSelection, OnboardingWizardStepDefinition } from './onboarding-wizard-types.ts';

export function getToggleFieldCount(controller: OnboardingWizardController, stepIndex: number): number {
    const step = controller.steps[stepIndex];
    if (!step) return 0;
    return step.fields.filter((field) => field.kind === 'checklist' || field.kind === 'acknowledgement').length;
  }

export function getCompletedToggleCount(controller: OnboardingWizardController, stepIndex: number): number {
    const step = controller.steps[stepIndex];
    if (!step) return 0;

    return step.fields.filter((field) => (
      (field.kind === 'checklist' || field.kind === 'acknowledgement')
      && (controller.getFieldValue(field) as boolean)
    )).length;
  }

export function getStepFieldCount(controller: OnboardingWizardController, stepIndex: number): number {
    return controller.steps[stepIndex]?.fields.length ?? 0;
  }

export function getCompletedFieldCount(controller: OnboardingWizardController, stepIndex: number): number {
    const step = controller.steps[stepIndex];
    if (!step) return 0;
    return step.fields.filter((field) => controller.isFieldSatisfied(field)).length;
  }

export function isStepDirty(controller: OnboardingWizardController, stepIndex: number): boolean {
    const stepId = controller.steps[stepIndex]?.id;
    return stepId ? controller.dirtyStepIds.has(stepId) : false;
  }

export function isFieldDirty(controller: OnboardingWizardController, fieldId: string): boolean {
    const field = controller.getFieldById(fieldId);
    return field ? controller.isFieldDirtyByDefinition(field) : false;
  }

export function getBlockingFieldLabels(controller: OnboardingWizardController): readonly string[] {
    const labels: string[] = [];
    if (controller.hydrationPending) {
      labels.push('Loading: Current runtime settings are still being collected.');
      return labels;
    }
    if (controller.hydrationError !== null) {
      labels.push(`Loading: Current runtime settings could not be collected: ${controller.hydrationError}`);
      return labels;
    }

    for (const step of controller.steps) {
      for (const field of step.fields) {
        if (field.kind === 'acknowledgement' && field.required && !controller.isFieldSatisfied(field)) {
          labels.push(`${step.shortLabel}: ${field.label}`);
        }
        const validationError = controller.getFieldValidationError(step, field);
        if (validationError) labels.push(validationError);
      }
    }
    return labels;
  }

export function getFieldValidationError(
  controller: OnboardingWizardController,
    step: OnboardingWizardStepDefinition,
    field: OnboardingWizardFieldDefinition,
  ): string | null {
    if (field.kind !== 'text' && field.kind !== 'masked') return null;

    const value = normalizeText(controller.getFieldValue(field) as string);
    const required = field.required === true;
    if (required && value.length === 0) {
      return `${step.shortLabel}: ${field.label} is required.`;
    }

    if (field.kind === 'masked' && isMalformedGoodVibesSecretReferenceValue(value)) {
      return `${step.shortLabel}: ${field.label} must be a secret value or a goodvibes://secrets/... reference.`;
    }

    return null;
  }

export function getFieldById(controller: OnboardingWizardController, fieldId: string): OnboardingWizardFieldDefinition | null {
    for (const step of controller.steps) {
      const field = step.fields.find((entry) => entry.id === fieldId);
      if (field) return field;
    }
    return null;
  }

export function ensureSelectionVisible(controller: OnboardingWizardController, visibleFields: number): void {
    const total = controller.currentStep.fields.length;
    if (total === 0) {
      controller.scrollOffsets[controller.stepIndex] = 0;
      controller.selectedFieldIndices[controller.stepIndex] = 0;
      return;
    }

    const clampedSelection = clamp(controller.selectedFieldIndices[controller.stepIndex] ?? 0, 0, total - 1);
    const maxStart = Math.max(0, total - visibleFields);
    let nextOffset = clamp(controller.scrollOffsets[controller.stepIndex] ?? 0, 0, maxStart);

    if (clampedSelection < nextOffset) nextOffset = clampedSelection;
    if (clampedSelection >= nextOffset + visibleFields) nextOffset = clampedSelection - visibleFields + 1;

    controller.selectedFieldIndices[controller.stepIndex] = clampedSelection;
    controller.scrollOffsets[controller.stepIndex] = clamp(nextOffset, 0, maxStart);
  }

export function reconcileStepCursor(controller: OnboardingWizardController, stepIndex: number): void {
    const total = controller.steps[stepIndex]?.fields.length ?? 0;
    if (total === 0) {
      controller.scrollOffsets[stepIndex] = 0;
      controller.selectedFieldIndices[stepIndex] = 0;
      return;
    }

    controller.selectedFieldIndices[stepIndex] = clamp(controller.selectedFieldIndices[stepIndex] ?? 0, 0, total - 1);
    controller.scrollOffsets[stepIndex] = clamp(controller.scrollOffsets[stepIndex] ?? 0, 0, total - 1);
  }

export function resetValuesFromCurrentDefinitions(controller: OnboardingWizardController): void {
    controller.toggleState.clear();
    controller.baselineToggleState.clear();
    controller.radioState.clear();
    controller.baselineRadioState.clear();
    controller.textState.clear();
    controller.baselineTextState.clear();
    controller.modelSelectionState.clear();
    controller.baselineModelSelectionState.clear();
    controller.touchedActionFields.clear();
    controller.dirtyStepIds.clear();
    controller.pendingAction = null;

    for (const step of controller.steps) {
      for (const field of step.fields) {
        if (field.kind === 'status') continue;

        if (field.kind === 'checklist' || field.kind === 'acknowledgement') {
          controller.toggleState.set(field.id, field.defaultValue);
          controller.baselineToggleState.set(field.id, field.defaultValue);
          continue;
        }

        if (field.kind === 'radio') {
          controller.radioState.set(field.id, field.defaultValue);
          controller.baselineRadioState.set(field.id, field.defaultValue);
          continue;
        }

        if (field.kind === 'text' || field.kind === 'masked') {
          controller.textState.set(field.id, field.defaultValue);
          controller.baselineTextState.set(field.id, field.defaultValue);
          continue;
        }

        if (field.kind === 'action') continue;

        controller.modelSelectionState.set(field.target, cloneSelection(field.defaultSelection));
        controller.baselineModelSelectionState.set(field.target, cloneSelection(field.defaultSelection));
      }
    }

    for (let index = 0; index < controller.steps.length; index += 1) {
      controller.reconcileStepCursor(index);
    }
  }

export function reconcileStateWithCurrentDefinitions(controller: OnboardingWizardController): void {
    const nextToggleKeys = new Set<string>();
    const nextRadioKeys = new Set<string>();
    const nextTextKeys = new Set<string>();
    const nextModelTargets = new Set<ModelPickerTarget>();

    for (const step of controller.steps) {
      for (const field of step.fields) {
        if (field.kind === 'status') continue;

        if (field.kind === 'checklist' || field.kind === 'acknowledgement') {
          nextToggleKeys.add(field.id);
          if (!controller.toggleState.has(field.id)) controller.toggleState.set(field.id, field.defaultValue);
          if (!controller.baselineToggleState.has(field.id)) controller.baselineToggleState.set(field.id, field.defaultValue);
          continue;
        }

        if (field.kind === 'radio') {
          nextRadioKeys.add(field.id);
          if (!controller.radioState.has(field.id)) controller.radioState.set(field.id, field.defaultValue);
          if (!controller.baselineRadioState.has(field.id)) controller.baselineRadioState.set(field.id, field.defaultValue);
          continue;
        }

        if (field.kind === 'text' || field.kind === 'masked') {
          nextTextKeys.add(field.id);
          if (!controller.textState.has(field.id)) controller.textState.set(field.id, field.defaultValue);
          if (!controller.baselineTextState.has(field.id)) controller.baselineTextState.set(field.id, field.defaultValue);
          continue;
        }

        if (field.kind === 'action') continue;

        nextModelTargets.add(field.target);
        if (!controller.modelSelectionState.has(field.target)) {
          controller.modelSelectionState.set(field.target, cloneSelection(field.defaultSelection));
        }
        if (!controller.baselineModelSelectionState.has(field.target)) {
          controller.baselineModelSelectionState.set(field.target, cloneSelection(field.defaultSelection));
        }
      }
    }

    for (const key of [...controller.toggleState.keys()]) {
      if (!nextToggleKeys.has(key)) controller.toggleState.delete(key);
    }
    for (const key of [...controller.baselineToggleState.keys()]) {
      if (!nextToggleKeys.has(key)) controller.baselineToggleState.delete(key);
    }
    for (const key of [...controller.radioState.keys()]) {
      if (!nextRadioKeys.has(key)) controller.radioState.delete(key);
    }
    for (const key of [...controller.baselineRadioState.keys()]) {
      if (!nextRadioKeys.has(key)) controller.baselineRadioState.delete(key);
    }
    for (const key of [...controller.textState.keys()]) {
      if (!nextTextKeys.has(key)) controller.textState.delete(key);
    }
    for (const key of [...controller.baselineTextState.keys()]) {
      if (!nextTextKeys.has(key)) controller.baselineTextState.delete(key);
    }
    for (const key of [...controller.modelSelectionState.keys()]) {
      if (!nextModelTargets.has(key)) controller.modelSelectionState.delete(key);
    }
    for (const key of [...controller.baselineModelSelectionState.keys()]) {
      if (!nextModelTargets.has(key)) controller.baselineModelSelectionState.delete(key);
    }
  }

export function recalculateDirtyState(controller: OnboardingWizardController): void {
    controller.reconcileStateWithCurrentDefinitions();
    controller.dirtyStepIds.clear();

    for (const step of controller.steps) {
      if (step.fields.some((field) => controller.isFieldDirtyByDefinition(field))) {
        controller.dirtyStepIds.add(step.id);
      }
    }
  }

export function isFieldDirtyByDefinition(controller: OnboardingWizardController, field: OnboardingWizardFieldDefinition): boolean {
    if (field.kind === 'checklist' || field.kind === 'acknowledgement') {
      return (controller.toggleState.get(field.id) ?? field.defaultValue)
        !== (controller.baselineToggleState.get(field.id) ?? field.defaultValue);
    }

    if (field.kind === 'radio') {
      return (controller.radioState.get(field.id) ?? field.defaultValue)
        !== (controller.baselineRadioState.get(field.id) ?? field.defaultValue);
    }

    if (field.kind === 'text' || field.kind === 'masked') {
      return (controller.textState.get(field.id) ?? field.defaultValue)
        !== (controller.baselineTextState.get(field.id) ?? field.defaultValue);
    }

    if (field.kind === 'status' || field.kind === 'action') return false;

    return !areSelectionsEqual(
      controller.modelSelectionState.get(field.target) ?? field.defaultSelection,
      controller.baselineModelSelectionState.get(field.target) ?? field.defaultSelection,
    );
  }

export function isFieldSatisfied(controller: OnboardingWizardController, field: OnboardingWizardFieldDefinition): boolean {
    if (field.kind === 'checklist') {
      return true;
    }

    if (field.kind === 'acknowledgement') {
      if (!field.required) return true;
      return Boolean(controller.getFieldValue(field));
    }

    if (field.kind === 'radio') return true;

    if (field.kind === 'text' || field.kind === 'masked') {
      const required = field.required === true;
      if (!required) return true;
      return normalizeText(controller.getFieldValue(field) as string).length > 0;
    }

    if (field.kind === 'status' || field.kind === 'action') return true;

    const selection = controller.getFieldValue(field) as OnboardingWizardModelSelection;
    return selection.providerId.length > 0 || selection.modelId.length > 0;
  }
