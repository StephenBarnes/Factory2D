import { describe, expect, it } from "vitest";

import { SavedSolutionController } from "../src/game/saved-solution-controller";
import { loadPuzzleSolutions } from "../src/game/puzzle-solutions";
import { createSandboxWorld, puzzleById } from "../src/game/puzzles";
import { WorkshopSessionController } from "../src/game/workshop-session";
import { serializeBoard } from "../src/simulation/board-export";
import { TileKind } from "../src/simulation/tile";

function createStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("workshop session controller", () => {
  it("retains independent sandbox and saved-solution sessions", () => {
    const puzzle = puzzleById("first-shift");
    const initialWorld = puzzle.createInitialWorld();
    const solution = {
      id: "solution-1",
      puzzleId: puzzle.id,
      name: "Solution 1",
      board: serializeBoard(initialWorld, 0),
      scores: null,
    } as const;
    const sessions = new WorkshopSessionController(createSandboxWorld());
    const sandbox = sessions.active;
    expect(sandbox.editableRegionAuthoring).not.toBeNull();

    expect(sessions.activateSolution(solution, puzzle)).toBe(true);
    const puzzleSession = sessions.active;
    expect(puzzleSession.editableRegion).toBe(puzzle.editableRegion);
    expect(puzzleSession.availableComponents).toBe(puzzle.availableComponents);
    expect(puzzleSession.editableRegionAuthoring).toBeNull();

    puzzleSession.world.place(8, 2, TileKind.Stone);
    sessions.saveEditedBaseline();
    expect(sessions.beginSimulation()).toBe(true);
    puzzleSession.world.place(8, 2, TileKind.Empty);
    sessions.resetSimulation();
    expect(puzzleSession.world.kindAt(8, 2)).toBe(TileKind.Stone);
    expect(puzzleSession.editingState.editable).toBe(true);

    expect(sessions.activateSandbox()).toBe(true);
    expect(sessions.active).toBe(sandbox);
    expect(sessions.activateSolution(solution, puzzle)).toBe(true);
    expect(sessions.active).toBe(puzzleSession);
  });

  it("replaces the active imported world and simulation tick together", () => {
    const sessions = new WorkshopSessionController(createSandboxWorld());
    const imported = createSandboxWorld();
    const authoring = sessions.active.editableRegionAuthoring;
    if (authoring === null) {
      throw new Error("Sandbox authoring state is missing");
    }
    authoring.beginRectangle(1, 1);
    authoring.commitRectangle();
    imported.place(2, 2, TileKind.Stone);

    sessions.replaceActiveWorld(imported, 17);

    expect(sessions.active.world).toBe(imported);
    expect(sessions.active.simulation.tick).toBe(17);
    expect(sessions.active.baseline).not.toBe(imported);
    expect(sessions.active.baseline.kindAt(2, 2)).toBe(TileKind.Stone);
    expect(authoring.region.rectangles).toEqual([]);
  });
});

describe("saved solution controller", () => {
  it("owns selection, dirty-board persistence, duplication, and deletion", () => {
    const storage = createStorage();
    const controller = new SavedSolutionController(storage);
    const puzzle = puzzleById("first-shift");
    const solution = controller.create(puzzle);

    expect(controller.selectedForPuzzle(puzzle.id)).toBe(solution.id);

    const edited = puzzle.createInitialWorld();
    edited.place(8, 2, TileKind.Stone);
    controller.markDirty(solution.id);
    controller.persistBoardIfDirty(solution.id, edited);

    const loaded = loadPuzzleSolutions(storage);
    expect(loaded.byId(solution.id).board).toBe(serializeBoard(edited, 0));

    const duplicate = controller.duplicate(solution.id);
    expect(controller.selectedForPuzzle(puzzle.id)).toBe(duplicate.id);
    controller.delete(duplicate.id);
    expect(controller.selectedForPuzzle(puzzle.id)).toBe(solution.id);
  });
});
