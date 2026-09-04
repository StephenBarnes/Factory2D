import type { WorkshopSession } from "../game/workshop-session";
import type { TileSelectionState } from "../game/tile-selection";
import type { CanvasRenderer } from "../render/canvas-renderer";
import {
  clampedCellFromGridPoint,
  cellsOnGridSegment,
} from "../render/grid-drag";
import type { GridCell, GridEdge, GridPoint } from "../render/grid-drag";
import {
  exceedsPanDragThreshold,
  pointerGesture,
  shouldWeldPlacedTile,
} from "../render/pointer-gesture";
import { componentConfigurationForKind } from "../simulation/configurable-components";
import type { TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";
import type { TextBoxTool } from "./text-box-tool";

export type BuildTool = "tile" | "weld" | "selection" | "editable-region" | "text-box";

export interface CanvasInteractionSurface {
  readonly canvas: HTMLCanvasElement;
  readonly session: WorkshopSession;
  readonly world: World;
  readonly renderer: CanvasRenderer;
  readonly selection: TileSelectionState;
  hoveredCell: GridCell | null;
  hoveredEdge: GridEdge | null;
  clearPointerHover(): void;
}

export interface CanvasInteractionCallbacks {
  readonly getSelectedTool: () => BuildTool;
  readonly textBoxTool?: TextBoxTool;
  readonly getSelectedKind: () => TileKind;
  readonly editCellLine: (
    from: GridCell,
    to: GridCell,
    erase: boolean,
    weldPlacedTiles: boolean,
  ) => boolean;
  readonly editWeld: (edge: GridEdge, erase: boolean) => boolean;
  readonly editWeldSegment: (
    from: GridPoint,
    to: GridPoint,
    endpointEdge: GridEdge | null,
    erase: boolean,
  ) => boolean;
  readonly commitSelection: () => void;
  readonly syncSelectionOverlay: () => void;
  readonly syncEditableRegionOverlay: () => void;
  readonly refreshHover: () => void;
  readonly pickTile: (cell: GridCell) => void;
  readonly openConfiguration: (cell: GridCell) => void;
  readonly commitEditTransaction: () => void;
}

interface PointerEventData {
  readonly pointerId: number;
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly type: string;
  preventDefault(): void;
}

interface GestureBase {
  readonly pointerId: number;
  readonly session: WorkshopSession;
  readonly buttonMask: number;
}

interface PickOrPanGesture extends GestureBase {
  readonly kind: "pick-or-pan";
  readonly pendingPickCell: GridCell | null;
  readonly originClientX: number;
  readonly originClientY: number;
}

interface PanGesture extends GestureBase {
  readonly kind: "pan";
  readonly lastClientX: number;
  readonly lastClientY: number;
}

interface EditGesture extends GestureBase {
  readonly kind: "edit";
  readonly tool: BuildTool;
  readonly erase: boolean;
  readonly weldPlacedTiles: boolean;
  readonly changed: boolean;
  readonly lastGridPoint: GridPoint;
  readonly lastEditedCell: GridCell | null;
  readonly pendingConfigurationCell: GridCell | null;
}

interface TextBoxPointerGesture extends GestureBase {
  readonly kind: "text-box";
}

type ActiveGesture = PickOrPanGesture | PanGesture | EditGesture | TextBoxPointerGesture;

/** Owns canvas pointer capture and the complete active-gesture state machine. */
export class CanvasInteractionController {
  private active: ActiveGesture | null = null;

  constructor(
    private readonly surface: CanvasInteractionSurface,
    private readonly callbacks: CanvasInteractionCallbacks,
  ) {
    const canvas = surface.canvas;
    canvas.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    canvas.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    canvas.addEventListener("pointerup", (event) => this.handlePointerFinish(event));
    canvas.addEventListener("lostpointercapture", (event) => this.handlePointerFinish(event));
    canvas.addEventListener("pointercancel", (event) => this.handlePointerFinish(event));
    canvas.addEventListener("pointerleave", () => this.handlePointerLeave());
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  private get textBoxTool(): TextBoxTool {
    const tool = this.callbacks.textBoxTool;
    if (tool === undefined) throw new Error("Text box gestures require a text box tool");
    return tool;
  }

  get activePointerId(): number | null {
    return this.active?.pointerId ?? null;
  }

  handlePointerDown(event: PointerEventData): void {
    const point = this.surface.renderer.gridPointFromClientPoint(event.clientX, event.clientY);
    const cell = this.surface.renderer.cellFromGridPoint(point);
    const gesture = pointerGesture(event.button, event.altKey);
    if (gesture === null || (!this.surface.session.editingState.editable && gesture === "edit")) {
      return;
    }
    const buttonMask = pointerButtonMask(event.button);

    this.cancel();
    event.preventDefault();
    this.surface.canvas.setPointerCapture(event.pointerId);
    const session = this.surface.session;
    if (gesture === "pick-or-pan") {
      this.active = {
        kind: "pick-or-pan",
        pointerId: event.pointerId,
        buttonMask,
        session,
        pendingPickCell: cell,
        originClientX: event.clientX,
        originClientY: event.clientY,
      };
      return;
    }
    if (gesture === "pan") {
      this.active = {
        kind: "pan",
        pointerId: event.pointerId,
        buttonMask,
        session,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
      };
      this.beginPanning();
      return;
    }

    const tool = this.callbacks.getSelectedTool();
    const erase = event.button === 2;
    if (tool === "text-box") {
      this.active = { kind: "text-box", pointerId: event.pointerId, buttonMask, session };
      this.textBoxTool.begin(point, event.clientX, event.clientY, erase);
      return;
    }
    const weldPlacedTiles = shouldWeldPlacedTile(event.button, event.shiftKey);
    const selectedKind = this.callbacks.getSelectedKind();
    const shouldConfigurePlacement =
      !erase &&
      cell !== null &&
      this.surface.world.kindAt(cell.x, cell.y) !== selectedKind &&
      componentConfigurationForKind(selectedKind)?.configureOnPlacement === true;
    let changed = false;
    let lastEditedCell: GridCell | null = null;
    let pendingConfigurationCell: GridCell | null = null;

    if (tool === "tile" && cell !== null) {
      changed = this.callbacks.editCellLine(cell, cell, erase, weldPlacedTiles);
      lastEditedCell = cell;
      if (shouldConfigurePlacement && this.surface.world.kindAt(cell.x, cell.y) === selectedKind) {
        pendingConfigurationCell = cell;
      }
    } else if (tool === "weld") {
      const edge = this.surface.renderer.edgeFromGridPoint(point);
      if (edge !== null) {
        changed = this.callbacks.editWeld(edge, erase);
      }
    } else if (tool === "selection" && !erase) {
      this.beginSelectionGesture(cell);
    } else if (tool === "editable-region" && cell !== null) {
      const authoring = this.editableRegionAuthoring(session);
      if (erase) {
        authoring.removeRectanglesAt(cell.x, cell.y);
      } else {
        authoring.beginRectangle(cell.x, cell.y);
      }
      this.callbacks.syncEditableRegionOverlay();
    }

    this.active = {
      kind: "edit",
      pointerId: event.pointerId,
      buttonMask,
      session,
      tool,
      erase,
      weldPlacedTiles,
      changed,
      lastGridPoint: point,
      lastEditedCell,
      pendingConfigurationCell,
    };
  }

  handlePointerMove(event: PointerEventData): void {
    const active = this.active;
    if (active !== null && active.session !== this.surface.session) {
      this.cancel();
      return;
    }

    const point = this.surface.renderer.gridPointFromClientPoint(event.clientX, event.clientY);
    this.surface.hoveredCell = this.surface.renderer.cellFromGridPoint(point);
    this.surface.hoveredEdge = this.surface.renderer.edgeFromGridPoint(point);
    this.callbacks.refreshHover();

    if (
      active !== null &&
      event.pointerId === active.pointerId &&
      (event.buttons & active.buttonMask) === 0
    ) {
      this.cancel();
      return;
    }
    if (active === null || event.pointerId !== active.pointerId) {
      return;
    }
    if (active.kind === "pick-or-pan") {
      const deltaX = event.clientX - active.originClientX;
      const deltaY = event.clientY - active.originClientY;
      if (!exceedsPanDragThreshold(deltaX, deltaY)) {
        return;
      }
      this.active = {
        kind: "pan",
        pointerId: active.pointerId,
        buttonMask: active.buttonMask,
        session: active.session,
        lastClientX: active.originClientX,
        lastClientY: active.originClientY,
      };
      this.beginPanning();
    }

    const current = this.active;
    if (current?.kind === "pan") {
      this.surface.renderer.panByPixels(
        event.clientX - current.lastClientX,
        event.clientY - current.lastClientY,
      );
      this.active = { ...current, lastClientX: event.clientX, lastClientY: event.clientY };
      this.surface.clearPointerHover();
      this.callbacks.refreshHover();
      return;
    }
    if (current?.kind === "text-box") {
      this.textBoxTool.move(point, event.clientX, event.clientY);
      return;
    }
    if (current?.kind !== "edit") {
      throw new Error("Active edit pointer is missing its edit state");
    }

    let changed = current.changed;
    let lastEditedCell = current.lastEditedCell;
    if (current.tool === "tile") {
      const segment = cellsOnGridSegment(
        current.lastGridPoint,
        point,
        this.surface.world.width,
        this.surface.world.height,
      );
      if (segment !== null) {
        changed = this.callbacks.editCellLine(
          lastEditedCell ?? segment.from,
          segment.to,
          current.erase,
          current.weldPlacedTiles,
        ) || changed;
        lastEditedCell = segment.to;
      }
    } else if (current.tool === "weld") {
      changed = this.callbacks.editWeldSegment(
        current.lastGridPoint,
        point,
        this.surface.hoveredEdge,
        current.erase,
      ) || changed;
    } else if (current.tool === "selection" && !current.erase) {
      if (this.surface.selection.drafting) {
        const cell = clampedCellFromGridPoint(
          point,
          this.surface.world.width,
          this.surface.world.height,
        );
        this.surface.selection.updateSelection(cell.x, cell.y);
      } else {
        this.surface.selection.updateMove(Math.floor(point.x), Math.floor(point.y));
      }
      this.callbacks.syncSelectionOverlay();
    } else if (current.tool === "editable-region" && !current.erase) {
      const cell = clampedCellFromGridPoint(
        point,
        this.surface.world.width,
        this.surface.world.height,
      );
      this.editableRegionAuthoring(current.session).updateRectangle(cell.x, cell.y);
      this.callbacks.syncEditableRegionOverlay();
    }
    this.active = {
      ...current,
      changed,
      lastEditedCell,
      lastGridPoint: point,
    };
  }

  handlePointerFinish(event: PointerEventData): void {
    const active = this.active;
    if (active === null || event.pointerId !== active.pointerId) {
      return;
    }
    if (active.session !== this.surface.session) {
      this.cancel();
      return;
    }
    if (active.kind === "text-box") {
      this.resetActiveState();
      if (event.type === "pointerup") {
        const point = this.surface.renderer.gridPointFromClientPoint(event.clientX, event.clientY);
        this.textBoxTool.move(point, event.clientX, event.clientY);
        this.textBoxTool.finish();
      } else {
        this.textBoxTool.cancelGesture();
      }
      return;
    }

    if (event.type === "pointerup" && active.kind === "pick-or-pan" && active.pendingPickCell !== null) {
      this.callbacks.pickTile(active.pendingPickCell);
    }
    if (active.kind === "edit" && active.tool === "editable-region") {
      const authoring = this.editableRegionAuthoring(active.session);
      if (event.type === "pointerup" && !active.erase) {
        authoring.commitRectangle();
      } else {
        authoring.cancelRectangle();
      }
      this.callbacks.syncEditableRegionOverlay();
    }
    if (active.kind === "edit" && active.tool === "selection") {
      if (event.type === "pointerup" && this.surface.selection.drafting) {
        this.surface.selection.finishSelection(
          this.surface.world,
          active.session.editableRegion,
        );
      } else if (event.type !== "pointerup") {
        this.surface.selection.cancelDraft();
      }
      this.surface.selection.finishMove();
      this.callbacks.syncSelectionOverlay();
      this.callbacks.refreshHover();
    }
    const configurationCell =
      event.type === "pointerup" && active.kind === "edit"
        ? active.pendingConfigurationCell
        : null;
    const changed = active.kind === "edit" && active.changed;
    this.resetActiveState();
    if (changed) {
      this.callbacks.commitEditTransaction();
    }
    if (configurationCell !== null) {
      this.callbacks.openConfiguration(configurationCell);
    }
  }

  handlePointerLeave(): void {
    this.surface.clearPointerHover();
    this.callbacks.refreshHover();
  }

  /**
   * Ends a world-editing gesture before a simulation step without interrupting camera navigation.
   * Middle-button and Alt-secondary-button pans remain captured across ticks.
   */
  cancelEditGesture(): void {
    if (this.active?.kind === "edit" || this.active?.kind === "text-box") {
      this.cancel();
    }
  }

  cancel(): boolean {
    const active = this.active;
    if (active === null) {
      return false;
    }
    if (active.kind === "text-box") {
      this.textBoxTool.cancelGesture();
    }
    if (active.kind === "edit" && active.tool === "editable-region") {
      this.editableRegionAuthoring(active.session).cancelRectangle();
      this.callbacks.syncEditableRegionOverlay();
    } else if (active.kind === "edit" && active.tool === "selection") {
      this.surface.selection.cancelDraft();
      this.surface.selection.finishMove();
      this.callbacks.syncSelectionOverlay();
    }
    const changed = active.kind === "edit" && active.changed;
    this.resetActiveState();
    if (changed) {
      this.callbacks.commitEditTransaction();
    }
    return changed;
  }

  private beginSelectionGesture(cell: GridCell | null): void {
    if (cell === null) {
      if (this.surface.selection.active) {
        this.callbacks.commitSelection();
      }
    } else if (this.surface.selection.active) {
      if (!this.surface.selection.beginMove(cell.x, cell.y)) {
        this.callbacks.commitSelection();
      }
    } else {
      this.surface.selection.beginSelection(cell.x, cell.y);
    }
    this.callbacks.syncSelectionOverlay();
    this.callbacks.refreshHover();
  }

  private beginPanning(): void {
    this.surface.canvas.classList.add("panning");
    this.surface.clearPointerHover();
    this.callbacks.refreshHover();
  }

  private resetActiveState(): void {
    const pointerId = this.active?.pointerId ?? null;
    this.active = null;
    this.surface.canvas.classList.remove("panning");
    if (pointerId !== null && this.surface.canvas.hasPointerCapture(pointerId)) {
      this.surface.canvas.releasePointerCapture(pointerId);
    }
  }

  private editableRegionAuthoring(session: WorkshopSession): NonNullable<
    WorkshopSession["editableRegionAuthoring"]
  > {
    const authoring = session.editableRegionAuthoring;
    if (authoring === null) {
      throw new Error("Editable-region authoring is only available in the sandbox");
    }
    return authoring;
  }
}

/** `PointerEvent.buttons` orders secondary and auxiliary differently from `button`. */
function pointerButtonMask(button: number): number {
  switch (button) {
    case 0:
      return 1;
    case 1:
      return 4;
    case 2:
      return 2;
    default:
      throw new Error(`Unsupported active pointer button: ${button}`);
  }
}
