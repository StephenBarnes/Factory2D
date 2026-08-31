import type { PuzzleId } from "./puzzles";

export type AppScreen =
  | { readonly kind: "main-menu" }
  | { readonly kind: "puzzle-info"; readonly puzzleId: PuzzleId }
  | { readonly kind: "sandbox" }
  | { readonly kind: "puzzle"; readonly puzzleId: PuzzleId; readonly solutionId: string };

