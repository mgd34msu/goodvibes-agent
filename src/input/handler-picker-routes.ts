import { readFileSync } from 'node:fs';
import type { InputToken } from '@pellux/goodvibes-sdk/platform/core';
import type { CommandContext } from './command-registry.ts';
import type { CapabilityFilter, CategoryFilter, ModelPickerModal } from './model-picker.ts';
import { MODEL_PICKER_CHROME_LINES } from '../renderer/model-picker-overlay.ts';
import { isLocalFitRecommendation, isProviderSignInRow } from '../input/model-picker-local-fit.ts';
import { offersConfigurableEffort, requestedEffortLevel, servingEffortForLevel, toEffortModel } from '../providers/reasoning-effort-surface.ts';
import { resolveAndValidatePath } from '@pellux/goodvibes-sdk/platform/utils';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import type { ProcessEntry } from '../renderer/process-modal.ts';
import type { BlockActionId } from '../renderer/block-actions.ts';

type ModelPickerRouteState = {
  modelPicker: ModelPickerModal;
  modalStack: string[];
  commandContext?: CommandContext;
  getViewportHeight: () => number;
  requestRender: () => void;
  handleEscape: () => void;
  onModelPickerCommit?: () => boolean;
};

/**
 * The user's REQUESTED reasoning level for this session, or undefined when the
 * command context is not attached. Read from config through the shared helper,
 * never from `session.runtime.reasoningEffort`, which holds the EFFECTIVE level
 * for whichever model is serving and would re-seed a resolution with an already
 * snapped-down value.
 */
function readRequestedEffort(state: ModelPickerRouteState): string | undefined {
  const configManager = state.commandContext?.platform?.configManager;
  if (!configManager) return undefined;
  return requestedEffortLevel(configManager) || undefined;
}

/**
 * The level the effort step should open on for a model about to be selected:
 * the requested level SNAPPED to that model. Opening on the raw requested level
 * would miss the list entirely whenever the target model caps lower, and
 * showEffortPicker falls back to index 0, landing the cursor on the LOWEST
 * level rather than on what pressing Enter would actually give you.
 */
function effortStepPreselect(state: ModelPickerRouteState, model: { id: string; provider?: string; displayName?: string }): string {
  const requested = readRequestedEffort(state) ?? 'medium';
  return servingEffortForLevel(requested, toEffortModel(model as never)).effective ?? requested;
}

