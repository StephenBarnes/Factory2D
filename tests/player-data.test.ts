import { describe, expect, it } from "vitest";
import {
  getInstallationId,
  INSTALLATION_ID_STORAGE_KEY,
  isInstallationId,
} from "../src/game/installation-id";
import {
  clearPlayerData,
  PLAYER_DATA_FORMAT,
  PLAYER_DATA_VERSION,
  replacePlayerData,
  serializePlayerData,
} from "../src/game/player-data";

const SOURCE_ID = "12345678-1234-4123-8123-123456789abc";
const DESTINATION_ID = "abcdef12-abcd-4abc-9abc-abcdef123456";

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

describe("installation identity", () => {
  it("persists a new UUID and reuses it across storage readers", () => {
    const storage = new MemoryStorage();
    const id = getInstallationId(storage);

    expect(isInstallationId(id)).toBe(true);
    expect(storage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe(id);
    expect(getInstallationId(storage)).toBe(id);
    const reloaded = new MemoryStorage();
    reloaded.setItem(INSTALLATION_ID_STORAGE_KEY, id);
    expect(getInstallationId(reloaded)).toBe(id);
  });

  it("does not return an identity that could not be persisted", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => { throw new Error("storage full"); };

    expect(() => getInstallationId(storage)).toThrow("storage full");
    expect(storage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBeNull();
  });

  it.each(["", "not-a-uuid", `${SOURCE_ID}\n`, SOURCE_ID.replace("-8123-", "-7123-")])(
    "rejects invalid persisted identity %j without rotating it",
    (invalidId) => {
      const storage = new MemoryStorage();
      storage.setItem(INSTALLATION_ID_STORAGE_KEY, invalidId);
      storage.setItem("progress", "preserved");
      const previous = new Map(storage.values);

      expect(() => getInstallationId(storage)).toThrow(/installation ID/);
      expect(() => serializePlayerData(storage)).toThrow(/installation ID/);
      expect(() => clearPlayerData(storage)).toThrow(/installation ID/);
      expect(() => replacePlayerData(storage, playerData([]))).toThrow(/installation ID/);
      expect(storage.values).toEqual(previous);
    },
  );
});

describe("player data transfer", () => {
  it("exports every storage entry deterministically and transfers identity with an exact replacement", () => {
    const source = new MemoryStorage();
    source.setItem("factory2d.puzzle-progress", '{"completed":["stone-drop"]}');
    source.setItem("custom-setting", "enabled");
    source.setItem(INSTALLATION_ID_STORAGE_KEY, SOURCE_ID);

    const serialized = serializePlayerData(source);
    expect(JSON.parse(serialized)).toEqual({
      format: PLAYER_DATA_FORMAT,
      version: PLAYER_DATA_VERSION,
      entries: [
        { key: "custom-setting", value: "enabled" },
        { key: INSTALLATION_ID_STORAGE_KEY, value: SOURCE_ID },
        { key: "factory2d.puzzle-progress", value: '{"completed":["stone-drop"]}' },
      ],
    });

    const destination = new MemoryStorage();
    destination.setItem("stale", "remove me");
    destination.setItem(INSTALLATION_ID_STORAGE_KEY, DESTINATION_ID);
    replacePlayerData(destination, serialized);
    expect(destination.values).toEqual(source.values);
    expect(getInstallationId(destination)).toBe(SOURCE_ID);
  });

  it("establishes and exports identity before startup has initialized it", () => {
    const source = new MemoryStorage();
    const destination = new MemoryStorage();
    const serialized = serializePlayerData(source);
    replacePlayerData(destination, serialized);

    expect(isInstallationId(source.getItem(INSTALLATION_ID_STORAGE_KEY))).toBe(true);
    expect(getInstallationId(destination)).toBe(source.getItem(INSTALLATION_ID_STORAGE_KEY));
    expect(serializePlayerData(source)).toBe(serialized);
  });

  it("preserves destination identity when importing older exports without one", () => {
    const storage = new MemoryStorage();
    storage.setItem(INSTALLATION_ID_STORAGE_KEY, DESTINATION_ID);
    storage.setItem("stale", "remove me");

    replacePlayerData(storage, playerData([{ key: "progress", value: "imported" }]));

    expect(Object.fromEntries(storage.values)).toEqual({
      [INSTALLATION_ID_STORAGE_KEY]: DESTINATION_ID,
      progress: "imported",
    });
  });

  it("establishes missing destination identity for older exports", () => {
    const storage = new MemoryStorage();
    replacePlayerData(storage, playerData([]));
    const id = storage.getItem(INSTALLATION_ID_STORAGE_KEY);

    expect(isInstallationId(id)).toBe(true);
    replacePlayerData(storage, playerData([]));
    expect(storage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe(id);
  });

  it.each([
    ["invalid JSON", "{"],
    ["wrong format", JSON.stringify({ format: "other", version: 1, entries: [] })],
    ["unsupported version", JSON.stringify({ format: PLAYER_DATA_FORMAT, version: 2, entries: [] })],
    ["non-string value", playerData([{ key: "setting", value: 3 }])],
    ["duplicate key", playerData([{ key: "same", value: "one" }, { key: "same", value: "two" }])],
    ["malformed identity", playerData([{ key: INSTALLATION_ID_STORAGE_KEY, value: "invalid" }])],
    ["duplicate identity", playerData([
      { key: INSTALLATION_ID_STORAGE_KEY, value: SOURCE_ID },
      { key: INSTALLATION_ID_STORAGE_KEY, value: DESTINATION_ID },
    ])],
  ])("rejects %s without modifying existing data", (_description, serialized) => {
    const storage = new MemoryStorage();
    storage.setItem("existing", "preserved");

    expect(() => replacePlayerData(storage, serialized)).toThrow(/Player data|Dwarfworks|duplicate/);
    expect(Object.fromEntries(storage.values)).toEqual({ existing: "preserved" });
  });

  it("restores existing data and identity after a partially written import fails", () => {
    const storage = new MemoryStorage();
    storage.setItem("existing", "preserved");
    storage.setItem(INSTALLATION_ID_STORAGE_KEY, DESTINATION_ID);
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key === "failure") throw new Error("storage full");
      originalSetItem(key, value);
    };

    expect(() => replacePlayerData(storage, playerData([
      { key: INSTALLATION_ID_STORAGE_KEY, value: SOURCE_ID },
      { key: "added-before-failure", value: "temporary" },
      { key: "failure", value: "unwritten" },
    ]))).toThrow(/previous player data was restored/);
    expect(Object.fromEntries(storage.values)).toEqual({
      existing: "preserved",
      [INSTALLATION_ID_STORAGE_KEY]: DESTINATION_ID,
    });
  });

  it("rolls back identity initialization when an older import fails", () => {
    const storage = new MemoryStorage();
    storage.setItem("existing", "preserved");
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key === "failure") throw new Error("storage full");
      originalSetItem(key, value);
    };

    expect(() => replacePlayerData(storage, playerData([
      { key: "failure", value: "unwritten" },
    ]))).toThrow(/previous player data was restored/);
    expect(Object.fromEntries(storage.values)).toEqual({ existing: "preserved" });
  });

  it("clears saved data without resetting the installation identity", () => {
    const storage = new MemoryStorage();
    storage.setItem("progress", "complete");
    storage.setItem("settings", "custom");
    storage.setItem(INSTALLATION_ID_STORAGE_KEY, SOURCE_ID);

    clearPlayerData(storage);

    expect(Object.fromEntries(storage.values)).toEqual({ [INSTALLATION_ID_STORAGE_KEY]: SOURCE_ID });
    expect(getInstallationId(storage)).toBe(SOURCE_ID);
  });

  it("establishes identity when clearing data before startup initialization", () => {
    const storage = new MemoryStorage();
    storage.setItem("progress", "complete");
    clearPlayerData(storage);
    const id = storage.getItem(INSTALLATION_ID_STORAGE_KEY);

    expect(isInstallationId(id)).toBe(true);
    expect(Object.fromEntries(storage.values)).toEqual({ [INSTALLATION_ID_STORAGE_KEY]: id });
    clearPlayerData(storage);
    expect(storage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe(id);
  });

  it("restores identity and saved data if preserving identity during clear fails", () => {
    const storage = new MemoryStorage();
    storage.setItem(INSTALLATION_ID_STORAGE_KEY, SOURCE_ID);
    storage.setItem("progress", "complete");
    const previous = new Map(storage.values);
    const originalSetItem = storage.setItem.bind(storage);
    let shouldFail = true;
    storage.setItem = (key, value) => {
      if (key === INSTALLATION_ID_STORAGE_KEY && shouldFail) {
        shouldFail = false;
        throw new Error("storage unavailable");
      }
      originalSetItem(key, value);
    };

    expect(() => clearPlayerData(storage)).toThrow(/previous player data was restored/);
    expect(storage.values).toEqual(previous);
  });

  it("reports both the original storage failure and a failed rollback", () => {
    const storage = new MemoryStorage();
    storage.setItem(INSTALLATION_ID_STORAGE_KEY, SOURCE_ID);
    const writeError = new Error("storage unavailable");
    storage.setItem = () => { throw writeError; };

    let caught: unknown;
    try {
      clearPlayerData(storage);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([writeError, writeError]);
  });
});
