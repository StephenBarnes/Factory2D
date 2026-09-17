import { describe, expect, it } from "vitest";
import {
  clearPlayerData,
  PLAYER_DATA_FORMAT,
  PLAYER_DATA_VERSION,
  replacePlayerData,
  serializePlayerData,
} from "../src/game/player-data";

class MemoryStorage {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  clear(): void {
    this.values.clear();
  }
}

function playerData(entries: readonly unknown[]): string {
  return JSON.stringify({
    format: PLAYER_DATA_FORMAT,
    version: PLAYER_DATA_VERSION,
    entries,
  });
}

describe("player data transfer", () => {
  it("exports every storage entry deterministically and restores an exact replacement", () => {
    const source = new MemoryStorage();
    source.setItem("factory2d.puzzle-progress", '{"completed":["stone-drop"]}');
    source.setItem("custom-setting", "enabled");

    const serialized = serializePlayerData(source);
    expect(JSON.parse(serialized)).toEqual({
      format: PLAYER_DATA_FORMAT,
      version: PLAYER_DATA_VERSION,
      entries: [
        { key: "custom-setting", value: "enabled" },
        { key: "factory2d.puzzle-progress", value: '{"completed":["stone-drop"]}' },
      ],
    });

    const destination = new MemoryStorage();
    destination.setItem("stale", "remove me");
    replacePlayerData(destination, serialized);
    expect(Object.fromEntries(destination.values)).toEqual({
      "custom-setting": "enabled",
      "factory2d.puzzle-progress": '{"completed":["stone-drop"]}',
    });
  });

  it.each([
    ["invalid JSON", "{"],
    ["wrong format", JSON.stringify({ format: "other", version: 1, entries: [] })],
    ["unsupported version", JSON.stringify({ format: PLAYER_DATA_FORMAT, version: 2, entries: [] })],
    ["non-string value", playerData([{ key: "setting", value: 3 }])],
    ["duplicate key", playerData([{ key: "same", value: "one" }, { key: "same", value: "two" }])],
  ])("rejects %s without modifying existing data", (_description, serialized) => {
    const storage = new MemoryStorage();
    storage.setItem("existing", "preserved");

    expect(() => replacePlayerData(storage, serialized)).toThrow(/Player data|Factory 2D|duplicate/);
    expect(Object.fromEntries(storage.values)).toEqual({ existing: "preserved" });
  });

  it("restores existing data when writing an imported entry fails", () => {
    const storage = new MemoryStorage();
    storage.setItem("existing", "preserved");
    const originalSetItem = storage.setItem.bind(storage);
    let shouldFail = true;
    storage.setItem = (key, value) => {
      if (key === "failure" && shouldFail) {
        shouldFail = false;
        throw new Error("storage full");
      }
      originalSetItem(key, value);
    };

    expect(() => replacePlayerData(storage, playerData([
      { key: "added-before-failure", value: "temporary" },
      { key: "failure", value: "unwritten" },
    ]))).toThrow(/previous player data was restored/);
    expect(Object.fromEntries(storage.values)).toEqual({ existing: "preserved" });
  });

  it("clears every storage entry", () => {
    const storage = new MemoryStorage();
    storage.setItem("progress", "complete");
    storage.setItem("settings", "custom");

    clearPlayerData(storage);

    expect(storage.length).toBe(0);
  });
});
