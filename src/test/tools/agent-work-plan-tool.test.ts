import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { WorkPlanStore } from '../../work-plans/work-plan-store.ts';
import {
  createAgentWorkPlanTool,
  registerAgentWorkPlanTool,
} from '../../tools/agent-work-plan-tool.ts';

function makeStore(): WorkPlanStore {
  return new WorkPlanStore({
    homeDirectory: mkdtempSync(join(tmpdir(), 'goodvibes-agent-work-plan-tool-')),
    projectId: 'project:agent-work-plan-tool',
    projectRoot: '/tmp/agent-work-plan-tool',
  });
}

describe('agent_work_plan tool', () => {
  test('creates and lists visible local work plan items from the main conversation', async () => {
    const store = makeStore();
    const tool = createAgentWorkPlanTool(store);

    const created = await tool.execute({
      action: 'create',
      title: 'Finish operator workspace',
      notes: 'Keep this visible while working.',
    });

    expect(created.success).toBe(true);
    expect(created.output).toContain('Created Agent work plan item');
    const item = store.listItems()[0]!;
    expect(item.title).toBe('Finish operator workspace');
    expect(item.owner).toBe('agent');
    expect(item.source).toBe('main-conversation');

    const listed = await tool.execute({ action: 'list' });
    expect(listed.success).toBe(true);
    expect(listed.output).toContain('Agent local work plan');
    expect(listed.output).toContain('Finish operator workspace');
  });

  test('shows and updates status without connected-host mutation', async () => {
    const store = makeStore();
    const tool = createAgentWorkPlanTool(store);
    const item = store.addItem('Review visible plan', { source: 'test' });

    const updated = await tool.execute({
      action: 'set_status',
      id: item.id.slice(0, 8),
      status: 'in_progress',
    });

    expect(updated.success).toBe(true);
    expect(updated.output).toContain('in progress');
    expect(store.listItems()[0]?.status).toBe('in_progress');

    const detail = await tool.execute({ action: 'get', id: item.id });
    expect(detail.success).toBe(true);
    expect(detail.output).toContain('Review visible plan');
    expect(detail.output).toContain('source=test');
  });

  test('updates title owner and notes', async () => {
    const store = makeStore();
    const tool = createAgentWorkPlanTool(store);
    const item = store.addItem('Old title');

    const updated = await tool.execute({
      action: 'update',
      id: item.id,
      title: 'New title',
      owner: 'operator',
      notes: 'Visible update from the main conversation.',
    });

    expect(updated.success).toBe(true);
    const next = store.listItems()[0]!;
    expect(next.title).toBe('New title');
    expect(next.owner).toBe('operator');
    expect(next.notes).toBe('Visible update from the main conversation.');
  });

  test('requires confirmation and explicit request before removing work plan items', async () => {
    const store = makeStore();
    const tool = createAgentWorkPlanTool(store);
    const item = store.addItem('Do not remove silently');

    const withoutRequest = await tool.execute({
      action: 'remove',
      id: item.id,
      confirm: true,
    });
    expect(withoutRequest.success).toBe(false);
    expect(withoutRequest.error).toContain('explicitUserRequest is required');
    expect(store.listItems()).toHaveLength(1);

    const preview = await tool.execute({
      action: 'remove',
      id: item.id,
      confirm: false,
      explicitUserRequest: 'Remove this work item.',
    });
    expect(preview.success).toBe(false);
    expect(preview.error).toContain('preview');
    expect(store.listItems()).toHaveLength(1);

    const removed = await tool.execute({
      action: 'remove',
      id: item.id,
      confirm: true,
      explicitUserRequest: 'Remove this work item.',
    });
    expect(removed.success).toBe(true);
    expect(store.listItems()).toHaveLength(0);
  });

  test('requires confirmation before clearing completed work', async () => {
    const store = makeStore();
    const tool = createAgentWorkPlanTool(store);
    const done = store.addItem('Done item', { status: 'done' });
    store.addItem('Pending item');

    const preview = await tool.execute({
      action: 'clear_completed',
      confirm: false,
      explicitUserRequest: 'Clear completed work.',
    });
    expect(preview.success).toBe(false);
    expect(store.listItems()).toHaveLength(2);

    const cleared = await tool.execute({
      action: 'clear_completed',
      confirm: true,
      explicitUserRequest: 'Clear completed work.',
    });
    expect(cleared.success).toBe(true);
    expect(cleared.output).toContain('Cleared 1');
    expect(store.listItems().map((item) => item.id)).not.toContain(done.id);
    expect(store.listItems()).toHaveLength(1);
  });

  test('is registered in the model tool registry', () => {
    const registry = new ToolRegistry();

    registerAgentWorkPlanTool(registry, makeStore());

    expect(registry.has('agent_work_plan')).toBe(true);
  });
});
