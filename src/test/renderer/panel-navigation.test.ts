import { describe, expect, test } from 'bun:test';
import { renderPanelTabBar } from '../../renderer/panel-tab-bar.ts';
import { renderPanelWorkspaceBar } from '../../renderer/panel-workspace-bar.ts';
import type { Panel } from '../../panels/types.ts';
import type { WorkspaceTab } from '../../panels/panel-manager.ts';
import { lineToString } from '../setup.ts';

function makePanel(id: string, name: string, icon = 'X'): Panel {
  return {
    id,
    name,
    icon,
    category: 'monitoring',
    isTransient: false,
    isPinned: false,
    needsRender: true,
    onActivate() {},
    onDeactivate() {},
    onDestroy() {},
    render: () => [],
    invalidate() { this.needsRender = true; },
    markRendered() { this.needsRender = false; },
  };
}

describe('panel navigation chrome', () => {
  test('tab bar renders pane label and panel count', () => {
    const line = renderPanelTabBar(
      [makePanel('a', 'Alpha'), makePanel('b', 'Beta')],
      0,
      80,
      true,
      'top',
    );
    const text = lineToString(line);
    expect(text).toContain('TOP');
    expect(text).toContain('2');
    expect(text).toContain('Alpha');
  });

  test('workspace bar renders open tabs across panes', () => {
    const tabs: WorkspaceTab[] = [
      { id: 'system', name: 'System Messages', icon: 'J', pane: 'top', active: true, focused: true },
      { id: 'wrfc', name: 'WRFC', icon: 'W', pane: 'bottom', active: false, focused: false },
    ];
    const line = renderPanelWorkspaceBar(tabs, 100, true);
    const text = lineToString(line);
    expect(text).toContain('PANELS');
    expect(text).toContain('^ J System Messages');
    expect(text).toContain('v W WRFC');
  });
});