export function handleModelPickerToken(state: ModelPickerRouteState, token: InputToken): boolean {
  if (!state.modelPicker.active) return false;

  if (token.type === 'key') {
    if (token.logicalName === 'escape') {
      if (state.modelPicker.searchFocused && state.modelPicker.mode !== 'contextCap') {
        if (state.modelPicker.query.length > 0) {
          state.modelPicker.clearQuery();
        } else {
          state.modelPicker.blurSearch();
        }
      } else if (state.modelPicker.query.length > 0) {
        state.modelPicker.clearQuery();
      } else if (state.modelPicker.mode === 'effort') {
        state.modelPicker.mode = 'model';
        state.modelPicker.selectedIndex = 0;
      } else if (state.modelPicker.mode === 'contextCap') {
        state.modelPicker.contextCapQuery = '';
        state.modelPicker.contextCapPendingModel = null;
        state.modelPicker.mode = 'model';
      } else if (state.modelPicker.mode === 'model' && state.modelPicker.previousMode === 'provider') {
        state.modelPicker.mode = 'provider';
        state.modelPicker.selectedIndex = 0;
      } else {
        state.handleEscape();
        return true;
      }
    } else if (token.logicalName === 'backspace') {
      if (state.modelPicker.mode === 'contextCap') state.modelPicker.deleteContextCapChar();
      else if (state.modelPicker.searchFocused && (state.modelPicker.mode === 'model' || state.modelPicker.mode === 'provider')) state.modelPicker.deleteChar();
    } else if (token.logicalName === 'enter') {
      if (state.modelPicker.focusPane === 'targets') {
        state.modelPicker.focusItems();
        state.requestRender();
        return true;
      }
      const mode = state.modelPicker.mode;
      const idx = state.modelPicker.selectedIndex;
      if (mode === 'model') {
        const selected = state.modelPicker.getSelected();
        if (selected) {
          // Sign-in row: route to provider picker instead of committing a model.
          if (isProviderSignInRow(selected)) {
            state.modelPicker.close();
            if (state.modalStack[state.modalStack.length - 1] === 'modelPicker') state.modalStack.pop();
            state.commandContext?.openProviderPicker?.();
            return true;
          }
          // Local fit rec: the model is not installed, do not commit it as the
          // active model. Print a plain-language guide and close the picker.
          if (isLocalFitRecommendation(selected)) {
            state.modelPicker.close();
            if (state.modalStack[state.modalStack.length - 1] === 'modelPicker') state.modalStack.pop();
            state.commandContext?.print?.(
              [
                `${selected.displayName} is not installed yet.`,
                'To use a local model, add a custom provider:',
                '  /provider add <name> <baseURL>  (e.g. /provider add ollama http://localhost:11434/v1)',
                'Or sign in to a cloud provider via the provider picker.',
              ].join('\n'),
            );
            return true;
          }
          // Preselect the REQUESTED level, not the effective one: the effort step
          // re-chooses the preference, so it must open on what the user asked for
          // even while a model that caps lower is serving.
          const currentEffort = readRequestedEffort(state) ?? 'medium';
          if (state.modelPicker.target === 'main' && offersConfigurableEffort(toEffortModel(selected))) {
            state.modelPicker.showEffortPicker(selected, effortStepPreselect(state, selected));
          } else {
            const target = state.modelPicker.target;
            const handled = state.onModelPickerCommit?.() ?? false;
            if (!handled) {
              // No effort step ran, so `currentEffort` is carried over, not
              // chosen: the commit path re-resolves from the stored preference
              // instead of treating this as a new choice.
              state.commandContext?.completeModelSelection?.({
                model: selected,
                effort: currentEffort,
                target,
              });
            }
            state.modelPicker.close();
            if (state.modalStack[state.modalStack.length - 1] === 'modelPicker') state.modalStack.pop();
          }
        }
      } else if (mode === 'provider') {
        const selectedProvider = state.modelPicker.getFilteredProviders()[idx];
        if (selectedProvider) {
          const models = state.commandContext
            ? state.commandContext.provider.providerRegistry.getSelectableModels().filter(m => m.provider === selectedProvider)
            : [];
          state.modelPicker.showModelsForProvider(models, selectedProvider);
        }
      } else if (mode === 'effort') {
        const model = state.modelPicker.pendingModel;
        const effort = state.modelPicker.effortLevels[idx];
        if (model && effort) {
          const handled = state.onModelPickerCommit?.() ?? false;
          // The effort STEP: the level below is one the user just picked.
          if (!handled) state.commandContext?.completeModelSelection?.({ model, effort, target: state.modelPicker.target, effortChosenByUser: true });
        }
        state.modelPicker.close();
        if (state.modalStack[state.modalStack.length - 1] === 'modelPicker') state.modalStack.pop();
      } else if (mode === 'contextCap') {
        const capModel = state.modelPicker.contextCapPendingModel;
        if (capModel) {
          const rawInput = state.modelPicker.contextCapQuery.trim();
          const parsedCap = rawInput.length > 0 ? parseInt(rawInput, 10) : null;
          const validCap = parsedCap !== null && parsedCap > 0 && parsedCap <= 10_000_000 ? parsedCap : null;
          const effort = readRequestedEffort(state) ?? 'medium';
          const handled = state.onModelPickerCommit?.() ?? false;
          if (!handled) state.commandContext?.completeModelSelection?.({ model: capModel, effort, contextCap: validCap, target: state.modelPicker.target });
        }
        state.modelPicker.close();
        if (state.modalStack[state.modalStack.length - 1] === 'modelPicker') state.modalStack.pop();
      }
    } else if (token.logicalName === 'up') {
      if (state.modelPicker.focusPane === 'targets') {
        state.modelPicker.moveTarget(-1);
        state.requestRender();
        return true;
      }
      if (state.modelPicker.canFocusSearch() && !state.modelPicker.searchFocused && state.modelPicker.selectedIndex === 0) {
        state.modelPicker.focusSearch();
      } else if (!state.modelPicker.searchFocused) {
        const maxVis = Math.max(5, state.getViewportHeight() - MODEL_PICKER_CHROME_LINES - 4);
        state.modelPicker.moveUp(maxVis);
      }
    } else if (token.logicalName === 'down') {
      if (state.modelPicker.focusPane === 'targets') {
        state.modelPicker.moveTarget(1);
        state.requestRender();
        return true;
      }
      if (state.modelPicker.searchFocused) {
        state.modelPicker.blurSearch();
      } else {
        const maxVis = Math.max(5, state.getViewportHeight() - MODEL_PICKER_CHROME_LINES - 4);
        state.modelPicker.moveDown(maxVis);
      }
    } else if (token.logicalName === 'left' && !state.modelPicker.searchFocused && state.modelPicker.mode !== 'contextCap') {
      state.modelPicker.focusTargets();
    } else if (token.logicalName === 'right' && !state.modelPicker.searchFocused && state.modelPicker.mode !== 'contextCap') {
      state.modelPicker.focusItems();
    } else if (token.logicalName === 'tab' && state.modelPicker.mode === 'model') {
      if (state.modelPicker.focusPane === 'targets') {
        state.modelPicker.focusItems();
      } else {
        const cycle: CategoryFilter[] = ['all', 'free', 'paid', 'subscription'];
        const cur = cycle.indexOf(state.modelPicker.categoryFilter);
        state.modelPicker.setCategoryFilter(cycle[(cur + 1) % cycle.length]!);
      }
    } else if (!state.modelPicker.searchFocused && token.logicalName === 'g' && state.modelPicker.mode === 'model') {
      state.modelPicker.cycleGroupBy();
    } else if (!state.modelPicker.searchFocused && token.logicalName === 'c' && state.modelPicker.mode === 'model') {
      cycleCapabilityFilter(state.modelPicker);
    } else if (!state.modelPicker.searchFocused && token.logicalName === 'a' && state.modelPicker.mode === 'model') {
      state.modelPicker.toggleAvailableOnly();
    } else if (!state.modelPicker.searchFocused && token.logicalName === 'b' && state.modelPicker.mode === 'model') {
      state.modelPicker.cycleBenchmarkSort();
    } else if (!state.modelPicker.searchFocused && token.logicalName === '/' && state.modelPicker.canFocusSearch()) {
      state.modelPicker.focusItems();
      state.modelPicker.focusSearch();
    }
  } else if (token.type === 'text') {
    if (state.modelPicker.mode === 'contextCap') {
      if (token.value.length === 1) state.modelPicker.appendContextCapChar(token.value);
    } else if ((state.modelPicker.mode === 'model' || state.modelPicker.mode === 'provider') && state.modelPicker.searchFocused) {
      const ch = token.value;
      if (ch === ' ' && state.modelPicker.mode === 'model') {
        const selected = state.modelPicker.getSelected();
        if (selected && state.modelPicker.isLocalModel(selected)) state.modelPicker.enterContextCapMode(selected);
        else state.modelPicker.appendChar(ch);
      } else if (ch.length === 1 && ch >= ' ') {
        state.modelPicker.appendChar(ch);
      }
    } else if (token.value === ' ' && state.modelPicker.mode === 'model') {
      const selected = state.modelPicker.getSelected();
      if (selected && state.modelPicker.isLocalModel(selected)) state.modelPicker.enterContextCapMode(selected);
    } else if (token.value === '\t') {
      if (state.modelPicker.focusPane === 'targets') state.modelPicker.focusItems();
      else state.modelPicker.focusTargets();
    } else if (token.value === 'g' && state.modelPicker.mode === 'model') {
      state.modelPicker.cycleGroupBy();
    } else if (token.value === 'c' && state.modelPicker.mode === 'model') {
      cycleCapabilityFilter(state.modelPicker);
    } else if (token.value === 'a' && state.modelPicker.mode === 'model') {
      state.modelPicker.toggleAvailableOnly();
    } else if (token.value === 'b' && state.modelPicker.mode === 'model') {
      state.modelPicker.cycleBenchmarkSort();
    } else if (token.value === '/' && state.modelPicker.canFocusSearch()) {
      state.modelPicker.focusItems();
      state.modelPicker.focusSearch();
    }
  }

  state.requestRender();
  return true;
}

