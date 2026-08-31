import { GridRegion, type GridRectangle } from "./grid-region";
import { PuzzleComponents, type PricedComponent } from "./puzzle-components";
import { deserializeBoardValue, type ImportedBoard } from "../simulation/board-export";
import { PuzzleResult } from "../simulation/puzzle-result";
import { TILE_DEFINITIONS, TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";

const PUZZLE_FORMAT = "factory2d-puzzle";
const PUZZLE_VERSION = 2;
const PUZZLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DEFAULT_PUZZLE_CYCLE_LIMIT = 1_000;
export const MAX_PUZZLE_CYCLE_LIMIT = 10_000;
const PUZZLE_FIELDS = [
  "format",
  "version",
  "id",
  "order",
  "name",
  "description",
  "goal",
  "features",
  "prerequisites",
  "components",
  "editableRegions",
  "initialBoard",
  "testCases",
] as const;
const OPTIONAL_PUZZLE_FIELDS = ["cycleLimit"] as const;
const BOARD_FIELDS = [
  "format",
  "version",
  "tick",
  "result",
  "grid",
  "orientations",
  "charges",
  "crossingCharges",
  "furnaces",
  "welds",
] as const;
const TEST_CASE_FIELDS = ["id", "name", "overrides"] as const;
const OPTIONAL_TEST_CASE_FIELDS = ["cycleLimit"] as const;
const TEST_CASE_OVERRIDE_FIELDS = ["initialBoard"] as const;
const INITIAL_BOARD_OVERRIDE_FIELDS = [
  "grid",
  "orientations",
  "charges",
  "crossingCharges",
  "furnaces",
  "welds",
] as const;

const TILE_KINDS_BY_CODE = buildTileKindsByCode();

function buildTileKindsByCode(): Readonly<Record<string, TileKind | undefined>> {
  const kindsByCode: Record<string, TileKind | undefined> = Object.create(null);
  for (let kind = TileKind.Empty; kind <= TileKind.PistonArm; kind += 1) {
    const tileKind = kind as TileKind;
    kindsByCode[TILE_DEFINITIONS[tileKind].boardCode] = tileKind;
  }
  return kindsByCode;
}

export interface ParsedPuzzleTestCase {
  readonly id: string;
  readonly name: string;
  readonly cycleLimit: number;
  readonly initialWorld: World;
}

export interface ParsedPuzzleFile {
  readonly id: string;
  readonly order: number;
  readonly name: string;
  readonly cycleLimit: number;
  readonly description: string;
  readonly goal: string;
  readonly features: readonly string[];
  readonly prerequisitePuzzleIds: readonly string[];
  readonly editableRegion: GridRegion;
  readonly availableComponents: PuzzleComponents;
  readonly initialWorld: World;
  readonly testCases: readonly ParsedPuzzleTestCase[];
}

export function parsePuzzleFile(value: unknown, fileName: string): ParsedPuzzleFile {
  try {
    return parsePuzzleFileValue(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${fileName}: ${message}`);
  }
}

function parsePuzzleFileValue(value: unknown): ParsedPuzzleFile {
  const puzzle = requireExactObject(
    value,
    "Puzzle",
    PUZZLE_FIELDS,
    OPTIONAL_PUZZLE_FIELDS,
  );
  if (puzzle.format !== PUZZLE_FORMAT) {
    throw new Error(`Puzzle format must be "${PUZZLE_FORMAT}"`);
  }
  if (puzzle.version !== PUZZLE_VERSION) {
    throw new Error(`Puzzle version must be ${PUZZLE_VERSION}`);
  }

  const id = requireNonEmptyString(puzzle.id, "Puzzle id");
  if (!PUZZLE_ID_PATTERN.test(id)) {
    throw new Error("Puzzle id must contain lowercase letters, digits, and single hyphens only");
  }
  const order = requireInteger(puzzle.order, "Puzzle order", 0, Number.MAX_SAFE_INTEGER);
  const name = requireNonEmptyString(puzzle.name, "Puzzle name");
  const description = requireNonEmptyString(puzzle.description, "Puzzle description");
  const goal = requireNonEmptyString(puzzle.goal, "Puzzle goal");
  const cycleLimit = parseCycleLimit(puzzle.cycleLimit, "Puzzle cycleLimit");
  const features = parseUniqueStrings(puzzle.features, "Puzzle features");
  const prerequisitePuzzleIds = parseUniqueStrings(
    puzzle.prerequisites,
    "Puzzle prerequisites",
  );
  for (const prerequisiteId of prerequisitePuzzleIds) {
    if (!PUZZLE_ID_PATTERN.test(prerequisiteId)) {
      throw new Error(
        `Puzzle prerequisite "${prerequisiteId}" must be a lowercase hyphenated identifier`,
      );
    }
    if (prerequisiteId === id) {
      throw new Error("Puzzle cannot require itself");
    }
  }

  const availableComponents = parseComponents(puzzle.components);
  const editableRegion = parseEditableRegion(puzzle.editableRegions);
  const board = requireExactObject(puzzle.initialBoard, "Puzzle initialBoard", BOARD_FIELDS);
  const initialWorld = parseInitialWorld(board, "Puzzle initialBoard");
  if (!editableRegion.fitsWithin(initialWorld.width, initialWorld.height)) {
    throw new Error("Puzzle editableRegions must fit within initialBoard dimensions");
  }
  const testCases = parseTestCases(puzzle.testCases, board, initialWorld, cycleLimit);
  return Object.freeze({
    id,
    order,
    name,
    cycleLimit,
    description,
    goal,
    features,
    prerequisitePuzzleIds,
    editableRegion,
    availableComponents,
    initialWorld,
    testCases,
  });
}

function parseInitialWorld(board: Record<string, unknown>, label: string): World {
  let importedBoard: ImportedBoard;
  try {
    importedBoard = deserializeBoardValue(board);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is invalid: ${message}`);
  }
  if (importedBoard.tick !== 0) {
    throw new Error(`${label} tick must be 0`);
  }
  if (importedBoard.world.puzzleResult !== PuzzleResult.InProgress) {
    throw new Error(`${label} result must be "in-progress"`);
  }
  requireVictoryBlock(importedBoard.world, label);
  return importedBoard.world;
}
function requireVictoryBlock(world: World, label: string): void {
  for (let index = 0; index < world.cellCount; index += 1) {
    if (world.kindAtIndex(index) === TileKind.Victory) {
      return;
    }
  }
  throw new Error(`${label} must contain at least one victory block`);
}


function parseTestCases(
  value: unknown,
  baseBoard: Record<string, unknown>,
  baseWorld: World,
  puzzleCycleLimit: number,
): readonly ParsedPuzzleTestCase[] {
  const entries = requireArray(value, "Puzzle testCases");
  if (entries.length === 0) {
    throw new Error("Puzzle testCases must contain at least one test case");
  }

  const testCases: ParsedPuzzleTestCase[] = [];
  const seenIds = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const label = `Puzzle testCases[${index}]`;
    const entry = requireExactObject(
      entries[index],
      label,
      TEST_CASE_FIELDS,
      OPTIONAL_TEST_CASE_FIELDS,
    );
    const id = requireNonEmptyString(entry.id, `${label} id`);
    if (!PUZZLE_ID_PATTERN.test(id)) {
      throw new Error(
        `${label} id must contain lowercase letters, digits, and single hyphens only`,
      );
    }
    if (seenIds.has(id)) {
      throw new Error(`Puzzle testCases contains duplicate id "${id}"`);
    }
    seenIds.add(id);

    const name = requireNonEmptyString(entry.name, `${label} name`);
    const cycleLimit = Object.hasOwn(entry, "cycleLimit")
      ? parseCycleLimit(entry.cycleLimit, `${label} cycleLimit`)
      : puzzleCycleLimit;
    const overrides = requireSparseObject(
      entry.overrides,
      `${label} overrides`,
      TEST_CASE_OVERRIDE_FIELDS,
    );
    const initialBoardOverrides = Object.hasOwn(overrides, "initialBoard")
      ? requireSparseObject(
          overrides.initialBoard,
          `${label} overrides initialBoard`,
          INITIAL_BOARD_OVERRIDE_FIELDS,
        )
      : {};
    const initialWorld = parseInitialWorld(
      { ...baseBoard, ...initialBoardOverrides },
      `${label} initialBoard`,
    );
    if (
      initialWorld.width !== baseWorld.width ||
      initialWorld.height !== baseWorld.height
    ) {
      throw new Error(
        `${label} initialBoard dimensions must match Puzzle initialBoard`,
      );
    }
    testCases.push(Object.freeze({ id, name, cycleLimit, initialWorld }));
  }
  return Object.freeze(testCases);
}

