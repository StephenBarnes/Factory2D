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
  comparePaletteKinds,
  directionX,
  directionY,
  TILE_DEFINITIONS,
  TILE_KINDS,
  TileKind,
} from "../simulation/tile";
import type { World } from "../simulation/world";
import type { TextBox } from "../simulation/text-box";
import { expectDefined } from "../util/assert";
import { parsePuzzleDifficulty, type PuzzleDifficulty } from "./puzzle-difficulty";

export type BoardEdge = "top" | "right" | "bottom" | "left";

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
  readonly difficulty: PuzzleDifficulty;
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
  difficulty: PuzzleDifficulty;
  goal: string;
  cycleLimit: number | null;
}

interface AuthoredPuzzleTestCase {
  readonly id: string;
  readonly name: string;
  readonly cycleLimit: number | null;
  world: World;
}

interface SandboxPuzzleAuthoringSnapshot {
  readonly properties: SandboxPuzzleProperties;
  readonly testCases: readonly {
    readonly id: string;
    readonly name: string;
    readonly cycleLimit: number | null;
    readonly board: string;
  }[];
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
  mirrored?: CoordinateEntry[];
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
  .sort(comparePaletteKinds);

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
        difficulty: 1,
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
        difficulty: parsed.difficulty,
        goal: parsed.goal,
        cycleLimit: source.cycleLimit === undefined ? null : parsed.cycleLimit,
      },
      parsed.name,
      parsed.description,
      parsed.availableComponents.entries,
      authoredTestCases,
    );
  }

  /** Restores an internal editing snapshot without puzzle-import normalization. */
  static fromSnapshot(source: string, selectedTestCaseId: string): SandboxPuzzleAuthoringState {
    const snapshot = JSON.parse(source) as SandboxPuzzleAuthoringSnapshot;
    const properties = snapshot.properties;
    const authoring = new SandboxPuzzleAuthoringState(
      {
        id: properties.id,
        groupId: properties.groupId,
        order: properties.order,
        difficulty: properties.difficulty,
        goal: properties.goal,
        cycleLimit: properties.cycleLimit,
      },
      properties.name,
      properties.description,
      properties.components.filter(({ enabled }) => enabled),
      snapshot.testCases.map(({ board, ...testCase }) => ({
        ...testCase,
        world: deserializeBoard(board).world,
      })),
    );
    for (const { kind, price } of properties.components) {
      authoring.pricesByKind[kind] = price;
    }
    authoring.selectedTestCaseIdValue = authoring.testCase(selectedTestCaseId).id;
    return authoring;
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

  resizeEdge(edge: BoardEdge, delta: 1 | -1, currentWorld: World): GridRectangle {
    const horizontal = edge === "left" || edge === "right";
    const bounds = {
      x: edge === "left" ? -delta : 0,
      y: edge === "top" ? -delta : 0,
      width: currentWorld.width + (horizontal ? delta : 0),
      height: currentWorld.height + (horizontal ? 0 : delta),
    };
    requireBoardDimensions(bounds.width, bounds.height);
    const selected = this.testCase(this.selectedTestCaseIdValue);
    if (currentWorld.width !== selected.world.width || currentWorld.height !== selected.world.height) {
      throw new RangeError("Sandbox test case dimensions must match");
    }
    const worlds = this.authoredTestCases.map((testCase) =>
      resizeWorld(
        testCase === selected ? currentWorld : testCase.world,
        bounds.width, bounds.height, bounds.x, bounds.y,
      )
    );
    this.authoredTestCases.forEach((testCase, index) => {
      testCase.world = expectDefined(worlds[index], "Resized test case is missing");
    });
    return bounds;
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
      difficulty: this.metadata.difficulty,
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
    const difficulty = parsePuzzleDifficulty(properties.difficulty);
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
    this.metadata.difficulty = difficulty;
    this.metadata.goal = goal;
    this.metadata.cycleLimit = properties.cycleLimit;
    this.nameValue = name;
    this.descriptionValue = description;
    this.availableComponentsValue = availableComponents;
    for (const kind of PALETTE_KINDS) {
      this.pricesByKind[kind] = nextPrices[kind];
    }
  }

  /** Keeps disabled prices and text ownership, unlike the exported puzzle format. */
  serializeSnapshot(): string {
    const standard = expectDefined(this.authoredTestCases[0], "Sandbox standard case is missing");
    const snapshot: SandboxPuzzleAuthoringSnapshot = {
      properties: this.properties(standard.world.width, standard.world.height),
      testCases: this.authoredTestCases.map(({ world, ...testCase }) => ({
        ...testCase,
        board: serializeBoard(world, 0),
      })),
    };
    return JSON.stringify(snapshot);
  }

  serialize(editableRegion: GridRegion): string {
    const standard = this.authoredTestCases[0];
    if (standard === undefined) {
      throw new Error("Sandbox puzzle standard test case is missing");
    }
    const standardBoard = serializeAuthoredBoard(standard.world);
    const standardFields = Object.fromEntries(
      Object.entries(standardBoard).map(([key, value]) => [key, JSON.stringify(value)]),
    );
    const metadata: PuzzleExportMetadata = {
      id: this.metadata.id,
      groupId: this.metadata.groupId,
      order: this.metadata.order,
      name: this.nameValue,
      difficulty: this.metadata.difficulty,
      description: this.descriptionValue,
      goal: this.metadata.goal,
      cycleLimit: this.metadata.cycleLimit,
      components: this.availableComponentsValue.entries,
      testCases: this.authoredTestCases.slice(1).map((testCase) =>
        serializeAuthoredTestCase(testCase, standardFields)
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
function serializeAuthoredBoard(world: World): Record<string, unknown> {
  const board = JSON.parse(serializeBoard(world, 0)) as MutableSerializedBoard;
  return {
    grid: board.grid,
    welds: board.welds,
    orientations: board.orientations ?? [],
    mirrored: board.mirrored ?? [],
    charges: board.charges ?? [],
    crossingCharges: board.crossingCharges ?? [],
    isolatedOutputCharges: board.isolatedOutputCharges ?? [],
    furnaces: board.furnaces ?? [],
    components: board.components ?? [],
    textBoxes: board.textBoxes ?? [],
  };
}

function serializeAuthoredTestCase(
  testCase: AuthoredPuzzleTestCase,
  standardFields: Readonly<Record<string, string>>,
): unknown {
  // Overrides replace whole fields. In particular, [] must clear inherited state.
  const initialBoard = Object.fromEntries(
    Object.entries(serializeAuthoredBoard(testCase.world)).filter(
      ([key, value]) => JSON.stringify(value) !== standardFields[key],
    ),
  );
  return {
    id: testCase.id,
    name: testCase.name,
    ...(testCase.cycleLimit === null ? {} : { cycleLimit: testCase.cycleLimit }),
    overrides: Object.keys(initialBoard).length === 0 ? {} : { initialBoard },
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
  if (!Number.isSafeInteger(originX) || !Number.isSafeInteger(originY)) {
    throw new RangeError("Board resize origin must be safe integers");
  }
  if (source.width === width && source.height === height && originX === 0 && originY === 0) {
    return source.clone();
  }

  const board = JSON.parse(serializeBoard(source, 0)) as MutableSerializedBoard;
  board.width = width;
  board.height = height;
  board.tick = 0;
  board.result = "in-progress";
  board.grid = resizeRows(board.grid, width, height, originX, originY);
  board.welds = resizedWorldWeldRows(source, width, height, originX, originY);
  const translate = <T extends CoordinateEntry>(entries: readonly T[]): T[] =>
    entries.map((entry) => ({ ...entry, x: entry.x - originX, y: entry.y - originY }));
  board.orientations = filterCoordinates(translate(board.orientations ?? []), width, height);
  board.mirrored = filterCoordinates(translate(board.mirrored ?? []), width, height);
  board.charges = filterCoordinates(translate(board.charges ?? []), width, height);
  board.crossingCharges = filterCoordinates(translate(board.crossingCharges ?? []), width, height);
  board.isolatedOutputCharges = filterCoordinates(translate(board.isolatedOutputCharges ?? []), width, height);
  board.components = filterCoordinates(translate(board.components ?? []), width, height);
  board.textBoxes = (board.textBoxes ?? [])
    .map((box) => ({
      ...box, centerX: box.centerX - originX, centerY: box.centerY - originY,
    }))
    .filter((box) => box.centerX >= 0 && box.centerX <= width && box.centerY >= 0 && box.centerY <= height);
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
  originX: number,
  originY: number,
): string[] {
  const resized: string[] = [];
  const padding = ".".repeat(Math.min(width, Math.max(0, -originX)));
  const start = Math.max(0, originX);
  const end = Math.max(0, originX + width);
  for (let y = 0; y < height; y += 1) {
    const row = rows[y + originY] ?? "";
    resized.push((padding + row.slice(start, end)).padEnd(width, "."));
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
      const inSource = sx >= 0 && sy >= 0 && sx < source.width && sy < source.height;
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

