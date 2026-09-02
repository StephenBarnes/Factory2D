import type { GridRectangle, GridRegion } from "../game/grid-region";
import type { TileSelectionOverlay } from "../game/tile-selection";
import type { Charge } from "../simulation/circuit";
import { runeArrayPortCellIndex } from "../simulation/rune-array";
import {
  Direction,
  directionX,
  directionY,
  oppositeDirection,
  TILE_DEFINITIONS,
  TILE_KINDS,
  TileKind,
  WeldSide,
} from "../simulation/tile";
import type { World } from "../simulation/world";
import { expectDefined } from "../util/assert";
import type { GridCell, GridEdge, GridPoint } from "./grid-drag";
import { createBodyCell, populateBodyCell } from "./body-cells";
import {
  type BodyCell,
  createBodyPath,
  drawBody,
  drawTile,
  setCircuitPortCharge,
} from "./tile-renderer";


const MAX_TILE_SIZE = 64;
const MIN_MANUAL_TILE_SIZE = 2;
const GRID_EDGE_EPSILON = 1e-6;
const EDITABLE_REGION_DASH_PATTERN = [4, 4];
const PORT_CELL_DASH_PATTERN = [3, 3];
const NESTED_FRAME_COLOR = "#7a88c4";
const PORT_CELL_COLOR = "rgb(199 211 244 / 55%)";
/** Below this screen-space size, procedural details cost more than they communicate. */
const LOW_DETAIL_CELL_SIZE = 6;
const LOW_DETAIL_MOTION_BUCKETS = 9;

/** Supplies the containing rune array's side charges while its inner board is displayed. */
export interface NestedBoardView {
  portCharge(side: Direction): Charge;
}


interface CachedBodyGeometry {
  readonly cells: readonly BodyCell[];
  readonly path: Path2D;
}

interface CachedBody extends CachedBodyGeometry {
  readonly minX: number;
  readonly minY: number;
  /** Exclusive grid bound. */
  readonly maxX: number;
  /** Exclusive grid bound. */
  readonly maxY: number;
}
export interface GridRegionScreenBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}


