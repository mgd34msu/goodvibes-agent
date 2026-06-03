import { describe, expect, test } from 'bun:test';
import { agentWorkspaceCategoryForPanel, agentWorkspaceCommandForPanel } from '../../input/agent-workspace-panel-route.ts';

describe('agentWorkspaceCategoryForPanel', () => {
  test('routes built-in panel ids to matching Agent workspace areas', () => {
    expect(agentWorkspaceCategoryForPanel('knowledge')).toBe('knowledge');
    expect(agentWorkspaceCategoryForPanel('memory')).toBe('memory');
    expect(agentWorkspaceCategoryForPanel('work-plan')).toBe('work');
    expect(agentWorkspaceCategoryForPanel('project-planning')).toBe('work');
    expect(agentWorkspaceCategoryForPanel('tasks')).toBe('work');
    expect(agentWorkspaceCategoryForPanel('schedule')).toBe('automation');
    expect(agentWorkspaceCategoryForPanel('provider-health')).toBe('setup');
    expect(agentWorkspaceCategoryForPanel('tokens')).toBe('setup');
    expect(agentWorkspaceCategoryForPanel('tools')).toBe('tools');
    expect(agentWorkspaceCategoryForPanel('qr-code')).toBe('channels');
    expect(agentWorkspaceCategoryForPanel('sessions')).toBe('conversation');
    expect(agentWorkspaceCategoryForPanel('context')).toBe('conversation');
    expect(agentWorkspaceCategoryForPanel('docs')).toBe('home');
  });

  test('formats the direct Agent workspace command for a panel id', () => {
    expect(agentWorkspaceCommandForPanel('project-planning')).toBe('/agent work');
    expect(agentWorkspaceCommandForPanel('unknown-panel')).toBe('/agent home');
  });
});
