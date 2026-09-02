import { GridRegion } from "./grid-region";
import {
  parsePuzzleFile,
  PUZZLE_FORMAT,
  type ParsedPuzzleFile,
} from "./puzzle-format";
import {
  placeholderPuzzleComponents,
  serializePuzzleTemplate,
  type PuzzleExportMetadata,
} from "./puzzle-export";
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

const DEFAULT_COMPONENT_PRICE = 1;

export interface SandboxPuzzleComponentProperty {
  readonly kind: TileKind;
  readonly enabled: boolean;
  readonly price: number;
}

export interface SandboxPuzzleProperties {
  readonly width: number;
  readonly height: number;
  readonly name: string;
  readonly description: string;
  readonly components: readonly SandboxPuzzleComponentProperty[];
}

export interface SandboxPuzzleImport {
  readonly world: World;
  readonly tick: number;
  readonly editableRegion: GridRegion;
  readonly authoring: SandboxPuzzleAuthoringState;
}

interface PuzzleMetadata {
  readonly id: string;
  readonly groupId: string;
  readonly order: number;
  readonly goal: string;
  readonly features: readonly string[];
  readonly cycleLimit: number | null;
  readonly testCases: readonly unknown[];
  readonly testCaseWorlds: readonly World[];
  readonly sourceWidth: number;
  readonly sourceHeight: number;
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
  orientations: CoordinateEntry[];
  charges: CoordinateEntry[];
  crossingCharges: CoordinateEntry[];
  isolatedOutputCharges: CoordinateEntry[];
  furnaces: CoordinateEntry[];
  components: CoordinateEntry[];
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

  private constructor(
    private readonly metadata: PuzzleMetadata,
    name: string,
    description: string,
    components: readonly PricedComponent[],
  ) {
    this.nameValue = name;
    this.descriptionValue = description;
    this.availableComponentsValue = new PuzzleComponents(components);
    this.pricesByKind = [];
    for (const kind of PALETTE_KINDS) {
      this.pricesByKind[kind] = DEFAULT_COMPONENT_PRICE;
    }
    for (const component of components) {
      this.pricesByKind[component.kind] = component.price;
    }
  }

  static createDefault(width: number, height: number): SandboxPuzzleAuthoringState {
    requireBoardDimensions(width, height);
    const components = placeholderPuzzleComponents();
    return new SandboxPuzzleAuthoringState(
      {
        id: "untitled-puzzle",
        groupId: "basics",
        order: 0,
        goal: "TODO: Describe the victory condition.",
        features: [],
        cycleLimit: null,
        testCases: [
          {
            id: "standard",
            name: "Standard case",
            overrides: {},
          },
        ],
        testCaseWorlds: [],
        sourceWidth: width,
        sourceHeight: height,
      },
      "Untitled Puzzle",
      "TODO: Describe the puzzle setup.",
      components,
    );
  }

  static fromParsedPuzzle(
    parsed: ParsedPuzzleFile,
    source: Readonly<Record<string, unknown>>,
  ): SandboxPuzzleAuthoringState {
    const testCases = cloneJson(source.testCases) as readonly unknown[];
    return new SandboxPuzzleAuthoringState(
      {
        id: parsed.id,
        groupId: parsed.groupId,
        order: parsed.order,
        goal: parsed.goal,
        features: parsed.features,
        cycleLimit: source.cycleLimit === undefined ? null : parsed.cycleLimit,
        testCases,
        testCaseWorlds: parsed.testCases.map(({ initialWorld }) => initialWorld),
        sourceWidth: parsed.initialWorld.width,
        sourceHeight: parsed.initialWorld.height,
      },
      parsed.name,
      parsed.description,
      parsed.availableComponents.entries,
    );
  }

  get fileName(): string {
    return `${this.metadata.id}.json`;
  }

  get availableComponents(): PuzzleComponents {
    return this.availableComponentsValue;
  }

  properties(width: number, height: number): SandboxPuzzleProperties {
    requireBoardDimensions(width, height);
    return {
      width,
      height,
      name: this.nameValue,
      description: this.descriptionValue,
      components: PALETTE_KINDS.map((kind) => ({
        kind,
        enabled: this.availableComponentsValue.has(kind),
        price: this.pricesByKind[kind] ?? DEFAULT_COMPONENT_PRICE,
      })),
    };
  }

  update(properties: SandboxPuzzleProperties): void {
    requireBoardDimensions(properties.width, properties.height);
    const name = requireNonEmptyText(properties.name, "Puzzle name");
    const description = requireNonEmptyText(properties.description, "Puzzle description");
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

    const availableComponents = new PuzzleComponents(enabled);
    this.nameValue = name;
    this.descriptionValue = description;
    this.availableComponentsValue = availableComponents;
    for (const kind of PALETTE_KINDS) {
      this.pricesByKind[kind] = nextPrices[kind];
    }
  }

