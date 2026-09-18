import { describe, expect, it } from "vitest";

import { GridRegion } from "../src/game/grid-region";
import {
  loadSavedSandboxes,
  SavedSandboxes,
  saveSavedSandboxes,
} from "../src/game/saved-sandboxes";
import {
  parseSandboxSnapshot,
  SandboxPuzzleAuthoringState,
} from "../src/game/sandbox-puzzle-authoring";
import { createSandboxWorld } from "../src/game/puzzles";
import { TileKind } from "../src/simulation/tile";

function createStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("saved sandboxes", () => {
  it("round-trips an authored sandbox without requiring a victory block", () => {
    const world = createSandboxWorld();
    const authoring = SandboxPuzzleAuthoringState.createDefault(world);
    const secondCase = authoring.duplicateSelectedTestCase();
    secondCase.place(1, 1, TileKind.Iron);
    authoring.saveSelectedWorld(secondCase);
    const editableRegion = new GridRegion([{ x: 2, y: 3, width: 4, height: 5 }]);
    const snapshot = authoring.serialize(editableRegion);

    const sandboxes = SavedSandboxes.empty();
    const sandbox = sandboxes.create(snapshot, "case-1");
    const loaded = SavedSandboxes.deserialize(sandboxes.serialize());
    const imported = parseSandboxSnapshot(
      loaded.byId(sandbox.id).snapshot,
      "Stored sandbox",
      loaded.byId(sandbox.id).selectedTestCaseId,
    );

    expect(imported.authoring.selectedTestCaseId).toBe("case-1");
    expect(imported.authoring.testCases).toHaveLength(2);
    expect(imported.world.kindAt(1, 1)).toBe(TileKind.Iron);
    expect(imported.editableRegion.rectangles).toEqual(editableRegion.rectangles);
  });

  it("allocates stable names and persists duplication, updates, and deletion", () => {
    const storage = createStorage();
    const world = createSandboxWorld();
    const authoring = SandboxPuzzleAuthoringState.createDefault(world);
    const first = SavedSandboxes.empty();
    const sandbox = first.create(authoring.serialize(new GridRegion([])), "standard");
    const duplicate = first.duplicate(sandbox.id);
    expect([sandbox.name, duplicate.name]).toEqual(["Sandbox 1", "Sandbox 1.1"]);

    const resized = createSandboxWorld();
    resized.place(0, 0, TileKind.Stone);
    const resizedAuthoring = SandboxPuzzleAuthoringState.createDefault(resized);
    first.update(sandbox.id, resizedAuthoring.serialize(new GridRegion([])), "standard");
    first.delete(duplicate.id);
    saveSavedSandboxes(storage, first);

    const loaded = loadSavedSandboxes(storage);
    expect(loaded.entries.map(({ id }) => id)).toEqual([sandbox.id]);
    expect(loaded.byId(sandbox.id).width).toBe(resized.width);
    expect(loaded.byId(sandbox.id).height).toBe(resized.height);
  });

  it("reserves deleted lineage names after reload while allowing new branches", () => {
    const authoring = SandboxPuzzleAuthoringState.createDefault(createSandboxWorld());
    const snapshot = authoring.serialize(new GridRegion([]));
    const sandboxes = SavedSandboxes.empty();
    const root = sandboxes.create(snapshot, "standard");
    const first = sandboxes.duplicate(root.id);
    const second = sandboxes.duplicate(first.id);
    const branch = sandboxes.duplicate(first.id);
    const continuation = sandboxes.duplicate(branch.id);
    expect([first.name, second.name, branch.name, continuation.name]).toEqual([
      "Sandbox 1.1", "Sandbox 1.2", "Sandbox 1.1a.1", "Sandbox 1.1a.2",
    ]);
    sandboxes.duplicate(second.id);
    sandboxes.delete(root.id);
    sandboxes.delete(second.id);
    sandboxes.delete(branch.id);

    const loaded = SavedSandboxes.deserialize(sandboxes.serialize());
    expect(loaded.duplicate(first.id).name).toBe("Sandbox 1.1b.1");
    expect(loaded.duplicate(continuation.id).name).toBe("Sandbox 1.1a.3");
    expect(loaded.create(snapshot, "standard").name).toBe("Sandbox 2");
  });

  it("rejects a selected test case missing from the snapshot", () => {
    const world = createSandboxWorld();
    const authoring = SandboxPuzzleAuthoringState.createDefault(world);
    expect(() => SavedSandboxes.empty().create(
      authoring.serialize(new GridRegion([])),
      "missing",
    )).toThrow('Sandbox puzzle test case "missing" does not exist');
  });
});