export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly world: World;
  private readonly editableRegion: GridRegion | null;
  private readonly nestedView: NestedBoardView | null;
  /** Cells of margin kept around the board when fitting, so nested port conduits stay visible. */
  private readonly fitMargin: number;
  private authoredEditableRegion: GridRegion | null = null;
  private authoredEditableRegionDraft: GridRectangle | null = null;
  private tileSelectionOverlay: TileSelectionOverlay | null = null;
  private tileSelectionDraft: GridRegion | null = null;

  private cellSize = MAX_TILE_SIZE;
  private originX = 0;
  private originY = 0;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private viewCenterX: number;
  private viewCenterY: number;
  private viewInitialized = false;
  private viewModified = false;
  /** Per-cell body stamp: 0 = unvisited, otherwise the body's start index + 1. */
  private bodyStamps = new Int32Array(0);
  private bodyStack = new Int32Array(0);
  private readonly bodyCells: BodyCell[] = [];
  private cachedWorldRevision = -1;
  private cachedWorldGeometryRevision = -1;
  private cachedCellSize = 0;
  private readonly cachedBodies: CachedBody[] = [];
  private readonly cachedSelectionBodies: CachedBodyGeometry[] = [];
  private cachedSelectionOverlay: TileSelectionOverlay | null = null;
  private cachedSelectionCellSize = 0;
  private selectionBodyStamps = new Int32Array(0);
  private selectionBodyStack = new Int32Array(0);
  private selectionCellIndices = new Int32Array(0);
  private readonly selectionBodyCells: BodyCell[] = [];
  /** Paths are grouped by tile kind and one of the nine adjacent-step animation offsets. */
  private readonly lowDetailPaths: Array<Path2D | undefined> = new Array(
    TILE_KINDS.length * LOW_DETAIL_MOTION_BUCKETS,
  );
  private hoverX = -1;
  private hoverY = -1;
  private hoverEdge: GridEdge | null = null;
  private hoverKind = TileKind.Empty;
  private hoverOrientation = Direction.Up;

  constructor(
    canvas: HTMLCanvasElement,
    world: World,
    editableRegion: GridRegion | null = null,
    nestedView: NestedBoardView | null = null,
  ) {
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D is not supported by this browser");
    }

    this.canvas = canvas;
    this.context = context;
    this.world = world;
    this.editableRegion = editableRegion;
    this.nestedView = nestedView;
    this.fitMargin = nestedView === null ? 0 : 1;
    this.viewCenterX = world.width / 2;
    this.viewCenterY = world.height / 2;
  }

  setEditableRegionAuthoring(
    region: GridRegion | null,
    draftRectangle: GridRectangle | null,
  ): void {
    this.authoredEditableRegion = region;
    this.authoredEditableRegionDraft = draftRectangle;
  }
  setTileSelection(
    overlay: TileSelectionOverlay | null,
    draft: GridRegion | null,
  ): void {
    this.tileSelectionOverlay = overlay;
    this.tileSelectionDraft = draft;
  }

  screenBoundsForGridRegion(region: GridRegion): GridRegionScreenBounds | null {
    if (region.rectangles.length === 0) {
      return null;
    }
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const rectangle of region.rectangles) {
      left = Math.min(left, this.originX + rectangle.x * this.cellSize);
      top = Math.min(top, this.originY + rectangle.y * this.cellSize);
      right = Math.max(right, this.originX + (rectangle.x + rectangle.width) * this.cellSize);
      bottom = Math.max(bottom, this.originY + (rectangle.y + rectangle.height) * this.cellSize);
    }
    return { left, top, right, bottom };
  }



  fitBoardToViewport(): void {
    this.resizeBackingStore();
    this.fitViewToViewport();
    this.viewInitialized = true;
    this.viewModified = false;
  }

  zoomAtClientPoint(clientX: number, clientY: number, wheelDeltaY: number): void {
    this.resizeBackingStore();
    const bounds = this.canvas.getBoundingClientRect();
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const gridX = (localX - this.originX) / this.cellSize;
    const gridY = (localY - this.originY) / this.cellSize;
    const minimumSize = Math.min(MIN_MANUAL_TILE_SIZE, this.cellSize);
    const nextSize = Math.max(
      minimumSize,
      Math.min(MAX_TILE_SIZE, this.cellSize * Math.exp(-wheelDeltaY * 0.0015)),
    );
    if (nextSize === this.cellSize) {
      return;
    }

    this.cellSize = nextSize;
    this.viewCenterX = gridX - (localX - this.viewportWidth / 2) / nextSize;
    this.viewCenterY = gridY - (localY - this.viewportHeight / 2) / nextSize;
    this.viewModified = true;
    this.updateOrigin();
  }

  /** Moves the rendered board by the supplied screen-space delta. */
  panByPixels(deltaX: number, deltaY: number): void {
    this.viewCenterX -= deltaX / this.cellSize;
    this.viewCenterY -= deltaY / this.cellSize;
    this.viewModified = true;
    this.updateOrigin();
  }

  render(previousWorld: World | null = null, progress = 1, animationTime = 0): void {
    this.resizeBackingStore();

    const { context } = this;
    context.clearRect(0, 0, this.viewportWidth, this.viewportHeight);
    context.fillStyle = "#0d0a07";
    context.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    this.drawGrid();
    this.drawNestedPorts(animationTime);
    this.drawTiles(previousWorld, Math.max(0, Math.min(1, progress)), animationTime);
    this.drawEditableRegion();
    this.drawEditableRegionAuthoring();
    this.drawTileSelection(animationTime);
    this.drawHover(animationTime);
  }

  gridPointFromClientPoint(clientX: number, clientY: number): GridPoint {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - bounds.left - this.originX) / this.cellSize,
      y: (clientY - bounds.top - this.originY) / this.cellSize,
    };
  }

  cellFromGridPoint(point: GridPoint): GridCell | null {
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);

    if (x < 0 || x >= this.world.width || y < 0 || y >= this.world.height) {
      return null;
    }
    return { x, y };
  }

  edgeFromGridPoint(point: GridPoint): GridEdge | null {
    const localX = point.x * this.cellSize;
    const localY = point.y * this.cellSize;
    const boardWidth = this.world.width * this.cellSize;
    const boardHeight = this.world.height * this.cellSize;
    if (localX < 0 || localX > boardWidth || localY < 0 || localY > boardHeight) {
      return null;
    }

    const verticalLine = Math.round(point.x);
    const horizontalLine = Math.round(point.y);
    const verticalDistance = Math.abs(localX - verticalLine * this.cellSize);
    const horizontalDistance = Math.abs(localY - horizontalLine * this.cellSize);
    const selectionRadius = this.cellSize / 4;

    if (
      verticalLine > 0 &&
      verticalLine < this.world.width &&
      verticalDistance <= selectionRadius &&
      verticalDistance <= horizontalDistance
    ) {
      const y = Math.min(Math.floor(point.y), this.world.height - 1);
      return { x1: verticalLine - 1, y1: y, x2: verticalLine, y2: y };
    }
    if (
      horizontalLine > 0 &&
      horizontalLine < this.world.height &&
      horizontalDistance <= selectionRadius
    ) {
      const x = Math.min(Math.floor(point.x), this.world.width - 1);
      return { x1: x, y1: horizontalLine - 1, x2: x, y2: horizontalLine };
    }
    return null;
  }

  setHover(
    cell: GridCell | null,
    kind: TileKind = TileKind.Empty,
    orientation: Direction = Direction.Up,
  ): void {
    this.hoverX = cell?.x ?? -1;
    this.hoverY = cell?.y ?? -1;
    this.hoverKind = kind;
    this.hoverOrientation = orientation;
    this.hoverEdge = null;
  }

  setHoverEdge(edge: GridEdge | null): void {
    this.hoverEdge = edge;
    this.hoverX = -1;
    this.hoverY = -1;
  }

  private resizeBackingStore(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const sizeChanged = width !== this.viewportWidth || height !== this.viewportHeight;
    const devicePixelRatio = window.devicePixelRatio || 1;
    const backingWidth = Math.round(width * devicePixelRatio);
    const backingHeight = Math.round(height * devicePixelRatio);

    if (this.canvas.width !== backingWidth || this.canvas.height !== backingHeight) {
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
    }

    this.context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.context.imageSmoothingEnabled = false;
    this.viewportWidth = width;
    this.viewportHeight = height;

    if (!this.viewInitialized || (sizeChanged && !this.viewModified)) {
      this.fitViewToViewport();
      this.viewInitialized = true;
    } else if (sizeChanged) {
      this.updateOrigin();
    }
  }

  private fitViewToViewport(): void {
    this.cellSize = Math.min(
      this.viewportWidth / (this.world.width + this.fitMargin * 2),
      this.viewportHeight / (this.world.height + this.fitMargin * 2),
      MAX_TILE_SIZE,
    );
    this.viewCenterX = this.world.width / 2;
    this.viewCenterY = this.world.height / 2;
    this.updateOrigin();
  }

  private updateOrigin(): void {
    this.viewCenterX = Math.max(
      0,
      Math.min(this.world.width - GRID_EDGE_EPSILON, this.viewCenterX),
    );
    this.viewCenterY = Math.max(
      0,
      Math.min(this.world.height - GRID_EDGE_EPSILON, this.viewCenterY),
    );
    this.originX = this.viewportWidth / 2 - this.viewCenterX * this.cellSize;
    this.originY = this.viewportHeight / 2 - this.viewCenterY * this.cellSize;
  }

  private drawGrid(): void {
    const boardWidth = this.world.width * this.cellSize;
    const boardHeight = this.world.height * this.cellSize;
    const { context } = this;

    context.fillStyle = "#191309";
    context.fillRect(this.originX, this.originY, boardWidth, boardHeight);
    context.strokeStyle = "#2b2213";
    context.lineWidth = 1;
    context.beginPath();

    for (let x = 0; x <= this.world.width; x += 1) {
      const lineX = this.originX + x * this.cellSize + 0.5;
      context.moveTo(lineX, this.originY);
      context.lineTo(lineX, this.originY + boardHeight);
    }
    for (let y = 0; y <= this.world.height; y += 1) {
      const lineY = this.originY + y * this.cellSize + 0.5;
      context.moveTo(this.originX, lineY);
      context.lineTo(this.originX + boardWidth, lineY);
    }
    context.stroke();

    context.strokeStyle = this.nestedView === null ? "#4c3d24" : NESTED_FRAME_COLOR;
    context.strokeRect(this.originX + 0.5, this.originY + 0.5, boardWidth, boardHeight);
  }

  /**
   * Draws the four virtual conduits just outside a nested board's edge centers, colored by
   * the containing array's side charges, and marks the inner port cells they connect to.
   */
  private drawNestedPorts(animationTime: number): void {
    const view = this.nestedView;
    if (view === null) {
      return;
    }
    const { context, cellSize, world } = this;
    context.save();
    context.strokeStyle = PORT_CELL_COLOR;
    context.lineWidth = Math.max(1, Math.min(2, cellSize * 0.05));
    context.setLineDash(PORT_CELL_DASH_PATTERN);
    for (let value = Direction.Up; value <= Direction.Left; value += 1) {
      const side = value as Direction;
      const charge = view.portCharge(side);
      const portIndex = runeArrayPortCellIndex(world.width, world.height, side);
      const portX = portIndex % world.width;
      const portY = (portIndex - portX) / world.width;
      const conduitX = portX + directionX(side);
      const conduitY = portY + directionY(side);
      const inward = oppositeDirection(side);
      drawTile(
        context,
        this.originX + conduitX * cellSize,
        this.originY + conduitY * cellSize,
        cellSize,
        TileKind.Conduit,
        Direction.Up,
        animationTime,
        charge,
        (1 << inward) as WeldSide,
        setCircuitPortCharge(0, inward, charge),
      );
      context.strokeRect(
        this.originX + portX * cellSize + 2.5,
        this.originY + portY * cellSize + 2.5,
        cellSize - 5,
        cellSize - 5,
      );
    }
    context.restore();
  }

  private drawEditableRegion(): void {
    if (this.editableRegion !== null) {
      this.strokeGridRegion(this.editableRegion, EDITABLE_REGION_DASH_PATTERN, "#d6ad61");
    }
  }

  private drawEditableRegionAuthoring(): void {
    if (this.authoredEditableRegion === null) {
      return;
    }

    const { context } = this;
    context.save();
    context.fillStyle = "rgb(214 173 97 / 10%)";
    for (const rectangle of this.authoredEditableRegion.rectangles) {
      context.fillRect(
        this.originX + rectangle.x * this.cellSize,
        this.originY + rectangle.y * this.cellSize,
        rectangle.width * this.cellSize,
        rectangle.height * this.cellSize,
      );
    }
    context.restore();
    this.strokeGridRegion(
      this.authoredEditableRegion,
      EDITABLE_REGION_DASH_PATTERN,
      "#d6ad61",
    );

    const draft = this.authoredEditableRegionDraft;
    if (draft === null) {
      return;
    }
    context.save();
    context.fillStyle = "rgb(120 220 202 / 16%)";
    context.strokeStyle = "#78dcca";
    context.lineWidth = Math.max(1.5, Math.min(3, this.cellSize * 0.08));
    context.fillRect(
      this.originX + draft.x * this.cellSize,
      this.originY + draft.y * this.cellSize,
      draft.width * this.cellSize,
      draft.height * this.cellSize,
    );
    context.strokeRect(
      this.originX + draft.x * this.cellSize + 0.5,
      this.originY + draft.y * this.cellSize + 0.5,
      draft.width * this.cellSize,
      draft.height * this.cellSize,
    );
    context.restore();
  }

  private strokeGridRegion(
    region: GridRegion,
    dashPattern: readonly number[],
    color: string,
  ): void {
    const { context } = this;
    context.save();
    context.strokeStyle = color;
    context.lineWidth = Math.max(1.5, Math.min(3, this.cellSize * 0.08));
    context.lineCap = "round";
    context.setLineDash(dashPattern);
    context.beginPath();
    for (const edge of region.boundaryEdges) {
      context.moveTo(
        this.originX + edge.x1 * this.cellSize + 0.5,
        this.originY + edge.y1 * this.cellSize + 0.5,
      );
      context.lineTo(
        this.originX + edge.x2 * this.cellSize + 0.5,
        this.originY + edge.y2 * this.cellSize + 0.5,
      );
    }
    context.stroke();
    context.restore();
  }
  private drawTileSelection(animationTime: number): void {
    const draft = this.tileSelectionDraft;
    const overlay = this.tileSelectionOverlay;
    if (draft === null && overlay === null) {
      return;
    }

    const { context } = this;
    if (overlay?.sourceRegion !== null && overlay?.sourceRegion !== undefined) {
      context.save();
      context.fillStyle = "rgb(7 5 3 / 68%)";
      for (const rectangle of overlay.sourceRegion.rectangles) {
        context.fillRect(
          this.originX + rectangle.x * this.cellSize,
          this.originY + rectangle.y * this.cellSize,
          rectangle.width * this.cellSize,
          rectangle.height * this.cellSize,
        );
      }
      context.restore();
    }

    if (overlay !== null) {
      context.save();
      context.globalAlpha = 0.88;
      this.rebuildSelectionBodyCache();
      context.translate(this.originX, this.originY);
      for (const body of this.cachedSelectionBodies) {
        drawBody(
          context,
          0,
          0,
          this.cellSize,
          body.cells,
          body.cells.length,
          body.path,
          animationTime,
        );
      }
      context.restore();
      context.save();
      context.globalAlpha = 0.88;
      context.fillStyle = overlay.valid ? "rgb(120 220 202 / 10%)" : "rgb(225 90 79 / 16%)";
      for (const rectangle of overlay.region.rectangles) {
        context.fillRect(
          this.originX + rectangle.x * this.cellSize,
          this.originY + rectangle.y * this.cellSize,
          rectangle.width * this.cellSize,
          rectangle.height * this.cellSize,
        );
      }
      context.restore();
      this.strokeGridRegion(
        overlay.region,
        [],
        overlay.valid ? "#78dcca" : "#e15a4f",
      );
    }

    if (draft !== null) {
      context.save();
      context.fillStyle = "rgb(120 220 202 / 16%)";
      for (const rectangle of draft.rectangles) {
        context.fillRect(
          this.originX + rectangle.x * this.cellSize,
          this.originY + rectangle.y * this.cellSize,
          rectangle.width * this.cellSize,
          rectangle.height * this.cellSize,
        );
      }
      context.restore();
      this.strokeGridRegion(draft, [], "#78dcca");
    }
  }

  private rebuildSelectionBodyCache(): void {
    const overlay = this.tileSelectionOverlay;
    if (
      this.cachedSelectionOverlay === overlay &&
      this.cachedSelectionCellSize === this.cellSize
    ) {
      return;
    }
    this.cachedSelectionOverlay = overlay;
    this.cachedSelectionCellSize = this.cellSize;
    this.cachedSelectionBodies.length = 0;
    if (overlay === null) {
      return;
    }

    const cellCount = this.world.cellCount;
    if (this.selectionBodyStamps.length !== cellCount) {
      this.selectionBodyStamps = new Int32Array(cellCount);
      this.selectionBodyStack = new Int32Array(cellCount);
      this.selectionCellIndices = new Int32Array(cellCount);
    } else {
      this.selectionBodyStamps.fill(0);
      this.selectionCellIndices.fill(0);
    }
    for (let previewIndex = 0; previewIndex < overlay.previewCells.length; previewIndex += 1) {
      const cell = expectDefined(overlay.previewCells[previewIndex], "selection preview cell");
      this.selectionCellIndices[cell.y * this.world.width + cell.x] = previewIndex + 1;
    }
    for (const cell of overlay.previewCells) {
      const index = cell.y * this.world.width + cell.x;
      if (this.selectionBodyStamps[index] !== 0) {
        continue;
      }
      const count = this.collectSelectionBody(index, overlay);
      const cells = new Array<BodyCell>(count);
      for (let cellIndex = 0; cellIndex < count; cellIndex += 1) {
        const bodyCell = expectDefined(
          this.selectionBodyCells[cellIndex],
          "cached selection body cell",
        );
        cells[cellIndex] = { ...bodyCell };
      }
      this.cachedSelectionBodies.push({
        cells,
        path: createBodyPath(0, 0, this.cellSize, cells, count),
      });
    }
  }

  private collectSelectionBody(startIndex: number, overlay: TileSelectionOverlay): number {
    const width = this.world.width;
    const stamp = startIndex + 1;
    let stackSize = 0;
    let count = 0;
    this.selectionBodyStamps[startIndex] = stamp;
    this.selectionBodyStack[stackSize] = startIndex;
    stackSize += 1;

    while (stackSize > 0) {
      stackSize -= 1;
      const index = expectDefined(
        this.selectionBodyStack[stackSize],
        "selection body stack entry",
      );
      const preview = this.selectionPreviewCellAtIndex(
        index,
        overlay,
        "indexed selection preview cell",
      );
      if (preview === null) {
        throw new Error("Selection body contains an empty preview position");
      }
      let cell = this.selectionBodyCells[count];
      if (cell === undefined) {
        cell = {
          x: 0,
          y: 0,
          kind: TileKind.Empty,
          orientation: Direction.Up,
          outputCharge: 0,
          circuitConnections: WeldSide.None,
          circuitPortCharges: 0,
          componentState: null,
          nestedWorld: null,
          seamRight: false,
          seamDown: false,
        };
        this.selectionBodyCells.push(cell);
      }
      count += 1;
      cell.x = preview.x;
      cell.y = preview.y;
      cell.kind = preview.kind;
      cell.orientation = preview.orientation;
      cell.outputCharge = 0;
      cell.circuitConnections = WeldSide.None;
      cell.circuitPortCharges = 0;
      cell.componentState = null;
      cell.nestedWorld = null;
      cell.seamRight = false;
      cell.seamDown = false;

      const x = preview.x;
      if (preview.weldRight) {
        stackSize = this.pushSelectionBodyCell(index + 1, stamp, stackSize);
      }
      const leftPreview = x > 0
        ? this.selectionPreviewCellAtIndex(
          index - 1,
          overlay,
          "left selection preview cell",
        )
        : null;
      if (leftPreview?.weldRight === true) {
        stackSize = this.pushSelectionBodyCell(index - 1, stamp, stackSize);
      }
      if (preview.weldDown) {
        stackSize = this.pushSelectionBodyCell(index + width, stamp, stackSize);
      }
      const upperPreview = index >= width
        ? this.selectionPreviewCellAtIndex(
          index - width,
          overlay,
          "upper selection preview cell",
        )
        : null;
      if (upperPreview?.weldDown === true) {
        stackSize = this.pushSelectionBodyCell(index - width, stamp, stackSize);
      }
    }

    for (let i = 0; i < count; i += 1) {
      const cell = expectDefined(this.selectionBodyCells[i], "collected selection body cell");
      const index = cell.y * width + cell.x;
      const preview = this.selectionPreviewCellAtIndex(
        index,
        overlay,
        "collected selection preview cell",
      );
      if (preview === null) {
        throw new Error("Collected selection body cell has no preview");
      }
      cell.seamRight = cell.x < this.world.width - 1 &&
        this.selectionBodyStamps[index + 1] === stamp &&
        !preview.weldRight;
      cell.seamDown = cell.y < this.world.height - 1 &&
        this.selectionBodyStamps[index + width] === stamp &&
        !preview.weldDown;
    }
    return count;
  }

  private selectionPreviewCellAtIndex(
    index: number,
    overlay: TileSelectionOverlay,
    description: string,
  ): TileSelectionOverlay["previewCells"][number] | null {
    if (index < 0 || index >= this.selectionCellIndices.length) {
      throw new RangeError(`Selection preview index ${index} is outside the board`);
    }
    const storedIndex = expectDefined(this.selectionCellIndices[index], description);
    return storedIndex === 0
      ? null
      : expectDefined(overlay.previewCells[storedIndex - 1], description);
  }

  private pushSelectionBodyCell(index: number, stamp: number, stackSize: number): number {
    if (index < 0 || index >= this.selectionCellIndices.length) {
      throw new RangeError(`Selection weld index ${index} is outside the board`);
    }
    if (expectDefined(this.selectionCellIndices[index], "selection weld cell index") === 0) {
      throw new Error("Selection weld is missing its neighboring preview cell");
    }
    if (this.selectionBodyStamps[index] !== stamp) {
      this.selectionBodyStamps[index] = stamp;
      this.selectionBodyStack[stackSize] = index;
      return stackSize + 1;
    }
    return stackSize;
  }


  private drawTiles(previousWorld: World | null, progress: number, animationTime: number): void {
    if (this.cellSize < LOW_DETAIL_CELL_SIZE) {
      this.drawLowDetailTiles(previousWorld, progress);
      return;
    }

    this.rebuildBodyCache();

    const visibleLeft = -this.originX / this.cellSize - 1;
    const visibleTop = -this.originY / this.cellSize - 1;
    const visibleRight = (this.viewportWidth - this.originX) / this.cellSize + 1;
    const visibleBottom = (this.viewportHeight - this.originY) / this.cellSize + 1;
    for (const body of this.cachedBodies) {
      if (
        body.maxX <= visibleLeft ||
        body.minX >= visibleRight ||
        body.maxY <= visibleTop ||
        body.minY >= visibleBottom
      ) {
        continue;
      }
      let offsetX = 0;
      let offsetY = 0;
      const remainingProgress = 1 - progress;
      let hasPistonTransition = false;
      for (const cell of body.cells) {
        cell.pistonTransition = 0;
        cell.pistonTransitionProgress = 1;
        if (previousWorld === null || remainingProgress <= 0) {
          continue;
        }
        const stepX = directionX(cell.orientation);
        const stepY = directionY(cell.orientation);
        const rearX = cell.x - stepX;
        const rearY = cell.y - stepY;
        const frontX = cell.x + stepX;
        const frontY = cell.y + stepY;
        const rearIsInside = rearX >= 0 && rearX < this.world.width &&
          rearY >= 0 && rearY < this.world.height;
        const frontIsInside = frontX >= 0 && frontX < this.world.width &&
          frontY >= 0 && frontY < this.world.height;
        if (
          cell.kind === TileKind.PistonArm &&
          rearIsInside &&
          previousWorld.kindAt(rearX, rearY) === TileKind.Piston &&
          previousWorld.idAt(rearX, rearY) === this.world.idAt(cell.x, cell.y)
        ) {
          cell.pistonTransition = 1;
          cell.pistonTransitionProgress = progress;
        } else if (
          cell.kind === TileKind.PistonBase &&
          previousWorld.kindAt(cell.x, cell.y) === TileKind.Piston
        ) {
          cell.pistonTransition = 1;
          cell.pistonTransitionProgress = progress;
        } else if (
          cell.kind === TileKind.Piston &&
          frontIsInside &&
          previousWorld.kindAt(frontX, frontY) === TileKind.PistonArm &&
          previousWorld.idAt(frontX, frontY) === this.world.idAt(cell.x, cell.y)
        ) {
          cell.pistonTransition = -1;
          cell.pistonTransitionProgress = progress;
        }
        hasPistonTransition ||= cell.pistonTransition !== 0;
      }
      if (previousWorld !== null && remainingProgress > 0 && !hasPistonTransition) {
        const firstCell = expectDefined(body.cells[0], "first animated body cell");
        const tileId = this.world.idAt(firstCell.x, firstCell.y);
        if (previousWorld.idAt(firstCell.x, firstCell.y) !== tileId) {
          searchPreviousPosition:
          for (let verticalMove = -1; verticalMove <= 1; verticalMove += 1) {
            for (let horizontalMove = -1; horizontalMove <= 1; horizontalMove += 1) {
              if (horizontalMove === 0 && verticalMove === 0) {
                continue;
              }
              const previousX = firstCell.x - horizontalMove;
              const previousY = firstCell.y - verticalMove;
              if (
                previousX >= 0 &&
                previousX < this.world.width &&
                previousY >= 0 &&
                previousY < this.world.height &&
                previousWorld.idAt(previousX, previousY) === tileId
              ) {
                offsetX = -horizontalMove * this.cellSize * remainingProgress;
                offsetY = -verticalMove * this.cellSize * remainingProgress;
                break searchPreviousPosition;
              }
            }
          }
        }
      }

      this.context.save();
      this.context.translate(this.originX + offsetX, this.originY + offsetY);
      drawBody(
        this.context,
        0,
        0,
        this.cellSize,
        body.cells,
        body.cells.length,
        body.path,
        animationTime,
      );
      this.context.restore();
    }
  }

  private drawLowDetailTiles(previousWorld: World | null, progress: number): void {
    const { cellSize, originX, originY, world } = this;
    const remainingProgress = 1 - progress;
    const startX = Math.max(0, Math.floor(-originX / cellSize) - 1);
    const startY = Math.max(0, Math.floor(-originY / cellSize) - 1);
    const endX = Math.min(
      world.width,
      Math.ceil((this.viewportWidth - originX) / cellSize) + 1,
    );
    const endY = Math.min(
      world.height,
      Math.ceil((this.viewportHeight - originY) / cellSize) + 1,
    );
    this.lowDetailPaths.fill(undefined);

    for (let y = startY; y < endY; y += 1) {
      let index = y * world.width + startX;
      for (let x = startX; x < endX; x += 1, index += 1) {
        const kind = world.kindAtIndex(index);
        if (kind === TileKind.Empty) {
          continue;
        }

        let motionBucket = 4;
        if (previousWorld !== null && remainingProgress > 0) {
          const tileId = world.idAt(x, y);
          if (previousWorld.idAt(x, y) !== tileId) {
            searchPreviousPosition:
            for (let verticalMove = -1; verticalMove <= 1; verticalMove += 1) {
              for (let horizontalMove = -1; horizontalMove <= 1; horizontalMove += 1) {
                if (horizontalMove === 0 && verticalMove === 0) {
                  continue;
                }
                const previousX = x - horizontalMove;
                const previousY = y - verticalMove;
                if (
                  previousX >= 0 &&
                  previousX < world.width &&
                  previousY >= 0 &&
                  previousY < world.height &&
                  previousWorld.idAt(previousX, previousY) === tileId
                ) {
                  motionBucket = (verticalMove + 1) * 3 + horizontalMove + 1;
                  break searchPreviousPosition;
                }
              }
            }
          }
        }

        const pathIndex = kind * LOW_DETAIL_MOTION_BUCKETS + motionBucket;
        let path = this.lowDetailPaths[pathIndex];
        if (path === undefined) {
          path = new Path2D();
          this.lowDetailPaths[pathIndex] = path;
        }
        const horizontalMove = motionBucket % 3 - 1;
        const verticalMove = Math.floor(motionBucket / 3) - 1;
        path.rect(
          originX + (x - horizontalMove * remainingProgress) * cellSize,
          originY + (y - verticalMove * remainingProgress) * cellSize,
          cellSize,
          cellSize,
        );
      }
    }

    for (let index = 0; index < this.lowDetailPaths.length; index += 1) {
      const path = this.lowDetailPaths[index];
      if (path === undefined) {
        continue;
      }
      const kind = Math.floor(index / LOW_DETAIL_MOTION_BUCKETS) as TileKind;
      this.context.fillStyle = TILE_DEFINITIONS[kind].fill;
      this.context.fill(path);
    }
  }

  private rebuildBodyCache(): void {
    if (
      this.cachedWorldGeometryRevision === this.world.geometryRevision &&
      this.cachedCellSize === this.cellSize
    ) {
      if (this.cachedWorldRevision !== this.world.revision) {
        this.refreshCachedBodyState();
        this.cachedWorldRevision = this.world.revision;
      }
      return;
    }

    this.cachedWorldRevision = this.world.revision;
    this.cachedWorldGeometryRevision = this.world.geometryRevision;
    this.cachedCellSize = this.cellSize;
    this.cachedBodies.length = 0;

    const cellCount = this.world.cellCount;
    if (this.bodyStamps.length !== cellCount) {
      this.bodyStamps = new Int32Array(cellCount);
      this.bodyStack = new Int32Array(cellCount);
    } else {
      this.bodyStamps.fill(0);
    }

    for (let index = 0; index < cellCount; index += 1) {
      if (this.bodyStamps[index] !== 0 || this.world.kindAtIndex(index) === TileKind.Empty) {
        continue;
      }

      const count = this.collectBody(index);
      const cells = new Array<BodyCell>(count);
      let minX = this.world.width;
      let minY = this.world.height;
      let maxX = 0;
      let maxY = 0;
      for (let cellIndex = 0; cellIndex < count; cellIndex += 1) {
        const cell = expectDefined(this.bodyCells[cellIndex], "cached body cell");
        cells[cellIndex] = { ...cell };
        minX = Math.min(minX, cell.x);
        minY = Math.min(minY, cell.y);
        maxX = Math.max(maxX, cell.x + 1);
        maxY = Math.max(maxY, cell.y + 1);
      }
      this.cachedBodies.push({
        cells,
        path: createBodyPath(0, 0, this.cellSize, cells, count),
        minX,
        minY,
        maxX,
        maxY,
      });
    }
  }

  private refreshCachedBodyState(): void {
    for (const body of this.cachedBodies) {
      for (const cell of body.cells) {
        const index = cell.y * this.world.width + cell.x;
        if (this.world.kindAtIndex(index) === TileKind.Empty) {
          throw new Error("World body geometry changed without incrementing its geometry revision");
        }
        populateBodyCell(this.world, index, cell);
      }
    }
  }

  /** Flood-fills the welded body containing `startIndex` into `bodyCells`; returns its size. */
  private collectBody(startIndex: number): number {
    const { world, bodyStamps, bodyStack } = this;
    const width = world.width;
    const stamp = startIndex + 1;
    let stackSize = 0;
    let count = 0;
    bodyStamps[startIndex] = stamp;
    bodyStack[stackSize] = startIndex;
    stackSize += 1;

    while (stackSize > 0) {
      stackSize -= 1;
      const index = expectDefined(bodyStack[stackSize], "welded body stack entry");
      let cell = this.bodyCells[count];
      if (cell === undefined) {
        cell = createBodyCell();
        this.bodyCells.push(cell);
      }
      count += 1;
      populateBodyCell(world, index, cell);
      const x = cell.x;

      if (world.hasRightWeldAtIndex(index) && bodyStamps[index + 1] !== stamp) {
        bodyStamps[index + 1] = stamp;
        bodyStack[stackSize] = index + 1;
        stackSize += 1;
      }
      if (x > 0 && world.hasRightWeldAtIndex(index - 1) && bodyStamps[index - 1] !== stamp) {
        bodyStamps[index - 1] = stamp;
        bodyStack[stackSize] = index - 1;
        stackSize += 1;
      }
      if (world.hasDownWeldAtIndex(index) && bodyStamps[index + width] !== stamp) {
        bodyStamps[index + width] = stamp;
        bodyStack[stackSize] = index + width;
        stackSize += 1;
      }
      if (index >= width && world.hasDownWeldAtIndex(index - width) && bodyStamps[index - width] !== stamp) {
        bodyStamps[index - width] = stamp;
        bodyStack[stackSize] = index - width;
        stackSize += 1;
      }
    }

    for (let i = 0; i < count; i += 1) {
      const cell = expectDefined(this.bodyCells[i], "collected body cell");
      const index = cell.y * width + cell.x;
      cell.seamRight = cell.x < width - 1 &&
        bodyStamps[index + 1] === stamp &&
        !world.hasRightWeldAtIndex(index);
      cell.seamDown = cell.y < world.height - 1 &&
        bodyStamps[index + width] === stamp &&
        !world.hasDownWeldAtIndex(index);
    }

    return count;
  }


  private drawHover(animationTime: number): void {
    if (this.hoverEdge !== null) {
      const { x1, y1, x2, y2 } = this.hoverEdge;
      const editable = this.editableRegion === null ||
        this.editableRegion.containsEdge(x1, y1, x2, y2);
      this.context.strokeStyle = editable && this.world.canWeld(x1, y1, x2, y2)
        ? "#78dcca"
        : "#e15a4f";
      this.context.lineWidth = 3;
      this.context.beginPath();
      if (y1 === y2) {
        const lineX = this.originX + Math.max(x1, x2) * this.cellSize;
        this.context.moveTo(lineX, this.originY + y1 * this.cellSize + 2);
        this.context.lineTo(lineX, this.originY + (y1 + 1) * this.cellSize - 2);
      } else {
        const lineY = this.originY + Math.max(y1, y2) * this.cellSize;
        this.context.moveTo(this.originX + x1 * this.cellSize + 2, lineY);
        this.context.lineTo(this.originX + (x1 + 1) * this.cellSize - 2, lineY);
      }
      this.context.stroke();
      return;
    }

    if (this.hoverX < 0 || this.hoverY < 0) {
      return;
    }
    const editable = this.editableRegion === null ||
      this.editableRegion.contains(this.hoverX, this.hoverY);

    if (
      editable &&
      this.hoverKind !== TileKind.Empty &&
      this.world.kindAt(this.hoverX, this.hoverY) === TileKind.Empty
    ) {
      this.context.save();
      this.context.globalAlpha = 0.55;
      drawTile(
        this.context,
        this.originX + this.hoverX * this.cellSize,
        this.originY + this.hoverY * this.cellSize,
        this.cellSize,
        this.hoverKind,
        this.hoverOrientation,
        animationTime,
      );
      this.context.restore();
    }

    this.context.strokeStyle = editable ? "#78dcca" : "#e15a4f";
    this.context.lineWidth = 2;
    this.context.strokeRect(
      this.originX + this.hoverX * this.cellSize + 1,
      this.originY + this.hoverY * this.cellSize + 1,
      this.cellSize - 2,
      this.cellSize - 2,
    );
  }
}
