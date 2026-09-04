import { describe, expect, it } from "vitest";

import { GridRegion } from "../src/game/grid-region";
import { SavedSandboxController } from "../src/game/saved-sandbox-controller";
import { SavedSolutionController } from "../src/game/saved-solution-controller";
import { loadPuzzleSolutions } from "../src/game/puzzle-solutions";
import { createSandboxWorld, puzzleById } from "../src/game/puzzles";
import { WorkshopSessionController } from "../src/game/workshop-session";
import { SandboxPuzzleAuthoringState } from "../src/game/sandbox-puzzle-authoring";
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
    const sandboxWorld = createSandboxWorld();
    const sessions = new WorkshopSessionController(sandboxWorld);
    const sandboxAuthoring = SandboxPuzzleAuthoringState.createDefault(sandboxWorld);
    expect(sessions.activateSandbox("sandbox-1", {
      world: sandboxWorld,
      tick: 0,
      editableRegion: new GridRegion([]),
      authoring: sandboxAuthoring,
    })).toBe(true);
    const sandbox = sessions.active;
    expect(sandbox.editableRegionAuthoring).not.toBeNull();

    expect(sessions.activateSolution(solution, puzzle)).toBe(true);
    const puzzleSession = sessions.active;
    expect(puzzleSession.editableRegion).toBe(puzzle.editableRegion);
    expect(puzzleSession.availableComponents).toBe(puzzle.availableComponents);
    expect(puzzleSession.editableRegionAuthoring).toBeNull();

    puzzleSession.world.place(8, 3, TileKind.Stone);
    sessions.saveEditedBaseline();
    expect(sessions.beginSimulation()).toBe(true);
    puzzleSession.world.place(8, 3, TileKind.Empty);
    sessions.resetSimulation();
    expect(puzzleSession.world.kindAt(8, 3)).toBe(TileKind.Stone);
    expect(puzzleSession.editingState.editable).toBe(true);

    expect(sessions.activateSandbox("sandbox-1", {
      world: sandboxWorld,
      tick: 0,
      editableRegion: new GridRegion([]),
      authoring: sandboxAuthoring,
    })).toBe(true);
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

  it("keeps each authored sandbox test case independent", () => {
    const sessions = new WorkshopSessionController(createSandboxWorld());
    sessions.active.world.place(0, 0, TileKind.Stone);
    sessions.saveEditedBaseline();

    sessions.duplicateActiveSandboxTestCase();
    expect(sessions.active.puzzleAuthoring?.selectedTestCaseId).toBe("case-1");
    expect(sessions.active.world.kindAt(0, 0)).toBe(TileKind.Stone);
    sessions.active.world.place(1, 0, TileKind.Iron);
    sessions.saveEditedBaseline();

    sessions.selectActiveSandboxTestCase("standard");
    expect(sessions.active.world.kindAt(0, 0)).toBe(TileKind.Stone);
    expect(sessions.active.world.kindAt(1, 0)).toBe(TileKind.Empty);
    sessions.selectActiveSandboxTestCase("case-1");
    expect(sessions.active.world.kindAt(1, 0)).toBe(TileKind.Iron);

    sessions.deleteActiveSandboxTestCase();
    expect(sessions.active.puzzleAuthoring?.selectedTestCaseId).toBe("standard");
    expect(sessions.active.puzzleAuthoring?.testCases).toHaveLength(1);
  });
});

describe("saved solution controller", () => {
  it("owns dirty-board persistence, duplication, and deletion", () => {
    const storage = createStorage();
    const controller = new SavedSolutionController(storage);
    const puzzle = puzzleById("first-shift");
    const solution = controller.create(puzzle);


    const edited = puzzle.createInitialWorld();
    edited.place(8, 2, TileKind.Stone);
    controller.markDirty(solution.id);
    controller.persistBoardIfDirty(solution.id, edited);

    const loaded = loadPuzzleSolutions(storage);
    expect(loaded.byId(solution.id).board).toBe(serializeBoard(edited, 0));

    const duplicate = controller.duplicate(solution.id);
    expect(controller.forPuzzle(puzzle.id).map(({ id }) => id)).toEqual([
      solution.id,
      duplicate.id,
    ]);
    controller.delete(duplicate.id);
    expect(controller.forPuzzle(puzzle.id).map(({ id }) => id)).toEqual([solution.id]);
  });
});

describe("saved sandbox controller", () => {
  it("owns dirty snapshot persistence and restores independent sessions", () => {
    const storage = createStorage();
    const controller = new SavedSandboxController(storage);
    const saved = controller.create();
    const sessions = new WorkshopSessionController(createSandboxWorld());
    sessions.activateSandbox(saved.id, controller.import(saved.id));

    sessions.active.world.place(0, 0, TileKind.Iron);
    sessions.saveEditedBaseline();
    sessions.duplicateActiveSandboxTestCase();
    sessions.active.world.place(1, 0, TileKind.Stone);
    sessions.saveEditedBaseline();
    controller.markDirty(saved.id);
    controller.persistSnapshotIfDirty(saved.id, sessions.snapshotActiveSandbox());

    const restored = new SavedSandboxController(storage);
    const imported = restored.import(saved.id);
    expect(imported.authoring.selectedTestCaseId).toBe("case-1");
    expect(imported.authoring.testCases).toHaveLength(2);
    expect(imported.world.kindAt(0, 0)).toBe(TileKind.Iron);
    expect(imported.world.kindAt(1, 0)).toBe(TileKind.Stone);

    const duplicate = restored.duplicate(saved.id);
    expect(restored.entries.map(({ id }) => id)).toEqual([saved.id, duplicate.id]);
    restored.delete(duplicate.id);
    expect(restored.entries.map(({ id }) => id)).toEqual([saved.id]);
  });
});
