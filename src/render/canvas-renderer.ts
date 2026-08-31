import type { GridRectangle, GridRegion } from "../game/grid-region";
import {
  Direction,
  directionX,
  directionY,
  orientedSides,
  oppositeDirection,
  TILE_DEFINITIONS,
  TileKind,
  WeldSide,
} from "../simulation/tile";
import type { World } from "../simulation/world";
import { expectDefined } from "../util/assert";
import type { GridCell, GridEdge, GridPoint } from "./grid-drag";
import {
  type BodyCell,
  createBodyPath,
  drawBody,
  drawTile,
  setCircuitPortCharge,
} from "./tile-renderer";


const MAX_TILE_SIZE = 64;
const MIN_TILE_SIZE = 2;
const GRID_EDGE_EPSILON = 1e-6;
const EDITABLE_REGION_DASH_PATTERN = [4, 4];

export interface ViewportInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

interface CachedBody {
  readonly cells: readonly BodyCell[];
  readonly path: Path2D;
}

export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly world: World;
  private readonly editableRegion: GridRegion | null;
  private authoredEditableRegion: GridRegion | null = null;
  private authoredEditableRegionDraft: GridRectangle | null = null;

  private cellSize = MAX_TILE_SIZE;
  private originX = 0;
  private originY = 0;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private viewCenterX: number;
  private viewCenterY: number;
  private viewportInsets: ViewportInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private viewInitialized = false;
  private viewModified = false;
  /** Per-cell body stamp: 0 = unvisited, otherwise the body's start index + 1. */
  private bodyStamps = new Int32Array(0);
  private bodyStack = new Int32Array(0);
  private readonly bodyCells: BodyCell[] = [];
  private cachedWorldRevision = -1;
  private cachedCellSize = 0;
  private readonly cachedBodies: CachedBody[] = [];
  private hoverX = -1;
  private hoverY = -1;
  private hoverEdge: GridEdge | null = null;
  private hoverKind = TileKind.Empty;
  private hoverOrientation = Direction.Up;

  constructor(
    canvas: HTMLCanvasElement,
    world: World,
    editableRegion: GridRegion | null = null,
  ) {
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas 2D is not supported by this browser");
    }

    this.canvas = canvas;
    this.context = context;
    this.world = world;
    this.editableRegion = editableRegion;
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

  setViewportInsets(insets: ViewportInsets): void {
    if (
      this.viewportInsets.top === insets.top &&
      this.viewportInsets.right === insets.right &&
      this.viewportInsets.bottom === insets.bottom &&
      this.viewportInsets.left === insets.left
    ) {
      return;
    }
    this.viewportInsets = insets;
    if (this.viewInitialized && !this.viewModified) {
      this.fitView();
    } else {
      this.updateOrigin();
    }
  }

  zoomAtClientPoint(clientX: number, clientY: number, wheelDeltaY: number): void {
    this.resizeBackingStore();
    const bounds = this.canvas.getBoundingClientRect();
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const gridX = (localX - this.originX) / this.cellSize;
    const gridY = (localY - this.originY) / this.cellSize;
    const nextSize = Math.max(
      MIN_TILE_SIZE,
      Math.min(MAX_TILE_SIZE, this.cellSize * Math.exp(-wheelDeltaY * 0.0015)),
    );
    if (nextSize === this.cellSize) {
      return;
    }

    const { centerX, centerY } = this.safeViewport();
    this.cellSize = nextSize;
    this.viewCenterX = gridX - (localX - centerX) / nextSize;
    this.viewCenterY = gridY - (localY - centerY) / nextSize;
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
    context.fillStyle = "#0b0f14";
    context.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    this.drawGrid();
    this.drawTiles(previousWorld, Math.max(0, Math.min(1, progress)), animationTime);
    this.drawEditableRegion();
    this.drawEditableRegionAuthoring();
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
      this.fitView();
      this.viewInitialized = true;
    } else if (sizeChanged) {
      this.updateOrigin();
    }
  }

  private fitView(): void {
    const { width, height } = this.safeViewport();
    this.cellSize = Math.max(
      MIN_TILE_SIZE,
      Math.min(width / this.world.width, height / this.world.height, MAX_TILE_SIZE),
    );
    this.viewCenterX = this.world.width / 2;
    this.viewCenterY = this.world.height / 2;
    this.updateOrigin();
  }

  private safeViewport(): {
    readonly centerX: number;
    readonly centerY: number;
    readonly width: number;
    readonly height: number;
  } {
    const left = Math.max(0, Math.min(this.viewportInsets.left, this.viewportWidth - 1));
    const top = Math.max(0, Math.min(this.viewportInsets.top, this.viewportHeight - 1));
    const width = Math.max(1, this.viewportWidth - left - Math.max(0, this.viewportInsets.right));
    const height = Math.max(1, this.viewportHeight - top - Math.max(0, this.viewportInsets.bottom));
    return {
      centerX: left + width / 2,
      centerY: top + height / 2,
      width,
      height,
    };
  }

  private updateOrigin(): void {
    const { centerX, centerY } = this.safeViewport();
    const screenCenterOffsetX = (this.viewportWidth / 2 - centerX) / this.cellSize;
    const screenCenterOffsetY = (this.viewportHeight / 2 - centerY) / this.cellSize;
    this.viewCenterX = Math.max(
      -screenCenterOffsetX,
      Math.min(this.world.width - GRID_EDGE_EPSILON - screenCenterOffsetX, this.viewCenterX),
    );
    this.viewCenterY = Math.max(
      -screenCenterOffsetY,
      Math.min(this.world.height - GRID_EDGE_EPSILON - screenCenterOffsetY, this.viewCenterY),
    );
    this.originX = centerX - this.viewCenterX * this.cellSize;
    this.originY = centerY - this.viewCenterY * this.cellSize;
  }

  private drawGrid(): void {
    const boardWidth = this.world.width * this.cellSize;
    const boardHeight = this.world.height * this.cellSize;
    const { context } = this;

    context.fillStyle = "#121923";
    context.fillRect(this.originX, this.originY, boardWidth, boardHeight);
    context.strokeStyle = "#202a35";
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

    context.strokeStyle = "#354250";
    context.strokeRect(this.originX + 0.5, this.originY + 0.5, boardWidth, boardHeight);
  }

  private drawEditableRegion(): void {
    if (this.editableRegion !== null) {
      this.strokeGridRegion(this.editableRegion, EDITABLE_REGION_DASH_PATTERN);
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
    this.strokeGridRegion(this.authoredEditableRegion, EDITABLE_REGION_DASH_PATTERN);

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

  private strokeGridRegion(region: GridRegion, dashPattern: readonly number[]): void {
    const { context } = this;
    context.save();
    context.strokeStyle = "#d6ad61";
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

  private drawTiles(previousWorld: World | null, progress: number, animationTime: number): void {
    this.rebuildBodyCache();

    for (const body of this.cachedBodies) {
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

  private rebuildBodyCache(): void {
    if (
      this.cachedWorldRevision === this.world.revision &&
      this.cachedCellSize === this.cellSize
    ) {
      return;
    }

    this.cachedWorldRevision = this.world.revision;
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
      for (let cellIndex = 0; cellIndex < count; cellIndex += 1) {
        const cell = expectDefined(this.bodyCells[cellIndex], "cached body cell");
        cells[cellIndex] = { ...cell };
      }
      this.cachedBodies.push({
        cells,
        path: createBodyPath(0, 0, this.cellSize, cells, count),
      });
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
        cell = {
          x: 0,
          y: 0,
          kind: TileKind.Empty,
          orientation: Direction.Up,
          outputCharge: 0,
          circuitConnections: WeldSide.None,
          circuitPortCharges: 0,
          seamRight: false,
          seamDown: false,
        };
        this.bodyCells.push(cell);
      }
      count += 1;
      const x = index % width;
      cell.x = x;
      cell.y = (index - x) / width;
      cell.kind = world.kindAtIndex(index);
      cell.orientation = world.orientationAtIndex(index);
      const networkCharge = world.chargeAtPortIndex(index, Direction.Up);
      cell.outputCharge = cell.kind === TileKind.Sensor
        ? world.sensorOutputAtIndex(index)
        : networkCharge;
      cell.circuitConnections = WeldSide.None;
      cell.circuitPortCharges = 0;
      const inputPorts = orientedSides(
        TILE_DEFINITIONS[cell.kind].circuitInputPorts,
        cell.orientation,
      );
      for (let value = Direction.Up; value <= Direction.Left; value += 1) {
        const direction = value as Direction;
        if (!world.hasCircuitConnectionAtIndex(index, direction)) {
          continue;
        }
        cell.circuitConnections |= 1 << direction;
        const portCharge = (inputPorts & (1 << direction)) !== 0
          ? world.chargeAtPortIndex(
            index + directionX(direction) + directionY(direction) * width,
            oppositeDirection(direction),
          )
          : world.chargeAtPortIndex(index, direction);
        cell.circuitPortCharges = setCircuitPortCharge(
          cell.circuitPortCharges,
          direction,
          portCharge,
        );
      }

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