function cycleCapabilityFilter(modelPicker: ModelPickerModal): void {
  const cycle: CapabilityFilter[] = ['none', 'reasoning', 'toolUse', 'multimodal'];
  const cur = cycle.indexOf(modelPicker.capabilityFilter);
  modelPicker.setCapabilityFilter(cycle[(cur + 1) % cycle.length]!);
}

type ProcessRouteState = {
  processModal: {
    active: boolean;
    moveUp: () => void;
    moveDown: () => void;
    getSelected: () => ProcessEntry | undefined;
    close: () => void;
    open: () => void;
    stopSelected: () => boolean;
    refresh: () => void;
  };
  liveTailModal: {
    open: (entry: ProcessEntry) => void;
  };
  modalOpened: (name: string) => void;
  requestRender: () => void;
  handleEscape: () => void;
};

export function handleProcessModalToken(state: ProcessRouteState, token: InputToken): boolean {
  if (!state.processModal.active) return false;

  if (token.type === 'key') {
    if (token.logicalName === 'escape') {
      state.handleEscape();
      return true;
    }
    if (token.logicalName === 'up') state.processModal.moveUp();
    else if (token.logicalName === 'down') state.processModal.moveDown();
    else if (token.logicalName === 'enter') {
      const entry = state.processModal.getSelected();
      if (entry) {
        state.modalOpened('liveTail');
        state.processModal.close();
        state.liveTailModal.open(entry);
      }
    }
  } else if (token.type === 'text' && token.value === 'k') {
    const stopped = state.processModal.stopSelected();
    if (stopped) state.processModal.refresh();
  }

  state.requestRender();
  return true;
}

