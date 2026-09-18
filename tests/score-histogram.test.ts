import { describe, expect, it } from "vitest";

import type { ScoreHistogramBucket } from "../src/game/community-api";
import {
  bestPuzzleScores,
  buildScoreHistogram,
  scoreStanding,
} from "../src/game/score-histogram";

describe("score standings", () => {
  const frequencies = [
    { value: 1, count: 4 },
    { value: 2, count: 6 },
    { value: 3, count: 10 },
    { value: 4, count: 20 },
  ];

  it.each([
    { score: 0.5, percentile: 100, mineral: "mithril", better: 0, tied: 0 },
    { score: 2, percentile: 90, mineral: "mithril", better: 4, tied: 6 },
    { score: 2.5, percentile: 75, mineral: "mithril", better: 10, tied: 0 },
    { score: 3, percentile: 75, mineral: "mithril", better: 10, tied: 10 },
    { score: 4, percentile: 50, mineral: "gold", better: 20, tied: 20 },
    { score: 4.5, percentile: 0, mineral: "coal", better: 40, tied: 0 },
  ])("ranks score $score using player-weighted inclusive ties", ({ score, ...standing }) => {
    expect(scoreStanding(frequencies, score)).toEqual({ ...standing, players: 40 });
  });

  it("does not round fractional scores into ties", () => {
    expect(scoreStanding([{ value: 7 / 3, count: 3 }], 7 / 3 + Number.EPSILON * 2)).toEqual({
      percentile: 0, mineral: "coal", better: 3, tied: 0, players: 3,
    });
  });

  it("gives every tied player the top rank and leaves empty cohorts unranked", () => {
    expect(scoreStanding([{ value: 7 / 3, count: 8 }], 7 / 3)).toEqual({
      percentile: 100, mineral: "mithril", better: 0, tied: 8, players: 8,
    });
    expect(scoreStanding([], 7 / 3)).toBeNull();
  });
});

describe("score histogram bins", () => {
  it("does not invent a cohort from local markers", () => {
    expect(buildScoreHistogram([], [2, 19])).toEqual({ minimum: 0, maximum: 0, bins: [] });
  });

  it("represents an all-equal domain without padding or dividing by zero", () => {
    expect(buildScoreHistogram([{ value: 7 / 3, count: 8 }], [7 / 3, 7 / 3])).toEqual({
      minimum: 7 / 3,
      maximum: 7 / 3,
      bins: [{ lower: 7 / 3, upper: 7 / 3, count: 8 }],
    });
  });

  it("keeps fractional cycles on the correct side of an edge", () => {
    const histogram = buildScoreHistogram([
      { value: 1.25, count: 2 },
      { value: 1.5 - Number.EPSILON, count: 3 },
      { value: 1.5, count: 5 },
      { value: 4.25, count: 7 },
    ], []);
    expect(histogram.bins.map((bin) => bin.count)).toEqual([5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7]);
    expect(histogram.bins.every((bin) => bin.upper - bin.lower === 0.25)).toBe(true);
    expect(histogram.bins.reduce((count, bin) => count + bin.count, 0)).toBe(17);
  });

  it("assigns rounded decimal edges to the following bin and includes the final upper edge", () => {
    const domain = [{ value: 0.1, count: 1 }, { value: 1.3, count: 1 }];
    const { bins } = buildScoreHistogram(domain, []);
    const frequencies = bins.map((bin, index) => ({ value: bin.lower, count: index + 1 }));
    frequencies.push({ value: 1.3, count: 13 });
    const histogram = buildScoreHistogram(frequencies, []);
    expect(histogram.bins.map((bin) => bin.count)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 25]);
    expect(histogram.bins.reduce((count, bin) => count + bin.count, 0)).toBe(91);
  });

  it("expands a singleton cohort to include both outside markers without adding players", () => {
    const histogram = buildScoreHistogram([{ value: 6, count: 9 }], [0, 12]);
    expect(histogram.minimum).toBe(0);
    expect(histogram.maximum).toBe(12);
    expect(histogram.bins.map((bin) => bin.count)).toEqual([0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0]);
  });

  it.each([
    [0, Number.MAX_SAFE_INTEGER / 2, Number.MAX_SAFE_INTEGER],
    [Number.MAX_SAFE_INTEGER - 2, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER],
  ])("conserves counts within representable intervals for large scores %j", (...values) => {
    const frequencies: ScoreHistogramBucket[] = values.map((value, index) => ({ value, count: index + 1 }));
    const { bins } = buildScoreHistogram(frequencies, []);
    expect(bins).toHaveLength(12);
    for (const [index, bin] of bins.entries()) {
      expect(Number.isFinite(bin.lower) && Number.isFinite(bin.upper)).toBe(true);
      expect(bin.lower).toBeLessThanOrEqual(bin.upper);
      const members = frequencies.filter(({ value }) => value >= bin.lower &&
        (value < bin.upper || (index === bins.length - 1 && value === bin.upper)));
      expect(bin.count).toBe(members.reduce((count, bucket) => count + bucket.count, 0));
    }
    expect(bins.reduce((count, bin) => count + bin.count, 0)).toBe(6);
  });
});

describe("best local puzzle scores", () => {
  it("retains independent minima without synthesizing an unattained combined score", () => {
    const scores = [
      Object.freeze({ price: 1, cycles: 20.5, footprint: 8, combined: 29.5 }),
      Object.freeze({ price: 8, cycles: 2.5, footprint: 5, combined: 15.5 }),
      Object.freeze({ price: 4, cycles: 10.5, footprint: 1, combined: 15.5 }),
    ];
    expect(bestPuzzleScores([null, ...scores, null])).toEqual({
      price: 1, cycles: 2.5, footprint: 1, combined: 15.5,
    });
  });

  it("does not claim best scores when no solution has a confirmed result", () => {
    expect(bestPuzzleScores([])).toBeNull();
    expect(bestPuzzleScores([null, null])).toBeNull();
  });
});
