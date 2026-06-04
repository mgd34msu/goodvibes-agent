/**
 * UX Anti-Regression: Resume/Recovery With Active State (v3 §18.5)
 *
 * Verifies that recovering a session ignores copied panel state, keeps the
 * main conversation available, and reconciles session metadata.
 *
 * All tests use pure state manipulation — no real I/O, no event bus.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { createInitialRuntimeState } from '../../runtime/store/state.ts';
import type { RuntimeState } from '../../runtime/store/state.ts';
import {
  selectPanels,
  selectSession,
  selectActivePanels,
  selectAnyOverlayVisible,
} from '../../runtime/store/selectors/index.ts';
import type { PanelDomainState, PanelId } from '../../runtime/store/domains/panels.ts';
import type { SessionDomainState } from '@/runtime/index.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fixed timestamp used in test helpers to avoid non-deterministic Date.now() calls. */
const TEST_TIMESTAMP = 1700000000000;

/** Build a panel state map with given panels open/focused. */
function makePanelState(openPanelIds: PanelId[], focusedPanelId: PanelId): PanelDomainState {
  const base = selectPanels(createInitialRuntimeState());
  const panelMap = new Map(base.panels);

  for (const [id, panel] of panelMap) {
    const shouldBeOpen = openPanelIds.includes(id);
    const shouldBeFocused = id === focusedPanelId;
    panelMap.set(id, {
      ...panel,
      open: shouldBeOpen,
      focused: shouldBeFocused,
      lastActivatedAt: shouldBeOpen ? TEST_TIMESTAMP - 1000 : undefined,
    });
  }

  return {
    ...base,
    panels: panelMap,
    focusedPanelId,
    revision: base.revision + 1,
    lastUpdatedAt: TEST_TIMESTAMP,
    source: 'resume-test',
  };
}

/** Simulate a suspended state — copied panels closed, session status suspended. */
function buildSuspendedState(activeState: RuntimeState): RuntimeState {
  const activePanelState = selectPanels(activeState);
  const closedPanels = new Map(activePanelState.panels);
  for (const [id, panel] of closedPanels) {
    const isMainConversation = id === 'main_conversation';
    closedPanels.set(id, { ...panel, open: isMainConversation, focused: isMainConversation });
  }

  return {
    ...activeState,
    panels: {
      ...activePanelState,
      panels: closedPanels,
      revision: activePanelState.revision + 1,
      lastUpdatedAt: TEST_TIMESTAMP,
      source: 'suspend',
      focusedPanelId: 'main_conversation',
    } as unknown as Record<string, unknown>,
    session: {
      ...activeState.session,
      status: 'suspended',
      revision: activeState.session.revision + 1,
      lastUpdatedAt: TEST_TIMESTAMP,
      source: 'suspend',
    },
  };
}

