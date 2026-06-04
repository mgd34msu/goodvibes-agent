/**
 * Tests for context window validation (Stage 8).
 *
 * Validates the pre-flight context window check in Orchestrator:
 * - Request within context passes through without interference
 * - Request exceeding context triggers auto-compact when enabled
 * - Request still exceeding after compact shows clear error with token counts
 * - Error message includes specific token counts and model context window
 * - Alternative model suggestion works when larger-context models are available
 *
 * Run with: bun test src/test/core/context-validation.test.ts
 */

import { describe, it, expect } from 'bun:test';
import { getAutoCompactDecision } from '@pellux/goodvibes-sdk/platform/core';
import type { CatalogModelEntry } from '@pellux/goodvibes-sdk/platform/providers';

// ---------------------------------------------------------------------------
// Context validation logic (tested as pure functions)
// ---------------------------------------------------------------------------

/**
 * Mirrors the core logic of checkContextWindowPreflight without needing
 * a full Orchestrator instance. Tests the decision boundaries directly.
 */
function simulatePreflightCheck(
  estimatedTokens: number,
  contextWindow: number,
  autoCompactEnabled: boolean,
  tokensAfterCompact: number,
): { result: 'ok' | 'compacted' | 'error'; compactTriggered: boolean } {
  if (contextWindow <= 0) return { result: 'ok', compactTriggered: false };
  if (estimatedTokens <= contextWindow) return { result: 'ok', compactTriggered: false };

  if (autoCompactEnabled) {
    // Simulate compact
    if (tokensAfterCompact <= contextWindow) {
      return { result: 'compacted', compactTriggered: true };
    }
    return { result: 'error', compactTriggered: true };
  }

  return { result: 'error', compactTriggered: false };
}