type LiveTailRouteState = {
  liveTailModal: {
    active: boolean;
    scrollUp: () => void;
    scrollDown: () => void;
    stopProcess: () => boolean;
    close: () => void;
  };
  processModal: {
    open: () => void;
  };
  requestRender: () => void;
  handleEscape: () => void;
};

export function handleLiveTailToken(state: LiveTailRouteState, token: InputToken): boolean {
  if (!state.liveTailModal.active) return false;

  const stopAndReturn = (): void => {
    if (state.liveTailModal.stopProcess()) state.handleEscape();
  };

  if (token.type === 'key') {
    if (token.logicalName === 'escape') {
      state.handleEscape();
      return true;
    }
    if (token.logicalName === 'up') state.liveTailModal.scrollUp();
    else if (token.logicalName === 'down') state.liveTailModal.scrollDown();
    else if (token.logicalName === 'k') stopAndReturn();
  } else if (token.type === 'text' && token.value === 'k') {
    stopAndReturn();
  }

  state.requestRender();
  return true;
}

type EscapeOnlyModalRouteState = {
  active: boolean;
  requestRender: () => void;
  handleEscape: () => void;
};

export function handleEscapeOnlyModalToken(state: EscapeOnlyModalRouteState, token: InputToken): boolean {
  if (!state.active) return false;
  if (token.type === 'key' && token.logicalName === 'escape') {
    state.handleEscape();
    return true;
  }
  state.requestRender();
  return true;
}

type FilePickerRouteState = {
  filePicker: {
    active: boolean;
    query: string;
    searchFocused: boolean;
    insertPos: number;
    injectMode: boolean;
    close: () => void;
    setQuery: (query: string) => void;
    focusSearch: () => void;
    blurSearch: () => void;
    getSelected: () => string | null;
    selectedIndex: number;
    moveUp: () => void;
    moveDown: () => void;
  };
  prompt: string;
  cursorPos: number;
  commandContext?: CommandContext;
  imageRegistry: Map<string, { data: string; mediaType: string }>;
  nextImageId: number;
  requestRender: () => void;
  handleEscape: () => void;
  saveUndoState: () => void;
  ensureInputCursorVisible: () => void;
  formatFileSize: (bytes: number) => string;
  mediaTypeFromExt: (ext: string) => string;
  imageExtensions: string[];
};

