import type { GridRegion } from "./grid-region";
import { parsePuzzleFile, type ParsedPuzzleFile } from "./puzzle-format";
import type { PuzzleComponents } from "./puzzle-components";
import { TileKind } from "../simulation/tile";
import { World } from "../simulation/world";
import { expectDefined } from "../util/assert";

export type PuzzleId = string;

export interface PuzzleTestCaseDefinition {
  readonly id: string;
  readonly name: string;
  readonly cycleLimit: number;
  readonly createInitialWorld: () => World;
}

export interface PuzzleDefinition {
  readonly id: PuzzleId;
  readonly name: string;
  readonly cycleLimit: number;
  readonly description: string;
  readonly features: readonly string[];
  readonly goal: string;
  readonly editableRegion: GridRegion;
  readonly availableComponents: PuzzleComponents;
  readonly prerequisitePuzzleIds: readonly PuzzleId[];
  readonly createInitialWorld: () => World;
  readonly testCases: readonly PuzzleTestCaseDefinition[];
}

function addFloor(world: World): void {
  for (let x = 0; x < world.width; x += 1) {
    world.place(x, world.height - 1, TileKind.Platform);
  }
}


export function createSandboxWorld(): World {
  const world = new World(20, 14);
  addFloor(world);
  for (let x = 3; x <= 7; x += 1) {
    world.place(x, 9, TileKind.Platform);
  }
  for (let x = 13; x <= 16; x += 1) {
    world.place(x, 11, TileKind.Platform);
  }
  world.place(5, 3, TileKind.Sand);
  world.place(5, 4, TileKind.Sand);
  world.place(11, 2, TileKind.Sand);
  world.place(15, 5, TileKind.Sand);
  return world;
}

interface LoadedPuzzle {
  readonly sourcePath: string;
  readonly parsed: ParsedPuzzleFile;
}

const PUZZLE_FILE_MODULES: Readonly<Record<string, unknown>> =
  typeof process === "undefined"
    ? import.meta.glob<unknown>("./puzzles/*.json", {
        eager: true,
        import: "default",
      })
    : loadNodePuzzleFiles();

function loadNodePuzzleFiles(): Readonly<Record<string, unknown>> {
  const fileSystem = process.getBuiltinModule("node:fs");
  const puzzleDirectory = "./puzzles/";
  const directoryUrl = new URL(puzzleDirectory, import.meta.url);
  const files: Record<string, unknown> = Object.create(null);
  for (const fileName of fileSystem.readdirSync(directoryUrl)) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const sourcePath = `./puzzles/${fileName}`;
    const source = fileSystem.readFileSync(new URL(fileName, directoryUrl), "utf8");
    try {
      files[sourcePath] = JSON.parse(source) as unknown;
    } catch {
      throw new Error(`${sourcePath}: file is not valid JSON`);
    }
  }
  return files;
}

export const PUZZLES = loadPuzzleDefinitions(PUZZLE_FILE_MODULES);

export function loadPuzzleDefinitions(
  files: Readonly<Record<string, unknown>>,
): readonly PuzzleDefinition[] {
  const loadedPuzzles: LoadedPuzzle[] = [];
  const loadedById: Record<string, LoadedPuzzle | undefined> = Object.create(null);
  const loadedByOrder: Record<number, LoadedPuzzle | undefined> = Object.create(null);

  for (const [sourcePath, value] of Object.entries(files)) {
    const parsed = parsePuzzleFile(value, sourcePath);
    const fileName = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
    if (fileName !== `${parsed.id}.json`) {
      throw new Error(
        `${sourcePath}: file name must match puzzle id "${parsed.id}.json"`,
      );
    }
    const existingId = loadedById[parsed.id];
    if (existingId !== undefined) {
      throw new Error(
        `${sourcePath}: puzzle id "${parsed.id}" is already defined by ${existingId.sourcePath}`,
      );
    }
    const existingOrder = loadedByOrder[parsed.order];
    if (existingOrder !== undefined) {
      throw new Error(
        `${sourcePath}: puzzle order ${parsed.order} is already used by ${existingOrder.sourcePath}`,
      );
    }
    const loaded = { sourcePath, parsed };
    loadedPuzzles.push(loaded);
    loadedById[parsed.id] = loaded;
    loadedByOrder[parsed.order] = loaded;
  }

  if (loadedPuzzles.length === 0) {
    throw new Error("At least one shipped puzzle JSON file is required");
  }
  for (const loaded of loadedPuzzles) {
    for (const prerequisiteId of loaded.parsed.prerequisitePuzzleIds) {
      if (loadedById[prerequisiteId] === undefined) {
        throw new Error(
          `${loaded.sourcePath}: prerequisite puzzle "${prerequisiteId}" does not exist`,
        );
      }
    }
  }
  validateAcyclicPrerequisites(loadedPuzzles, loadedById);

  loadedPuzzles.sort((left, right) => left.parsed.order - right.parsed.order);
  return Object.freeze(loadedPuzzles.map(({ parsed }) => Object.freeze({
    id: parsed.id,
    name: parsed.name,
    cycleLimit: parsed.cycleLimit,
    description: parsed.description,
    features: parsed.features,
    goal: parsed.goal,
    editableRegion: parsed.editableRegion,
    availableComponents: parsed.availableComponents,
    prerequisitePuzzleIds: parsed.prerequisitePuzzleIds,
    createInitialWorld: () => parsed.initialWorld.clone(),
    testCases: Object.freeze(
      parsed.testCases.map((testCase) =>
        Object.freeze({
          id: testCase.id,
          name: testCase.name,
          cycleLimit: testCase.cycleLimit,
          createInitialWorld: () => testCase.initialWorld.clone(),
        }),
      ),
    ),
  })));
}

function validateAcyclicPrerequisites(
  loadedPuzzles: readonly LoadedPuzzle[],
  loadedById: Readonly<Record<string, LoadedPuzzle | undefined>>,
): void {
  const visiting: Record<string, true | undefined> = Object.create(null);
  const visited: Record<string, true | undefined> = Object.create(null);

  function visit(loaded: LoadedPuzzle): void {
    const id = loaded.parsed.id;
    if (visiting[id] === true) {
      throw new Error(`${loaded.sourcePath}: prerequisite graph contains a cycle at "${id}"`);
    }
    if (visited[id] === true) {
      return;
    }
    visiting[id] = true;
    for (const prerequisiteId of loaded.parsed.prerequisitePuzzleIds) {
      visit(expectDefined(
        loadedById[prerequisiteId],
        `Missing validated prerequisite "${prerequisiteId}"`,
      ));
    }
    delete visiting[id];
    visited[id] = true;
  }

  for (const loaded of loadedPuzzles) {
    visit(loaded);
  }
}

const puzzlesById: Record<string, PuzzleDefinition | undefined> = Object.create(null);
for (const puzzle of PUZZLES) {
  puzzlesById[puzzle.id] = puzzle;
}
const PUZZLES_BY_ID = Object.freeze(puzzlesById);

export function puzzleById(id: PuzzleId): PuzzleDefinition {
  return expectDefined(PUZZLES_BY_ID[id], `Unknown puzzle id "${id}"`);
}

export function isPuzzleUnlocked(
  puzzle: PuzzleDefinition,
  completedPuzzleIds: ReadonlySet<PuzzleId>,
): boolean {
  return puzzle.prerequisitePuzzleIds.every((id) => completedPuzzleIds.has(id));
}
