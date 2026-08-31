import type { PuzzleId } from "./puzzles";

export type AppScreen =
  | { readonly kind: "main-menu" }
  | { readonly kind: "sandbox" }
  | { readonly kind: "puzzle"; readonly puzzleId: PuzzleId };

// Keep development booting directly into the sandbox. Change this one value when
// the main menu is ready to become the production entry point.
export const INITIAL_SCREEN: AppScreen = { kind: "sandbox" };
