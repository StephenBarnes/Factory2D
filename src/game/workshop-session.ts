import type { PuzzleDefinition } from "./puzzles";
import { applyEditableSolution } from "./editable-solution";
import type { SavedPuzzleSolution } from "./puzzle-solutions";
import type { GridRegion } from "./grid-region";
import { EditableRegionAuthoringState } from "./editable-region-authoring";
import type { PuzzleComponents } from "./puzzle-components";
import { WorkshopEditingState } from "./workshop-editing-state";
import { deserializeBoard } from "../simulation/board-export";
import { Simulation } from "../simulation/simulation";
import { World } from "../simulation/world";

export interface WorkshopSession {
  world: World;
  simulation: Simulation;
  baseline: World;
  previousWorld: World;
  readonly editableRegion: GridRegion | null;
  readonly editableRegionAuthoring: EditableRegionAuthoringState | null;
  readonly availableComponents: PuzzleComponents | null;
  readonly editingState: WorkshopEditingState;
}

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
    editingState: new WorkshopEditingState(puzzle !== null),
  };
}

export class WorkshopSessionController {
  private readonly sandboxSession: WorkshopSession;
  private readonly solutionSessions = new Map<string, WorkshopSession>();
  private currentSession: WorkshopSession;

  constructor(sandboxWorld: World) {
    this.sandboxSession = createWorkshopSession(sandboxWorld);
    this.currentSession = this.sandboxSession;
  }

  get active(): WorkshopSession {
    return this.currentSession;
  }

  activateSandbox(): boolean {
    return this.activate(this.sandboxSession);
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
    }
    return this.activate(session);
  }

  forgetSolution(solutionId: string): void {
    this.solutionSessions.delete(solutionId);
  }

  replaceActiveWorld(world: World, tick: number): void {
    const simulation = new Simulation(world);
    simulation.tick = tick;
    this.currentSession.world = world;
    this.currentSession.simulation = simulation;
    this.currentSession.baseline = world.clone();
    this.currentSession.previousWorld = world.clone();
    this.currentSession.editableRegionAuthoring?.resetForBoard(world.width, world.height);
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

  saveEditedBaseline(): void {
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
  }

  private activate(session: WorkshopSession): boolean {
    if (session === this.currentSession) {
      return false;
    }
    this.currentSession = session;
    return true;
  }
}