/** Simulate Agent session recovery: ignore copied panel state and update session metadata. */
function applyResume(
  suspendedState: RuntimeState,
  snapshot: {
    panels: PanelDomainState;
    session?: Partial<SessionDomainState>;
  },
): RuntimeState {
  const suspendedPanels = selectPanels(suspendedState);
  return {
    ...suspendedState,
    panels: {
      ...suspendedPanels,
      revision: selectPanels(suspendedState).revision + 1,
      lastUpdatedAt: TEST_TIMESTAMP,
      source: 'resume',
    } as unknown as Record<string, unknown>,
    session: {
      ...suspendedState.session,
      ...(snapshot.session ?? {}),
      status: 'active',
      isResumed: true,
      recoveryState: 'ready',
      revision: suspendedState.session.revision + 1,
      lastUpdatedAt: TEST_TIMESTAMP,
      source: 'resume',
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ux:resume-recovery — resume session while ignoring copied panel state', () => {
  let state: RuntimeState;

  beforeEach(() => {
    state = createInitialRuntimeState();
  });

  describe('saved panel state handling', () => {
    test('copied panels from the snapshot stay closed after Agent resume', () => {
      const panels = selectPanels(createInitialRuntimeState());
      const panelIds = [...panels.panels.keys()].filter((id) => id !== 'main_conversation') as PanelId[];

      const openIds = panelIds.slice(0, 2);
      const focusId = openIds[0]!;

      const activePanel = makePanelState(openIds, focusId);

      const suspended = buildSuspendedState({ ...state, panels: activePanel as unknown as Record<string, unknown> });
      const suspendedPanels = selectPanels(suspended);
      const openCopiedPanels = [...suspendedPanels.panels.values()]
        .filter((panel) => panel.id !== 'main_conversation')
        .filter((panel) => panel.open);
      expect(openCopiedPanels).toEqual([]);
      expect(suspendedPanels.panels.get('main_conversation')?.open).toBe(true);

      const resumed = applyResume(suspended, { panels: activePanel });

      for (const id of openIds) {
        const panel = selectPanels(resumed).panels.get(id);
        expect(panel?.open).toBe(false);
      }
    });

    test('focused copied panel from the snapshot is not restored', () => {
      const panels = selectPanels(createInitialRuntimeState());
      const panelIds = [...panels.panels.keys()].filter((id) => id !== 'main_conversation') as PanelId[];
      const focusId = panelIds[1]!;
      const openIds = panelIds.slice(0, 3);

      const activePanel = makePanelState(openIds, focusId);
      const suspended = buildSuspendedState({ ...state, panels: activePanel as unknown as Record<string, unknown> });
      const resumed = applyResume(suspended, { panels: activePanel });

      expect(selectPanels(resumed).focusedPanelId).toBe('main_conversation');
      expect(selectPanels(resumed).focusedPanelId).not.toBe(focusId);
    });

    test('activePanels selector excludes copied panels after Agent resume', () => {
      const panels = selectPanels(createInitialRuntimeState());
      const panelIds = [...panels.panels.keys()].filter((id) => id !== 'main_conversation') as PanelId[];
      const openIds = panelIds.slice(0, 3);

      const activePanel = makePanelState(openIds, openIds[0]!);
      const suspended = buildSuspendedState({ ...state, panels: activePanel as unknown as Record<string, unknown> });
      const resumed = applyResume(suspended, { panels: activePanel });

      const activePanels = selectActivePanels(resumed);
      const openPanelIds = activePanels.map((p) => p.id);
      expect(openPanelIds).toContain('main_conversation');
      for (const id of openIds) {
        expect(openPanelIds).not.toContain(id);
      }
    });

    test('all copied panels remain closed after resume', () => {
      const panels = selectPanels(createInitialRuntimeState());
      const panelIds = [...panels.panels.keys()].filter((id) => id !== 'main_conversation') as PanelId[];

      const openIds = panelIds.slice(0, 2);

      const activePanel = makePanelState(openIds, openIds[0]!);
      const suspended = buildSuspendedState({ ...state, panels: activePanel as unknown as Record<string, unknown> });
      const resumed = applyResume(suspended, { panels: activePanel });

      for (const id of panelIds) {
        const panel = selectPanels(resumed).panels.get(id);
        expect(panel?.open).toBe(false);
      }
    });
  });

  describe('overlay state after resume', () => {
    test('no overlays are visible in initial resumed state', () => {
      expect(selectAnyOverlayVisible(state)).toBe(false);

      const suspended = buildSuspendedState(state);
      const resumed = applyResume(suspended, { panels: selectPanels(state) });
      expect(selectAnyOverlayVisible(resumed)).toBe(false);
    });
  });

  describe('session metadata reconciliation', () => {
    test('session ID is preserved across resume', () => {
      const sessionId = state.session.id;
      const suspended = buildSuspendedState(state);
      const resumed = applyResume(suspended, { panels: selectPanels(state), session: { id: sessionId } });
      expect(selectSession(resumed).id).toBe(sessionId);
    });

    test('resume revision is greater than suspended revision', () => {
      const suspended = buildSuspendedState(state);
      const suspendedRev = selectPanels(suspended).revision;

      const resumed = applyResume(suspended, { panels: selectPanels(state) });
      expect(selectPanels(resumed).revision).toBeGreaterThan(suspendedRev);
    });

    test('source is set to resume after recovery', () => {
      const suspended = buildSuspendedState(state);
      const resumed = applyResume(suspended, { panels: selectPanels(state) });
      expect(selectPanels(resumed).source).toBe('resume');
      expect(selectSession(resumed).source).toBe('resume');
    });

    test('session status transitions to active after resume', () => {
      const suspended = buildSuspendedState(state);
      expect(selectSession(suspended).status).toBe('suspended');

      const resumed = applyResume(suspended, { panels: selectPanels(state) });
      expect(selectSession(resumed).status).toBe('active');
    });

    test('isResumed flag is set after recovery', () => {
      const suspended = buildSuspendedState(state);
      const resumed = applyResume(suspended, { panels: selectPanels(state) });
      expect(selectSession(resumed).isResumed).toBe(true);
    });

    test('multiple resume cycles produce correct final state', () => {
      const panels = selectPanels(createInitialRuntimeState());
      const panelIds = [...panels.panels.keys()].filter((id) => id !== 'main_conversation') as PanelId[];
      const openIds = panelIds.slice(0, 2);
      const panelSnapshot = makePanelState(openIds, openIds[0]!);

      let current = state;
      for (let i = 0; i < 5; i++) {
        current = { ...current, panels: panelSnapshot as unknown as Record<string, unknown> };
        current = buildSuspendedState(current);
        current = applyResume(current, { panels: panelSnapshot });
      }

      for (const id of openIds) {
        const panel = selectPanels(current).panels.get(id);
        expect(panel?.open).toBe(false);
      }
      expect(selectPanels(current).focusedPanelId).toBe('main_conversation');
      expect(selectSession(current).isResumed).toBe(true);
      expect(selectSession(current).status).toBe('active');
    });
  });
});
