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
  /** The sessionId of the offered recovery snapshot, or null when none is pending. Callers key consumeRecovery/removeRecoveryPoint to this exact id — see BlockingInputHandlerResult.recoveryPending. */
  recoveryPending: string | null;
  pendingWorkspaceRegistration: PendingWorkspaceRegistrationState | null;
  abortTurn: () => void;
  conversation: ConversationManager;
  systemMessageRouter: SystemMessageRouter;
  render: () => void;
  /** The prompted "yes, resume it" primitive (SDK consumeRecovery): loads the recovery snapshot and retires its file in one operation, only once the load actually succeeds. The caller keys this to the offered snapshot's sessionId. */
  consumeRecovery: () => SessionSnapshot | null;
  /** The prompted "no, and remove it" primitive (SDK removeRecoveryPoint): clears the recovery snapshot without loading it. The caller keys this to the offered snapshot's sessionId. */
  removeRecoveryPoint: () => void;
};

export type BlockingInputHandlerResult = {
  handled: boolean;
  pendingPermission: PendingPermissionState | null;
  recoveryPending: string | null;
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
    consumeRecovery,
    removeRecoveryPoint,
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
      // consumeRecovery only retires the snapshot file once the load actually
      // succeeds — a bad read leaves it on disk instead of silently
      // destroying data that was never actually recovered.
      const recovery = consumeRecovery();
      if (recovery) {
        conversation.fromJSON({ messages: readConversationMessageSnapshots(recovery.messages) });
        systemMessageRouter.high('[Recovery] Session restored.');
      } else {
        systemMessageRouter.high('[Recovery] Failed to restore saved data.');
      }
      render();
      return { handled: true, pendingPermission: null, recoveryPending: null, pendingWorkspaceRegistration };
    }

    if (data === '\x1b' || data === '\x03') {
      systemMessageRouter.high('[Recovery] Discarded recovery data.');
      removeRecoveryPoint();
      render();
      return { handled: true, pendingPermission: null, recoveryPending: null, pendingWorkspaceRegistration };
    }

    systemMessageRouter.high('[Recovery] Ignored saved session; starting a new prompt.');
    removeRecoveryPoint();
    render();
    return { handled: false, pendingPermission: null, recoveryPending: null, pendingWorkspaceRegistration };
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
