import { GridRegion } from "./grid-region";
import {
  loadSavedSandboxes,
  SavedSandboxes,
  saveSavedSandboxes,
} from "./saved-sandboxes";
import type { SavedSandbox } from "./saved-sandboxes";
import {
  parseSandboxSnapshot,
  SandboxPuzzleAuthoringState,
} from "./sandbox-puzzle-authoring";
import type { SandboxPuzzleImport } from "./sandbox-puzzle-authoring";
import { createSandboxWorld } from "./puzzles";
import type { SandboxWorkshopSnapshot } from "./workshop-session";


type SavedSandboxStorage = Pick<Storage, "getItem" | "setItem">;

export class SavedSandboxController {
  private readonly dirtySandboxIds = new Set<string>();
  private readonly savedSandboxes: SavedSandboxes;

  constructor(private readonly storage: SavedSandboxStorage) {
    try {
      this.savedSandboxes = loadSavedSandboxes(storage);
    } catch (error) {
      console.error("Could not load saved sandboxes:", error);
      this.savedSandboxes = SavedSandboxes.empty();
    }
  }

  get entries(): readonly SavedSandbox[] {
    return this.savedSandboxes.entries;
  }

  findById(sandboxId: string): SavedSandbox | undefined {
    return this.savedSandboxes.findById(sandboxId);
  }

  byId(sandboxId: string): SavedSandbox {
    return this.savedSandboxes.byId(sandboxId);
  }

  create(): SavedSandbox {
    const world = createSandboxWorld();
    const authoring = SandboxPuzzleAuthoringState.createDefault(world);
    const sandbox = this.savedSandboxes.create(
      authoring.serialize(new GridRegion([])),
      authoring.selectedTestCaseId,
    );
    this.persist();
    return sandbox;
  }

  duplicate(sandboxId: string): SavedSandbox {
    const duplicate = this.savedSandboxes.duplicate(sandboxId);
    this.persist();
    return duplicate;
  }

  delete(sandboxId: string): SavedSandbox {
    const sandbox = this.byId(sandboxId);
    this.savedSandboxes.delete(sandboxId);
    this.dirtySandboxIds.delete(sandboxId);
    this.persist();
    return sandbox;
  }

  import(sandboxId: string): SandboxPuzzleImport {
    const sandbox = this.byId(sandboxId);
    return parseSandboxSnapshot(
      sandbox.snapshot,
      `Saved sandbox ${sandbox.id}`,
      sandbox.selectedTestCaseId,
    );
  }

  markDirty(sandboxId: string): void {
    this.byId(sandboxId);
    this.dirtySandboxIds.add(sandboxId);
  }

  persistSnapshotIfDirty(
    sandboxId: string,
    snapshot: SandboxWorkshopSnapshot,
  ): void {
    if (!this.dirtySandboxIds.has(sandboxId)) {
      return;
    }
    this.savedSandboxes.update(
      sandboxId,
      snapshot.source,
      snapshot.selectedTestCaseId,
    );
    this.persist();
    this.dirtySandboxIds.delete(sandboxId);
  }

  private persist(): void {
    try {
      saveSavedSandboxes(this.storage, this.savedSandboxes);
    } catch (error) {
      console.error("Could not save sandboxes:", error);
    }
  }
}
