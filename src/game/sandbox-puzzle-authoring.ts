import { GridRegion, type GridRectangle } from "./grid-region";
import {
  MAX_PUZZLE_CYCLE_LIMIT,
  parsePuzzleAuthoringSnapshot,
  parsePuzzleFile,
  PUZZLE_FORMAT,
  PUZZLE_ID_PATTERN,
  type ParsedPuzzleFile,
} from "./puzzle-format";
import {
  serializePuzzleTemplate,
  type PuzzleExportMetadata,
} from "./puzzle-export";
import { puzzleGroupById } from "./puzzle-groups";
import { PuzzleComponents, type PricedComponent } from "./puzzle-components";
import {
  deserializeBoard,
  MAX_BOARD_HEIGHT,
  MAX_BOARD_WIDTH,
  MIN_BOARD_HEIGHT,
  MIN_BOARD_WIDTH,
  serializeBoard,
} from "../simulation/board-export";
import {
  directionX,
  directionY,
  TILE_DEFINITIONS,
  TILE_KINDS,
  TileKind,
} from "../simulation/tile";
import type { World } from "../simulation/world";
import type { TextBox } from "../simulation/text-box";
import { expectDefined } from "../util/assert";

export interface SandboxPuzzleComponentProperty {
  readonly kind: TileKind;
  readonly enabled: boolean;
  readonly price: number;
}

export interface SandboxPuzzleProperties {
  readonly width: number;
  readonly height: number;
  readonly id: string;
  readonly groupId: string;
  readonly order: number;
  readonly name: string;
  readonly description: string;
  readonly goal: string;
  readonly cycleLimit: number | null;
  readonly components: readonly SandboxPuzzleComponentProperty[];
}

export interface SandboxPuzzleImport {
  readonly world: World;
  readonly tick: number;
  readonly editableRegion: GridRegion;
  readonly authoring: SandboxPuzzleAuthoringState;
}

interface PuzzleMetadata {
  id: string;
  groupId: string;
  order: number;
  goal: string;
  cycleLimit: number | null;
}

interface AuthoredPuzzleTestCase {
  readonly id: string;
  readonly name: string;
  readonly cycleLimit: number | null;
  world: World;
}

export interface SandboxPuzzleTestCaseSummary {
  readonly id: string;
  readonly name: string;
  readonly standard: boolean;
}

interface CoordinateEntry {
  readonly x: number;
  readonly y: number;
}

interface MutableSerializedBoard {
  width: number;
  height: number;
  tick: number;
  result: string;
  grid: string[];
  orientations?: CoordinateEntry[];
  charges?: CoordinateEntry[];
  crossingCharges?: CoordinateEntry[];
  isolatedOutputCharges?: CoordinateEntry[];
  furnaces?: CoordinateEntry[];
  components?: CoordinateEntry[];
  textBoxes?: TextBox[];
  welds: string[];
}

const PALETTE_KINDS = TILE_KINDS
  .filter((kind) => TILE_DEFINITIONS[kind].palette !== null)
  .sort((left, right) => {
    const leftPalette = TILE_DEFINITIONS[left].palette;
    const rightPalette = TILE_DEFINITIONS[right].palette;
    if (leftPalette === null || rightPalette === null) {
      throw new Error("Puzzle component palette metadata is missing");
    }
    return leftPalette.order - rightPalette.order;
  });

export class SandboxPuzzleAuthoringState {
  private nameValue: string;
  private descriptionValue: string;
  private availableComponentsValue: PuzzleComponents;
  private readonly pricesByKind: (number | undefined)[];
  private selectedTestCaseIdValue = "standard";

  private constructor(
    private readonly metadata: PuzzleMetadata,
    name: string,
    description: string,
    components: readonly PricedComponent[],
    private readonly authoredTestCases: AuthoredPuzzleTestCase[],
  ) {
    if (authoredTestCases.length === 0 || authoredTestCases[0]?.id !== "standard") {
      throw new Error("Sandbox puzzle authoring requires a standard test case");
    }
    this.nameValue = name;
    this.descriptionValue = description;
    this.availableComponentsValue = new PuzzleComponents(components);
    this.pricesByKind = [];
    for (const kind of PALETTE_KINDS) {
      this.pricesByKind[kind] = TILE_DEFINITIONS[kind].defaultPrice;
    }
    for (const component of components) {
      this.pricesByKind[component.kind] = component.price;
    }
  }

