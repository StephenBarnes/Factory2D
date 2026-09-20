import { describe, expect, it } from "vitest";
import { GridRegion } from "../src/game/grid-region";
import { applyEditableSolution } from "../src/game/editable-solution";
import { deserializeSnippetBoard, serializeSnippetWorld } from "../src/game/snippet-library";
import { serializePuzzleTemplate } from "../src/game/puzzle-export";
import { parsePuzzleFile } from "../src/game/puzzle-format";
import {
  parseSandboxImport,
  resizeWorld,
} from "../src/game/sandbox-puzzle-authoring";
import { WorkshopSessionController } from "../src/game/workshop-session";
import { serializeBoard } from "../src/simulation/board-export";
import { Direction, TILE_DEFINITIONS, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function authoredPuzzleSource(): string {
  const world = new World(4, 3);
  world.place(1, 1, TileKind.Stone);
  world.place(2, 1, TileKind.Stone);
  world.setWeld(1, 1, 2, 1, true);
  world.place(3, 0, TileKind.Victory);
  const puzzle = JSON.parse(
    serializePuzzleTemplate(
      world,
      new GridRegion([{ x: 1, y: 1, width: 2, height: 1 }]),
    ),
  ) as Record<string, unknown>;
  puzzle.id = "imported-puzzle";
  puzzle.group = "runelore";
  puzzle.order = 7;
  puzzle.name = "Imported Puzzle";
  puzzle.description = "Imported description";
  puzzle.goal = "Keep this goal";
  puzzle.cycleLimit = 250;
  puzzle.components = [
    { code: TILE_DEFINITIONS[TileKind.Stone].boardCode, price: 7 },
  ];
  puzzle.testCases = [
    {
      id: "alternate",
      name: "Alternate",
      overrides: {
        initialBoard: {
          grid: ["...V", ".##.", "...."],
        },
      },
    },
  ];
  return JSON.stringify(puzzle);
}

describe("sandbox puzzle authoring", () => {
  it("preserves mirrored designs across cropping, snippets, and editable case transfer", () => {
    const world = new World(5, 4);
    world.place(2, 2, TileKind.Selector, Direction.Left, true);
    world.place(3, 2, TileKind.Rom, Direction.Up, true);
    const cropped = resizeWorld(world, 2, 1, 2, 2);
    const serialized = serializeSnippetWorld(cropped);
    if (serialized === null) throw new Error("Expected mirrored snippet");
    const snippet = deserializeSnippetBoard(serialized);
    const target = new World(2, 1);
    target.place(1, 0, TileKind.Rom);
    applyEditableSolution(target, snippet, new GridRegion([{ x: 0, y: 0, width: 1, height: 1 }]));
    expect(target.mirroredAt(0, 0)).toBe(true);
    expect(target.orientationAt(0, 0)).toBe(Direction.Left);
    expect(target.mirroredAt(1, 0)).toBe(false);
    expect(snippet.mirroredAt(1, 0)).toBe(true);
  });

  it("round-trips test-case overrides that explicitly clear inherited mirroring", () => {
    const imported = parseSandboxImport(authoredPuzzleSource(), "mirrored.json");
    const standard = imported.authoring.selectTestCase("standard");
    standard.place(0, 0, TileKind.Selector, Direction.Up, true);
    imported.authoring.saveSelectedWorld(standard);
    const alternate = imported.authoring.selectTestCase("alternate");
    alternate.place(0, 0, TileKind.Selector);
    imported.authoring.saveSelectedWorld(alternate);
    const exported = imported.authoring.serialize(imported.editableRegion);
    const restored = parseSandboxImport(exported, "mirrored.json");
    expect(restored.authoring.selectTestCase("standard").mirroredAt(0, 0)).toBe(true);
    expect(restored.authoring.selectTestCase("alternate").mirroredAt(0, 0)).toBe(false);
  });

  it("imports puzzle metadata, editable regions, components, and test cases for re-export", () => {
    const imported = parseSandboxImport(authoredPuzzleSource(), "imported-puzzle.json");

    expect(imported.tick).toBe(0);
    expect(imported.authoring.fileName).toBe("imported-puzzle.json");
    expect(imported.editableRegion.rectangles).toEqual([
      { x: 1, y: 1, width: 2, height: 1 },
    ]);
    expect(imported.world.kindAt(3, 0)).toBe(TileKind.Victory);
    expect(imported.world.isWelded(1, 1, 2, 1)).toBe(true);

    const properties = imported.authoring.properties(4, 3);
    expect(properties).toMatchObject({
      id: "imported-puzzle",
      groupId: "runelore",
      order: 7,
      name: "Imported Puzzle",
      description: "Imported description",
      goal: "Keep this goal",
      cycleLimit: 250,
    });
    expect(properties.components.find(({ kind }) => kind === TileKind.Stone)).toEqual({
      kind: TileKind.Stone,
      enabled: true,
      price: 7,
    });
    expect(properties.components.find(({ kind }) => kind === TileKind.Sand)?.enabled).toBe(false);

    const updatedProperties = {
      ...properties,
      width: 5,
      height: 4,
      id: "updated-puzzle",
      groupId: "advanced-runelore",
      order: 3.5,
      name: "Updated Puzzle",
      description: "Updated description",
      goal: "Updated goal",
      cycleLimit: 400,
      components: properties.components.map((component) =>
        component.kind === TileKind.Sand
          ? { ...component, enabled: true, price: 4 }
          : component
      ),
    };
    imported.authoring.saveSelectedWorld(imported.world);
    imported.authoring.update(updatedProperties);
    expect(imported.authoring.fileName).toBe("updated-puzzle.json");
    const resized = imported.authoring.selectedWorld();
    resized.place(0, 3, TileKind.Iron);
    imported.authoring.saveSelectedWorld(resized);
    const exportedSource = imported.authoring.serialize(imported.editableRegion);
    const exported = JSON.parse(exportedSource) as {
      readonly id: string;
      readonly group: string;
      readonly name: string;
      readonly description: string;
      readonly goal: string;
      readonly cycleLimit: number;
      readonly components: readonly { readonly code: string; readonly price: number }[];
      readonly testCases: readonly {
        readonly id: string;
        readonly overrides: {
          readonly initialBoard?: { readonly grid?: readonly string[] };
        };
      }[];
    };

    expect(exported).toMatchObject({
      id: "updated-puzzle",
      group: "advanced-runelore",
      order: 3.5,
      name: "Updated Puzzle",
      description: "Updated description",
      goal: "Updated goal",
      cycleLimit: 400,
    });
    expect(exported.components).toHaveLength(2);
    expect(exported.components).toContainEqual({
      code: TILE_DEFINITIONS[TileKind.Stone].boardCode,
      price: 7,
    });
    expect(exported.components).toContainEqual({
      code: TILE_DEFINITIONS[TileKind.Sand].boardCode,
      price: 4,
    });
    expect(exported.testCases.map(({ id }) => id)).toEqual(["alternate"]);
    expect(exported.testCases[0]?.overrides.initialBoard?.grid).toEqual([
      "...V.",
      ".##..",
      ".....",
      ".....",
    ]);

    const reparsed = parsePuzzleFile(exported, "imported-puzzle.json");
    expect([reparsed.initialWorld.width, reparsed.initialWorld.height]).toEqual([5, 4]);
    expect(reparsed.initialWorld.kindAt(0, 3)).toBe(TileKind.Iron);
    expect(reparsed.testCases).toHaveLength(2);
  });

  it("exports only changed case fields and preserves explicit clears on import", () => {
    const imported = parseSandboxImport(authoredPuzzleSource(), "imported-puzzle.json");
    const unchanged = JSON.parse(imported.authoring.serialize(imported.editableRegion));
    expect(unchanged.testCases[0].overrides).toEqual({});

    const alternate = imported.authoring.selectTestCase("alternate");
    alternate.setWeld(1, 1, 2, 1, false);
    imported.authoring.saveSelectedWorld(alternate);
    const exported = JSON.parse(imported.authoring.serialize(imported.editableRegion));
    expect(exported.testCases[0].overrides).toEqual({
      initialBoard: { welds: ["....", "....", "...."] },
    });
    const restored = parseSandboxImport(JSON.stringify(exported), "round-trip.json");
    expect(restored.authoring.selectTestCase("standard").isWelded(1, 1, 2, 1)).toBe(true);
    expect(restored.authoring.selectTestCase("alternate").isWelded(1, 1, 2, 1)).toBe(false);
  });

  it("duplicates, switches, edits, and deletes authored test cases", () => {
    const imported = parseSandboxImport(authoredPuzzleSource(), "imported-puzzle.json");
    expect(imported.authoring.testCases).toEqual([
      { id: "standard", name: "Standard case", standard: true },
      { id: "alternate", name: "Alternate", standard: false },
    ]);

    const alternate = imported.authoring.selectTestCase("alternate");
    expect(alternate.kindAt(1, 1)).toBe(TileKind.Stone);
    alternate.place(0, 2, TileKind.Iron);
    imported.authoring.saveSelectedWorld(alternate);

    const duplicate = imported.authoring.duplicateSelectedTestCase();
    expect(imported.authoring.selectedTestCaseId).toBe("case-1");
    expect(duplicate.kindAt(0, 2)).toBe(TileKind.Iron);
    duplicate.place(0, 2, TileKind.Glass);
    imported.authoring.saveSelectedWorld(duplicate);

    expect(imported.authoring.selectTestCase("alternate").kindAt(0, 2)).toBe(TileKind.Iron);
    imported.authoring.selectTestCase("case-1");
    const selectedAfterDelete = imported.authoring.deleteSelectedTestCase();
    expect(imported.authoring.selectedTestCaseId).toBe("alternate");
    expect(selectedAfterDelete.kindAt(0, 2)).toBe(TileKind.Iron);
    expect(imported.authoring.testCases.map(({ id }) => id)).toEqual([
      "standard",
      "alternate",
    ]);
  });

  it("preserves independent annotations and explicit empty annotations across exported cases", () => {
    const imported = parseSandboxImport(authoredPuzzleSource(), "imported-puzzle.json");
    const standard = imported.authoring.selectTestCase("standard");
    standard.setTextBoxes([
      { id: "hint", centerX: 1.5, centerY: 1, text: "Standard hint", owner: "author" },
    ]);
    imported.authoring.saveSelectedWorld(standard);
    const alternate = imported.authoring.selectTestCase("alternate");
    alternate.setTextBoxes([]);
    imported.authoring.saveSelectedWorld(alternate);
    const restored = parseSandboxImport(
      imported.authoring.serialize(imported.editableRegion), "imported-puzzle.json",
    );
    expect(restored.authoring.selectTestCase("standard").textBoxes).toEqual(standard.textBoxes);
    expect(restored.authoring.selectTestCase("alternate").textBoxes).toEqual([]);
  });

  it("retains centers on inclusive board edges and drops centers outside on shrink", () => {
    const world = new World(4, 3);
    world.setTextBoxes([
      { id: "retained", centerX: 1.25, centerY: 0.5, text: "Retained", owner: "author" },
      { id: "origin", centerX: 0, centerY: 0, text: "Origin", owner: "author" },
      { id: "edge", centerX: 2, centerY: 1, text: "Edge", owner: "author" },
      { id: "cropped", centerX: 2.25, centerY: 1.5, text: "Cropped", owner: "author" },
    ]);
    const resized = resizeWorld(world, 2, 1);
    expect(resized.textBoxes).toEqual([
      { id: "retained", centerX: 1.25, centerY: 0.5, text: "Retained", owner: "author" },
      { id: "origin", centerX: 0, centerY: 0, text: "Origin", owner: "author" },
      { id: "edge", centerX: 2, centerY: 1, text: "Edge", owner: "author" },
    ]);
    expect(resizeWorld(resized, 4, 3).textBoxes).toEqual(resized.textBoxes);
  });

  it("resizes a scene from the top-left while preserving retained state and welds", () => {
    const world = new World(3, 2);
    world.place(0, 0, TileKind.Delay);
    world.configureNumericComponent(0, 0, 5);
    world.place(1, 0, TileKind.Stone);
    world.setWeld(0, 0, 1, 0, true);
    world.place(2, 1, TileKind.Victory);

    const enlarged = resizeWorld(world, 5, 4);
    expect(enlarged.componentStateSnapshotAt(0, 0)).toMatchObject({
      type: "delay",
      length: 5,
    });
    expect(enlarged.isWelded(0, 0, 1, 0)).toBe(true);
    expect(enlarged.kindAt(2, 1)).toBe(TileKind.Victory);
    expect(enlarged.kindAt(4, 3)).toBe(TileKind.Empty);

    const cropped = resizeWorld(world, 2, 1);
    expect(cropped.componentStateSnapshotAt(0, 0)).toMatchObject({
      type: "delay",
      length: 5,
    });
    expect(cropped.isWelded(0, 0, 1, 0)).toBe(true);
    expect(cropped.kindAt(1, 0)).toBe(TileKind.Stone);
  });

  it("translates retained configuration and welds while clipping all sides of an offset crop", () => {
    const world = new World(6, 6);
    world.place(2, 2, TileKind.Delay);
    world.configureNumericComponent(2, 2, 5);
    world.place(3, 2, TileKind.Stone);
    world.place(4, 2, TileKind.Stone);
    world.setWeld(2, 2, 3, 2, true);
    world.setWeld(3, 2, 4, 2, true);
    world.setTextBoxes([
      { id: "retained", centerX: 3.5, centerY: 3.5, text: "Retained", owner: "author" },
      { id: "outside", centerX: 0.5, centerY: 0.5, text: "Removed", owner: "author" },
    ]);

    const cropped = resizeWorld(world, 2, 2, 2, 2);
    expect(cropped.componentStateSnapshotAt(0, 0)).toMatchObject({ type: "delay", length: 5 });
    expect(cropped.kindAt(1, 0)).toBe(TileKind.Stone);
    expect(cropped.isWelded(0, 0, 1, 0)).toBe(true);
    expect(cropped.textBoxes).toEqual([
      { id: "retained", centerX: 1.5, centerY: 1.5, text: "Retained", owner: "author" },
    ]);
  });

  it("pads negative origins without losing state, nested boards, annotations, or boundary welds", () => {
    const world = new World(3, 2);
    world.place(0, 0, TileKind.Delay, Direction.Left, true);
    world.configureNumericComponent(0, 0, 5);
    world.advanceDelayAtIndex(0, -1);
    world.setCharge(0, 0, 1);
    world.place(1, 0, TileKind.Stone);
    world.setWeld(0, 0, 1, 0, true);
    world.place(0, 1, TileKind.Stone);
    world.setWeld(0, 0, 0, 1, true);
    world.place(2, 0, TileKind.RuneArray);
    const inner = world.runeArrayWorldAt(2, 0);
    inner.place(1, 1, TileKind.RuneArray);
    inner.runeArrayWorldAt(1, 1).place(0, 0, TileKind.Selector, Direction.Down, true);
    world.place(1, 1, TileKind.WireCrossing);
    world.setCrossingCharges(1, 1, 1, -1);
    world.place(2, 1, TileKind.Assembler);
    world.setIsolatedOutputCharge(2, 1, -1);
    world.setTextBoxes([
      { id: "hint", centerX: 1.25, centerY: 1, text: "Hint", owner: "author" },
    ]);

    const padded = resizeWorld(world, 4, 3, -1, -1);
    expect(JSON.parse(serializeBoard(padded, 0)).grid).toEqual([
      "....",
      `.${JSON.parse(serializeBoard(world, 0)).grid[0]}`,
      `.${JSON.parse(serializeBoard(world, 0)).grid[1]}`,
    ]);
    expect(padded.componentStateSnapshotAt(1, 1)).toEqual(world.componentStateSnapshotAt(0, 0));
    expect(padded.isWelded(1, 1, 2, 1)).toBe(true);
    expect(padded.isWelded(1, 1, 1, 2)).toBe(true);
    expect(serializeBoard(padded.runeArrayWorldAt(3, 1), 0)).toBe(serializeBoard(inner, 0));
    expect(padded.textBoxes).toEqual([
      { id: "hint", centerX: 2.25, centerY: 2, text: "Hint", owner: "author" },
    ]);
    expect(serializeBoard(resizeWorld(padded, 3, 2, 1, 1), 0)).toBe(serializeBoard(world, 0));
  });

  it("resizes every independent authored case and region while retaining metadata and current runtime edits", () => {
    const source = JSON.parse(authoredPuzzleSource());
    source.testCases[0].cycleLimit = 125;
    const imported = parseSandboxImport(JSON.stringify(source), "cases.json");
    const sessions = new WorkshopSessionController(imported.world);
    sessions.replaceActiveSandboxImport(imported);
    const authoring = imported.authoring;
    const properties = authoring.properties(4, 3);
    const standard = serializeBoard(sessions.active.world, 0);
    sessions.selectActiveSandboxTestCase("alternate");
    sessions.active.world.place(0, 0, TileKind.Delay, Direction.Down);
    sessions.active.world.configureNumericComponent(0, 0, 7);
    sessions.active.world.setTextBoxes([
      { id: "alternate", centerX: 1, centerY: 1, text: "Alternate", owner: "author" },
    ]);
    sessions.active.simulation.tick = 13;
    const alternate = serializeBoard(sessions.active.world, 0);

    sessions.resizeActiveSandboxEdge("top", 1);
    sessions.resizeActiveSandboxEdge("left", 1);

    expect(sessions.active.simulation.tick).toBe(0);
    expect(authoring.selectedTestCaseId).toBe("alternate");
    expect(authoring.properties(4, 3)).toEqual(properties);
    expect(sessions.active.world.componentStateSnapshotAt(1, 1)).toMatchObject({ type: "delay", length: 7 });
    expect(sessions.active.editableRegionAuthoring?.region.rectangles).toEqual([
      { x: 2, y: 2, width: 2, height: 1 },
    ]);
    sessions.active.world.place(1, 1, TileKind.Empty);
    sessions.resetSimulation();
    expect(sessions.active.world.kindAt(1, 1)).toBe(TileKind.Delay);

    const snapshot = sessions.snapshotActiveSandbox();
    const restored = parseSandboxImport(snapshot.source, "resized.json");
    expect(restored.authoring.selectTestCase("standard").kindAt(1, 1)).toBe(TileKind.Empty);
    expect(restored.authoring.selectTestCase("alternate").kindAt(1, 1)).toBe(TileKind.Delay);
    expect(JSON.parse(snapshot.source).testCases[0].cycleLimit).toBe(125);

    sessions.resizeActiveSandboxEdge("top", -1);
    sessions.resizeActiveSandboxEdge("left", -1);
    expect(serializeBoard(sessions.active.world, 0)).toBe(alternate);
    sessions.selectActiveSandboxTestCase("standard");
    expect(serializeBoard(sessions.active.world, 0)).toBe(standard);
    expect(sessions.active.editableRegionAuthoring?.region.rectangles).toEqual(imported.editableRegion.rectangles);
  });

  it("continues importing scene files with fresh puzzle-authoring defaults", () => {
    const world = new World(2, 2);
    world.place(0, 0, TileKind.Stone);
    const imported = parseSandboxImport(
      JSON.stringify(JSON.parse(serializePuzzleTemplate(
        (() => {
          const puzzleWorld = world.clone();
          puzzleWorld.place(1, 1, TileKind.Victory);
          return puzzleWorld;
        })(),
        new GridRegion([]),
      ))["initialBoard"]),
      "scene.json",
    );

    expect(imported.editableRegion.rectangles).toEqual([]);
    expect(imported.authoring.properties(2, 2)).toMatchObject({
      name: "Untitled Puzzle",
      description: "TODO: Describe the puzzle setup.",
    });
  });
});
