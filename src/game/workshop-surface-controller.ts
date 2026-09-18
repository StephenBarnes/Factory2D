import { GridRegion } from "./grid-region";
import type { EditableRegionAuthoringState } from "./editable-region-authoring";
import { TileSelectionState } from "./tile-selection";
import type { WorkshopSession } from "./workshop-session";
import { WorkshopSessionController } from "./workshop-session";
import { CanvasRenderer, type CameraView, type NestedBoardView } from "../render/canvas-renderer";
import type { GridCell, GridEdge } from "../render/grid-drag";
import type { Direction } from "../simulation/tile";
import { TileKind } from "../simulation/tile";
import type { Simulation } from "../simulation/simulation";
import type { World } from "../simulation/world";
import { TileInspector } from "../ui/tile-inspector";
import { expectDefined } from "../util/assert";

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
    nestedView: NestedBoardView | null,
  ) => CanvasRenderer;
  readonly createSelection: (width: number, height: number) => TileSelectionState;
  readonly createInspector: (panel: HTMLElement, world: World) => TileInspector;
}

const DEFAULT_FACTORIES: WorkshopSurfaceFactories = {
  createRenderer: (canvas, world, editableRegion, nestedView) =>
    new CanvasRenderer(canvas, world, editableRegion, nestedView),
  createSelection: (width, height) => new TileSelectionState(width, height),
  createInspector: (panel, world) => new TileInspector(panel, world),
};

/** Region containing no cells, shown while a fixed rune array's contents are viewed. */
const LOCKED_REGION = new GridRegion([]);

type InteractionCanceler = () => void;
type MountListener = () => void;

/**
 * One rune array entered from its containing board. `index` caches the array's cell in
 * that board and is repaired by scanning for `id` when the array has moved.
 */
interface NestedViewLevel {
  id: number;
  index: number;
}

/** Breadcrumb entry describing one entered rune array. */
export interface NestedViewTrailEntry {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly description: string;
}

/**
 * Owns every view and cached reference bound to the active workshop runtime.
 *
 * The displayed `world` is normally the session's root board, but entering a rune array
 * mounts its live inner board on the same canvas with the same tools, tracked as a path of
 * array tile IDs from the root. The session's world, simulation, baseline, and previous
 * world stay root-level; `previousWorld` resolves the same path inside the session's
 * previous world for interpolation and is null while it cannot be matched.
 */
