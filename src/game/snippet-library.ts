import {
  deserializeBoard,
  deserializeBoardValue,
  serializeBoard,
} from "../simulation/board-export";
import { PuzzleResult } from "../simulation/puzzle-result";
import { TILE_DEFINITIONS, TileKind } from "../simulation/tile";
import { World } from "../simulation/world";

export const SNIPPET_LIBRARY_STORAGE_KEY = "factory2d.snippets";
export const MAX_SNIPPET_NAME_LENGTH = 40;
const SNIPPET_LIBRARY_VERSION = 1;
const SNIPPET_FILE_FORMAT = "factory2d-snippets";
const SNIPPET_FILE_VERSION = 1;
const BOARD_FILE_FORMAT = "factory2d-board";

type SnippetLibraryStorage = Pick<Storage, "getItem" | "setItem">;

/** One reusable machine fragment stored as a tick-zero board in the scene format. */
export interface SavedSnippet {
  readonly id: string;
  readonly name: string;
  readonly board: string;
}

interface StoredSnippetLibrary {
  readonly version: typeof SNIPPET_LIBRARY_VERSION;
  readonly nextSnippetId: number;
  readonly snippets: readonly SavedSnippet[];
}

interface SnippetFileEntry {
  readonly name: string;
  readonly board: string;
}

interface SnippetFile {
  readonly format: typeof SNIPPET_FILE_FORMAT;
  readonly version: typeof SNIPPET_FILE_VERSION;
  readonly snippets: readonly SnippetFileEntry[];
}

/** A snippet parsed from an import file before it receives a library ID. */
export interface ImportedSnippet {
  readonly name: string | null;
  readonly board: string;
}

export interface RestrictedSnippetWorld {
  /** The snippet with every disallowed component removed, or null when nothing remains. */
  readonly world: World | null;
  /** Distinct disallowed kinds in board order. */
  readonly removedKinds: readonly TileKind[];
}

/** Global, puzzle-independent collection of saved snippets with deterministic naming. */
export class SnippetLibrary {
  private constructor(
    private readonly snippets: SavedSnippet[],
    private nextSnippetId: number,
  ) {}

  static empty(): SnippetLibrary {
    return new SnippetLibrary([], 1);
  }

  static deserialize(serialized: string): SnippetLibrary {
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new Error("Stored snippets are not valid JSON");
    }
    const record = requireRecord(value, "Stored snippets");
    if (record.version !== SNIPPET_LIBRARY_VERSION) {
      throw new Error("Stored snippets have an unsupported version");
    }
    if (!Number.isSafeInteger(record.nextSnippetId) || (record.nextSnippetId as number) < 1) {
      throw new Error("Stored next snippet ID must be a positive integer");
    }
    if (!Array.isArray(record.snippets)) {
      throw new Error("Stored snippets must be an array");
    }

