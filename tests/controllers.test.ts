import { describe, expect, it } from "vitest";

import { GridRegion } from "../src/game/grid-region";
import { PuzzleComponents } from "../src/game/puzzle-components";
import { computePuzzleDesignMetrics } from "../src/game/puzzle-scores";
import { createPuzzleTestCaseWorld } from "../src/game/puzzle-test-runner";
import { SavedSandboxController } from "../src/game/saved-sandbox-controller";
import { SavedSolutionController } from "../src/game/saved-solution-controller";
import { loadPuzzleSolutions } from "../src/game/puzzle-solutions";
import { createSandboxWorld, puzzleById } from "../src/game/puzzles";
import { WorkshopSessionController } from "../src/game/workshop-session";
import { SandboxPuzzleAuthoringState } from "../src/game/sandbox-puzzle-authoring";
import { serializeBoard } from "../src/simulation/board-export";
import { TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function createStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("workshop session controller", () => {
  it("prices editable starter blocks and preserves their removal and replacement across cases, reset, and reload", () => {
    const shipped = puzzleById("stone-drop");
    const dimensions = shipped.createInitialWorld();
    const initial = new World(dimensions.width, dimensions.height);
    initial.place(0, 1, TileKind.Platform);
    initial.place(1, 1, TileKind.Stone);
    initial.place(2, 1, TileKind.Stone);
    initial.setWeld(0, 1, 1, 1, true);
    initial.setWeld(1, 1, 2, 1, true);
    const alternate = initial.clone();
    alternate.place(0, 1, TileKind.Iron);
    alternate.place(1, 1, TileKind.Iron);
    const puzzle = {
      ...shipped,
      editableRegion: new GridRegion([{ x: 1, y: 1, width: 2, height: 1 }]),
      availableComponents: new PuzzleComponents([
        { kind: TileKind.Stone, price: 7 },
        { kind: TileKind.Iron, price: 11 },
      ]),
      createInitialWorld: () => initial.clone(),
      testCases: [
        { id: "standard", name: "Standard", cycleLimit: 20, createInitialWorld: () => initial.clone() },
        { id: "alternate", name: "Alternate", cycleLimit: 20, createInitialWorld: () => alternate.clone() },
      ],
    };
    const storage = createStorage();
    const saved = new SavedSolutionController(storage);
    const solution = saved.create(puzzle);
    const sessions = new WorkshopSessionController(createSandboxWorld());
    sessions.activateSolution(solution, puzzle);
    expect(computePuzzleDesignMetrics(puzzle, sessions.active.baseline)).toEqual({
      price: 14, footprintWidth: 2, footprintHeight: 1,
      footprintBounds: { x: 1, y: 1, width: 2, height: 1 },
    });

    sessions.active.world.place(1, 1, TileKind.Empty);
    sessions.active.world.place(2, 1, TileKind.Iron);
    sessions.saveEditedBaseline();
    expect(computePuzzleDesignMetrics(puzzle, sessions.active.baseline)).toEqual({
      price: 11, footprintWidth: 1, footprintHeight: 1,
      footprintBounds: { x: 2, y: 1, width: 1, height: 1 },
    });
    for (const testCase of puzzle.testCases) {
      const runtime = createPuzzleTestCaseWorld(testCase, puzzle.editableRegion, sessions.active.baseline);
      expect(runtime.kindAt(1, 1)).toBe(TileKind.Empty);
      expect(runtime.kindAt(2, 1)).toBe(TileKind.Iron);
      expect(runtime.kindAt(0, 1)).toBe(testCase.id === "standard" ? TileKind.Platform : TileKind.Iron);
      expect(runtime.isWelded(0, 1, 1, 1)).toBe(false);
      expect(runtime.isWelded(1, 1, 2, 1)).toBe(false);
      sessions.showActiveRuntime(runtime);
      sessions.beginSimulation();
      sessions.active.simulation.step();
      sessions.resetSimulation();
      expect(sessions.active.world.kindAt(1, 1)).toBe(TileKind.Empty);
      expect(sessions.active.world.kindAt(2, 1)).toBe(TileKind.Iron);
      expect(sessions.active.world.kindAt(0, 1)).toBe(TileKind.Platform);
    }
    saved.markDirty(solution.id);
    saved.persistBoardIfDirty(solution.id, sessions.active.baseline);
    const reloaded = new SavedSolutionController(storage);
    const restored = new WorkshopSessionController(createSandboxWorld());
    restored.activateSolution(reloaded.byId(solution.id), puzzle);
    expect(restored.active.world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(restored.active.world.kindAt(2, 1)).toBe(TileKind.Iron);
    expect(computePuzzleDesignMetrics(puzzle, restored.active.baseline).price).toBe(11);
    expect(initial.kindAt(1, 1)).toBe(TileKind.Stone);
    expect(initial.kindAt(2, 1)).toBe(TileKind.Stone);
  });

  it("retains independent sandbox and saved-solution sessions", () => {
    const puzzle = puzzleById("stone-drop");
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
    const puzzle = puzzleById("stone-drop");
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
