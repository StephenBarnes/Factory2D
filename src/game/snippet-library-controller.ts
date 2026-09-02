import {
  deserializeSnippetBoard,
  loadSnippetLibrary,
  parseSnippetImport,
  type SavedSnippet,
  saveSnippetLibrary,
  serializeSnippetWorld,
  SnippetLibrary,
} from "./snippet-library";
import type { World } from "../simulation/world";

type SnippetStorage = Pick<Storage, "getItem" | "setItem">;

/** A saved snippet together with its parsed, shared read-only world. */
export interface SnippetEntry {
  readonly snippet: SavedSnippet;
  readonly world: World;
}

/** Owns the global snippet library, its parsed worlds, and local-storage persistence. */
export class SnippetLibraryController {
  private readonly library: SnippetLibrary;
  private readonly worldsById = new Map<string, World>();

  constructor(private readonly storage: SnippetStorage) {
    let library: SnippetLibrary;
    try {
      library = loadSnippetLibrary(storage);
    } catch (error) {
      console.error("Could not load saved snippets:", error);
      library = SnippetLibrary.empty();
    }
    this.library = library;
  }

  get entries(): readonly SnippetEntry[] {
    return this.library.entries.map((snippet) => this.entryFor(snippet));
  }

  get count(): number {
    return this.library.entries.length;
  }

  byId(id: string): SnippetEntry {
    return this.entryFor(this.library.byId(id));
  }

  /** Saves the occupied bounds of `world` as a new snippet; returns null for an empty world. */
  saveWorld(world: World): SavedSnippet | null {
    const board = serializeSnippetWorld(world);
    if (board === null) {
      return null;
    }
    const snippet = this.library.add(board);
    this.persist();
    return snippet;
  }

  rename(id: string, name: string): SavedSnippet {
    const renamed = this.library.rename(id, name);
    this.persist();
    return renamed;
  }

  delete(id: string): void {
    this.library.delete(id);
    this.worldsById.delete(id);
    this.persist();
  }

  /** Adds every snippet from a scene or snippet-library file; returns the added snippets. */
  importFile(source: string): readonly SavedSnippet[] {
    const imported = parseSnippetImport(source);
    const added = imported.map((entry) => this.library.add(entry.board, entry.name));
    this.persist();
    return added;
  }

  /** Scene-format export of one snippet, loadable as a sandbox scene or re-imported as a snippet. */
  exportSnippet(id: string): string {
    return this.library.byId(id).board;
  }

  exportAll(): string {
    return this.library.serializeFile();
  }

  private entryFor(snippet: SavedSnippet): SnippetEntry {
    let world = this.worldsById.get(snippet.id);
    if (world === undefined) {
      world = deserializeSnippetBoard(snippet.board);
      this.worldsById.set(snippet.id, world);
    }
    return { snippet, world };
  }

  private persist(): void {
    try {
      saveSnippetLibrary(this.storage, this.library);
    } catch (error) {
      console.error("Could not save snippets:", error);
    }
  }
}
