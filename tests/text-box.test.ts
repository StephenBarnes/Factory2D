import { describe, expect, it } from "vitest";
import { GridRegion } from "../src/game/grid-region";
import { serializePuzzleTemplate } from "../src/game/puzzle-export";
import { parsePuzzleAuthoringSnapshot, parsePuzzleFile } from "../src/game/puzzle-format";
import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { MAX_TEXT_BOXES, MAX_TEXT_BOX_TEXT_LENGTH, type TextBox } from "../src/simulation/text-box";
import { TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

const box: TextBox = {
  id: "instruction", centerX: 1, centerY: 0.875,
  text: "Input\n+1 →", owner: "player",
};

describe("board text boxes", () => {
  it("owns ingress data and keeps clone edits independent without changing tile geometry", () => {
    const world = new World(3, 3);
    const source = [{ ...box }];
    const geometryRevision = world.geometryRevision;
    const revision = world.revision;
    world.setTextBoxes(source);
    source[0]!.text = "Changed externally";
    source.length = 0;
    expect(world.textBoxes).toEqual([box]);
    expect(world.revision).toBeGreaterThan(revision);
    expect(world.geometryRevision).toBe(geometryRevision);

    const clone = world.clone();
    clone.setTextBoxes([{ ...box, text: "Clone edit" }]);
    expect(world.textBoxes).toEqual([box]);
    world.clear();
    expect(world.textBoxes).toEqual([]);
    expect(clone.textBoxes[0]?.text).toBe("Clone edit");
  });

  it.each([
    ["non-finite coordinate", [{ ...box, centerX: Number.NaN }]],
    ["infinite coordinate", [{ ...box, centerY: Infinity }]],
    ["negative coordinate", [{ ...box, centerY: -0.1 }]],
    ["out-of-board center", [{ ...box, centerX: 3.1 }]],
    ["legacy rectangle", [{ id: box.id, x: 0.25, y: 0.5, width: 1.5, height: 0.75, text: box.text, owner: box.owner }]],
    ["blank text", [{ ...box, text: " \n\t" }]],
    ["oversized text", [{ ...box, text: "a".repeat(MAX_TEXT_BOX_TEXT_LENGTH + 1) }]],
    ["blank identity", [{ ...box, id: " " }]],
    ["duplicate identity", [box, box]],
    ["unknown owner", [{ ...box, owner: "other" }]],
    ["unknown field", [{ ...box, font: "serif" }]],
    ["missing field", [{ id: "missing" }]],
    ["non-object entry", [null]],
    ["non-array list", {}],
    ["too many boxes", Array.from({ length: MAX_TEXT_BOXES + 1 }, (_, id) => ({ ...box, id: String(id) }))],
  ])("rejects %s atomically at both world and import boundaries", (_label, invalid) => {
    const world = new World(3, 3);
    world.setTextBoxes([box]);
    const revision = world.revision;
    expect(() => world.setTextBoxes(invalid as readonly TextBox[])).toThrow();
    expect(world.textBoxes).toEqual([box]);
    expect(world.revision).toBe(revision);
    const board = JSON.parse(serializeBoard(world, 0)) as Record<string, unknown>;
    board.textBoxes = invalid;
    expect(() => deserializeBoard(JSON.stringify(board))).toThrow();
  });

  it("round-trips root and nested annotations and keeps them static through physics and reset", () => {
    const world = new World(4, 4);
    world.setTextBoxes([box]);
    world.place(0, 0, TileKind.Stone);
    world.place(3, 3, TileKind.RuneArray);
    const inner = world.runeArrayWorldAt(3, 3);
    inner.setTextBoxes([{ ...box, owner: "author" }]);
    inner.place(0, 0, TileKind.Stone);
    const source = serializeBoard(world, 0);
    const imported = deserializeBoard(source).world;
    expect(imported.textBoxes).toEqual([box]);
    expect(imported.runeArrayWorldAt(3, 3).textBoxes).toEqual(inner.textBoxes);

    const baseline = imported.clone();
    const simulation = new Simulation(imported);
    simulation.step();
    expect(imported.kindAt(0, 1)).toBe(TileKind.Stone);
    expect(imported.runeArrayWorldAt(3, 3).kindAt(0, 1)).toBe(TileKind.Stone);
    expect(imported.textBoxes).toEqual([box]);
    expect(imported.runeArrayWorldAt(3, 3).textBoxes).toEqual(inner.textBoxes);
    imported.setTextBoxes([]);
    imported.runeArrayWorldAt(3, 3).setTextBoxes([]);
    simulation.resetTo(baseline);
    expect(serializeBoard(imported, 0)).toBe(source);
    imported.runeArrayWorldAt(3, 3).setTextBoxes([]);
    expect(baseline.runeArrayWorldAt(3, 3).textBoxes).toEqual(inner.textBoxes);
  });

  it("maps annotation centers with whole-board transforms while keeping text upright", () => {
    const world = new World(4, 3);
    world.setTextBoxes([box]);
    const rotated = world.transformed(1, false, false);
    expect(rotated.textBoxes).toEqual([{ ...box, centerX: 2.125, centerY: 1 }]);
    expect(rotated.transformed(3, false, false).textBoxes).toEqual([box]);
    expect(world.transformed(0, true, true).textBoxes).toEqual([{ ...box, centerX: 3, centerY: 2.125 }]);
  });

  it("translates centered-resize annotations and drops centers outside the board", () => {
    const source = new World(5, 5);
    source.setTextBoxes([
      { ...box, centerX: 1.5, centerY: 2 },
      { ...box, id: "cropped", centerX: 0.25, centerY: 0.25 },
    ]);
    const resized = new World(3, 3);
    resized.copyCenteredFrom(source);
    expect(resized.textBoxes).toEqual([{ ...box, centerX: 0.5, centerY: 1 }]);
    expect(source.textBoxes[0]?.centerX).toBe(1.5);
  });

  it("exports and imports fixed puzzle labels in base, nested, and additional-case boards", () => {
    const world = new World(4, 4);
    world.place(0, 0, TileKind.Victory);
    world.place(3, 3, TileKind.RuneArray);
    world.setTextBoxes([box]);
    world.runeArrayWorldAt(3, 3).setTextBoxes([box]);
    const additional = { ...box, text: "Extra case" };
    const source = serializePuzzleTemplate(world, new GridRegion([]), {
      id: "labels", groupId: "basics", order: 0, name: "Labels",
      difficulty: 1,
      description: "Labeled board", goal: "Read the instructions", cycleLimit: null,
      components: [{ kind: TileKind.Stone, price: 1 }],
      testCases: [{ id: "extra", name: "Extra", overrides: { initialBoard: { textBoxes: [additional] } } }],
    });
    const exported = JSON.parse(source) as {
      initialBoard: { textBoxes: TextBox[] };
      testCases: { overrides: { initialBoard: { textBoxes: TextBox[] } } }[];
    };
    expect(exported.initialBoard.textBoxes).toEqual([{ ...box, owner: "author" }]);
    expect(exported.testCases[0]?.overrides.initialBoard.textBoxes).toEqual([{ ...additional, owner: "author" }]);
    expect(world.textBoxes).toEqual([box]);
    expect(world.runeArrayWorldAt(3, 3).textBoxes).toEqual([box]);
    const parsed = parsePuzzleFile(exported, "labels.json");
    expect(parsed.initialWorld.runeArrayWorldAt(3, 3).textBoxes).toEqual([{ ...box, owner: "author" }]);
    expect(parsed.testCases[1]?.initialWorld.textBoxes).toEqual([{ ...additional, owner: "author" }]);
    expect(parsed.testCases[1]?.initialWorld.runeArrayWorldAt(3, 3).textBoxes).toEqual([{ ...box, owner: "author" }]);

    exported.initialBoard.textBoxes = [box];
    expect(parsePuzzleFile(exported, "labels.json").initialWorld.textBoxes[0]?.owner).toBe("author");
    expect(parsePuzzleAuthoringSnapshot(exported, "snapshot").initialWorld.textBoxes[0]?.owner).toBe("player");
    exported.testCases[0]!.overrides.initialBoard.textBoxes = [{ ...box, centerX: 10 }];
    expect(() => parsePuzzleFile(exported, "labels.json")).toThrow();
  });
});
