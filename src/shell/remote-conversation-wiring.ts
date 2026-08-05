/**
 * remote-conversation-wiring.ts — the composer's one decision about WHERE a
 * turn runs.
 *
 * The router itself (runtime/client/remote-conversation.ts) knows how to open
 * and steer a daemon-hosted session and how to render it. This is the surface
 * half: what the composer does with the answer — mirror the user's message when
 * the daemon took the turn, and say one honest line when it did not.
 *
 * It lives beside main.ts rather than inside it so the composer keeps one call
 * where it used to have one call.
 */

import { createRemoteConversationRouter } from '../runtime/client/remote-conversation.ts';
import type { BootstrapContext } from '../runtime/bootstrap.ts';

export interface RemoteConversationWiringOptions {
  readonly render: () => void;
  /**
   * How a one-line notice reaches the person. The same channel the surface
   * already uses for the lines it must not bury.
   */
  readonly notify: (message: string) => void;
}

export interface RemoteConversationWiring {
  /**
   * Decide where this turn runs and act on it.
   *
   * Returns `true` when the connected daemon has the turn — the caller does
   * nothing more, because the turn now renders from the hosted session's event
   * stream. Returns `false` when the caller should run the turn locally, having
   * already told the person why.
   */
  routeOrExplain(text: string, hasAttachments: boolean): Promise<boolean>;
  dispose(): void;
}

export function installRemoteConversationRouting(
  ctx: BootstrapContext,
  options: RemoteConversationWiringOptions,
): RemoteConversationWiring {
  const conversation = ctx.conversation;
  const router = createRemoteConversationRouter({
    verbs: ctx.services.daemonVerbs,
    configManager: ctx.services.configManager,
    // The SAME resolution the verb caller uses, so this surface never calls one
    // daemon and streams from another.
    resolveConnection: () => ctx.services.resolveConnectedHost(),
    conversation,
    requestRender: options.render,
    // The hosted session's tools operate where this surface is working.
    workspaceRoot: ctx.services.workingDirectory,
    clientId: `goodvibes-agent:${ctx.runtime.sessionId}`,
  });

  return {
    routeOrExplain: async (text: string, hasAttachments: boolean): Promise<boolean> => {
      const outcome = await router.submit(text, { hasAttachments });
      if (outcome.routed) {
        // The daemon's transcript is authoritative; this is the local mirror,
        // and the user's own message is the one part of it the stream does not
        // send back (the daemon received it directly).
        conversation.addUserMessage(text);
        options.render();
        return true;
      }
      // Never silent. A turn that ran somewhere other than where the settings
      // say it should is exactly what the person needs told — unless running
      // here is what they asked for, in which case there is nothing to report.
      if (!outcome.chosen) {
        options.notify(`[Turn] ${outcome.reason}`);
        options.render();
      }
      return false;
    },
    dispose: () => router.dispose(),
  };
}
