import type { PuzzleDefinition } from "./puzzles";
import { applyEditableSolution } from "./editable-solution";
import type { SavedPuzzleSolution } from "./puzzle-solutions";
import { GridRegion, type GridRectangle } from "./grid-region";
import { EditableRegionAuthoringState } from "./editable-region-authoring";
import type { PuzzleComponents } from "./puzzle-components";
import {
  SandboxPuzzleAuthoringState,
  type BoardEdge,
  type SandboxPuzzleImport,
  type SandboxPuzzleProperties,
} from "./sandbox-puzzle-authoring";
import { WorkshopEditingState } from "./workshop-editing-state";
import { deserializeBoard, serializeBoard } from "../simulation/board-export";
import { Simulation } from "../simulation/simulation";
import { World } from "../simulation/world";
import { expectDefined } from "../util/assert";

export interface WorkshopSession {
  world: World;
  simulation: Simulation;
  baseline: World;
  previousWorld: World;
  readonly editableRegion: GridRegion | null;
  readonly editableRegionAuthoring: EditableRegionAuthoringState | null;
  readonly availableComponents: PuzzleComponents | null;
  puzzleAuthoring: SandboxPuzzleAuthoringState | null;
  readonly editingState: WorkshopEditingState;
}

export interface SandboxWorkshopSnapshot {
  readonly source: string;
  readonly selectedTestCaseId: string;
}

interface WorkshopEditSnapshot {
  readonly source: string;
  readonly region: string | null;
  readonly selectedTestCaseId: string | null;
}

interface WorkshopEditHistory {
  readonly snapshots: WorkshopEditSnapshot[];
  index: number;
  group: object | undefined;
}

const MAX_UNDO_ACTIONS = 30;

function createWorkshopSession(
  world: World,
  puzzle: PuzzleDefinition | null = null,
): WorkshopSession {
  return {
    world,
    simulation: new Simulation(world),
    baseline: world.clone(),
    previousWorld: world.clone(),
    editableRegion: puzzle?.editableRegion ?? null,
    editableRegionAuthoring: puzzle === null
      ? new EditableRegionAuthoringState(world.width, world.height)
      : null,
    availableComponents: puzzle?.availableComponents ?? null,
    puzzleAuthoring: puzzle === null
      ? SandboxPuzzleAuthoringState.createDefault(world)
      : null,
    editingState: new WorkshopEditingState(puzzle !== null),
  };
}

export class WorkshopSessionController {
  private readonly sandboxSessions = new Map<string, WorkshopSession>();
  private readonly solutionSessions = new Map<string, WorkshopSession>();
  private readonly histories = new WeakMap<WorkshopSession, WorkshopEditHistory>();
  private currentSession: WorkshopSession;

  constructor(sandboxWorld: World) {
    this.currentSession = createWorkshopSession(sandboxWorld);
    this.seedHistory();
  }

  get active(): WorkshopSession {
    return this.currentSession;
  }

  get canUndo(): boolean {
    return this.currentSession.editingState.editable && this.history.index > 0;
  }

  get canRedo(): boolean {
    const history = this.history;
    return this.currentSession.editingState.editable && history.index + 1 < history.snapshots.length;
  }

  undoEdit(): boolean {
    return this.restoreHistory(-1);
  }

  redoEdit(): boolean {
    return this.restoreHistory(1);
  }

  activateSandbox(sandboxId: string, imported: SandboxPuzzleImport): boolean {
    let session = this.sandboxSessions.get(sandboxId);
    if (session === undefined) {
      session = createWorkshopSession(imported.world);
      session.simulation.tick = imported.tick;
      session.puzzleAuthoring = imported.authoring;
      const regionAuthoring = session.editableRegionAuthoring;
      if (regionAuthoring === null) {
        throw new Error("Sandbox editable-region authoring state is missing");
      }
      regionAuthoring.replaceForBoard(
        imported.world.width,
        imported.world.height,
        imported.editableRegion,
      );
      this.sandboxSessions.set(sandboxId, session);
      this.seedHistory(session);
    }
    return this.activate(session);
  }

  activateSolution(
    solution: SavedPuzzleSolution,
    puzzle: PuzzleDefinition,
  ): boolean {
    if (solution.puzzleId !== puzzle.id) {
      throw new Error(`Solution ${solution.id} does not belong to puzzle ${puzzle.id}`);
    }

    let session = this.solutionSessions.get(solution.id);
    if (session === undefined) {
      const imported = deserializeBoard(solution.board);
      session = createWorkshopSession(imported.world, puzzle);
      this.solutionSessions.set(solution.id, session);
      this.seedHistory(session);
    }
    return this.activate(session);
  }

  forgetSandbox(sandboxId: string): void {
    this.sandboxSessions.delete(sandboxId);
  }

  forgetSolution(solutionId: string): void {
    this.solutionSessions.delete(solutionId);
  }

  replaceActiveWorld(world: World, tick: number): void {
    if (!this.currentSession.editingState.editable) {
      return;
    }
    this.replaceRuntime(world, tick);
    if (this.currentSession.puzzleAuthoring !== null) {
      this.currentSession.puzzleAuthoring = SandboxPuzzleAuthoringState.createDefault(world);
    }
    this.currentSession.editableRegionAuthoring?.resetForBoard(world.width, world.height);
    this.recordEdit();
  }

