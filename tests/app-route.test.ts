import { describe, expect, it } from "vitest";

import {
  appScreenPath,
  resolveAppPath,
  resolveAppScreen,
  type AppRouteAccess,
} from "../src/game/app-route";
import type { PuzzleId } from "../src/game/puzzles";

function routeAccess(
  completedPuzzleIds: readonly PuzzleId[] = [],
  solutions: readonly (readonly [PuzzleId, string])[] = [],
): AppRouteAccess {
  return {
    completedPuzzleIds: new Set(completedPuzzleIds),
    solutionExists: (puzzleId, solutionId) =>
      solutions.some(([candidatePuzzleId, candidateSolutionId]) =>
        candidatePuzzleId === puzzleId && candidateSolutionId === solutionId
      ),
  };
}

describe("application routes", () => {
  it("formats every screen as a stable URL path", () => {
    expect(appScreenPath({ kind: "main-menu" })).toBe("/");
    expect(appScreenPath({ kind: "sandbox" })).toBe("/sandbox");
    expect(appScreenPath({ kind: "puzzle-info", puzzleId: "first-shift" })).toBe(
      "/puzzles/first-shift",
    );
    expect(appScreenPath({
      kind: "puzzle",
      puzzleId: "first-shift",
      solutionId: "solution/one",
    })).toBe("/puzzles/first-shift/solutions/solution%2Fone");
  });

  it("resolves menu, sandbox, puzzle, and saved-solution paths", () => {
    const access = routeAccess([], [["first-shift", "solution/one"]]);

    expect(resolveAppPath("/", access)).toEqual({ kind: "main-menu" });
    expect(resolveAppPath("/sandbox/", access)).toEqual({ kind: "sandbox" });
    expect(resolveAppPath("/puzzles/first-shift", access)).toEqual({
      kind: "puzzle-info",
      puzzleId: "first-shift",
    });
    expect(
      resolveAppPath("/puzzles/first-shift/solutions/solution%2Fone", access),
    ).toEqual({
      kind: "puzzle",
      puzzleId: "first-shift",
      solutionId: "solution/one",
    });
  });

  it("rejects unknown and malformed paths to the main menu", () => {
    const access = routeAccess();

    expect(resolveAppPath("/unknown", access)).toEqual({ kind: "main-menu" });
    expect(resolveAppPath("/puzzles/not-a-puzzle", access)).toEqual({
      kind: "main-menu",
    });
    expect(resolveAppPath("/puzzles/first-shift/extra", access)).toEqual({
      kind: "main-menu",
    });
    expect(resolveAppPath("/puzzles/%", access)).toEqual({ kind: "main-menu" });
    expect(resolveAppPath("//sandbox", access)).toEqual({ kind: "main-menu" });
  });

  it("enforces prerequisites for direct puzzle routes", () => {
    expect(resolveAppPath("/puzzles/beltworks", routeAccess())).toEqual({
      kind: "main-menu",
    });
    expect(
      resolveAppPath("/puzzles/beltworks", routeAccess(["first-shift"])),
    ).toEqual({ kind: "puzzle-info", puzzleId: "beltworks" });
    expect(
      resolveAppScreen(
        { kind: "puzzle-info", puzzleId: "runic-relay" },
        routeAccess(["first-shift"]),
      ),
    ).toEqual({ kind: "main-menu" });
  });

  it("falls back to puzzle info for missing or mismatched solution IDs", () => {
    const missingAccess = routeAccess();
    const mismatchedAccess = routeAccess([], [["first-shift", "solution-1"]]);

    expect(
      resolveAppPath(
        "/puzzles/first-shift/solutions/missing",
        missingAccess,
      ),
    ).toEqual({ kind: "puzzle-info", puzzleId: "first-shift" });
    expect(
      resolveAppPath(
        "/puzzles/first-shift/solutions/solution-1",
        routeAccess(["first-shift"], [["beltworks", "solution-1"]]),
      ),
    ).toEqual({ kind: "puzzle-info", puzzleId: "first-shift" });
    expect(
      resolveAppPath(
        "/puzzles/first-shift/solutions/solution-1",
        mismatchedAccess,
      ),
    ).toEqual({
      kind: "puzzle",
      puzzleId: "first-shift",
      solutionId: "solution-1",
    });
  });
});
