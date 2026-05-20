import { createId } from '../utils/ids.js';

export type AgentMessageRole = 'user' | 'assistant' | 'system';

export interface AgentMessage {
  readonly id: string;
  readonly role: AgentMessageRole;
  readonly body: string;
  readonly createdAt: number;
}

export interface AgentSessionState {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messages: readonly AgentMessage[];
}

export function createAgentSession(title = 'GoodVibes Agent'): AgentSessionState {
  const now = Date.now();
  return {
    id: createId('agent_session'),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function appendMessage(
  state: AgentSessionState,
  role: AgentMessageRole,
  body: string,
): AgentSessionState {
  const now = Date.now();
  return {
    ...state,
    updatedAt: now,
    messages: [
      ...state.messages,
      {
        id: createId('msg'),
        role,
        body,
        createdAt: now,
      },
    ],
  };
}