  replaceActiveSandboxImport(imported: SandboxPuzzleImport): void {
    this.requireActiveSandbox();
    this.replaceRuntime(imported.world, imported.tick);
    this.currentSession.puzzleAuthoring = imported.authoring;
    const regionAuthoring = this.currentSession.editableRegionAuthoring;
    if (regionAuthoring === null) {
      throw new Error("Sandbox editable-region authoring state is missing");
    }
    regionAuthoring.replaceForBoard(
      imported.world.width,
      imported.world.height,
      imported.editableRegion,
    );
    this.recordSandboxEdit();
  }

  updateActiveSandboxProperties(properties: SandboxPuzzleProperties): boolean {
    this.requireActiveSandbox();
    const authoring = this.currentSession.puzzleAuthoring;
    const regionAuthoring = this.currentSession.editableRegionAuthoring;
    if (authoring === null || regionAuthoring === null) {
      throw new Error("Sandbox puzzle authoring state is missing");
    }

    const dimensionsChanged = properties.width !== this.currentSession.world.width ||
      properties.height !== this.currentSession.world.height;
    authoring.saveSelectedWorld(this.currentSession.baseline);
    authoring.update(properties);
    if (dimensionsChanged) {
      regionAuthoring.resizeForBoard(properties.width, properties.height);
      this.replaceRuntime(authoring.selectedWorld(), 0);
    }
    this.recordSandboxEdit();
    return dimensionsChanged;
  }

  cropActiveSandbox(bounds: GridRectangle): void {
    const authoring = this.activeSandboxAuthoring();
    const regionAuthoring = this.currentSession.editableRegionAuthoring;
    if (regionAuthoring === null) {
      throw new Error("Sandbox editable-region authoring state is missing");
    }
    authoring.saveSelectedWorld(this.currentSession.world);
    authoring.crop(bounds);
    regionAuthoring.resizeForBoard(bounds.width, bounds.height, bounds.x, bounds.y);
    this.replaceRuntime(authoring.selectedWorld(), 0);
    this.recordSandboxEdit();
  }

  resizeActiveSandboxEdge(edge: BoardEdge, delta: 1 | -1): void {
    const authoring = this.activeSandboxAuthoring();
    const regionAuthoring = this.currentSession.editableRegionAuthoring;
    if (regionAuthoring === null) {
      throw new Error("Sandbox editable-region authoring state is missing");
    }
    const bounds = authoring.resizeEdge(edge, delta, this.currentSession.world);
    regionAuthoring.resizeForBoard(bounds.width, bounds.height, bounds.x, bounds.y);
    this.replaceRuntime(authoring.selectedWorld(), 0);
    this.recordSandboxEdit();
  }

  selectActiveSandboxTestCase(testCaseId: string): void {
    const authoring = this.activeSandboxAuthoring();
    authoring.saveSelectedWorld(this.currentSession.baseline);
    this.replaceRuntime(authoring.selectTestCase(testCaseId), 0);
    // Browsing changes the current view, not the design or the redo branch.
    const history = this.history;
    const snapshot = expectDefined(history.snapshots[history.index], "Current edit snapshot is missing");
    history.snapshots[history.index] = { ...snapshot, selectedTestCaseId: testCaseId };
    history.group = undefined;
  }

  duplicateActiveSandboxTestCase(): void {
    const authoring = this.activeSandboxAuthoring();
    authoring.saveSelectedWorld(this.currentSession.baseline);
    this.replaceRuntime(authoring.duplicateSelectedTestCase(), 0);
    this.recordSandboxEdit();
  }

  deleteActiveSandboxTestCase(): void {
    const authoring = this.activeSandboxAuthoring();
    this.replaceRuntime(authoring.deleteSelectedTestCase(), 0);
    this.recordSandboxEdit();
  }


  showActiveRuntime(world: World, simulation = new Simulation(world)): void {
    if (
      world.width !== this.currentSession.baseline.width ||
      world.height !== this.currentSession.baseline.height
    ) {
      throw new RangeError("Runtime world dimensions must match the workshop baseline");
    }
    if (simulation.world !== world) {
      throw new Error("Runtime simulation must own the displayed world");
    }
    this.currentSession.world = world;
    this.currentSession.simulation = simulation;
    this.currentSession.previousWorld = world.clone();
  }

  beginSimulation(): boolean {
    const wasEditable = this.currentSession.editingState.editable;
    this.currentSession.editingState.beginSimulation();
    return wasEditable !== this.currentSession.editingState.editable;
  }

  resetSimulation(): void {
    this.currentSession.editingState.resetSimulation();
    this.currentSession.simulation.resetTo(this.currentSession.baseline);
  }