export class WorkshopSurfaceController {
  private currentSession: WorkshopSession;
  private currentWorld: World;
  private currentSimulation: Simulation;
  private currentRenderer: CanvasRenderer;
  private currentSelection: TileSelectionState;
  private currentInspector: TileInspector;
  private cancelInteraction: InteractionCanceler | null = null;
  private mountListener: MountListener | null = null;
  private readonly viewPath: NestedViewLevel[] = [];
  private readonly parentViews: Array<CameraView | null> = [];
  private viewEditable = true;

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
    this.currentRenderer = factories.createRenderer(
      canvas,
      session.world,
      session.editableRegion,
      null,
    );
    this.currentSelection = factories.createSelection(session.world.width, session.world.height);
    this.currentInspector = factories.createInspector(inspectorPanel, session.world);
  }

  get session(): WorkshopSession {
    return this.currentSession;
  }

  /** The board being displayed and edited: the root board or an entered rune array's board. */
  get world(): World {
    return this.currentWorld;
  }

  get simulation(): Simulation {
    return this.currentSimulation;
  }

  /** Interpolation source matching `world`, or null while the nested path cannot be matched. */
  get previousWorld(): World | null {
    if (this.viewPath.length === 0) {
      return this.currentSession.previousWorld;
    }
    const previous = resolveNestedPath(this.currentSession.previousWorld, this.viewPath, false);
    return previous !== null &&
        previous.width === this.currentWorld.width &&
        previous.height === this.currentWorld.height
      ? previous
      : null;
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

  /** Number of rune arrays entered below the root board. */
  get viewDepth(): number {
    return this.viewPath.length;
  }

  /**
   * Editable cells of the displayed board: the puzzle region at the root, every cell inside
   * an editable rune array, and nothing inside a fixed one.
   */
  get editableRegion(): GridRegion | null {
    if (this.viewPath.length === 0) {
      return this.currentSession.editableRegion;
    }
    return this.viewEditable ? null : LOCKED_REGION;
  }

  /** Sandbox region authoring applies to the root board only. */
  get editableRegionAuthoring(): EditableRegionAuthoringState | null {
    return this.viewPath.length === 0 ? this.currentSession.editableRegionAuthoring : null;
  }

  /** Entered arrays from the root down to the displayed board, for breadcrumb display. */
  get viewTrail(): NestedViewTrailEntry[] {
    const trail: NestedViewTrailEntry[] = [];
    let world = this.currentSession.world;
    for (const level of this.viewPath) {
      const snapshot = world.componentStateSnapshotAtIndex(level.index);
      const inner = world.runeArrayWorldAtIndex(level.index);
      trail.push({
        id: level.id,
        width: inner.width,
        height: inner.height,
        description: snapshot?.type === "array" ? snapshot.description : "",
      });
      world = inner;
    }
    return trail;
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
    const view = options.fitBoard ? null : this.parentViews.length > 0
      ? expectDefined(this.parentViews[0], "Missing root camera view")
      : this.currentRenderer.captureView();

    const session = this.sessions.active;
    this.currentSession = session;
    this.currentSimulation = session.simulation;
    this.viewPath.length = 0;
    this.parentViews.length = 0;
    this.viewEditable = true;
    this.mountView(session.world, view);
  }

  /** Displays the inner board of the rune array at `cell` on the displayed board. */
  enterRuneArray(cell: GridCell): boolean {
    const world = this.currentWorld;
    if (world.kindAt(cell.x, cell.y) !== TileKind.RuneArray) {
      return false;
    }
    const editable = this.viewPath.length === 0
      ? this.currentSession.editableRegion?.contains(cell.x, cell.y) ?? true
      : this.viewEditable;
    this.cancelInteraction?.();
    this.parentViews.push(this.currentRenderer.captureView());
    this.viewPath.push({
      id: world.idAt(cell.x, cell.y),
      index: cell.y * world.width + cell.x,
    });
    this.viewEditable = editable;
    this.mountView(world.runeArrayWorldAt(cell.x, cell.y));
    return true;
  }

  /** Returns to the board containing the displayed rune array; false at the root. */
  exitRuneArray(): boolean {
    if (this.viewPath.length === 0) {
      return false;
    }
    this.cancelInteraction?.();
    this.viewPath.pop();
    if (this.viewPath.length === 0) {
      this.viewEditable = true;
    }
    this.mountResolvedView(this.resolveViewWorld());
    return true;
  }

  /**
   * Re-resolves the nested path against the session's current root board and remounts when
   * the displayed board object changed (array resized, removed, or the session reset), so
   * callers may read `world` afterwards. Cheap while nothing changed.
   */
  refreshView(): void {
    if (this.viewPath.length === 0) {
      if (this.currentWorld !== this.currentSession.world) {
        this.mountView(this.currentSession.world);
      }
      return;
    }
    const world = this.resolveViewWorld();
    if (world !== this.currentWorld) {
      this.cancelInteraction?.();
      this.mountResolvedView(world);
    }
  }

  clearPointerHover(): void {
    this.hoveredCell = null;
    this.hoveredEdge = null;
  }

  /** Deepest board on the nested path, truncating the path past any array that is gone. */
  private resolveViewWorld(): World {
    const world = resolveNestedPath(this.currentSession.world, this.viewPath, true);
    if (world === null) {
      throw new Error("Nested view path could not resolve the root board");
    }
    if (this.viewPath.length === 0) {
      this.viewEditable = true;
    }
    return world;
  }

  private mountResolvedView(world: World): void {
    const view = this.parentViews.length > this.viewPath.length
      ? expectDefined(this.parentViews[this.viewPath.length], "Missing parent camera view")
      : null;
    this.parentViews.length = this.viewPath.length;
    this.mountView(world, view);
  }

  private mountView(world: World, view: CameraView | null = null): void {
    const nestedView = this.viewPath.length === 0 ? null : this.createNestedView();
    const renderer = this.factories.createRenderer(
      this.canvas,
      world,
      this.viewPath.length === 0 ? this.currentSession.editableRegion : this.editableRegion,
      nestedView,
    );
    this.currentWorld = world;
    this.currentSelection = this.factories.createSelection(world.width, world.height);
    this.currentRenderer = renderer;
    this.currentInspector = this.factories.createInspector(this.inspectorPanel, world);
    this.hoveredCell = null;
    this.hoveredEdge = null;
    this.hoveredPaletteButton = null;

    if (view === null) {
      renderer.fitBoardToViewport();
    } else {
      renderer.restoreView(view);
    }
    this.mountListener?.();
  }

  private createNestedView(): NestedBoardView {
    return {
      portCharge: (side: Direction) => {
        const parentPath = this.viewPath.slice(0, -1);
        const level = this.viewPath[this.viewPath.length - 1];
        const parent = resolveNestedPath(this.currentSession.world, parentPath, false);
        if (level === undefined || parent === null) {
          return 0;
        }
        const index = locateArray(parent, level);
        return index < 0 ? 0 : parent.chargeAtPortIndex(index, side);
      },
    };
  }
}

/**
 * Walks `path` down from `root`. With `repair`, cached indices are updated to follow moved
 * arrays and the path is truncated at the first array that no longer exists; without it,
 * a missing array yields null and nothing is modified.
 */
function resolveNestedPath(
  root: World,
  path: NestedViewLevel[],
  repair: boolean,
): World | null {
  let world = root;
  for (let depth = 0; depth < path.length; depth += 1) {
    const level = path[depth];
    if (level === undefined) {
      throw new Error(`Missing nested view level ${depth}`);
    }
    const index = locateArray(world, level);
    if (index < 0) {
      if (!repair) {
        return null;
      }
      path.length = depth;
      return world;
    }
    if (repair) {
      level.index = index;
      level.id = world.idAtIndex(index);
    }
    world = world.runeArrayWorldAtIndex(index);
  }
  return world;
}

/**
 * Cell index of the rune array identified by `level` inside `world`: the cached index when
 * it still holds that ID, otherwise a scan for the ID, otherwise the cached index when it
 * holds any rune array (which recovers arrays re-created in place by a reset), else -1.
 */
function locateArray(world: World, level: NestedViewLevel): number {
  if (
    level.index >= 0 &&
    level.index < world.cellCount &&
    world.idAtIndex(level.index) === level.id &&
    world.kindAtIndex(level.index) === TileKind.RuneArray
  ) {
    return level.index;
  }
  for (let index = 0; index < world.cellCount; index += 1) {
    if (world.idAtIndex(index) === level.id) {
      return world.kindAtIndex(index) === TileKind.RuneArray ? index : -1;
    }
  }
  return level.index >= 0 &&
      level.index < world.cellCount &&
      world.kindAtIndex(level.index) === TileKind.RuneArray
    ? level.index
    : -1;
}
