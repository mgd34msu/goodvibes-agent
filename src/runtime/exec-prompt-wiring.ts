/**
 * Fork-mirror of the SDK's exec PTY prompt-answer wiring
 * (platform/runtime/permissions/exec-prompt-wiring.ts — the builder has no
 * public export path; every type it composes over does). The Agent forks the
 * SDK's runtime composition root, so it wires the same seam: a running
 * command that stops on a terminal prompt (host-key confirmation, credential
 * ask) reaches the human through the SAME approval broker as a permission
 * ask. The approving surface supplies the typed reply via the decision's
 * `modifiedArgs.answer`, which feeds the same continuing run; deny — or an
 * answer-less approval, nothing is ever fabricated — declines the prompt and
 * the run stops honestly. Keep the request shape byte-faithful to the SDK's
 * so every surface renders exec prompts identically.
 */
import { randomUUID } from 'node:crypto';
import type { PermissionPromptDecision, PermissionPromptRequest } from '@pellux/goodvibes-sdk/platform/permissions';
import type { ExecPromptAsk, ExecPromptAnswer } from '@pellux/goodvibes-sdk/platform/tools';

/** The prompt-answer handler the exec tool's interactive runner invokes. */
export type AgentExecPromptAnswerHandler = (ask: ExecPromptAsk) => Promise<ExecPromptAnswer>;

/** The broker seam this wiring routes through. */
export interface AgentExecPromptWiringDeps {
  readonly requestApproval: (input: {
    readonly request: PermissionPromptRequest;
    readonly metadata?: Record<string, unknown> | undefined;
  }) => Promise<PermissionPromptDecision>;
}

/**
 * Build the exec prompt-answer handler: the pending prompt rides the approval
 * broker as an `execute`-category ask. Approval with a string
 * `modifiedArgs.answer` feeds that text to the waiting child; approval
 * without one, or denial, declines the prompt (the runner then stops the run
 * with the prompt text on the honest result).
 */
export function buildAgentExecPromptAnswerHandler(deps: AgentExecPromptWiringDeps): AgentExecPromptAnswerHandler {
  return async (ask) => {
    const request: PermissionPromptRequest = {
      callId: `exec-prompt-${randomUUID().slice(0, 8)}`,
      tool: 'exec:prompt',
      args: {
        command: ask.command,
        prompt: ask.prompt,
        recentOutput: ask.recentOutput,
      },
      category: 'execute',
      analysis: {
        classification: 'exec-terminal-prompt',
        riskLevel: 'medium',
        summary: `A running command is waiting on its terminal: ${ask.prompt}`,
        reasons: [
          `The command \`${ask.command}\` stopped on a terminal prompt.`,
          'Approving sends your typed answer to the waiting command; declining stops the run.',
        ],
        surface: 'shell',
        blastRadius: 'project',
      },
      ...(ask.workingDirectory ? { workingDirectory: ask.workingDirectory } : {}),
      attribution: { kind: 'exec-prompt', command: ask.command, prompt: ask.prompt },
    };
    const decision = await deps.requestApproval({
      request,
      metadata: { source: 'exec-prompt', command: ask.command },
    });
    if (!decision.approved) return { answered: false };
    const answer = decision.modifiedArgs?.['answer'];
    // Never fabricate a reply the human did not type: an approval that carries
    // no text is a decline in practice, reported honestly.
    if (typeof answer !== 'string') return { answered: false };
    return { answered: true, text: answer };
  };
}