  saveEditedBaseline(group?: object): void {
    if (!this.currentSession.editingState.editable) {
      return;
    }
    this.currentSession.world.resetPuzzleResult();
    if (this.currentSession.editableRegion === null) {
      this.currentSession.baseline.copyFrom(this.currentSession.world);
    } else {
      applyEditableSolution(
        this.currentSession.baseline,
        this.currentSession.world,
        this.currentSession.editableRegion,
      );
      this.currentSession.baseline.resetPuzzleResult();
    }
    this.currentSession.simulation.tick = 0;
    this.currentSession.puzzleAuthoring?.saveSelectedWorld(this.currentSession.baseline);
    this.recordEdit(group);
  }

  recordSandboxEdit(group?: object): void {
    this.requireActiveSandbox();
    this.recordEdit(group);
  }

  private replaceRuntime(world: World, tick: number): void {
    const simulation = new Simulation(world);
    simulation.tick = tick;
    this.currentSession.world = world;
    this.currentSession.simulation = simulation;
    this.currentSession.baseline = world.clone();
    this.currentSession.previousWorld = world.clone();
  }

  snapshotActiveSandbox(): SandboxWorkshopSnapshot {
    this.requireActiveSandbox();
    const authoring = this.activeSandboxAuthoring();
    const regionAuthoring = this.currentSession.editableRegionAuthoring;
    if (regionAuthoring === null) {
      throw new Error("Sandbox editable-region authoring state is missing");
    }
    authoring.saveSelectedWorld(this.currentSession.baseline);
    return {
      source: authoring.serialize(regionAuthoring.region),
      selectedTestCaseId: authoring.selectedTestCaseId,
    };
  }

  private get history(): WorkshopEditHistory {
    return expectDefined(this.histories.get(this.currentSession), "Session edit history is missing");
  }

  private seedHistory(session = this.currentSession): void {
    this.histories.set(session, {
      snapshots: [this.captureEditSnapshot(session)],
      index: 0,
      group: undefined,
    });
  }

  private captureEditSnapshot(session = this.currentSession): WorkshopEditSnapshot {
    const authoring = session.puzzleAuthoring;
    if (authoring === null) {
      return {
        source: serializeBoard(session.baseline, 0),
        region: null,
        selectedTestCaseId: null,
      };
    }
    const regionAuthoring = session.editableRegionAuthoring;
    if (regionAuthoring === null) {
      throw new Error("Sandbox editable-region authoring state is missing");
    }
    return {
      source: authoring.serializeSnapshot(),
      region: JSON.stringify(regionAuthoring.region.rectangles),
      selectedTestCaseId: authoring.selectedTestCaseId,
    };
  }

  private recordEdit(group?: object): void {
    const history = this.history;
    const snapshot = this.captureEditSnapshot();
    const current = expectDefined(history.snapshots[history.index], "Current edit snapshot is missing");
    if (snapshot.source === current.source && snapshot.region === current.region) {
      return;
    }
    history.snapshots.splice(history.index + 1);
    if (group !== undefined && group === history.group && history.index > 0) {
      history.snapshots[history.index] = snapshot;
    } else {
      history.snapshots.push(snapshot);
      history.index += 1;
      if (history.index > MAX_UNDO_ACTIONS) {
        history.snapshots.shift();
        history.index -= 1;
      }
    }
    history.group = group;
  }

  private restoreHistory(direction: -1 | 1): boolean {
    const history = this.history;
    history.group = undefined;
    const index = history.index + direction;
    if (!this.currentSession.editingState.editable || index < 0 || index >= history.snapshots.length) {
      return false;
    }
    const snapshot = expectDefined(history.snapshots[index], "Restored edit snapshot is missing");
    if (snapshot.selectedTestCaseId === null) {
      const { world } = deserializeBoard(snapshot.source);
      world.resetPuzzleResult();
      this.replaceRuntime(world, 0);
    } else {
      const authoring = SandboxPuzzleAuthoringState.fromSnapshot(
        snapshot.source,
        snapshot.selectedTestCaseId,
      );
      const regionAuthoring = this.currentSession.editableRegionAuthoring;
      if (snapshot.region === null || regionAuthoring === null) {
        throw new Error("Sandbox snapshot editable-region authoring state is missing");
      }
      const region = new GridRegion(JSON.parse(snapshot.region) as GridRectangle[]);
      const world = authoring.selectedWorld();
      world.resetPuzzleResult();
      regionAuthoring.replaceForBoard(world.width, world.height, region);
      this.currentSession.puzzleAuthoring = authoring;
      this.replaceRuntime(world, 0);
    }
    this.currentSession.editingState.resetSimulation();
    history.index = index;
    return true;
  }

  private requireActiveSandbox(): void {
    if (this.currentSession.puzzleAuthoring === null) {
      throw new Error("Sandbox authoring can only change an active sandbox session");
    }
  }
  private activeSandboxAuthoring(): SandboxPuzzleAuthoringState {
    this.requireActiveSandbox();
    const authoring = this.currentSession.puzzleAuthoring;
    if (authoring === null) {
      throw new Error("Sandbox puzzle authoring state is missing");
    }
    return authoring;
  }


  private activate(session: WorkshopSession): boolean {
    if (session === this.currentSession) {
      return false;
    }
    this.history.group = undefined;
    this.currentSession = session;
    this.history.group = undefined;
    return true;
  }
}
