import { describe, expect, it } from "vitest";

import firstShiftFile from "../src/game/puzzles/first-shift.json";
import { parsePuzzleFile } from "../src/game/puzzle-format";
import { loadPuzzleDefinitions, PUZZLES } from "../src/game/puzzles";
import { TileKind } from "../src/simulation/tile";
import { expectDefined } from "../src/util/assert";

type JsonObject = Record<string, unknown>;

function puzzleFile(): JsonObject {
  return structuredClone(firstShiftFile) as JsonObject;
}

function objectField(object: JsonObject, field: string): JsonObject {
  const value = object[field];
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as JsonObject;
}

function arrayField(object: JsonObject, field: string): unknown[] {
  const value = object[field];
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

describe("puzzle JSON format", () => {
  it("loads every shipped puzzle through the production registry", () => {
    expect(PUZZLES.map((puzzle) => puzzle.id)).toEqual([
      "first-shift",
      "beltworks",
      "runic-relay",
    ]);
    expect(PUZZLES.map((puzzle) => puzzle.name)).toEqual([
      "First Shift",
      "Beltworks",
      "Runic Relay",
    ]);
  });

  it("parses metadata, regions, component prices, and independent initial worlds", () => {
    const parsed = parsePuzzleFile(firstShiftFile, "first-shift.json");

    expect(parsed.id).toBe("first-shift");
    expect(parsed.editableRegion.contains(8, 2)).toBe(true);
    expect(parsed.availableComponents.priceOf(TileKind.Stone)).toBe(1);
    expect(parsed.initialWorld.kindAt(5, 3)).toBe(TileKind.Sand);

    const puzzle = expectDefined(
      PUZZLES.find((candidate) => candidate.id === "first-shift"),
      "Missing shipped first-shift puzzle",
    );
    const first = puzzle.createInitialWorld();
    const second = puzzle.createInitialWorld();
    first.place(5, 3, TileKind.Empty);
    expect(second.kindAt(5, 3)).toBe(TileKind.Sand);
  });
  it("applies sparse test-case board overrides and returns independent worlds", () => {
    const parsed = parsePuzzleFile(firstShiftFile, "first-shift.json");
    expect(parsed.testCases.map((testCase) => [testCase.id, testCase.name])).toEqual([
      ["standard", "Standard load"],
      ["offset-load", "Offset load"],
    ]);

    const standard = expectDefined(parsed.testCases[0], "Missing standard test case").initialWorld;
    const offset = expectDefined(parsed.testCases[1], "Missing offset test case").initialWorld;
    expect(standard.kindAt(5, 3)).toBe(TileKind.Sand);
    expect(offset.kindAt(5, 3)).toBe(TileKind.Empty);
    expect(offset.kindAt(6, 3)).toBe(TileKind.Sand);
    expect(offset.kindAt(0, 13)).toBe(TileKind.Platform);

    offset.place(6, 3, TileKind.Empty);
    expect(standard.kindAt(5, 3)).toBe(TileKind.Sand);

    const puzzle = expectDefined(
      PUZZLES.find((candidate) => candidate.id === "first-shift"),
      "Missing shipped first-shift puzzle",
    );
    const offsetDefinition = expectDefined(
      puzzle.testCases.find((testCase) => testCase.id === "offset-load"),
      "Missing offset test-case definition",
    );
    const first = offsetDefinition.createInitialWorld();
    const second = offsetDefinition.createInitialWorld();
    first.place(6, 3, TileKind.Empty);
    expect(second.kindAt(6, 3)).toBe(TileKind.Sand);
  });

  it("strictly validates test-case identities and sparse override fields", () => {
    const emptyFile = puzzleFile();
    emptyFile.testCases = [];
    expect(() => parsePuzzleFile(emptyFile, "puzzles/empty.json")).toThrow(
      "puzzles/empty.json: Puzzle testCases must contain at least one test case",
    );

    const duplicateFile = puzzleFile();
    const testCases = arrayField(duplicateFile, "testCases");
    const duplicate = structuredClone(
      expectDefined(testCases[0], "Missing standard test case"),
    ) as JsonObject;
    testCases.push(duplicate);
    expect(() => parsePuzzleFile(duplicateFile, "puzzles/duplicate.json")).toThrow(
      'puzzles/duplicate.json: Puzzle testCases contains duplicate id "standard"',
    );

    const unknownOverrideFile = puzzleFile();
    const firstTestCase = objectField(
      expectDefined(
        arrayField(unknownOverrideFile, "testCases")[0],
        "Missing standard test case",
      ) as JsonObject,
      "overrides",
    );
    firstTestCase.goal = "Different goal";
    expect(() => parsePuzzleFile(unknownOverrideFile, "puzzles/unknown.json")).toThrow(
      'puzzles/unknown.json: Puzzle testCases[0] overrides has unknown field "goal"',
    );
  });

  it("rejects test-case boards with dimensions different from the base board", () => {
    const file = puzzleFile();
    const offsetTestCase = expectDefined(
      arrayField(file, "testCases")[1],
      "Missing offset test case",
    ) as JsonObject;
    const overrides = objectField(offsetTestCase, "overrides");
    const boardOverrides = objectField(overrides, "initialBoard");
    arrayField(boardOverrides, "grid").pop();
    boardOverrides.welds = structuredClone(
      arrayField(objectField(file, "initialBoard"), "welds"),
    );
    arrayField(boardOverrides, "welds").pop();

    expect(() => parsePuzzleFile(file, "puzzles/mismatched.json")).toThrow(
      "puzzles/mismatched.json: Puzzle testCases[1] initialBoard dimensions must match Puzzle initialBoard",
    );
  });

  it("reports the source file and exact invalid field", () => {
    const file = puzzleFile();
    file.order = -1;

    expect(() => parsePuzzleFile(file, "puzzles/broken.json")).toThrow(
      "puzzles/broken.json: Puzzle order must be an integer from 0",
    );
  });

  it("rejects unknown fields throughout the puzzle envelope", () => {
    const file = puzzleFile();
    const board = objectField(file, "initialBoard");
    board.unexpected = true;

    expect(() => parsePuzzleFile(file, "puzzles/broken.json")).toThrow(
      'puzzles/broken.json: Puzzle initialBoard has unknown field "unexpected"',
    );
  });

  it("reports invalid component entries by index", () => {
    const file = puzzleFile();
    const components = arrayField(file, "components");
    const firstComponent = expectDefined(components[0], "Missing first component") as JsonObject;
    firstComponent.code = "?";

    expect(() => parsePuzzleFile(file, "puzzles/broken.json")).toThrow(
      'puzzles/broken.json: Puzzle component 0 code "?" is not a known tile code',
    );
  });

  it("rejects registry references to missing puzzles", () => {
    const file = puzzleFile();
    file.id = "orphan";
    file.prerequisites = ["missing"];

    expect(() => loadPuzzleDefinitions({ "./puzzles/orphan.json": file })).toThrow(
      './puzzles/orphan.json: prerequisite puzzle "missing" does not exist',
    );
  });
});
