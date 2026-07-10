import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShellPathService } from '@/runtime/index.ts';
import { createWorkspaceRegistrationStore } from '../../config/workspace-registration.ts';

import { handleBlockingShellInput, type PendingPermissionState } from '../../shell/blocking-input.ts';

function makeWorkspaceRegistrationShellPaths() {
  const home = mkdtempSync(join(tmpdir(), 'gv-agent-blocking-input-'));
  const work = mkdtempSync(join(tmpdir(), 'gv-agent-blocking-input-work-'));
  return { shellPaths: createShellPathService({ workingDirectory: work, homeDirectory: home }), work };
}

async function pollUntil(predicate: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 25): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function makeConversation() {
  const restored: Array<Record<string, unknown>>[] = [];
  return {
    restored,
    conversation: {
      fromJSON: ({ messages }: { messages: Array<Record<string, unknown>> }) => {
        restored.push(messages);
      },
    },
  };
}

function makeRouter() {
  const messages: string[] = [];
  return {
    messages,
    router: {
      high: (text: string) => messages.push(text),
    },
  };
}

describe('shell/blocking-input', () => {
  test('approves pending permission on y', () => {
    const resolved: Array<[boolean, boolean | undefined]> = [];
    const { conversation } = makeConversation();
    const { router } = makeRouter();
    let rendered = 0;
    let aborted = 0;

    const pendingPermission = {
      id: 'perm-1',
      toolName: 'write',
      reason: 'Need approval',
      resolve: (approved: boolean, remember?: boolean) => {
        resolved.push([approved, remember]);
      },
    } as unknown as PendingPermissionState;

    const result = handleBlockingShellInput({
      data: 'y',
      pendingPermission,
      recoveryPending: false,
      pendingWorkspaceRegistration: null,
      abortTurn: () => { aborted++; },
      conversation: conversation as never,
      systemMessageRouter: router as never,
      render: () => { rendered++; },
      loadRecoveryConversation: () => null,
      deleteRecoveryFile: () => {},
    });

    expect(result.handled).toBe(true);
    expect(result.pendingPermission).toBeNull();
    expect(resolved).toEqual([[true, false]]);
    expect(aborted).toBe(0);
    expect(rendered).toBe(1);
  });

  test('denies pending permission on escape and aborts turn', () => {
    const resolved: Array<[boolean, boolean | undefined]> = [];
    const { conversation } = makeConversation();
    const { router } = makeRouter();
    let rendered = 0;
    let aborted = 0;

    const pendingPermission = {
      id: 'perm-2',
      toolName: 'write',
      reason: 'Need approval',
      resolve: (approved: boolean, remember?: boolean) => {
        resolved.push([approved, remember]);
      },
    } as unknown as PendingPermissionState;

    const result = handleBlockingShellInput({
      data: '\x1b',
      pendingPermission,
      recoveryPending: false,
      pendingWorkspaceRegistration: null,
      abortTurn: () => { aborted++; },
      conversation: conversation as never,
      systemMessageRouter: router as never,
      render: () => { rendered++; },
      loadRecoveryConversation: () => null,
      deleteRecoveryFile: () => {},
    });

    expect(result.handled).toBe(true);
    expect(result.pendingPermission).toBeNull();
    expect(resolved).toEqual([[false, false]]);
    expect(aborted).toBe(1);
    expect(rendered).toBe(1);
  });

  test('restores recovery snapshot on ctrl-r', () => {
    const { conversation, restored } = makeConversation();
    const { router, messages } = makeRouter();
    let deleted = 0;
    let rendered = 0;

    const result = handleBlockingShellInput({
      data: '\x12',
      pendingPermission: null,
      recoveryPending: true,
      pendingWorkspaceRegistration: null,
      abortTurn: () => {},
      conversation: conversation as never,
      systemMessageRouter: router as never,
      render: () => { rendered++; },
      loadRecoveryConversation: () => ({
        messages: [{ role: 'user', content: 'restored' }],
      }),
      deleteRecoveryFile: () => { deleted++; },
    });

    expect(result.handled).toBe(true);
    expect(result.recoveryPending).toBe(false);
    expect(restored).toEqual([[{ role: 'user', content: 'restored' }]]);
    expect(messages).toContain('[Recovery] Session restored.');
    expect(deleted).toBe(1);
    expect(rendered).toBe(1);
  });

  test('passes normal typing through while dismissing recovery', () => {
    const { conversation, restored } = makeConversation();
    const { router, messages } = makeRouter();
    let deleted = 0;
    let rendered = 0;

    const result = handleBlockingShellInput({
      data: 'h',
      pendingPermission: null,
      recoveryPending: true,
      pendingWorkspaceRegistration: null,
      abortTurn: () => {},
      conversation: conversation as never,
      systemMessageRouter: router as never,
      render: () => { rendered++; },
      loadRecoveryConversation: () => ({
        messages: [{ role: 'user', content: 'restored' }],
      }),
      deleteRecoveryFile: () => { deleted++; },
    });

    expect(result.handled).toBe(false);
    expect(result.recoveryPending).toBe(false);
    expect(restored).toEqual([]);
    expect(messages).toContain('[Recovery] Ignored saved session; starting a new prompt.');
    expect(deleted).toBe(1);
    expect(rendered).toBe(1);
  });

  test('discards recovery on escape without passing escape to input', () => {
    const { conversation, restored } = makeConversation();
    const { router, messages } = makeRouter();
    let deleted = 0;
    let rendered = 0;

    const result = handleBlockingShellInput({
      data: '\x1b',
      pendingPermission: null,
      recoveryPending: true,
      pendingWorkspaceRegistration: null,
      abortTurn: () => {},
      conversation: conversation as never,
      systemMessageRouter: router as never,
      render: () => { rendered++; },
      loadRecoveryConversation: () => ({
        messages: [{ role: 'user', content: 'restored' }],
      }),
      deleteRecoveryFile: () => { deleted++; },
    });

    expect(result.handled).toBe(true);
    expect(result.recoveryPending).toBe(false);
    expect(restored).toEqual([]);
    expect(messages).toContain('[Recovery] Discarded recovery data.');
    expect(deleted).toBe(1);
    expect(rendered).toBe(1);
  });

  test('registers the workspace on y and clears the pending prompt', async () => {
    const { conversation } = makeConversation();
    const { router, messages } = makeRouter();
    const { shellPaths, work } = makeWorkspaceRegistrationShellPaths();
    let rendered = 0;

    const result = handleBlockingShellInput({
      data: 'y',
      pendingPermission: null,
      recoveryPending: false,
      pendingWorkspaceRegistration: { root: work, shellPaths },
      abortTurn: () => {},
      conversation: conversation as never,
      systemMessageRouter: router as never,
      render: () => { rendered++; },
      loadRecoveryConversation: () => null,
      deleteRecoveryFile: () => {},
    });

    expect(result.handled).toBe(true);
    expect(result.pendingWorkspaceRegistration).toBeNull();
    expect(messages.some((m) => m.includes('Registered') && m.includes(work))).toBe(true);
    expect(rendered).toBe(1);

    const store = createWorkspaceRegistrationStore(shellPaths);
    const registered = await pollUntil(async () => (await store.resolve(work)).status === 'covered');
    expect(registered).toBe(true);
  });

  test('declines the workspace on any key other than y (default no), including Escape', async () => {
    const { conversation } = makeConversation();
    const { router, messages } = makeRouter();
    const { shellPaths, work } = makeWorkspaceRegistrationShellPaths();
    let rendered = 0;

    const result = handleBlockingShellInput({
      data: '\x1b',
      pendingPermission: null,
      recoveryPending: false,
      pendingWorkspaceRegistration: { root: work, shellPaths },
      abortTurn: () => {},
      conversation: conversation as never,
      systemMessageRouter: router as never,
      render: () => { rendered++; },
      loadRecoveryConversation: () => null,
      deleteRecoveryFile: () => {},
    });

    expect(result.handled).toBe(true);
    expect(result.pendingWorkspaceRegistration).toBeNull();
    expect(messages.some((m) => m.includes('Not registered'))).toBe(true);
    expect(rendered).toBe(1);

    const store = createWorkspaceRegistrationStore(shellPaths);
    const declined = await pollUntil(async () => (await store.resolve(work)).status === 'declined');
    expect(declined).toBe(true);
  });
});
