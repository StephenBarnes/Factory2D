import type { ScoreHistogramBucket } from "./community-api";
import type { PuzzleScores } from "./puzzle-scores";
import { expectDefined } from "../util/assert";

export type MineralRank = "coal" | "iron" | "gold" | "mithril";

export interface ScoreStanding {
  readonly percentile: number;
  readonly mineral: MineralRank;
  readonly better: number;
  readonly tied: number;
  readonly players: number;
}

/** Lower scores win; everyone tied at a score receives the inclusive percentile. */
export function scoreStanding(
  frequencies: readonly ScoreHistogramBucket[],
  score: number,
): ScoreStanding | null {
  let players = 0;
  let better = 0;
  let tied = 0;
  for (const bucket of frequencies) {
    players += bucket.count;
    if (bucket.value < score) {
      better += bucket.count;
    } else if (bucket.value === score) {
      tied += bucket.count;
    }
  }
  if (players === 0) return null;

  const percentile = 100 * (players - better) / players;
  const mineral: MineralRank = percentile >= 75 ? "mithril"
    : percentile >= 50 ? "gold"
      : percentile >= 25 ? "iron" : "coal";
  return { percentile, mineral, better, tied, players };
}

/** Display bins never affect the exact-score standings or add marker players. */
export function buildScoreHistogram(
  frequencies: readonly ScoreHistogramBucket[],
  markers: readonly number[],
): {
  minimum: number;
  maximum: number;
  bins: readonly { lower: number; upper: number; count: number }[];
} {
  if (frequencies.length === 0) return { minimum: 0, maximum: 0, bins: [] };

  let minimum = Infinity;
  let maximum = -Infinity;
  let players = 0;
  for (const bucket of frequencies) {
    minimum = Math.min(minimum, bucket.value);
    maximum = Math.max(maximum, bucket.value);
    players += bucket.count;
  }
  for (const marker of markers) {
    minimum = Math.min(minimum, marker);
    maximum = Math.max(maximum, marker);
  }
  if (minimum === maximum) {
    return { minimum, maximum, bins: [{ lower: minimum, upper: maximum, count: players }] };
  }

  const binCount = 12;
  const span = maximum - minimum;
  const bins: { lower: number; upper: number; count: number }[] = [];
  let lower = minimum;
  for (let index = 0; index < binCount; index += 1) {
    const upper = index === binCount - 1 ? maximum : minimum + span * ((index + 1) / binCount);
    bins.push({ lower, upper, count: 0 });
    lower = upper;
  }

  for (const bucket of frequencies) {
    // Compare the displayed edges rather than dividing by a rounded bin width.
    // Collapsed floating-point intervals stay empty; the final upper edge is inclusive.
    let index = 0;
    while (index < binCount - 1 && bucket.value >= expectDefined(bins[index], "histogram bin").upper) {
      index += 1;
    }
    expectDefined(bins[index], "histogram bin").count += bucket.count;
  }
  return { minimum, maximum, bins };
}

/** Independent minima, including the best actual combined score, across confirmed runs. */
export function bestPuzzleScores(scores: readonly (PuzzleScores | null)[]): PuzzleScores | null {
  let best: { price: number; cycles: number; footprint: number; combined: number } | null = null;
  for (const score of scores) {
    if (score === null) continue;
    if (best === null) {
      best = { ...score };
    } else {
      best.price = Math.min(best.price, score.price);
      best.cycles = Math.min(best.cycles, score.cycles);
      best.footprint = Math.min(best.footprint, score.footprint);
      best.combined = Math.min(best.combined, score.combined);
    }
  }
  return best;
}