  static createDefault(world: World): SandboxPuzzleAuthoringState {
    requireBoardDimensions(world.width, world.height);
    return new SandboxPuzzleAuthoringState(
      {
        id: "untitled-puzzle",
        groupId: "basics",
        order: 0,
        goal: "TODO: Describe the victory condition.",
        cycleLimit: null,
      },
      "Untitled Puzzle",
      "TODO: Describe the puzzle setup.",
      [],
      [{
        id: "standard",
        name: "Standard case",
        cycleLimit: null,
        world: world.clone(),
      }],
    );
  }

  static fromParsedPuzzle(
    parsed: ParsedPuzzleFile,
    source: Readonly<Record<string, unknown>>,
  ): SandboxPuzzleAuthoringState {
    const sourceTestCases = source.testCases;
    if (!Array.isArray(sourceTestCases)) {
      throw new Error("Parsed puzzle test cases are missing");
    }
    const authoredTestCases = parsed.testCases.map((testCase, index) => {
      const sourceCase = index === 0 ? null : sourceTestCases[index - 1];
      if (index > 0 && !isRecord(sourceCase)) {
        throw new Error(`Parsed puzzle test case ${index} is missing`);
      }
      return {
        id: testCase.id,
        name: testCase.name,
        cycleLimit: sourceCase !== null && Object.hasOwn(sourceCase, "cycleLimit")
          ? testCase.cycleLimit
          : null,
        world: testCase.initialWorld.clone(),
      };
    });
    return new SandboxPuzzleAuthoringState(
      {
        id: parsed.id,
        groupId: parsed.groupId,
        order: parsed.order,
        goal: parsed.goal,
        cycleLimit: source.cycleLimit === undefined ? null : parsed.cycleLimit,
      },
      parsed.name,
      parsed.description,
      parsed.availableComponents.entries,
      authoredTestCases,
    );
  }

  get fileName(): string {
    return `${this.metadata.id}.json`;
  }

  get availableComponents(): PuzzleComponents {
    return this.availableComponentsValue;
  }

  get testCases(): readonly SandboxPuzzleTestCaseSummary[] {
    return this.authoredTestCases.map((testCase, index) => ({
      id: testCase.id,
      name: testCase.name,
      standard: index === 0,
    }));
  }

  get selectedTestCaseId(): string {
    return this.selectedTestCaseIdValue;
  }

  selectedWorld(): World {
    return this.testCase(this.selectedTestCaseIdValue).world.clone();
  }

  saveSelectedWorld(world: World): void {
    const selected = this.testCase(this.selectedTestCaseIdValue);
    const standard = this.authoredTestCases[0];
    if (standard === undefined) {
      throw new Error("Sandbox puzzle standard test case is missing");
    }
    if (world.width !== standard.world.width || world.height !== standard.world.height) {
      throw new RangeError("Sandbox test case dimensions must match");
    }
    selected.world = world.clone();
    selected.world.resetPuzzleResult();
  }

  crop(bounds: GridRectangle): void {
    const region = new GridRegion([bounds]);
    const worlds = this.authoredTestCases.map(({ world }) => {
      if (!region.fitsWithin(world.width, world.height)) {
        throw new RangeError("Crop selection must fit within the board");
      }
      return resizeWorld(world, bounds.width, bounds.height, bounds.x, bounds.y);
    });
    this.authoredTestCases.forEach((testCase, index) => {
      testCase.world = expectDefined(worlds[index], "Cropped test case is missing");
    });
  }

  selectTestCase(testCaseId: string): World {
    const selected = this.testCase(testCaseId);
    this.selectedTestCaseIdValue = selected.id;
    return selected.world.clone();
  }

