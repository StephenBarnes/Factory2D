import { describe, expect, it } from "vitest";
import { GridRegion } from "../src/game/grid-region";
import { serializePuzzleTemplate } from "../src/game/puzzle-export";
import { parsePuzzleFile } from "../src/game/puzzle-format";
import {
  parseSandboxImport,
  resizeWorldFromTopLeft,
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
    imported.authoring.update(updatedProperties);
    expect(imported.authoring.fileName).toBe("updated-puzzle.json");
    const resized = resizeWorldFromTopLeft(imported.world, 5, 4);
    resized.place(0, 3, TileKind.Iron);
    const exportedSource = imported.authoring.serialize(resized, imported.editableRegion);
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

  it("resizes a scene from the top-left while preserving retained state and welds", () => {
    const world = new World(3, 2);
    world.place(0, 0, TileKind.Delay);
    world.configureNumericComponent(0, 0, 5);
    world.place(1, 0, TileKind.Stone);
    world.setWeld(0, 0, 1, 0, true);
    world.place(2, 1, TileKind.Victory);

    const enlarged = resizeWorldFromTopLeft(world, 5, 4);
    expect(enlarged.componentStateSnapshotAt(0, 0)).toMatchObject({
      type: "delay",
      length: 5,
    });
    expect(enlarged.isWelded(0, 0, 1, 0)).toBe(true);
    expect(enlarged.kindAt(2, 1)).toBe(TileKind.Victory);
    expect(enlarged.kindAt(4, 3)).toBe(TileKind.Empty);

    const cropped = resizeWorldFromTopLeft(world, 2, 1);
    expect(cropped.componentStateSnapshotAt(0, 0)).toMatchObject({
      type: "delay",
      length: 5,
    });
    expect(cropped.isWelded(0, 0, 1, 0)).toBe(true);
    expect(cropped.kindAt(1, 0)).toBe(TileKind.Stone);
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