    const seenIds = new Set<string>();
    const snippets = record.snippets.map((entry, index) => {
      const description = `Stored snippet at index ${index}`;
      const snippet = requireRecord(entry, description);
      if (typeof snippet.id !== "string" || snippet.id.length === 0) {
        throw new Error(`${description} has an invalid ID`);
      }
      if (seenIds.has(snippet.id)) {
        throw new Error(`Stored snippet ID ${snippet.id} is duplicated`);
      }
      seenIds.add(snippet.id);
      return {
        id: snippet.id,
        name: validateSnippetName(snippet.name, description),
        board: validateSnippetBoard(snippet.board, description),
      };
    });
    return new SnippetLibrary(snippets, record.nextSnippetId as number);
  }

  get entries(): readonly SavedSnippet[] {
    return this.snippets;
  }

  findById(id: string): SavedSnippet | undefined {
    return this.snippets.find((candidate) => candidate.id === id);
  }

  byId(id: string): SavedSnippet {
    const snippet = this.findById(id);
    if (snippet === undefined) {
      throw new Error(`Unknown snippet ${id}`);
    }
    return snippet;
  }

  /** Appends a validated snippet board, naming it `Snippet N` unless a name is given. */
  add(board: string, name: string | null = null): SavedSnippet {
    validateSnippetBoard(board, "Snippet");
    let id = `snippet-${this.nextSnippetId}`;
    while (this.snippets.some((snippet) => snippet.id === id)) {
      this.nextSnippetId += 1;
      id = `snippet-${this.nextSnippetId}`;
    }
    this.nextSnippetId += 1;

    const snippet: SavedSnippet = {
      id,
      name: name === null ? this.nextDefaultName() : validateSnippetName(name, "Snippet"),
      board,
    };
    this.snippets.push(snippet);
    return snippet;
  }

  rename(id: string, name: string): SavedSnippet {
    const snippet = this.byId(id);
    const renamed = { ...snippet, name: validateSnippetName(name, "Snippet") };
    this.snippets[this.snippets.indexOf(snippet)] = renamed;
    return renamed;
  }

  delete(id: string): void {
    const snippet = this.byId(id);
    this.snippets.splice(this.snippets.indexOf(snippet), 1);
  }

  serialize(): string {
    const stored: StoredSnippetLibrary = {
      version: SNIPPET_LIBRARY_VERSION,
      nextSnippetId: this.nextSnippetId,
      snippets: this.snippets,
    };
    return JSON.stringify(stored);
  }

  /** Serializes the given snippets (every snippet by default) as a shareable library file. */
  serializeFile(ids: readonly string[] = this.snippets.map((snippet) => snippet.id)): string {
    const file: SnippetFile = {
      format: SNIPPET_FILE_FORMAT,
      version: SNIPPET_FILE_VERSION,
      snippets: ids.map((id) => {
        const snippet = this.byId(id);
        return { name: snippet.name, board: snippet.board };
      }),
    };
    return `${JSON.stringify(file, null, 2)}\n`;
  }

  private nextDefaultName(): string {
    const usedNames = new Set(this.snippets.map((snippet) => snippet.name));
    let nameNumber = 1;
    while (usedNames.has(`Snippet ${nameNumber}`)) {
      nameNumber += 1;
    }
    return `Snippet ${nameNumber}`;
  }
}

export function loadSnippetLibrary(storage: SnippetLibraryStorage): SnippetLibrary {
  const serialized = storage.getItem(SNIPPET_LIBRARY_STORAGE_KEY);
  return serialized === null ? SnippetLibrary.empty() : SnippetLibrary.deserialize(serialized);
}

export function saveSnippetLibrary(
  storage: SnippetLibraryStorage,
  library: SnippetLibrary,
): void {
  storage.setItem(SNIPPET_LIBRARY_STORAGE_KEY, library.serialize());
}

/**
 * Parses either a single scene file, which becomes one snippet cropped to its
 * occupied cells, or a snippet library file exported by `serializeFile`.
 */
export function parseSnippetImport(source: string): readonly ImportedSnippet[] {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Snippet file is not valid JSON");
  }
  const record = requireRecord(value, "Snippet file");
  if (record.format === BOARD_FILE_FORMAT) {
    const board = serializeSnippetWorld(deserializeBoardValue(value).world);
    if (board === null) {
      throw new Error("Scene file contains no tiles to save as a snippet");
    }
    return [{ name: null, board }];
  }
  if (record.format !== SNIPPET_FILE_FORMAT) {
    throw new Error("Snippet file has an unknown format");
  }
  if (record.version !== SNIPPET_FILE_VERSION) {
    throw new Error("Snippet file has an unsupported version");
  }
  if (!Array.isArray(record.snippets)) {
    throw new Error("Snippet file must contain a snippets array");
  }
  return record.snippets.map((entry, index) => {
    const description = `Snippet at index ${index}`;
    const snippet = requireRecord(entry, description);
    return {
      name: validateSnippetName(snippet.name, description),
      board: validateSnippetBoard(snippet.board, description),
    };
  });
}

/** Parses a stored snippet board into a fresh tick-zero world. */
export function deserializeSnippetBoard(board: string, description = "Snippet"): World {
  const imported = deserializeBoard(board);
  if (imported.tick !== 0 || imported.world.puzzleResult !== PuzzleResult.InProgress) {
    throw new Error(`${description} must be a tick-zero board without a puzzle result`);
  }
  if (!worldHasOccupiedCell(imported.world)) {
    throw new Error(`${description} must contain at least one tile`);
  }
  return imported.world;
}

/**
 * Serializes the occupied bounds of `world` as a snippet board, dropping
 * simulation charges and progress. Returns null for an empty world.
 */
