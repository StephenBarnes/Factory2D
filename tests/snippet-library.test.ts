import { describe, expect, it } from "vitest";

import {
  deserializeSnippetBoard,
  MAX_SNIPPET_NAME_LENGTH,
  parseSnippetImport,
  restrictSnippetWorld,
  serializeSnippetWorld,
  SnippetLibrary,
  tileKindNames,
} from "../src/game/snippet-library";
import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { PuzzleResult } from "../src/simulation/puzzle-result";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function machineWorld(): World {
  const world = new World(8, 6);
  world.place(2, 1, TileKind.Stone);
  world.place(3, 1, TileKind.Delay, Direction.Right);
  world.configureNumericComponent(3, 1, 5);
  world.place(3, 2, TileKind.Conveyor);
  world.setWeld(2, 1, 3, 1, true);
  world.setWeld(3, 1, 3, 2, true);
  return world;
}

function requireBoard(world: World): string {
  const board = serializeSnippetWorld(world);
  if (board === null) {
    throw new Error("Expected an occupied snippet world");
  }
  return board;
}

describe("snippet boards", () => {
  it("crops a world to its occupied bounds while keeping orientation, configuration, and welds", () => {
    const cropped = deserializeSnippetBoard(requireBoard(machineWorld()));

    expect(cropped.width).toBe(2);
    expect(cropped.height).toBe(2);
    expect(cropped.kindAt(0, 0)).toBe(TileKind.Stone);
    expect(cropped.kindAt(1, 0)).toBe(TileKind.Delay);
    expect(cropped.orientationAt(1, 0)).toBe(Direction.Right);
    expect(cropped.componentStateSnapshotAt(1, 0)).toMatchObject({ type: "delay", length: 5 });
    expect(cropped.kindAt(1, 1)).toBe(TileKind.Conveyor);
    expect(cropped.kindAt(0, 1)).toBe(TileKind.Empty);
    expect(cropped.isWelded(0, 0, 1, 0)).toBe(true);
    expect(cropped.isWelded(1, 0, 1, 1)).toBe(true);
  });

  it("drops simulation charges from captured snippets", () => {
    const world = new World(3, 1);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.Conduit);
    world.setWeld(0, 0, 1, 0, true);
    world.setCharge(1, 0, 1);

    const snippet = deserializeSnippetBoard(requireBoard(world));
    expect(snippet.chargeAt(1, 0)).toBe(0);
  });

  it("returns null for an empty world", () => {
    expect(serializeSnippetWorld(new World(4, 4))).toBeNull();
  });

  it("rejects boards that are not editable tick-zero designs", () => {
    const running = new World(2, 2);
    running.place(0, 0, TileKind.Stone);
    expect(() => deserializeSnippetBoard(serializeBoard(running, 3))).toThrow(/tick-zero/);

    running.markPuzzleResult(PuzzleResult.Won);
    expect(() => deserializeSnippetBoard(serializeBoard(running, 0))).toThrow(/tick-zero/);

    expect(() => deserializeSnippetBoard(serializeBoard(new World(2, 2), 0))).toThrow(
      /at least one tile/,
    );
  });
});

describe("snippet library", () => {
  it("names new snippets sequentially, filling gaps left by deletions", () => {
    const library = SnippetLibrary.empty();
    const board = requireBoard(machineWorld());
    const first = library.add(board);
    const second = library.add(board);
    expect(first).toMatchObject({ id: "snippet-1", name: "Snippet 1" });
    expect(second).toMatchObject({ id: "snippet-2", name: "Snippet 2" });

    library.delete(first.id);
    const third = library.add(board);
    expect(third).toMatchObject({ id: "snippet-3", name: "Snippet 1" });
    expect(library.entries.map((snippet) => snippet.id)).toEqual(["snippet-2", "snippet-3"]);
  });

  it("validates names when adding and renaming", () => {
    const library = SnippetLibrary.empty();
    const board = requireBoard(machineWorld());
    const snippet = library.add(board, "  Adder  ");
    expect(snippet.name).toBe("Adder");

    expect(library.rename(snippet.id, "Half adder").name).toBe("Half adder");
    expect(() => library.rename(snippet.id, "   ")).toThrow(/1 to 40 characters/);
    expect(() => library.rename(snippet.id, "x".repeat(MAX_SNIPPET_NAME_LENGTH + 1))).toThrow(
      /characters/,
    );
    expect(() => library.rename("missing", "Name")).toThrow(/Unknown snippet/);
    expect(library.byId(snippet.id).name).toBe("Half adder");
  });

  it("rejects invalid boards when adding", () => {
    const library = SnippetLibrary.empty();
    expect(() => library.add("not json")).toThrow(/valid JSON/);
    expect(() => library.add(serializeBoard(new World(2, 2), 0))).toThrow(/at least one tile/);
    expect(library.entries).toHaveLength(0);
  });

  it("round-trips through serialization and keeps ID allocation monotonic", () => {
    const library = SnippetLibrary.empty();
    const board = requireBoard(machineWorld());
    library.add(board, "Adder");
    const removed = library.add(board);
    library.delete(removed.id);

    const restored = SnippetLibrary.deserialize(library.serialize());
    expect(restored.entries).toEqual(library.entries);
    expect(restored.add(board).id).toBe("snippet-3");
    expect(restored.serialize()).toBe(restored.serialize());
  });

  it("rejects malformed stored data", () => {
    const board = requireBoard(machineWorld());
    const stored = (snippets: unknown, version = 1, nextSnippetId = 1): string =>
      JSON.stringify({ version, nextSnippetId, snippets });

    expect(() => SnippetLibrary.deserialize("{")).toThrow(/valid JSON/);
    expect(() => SnippetLibrary.deserialize("[]")).toThrow(/must be an object/);
    expect(() => SnippetLibrary.deserialize(stored([], 2))).toThrow(/unsupported version/);
    expect(() => SnippetLibrary.deserialize(stored([], 1, 0))).toThrow(/positive integer/);
    expect(() => SnippetLibrary.deserialize(stored({}))).toThrow(/must be an array/);
    expect(() => SnippetLibrary.deserialize(stored([{ id: "", name: "A", board }]))).toThrow(
      /invalid ID/,
    );
    expect(() => SnippetLibrary.deserialize(stored([
      { id: "snippet-1", name: "A", board },
      { id: "snippet-1", name: "B", board },
    ]))).toThrow(/duplicated/);
    expect(() => SnippetLibrary.deserialize(stored([{ id: "snippet-1", name: 3, board }]))).toThrow(
      /invalid name/,
    );
    expect(() => SnippetLibrary.deserialize(stored([{ id: "snippet-1", name: "A", board: 3 }]))).toThrow(
      /invalid board/,
    );
    expect(() => SnippetLibrary.deserialize(stored([
      { id: "snippet-1", name: "A", board: serializeBoard(new World(1, 1), 0) },
    ]))).toThrow(/at least one tile/);
  });
});

