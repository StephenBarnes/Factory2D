import { getInstallationId, INSTALLATION_ID_STORAGE_KEY, isInstallationId } from "./installation-id";

export const PLAYER_DATA_FORMAT = "factory2d-player-data";
export const PLAYER_DATA_VERSION = 1;

type PlayerDataStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "clear">;

interface PlayerDataEntry {
  readonly key: string;
  readonly value: string;
}

interface StoredPlayerData {
  readonly format: typeof PLAYER_DATA_FORMAT;
  readonly version: typeof PLAYER_DATA_VERSION;
  readonly entries: readonly PlayerDataEntry[];
}

function snapshotEntries(storage: PlayerDataStorage): PlayerDataEntry[] {
  const entries: PlayerDataEntry[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null) {
      throw new Error(`Player data storage key ${index} is missing`);
    }
    const value = storage.getItem(key);
    if (value === null) {
      throw new Error(`Player data storage value for ${JSON.stringify(key)} is missing`);
    }
    entries.push({ key, value });
  }
  entries.sort((first, second) => first.key.localeCompare(second.key));
  return entries;
}

function parsePlayerData(serialized: string): readonly PlayerDataEntry[] {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Player data file is not valid JSON");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Player data file must contain an object");
  }
  const record = value as Record<string, unknown>;
  if (record.format !== PLAYER_DATA_FORMAT) {
    throw new Error("File is not a Factory 2D player data export");
  }
  if (record.version !== PLAYER_DATA_VERSION) {
    throw new Error("Player data file has an unsupported version");
  }
  if (!Array.isArray(record.entries)) {
    throw new Error("Player data file entries must be an array");
  }

  const seenKeys = new Set<string>();
  return record.entries.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`Player data entry ${index} must be an object`);
    }
    const entryRecord = entry as Record<string, unknown>;
    if (typeof entryRecord.key !== "string" || typeof entryRecord.value !== "string") {
      throw new Error(`Player data entry ${index} must contain string key and value fields`);
    }
    if (seenKeys.has(entryRecord.key)) {
      throw new Error(`Player data file contains duplicate key ${JSON.stringify(entryRecord.key)}`);
    }
    if (entryRecord.key === INSTALLATION_ID_STORAGE_KEY && !isInstallationId(entryRecord.value)) {
      throw new Error("Player data installation ID is not a valid UUID");
    }
    seenKeys.add(entryRecord.key);
    return { key: entryRecord.key, value: entryRecord.value };
  });
}

function restoreEntries(storage: PlayerDataStorage, entries: readonly PlayerDataEntry[]): void {
  storage.clear();
  for (const entry of entries) {
    storage.setItem(entry.key, entry.value);
  }
}

export function serializePlayerData(storage: PlayerDataStorage): string {
  getInstallationId(storage);
  const playerData: StoredPlayerData = {
    format: PLAYER_DATA_FORMAT,
    version: PLAYER_DATA_VERSION,
    entries: snapshotEntries(storage),
  };
  return JSON.stringify(playerData);
}

function replaceEntriesAtomically(
  storage: PlayerDataStorage,
  entries: readonly PlayerDataEntry[],
  previousEntries: readonly PlayerDataEntry[],
  operation: "import" | "clear",
): void {
  try {
    restoreEntries(storage, entries);
  } catch (error) {
    try {
      restoreEntries(storage, previousEntries);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Could not ${operation} player data or restore the previous player data`,
      );
    }
    throw new Error(`Could not ${operation} player data; the previous player data was restored`, {
      cause: error,
    });
  }
}

export function replacePlayerData(storage: PlayerDataStorage, serialized: string): void {
  const importedEntries = parsePlayerData(serialized);
  const previousEntries = snapshotEntries(storage);
  const entries = importedEntries.some((entry) => entry.key === INSTALLATION_ID_STORAGE_KEY)
    ? importedEntries
    : [...importedEntries, { key: INSTALLATION_ID_STORAGE_KEY, value: getInstallationId(storage) }];
  replaceEntriesAtomically(storage, entries, previousEntries, "import");
}

export function clearPlayerData(storage: PlayerDataStorage): void {
  const previousEntries = snapshotEntries(storage);
  const installationId = getInstallationId(storage);
  replaceEntriesAtomically(
    storage,
    [{ key: INSTALLATION_ID_STORAGE_KEY, value: installationId }],
    previousEntries,
    "clear",
  );
}