export function handleFilePickerToken(state: FilePickerRouteState, token: InputToken): boolean {
  if (!state.filePicker.active) return false;

  if (token.type === 'text') {
    if (!state.filePicker.searchFocused && token.value === '/') {
      state.filePicker.focusSearch();
    } else if (state.filePicker.searchFocused && token.value === ' ' && state.filePicker.query === '') {
      state.filePicker.close();
    } else if (state.filePicker.searchFocused) {
      state.filePicker.setQuery(state.filePicker.query + token.value);
    }
  } else if (token.type === 'key') {
    if (token.logicalName === 'escape') {
      if (state.filePicker.searchFocused && state.filePicker.query.length > 0) {
        state.filePicker.setQuery('');
        state.requestRender();
        return true;
      }
      state.handleEscape();
      return true;
    } else if (token.logicalName === 'enter') {
      const selected = state.filePicker.getSelected();
      if (selected) {
        state.saveUndoState();
        const atPos = state.filePicker.insertPos;
        const injectMode = state.filePicker.injectMode;
        const prefixLen = injectMode ? 2 : 1;
        const queryLen = state.filePicker.query.length + prefixLen;
        const ext = selected.slice(selected.lastIndexOf('.'));
        if (!injectMode && state.imageExtensions.some(e => e === ext.toLowerCase())) {
          try {
            const projectRoot = state.commandContext?.workspace.shellPaths?.workingDirectory
              ?? state.commandContext?.platform.configManager.getWorkingDirectory();
            if (!projectRoot) {
              throw new Error('working directory is unavailable');
            }
            const resolvedPath = resolveAndValidatePath(selected, projectRoot);
            const data = readFileSync(resolvedPath);
            const base64 = data.toString('base64');
            const mediaType = state.mediaTypeFromExt(ext);
            const filename = selected.split('/').pop() ?? selected;
            const id = `img${state.nextImageId++}`;
            state.imageRegistry.set(id, { data: base64, mediaType });
            const marker = `[IMAGE: ${id}, ${filename}, ${state.formatFileSize(data.length)}]`;
            state.prompt = state.prompt.slice(0, atPos) + marker + ' ' + state.prompt.slice(atPos + queryLen);
            state.cursorPos = atPos + marker.length + 1;
          } catch (err) {
            logger.debug('file-picker: could not read image file', { err });
            state.prompt = state.prompt.slice(0, atPos) + '@' + selected + ' ' + state.prompt.slice(atPos + queryLen);
            state.cursorPos = atPos + selected.length + 2;
          }
        } else if (injectMode) {
          const marker = `!@${selected}`;
          state.prompt = state.prompt.slice(0, atPos) + marker + ' ' + state.prompt.slice(atPos + queryLen);
          state.cursorPos = atPos + marker.length + 1;
        } else {
          state.prompt = state.prompt.slice(0, atPos) + '@' + selected + ' ' + state.prompt.slice(atPos + queryLen);
          state.cursorPos = atPos + selected.length + 2;
        }
        state.ensureInputCursorVisible();
      }
      state.filePicker.close();
    } else if (token.logicalName === 'up') {
      if (!state.filePicker.searchFocused && state.filePicker.selectedIndex === 0) {
        state.filePicker.focusSearch();
      } else if (!state.filePicker.searchFocused) {
        state.filePicker.moveUp();
      }
    } else if (token.logicalName === 'down') {
      if (state.filePicker.searchFocused) {
        state.filePicker.blurSearch();
      } else {
        state.filePicker.moveDown();
      }
    } else if (token.logicalName === 'backspace') {
      if (state.filePicker.searchFocused && state.filePicker.query.length > 0) {
        state.filePicker.setQuery(state.filePicker.query.slice(0, -1));
      } else if (state.filePicker.searchFocused) {
        const removeCount = state.filePicker.injectMode ? 2 : 1;
        if (state.cursorPos >= removeCount) {
          state.prompt = state.prompt.slice(0, state.cursorPos - removeCount) + state.prompt.slice(state.cursorPos);
          state.cursorPos -= removeCount;
        }
        state.filePicker.close();
      }
    }
  }

  state.requestRender();
  return true;
}

type BlockActionsRouteState = {
  blockActionsMenu: {
    active: boolean;
    moveUp: () => void;
    moveDown: () => void;
    getSelected: () => { id: BlockActionId } | null;
    close: () => void;
    getActionForKey: (key: string) => { id: BlockActionId } | null;
  };
  executeBlockAction: (id: BlockActionId) => void;
  requestRender: () => void;
  handleEscape: () => void;
};

export function handleBlockActionsToken(state: BlockActionsRouteState, token: InputToken): boolean {
  if (!state.blockActionsMenu.active) return false;

  if (token.type === 'key') {
    if (token.logicalName === 'escape') {
      state.handleEscape();
      return true;
    }
    if (token.logicalName === 'up') state.blockActionsMenu.moveUp();
    else if (token.logicalName === 'down') state.blockActionsMenu.moveDown();
    else if (token.logicalName === 'enter') {
      const action = state.blockActionsMenu.getSelected();
      state.blockActionsMenu.close();
      if (action) state.executeBlockAction(action.id);
    } else if (token.logicalName === 'tab') {
      const action = state.blockActionsMenu.getActionForKey('Tab');
      state.blockActionsMenu.close();
      if (action) state.executeBlockAction(action.id);
    }
  } else if (token.type === 'text') {
    const action = state.blockActionsMenu.getActionForKey(token.value);
    state.blockActionsMenu.close();
    if (action) state.executeBlockAction(action.id);
  }

  state.requestRender();
  return true;
}
