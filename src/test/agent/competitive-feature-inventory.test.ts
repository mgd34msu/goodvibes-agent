import { describe, expect, test } from 'bun:test';
import {
  COMPETITIVE_FEATURE_INVENTORY,
  competitiveInventoryStatusCounts,
  type CompetitorId,
} from '../../agent/competitive-feature-inventory.ts';

const REQUIRED_COMPETITORS: readonly CompetitorId[] = ['openclaw', 'hermes', 'odysseus'];

describe('competitive feature inventory', () => {
  test('covers every named competitor with user-outcome evidence', () => {
    const competitors = new Set(
      COMPETITIVE_FEATURE_INVENTORY.flatMap((item) => item.competitorSignals.map((signal) => signal.competitor)),
    );

    for (const competitor of REQUIRED_COMPETITORS) {
      expect(competitors.has(competitor)).toBe(true);
    }
  });

  test('keeps every inventory row actionable and user-first', () => {
    expect(COMPETITIVE_FEATURE_INVENTORY.length).toBeGreaterThanOrEqual(12);

    for (const item of COMPETITIVE_FEATURE_INVENTORY) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect(item.userOutcome.length).toBeGreaterThan(40);
      expect(item.bestInClassRequirement.length).toBeGreaterThan(40);
      expect(item.goodVibesNow.length).toBeGreaterThan(40);
      expect(item.nextMoves.length).toBeGreaterThanOrEqual(2);
      expect(item.competitorSignals.length).toBeGreaterThanOrEqual(2);
      expect(item.owners.length).toBeGreaterThanOrEqual(1);

      for (const move of item.nextMoves) {
        expect(move.length).toBeGreaterThan(24);
      }
      for (const signal of item.competitorSignals) {
        expect(REQUIRED_COMPETITORS.includes(signal.competitor)).toBe(true);
        expect(signal.evidence.length).toBeGreaterThan(24);
      }
    }
  });

  test('keeps the inventory honest: status counts are evidence-backed, not inflated', () => {
    const counts = competitiveInventoryStatusCounts();

    // Status distribution must add up to the full inventory.
    expect(counts.leading + counts.parity + counts.partial + counts.gap).toBe(COMPETITIVE_FEATURE_INVENTORY.length);

    // Partial and gap items are allowed and expected; they must all have actionable nextMoves.
    for (const item of COMPETITIVE_FEATURE_INVENTORY) {
      if (item.goodVibesStatus === 'partial' || item.goodVibesStatus === 'gap') {
        expect(item.nextMoves.length).toBeGreaterThanOrEqual(2);
        // nextMoves must not say "none", every gap must have a build path.
        expect(item.nextMoves.join('\n')).not.toMatch(/\bnone\b/i);
      }
    }

    // Leading items must be in the minority, if everything is leading, nothing is.
    expect(counts.leading).toBeLessThan(COMPETITIVE_FEATURE_INVENTORY.length);

    // At least some items must be less than leading, the inventory should be honest.
    expect(counts.partial + counts.gap).toBeGreaterThan(0);
  });
});