  duplicateSelectedTestCase(): World {
    const source = this.testCase(this.selectedTestCaseIdValue);
    let suffix = 1;
    while (this.authoredTestCases.some(({ id }) => id === `case-${suffix}`)) {
      suffix += 1;
    }
    const duplicate: AuthoredPuzzleTestCase = {
      id: `case-${suffix}`,
      name: `Case ${suffix}`,
      cycleLimit: source.cycleLimit,
      world: source.world.clone(),
    };
    this.authoredTestCases.push(duplicate);
    this.selectedTestCaseIdValue = duplicate.id;
    return duplicate.world.clone();
  }

  deleteSelectedTestCase(): World {
    const index = this.authoredTestCases.findIndex(
      ({ id }) => id === this.selectedTestCaseIdValue,
    );
    if (index <= 0) {
      throw new Error("The standard test case cannot be deleted");
    }
    this.authoredTestCases.splice(index, 1);
    const selected = this.authoredTestCases[Math.max(0, index - 1)];
    if (selected === undefined) {
      throw new Error("Sandbox puzzle test-case selection is missing");
    }
    this.selectedTestCaseIdValue = selected.id;
    return selected.world.clone();
  }

  properties(width: number, height: number): SandboxPuzzleProperties {
    requireBoardDimensions(width, height);
    return {
      width,
      height,
      id: this.metadata.id,
      groupId: this.metadata.groupId,
      order: this.metadata.order,
      name: this.nameValue,
      description: this.descriptionValue,
      goal: this.metadata.goal,
      cycleLimit: this.metadata.cycleLimit,
      components: PALETTE_KINDS.map((kind) => ({
        kind,
        enabled: this.availableComponentsValue.has(kind),
        price: this.pricesByKind[kind] ?? TILE_DEFINITIONS[kind].defaultPrice,
      })),
    };
  }

  update(properties: SandboxPuzzleProperties): void {
    requireBoardDimensions(properties.width, properties.height);
    const id = requireNonEmptyText(properties.id, "Puzzle id");
    if (!PUZZLE_ID_PATTERN.test(id)) {
      throw new Error("Puzzle id must contain lowercase letters, digits, and single hyphens only");
    }
    if (puzzleGroupById(properties.groupId) === undefined) {
      throw new Error(`Puzzle group "${properties.groupId}" is not defined`);
    }
    if (!Number.isFinite(properties.order)) {
      throw new Error("Puzzle order must be a finite number");
    }
    const name = requireNonEmptyText(properties.name, "Puzzle name");
    const description = requireNonEmptyText(properties.description, "Puzzle description");
    const goal = requireNonEmptyText(properties.goal, "Puzzle goal");
    if (
      properties.cycleLimit !== null &&
      (
        !Number.isSafeInteger(properties.cycleLimit) ||
        properties.cycleLimit < 1 ||
        properties.cycleLimit > MAX_PUZZLE_CYCLE_LIMIT
      )
    ) {
      throw new Error(
        `Puzzle cycle limit must be an integer from 1 through ${MAX_PUZZLE_CYCLE_LIMIT}`,
      );
    }
    if (properties.components.length !== PALETTE_KINDS.length) {
      throw new Error("Puzzle properties must include every palette component");
    }

    const seen = new Set<TileKind>();
    const enabled: PricedComponent[] = [];
    const nextPrices: (number | undefined)[] = [];
    for (const component of properties.components) {
      const definition = TILE_DEFINITIONS[component.kind];
      if (definition === undefined || definition.palette === null) {
        throw new Error(`Tile kind ${component.kind} is not a palette component`);
      }
      if (seen.has(component.kind)) {
        throw new Error(`${definition.name} is listed more than once`);
      }
      if (!Number.isSafeInteger(component.price) || component.price < 0) {
        throw new Error(`Price for ${definition.name} must be a non-negative safe integer`);
      }
      seen.add(component.kind);
      nextPrices[component.kind] = component.price;
      if (component.enabled) {
        enabled.push({ kind: component.kind, price: component.price });
      }
    }
    for (const kind of PALETTE_KINDS) {
      if (!seen.has(kind)) {
        throw new Error(`Puzzle properties are missing ${TILE_DEFINITIONS[kind].name}`);
      }
    }

    const standard = this.authoredTestCases[0];
    if (standard === undefined) {
      throw new Error("Sandbox puzzle standard test case is missing");
    }
    if (standard.world.width !== properties.width || standard.world.height !== properties.height) {
      for (const testCase of this.authoredTestCases) {
        testCase.world = resizeWorld(
          testCase.world,
          properties.width,
          properties.height,
        );
      }
    }

    const availableComponents = new PuzzleComponents(enabled);
    this.metadata.id = id;
    this.metadata.groupId = properties.groupId;
    this.metadata.order = properties.order;
    this.metadata.goal = goal;
    this.metadata.cycleLimit = properties.cycleLimit;
    this.nameValue = name;
    this.descriptionValue = description;
    this.availableComponentsValue = availableComponents;
    for (const kind of PALETTE_KINDS) {
      this.pricesByKind[kind] = nextPrices[kind];
    }
  }

