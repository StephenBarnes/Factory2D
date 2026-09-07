import { describe, expect, it } from "vitest";
import { GridRegion } from "../src/game/grid-region";
import { serializePuzzleTemplate } from "../src/game/puzzle-export";
import { parsePuzzleFile } from "../src/game/puzzle-format";
import {
  parseSandboxImport,
  resizeWorld,
} from "../src/game/sandbox-puzzle-authoring";
import { TILE_DEFINITIONS, TileKind } from "../src/simulation/tile";
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
      { id: "hint", x: 0.25, y: 0.5, width: 2.5, height: 1, text: "Standard hint", owner: "author" },
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

  it("clips fractional annotation rectangles on shrink and drops fully cropped labels", () => {
    const world = new World(4, 3);
    world.setTextBoxes([
      { id: "retained", x: 1.25, y: 0.5, width: 2, height: 2, text: "Retained", owner: "author" },
      { id: "cropped", x: 3, y: 2, width: 1, height: 1, text: "Cropped", owner: "author" },
    ]);
    const resized = resizeWorld(world, 2, 1);
    expect(resized.textBoxes).toEqual([
      { id: "retained", x: 1.25, y: 0.5, width: 0.75, height: 0.5, text: "Retained", owner: "author" },
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
      { id: "overlap", x: 1.5, y: 1.5, width: 4, height: 4, text: "Clipped", owner: "author" },
      { id: "outside", x: 0, y: 0, width: 1, height: 1, text: "Removed", owner: "author" },
    ]);

    const cropped = resizeWorld(world, 2, 2, 2, 2);
    expect(cropped.componentStateSnapshotAt(0, 0)).toMatchObject({ type: "delay", length: 5 });
    expect(cropped.kindAt(1, 0)).toBe(TileKind.Stone);
    expect(cropped.isWelded(0, 0, 1, 0)).toBe(true);
    expect(cropped.textBoxes).toEqual([
      { id: "overlap", x: 0, y: 0, width: 2, height: 2, text: "Clipped", owner: "author" },
    ]);
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
