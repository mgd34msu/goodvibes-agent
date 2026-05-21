import { describe, expect, test } from 'bun:test';
import {
  classifyPrompt,
  evaluateActionPolicy,
  explicitlyRequestsWrfc,
  isBuildLikeRequest,
  routeRequiresApproval,
} from '../src/assistant/policy.js';

describe('assistant policy', () => {
  test('ordinary asks are safe', () => {
    expect(classifyPrompt('what is my current work plan').requiresApproval).toBe(false);
    const decision = evaluateActionPolicy('summarize my current work plan');
    expect(decision.category).toBe('safe_read');
    expect(decision.allowedAutomatically).toBe(true);
  });

  test('destructive prompts require approval', () => {
    const decision = classifyPrompt('delete the automation schedule');
    expect(decision.risk).toBe('dangerous');
    expect(decision.requiresApproval).toBe(true);
    const policy = evaluateActionPolicy('delete the automation schedule');
    expect(policy.category).toBe('delete');
    expect(policy.audit).toContain('approval:required');
  });

  test('local memory is safe unless secrets are present', () => {
    expect(evaluateActionPolicy('remember that we use Bun').category).toBe('local_memory');
    const secret = evaluateActionPolicy('remember my api key is abc123');
    expect(secret.category).toBe('secret');
    expect(secret.requiresApproval).toBe(true);
  });

  test('build requests are detected without implying WRFC', () => {
    expect(isBuildLikeRequest('build the assistant inbox')).toBe(true);
    expect(evaluateActionPolicy('build the assistant inbox').category).toBe('build_delegation');
    expect(explicitlyRequestsWrfc('build the assistant inbox')).toBe(false);
    expect(explicitlyRequestsWrfc('build this with wrfc')).toBe(true);
  });

  test('workspace writes and external effects require approval', () => {
    expect(evaluateActionPolicy('write file ./config.json').requiresApproval).toBe(true);
    expect(evaluateActionPolicy('send this email').category).toBe('external_side_effect');
    expect(evaluateActionPolicy('npm install left-pad').category).toBe('package_install');
  });

  test('dangerous routes require approval', () => {
    expect(routeRequiresApproval('automation.jobs.delete')).toBe(true);
    expect(routeRequiresApproval('knowledge.ask')).toBe(false);
  });
});
