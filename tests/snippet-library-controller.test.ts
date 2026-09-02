import { describe, expect, it } from "vitest";

import { SnippetLibraryController } from "../src/game/snippet-library-controller";
import { SNIPPET_LIBRARY_STORAGE_KEY } from "../src/game/snippet-library";
import { serializeBoard } from "../src/simulation/board-export";
import { TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function stoneWorld(): World {
  const world = new World(5, 5);
  world.place(2, 2, TileKind.Stone);
  world.place(3, 2, TileKind.Iron);
  world.setWeld(2, 2, 3, 2, true);
  return world;
}

describe("snippet library controller", () => {
  it("persists saved snippets and restores them with shared parsed worlds", () => {
    const storage = new MemoryStorage();
    const controller = new SnippetLibraryController(storage);
    expect(controller.count).toBe(0);

    const saved = controller.saveWorld(stoneWorld());
    expect(saved?.name).toBe("Snippet 1");
    expect(controller.saveWorld(new World(3, 3))).toBeNull();
    expect(storage.values.has(SNIPPET_LIBRARY_STORAGE_KEY)).toBe(true);

    const restored = new SnippetLibraryController(storage);
    expect(restored.count).toBe(1);
    const entry = restored.byId("snippet-1");
    expect(entry.world.width).toBe(2);
    expect(entry.world.height).toBe(1);
    expect(entry.world.isWelded(0, 0, 1, 0)).toBe(true);
    expect(restored.byId("snippet-1").world).toBe(entry.world);
    expect(restored.entries.map((candidate) => candidate.snippet.id)).toEqual(["snippet-1"]);
  });

  it("renames, deletes, imports, and exports through persistence", () => {
    const storage = new MemoryStorage();
    const controller = new SnippetLibraryController(storage);
    controller.saveWorld(stoneWorld());
    controller.rename("snippet-1", "Base");
    expect(new SnippetLibraryController(storage).byId("snippet-1").snippet.name).toBe("Base");

    const sceneImports = controller.importFile(serializeBoard(stoneWorld(), 0));
    expect(sceneImports.map((snippet) => snippet.name)).toEqual(["Snippet 1"]);
    const libraryImports = controller.importFile(controller.exportAll());
    expect(libraryImports.map((snippet) => snippet.name)).toEqual(["Base", "Snippet 1"]);
    expect(controller.count).toBe(4);

    expect(controller.exportSnippet("snippet-1")).toBe(controller.byId("snippet-1").snippet.board);
    controller.delete("snippet-1");
    expect(() => controller.byId("snippet-1")).toThrow(/Unknown snippet/);
    expect(new SnippetLibraryController(storage).count).toBe(3);
  });

  it("recovers from malformed storage with an empty library", () => {
    const storage = new MemoryStorage();
    storage.setItem(SNIPPET_LIBRARY_STORAGE_KEY, "{broken");
    const controller = new SnippetLibraryController(storage);
    expect(controller.count).toBe(0);
    controller.saveWorld(stoneWorld());
    expect(new SnippetLibraryController(storage).count).toBe(1);
  });
});