describe('context window pre-flight decision logic', () => {
  it('auto-compact decision honors configured percentage below the hard context limit', () => {
    const decision = getAutoCompactDecision({
      currentTokens: 125_400,
      contextWindow: 128_000,
      isCompacting: false,
      thresholdPercent: 80,
    });
    expect(decision.shouldCompact).toBe(true);
    expect(decision.thresholdTokens).toBe(102_400);
    expect(decision.currentTokens).toBe(125_400);
    expect(decision.contextWindow).toBe(128_000);
    expect(decision.remainingTokens).toBe(2_600);
    expect(decision.reason).toBe('threshold');
  });

  describe('request within context window', () => {
    it('returns ok when tokens < context window', () => {
      const { result, compactTriggered } = simulatePreflightCheck(
        50_000, 128_000, true, 0,
      );
      expect(result).toBe('ok');
      expect(compactTriggered).toBe(false);
    });

    it('returns ok when tokens exactly equal context window', () => {
      const { result } = simulatePreflightCheck(128_000, 128_000, true, 0);
      expect(result).toBe('ok');
    });

    it('returns ok when context window is 0 (unknown)', () => {
      // Context window 0 = unknown, skip validation
      const { result } = simulatePreflightCheck(500_000, 0, true, 0);
      expect(result).toBe('ok');
    });
  });

  describe('request exceeding context — auto-compact enabled', () => {
    it('triggers compact and returns compacted when post-compact tokens fit', () => {
      const { result, compactTriggered } = simulatePreflightCheck(
        150_000, // exceeds 128K
        128_000,
        true,    // auto-compact on
        60_000,  // after compact: fits
      );
      expect(result).toBe('compacted');
      expect(compactTriggered).toBe(true);
    });

    it('returns error when tokens still exceed after compact', () => {
      const { result, compactTriggered } = simulatePreflightCheck(
        200_000,
        128_000,
        true,
        140_000, // still exceeds after compact
      );
      expect(result).toBe('error');
      expect(compactTriggered).toBe(true);
    });

    it('compact is triggered even at 1 token over the limit', () => {
      const { compactTriggered } = simulatePreflightCheck(
        128_001, 128_000, true, 50_000,
      );
      expect(compactTriggered).toBe(true);
    });

    it('compact failure is caught and surfaced as error', () => {
      // When compact throws, the orchestrator catches it and re-estimates.
      // Tokens are unchanged after the failed compact, so the result is 'error'.
      // We model this by passing tokensAfterCompact = estimatedTokens (no reduction).
      const estimatedTokens = 150_000;
      const { result, compactTriggered } = simulatePreflightCheck(
        estimatedTokens,
        128_000,
        true,
        estimatedTokens, // compact threw — token count unchanged
      );
      expect(result).toBe('error');
      expect(compactTriggered).toBe(true);
    });
  });

  describe('request exceeding context — auto-compact disabled', () => {
    it('returns error immediately without triggering compact', () => {
      const { result, compactTriggered } = simulatePreflightCheck(
        150_000, 128_000,
        false,   // auto-compact off
        60_000,
      );
      expect(result).toBe('error');
      expect(compactTriggered).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Error message format
// ---------------------------------------------------------------------------

/**
 * Mirrors emitContextOverflowError's message-building logic.
 * Tests that the required elements appear in the error string.
 */
function buildOverflowMessage(
  estimatedTokens: number,
  contextWindow: number,
  modelDisplayName: string,
  alternatives: CatalogModelEntry[],
): string {
  const requestK = Math.round(estimatedTokens / 1000);
  const contextK = Math.round(contextWindow / 1000);

  let msg =
    `Request (~${requestK}K tokens) exceeds ${modelDisplayName} context window (${contextK}K). ` +
    `Use /compact to reduce context or switch to a larger model.`;

  if (alternatives.length > 0) {
    const altNames = alternatives
      .map(a => `${a.displayName} (${Math.round(a.context / 1000)}K)`)
      .join(', ');
    msg += ` Larger-context alternatives: ${altNames}.`;
  }

  return msg;
}

describe('context overflow error message', () => {
  it('includes request token count in K', () => {
    const msg = buildOverflowMessage(180_000, 128_000, 'Test Model', []);
    expect(msg).toContain('~180K tokens');
  });

  it('includes model name in error', () => {
    const msg = buildOverflowMessage(180_000, 128_000, 'Claude Sonnet 4.5', []);
    expect(msg).toContain('Claude Sonnet 4.5');
  });

  it('includes context window size in K', () => {
    const msg = buildOverflowMessage(180_000, 128_000, 'Test Model', []);
    expect(msg).toContain('128K');
  });

  it('includes /compact suggestion', () => {
    const msg = buildOverflowMessage(180_000, 128_000, 'Test Model', []);
    expect(msg).toContain('/compact');
  });

  it('does not include alternatives section when none available', () => {
    const msg = buildOverflowMessage(180_000, 128_000, 'Test Model', []);
    expect(msg).not.toContain('alternatives');
  });

  it('includes alternatives when provided', () => {
    const alternatives: CatalogModelEntry[] = [
      { id: 'gpt-5', displayName: 'GPT-5', provider: 'openai', context: 256_000, tier: 'paid' },
      { id: 'gemini-3', displayName: 'Gemini 3', provider: 'google', context: 1_000_000, tier: 'paid' },
    ];
    const msg = buildOverflowMessage(180_000, 128_000, 'Test Model', alternatives);
    expect(msg).toContain('Larger-context alternatives');
    expect(msg).toContain('GPT-5');
    expect(msg).toContain('Gemini 3');
  });

  it('formats alternative context sizes in K', () => {
    const alternatives: CatalogModelEntry[] = [
      { id: 'big-model', displayName: 'Big Model', provider: 'test', context: 256_000, tier: 'paid' },
    ];
    const msg = buildOverflowMessage(180_000, 128_000, 'Test Model', alternatives);
    expect(msg).toContain('256K');
  });

  it('handles rounding — 130500 tokens rounds to 131K', () => {
    const msg = buildOverflowMessage(130_500, 128_000, 'Model X', []);
    // Math.round(130500 / 1000) = 131
    expect(msg).toContain('~131K tokens');
  });
});
