import type { ConversationManager } from '../core/conversation';
import type { PermissionRequest } from '@pellux/goodvibes-sdk/platform/permissions';
import type { SessionSnapshot } from '@/runtime/index.ts';
import type { SystemMessageRouter } from '../core/system-message-router.ts';
import { readConversationMessageSnapshots } from '../core/conversation-message-snapshot.ts';
import { answerWorkspaceRegistrationPrompt, type StoreShellPaths } from '../config/workspace-registration.ts';

export type PendingPermissionState = PermissionRequest & {
  resolve: (approved: boolean, remember?: boolean) => void;
};

/**
 * First-start registration prompt (owner-approved design): the root that was
 * offered, and the shellPaths needed to answer it (register or decline)
 * against the shared registration store without threading a separate
 * callback through every caller — see answerWorkspaceRegistrationPrompt.
 */
export type PendingWorkspaceRegistrationState = {
  readonly root: string;
  readonly shellPaths: StoreShellPaths;
};

export type BlockingInputHandlerOptions = {
  data: string;
  pendingPermission: PendingPermissionState | null;
  recoveryPending: boolean;
  pendingWorkspaceRegistration: PendingWorkspaceRegistrationState | null;
  abortTurn: () => void;
  conversation: ConversationManager;
  systemMessageRouter: SystemMessageRouter;
  render: () => void;
  loadRecoveryConversation: () => SessionSnapshot | null;
  deleteRecoveryFile: () => void;
};

export type BlockingInputHandlerResult = {
  handled: boolean;
  pendingPermission: PendingPermissionState | null;
  recoveryPending: boolean;
  pendingWorkspaceRegistration: PendingWorkspaceRegistrationState | null;
};

export function handleBlockingShellInput(
  options: BlockingInputHandlerOptions,
): BlockingInputHandlerResult {
  const {
    data,
    pendingPermission,
    recoveryPending,
    pendingWorkspaceRegistration,
    abortTurn,
    conversation,
    systemMessageRouter,
    render,
    loadRecoveryConversation,
    deleteRecoveryFile,
  } = options;

  if (pendingPermission) {
    const req = pendingPermission;
    const key = data.toLowerCase().trim();

    if (key === 'y') {
      req.resolve(true, false);
      render();
      return { handled: true, pendingPermission: null, recoveryPending, pendingWorkspaceRegistration };
    }

    if (key === 'a') {
      req.resolve(true, true);
      render();
      return { handled: true, pendingPermission: null, recoveryPending, pendingWorkspaceRegistration };
    }

    if (key === 'n' || data === '\x1b' || data === '\x03') {
      req.resolve(false, false);
      abortTurn();
      render();
      return { handled: true, pendingPermission: null, recoveryPending, pendingWorkspaceRegistration };
    }

    render();
    return { handled: true, pendingPermission, recoveryPending, pendingWorkspaceRegistration };
  }

  if (recoveryPending) {
    if (data === '\x12') {
      const recovery = loadRecoveryConversation();
      if (recovery) {
        conversation.fromJSON({ messages: readConversationMessageSnapshots(recovery.messages) });
        systemMessageRouter.high('[Recovery] Session restored.');
      } else {
        systemMessageRouter.high('[Recovery] Failed to restore saved data.');
      }
      deleteRecoveryFile();
      render();
      return { handled: true, pendingPermission: null, recoveryPending: false, pendingWorkspaceRegistration };
    }

    if (data === '\x1b' || data === '\x03') {
      systemMessageRouter.high('[Recovery] Discarded recovery data.');
      deleteRecoveryFile();
      render();
      return { handled: true, pendingPermission: null, recoveryPending: false, pendingWorkspaceRegistration };
    }

    systemMessageRouter.high('[Recovery] Ignored saved session; starting a new prompt.');
    deleteRecoveryFile();
    render();
    return { handled: false, pendingPermission: null, recoveryPending: false, pendingWorkspaceRegistration };
  }

  // First-start registration prompt: 'y' registers, EVERY other key (Escape,
  // Enter-through, Ctrl+C, any stray key) declines — default no, matching the
  // owner-approved design. Subtree-scoped: never asks again at this root
  // either way, since both add() and decline() are recorded against it.
  if (pendingWorkspaceRegistration) {
    const { root, shellPaths } = pendingWorkspaceRegistration;
    const accepted = data.toLowerCase().trim() === 'y';
    answerWorkspaceRegistrationPrompt(shellPaths, root, accepted);
    systemMessageRouter.high(accepted
      ? `[Workspace] Registered ${root} — automatic checkpoints are now allowed here.`
      : `[Workspace] Not registered — automatic checkpoints stay off here (won't ask again for this location).`);
    render();
    return { handled: true, pendingPermission: null, recoveryPending, pendingWorkspaceRegistration: null };
  }

  return { handled: false, pendingPermission, recoveryPending, pendingWorkspaceRegistration };
}
