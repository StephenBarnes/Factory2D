import { describe, expect, it } from "vitest";
import { GridRegion } from "../src/game/grid-region";
import { serializePuzzleTemplate } from "../src/game/puzzle-export";
import { parsePuzzleFile, PUZZLE_FORMAT, PUZZLE_VERSION } from "../src/game/puzzle-format";
import { PuzzleResult } from "../src/simulation/puzzle-result";
import { TILE_DEFINITIONS, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("puzzle export", () => {
  it("wraps the current scene in an editable puzzle template", () => {
    const world = new World(4, 3);
    world.place(1, 1, TileKind.Stone);
    world.place(3, 0, TileKind.Victory);
    world.markPuzzleResult(PuzzleResult.Won);

    const source = serializePuzzleTemplate(
      world,
      new GridRegion([
        { x: 0, y: 0, width: 2, height: 2 },
        { x: 3, y: 2, width: 1, height: 1 },
      ]),
    );
    const exported = JSON.parse(source) as {
      readonly format: string;
      readonly version: number;
      readonly width: number;
      readonly height: number;
      readonly components: readonly { readonly code: string; readonly price: number }[];
      readonly editableRegions: readonly {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      }[];
      readonly initialBoard: {
        readonly width: number;
        readonly height: number;
        readonly tick: number;
        readonly result: string;
        readonly grid: readonly string[];
      };
      readonly testCases: readonly {
        readonly id: string;
        readonly name: string;
        readonly overrides: Readonly<Record<string, unknown>>;
      }[];
    };

    expect(exported.format).toBe(PUZZLE_FORMAT);
    expect(exported.version).toBe(PUZZLE_VERSION);
    expect([exported.width, exported.height]).toEqual([4, 3]);
    expect(exported.initialBoard).toMatchObject({
      width: 4,
      height: 3,
      tick: 0,
      result: "in-progress",
      grid: ["...V", ".#..", "...."],
    });
    expect(exported.editableRegions).toEqual([
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 3, y: 2, width: 1, height: 1 },
    ]);
    expect(exported.testCases).toEqual([
      { id: "standard", name: "Standard case", overrides: {} },
    ]);
    expect(exported.components).toContainEqual({
      code: TILE_DEFINITIONS[TileKind.Stone].boardCode,
      price: 1,
    });
    expect(exported.components).not.toContainEqual(expect.objectContaining({
      code: TILE_DEFINITIONS[TileKind.PistonArm].boardCode,
    }));

    const parsed = parsePuzzleFile(exported, "exported-puzzle.json");
    expect(parsed.initialWorld.kindAt(1, 1)).toBe(TileKind.Stone);
    expect(parsed.editableRegion.contains(3, 2)).toBe(true);
    expect(parsed.testCases).toHaveLength(1);
    expect(world.puzzleResult).toBe(PuzzleResult.Won);
  });

  it("exports and parses an empty editable region", () => {
    const world = new World(2, 2);
    world.place(0, 0, TileKind.Victory);

    const source = serializePuzzleTemplate(world, new GridRegion([]));
    const exported = JSON.parse(source) as { readonly editableRegions: readonly unknown[] };

    expect(exported.editableRegions).toEqual([]);
    expect(parsePuzzleFile(exported, "empty-region.json").editableRegion.rectangles).toEqual([]);
  });
});