  serialize(world: World, editableRegion: GridRegion): string {
    const metadata: PuzzleExportMetadata = {
      id: this.metadata.id,
      groupId: this.metadata.groupId,
      order: this.metadata.order,
      name: this.nameValue,
      description: this.descriptionValue,
      goal: this.metadata.goal,
      features: this.metadata.features,
      cycleLimit: this.metadata.cycleLimit,
      components: this.availableComponentsValue.entries,
      testCases: resizeTestCases(
        this.metadata.testCases,
        this.metadata.testCaseWorlds,
        this.metadata.sourceWidth,
        this.metadata.sourceHeight,
        world.width,
        world.height,
      ),
    };
    return serializePuzzleTemplate(world, editableRegion, metadata);
  }
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
    authoring: SandboxPuzzleAuthoringState.createDefault(
      imported.world.width,
      imported.world.height,
    ),
  };
}

export function resizeWorldFromTopLeft(source: World, width: number, height: number): World {
  requireBoardDimensions(width, height);
  if (source.width === width && source.height === height) {
    return source.clone();
  }

  const board = JSON.parse(serializeBoard(source, 0)) as MutableSerializedBoard;
  board.width = width;
  board.height = height;
  board.tick = 0;
  board.result = "in-progress";
  board.grid = resizeRows(board.grid, width, height, ".");
  board.welds = resizedWorldWeldRows(source, width, height);
  board.orientations = filterCoordinates(board.orientations, width, height);
  board.charges = filterCoordinates(board.charges, width, height);
  board.crossingCharges = filterCoordinates(board.crossingCharges, width, height);
  board.isolatedOutputCharges = filterCoordinates(board.isolatedOutputCharges, width, height);
  board.components = filterCoordinates(board.components, width, height);
  board.furnaces = board.furnaces.filter((entry) => {
    if (!coordinateFits(entry, width, height)) {
      return false;
    }
    const orientation = source.orientationAt(entry.x, entry.y);
    const targetX = entry.x + directionX(orientation);
    const targetY = entry.y + directionY(orientation);
    return targetX >= 0 && targetX < width && targetY >= 0 && targetY < height;
  });
  return deserializeBoard(JSON.stringify(board)).world;
}

function resizeTestCases(
  source: readonly unknown[],
  sourceWorlds: readonly World[],
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): readonly unknown[] {
  const testCases = cloneJson(source) as unknown[];
  if (sourceWidth === width && sourceHeight === height) {
    return testCases;
  }
  for (let testCaseIndex = 0; testCaseIndex < testCases.length; testCaseIndex += 1) {
    const testCase = testCases[testCaseIndex];
    if (!isRecord(testCase) || !isRecord(testCase.overrides)) {
      continue;
    }
    const board = testCase.overrides.initialBoard;
    if (!isRecord(board)) {
      continue;
    }
    if (Array.isArray(board.grid)) {
      board.grid = resizeRows(board.grid as string[], width, height, ".");
    }
    if (Array.isArray(board.welds)) {
      board.welds = resizeOverrideWeldRows(board.welds as string[], width, height);
    }
    for (const field of [
      "orientations",
      "charges",
      "crossingCharges",
      "isolatedOutputCharges",
      "components",
    ] as const) {
      const entries = board[field];
      if (Array.isArray(entries)) {
        board[field] = entries.filter((entry) =>
          isCoordinateEntry(entry) && coordinateFits(entry, width, height)
        );
      }
    }
    const furnaceEntries = board.furnaces;
    const sourceWorld = sourceWorlds[testCaseIndex];
    if (Array.isArray(furnaceEntries)) {
      board.furnaces = furnaceEntries.filter((entry) => {
        if (!isCoordinateEntry(entry) || !coordinateFits(entry, width, height)) {
          return false;
        }
        if (sourceWorld === undefined) {
          return true;
        }
        const orientation = sourceWorld.orientationAt(entry.x, entry.y);
        const targetX = entry.x + directionX(orientation);
        const targetY = entry.y + directionY(orientation);
        return targetX >= 0 && targetX < width && targetY >= 0 && targetY < height;
      });
    }
  }
  return testCases;
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

function resizedWorldWeldRows(source: World, width: number, height: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      const inSource = x < source.width && y < source.height;
      const right = inSource && x + 1 < width && x + 1 < source.width &&
        source.isWelded(x, y, x + 1, y);
      const down = inSource && y + 1 < height && y + 1 < source.height &&
        source.isWelded(x, y, x, y + 1);
      row += right ? (down ? "+" : "-") : (down ? "|" : ".");
    }
    rows.push(row);
  }
  return rows;
}

function resizeOverrideWeldRows(rows: readonly string[], width: number, height: number): string[] {
  const resized = resizeRows(rows, width, height, ".");
  for (let y = 0; y < height; y += 1) {
    const cells = [...(resized[y] ?? "")];
    for (let x = 0; x < width; x += 1) {
      const value = cells[x] ?? ".";
      const right = x < width - 1 && (value === "-" || value === "+");
      const down = y < height - 1 && (value === "|" || value === "+");
      cells[x] = right ? (down ? "+" : "-") : (down ? "|" : ".");
    }
    resized[y] = cells.join("");
  }
  return resized;
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

function isCoordinateEntry(value: unknown): value is CoordinateEntry {
  return isRecord(value) && Number.isInteger(value.x) && Number.isInteger(value.y);
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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
