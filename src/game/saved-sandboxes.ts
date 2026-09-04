import { parseSandboxSnapshot } from "./sandbox-puzzle-authoring";

export const SAVED_SANDBOXES_STORAGE_KEY = "factory2d.saved-sandboxes";
const SAVED_SANDBOXES_VERSION = 1;

export interface SavedSandbox {
  readonly id: string;
  readonly name: string;
  readonly snapshot: string;
  readonly selectedTestCaseId: string;
  readonly width: number;
  readonly height: number;
}

interface StoredSavedSandboxes {
  readonly version: typeof SAVED_SANDBOXES_VERSION;
  readonly nextSandboxId: number;
  readonly sandboxes: readonly SavedSandbox[];
}

type SavedSandboxStorage = Pick<Storage, "getItem" | "setItem">;

export class SavedSandboxes {
  private constructor(
    private readonly sandboxes: SavedSandbox[],
    private nextSandboxId: number,
  ) {}

  static empty(): SavedSandboxes {
    return new SavedSandboxes([], 1);
  }

  static deserialize(serialized: string): SavedSandboxes {
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new Error("Stored sandboxes are not valid JSON");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Stored sandboxes must be an object");
    }
    const stored = value as Record<string, unknown>;
    if (stored.version !== SAVED_SANDBOXES_VERSION) {
      throw new Error("Stored sandboxes have an unsupported version");
    }
    if (
      !Number.isSafeInteger(stored.nextSandboxId) ||
      (stored.nextSandboxId as number) < 1
    ) {
      throw new Error("Stored next sandbox ID must be a positive integer");
    }
    if (!Array.isArray(stored.sandboxes)) {
      throw new Error("Stored sandboxes must be an array");
    }

    const seenIds = new Set<string>();
    const sandboxes = stored.sandboxes.map((valueEntry, index) => {
      if (
        typeof valueEntry !== "object" ||
        valueEntry === null ||
        Array.isArray(valueEntry)
      ) {
        throw new Error(`Stored sandbox at index ${index} must be an object`);
      }
      const entry = valueEntry as Record<string, unknown>;
      const id = requireNonEmptyString(entry.id, `Stored sandbox at index ${index} ID`);
      if (seenIds.has(id)) {
        throw new Error(`Stored sandbox ID ${id} is duplicated`);
      }
      seenIds.add(id);
      const name = requireNonEmptyString(entry.name, `Stored sandbox at index ${index} name`);
      const snapshot = requireString(entry.snapshot, `Stored sandbox at index ${index} snapshot`);
      const selectedTestCaseId = requireNonEmptyString(
        entry.selectedTestCaseId,
        `Stored sandbox at index ${index} selected test case ID`,
      );
      const imported = parseSandboxSnapshot(snapshot, `Stored sandbox ${id}`, selectedTestCaseId);
      if (entry.width !== imported.world.width || entry.height !== imported.world.height) {
        throw new Error(`Stored sandbox at index ${index} has incorrect dimensions`);
      }
      return {
        id,
        name,
        snapshot,
        selectedTestCaseId,
        width: imported.world.width,
        height: imported.world.height,
      };
    });
    return new SavedSandboxes(sandboxes, stored.nextSandboxId as number);
  }

  get entries(): readonly SavedSandbox[] {
    return this.sandboxes;
  }

  findById(id: string): SavedSandbox | undefined {
    return this.sandboxes.find((sandbox) => sandbox.id === id);
  }

  byId(id: string): SavedSandbox {
    const sandbox = this.findById(id);
    if (sandbox === undefined) {
      throw new Error(`Unknown saved sandbox ${id}`);
    }
    return sandbox;
  }

  create(snapshot: string, selectedTestCaseId: string): SavedSandbox {
    const usedNames = new Set(this.sandboxes.map(({ name }) => name));
    let nameNumber = 1;
    while (usedNames.has(`Sandbox ${nameNumber}`)) {
      nameNumber += 1;
    }

    let id = `sandbox-${this.nextSandboxId}`;
    while (this.sandboxes.some((sandbox) => sandbox.id === id)) {
      this.nextSandboxId += 1;
      id = `sandbox-${this.nextSandboxId}`;
    }
    this.nextSandboxId += 1;

    const imported = parseSandboxSnapshot(snapshot, `Saved sandbox ${id}`, selectedTestCaseId);
    const sandbox: SavedSandbox = {
      id,
      name: `Sandbox ${nameNumber}`,
      snapshot,
      selectedTestCaseId,
      width: imported.world.width,
      height: imported.world.height,
    };
    this.sandboxes.push(sandbox);
    return sandbox;
  }

  duplicate(id: string): SavedSandbox {
    const source = this.byId(id);
    const usedNames = new Set(this.sandboxes.map(({ name }) => name));
    const baseName = `${source.name} Copy`;
    let name = baseName;
    let copyNumber = 2;
    while (usedNames.has(name)) {
      name = `${baseName} ${copyNumber}`;
      copyNumber += 1;
    }

    const duplicate = this.create(source.snapshot, source.selectedTestCaseId);
    const renamed = { ...duplicate, name };
    this.sandboxes[this.sandboxes.indexOf(duplicate)] = renamed;
    return renamed;
  }

  update(
    id: string,
    snapshot: string,
    selectedTestCaseId: string,
  ): void {
    const sandbox = this.byId(id);
    const imported = parseSandboxSnapshot(snapshot, `Saved sandbox ${id}`, selectedTestCaseId);
    this.sandboxes[this.sandboxes.indexOf(sandbox)] = {
      ...sandbox,
      snapshot,
      selectedTestCaseId,
      width: imported.world.width,
      height: imported.world.height,
    };
  }

  delete(id: string): void {
    const sandbox = this.byId(id);
    this.sandboxes.splice(this.sandboxes.indexOf(sandbox), 1);
  }

  serialize(): string {
    const stored: StoredSavedSandboxes = {
      version: SAVED_SANDBOXES_VERSION,
      nextSandboxId: this.nextSandboxId,
      sandboxes: this.sandboxes,
    };
    return JSON.stringify(stored);
  }
}

export function loadSavedSandboxes(storage: SavedSandboxStorage): SavedSandboxes {
  const serialized = storage.getItem(SAVED_SANDBOXES_STORAGE_KEY);
  return serialized === null ? SavedSandboxes.empty() : SavedSandboxes.deserialize(serialized);
}

export function saveSavedSandboxes(
  storage: SavedSandboxStorage,
  sandboxes: SavedSandboxes,
): void {
  storage.setItem(SAVED_SANDBOXES_STORAGE_KEY, sandboxes.serialize());
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
  const string = requireString(value, label);
  if (string.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return string;
}