  serialize(editableRegion: GridRegion): string {
    const standard = this.authoredTestCases[0];
    if (standard === undefined) {
      throw new Error("Sandbox puzzle standard test case is missing");
    }
    const metadata: PuzzleExportMetadata = {
      id: this.metadata.id,
      groupId: this.metadata.groupId,
      order: this.metadata.order,
      name: this.nameValue,
      description: this.descriptionValue,
      goal: this.metadata.goal,
      cycleLimit: this.metadata.cycleLimit,
      components: this.availableComponentsValue.entries,
      testCases: this.authoredTestCases.slice(1).map((testCase) =>
        serializeAuthoredTestCase(testCase)
      ),
    };
    return serializePuzzleTemplate(standard.world, editableRegion, metadata);
  }

  private testCase(testCaseId: string): AuthoredPuzzleTestCase {
    const testCase = this.authoredTestCases.find(({ id }) => id === testCaseId);
    if (testCase === undefined) {
      throw new Error(`Sandbox puzzle test case "${testCaseId}" does not exist`);
    }
    return testCase;
  }
}
function serializeAuthoredTestCase(testCase: AuthoredPuzzleTestCase): unknown {
  const world = testCase.world.clone();
  world.resetPuzzleResult();
  const board = JSON.parse(serializeBoard(world, 0)) as MutableSerializedBoard;
  return {
    id: testCase.id,
    name: testCase.name,
    ...(testCase.cycleLimit === null ? {} : { cycleLimit: testCase.cycleLimit }),
    overrides: {
      initialBoard: {
        grid: board.grid,
        welds: board.welds,
        orientations: board.orientations ?? [],
        charges: board.charges ?? [],
        crossingCharges: board.crossingCharges ?? [],
        isolatedOutputCharges: board.isolatedOutputCharges ?? [],
        furnaces: board.furnaces ?? [],
        components: board.components ?? [],
        textBoxes: board.textBoxes ?? [],
      },
    },
  };
}


export function parseSandboxImport(source: string, fileName: string): SandboxPuzzleImport {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${fileName}: Invalid JSON: ${message}`);
  }

  if (isRecord(value) && value.format === PUZZLE_FORMAT) {
    const parsed = parsePuzzleFile(value, fileName);
    return {
      world: parsed.initialWorld.clone(),
      tick: 0,
      editableRegion: parsed.editableRegion,
      authoring: SandboxPuzzleAuthoringState.fromParsedPuzzle(parsed, value),
    };
  }

  const imported = deserializeBoard(source);
  return {
    world: imported.world,
    tick: imported.tick,
    editableRegion: new GridRegion([]),
    authoring: SandboxPuzzleAuthoringState.createDefault(imported.world),
  };
}

export function parseSandboxSnapshot(
  source: string,
  label: string,
  selectedTestCaseId: string,
): SandboxPuzzleImport {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: Invalid JSON: ${message}`);
  }
  const parsed = parsePuzzleAuthoringSnapshot(value, label);
  if (!isRecord(value)) {
    throw new Error(`${label}: Saved sandbox snapshot must be an object`);
  }
  const authoring = SandboxPuzzleAuthoringState.fromParsedPuzzle(parsed, value);
  return {
    world: authoring.selectTestCase(selectedTestCaseId),
    tick: 0,
    editableRegion: parsed.editableRegion,
    authoring,
  };
}