export function serializeSnippetWorld(world: World): string | null {
  const cropped = cropWorldToOccupiedBounds(world);
  return cropped === null ? null : serializeBoard(cropped, 0);
}

/** Removes every tile whose kind fails `canPlaceKind`, reporting the removed kinds. */
export function restrictSnippetWorld(
  world: World,
  canPlaceKind: (kind: TileKind) => boolean,
): RestrictedSnippetWorld {
  const removedKinds: TileKind[] = [];
  const restricted = restrictWorldRecursively(world, canPlaceKind, removedKinds);
  if (restricted === world) {
    return { world, removedKinds };
  }
  return {
    world: worldHasOccupiedCell(restricted) ? restricted : null,
    removedKinds,
  };
}

/**
 * Returns `world` itself when every tile is allowed, otherwise a restricted clone. Rune
 * array contents are restricted the same way, keeping the array itself when it is allowed.
 */
function restrictWorldRecursively(
  world: World,
  canPlaceKind: (kind: TileKind) => boolean,
  removedKinds: TileKind[],
): World {
  let restricted: World | null = null;
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const kind = world.kindAt(x, y);
      if (kind === TileKind.Empty) {
        continue;
      }
      if (!canPlaceKind(kind)) {
        if (!removedKinds.includes(kind)) {
          removedKinds.push(kind);
        }
        restricted ??= world.clone();
        restricted.place(x, y, TileKind.Empty);
        continue;
      }
      if (kind !== TileKind.RuneArray) {
        continue;
      }
      const inner = world.runeArrayWorldAt(x, y);
      const restrictedInner = restrictWorldRecursively(inner, canPlaceKind, removedKinds);
      if (restrictedInner === inner) {
        continue;
      }
      restricted ??= world.clone();
      const snapshot = restricted.componentStateSnapshotAt(x, y);
      if (snapshot?.type !== "array") {
        throw new Error(`Rune array at (${x}, ${y}) is missing its component state`);
      }
      restricted.restoreComponentState(x, y, { ...snapshot, world: restrictedInner });
    }
  }
  return restricted ?? world;
}

/** Human-readable names for a list of tile kinds, in the given order. */
export function tileKindNames(kinds: readonly TileKind[]): string[] {
  return kinds.map((kind) => TILE_DEFINITIONS[kind].name);
}

function cropWorldToOccupiedBounds(world: World): World | null {
  let left = world.width;
  let top = world.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      if (world.kindAt(x, y) !== TileKind.Empty) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left) {
    return null;
  }
  const cropped = new World(right - left + 1, bottom - top + 1);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const kind = world.kindAt(x, y);
      if (kind === TileKind.Empty) {
        continue;
      }
      cropped.place(x - left, y - top, kind, world.orientationAt(x, y));
      const componentState = world.componentStateSnapshotAt(x, y);
      if (componentState !== null) {
        cropped.restoreComponentState(x - left, y - top, componentState);
      }
    }
  }
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (x < right && world.isWelded(x, y, x + 1, y)) {
        cropped.setWeld(x - left, y - top, x - left + 1, y - top, true);
      }
      if (y < bottom && world.isWelded(x, y, x, y + 1)) {
        cropped.setWeld(x - left, y - top, x - left, y - top + 1, true);
      }
    }
  }
  return cropped;
}

function worldHasOccupiedCell(world: World): boolean {
  for (let index = 0; index < world.cellCount; index += 1) {
    if (world.kindAtIndex(index) !== TileKind.Empty) {
      return true;
    }
  }
  return false;
}

function validateSnippetName(value: unknown, description: string): string {
  if (typeof value !== "string") {
    throw new Error(`${description} has an invalid name`);
  }
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_SNIPPET_NAME_LENGTH) {
    throw new Error(
      `${description} name must be 1 to ${MAX_SNIPPET_NAME_LENGTH} characters`,
    );
  }
  return name;
}

function validateSnippetBoard(value: unknown, description: string): string {
  if (typeof value !== "string") {
    throw new Error(`${description} has an invalid board`);
  }
  deserializeSnippetBoard(value, description);
  return value;
}

function requireRecord(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${description} must be an object`);
  }
  return value as Record<string, unknown>;
}