function parseComponents(value: unknown): PuzzleComponents {
  const entries = requireArray(value, "Puzzle components");
  const components: PricedComponent[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const label = `Puzzle component ${index}`;
    const entry = requireExactObject(entries[index], label, ["code", "price"]);
    const code = requireNonEmptyString(entry.code, `${label} code`);
    if (code.length !== 1) {
      throw new Error(`${label} code must contain exactly one character`);
    }
    const kind = TILE_KINDS_BY_CODE[code];
    if (kind === undefined) {
      throw new Error(`${label} code "${code}" is not a known tile code`);
    }
    const price = requireInteger(entry.price, `${label} price`, 0, Number.MAX_SAFE_INTEGER);
    components.push({ kind, price });
  }

  try {
    return new PuzzleComponents(components);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Puzzle components are invalid: ${message}`);
  }
}

function parseEditableRegion(value: unknown): GridRegion {
  const entries = requireArray(value, "Puzzle editableRegions");
  if (entries.length === 0) {
    throw new Error("Puzzle editableRegions must contain at least one rectangle");
  }
  const rectangles: GridRectangle[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const label = `Puzzle editableRegions[${index}]`;
    const entry = requireExactObject(entries[index], label, ["x", "y", "width", "height"]);
    rectangles.push({
      x: requireInteger(entry.x, `${label}.x`, 0, Number.MAX_SAFE_INTEGER),
      y: requireInteger(entry.y, `${label}.y`, 0, Number.MAX_SAFE_INTEGER),
      width: requireInteger(entry.width, `${label}.width`, 1, Number.MAX_SAFE_INTEGER),
      height: requireInteger(entry.height, `${label}.height`, 1, Number.MAX_SAFE_INTEGER),
    });
  }
  return new GridRegion(rectangles);
}

function parseUniqueStrings(value: unknown, label: string): readonly string[] {
  const entries = requireArray(value, label);
  const strings: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = requireNonEmptyString(entries[index], `${label}[${index}]`);
    if (seen.has(entry)) {
      throw new Error(`${label} contains duplicate value "${entry}"`);
    }
    seen.add(entry);
    strings.push(entry);
  }
  return Object.freeze(strings);
}

function parseCycleLimit(value: unknown, label: string): number {
  if (value === undefined) {
    return DEFAULT_PUZZLE_CYCLE_LIMIT;
  }
  return requireInteger(value, label, 1, MAX_PUZZLE_CYCLE_LIMIT);
}

function requireExactObject(
  value: unknown,
  label: string,
  requiredFields: readonly string[],
  optionalFields: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const object = value as Record<string, unknown>;
  for (const field of requiredFields) {
    if (!Object.hasOwn(object, field)) {
      throw new Error(`${label} is missing required field "${field}"`);
    }
  }
  for (const field of Object.keys(object)) {
    if (!requiredFields.includes(field) && !optionalFields.includes(field)) {
      throw new Error(`${label} has unknown field "${field}"`);
    }
  }
  return object;
}
function requireSparseObject(
  value: unknown,
  label: string,
  fields: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const object = value as Record<string, unknown>;
  for (const field of Object.keys(object)) {
    if (!fields.includes(field)) {
      throw new Error(`${label} has unknown field "${field}"`);
    }
  }
  return object;
}


function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

