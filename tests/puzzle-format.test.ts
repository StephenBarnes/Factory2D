import { describe, expect, it } from "vitest";

import {
  DEFAULT_PUZZLE_CYCLE_LIMIT,
  MAX_PUZZLE_CYCLE_LIMIT,
  parsePuzzleFile,
} from "../src/game/puzzle-format";
import { loadPuzzleDefinitions, PUZZLES } from "../src/game/puzzles";
import { TileKind } from "../src/simulation/tile";
import { expectDefined } from "../src/util/assert";

type JsonObject = Record<string, unknown>;

const TEST_PUZZLE_ID = "parser-fixture";

function puzzleFile(): JsonObject {
  return {
    format: "factory2d-puzzle",
    version: 2,
    id: TEST_PUZZLE_ID,
    order: 0,
    name: "Parser Fixture",
    description: "Controlled parser test data.",
    goal: "Exercise the puzzle format.",
    features: ["Parsing"],
    prerequisites: [],
    components: [
      { code: "#", price: 1 },
      { code: "=", price: 3 },
    ],
    editableRegions: [{ x: 1, y: 1, width: 2, height: 2 }],
    initialBoard: {
      format: "factory2d-board",
      version: 8,
      tick: 0,
      result: "in-progress",
      grid: [
        "V...",
        ".:..",
        "....",
        "=...",
      ],
      orientations: [],
      charges: [],
      crossingCharges: [],
      furnaces: [],
      welds: [
        "....",
        "....",
        "....",
        "....",
      ],
    },
    testCases: [
      {
        id: "standard",
        name: "Standard load",
        overrides: {},
      },
      {
        id: "offset-load",
        name: "Offset load",
        overrides: {
          initialBoard: {
            grid: [
              "V...",
              "..:.",
              "....",
              "=...",
            ],
          },
        },
      },
    ],
  };
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
    expect(PUZZLES.length).toBeGreaterThan(0);
    for (const puzzle of PUZZLES) {
      expect(puzzle.id).not.toBe("");
      expect(puzzle.name).not.toBe("");
      expect(puzzle.testCases.length).toBeGreaterThan(0);
    }
  });

  it("parses metadata, regions, component prices, and independent initial worlds", () => {
    const parsed = parsePuzzleFile(puzzleFile(), "parser-fixture.json");

    expect(parsed.id).toBe(TEST_PUZZLE_ID);
    expect(parsed.editableRegion.contains(1, 1)).toBe(true);
    expect(parsed.availableComponents.priceOf(TileKind.Stone)).toBe(1);
    expect(parsed.initialWorld.kindAt(1, 1)).toBe(TileKind.Sand);

    const puzzle = expectDefined(
      loadPuzzleDefinitions({
        [`./puzzles/${TEST_PUZZLE_ID}.json`]: puzzleFile(),
      })[0],
      "Missing loaded parser fixture",
    );
    const first = puzzle.createInitialWorld();
    const second = puzzle.createInitialWorld();
    first.place(1, 1, TileKind.Empty);
    expect(second.kindAt(1, 1)).toBe(TileKind.Sand);
  });
  it("defaults, inherits, overrides, and bounds test cycle limits", () => {
    const defaults = parsePuzzleFile(puzzleFile(), "parser-fixture.json");
    expect(defaults.cycleLimit).toBe(DEFAULT_PUZZLE_CYCLE_LIMIT);
    expect(defaults.testCases.map((testCase) => testCase.cycleLimit)).toEqual([
      DEFAULT_PUZZLE_CYCLE_LIMIT,
      DEFAULT_PUZZLE_CYCLE_LIMIT,
    ]);

    const configuredFile = puzzleFile();
    configuredFile.cycleLimit = 250;
    const firstTestCase = expectDefined(
      arrayField(configuredFile, "testCases")[0],
      "Missing standard test case",
    ) as JsonObject;
    firstTestCase.cycleLimit = 12;
    const configured = parsePuzzleFile(configuredFile, "configured.json");
    expect(configured.cycleLimit).toBe(250);
    expect(configured.testCases.map((testCase) => testCase.cycleLimit)).toEqual([12, 250]);

    configuredFile.cycleLimit = MAX_PUZZLE_CYCLE_LIMIT + 1;
    expect(() => parsePuzzleFile(configuredFile, "invalid.json")).toThrow(
      `invalid.json: Puzzle cycleLimit must be an integer from 1 through ${MAX_PUZZLE_CYCLE_LIMIT}`,
    );

    configuredFile.cycleLimit = 250;
    firstTestCase.cycleLimit = 0;
    expect(() => parsePuzzleFile(configuredFile, "invalid-case.json")).toThrow(
      "invalid-case.json: Puzzle testCases[0] cycleLimit must be an integer from 1",
    );
  });

  it("applies sparse test-case board overrides and returns independent worlds", () => {
    const parsed = parsePuzzleFile(puzzleFile(), "parser-fixture.json");
    expect(parsed.testCases.map((testCase) => [testCase.id, testCase.name])).toEqual([
      ["standard", "Standard load"],
      ["offset-load", "Offset load"],
    ]);

    const standard = expectDefined(parsed.testCases[0], "Missing standard test case").initialWorld;
    const offset = expectDefined(parsed.testCases[1], "Missing offset test case").initialWorld;
    expect(standard.kindAt(1, 1)).toBe(TileKind.Sand);
    expect(offset.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(offset.kindAt(2, 1)).toBe(TileKind.Sand);
    expect(offset.kindAt(0, 3)).toBe(TileKind.Platform);

    offset.place(2, 1, TileKind.Empty);
    expect(standard.kindAt(1, 1)).toBe(TileKind.Sand);

    const puzzle = expectDefined(
      loadPuzzleDefinitions({
        [`./puzzles/${TEST_PUZZLE_ID}.json`]: puzzleFile(),
      })[0],
      "Missing loaded parser fixture",
    );
    const offsetDefinition = expectDefined(
      puzzle.testCases.find((testCase) => testCase.id === "offset-load"),
      "Missing offset test-case definition",
    );
    const first = offsetDefinition.createInitialWorld();
    const second = offsetDefinition.createInitialWorld();
    first.place(2, 1, TileKind.Empty);
    expect(second.kindAt(2, 1)).toBe(TileKind.Sand);
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

  it("requires a victory block in the base board and every test case", () => {
    const baseWithoutVictory = puzzleFile();
    const baseBoard = objectField(baseWithoutVictory, "initialBoard");
    arrayField(baseBoard, "grid")[0] = "....";
    expect(() => parsePuzzleFile(baseWithoutVictory, "puzzles/no-victory.json")).toThrow(
      "puzzles/no-victory.json: Puzzle initialBoard must contain at least one victory block",
    );

    const testCaseWithoutVictory = puzzleFile();
    const offsetTestCase = expectDefined(
      arrayField(testCaseWithoutVictory, "testCases")[1],
      "Missing offset test case",
    ) as JsonObject;
    const overrides = objectField(offsetTestCase, "overrides");
    const overrideBoard = objectField(overrides, "initialBoard");
    arrayField(overrideBoard, "grid")[0] = "....";
    expect(() => parsePuzzleFile(testCaseWithoutVictory, "puzzles/no-test-victory.json")).toThrow(
      "puzzles/no-test-victory.json: Puzzle testCases[1] initialBoard must contain at least one victory block",
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
