/**
 * Delete-key policy unit tests.
 *
 * Covers:
 *   1. Policy predicate contracts (isTextBackspace, isTextForwardDelete),
 *      byte-identical to the TUI's own predicate tests.
 *   2. Selection modal: 'delete' is a no-op in the end-anchored search filter
 *      (no cursor to forward-delete from); 'backspace' removes the last char.
 *      This agent has no `panels/` directory (fleet-only in the TUI, excluded
 *      per the parity matrix as INTENTIONALLY-DIFFERENT / fleet-lessness), so
 *      the TUI's isPanelSearchBackspace / planning-panel confirm-gate test
 *      groups have no equivalent surface here and are not ported.
 */
import { describe, expect, test } from 'bun:test';
import { isTextBackspace, isTextForwardDelete } from '@pellux/goodvibes-terminal-shell';
import { handleSelectionModalToken } from '../../input/handler-modal-routes.ts';
import { SelectionModal } from '../../input/selection-modal.ts';

// ---------------------------------------------------------------------------
// 1. Policy predicates
// ---------------------------------------------------------------------------

describe('delete-key policy predicates', () => {
  test('isTextBackspace: backspace returns true', () => {
    expect(isTextBackspace('backspace')).toBe(true);
  });

  test('isTextBackspace: delete returns false', () => {
    expect(isTextBackspace('delete')).toBe(false);
  });

  test('isTextBackspace: other keys return false', () => {
    expect(isTextBackspace('a')).toBe(false);
    expect(isTextBackspace('escape')).toBe(false);
    expect(isTextBackspace('')).toBe(false);
  });

  test('isTextForwardDelete: delete returns true', () => {
    expect(isTextForwardDelete('delete')).toBe(true);
  });

  test('isTextForwardDelete: backspace returns false', () => {
    expect(isTextForwardDelete('backspace')).toBe(false);
  });

  test('isTextForwardDelete: other keys return false', () => {
    expect(isTextForwardDelete('a')).toBe(false);
    expect(isTextForwardDelete('escape')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Selection modal: delete-key policy in the end-anchored search filter
// ---------------------------------------------------------------------------

describe('selection modal delete-key policy', () => {
  function makeModalState(modal: SelectionModal): {
    selectionModal: SelectionModal;
    selectionCallback: null;
    modalStack: string[];
    requestRender: () => void;
    handleEscape: () => void;
  } {
    return {
      selectionModal: modal,
      selectionCallback: null,
      modalStack: [],
      requestRender: () => {},
      handleEscape: () => {},
    };
  }

  test('backspace removes last char from search filter', () => {
    const modal = new SelectionModal();
    modal.open('Pick', [{ id: 'a', label: 'A' }], { allowSearch: true });
    modal.focusSearch();
    modal.setQuery('abc');

    const state = makeModalState(modal);
    handleSelectionModalToken(state, { type: 'key', name: 'backspace', logicalName: 'backspace', ctrl: false, shift: false, meta: false });
    expect(modal.query).toBe('ab');
  });

  test('delete is a no-op: filter remains intact', () => {
    const modal = new SelectionModal();
    modal.open('Pick', [{ id: 'a', label: 'A' }], { allowSearch: true });
    modal.focusSearch();
    modal.setQuery('abc');

    const state = makeModalState(modal);
    handleSelectionModalToken(state, { type: 'key', name: 'delete', logicalName: 'delete', ctrl: false, shift: false, meta: false });
    expect(modal.query).toBe('abc');
  });
});