/** Retains the source rectangle at (originX, originY), padding enlarged bounds with empty cells. */
export function resizeWorld(
  source: World, width: number, height: number, originX = 0, originY = 0,
): World {
  requireBoardDimensions(width, height);
  if (!Number.isSafeInteger(originX) || !Number.isSafeInteger(originY) || originX < 0 || originY < 0) {
    throw new RangeError("Board resize origin must be non-negative integers");
  }
  if (source.width === width && source.height === height && originX === 0 && originY === 0) {
    return source.clone();
  }

  const board = JSON.parse(serializeBoard(source, 0)) as MutableSerializedBoard;
  board.width = width;
  board.height = height;
  board.tick = 0;
  board.result = "in-progress";
  board.grid = resizeRows(board.grid.slice(originY).map((row) => row.slice(originX)), width, height, ".");
  board.welds = resizedWorldWeldRows(source, width, height, originX, originY);
  const translate = <T extends CoordinateEntry>(entries: readonly T[]): T[] =>
    entries.map((entry) => ({ ...entry, x: entry.x - originX, y: entry.y - originY }));
  board.orientations = filterCoordinates(translate(board.orientations ?? []), width, height);
  board.charges = filterCoordinates(translate(board.charges ?? []), width, height);
  board.crossingCharges = filterCoordinates(translate(board.crossingCharges ?? []), width, height);
  board.isolatedOutputCharges = filterCoordinates(translate(board.isolatedOutputCharges ?? []), width, height);
  board.components = filterCoordinates(translate(board.components ?? []), width, height);
  board.textBoxes = (board.textBoxes ?? [])
    .map((box) => {
      const x = Math.max(0, box.x - originX);
      const y = Math.max(0, box.y - originY);
      return {
        ...box, x, y,
        width: Math.min(width, box.x + box.width - originX) - x,
        height: Math.min(height, box.y + box.height - originY) - y,
      };
    })
    .filter((box) => box.width > 0 && box.height > 0);
  board.furnaces = translate(board.furnaces ?? []).filter((entry) => {
    if (!coordinateFits(entry, width, height)) {
      return false;
    }
    const orientation = source.orientationAt(entry.x + originX, entry.y + originY);
    const targetX = entry.x + directionX(orientation);
    const targetY = entry.y + directionY(orientation);
    return targetX >= 0 && targetX < width && targetY >= 0 && targetY < height;
  });
  return deserializeBoard(JSON.stringify(board)).world;
}


function resizeRows(
  rows: readonly string[],
  width: number,
  height: number,
  fill: string,
): string[] {
  const resized: string[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = rows[y] ?? "";
    resized.push(row.slice(0, width).padEnd(width, fill));
  }
  return resized;
}

function resizedWorldWeldRows(
  source: World, width: number, height: number, originX: number, originY: number,
): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      const sx = x + originX;
      const sy = y + originY;
      const inSource = sx < source.width && sy < source.height;
      const right = inSource && x + 1 < width && sx + 1 < source.width &&
        source.isWelded(sx, sy, sx + 1, sy);
      const down = inSource && y + 1 < height && sy + 1 < source.height &&
        source.isWelded(sx, sy, sx, sy + 1);
      row += right ? (down ? "+" : "-") : (down ? "|" : ".");
    }
    rows.push(row);
  }
  return rows;
}


function filterCoordinates<T extends CoordinateEntry>(
  entries: readonly T[],
  width: number,
  height: number,
): T[] {
  return entries.filter((entry) => coordinateFits(entry, width, height));
}

function coordinateFits(entry: CoordinateEntry, width: number, height: number): boolean {
  return entry.x >= 0 && entry.x < width && entry.y >= 0 && entry.y < height;
}


function requireBoardDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || width < MIN_BOARD_WIDTH || width > MAX_BOARD_WIDTH) {
    throw new RangeError(
      `Board width must be an integer from ${MIN_BOARD_WIDTH} through ${MAX_BOARD_WIDTH}`,
    );
  }
  if (!Number.isInteger(height) || height < MIN_BOARD_HEIGHT || height > MAX_BOARD_HEIGHT) {
    throw new RangeError(
      `Board height must be an integer from ${MIN_BOARD_HEIGHT} through ${MAX_BOARD_HEIGHT}`,
    );
  }
}

function requireNonEmptyText(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

