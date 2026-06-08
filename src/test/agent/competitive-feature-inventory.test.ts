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

  test('keeps the release inventory closed without hidden partials or gaps', () => {
    const counts = competitiveInventoryStatusCounts();
    expect(counts.partial).toBe(0);
    expect(counts.gap).toBe(0);
    expect(counts.leading + counts.parity).toBe(COMPETITIVE_FEATURE_INVENTORY.length);
    expect(counts.leading).toBeGreaterThan(counts.parity);
    expect(counts.leading + counts.parity + counts.partial + counts.gap).toBe(COMPETITIVE_FEATURE_INVENTORY.length);

    for (const item of COMPETITIVE_FEATURE_INVENTORY) {
      expect(item.nextMoves.join('\n')).not.toMatch(/\bnone\b/i);
    }
  });
});