describe("snippet import and export", () => {
  it("exports a library file that imports back with names preserved", () => {
    const library = SnippetLibrary.empty();
    const board = requireBoard(machineWorld());
    library.add(board, "Adder");
    library.add(board, "Vehicle");

    const file = library.serializeFile();
    expect(JSON.parse(file)).toMatchObject({ format: "factory2d-snippets", version: 1 });
    expect(parseSnippetImport(file)).toEqual([
      { name: "Adder", board },
      { name: "Vehicle", board },
    ]);
    expect(parseSnippetImport(library.serializeFile(["snippet-2"]))).toEqual([
      { name: "Vehicle", board },
    ]);
  });

  it("imports a scene file as one unnamed snippet cropped to its tiles", () => {
    const world = machineWorld();
    const imported = parseSnippetImport(serializeBoard(world, 0));
    expect(imported).toHaveLength(1);
    expect(imported[0]?.name).toBeNull();
    const snippet = deserializeBoard(imported[0]?.board ?? "").world;
    expect(snippet.width).toBe(2);
    expect(snippet.height).toBe(2);
    expect(snippet.kindAt(1, 1)).toBe(TileKind.Conveyor);
  });

  it("rejects unknown, empty, and malformed import files", () => {
    const board = requireBoard(machineWorld());
    expect(() => parseSnippetImport("nope")).toThrow(/valid JSON/);
    expect(() => parseSnippetImport(JSON.stringify({ format: "other" }))).toThrow(
      /unknown format/,
    );
    expect(() => parseSnippetImport(serializeBoard(new World(3, 3), 0))).toThrow(/no tiles/);
    expect(() => parseSnippetImport(JSON.stringify({
      format: "factory2d-snippets",
      version: 2,
      snippets: [],
    }))).toThrow(/unsupported version/);
    expect(() => parseSnippetImport(JSON.stringify({
      format: "factory2d-snippets",
      version: 1,
      snippets: {},
    }))).toThrow(/snippets array/);
    expect(() => parseSnippetImport(JSON.stringify({
      format: "factory2d-snippets",
      version: 1,
      snippets: [{ name: "", board }],
    }))).toThrow(/characters/);
  });
});

describe("snippet restriction", () => {
  it("returns the same world when every component is allowed", () => {
    const world = deserializeSnippetBoard(requireBoard(machineWorld()));
    const restricted = restrictSnippetWorld(world, () => true);
    expect(restricted.world).toBe(world);
    expect(restricted.removedKinds).toEqual([]);
  });

  it("removes disallowed kinds without mutating the source and reports them once each", () => {
    const world = deserializeSnippetBoard(requireBoard(machineWorld()));
    const restricted = restrictSnippetWorld(
      world,
      (kind) => kind !== TileKind.Delay && kind !== TileKind.Conveyor,
    );

    expect(restricted.removedKinds).toEqual([TileKind.Delay, TileKind.Conveyor]);
    expect(tileKindNames(restricted.removedKinds)).toEqual(["Delay Rune", "Conveyor Belt"]);
    expect(restricted.world).not.toBe(world);
    expect(restricted.world?.kindAt(0, 0)).toBe(TileKind.Stone);
    expect(restricted.world?.kindAt(1, 0)).toBe(TileKind.Empty);
    expect(restricted.world?.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(1, 0)).toBe(TileKind.Delay);
  });

  it("reports a null world when nothing remains", () => {
    const world = deserializeSnippetBoard(requireBoard(machineWorld()));
    const restricted = restrictSnippetWorld(world, () => false);
    expect(restricted.world).toBeNull();
    expect(restricted.removedKinds).toEqual([TileKind.Stone, TileKind.Delay, TileKind.Conveyor]);
  });
});
