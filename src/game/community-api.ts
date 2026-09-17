import type { PuzzleScores } from "./puzzle-scores";

/** Bump when scoring rules change; invalidates local confirmations and remote cohorts together. */
export const API_SCORING_VERSION = 1;
export const SCORE_METRICS = ["price", "cycles", "footprint", "combined"] as const;
export type ScoreMetric = (typeof SCORE_METRICS)[number];

export interface ScoreSubmission {
  readonly installationId: string;
  readonly puzzleId: string;
  /** SHA-256 of the exact serializeShippedPuzzle JSON, encoded as lowercase hex. */
  readonly puzzleRevision: string;
  readonly scoringVersion: typeof API_SCORING_VERSION;
  readonly scores: PuzzleScores;
}

export interface ScoreHistogramBucket {
  readonly value: number;
  readonly count: number;
}

export interface PuzzleHistograms {
  readonly puzzleId: string;
  readonly puzzleRevision: string;
  readonly scoringVersion: typeof API_SCORING_VERSION;
  readonly players: number;
  readonly metrics: { readonly [Metric in ScoreMetric]: readonly ScoreHistogramBucket[] };
}

export interface SharedPuzzleReceipt {
  /** SHA-256 of JSON.stringify(puzzle), independent of the authored puzzle slug. */
  readonly id: string;
}
