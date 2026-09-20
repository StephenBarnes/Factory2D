import { describe, expect, it } from "vitest";
import { GridRegion } from "../src/game/grid-region";
import { puzzleById } from "../src/game/puzzles";
import { SandboxPuzzleAuthoringState } from "../src/game/sandbox-puzzle-authoring";
import { WorkshopSessionController } from "../src/game/workshop-session";
import { serializeBoard } from "../src/simulation/board-export";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function sandboxImport(world: World) {
  return {
    world,
    tick: 0,
    editableRegion: new GridRegion([]),
    authoring: SandboxPuzzleAuthoringState.createDefault(world),
  };
}

function properties(sessions: WorkshopSessionController) {
  const authoring = sessions.active.puzzleAuthoring;
  if (authoring === null) throw new Error("Expected sandbox authoring");
  return authoring.properties(sessions.active.world.width, sessions.active.world.height);
}

describe("workshop snapshot history", () => {
  it("coalesces one gesture across ticks and restores committed designs rather than physics", () => {
    const sessions = new WorkshopSessionController(new World(5, 5));
    const group = {};
    sessions.active.world.place(0, 0, TileKind.Stone);
    sessions.saveEditedBaseline(group);
    sessions.beginSimulation();
    sessions.active.simulation.step();
    sessions.active.world.place(1, 0, TileKind.Iron);
    sessions.saveEditedBaseline(group);
    const committed = serializeBoard(sessions.active.baseline, 0);
    sessions.active.simulation.step();

    expect(sessions.undoEdit()).toBe(true);
    expect(serializeBoard(sessions.active.world, 0)).toBe(serializeBoard(new World(5, 5), 0));
    expect(sessions.canUndo).toBe(false);
    expect(sessions.redoEdit()).toBe(true);
    expect(serializeBoard(sessions.active.world, 0)).toBe(committed);
    expect(serializeBoard(sessions.active.previousWorld, 0)).toBe(committed);
    expect(serializeBoard(sessions.active.baseline, 0)).toBe(committed);
    expect(sessions.active.simulation.tick).toBe(0);
    expect(sessions.active.editingState.editable).toBe(true);

    sessions.active.world.place(4, 4, TileKind.Stone);
    sessions.saveEditedBaseline(group);
    expect(sessions.undoEdit()).toBe(true);
    expect(serializeBoard(sessions.active.world, 0)).toBe(committed);
    expect(sessions.canUndo).toBe(true);
  });

  it("preserves redo across case browsing and no-op commits, but replaces it after a real edit", () => {
    const sessions = new WorkshopSessionController(new World(4, 3));
    sessions.active.world.place(0, 0, TileKind.Stone);
    sessions.saveEditedBaseline();
    sessions.duplicateActiveSandboxTestCase();
    sessions.active.world.place(1, 0, TileKind.Iron);
    sessions.saveEditedBaseline();
    sessions.undoEdit();
    sessions.selectActiveSandboxTestCase("standard");
    sessions.saveEditedBaseline();
    sessions.recordSandboxEdit();
    sessions.updateActiveSandboxProperties(properties(sessions));

    expect(sessions.canRedo).toBe(true);
    expect(sessions.redoEdit()).toBe(true);
    expect(sessions.active.puzzleAuthoring?.selectedTestCaseId).toBe("case-1");
    expect(sessions.active.world.kindAt(1, 0)).toBe(TileKind.Iron);
    sessions.undoEdit();
    sessions.selectActiveSandboxTestCase("standard");
    sessions.active.world.place(2, 0, TileKind.Stone);
    sessions.saveEditedBaseline();
    expect(sessions.canRedo).toBe(false);
    expect(sessions.redoEdit()).toBe(false);
    sessions.undoEdit();
    expect(sessions.active.puzzleAuthoring?.selectedTestCaseId).toBe("standard");
    expect(sessions.active.world.kindAt(2, 0)).toBe(TileKind.Empty);
  });

  it("bounds each session to thirty undo actions without losing the retained oldest state", () => {
    const sessions = new WorkshopSessionController(new World(32, 1));
    for (let x = 0; x < 31; x += 1) {
      sessions.active.world.place(x, 0, TileKind.Stone);
      sessions.saveEditedBaseline();
    }
    for (let index = 0; index < 30; index += 1) expect(sessions.undoEdit()).toBe(true);
    expect(sessions.undoEdit()).toBe(false);
    expect(sessions.active.world.kindAt(0, 0)).toBe(TileKind.Stone);
    expect(JSON.parse(serializeBoard(sessions.active.world, 0)).grid).toEqual([`#${".".repeat(31)}`]);
    for (let index = 0; index < 30; index += 1) expect(sessions.redoEdit()).toBe(true);
    expect(sessions.redoEdit()).toBe(false);
    expect(JSON.parse(serializeBoard(sessions.active.world, 0)).grid).toEqual([`${"#".repeat(31)}.`]);
  });

  it("seeds imported metadata, all cases, regions and exact nested contents before the first edit", () => {
    const world = new World(5, 4);
    world.place(1, 1, TileKind.RuneArray);
    world.configureRuneArray(1, 1, 3, 3, "Nested design");
    const inner = world.runeArrayWorldAt(1, 1);
    inner.place(0, 0, TileKind.Stone);
    inner.place(0, 1, TileKind.Delay);
    inner.configureNumericComponent(0, 1, 7);
    inner.place(1, 0, TileKind.Iron);
    inner.place(2, 2, TileKind.Rotator, Direction.Right, true);
    expect(inner.setWeld(0, 0, 1, 0, true)).toBe(true);
    inner.setTextBoxes([
      { id: "nested", centerX: 1.5, centerY: 1.5, text: "Nested text", owner: "player" },
    ]);
    world.setTextBoxes([
      { id: "root", centerX: 2.5, centerY: 2.5, text: "Root text", owner: "player" },
    ]);
    const imported = sandboxImport(world);
    const initialProperties = imported.authoring.properties(world.width, world.height);
    imported.authoring.update({
      ...initialProperties,
      name: "Imported authoring",
      difficulty: 4,
      components: initialProperties.components.map((component) => ({
        ...component,
        price: component.kind === TileKind.Stone ? 77 : component.price,
      })),
    });
    imported.authoring.duplicateSelectedTestCase();
    const alternate = imported.authoring.selectedWorld();
    alternate.place(4, 3, TileKind.Iron);
    imported.authoring.saveSelectedWorld(alternate);
    const region = new GridRegion([{ x: 1, y: 1, width: 3, height: 2 }]);
    const sessions = new WorkshopSessionController(new World(1, 1));
    sessions.activateSandbox("imported", { ...imported, world: alternate, editableRegion: region });
    const expectedProperties = properties(sessions);
    expect(sessions.canUndo).toBe(false);

    sessions.resizeActiveSandboxEdge("left", 1);
    sessions.deleteActiveSandboxTestCase();
    expect(sessions.undoEdit()).toBe(true);
    expect(sessions.active.puzzleAuthoring?.selectedTestCaseId).toBe("case-1");
    expect(sessions.active.world.width).toBe(6);
    expect(sessions.undoEdit()).toBe(true);
    expect(serializeBoard(sessions.active.world, 0)).toBe(serializeBoard(alternate, 0));
    expect(properties(sessions)).toEqual(expectedProperties);
    expect(sessions.active.editableRegionAuthoring?.region.rectangles).toEqual(region.rectangles);
    sessions.selectActiveSandboxTestCase("standard");
    expect(serializeBoard(sessions.active.world, 0)).toBe(serializeBoard(world, 0));
    expect(sessions.canUndo).toBe(false);
    expect(sessions.canRedo).toBe(true);
  });

  it("records region, disabled-price, dimension, crop and import changes without manual board commits", () => {
    const sessions = new WorkshopSessionController(new World(4, 3));
    const original = properties(sessions);
    sessions.updateActiveSandboxProperties({
      ...original,
      components: original.components.map((component) => ({
        ...component,
        price: component.kind === TileKind.Stone ? component.price + 3 : component.price,
      })),
    });
    expect(sessions.undoEdit()).toBe(true);
    expect(properties(sessions)).toEqual(original);
    sessions.redoEdit();

    const region = sessions.active.editableRegionAuthoring;
    if (region === null) throw new Error("Expected editable region authoring");
    region.replaceForBoard(4, 3, new GridRegion([{ x: 1, y: 1, width: 2, height: 1 }]));
    sessions.recordSandboxEdit();
    sessions.cropActiveSandbox({ x: 1, y: 0, width: 3, height: 3 });
    expect(sessions.undoEdit()).toBe(true);
    expect(sessions.active.world.width).toBe(4);
    expect(region.region.rectangles).toEqual([{ x: 1, y: 1, width: 2, height: 1 }]);
    expect(sessions.undoEdit()).toBe(true);
    expect(region.region.rectangles).toEqual([]);
    sessions.redoEdit();

    sessions.updateActiveSandboxProperties({ ...properties(sessions), width: 6, height: 5 });
    expect(sessions.undoEdit()).toBe(true);
    expect(sessions.active.world.width).toBe(4);
    expect(sessions.active.world.height).toBe(3);
    const replacement = new World(2, 2);
    replacement.place(1, 1, TileKind.Iron);
    sessions.replaceActiveSandboxImport(sandboxImport(replacement));
    expect(sessions.undoEdit()).toBe(true);
    expect(sessions.active.world.width).toBe(4);
    expect(region.region.rectangles).toEqual([{ x: 1, y: 1, width: 2, height: 1 }]);
    expect(sessions.redoEdit()).toBe(true);
    expect(sessions.active.world.kindAt(1, 1)).toBe(TileKind.Iron);
    expect(region.region.rectangles).toEqual([]);
  });

  it("retains independent undo and redo branches while switching sessions", () => {
    const sessions = new WorkshopSessionController(new World(2, 2));
    const first = sandboxImport(new World(2, 2));
    const second = sandboxImport(new World(2, 2));
    sessions.activateSandbox("first", first);
    sessions.active.world.place(0, 0, TileKind.Stone);
    sessions.saveEditedBaseline();
    sessions.undoEdit();
    sessions.activateSandbox("second", second);
    expect(sessions.canRedo).toBe(false);
    sessions.active.world.place(1, 1, TileKind.Iron);
    sessions.saveEditedBaseline();
    sessions.activateSandbox("first", first);
    expect(sessions.canRedo).toBe(true);
    expect(sessions.canUndo).toBe(false);
    sessions.redoEdit();
    expect(sessions.active.world.kindAt(0, 0)).toBe(TileKind.Stone);
    sessions.activateSandbox("second", second);
    expect(sessions.undoEdit()).toBe(true);
    expect(sessions.active.world.kindAt(1, 1)).toBe(TileKind.Empty);
  });

  it("rejects locked puzzle history and never records reset or runtime case mounts", () => {
    const world = new World(4, 3);
    world.place(0, 0, TileKind.Platform);
    const puzzle = {
      ...puzzleById("stone-drop"),
      editableRegion: new GridRegion([{ x: 1, y: 1, width: 2, height: 1 }]),
    };
    const sessions = new WorkshopSessionController(new World(2, 2));
    sessions.activateSolution({
      id: "solution",
      puzzleId: puzzle.id,
      name: "Solution",
      board: serializeBoard(world, 0),
      scores: null,
    }, puzzle);
    sessions.active.world.place(1, 1, TileKind.Stone);
    sessions.saveEditedBaseline();
    const committed = serializeBoard(sessions.active.baseline, 0);
    sessions.beginSimulation();
    sessions.active.simulation.step();
    const runningWorld = sessions.active.world;
    sessions.saveEditedBaseline();
    expect(sessions.canUndo).toBe(false);
    expect(sessions.canRedo).toBe(false);
    expect(sessions.undoEdit()).toBe(false);
    expect(sessions.redoEdit()).toBe(false);
    expect(sessions.active.world).toBe(runningWorld);
    expect(serializeBoard(sessions.active.baseline, 0)).toBe(committed);
    sessions.resetSimulation();
    const alternateRuntime = sessions.active.baseline.clone();
    alternateRuntime.place(0, 0, TileKind.Iron);
    sessions.showActiveRuntime(alternateRuntime);
    expect(sessions.undoEdit()).toBe(true);
    expect(serializeBoard(sessions.active.world, 0)).toBe(serializeBoard(world, 0));
    expect(sessions.canUndo).toBe(false);
    expect(sessions.redoEdit()).toBe(true);
    expect(serializeBoard(sessions.active.world, 0)).toBe(committed);
  });
});
