import { describe, expect, test } from 'bun:test';
import {
  classifyPrompt,
  explicitlyRequestsWrfc,
  isBuildLikeRequest,
  routeRequiresApproval,
} from '../src/assistant/policy.js';

describe('assistant policy', () => {
  test('ordinary asks are safe', () => {
    expect(classifyPrompt('what is my current work plan').requiresApproval).toBe(false);
  });

  test('destructive prompts require approval', () => {
    const decision = classifyPrompt('delete the automation schedule');
    expect(decision.risk).toBe('dangerous');
    expect(decision.requiresApproval).toBe(true);
  });

  test('build requests are detected without implying WRFC', () => {
    expect(isBuildLikeRequest('build the assistant inbox')).toBe(true);
    expect(explicitlyRequestsWrfc('build the assistant inbox')).toBe(false);
    expect(explicitlyRequestsWrfc('build this with wrfc')).toBe(true);
  });

  test('dangerous routes require approval', () => {
    expect(routeRequiresApproval('automation.jobs.delete')).toBe(true);
    expect(routeRequiresApproval('knowledge.ask')).toBe(false);
  });
});
