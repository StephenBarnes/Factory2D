import type { PuzzleId } from "./puzzles";

export type AppScreen =
  | { readonly kind: "main-menu" }
  | { readonly kind: "sandbox-info" }
  | { readonly kind: "sandbox"; readonly sandboxId: string }
  | { readonly kind: "puzzle-info"; readonly puzzleId: PuzzleId }
  | { readonly kind: "puzzle"; readonly puzzleId: PuzzleId; readonly solutionId: string };

