import { TileSelectionState } from "./tile-selection";
import type { WorkshopSession } from "./workshop-session";
import { WorkshopSessionController } from "./workshop-session";
import { CanvasRenderer } from "../render/canvas-renderer";
import type { GridCell, GridEdge } from "../render/grid-drag";
import type { Simulation } from "../simulation/simulation";
import type { World } from "../simulation/world";
import { TileInspector } from "../ui/tile-inspector";

export interface MountActiveSessionOptions {
  readonly fitBoard: boolean;
  readonly cancelInteraction: boolean;
  readonly updateSession?: () => void;
}

export interface WorkshopSurfaceFactories {
  readonly createRenderer: (
    canvas: HTMLCanvasElement,
    world: World,
    editableRegion: WorkshopSession["editableRegion"],
  ) => CanvasRenderer;
  readonly createSelection: (width: number, height: number) => TileSelectionState;
  readonly createInspector: (panel: HTMLElement, world: World) => TileInspector;
}

const DEFAULT_FACTORIES: WorkshopSurfaceFactories = {
  createRenderer: (canvas, world, editableRegion) =>
    new CanvasRenderer(canvas, world, editableRegion),
  createSelection: (width, height) => new TileSelectionState(width, height),
  createInspector: (panel, world) => new TileInspector(panel, world),
};

type InteractionCanceler = () => void;
type MountListener = () => void;

/** Owns every view and cached reference bound to the active workshop runtime. */
export class WorkshopSurfaceController {
  private currentSession: WorkshopSession;
  private currentWorld: World;
  private currentSimulation: Simulation;
  private currentPreviousWorld: World;
  private currentRenderer: CanvasRenderer;
  private currentSelection: TileSelectionState;
  private currentInspector: TileInspector;
  private cancelInteraction: InteractionCanceler | null = null;
  private mountListener: MountListener | null = null;

  hoveredCell: GridCell | null = null;
  hoveredEdge: GridEdge | null = null;
  hoveredPaletteButton: HTMLButtonElement | null = null;

  constructor(
    private readonly sessions: WorkshopSessionController,
    readonly canvas: HTMLCanvasElement,
    private readonly inspectorPanel: HTMLElement,
    private readonly factories: WorkshopSurfaceFactories = DEFAULT_FACTORIES,
  ) {
    const session = sessions.active;
    this.currentSession = session;
    this.currentWorld = session.world;
    this.currentSimulation = session.simulation;
    this.currentPreviousWorld = session.previousWorld;
    this.currentRenderer = factories.createRenderer(canvas, session.world, session.editableRegion);
    this.currentSelection = factories.createSelection(session.world.width, session.world.height);
    this.currentInspector = factories.createInspector(inspectorPanel, session.world);
  }

  get session(): WorkshopSession {
    return this.currentSession;
  }

  get world(): World {
    return this.currentWorld;
  }

  get simulation(): Simulation {
    return this.currentSimulation;
  }

  get previousWorld(): World {
    return this.currentPreviousWorld;
  }

  get renderer(): CanvasRenderer {
    return this.currentRenderer;
  }

  get selection(): TileSelectionState {
    return this.currentSelection;
  }

  get inspector(): TileInspector {
    return this.currentInspector;
  }

  setInteractionCanceler(canceler: InteractionCanceler): void {
    this.cancelInteraction = canceler;
  }

  setMountListener(listener: MountListener): void {
    this.mountListener = listener;
  }

  mountActiveSession(options: MountActiveSessionOptions): void {
    if (options.cancelInteraction) {
      this.cancelInteraction?.();
    }
    options.updateSession?.();

    const session = this.sessions.active;
    const world = session.world;
    const simulation = session.simulation;
    const previousWorld = session.previousWorld;
    const selection = this.factories.createSelection(world.width, world.height);
    const renderer = this.factories.createRenderer(this.canvas, world, session.editableRegion);
    const inspector = this.factories.createInspector(this.inspectorPanel, world);

    this.currentSession = session;
    this.currentWorld = world;
    this.currentSimulation = simulation;
    this.currentPreviousWorld = previousWorld;
    this.currentSelection = selection;
    this.currentRenderer = renderer;
    this.currentInspector = inspector;
    this.hoveredCell = null;
    this.hoveredEdge = null;
    this.hoveredPaletteButton = null;

    if (options.fitBoard) {
      renderer.fitBoardToViewport();
    }
    this.mountListener?.();
  }

  clearPointerHover(): void {
    this.hoveredCell = null;
    this.hoveredEdge = null;
  }
}
