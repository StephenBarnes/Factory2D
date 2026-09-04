import { describe, expect, it } from "vitest";

import {
  appScreenPath,
  resolveAppPath,
  resolveAppScreen,
  type AppRouteAccess,
} from "../src/game/app-route";
import { isPuzzleUnlocked, PUZZLES, type PuzzleId } from "../src/game/puzzles";
import { expectDefined } from "../src/util/assert";

function routeAccess(
  completedPuzzleIds: readonly PuzzleId[] = [],
  solutions: readonly (readonly [PuzzleId, string])[] = [],
  sandboxIds: readonly string[] = [],
): AppRouteAccess {
  return {
    completedPuzzleIds: new Set(completedPuzzleIds),
    solutionExists: (puzzleId, solutionId) =>
      solutions.some(([candidatePuzzleId, candidateSolutionId]) =>
        candidatePuzzleId === puzzleId && candidateSolutionId === solutionId
      ),
    sandboxExists: (sandboxId) => sandboxIds.includes(sandboxId),
  };
}

const ROOT_PUZZLE = expectDefined(
  PUZZLES.find((puzzle) => isPuzzleUnlocked(puzzle, new Set())),
  "Missing initially unlocked puzzle",
);
const ROOT_PUZZLE_PATH = `/puzzles/${ROOT_PUZZLE.id}`;

describe("application routes", () => {
  it("formats every screen as a stable URL path", () => {
    expect(appScreenPath({ kind: "main-menu" })).toBe("/");
    expect(appScreenPath({ kind: "sandbox-info" })).toBe("/sandbox");
    expect(appScreenPath({ kind: "sandbox", sandboxId: "sandbox/one" })).toBe(
      "/sandbox/sandbox%2Fone",
    );
    expect(appScreenPath({ kind: "puzzle-info", puzzleId: "puzzle-id" })).toBe(
      "/puzzles/puzzle-id",
    );
    expect(appScreenPath({
      kind: "puzzle",
      puzzleId: "puzzle-id",
      solutionId: "solution/one",
    })).toBe("/puzzles/puzzle-id/solutions/solution%2Fone");
  });

  it("resolves menu, sandbox, puzzle, and saved-solution paths", () => {
    const access = routeAccess([], [[ROOT_PUZZLE.id, "solution/one"]], ["sandbox/one"]);

    expect(resolveAppPath("/", access)).toEqual({ kind: "main-menu" });
    expect(resolveAppPath("/sandbox/", access)).toEqual({ kind: "sandbox-info" });
    expect(resolveAppPath("/sandbox/sandbox%2Fone", access)).toEqual({
      kind: "sandbox",
      sandboxId: "sandbox/one",
    });
    expect(resolveAppPath(ROOT_PUZZLE_PATH, access)).toEqual({
      kind: "puzzle-info",
      puzzleId: ROOT_PUZZLE.id,
    });
    expect(
      resolveAppPath(`${ROOT_PUZZLE_PATH}/solutions/solution%2Fone`, access),
    ).toEqual({
      kind: "puzzle",
      puzzleId: ROOT_PUZZLE.id,
      solutionId: "solution/one",
    });
  });

  it("rejects unknown and malformed paths to the main menu", () => {
    const access = routeAccess();

    expect(resolveAppPath("/unknown", access)).toEqual({ kind: "main-menu" });
    expect(resolveAppPath("/puzzles/not-a-puzzle", access)).toEqual({
      kind: "main-menu",
    });
    expect(resolveAppPath(`${ROOT_PUZZLE_PATH}/extra`, access)).toEqual({
      kind: "main-menu",
    });
    expect(resolveAppPath("/puzzles/%", access)).toEqual({ kind: "main-menu" });
    expect(resolveAppPath("//sandbox", access)).toEqual({ kind: "main-menu" });
  });

  it("falls back to sandbox info for a missing saved sandbox", () => {
    expect(resolveAppPath("/sandbox/missing", routeAccess())).toEqual({
      kind: "sandbox-info",
    });
    expect(resolveAppScreen(
      { kind: "sandbox", sandboxId: "missing" },
      routeAccess(),
    )).toEqual({ kind: "sandbox-info" });
  });

  it("enforces group progression for direct puzzle routes", () => {
    for (const puzzle of PUZZLES) {
      const path = `/puzzles/${puzzle.id}`;
      const expectedWithoutProgress = isPuzzleUnlocked(puzzle, new Set())
        ? { kind: "puzzle-info", puzzleId: puzzle.id }
        : { kind: "main-menu" };

      expect(resolveAppPath(path, routeAccess())).toEqual(expectedWithoutProgress);
      expect(resolveAppScreen(
        { kind: "puzzle-info", puzzleId: puzzle.id },
        routeAccess(),
      )).toEqual(expectedWithoutProgress);

      const completedOtherPuzzles = PUZZLES
        .filter((candidate) => candidate.id !== puzzle.id)
        .map((candidate) => candidate.id);
      expect(
        resolveAppPath(path, routeAccess(completedOtherPuzzles)),
      ).toEqual({ kind: "puzzle-info", puzzleId: puzzle.id });
    }
  });

  it("falls back to puzzle info for missing or mismatched solution IDs", () => {
    const missingAccess = routeAccess();
    const mismatchedAccess = routeAccess([], [[ROOT_PUZZLE.id, "solution-1"]]);
    const solutionPath = `${ROOT_PUZZLE_PATH}/solutions/solution-1`;
    const puzzleInfo = { kind: "puzzle-info", puzzleId: ROOT_PUZZLE.id };

    expect(
      resolveAppPath(`${ROOT_PUZZLE_PATH}/solutions/missing`, missingAccess),
    ).toEqual(puzzleInfo);
    expect(
      resolveAppPath(
        solutionPath,
        routeAccess([], [["different-puzzle", "solution-1"]]),
      ),
    ).toEqual(puzzleInfo);
    expect(resolveAppPath(solutionPath, mismatchedAccess)).toEqual({
      kind: "puzzle",
      puzzleId: ROOT_PUZZLE.id,
      solutionId: "solution-1",
    });
  });
});
