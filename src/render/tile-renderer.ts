import {
  DEFAULT_DISCARD_LENGTH,
  type ConfigurableComponentSnapshot,
} from "../simulation/configurable-components";
import { CIRCUIT_CHARGE_COLORS, type Charge } from "../simulation/circuit";
import { runeArrayPortCellIndex } from "../simulation/rune-array";
import type { World } from "../simulation/world";
import {
  Direction,
  directionX,
  directionY,
  orientedSides,
  TILE_DEFINITIONS,
  TileDecorationStyle,
  type TileDefinition,
  WeldSide,
  TileKind,
} from "../simulation/tile";
import { expectDefined } from "../util/assert";
import { tileAppearance } from "./appearance";

/** One cell of a rendered body, in grid coordinates. */
export interface BodyCell {
  x: number;
  y: number;
  kind: TileKind;
  orientation: Direction;
  /** Charge emitted by this tile, independent of its connected network's resolved charge. */
  outputCharge: Charge;
  /** Two signed bits per direction, used to color each connected circuit port. */
  circuitPortCharges: number;
  circuitConnections: WeldSide;
  componentState?: ConfigurableComponentSnapshot | null;
  /** Live inner board of a rune array, read only while drawing; never a snapshot. */
  nestedWorld?: World | null;
  /** Committed processing fraction; zero hides the overlay, one marks completion. */
  processingProgress?: number;
  /** The right neighbor belongs to the same body but this edge is not welded. */
  seamRight: boolean;
  /** The down neighbor belongs to the same body but this edge is not welded. */
  seamDown: boolean;
  /** Active piston transition: +1 extension, -1 retraction. */
  pistonTransition?: -1 | 0 | 1;
  pistonTransitionProgress?: number;
  /** Render-only offset from the committed rotator grip, in quarter-turns. */
  rotatorTurnOffset?: number;
}

export function setCircuitPortCharge(
  charges: number,
  direction: Direction,
  charge: Charge,
): number {
  const shift = direction * 2;
  const mask = 3 << shift;
  const encodedCharge = charge < 0 ? 3 : charge;
  return (charges & ~mask) | (encodedCharge << shift);
}

function circuitPortCharge(charges: number, direction: Direction): Charge {
  const encodedCharge = (charges >>> (direction * 2)) & 3;
  if (encodedCharge === 0 || encodedCharge === 1) {
    return encodedCharge;
  }
  if (encodedCharge === 3) {
    return -1;
  }
  throw new Error(`Invalid packed circuit port charge ${encodedCharge}`);
}

/** Corner rounding radius for convex corners and concave weld fillets. */
const CORNER_RADIUS_RATIO = 0.15;
/** Gap between a body outline and its cell boundary, so unwelded neighbors stay visually separate. */
const INSET_RATIO = 0.05;
/** Thickness of the top-left highlight and bottom-right shade bands. */
const BEVEL_RATIO = 0.05;

/** Logical pixels: supersampling must not change which details are visible. */
export const DECORATION_CELL_SIZE = 12;
const BEVEL_CELL_SIZE = 24;

const HIGHLIGHT_STYLE = "rgba(255, 255, 255, 0.15)";
const SHADE_STYLE = "rgba(0, 0, 0, 0.18)";

/** Cells and vertices are keyed on a fixed grid stride; supports coordinates up to 4095. */
const KEY_STRIDE = 4096;

interface BoundaryEdge {
  readonly x: number;
  readonly y: number;
  readonly direction: Direction;
  used: boolean;
}

interface OutlineCorner {
  x: number;
  y: number;
  radius: number;
}

function pointKey(x: number, y: number): number {
  return y * KEY_STRIDE + x;
}

/** Screen-space clockwise rotation; also the inward normal of a boundary heading. */
function rotateClockwise(direction: Direction): Direction {
  return ((direction + 1) & 3) as Direction;
}

/**
 * Draws one welded body as rounded slabs whose shared edges merge only where
 * welded: drop shadow, per-cell fill and decorations clipped to the outline,
 * top-left/bottom-right bevel lighting, and a dark rim.
 */
export function drawBody(
  context: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  cellSize: number,
  cells: readonly BodyCell[],
  cellCount: number = cells.length,
  path: Path2D | undefined = undefined,
  animationTime = 0,
  phase: "all" | "slab" | "decoration" = "all",
): void {
  if (cellCount === 0) {
    return;
  }
  const bodyPath = path ?? createBodyPath(originX, originY, cellSize, cells, cellCount);


  context.save();
  context.clip(bodyPath);
  if (phase !== "decoration") {
    for (let i = 0; i < cellCount; i += 1) {
      const cell = expectDefined(cells[i], "body cell");
      context.fillStyle = TILE_DEFINITIONS[cell.kind].fill;
      context.fillRect(
        originX + cell.x * cellSize,
        originY + cell.y * cellSize,
        cellSize,
        cellSize,
      );
    }
  }
  if (phase !== "slab" && cellSize >= DECORATION_CELL_SIZE) {
    for (let i = 0; i < cellCount; i += 1) {
      const cell = expectDefined(cells[i], "body cell");
      if (cell.pistonTransition !== -1) {
        drawBodyCellDecoration(context, originX, originY, cellSize, cell, animationTime);
      }
    }
  }

  if (phase !== "decoration" && tileAppearance.bevels && cellSize >= BEVEL_CELL_SIZE) {
    const bevel = Math.max(1.5, cellSize * BEVEL_RATIO);
    context.lineWidth = bevel * 2;
    context.translate(bevel - 0.2, bevel - 0.2); // Ad-hoc manually tuned -0.2 to reduce corner artifacts
    context.strokeStyle = HIGHLIGHT_STYLE;
    context.stroke(bodyPath);
    context.translate(-2 * bevel + 0.5, -2 * bevel + 0.5); // Same with +0.5
    context.strokeStyle = SHADE_STYLE;
    context.stroke(bodyPath);
  }

  context.restore();
  if (phase !== "slab" && cellSize >= DECORATION_CELL_SIZE) {
    // A retracting head can lie beyond its housing slab while a welded load
    // moves in a separate motion group. Do not clip it to the final housing.
    for (let i = 0; i < cellCount; i += 1) {
      const cell = expectDefined(cells[i], "body cell");
      if (cell.pistonTransition === -1) {
        drawBodyCellDecoration(context, originX, originY, cellSize, cell, animationTime);
      }
    }
  }

}

function drawBodyCellDecoration(
  context: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  cellSize: number,
  cell: BodyCell,
  animationTime: number,
): void {
  drawDecoration(
    context,
    originX + cell.x * cellSize,
    originY + cell.y * cellSize,
    cellSize,
    TILE_DEFINITIONS[cell.kind],
    cell.orientation,
    cell.outputCharge,
    cell.circuitConnections,
    cell.circuitPortCharges,
    cell.componentState ?? null,
    cell.nestedWorld ?? null,
    animationTime,
    cell.pistonTransition ?? 0,
    cell.pistonTransitionProgress ?? 1,
    cell.rotatorTurnOffset ?? 0,
  );
  const processingProgress = cell.processingProgress ?? 0;
  if (processingProgress > 0) {
    context.save();
    context.translate(
      originX + (cell.x + 0.5) * cellSize,
      originY + (cell.y + 0.5) * cellSize,
    );
    context.rotate(cell.orientation * Math.PI / 2);
    context.fillStyle = "#17130f";
    context.fillRect(-cellSize * 0.29, cellSize * 0.295, cellSize * 0.58, cellSize * 0.09);
    context.fillStyle = cell.outputCharge === 1 ? "#f4c568" : "#968675";
    context.fillRect(
      -cellSize * 0.27, cellSize * 0.315,
      cellSize * 0.54 * processingProgress, cellSize * 0.05,
    );
    context.restore();
  }
}

const SINGLE_CELL: [BodyCell] = [
  {
    x: 0,
    y: 0,
    kind: 0 as TileKind,
    orientation: Direction.Up,
    outputCharge: 0,
    circuitConnections: WeldSide.None,
    circuitPortCharges: 0,
    componentState: null,
    seamRight: false,
    seamDown: false,
  },
];

/**
 * Draws a lone tile (palette previews, placement hover, and the virtual port conduits
 * around a nested rune array board), optionally with a charge and connected sides.
 */
export function drawTile(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  kind: TileKind,
  orientation: Direction = Direction.Up,
  animationTime = 0,
  outputCharge: Charge = 0,
  circuitConnections: WeldSide = WeldSide.None,
  circuitPortCharges = 0,
): void {
  SINGLE_CELL[0].kind = kind;
  SINGLE_CELL[0].orientation = orientation;
  SINGLE_CELL[0].outputCharge = outputCharge;
  SINGLE_CELL[0].circuitConnections = circuitConnections;
  SINGLE_CELL[0].circuitPortCharges = circuitPortCharges;
  drawBody(context, left, top, size, SINGLE_CELL, 1, undefined, animationTime);
}

/**
 * Traces the boundary of a cell set into a rounded outline path. Occupied
 * neighbors merge only across welded edges, so an unwelded edge has the same
 * local geometry whether or not another weld path still connects the cells.
 *
 * Boundary edges are directed so the body interior lies to their right, which
 * makes outer loops wind clockwise and hole loops counterclockwise; nonzero
 * winding then fills holes correctly. Edges are inset toward the interior so
 * separate slabs never touch, and every corner is rounded with `arcTo`, which
 * yields convex rounding and concave weld fillets from the same construction.
 */
export function createBodyPath(
  originX: number,
  originY: number,
  cellSize: number,
  cells: readonly BodyCell[],
  cellCount: number,
): Path2D {
  const bodyCells = new Map<number, BodyCell>();
  for (let i = 0; i < cellCount; i += 1) {
    const cell = expectDefined(cells[i], "body cell");
    bodyCells.set(pointKey(cell.x, cell.y), cell);
  }

  const edges: BoundaryEdge[] = [];
  const edgesByVertex = new Map<number, BoundaryEdge[]>();
  const addEdge = (x: number, y: number, direction: Direction): void => {
    const edge: BoundaryEdge = { x, y, direction, used: false };
    edges.push(edge);
    const key = pointKey(x, y);
    const bucket = edgesByVertex.get(key);
    if (bucket === undefined) {
      edgesByVertex.set(key, [edge]);
    } else {
      bucket.push(edge);
    }
  };

  for (let i = 0; i < cellCount; i += 1) {
    const cell = expectDefined(cells[i], "body cell");
    const { x, y } = cell;
    const above = bodyCells.get(pointKey(x, y - 1));
    if (above === undefined || above.seamDown) {
      addEdge(x, y, Direction.Right);
    }
    const right = bodyCells.get(pointKey(x + 1, y));
    if (right === undefined || cell.seamRight) {
      addEdge(x + 1, y, Direction.Down);
    }
    const below = bodyCells.get(pointKey(x, y + 1));
    if (below === undefined || cell.seamDown) {
      addEdge(x + 1, y + 1, Direction.Left);
    }
    const left = bodyCells.get(pointKey(x - 1, y));
    if (left === undefined || left.seamRight) {
      addEdge(x, y + 1, Direction.Up);
    }
  }

  const path = new Path2D();
  const inset = Math.max(1, cellSize * INSET_RATIO);
  const cornerRadius = cellSize * CORNER_RADIUS_RATIO;
  const corners: OutlineCorner[] = [];

  for (const firstEdge of edges) {
    if (firstEdge.used) {
      continue;
    }
    firstEdge.used = true;
    corners.length = 0;

    let edge = firstEdge;
    while (true) {
      const vertexX = edge.x + directionX(edge.direction);
      const vertexY = edge.y + directionY(edge.direction);
      const next = takeNextEdge(edgesByVertex, vertexX, vertexY, edge.direction);
      if (next.direction !== edge.direction) {
        appendCorner(
          corners,
          originX,
          originY,
          cellSize,
          inset,
          vertexX,
          vertexY,
          edge.direction,
          next.direction,
        );
      }
      if (next.used && next !== firstEdge) {
        throw new Error("Body outline loops overlap");
      }
      if (next === firstEdge) {
        break;
      }
      next.used = true;
      edge = next;
    }

    appendLoop(path, corners, cornerRadius);
  }

  return path;
}

/**
 * Picks the boundary edge continuing from a vertex by following the body wall:
 * turn clockwise if possible, then continue straight, turn counterclockwise,
 * and reverse only for a closed seam endpoint. This fixed ordering is
 * independent of cell collection order. At a diagonal contact it chooses the
 * clockwise turn, keeping the contour from crossing itself and rendering two
 * rounded corners meeting in a pinch.
 */
function takeNextEdge(
  edgesByVertex: ReadonlyMap<number, readonly BoundaryEdge[]>,
  vertexX: number,
  vertexY: number,
  incomingDirection: Direction,
): BoundaryEdge {
  const candidates = edgesByVertex.get(pointKey(vertexX, vertexY));
  if (candidates === undefined) {
    throw new Error("Body outline is not closed");
  }

  let next: BoundaryEdge | undefined;
  let bestPriority = 4;
  for (const candidate of candidates) {
    const turn = (candidate.direction - incomingDirection + 4) & 3;
    const priority = turn === 1 ? 0 : turn === 0 ? 1 : turn === 3 ? 2 : 3;
    if (priority < bestPriority) {
      next = candidate;
      bestPriority = priority;
    }
  }
  return expectDefined(next, "body outline successor edge");
}

function appendCorner(
  corners: OutlineCorner[],
  originX: number,
  originY: number,
  cellSize: number,
  inset: number,
  vertexX: number,
  vertexY: number,
  incomingDirection: Direction,
  outgoingDirection: Direction,
): void {
  const inwardIncoming = rotateClockwise(incomingDirection);
  const inwardOutgoing = rotateClockwise(outgoingDirection);
  const vertexScreenX = originX + vertexX * cellSize;
  const vertexScreenY = originY + vertexY * cellSize;
  if (outgoingDirection === ((incomingDirection + 2) & 3)) {
    corners.push({
      x: vertexScreenX + directionX(inwardIncoming) * inset,
      y: vertexScreenY + directionY(inwardIncoming) * inset,
      radius: 0,
    });
    corners.push({
      x: vertexScreenX + directionX(inwardOutgoing) * inset,
      y: vertexScreenY + directionY(inwardOutgoing) * inset,
      radius: 0,
    });
    return;
  }
  corners.push({
    x: vertexScreenX + (directionX(inwardIncoming) + directionX(inwardOutgoing)) * inset,
    y: vertexScreenY + (directionY(inwardIncoming) + directionY(inwardOutgoing)) * inset,
    radius: 0,
  });
}

function appendLoop(path: Path2D, corners: OutlineCorner[], cornerRadius: number): void {
  const count = corners.length;
  if (count < 4) {
    return;
  }

  for (let i = 0; i < count; i += 1) {
    const previous = expectDefined(corners[(i + count - 1) % count], "outline corner");
    const current = expectDefined(corners[i], "outline corner");
    const next = expectDefined(corners[(i + 1) % count], "outline corner");
    const incomingLength =
      Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
    const outgoingLength = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
    current.radius = Math.min(cornerRadius, incomingLength / 2, outgoingLength / 2);
  }

  const last = expectDefined(corners[count - 1], "outline corner");
  const first = expectDefined(corners[0], "outline corner");
  path.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let i = 0; i < count; i += 1) {
    const current = expectDefined(corners[i], "outline corner");
    const next = expectDefined(corners[(i + 1) % count], "outline corner");
    path.arcTo(current.x, current.y, next.x, next.y, current.radius);
  }
  path.closePath();
}

function drawDecoration(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  definition: TileDefinition,
  orientation: Direction,
  outputCharge: Charge,
  circuitConnections: WeldSide,
  circuitPortCharges: number,
  componentState: ConfigurableComponentSnapshot | null,
  nestedWorld: World | null,
  animationTime: number,
  pistonTransition: -1 | 0 | 1,
  pistonTransitionProgress: number,
  rotatorTurnOffset: number,
): void {
  if (circuitConnections !== WeldSide.None) {
    const hasComponentDisplay =
      definition.decorationStyle === TileDecorationStyle.Delay ||
      definition.decorationStyle === TileDecorationStyle.Discard ||
      definition.decorationStyle === TileDecorationStyle.Counter ||
      definition.decorationStyle === TileDecorationStyle.Rom ||
      definition.decorationStyle === TileDecorationStyle.Lut ||
      definition.decorationStyle === TileDecorationStyle.Checker ||
      definition.decorationStyle === TileDecorationStyle.Rotator ||
      definition.decorationStyle === TileDecorationStyle.Furnace ||
      definition.decorationStyle === TileDecorationStyle.Drill ||
      definition.decorationStyle === TileDecorationStyle.Grinder ||
      definition.decorationStyle === TileDecorationStyle.RuneArray;
    const hasOutputArrow =
      definition.decorationStyle === TileDecorationStyle.Rectifier ||
      definition.decorationStyle === TileDecorationStyle.Combiner ||
      definition.decorationStyle === TileDecorationStyle.Multiplier ||
      definition.decorationStyle === TileDecorationStyle.Subtractor ||
      definition.decorationStyle === TileDecorationStyle.Equality ||
      definition.decorationStyle === TileDecorationStyle.Minimum ||
      definition.decorationStyle === TileDecorationStyle.Maximum ||
      definition.decorationStyle === TileDecorationStyle.Delay ||
      definition.decorationStyle === TileDecorationStyle.Discard ||
      definition.decorationStyle === TileDecorationStyle.Counter ||
      definition.decorationStyle === TileDecorationStyle.Checker;
    drawCircuitConnections(
      context,
      left,
      top,
      size,
      circuitConnections,
      circuitPortCharges,
      (orientedSides(
        (definition.circuitInputPorts | definition.circuitOutputPorts |
          (definition.decorationStyle === TileDecorationStyle.Rotator
            ? WeldSide.Down
            : WeldSide.None)) as WeldSide,
        orientation,
      ) |
        (definition.decorationStyle === TileDecorationStyle.WireCrossing ||
            definition.decorationStyle === TileDecorationStyle.RuneArray ||
            definition.decorationStyle === TileDecorationStyle.FixedCharge ||
            definition.decorationStyle === TileDecorationStyle.Spark
          ? WeldSide.All
          : WeldSide.None)) as WeldSide,
      hasComponentDisplay ? 0.39 : 0.26,
      definition.decorationStyle === TileDecorationStyle.MovementSensor
        ? WeldSide.All
        : definition.decorationStyle === TileDecorationStyle.Lut
          ? orientedSides(WeldSide.Up | WeldSide.Right, orientation)
          : hasOutputArrow ? orientedSides(WeldSide.Up, orientation) : WeldSide.None,
    );
  }
  context.fillStyle = definition.decorationColor;
  context.strokeStyle = definition.decorationColor;

  switch (definition.decorationStyle) {
    case TileDecorationStyle.Gem:
      // Unequal facet lighting keeps the cut legible without a per-tile gradient.
      context.fillStyle = "rgba(255, 255, 255, 0.38)";
      context.beginPath();
      context.moveTo(left + size * 0.5, top + size * 0.16);
      context.lineTo(left + size * 0.38, top + size * 0.5);
      context.lineTo(left + size * 0.18, top + size * 0.5);
      context.closePath();
      context.fill();
      context.fillStyle = "rgba(255, 255, 255, 0.16)";
      context.beginPath();
      context.moveTo(left + size * 0.5, top + size * 0.16);
      context.lineTo(left + size * 0.82, top + size * 0.5);
      context.lineTo(left + size * 0.62, top + size * 0.5);
      context.closePath();
      context.fill();
      context.fillStyle = "rgba(12, 16, 35, 0.38)";
      context.beginPath();
      context.moveTo(left + size * 0.82, top + size * 0.5);
      context.lineTo(left + size * 0.5, top + size * 0.84);
      context.lineTo(left + size * 0.62, top + size * 0.5);
      context.closePath();
      context.fill();
      context.fillStyle = "rgba(255, 255, 255, 0.24)";
      context.beginPath();
      context.moveTo(left + size * 0.38, top + size * 0.5);
      context.lineTo(left + size * 0.62, top + size * 0.5);
      context.lineTo(left + size * 0.5, top + size * 0.84);
      context.closePath();
      context.fill();
      context.lineWidth = Math.max(1, size * 0.035);
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(left + size * 0.5, top + size * 0.16);
      context.lineTo(left + size * 0.82, top + size * 0.5);
      context.lineTo(left + size * 0.5, top + size * 0.84);
      context.lineTo(left + size * 0.18, top + size * 0.5);
      context.closePath();
      context.stroke();
      context.beginPath();
      context.moveTo(left + size * 0.5, top + size * 0.16);
      context.lineTo(left + size * 0.38, top + size * 0.5);
      context.lineTo(left + size * 0.5, top + size * 0.84);
      context.lineTo(left + size * 0.62, top + size * 0.5);
      context.closePath();
      context.moveTo(left + size * 0.18, top + size * 0.5);
      context.lineTo(left + size * 0.82, top + size * 0.5);
      context.stroke();
      // Specular X
      context.strokeStyle = "#ffffff";
      context.lineWidth = Math.max(1, size * 0.035);
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(left + size * 0.68, top + size * 0.28);
      context.lineTo(left + size * 0.68, top + size * 0.42);
      context.moveTo(left + size * 0.62, top + size * 0.35);
      context.lineTo(left + size * 0.74, top + size * 0.35);
      context.stroke();
      // Small specular highlight
      context.lineWidth = Math.max(1, size * 0.085);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = definition.decorationColor;
      context.beginPath();
      context.moveTo(left + size * 0.18, top + size * 0.20);
      context.lineTo(left + size * 0.18, top + size * 0.20);
      context.stroke();
      break;
    case TileDecorationStyle.Wood:
      context.lineWidth = Math.max(1, size * 0.035);
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(left + size * 0.18, top + size * 0.3);
      context.bezierCurveTo(left + size * 0.4, top + size * 0.2,
        left + size * 0.6, top + size * 0.4, left + size * 0.82, top + size * 0.3);
      context.moveTo(left + size * 0.18, top + size * 0.7);
      context.bezierCurveTo(left + size * 0.4, top + size * 0.6,
        left + size * 0.6, top + size * 0.8, left + size * 0.82, top + size * 0.7);
      context.stroke();
      context.beginPath();
      context.ellipse(left + size * 0.5, top + size * 0.5,
        size * 0.14, size * 0.07, 0, 0, Math.PI * 2);
      context.stroke();
      break;
    case TileDecorationStyle.Glass:
      context.lineWidth = size * 0.09;
      context.strokeStyle = "rgba(157, 221, 230, 0.32)";
      context.beginPath();
      context.roundRect(left + size * 0.14, top + size * 0.14, size * 0.72, size * 0.72, size * 0.09);
      context.stroke();
      // Small specular highlight
      context.lineWidth = Math.max(1, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = definition.decorationColor;
      context.beginPath();
      context.moveTo(left + size * 0.2, top + size * 0.22);
      context.lineTo(left + size * 0.2, top + size * 0.22);
      context.stroke();
      break;
    case TileDecorationStyle.Crack:
      context.lineWidth = Math.max(1, size / 24);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(left + size * 0.34, top + size * 0.3);
      context.lineTo(left + size * 0.47, top + size * 0.47);
      context.lineTo(left + size * 0.41, top + size * 0.59);
      context.lineTo(left + size * 0.55, top + size * 0.74);
      context.stroke();
      break;
    case TileDecorationStyle.SquareGrains: {
      const grainSize = Math.max(1, size * 0.12);
      context.fillRect(left + size * 0.26, top + size * 0.32, grainSize, grainSize);
      context.fillRect(left + size * 0.57, top + size * 0.24, grainSize, grainSize);
      context.fillRect(left + size * 0.42, top + size * 0.52, grainSize, grainSize);
      context.fillRect(left + size * 0.62, top + size * 0.66, grainSize, grainSize);
      break;
    }
    case TileDecorationStyle.Grains: {
      const grainRadius = Math.max(1, size * 0.05);
      context.beginPath();
      drawDot(context, left + size * 0.32, top + size * 0.38, grainRadius);
      drawDot(context, left + size * 0.63, top + size * 0.3, grainRadius);
      drawDot(context, left + size * 0.48, top + size * 0.58, grainRadius);
      drawDot(context, left + size * 0.68, top + size * 0.72, grainRadius);
      context.fill();
      break;
    }
    case TileDecorationStyle.Magnet:
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.beginPath();
      context.moveTo(0, -size * 0.31);
      context.lineTo(size * 0.22, size * 0.04);
      context.lineTo(size * 0.08, size * 0.04);
      context.lineTo(size * 0.08, size * 0.25);
      context.lineTo(-size * 0.08, size * 0.25);
      context.lineTo(-size * 0.08, size * 0.04);
      context.lineTo(-size * 0.22, size * 0.04);
      context.closePath();
      context.fill();
      context.restore();
      break;
    case TileDecorationStyle.Floatstone:
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(left + size * 0.5, top + size * 0.2);
      context.lineTo(left + size * 0.7, top + size * 0.4);
      context.lineTo(left + size * 0.5, top + size * 0.6);
      context.lineTo(left + size * 0.3, top + size * 0.4);
      context.closePath();
      context.stroke();
      context.beginPath();
      context.moveTo(left + size * 0.25, top + size * 0.7);
      context.lineTo(left + size * 0.75, top + size * 0.7);
      context.moveTo(left + size * 0.35, top + size * 0.8);
      context.lineTo(left + size * 0.65, top + size * 0.8);
      context.stroke();
      break;
    case TileDecorationStyle.LevitationProjector:
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1.5, size * 0.045);
      context.lineCap = "round";
      context.lineJoin = "round";
      // A suspended crystal above a projecting dish; the arrow marks the beam.
      context.beginPath();
      context.moveTo(0, -size * 0.2);
      context.lineTo(size * 0.12, -size * 0.06);
      context.lineTo(0, size * 0.08);
      context.lineTo(-size * 0.12, -size * 0.06);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(-size * 0.26, size * 0.08);
      context.lineTo(-size * 0.17, size * 0.23);
      context.lineTo(size * 0.17, size * 0.23);
      context.lineTo(size * 0.26, size * 0.08);
      context.moveTo(-size * 0.16, size * 0.33);
      context.lineTo(size * 0.16, size * 0.33);
      context.moveTo(0, -size * 0.25);
      context.lineTo(0, -size * 0.4);
      context.moveTo(-size * 0.07, -size * 0.33);
      context.lineTo(0, -size * 0.4);
      context.lineTo(size * 0.07, -size * 0.33);
      context.stroke();
      context.restore();
      break;
    case TileDecorationStyle.Thruster:
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1, size * 0.035);
      context.lineJoin = "round";
      context.strokeStyle = "#392d2a";
      // Pointed bronze housing and a flared rear nozzle.
      context.beginPath();
      context.moveTo(0, -size * 0.34);
      context.lineTo(size * 0.18, -size * 0.08);
      context.lineTo(size * 0.12, size * 0.1);
      context.lineTo(size * 0.23, size * 0.18);
      context.lineTo(-size * 0.23, size * 0.18);
      context.lineTo(-size * 0.12, size * 0.1);
      context.lineTo(-size * 0.18, -size * 0.08);
      context.closePath();
      context.fill();
      context.stroke();
      context.fillStyle = "#ee9553";
      context.beginPath();
      context.moveTo(-size * 0.12, size * 0.22);
      context.lineTo(0, size * 0.39);
      context.lineTo(size * 0.12, size * 0.22);
      context.closePath();
      context.fill();
      context.fillStyle = "#fff1ba";
      context.beginPath();
      context.moveTo(-size * 0.055, size * 0.22);
      context.lineTo(0, size * 0.31);
      context.lineTo(size * 0.055, size * 0.22);
      context.closePath();
      context.fill();
      context.restore();
      break;
    case TileDecorationStyle.ControlledThruster:
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.lineWidth = Math.max(1, size * 0.035);
      context.lineJoin = "round";
      context.strokeStyle = "#392d2a";
      // Four outward-pointing housings leave the outer input traces unobstructed.
      for (let side = 0; side < 4; side += 1) {
        context.beginPath();
        context.moveTo(0, -size * 0.31);
        context.lineTo(size * 0.095, -size * 0.16);
        context.lineTo(size * 0.065, -size * 0.07);
        context.lineTo(-size * 0.065, -size * 0.07);
        context.lineTo(-size * 0.095, -size * 0.16);
        context.closePath();
        context.fill();
        context.stroke();
        context.rotate(Math.PI / 2);
      }
      context.fillStyle = "#ee9553";
      context.beginPath();
      context.moveTo(0, -size * 0.1);
      context.lineTo(size * 0.1, 0);
      context.lineTo(0, size * 0.1);
      context.lineTo(-size * 0.1, 0);
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();
      break;
    case TileDecorationStyle.Slider:
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1.5, size * 0.045);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(-size * 0.23, -size * 0.32);
      context.lineTo(-size * 0.23, size * 0.32);
      context.moveTo(size * 0.23, -size * 0.32);
      context.lineTo(size * 0.23, size * 0.32);
      context.stroke();
      context.fillStyle = "#293e3c";
      context.fillRect(-size * 0.29, -size * 0.1, size * 0.58, size * 0.2);
      context.strokeRect(-size * 0.29, -size * 0.1, size * 0.58, size * 0.2);
      context.beginPath();
      context.moveTo(-size * 0.08, -size * 0.23);
      context.lineTo(0, -size * 0.32);
      context.lineTo(size * 0.08, -size * 0.23);
      context.moveTo(-size * 0.08, size * 0.23);
      context.lineTo(0, size * 0.32);
      context.lineTo(size * 0.08, size * 0.23);
      context.stroke();
      context.restore();
      break;
    case TileDecorationStyle.Fastener:
      context.lineWidth = Math.max(1, size * 0.035);
      context.lineJoin = "miter";
      context.lineCap = "butt";
      context.strokeStyle = "#302b28";
      // A forged hexagonal head over a tapered, threaded fastening pin.
      context.beginPath();
      context.moveTo(left + size * 0.41, top + size * 0.4);
      context.lineTo(left + size * 0.59, top + size * 0.4);
      context.lineTo(left + size * 0.59, top + size * 0.71);
      context.lineTo(left + size * 0.5, top + size * 0.84);
      context.lineTo(left + size * 0.41, top + size * 0.71);
      context.closePath();
      context.fill();
      context.stroke();
      context.beginPath();
      context.moveTo(left + size * 0.36, top + size * 0.17);
      context.lineTo(left + size * 0.64, top + size * 0.17);
      context.lineTo(left + size * 0.73, top + size * 0.32);
      context.lineTo(left + size * 0.64, top + size * 0.47);
      context.lineTo(left + size * 0.36, top + size * 0.47);
      context.lineTo(left + size * 0.27, top + size * 0.32);
      context.closePath();
      context.fill();
      context.stroke();
      context.lineWidth = Math.max(1.5, size * 0.05);
      context.beginPath();
      context.moveTo(left + size * 0.37, top + size * 0.32);
      context.lineTo(left + size * 0.63, top + size * 0.32);
      context.moveTo(left + size * 0.41, top + size * 0.57);
      context.lineTo(left + size * 0.59, top + size * 0.52);
      context.moveTo(left + size * 0.41, top + size * 0.69);
      context.lineTo(left + size * 0.59, top + size * 0.64);
      context.stroke();
      context.strokeStyle = "#fff0c7";
      context.lineWidth = Math.max(1, size * 0.025);
      context.beginPath();
      context.moveTo(left + size * 0.32, top + size * 0.3);
      context.lineTo(left + size * 0.39, top + size * 0.21);
      context.lineTo(left + size * 0.61, top + size * 0.21);
      context.stroke();
      break;
    case TileDecorationStyle.Iron: {
      const rivetOffset = size * 0.26;
      const rivetRadius = Math.max(1, size * 0.05);
      context.beginPath();
      drawDot(context, left + rivetOffset, top + rivetOffset, rivetRadius);
      drawDot(context, left + size - rivetOffset, top + rivetOffset, rivetRadius);
      drawDot(context, left + rivetOffset, top + size - rivetOffset, rivetRadius);
      drawDot(context, left + size - rivetOffset, top + size - rivetOffset, rivetRadius);
      context.fill();
      break;
    }
    case TileDecorationStyle.Welder:
    case TileDecorationStyle.Splitter:
    case TileDecorationStyle.LaserSplitter: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.strokeStyle = definition.decorationColor;
      context.fillStyle = "#211a16";
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(-size * 0.18, size * 0.2);
      context.lineTo(-size * 0.1, -size * 0.1);
      context.lineTo(size * 0.1, -size * 0.1);
      context.lineTo(size * 0.18, size * 0.2);
      context.closePath();
      context.fill();
      context.stroke();
      context.beginPath();
      if (definition.decorationStyle === TileDecorationStyle.Welder) {
        context.moveTo(-size * 0.28, -size * 0.2);
        context.lineTo(-size * 0.1, -size * 0.12);
        context.moveTo(size * 0.28, -size * 0.2);
        context.lineTo(size * 0.1, -size * 0.12);
        context.moveTo(0, -size * 0.3);
        context.lineTo(0, -size * 0.14);
      } else if (definition.decorationStyle === TileDecorationStyle.LaserSplitter) {
        context.moveTo(0, -size * 0.1);
        context.lineTo(-size * 0.28, -size * 0.1);
        context.lineTo(-size * 0.28, -size * 0.36);
        context.moveTo(-size * 0.36, -size * 0.26);
        context.lineTo(-size * 0.28, -size * 0.36);
        context.lineTo(-size * 0.2, -size * 0.26);
      } else {
        context.moveTo(-size * 0.25, -size * 0.26);
        context.lineTo(0, -size * 0.1);
        context.lineTo(size * 0.25, -size * 0.26);
        context.moveTo(0, -size * 0.1);
        context.lineTo(-size * 0.12, -size * 0.31);
        context.moveTo(0, -size * 0.1);
        context.lineTo(size * 0.12, -size * 0.31);
      }
      context.stroke();
      const backDirection = ((orientation + Direction.Down) & 3) as Direction;
      context.fillStyle = CIRCUIT_CHARGE_COLORS[
        circuitPortCharge(circuitPortCharges, backDirection)
      ];
      context.beginPath();
      drawDot(context, 0, size * 0.2, Math.max(1.5, size * 0.065));
      context.fill();
      context.restore();
      break;
    }
    case TileDecorationStyle.Drill: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.fillStyle = "#242a31";
      context.strokeStyle = definition.decorationColor;
      context.lineWidth = Math.max(1.5, size * 0.045);
      context.lineJoin = "round";
      context.beginPath();
      context.rect(-size * 0.23, size * 0.08, size * 0.46, size * 0.2);
      context.fill();
      context.stroke();
      context.beginPath();
      context.moveTo(-size * 0.16, size * 0.08);
      context.lineTo(0, -size * 0.35);
      context.lineTo(size * 0.16, size * 0.08);
      context.closePath();
      context.fillStyle = definition.decorationColor;
      context.fill();
      context.strokeStyle = "#424a55";
      context.save();
      context.clip();
      if (outputCharge === 1) {
        context.translate(0, ((animationTime % 300) / 300) * size * 0.13);
      }
      context.lineWidth = Math.max(1, size * 0.035);
      context.beginPath();
      for (let groove = -3; groove <= 1; groove += 1) {
        const y = groove * size * 0.13;
        context.moveTo(-size * 0.2, y);
        context.lineTo(size * 0.2, y + size * 0.2);
      }
      context.stroke();
      context.restore();
      context.restore();
      break;
    }
    case TileDecorationStyle.Grinder: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.strokeStyle = definition.decorationColor;
      context.lineWidth = Math.max(1, size * 0.035);
      context.lineJoin = "round";
      // The open intake faces the target; the paired toothed rollers crush inward.
      context.beginPath();
      context.moveTo(-size * 0.25, -size * 0.3);
      context.lineTo(-size * 0.1, -size * 0.17);
      context.moveTo(size * 0.25, -size * 0.3);
      context.lineTo(size * 0.1, -size * 0.17);
      context.moveTo(-size * 0.24, size * 0.26);
      context.lineTo(size * 0.24, size * 0.26);
      context.stroke();
      for (let roller = 0; roller < 2; roller += 1) {
        context.save();
        context.translate((roller === 0 ? -1 : 1) * size * 0.155, size * 0.025);
        context.fillStyle = definition.decorationColor;
        context.save();
        context.rotate(roller * Math.PI / 8 +
          (outputCharge === 1 ? (roller === 0 ? 1 : -1) * animationTime / 250 : 0));
        for (let tooth = 0; tooth < 8; tooth += 1) {
          context.fillRect(-size * 0.035, -size * 0.15, size * 0.07, size * 0.065);
          context.rotate(Math.PI / 4);
        }
        context.restore();
        context.beginPath();
        context.arc(0, 0, size * 0.105, 0, Math.PI * 2);
        context.fillStyle = "#292a27";
        context.fill();
        context.stroke();
        context.beginPath();
        drawDot(context, 0, 0, Math.max(1, size * 0.035));
        context.fillStyle = outputCharge === 1 ? "#f4dc91" : definition.decorationColor;
        context.fill();
        context.restore();
      }
      context.restore();
      break;
    }
    case TileDecorationStyle.Furnace: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.fillStyle = "#241812";
      context.beginPath();
      context.moveTo(-size * 0.24, size * 0.2);
      context.lineTo(-size * 0.2, -size * 0.2);
      context.quadraticCurveTo(0, -size * 0.34, size * 0.2, -size * 0.2);
      context.lineTo(size * 0.24, size * 0.2);
      context.closePath();
      context.fill();
      context.strokeStyle = definition.decorationColor;
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.stroke();
      context.fillStyle = outputCharge === 1 ? "#ff9f43" : "#5a3024";
      context.save();
      if (outputCharge === 1) {
        context.scale(1 + 0.08 * Math.sin(animationTime / 83), 1 + 0.1 * Math.sin(animationTime / 61));
      }
      context.beginPath();
      context.moveTo(0, -size * 0.22);
      context.bezierCurveTo(
        size * 0.14,
        -size * 0.06,
        size * 0.1,
        size * 0.1,
        0,
        size * 0.14,
      );
      context.bezierCurveTo(
        -size * 0.12,
        size * 0.06,
        -size * 0.08,
        -size * 0.08,
        0,
        -size * 0.22,
      );
      context.fill();
      context.restore();
      context.restore();
      break;
    }
    case TileDecorationStyle.Duplicator: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.strokeStyle = definition.decorationColor;
      context.fillStyle = definition.decorationColor;
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(-size * 0.13, -size * 0.14);
      context.lineTo(-size * 0.13, size * 0.17);
      context.moveTo(size * 0.13, -size * 0.14);
      context.lineTo(size * 0.13, size * 0.17);
      context.moveTo(-size * 0.24, -size * 0.14);
      context.lineTo(size * 0.24, -size * 0.14);
      context.moveTo(-size * 0.24, size * 0.17);
      context.lineTo(size * 0.24, size * 0.17);
      context.stroke();
      context.beginPath();
      drawDot(context, 0, -size * 0.29, Math.max(1.5, size * 0.06));
      context.fill();
      context.restore();
      drawPortArrows(context, left, top, size, orientation,
        WeldSide.Left | WeldSide.Right, WeldSide.None, circuitPortCharges);
      break;
    }
    case TileDecorationStyle.Rotator: {
      const gripDirection = componentState?.type === "rotator"
        ? componentState.direction
        : orientation;
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.arc(0, 0, size * 0.13, 0, Math.PI * 2);
      context.stroke();
      context.save();
      context.rotate((gripDirection + rotatorTurnOffset) * Math.PI / 2);
      context.beginPath();
      context.moveTo(-size * 0.1, -size * 0.24);
      context.lineTo(0, -size * 0.34);
      context.lineTo(size * 0.1, -size * 0.24);
      context.stroke();
      context.restore();
      // Draw dots to indicate +1 rotates clockwise, -1 anticlockwise.
      context.rotate(orientation * Math.PI / 2);
      context.fillStyle = CIRCUIT_CHARGE_COLORS[-1];
      context.beginPath();
      drawDot(context, -size * 0.2, size * 0.25, size * 0.055);
      context.fill();
      context.fillStyle = CIRCUIT_CHARGE_COLORS[1];
      context.beginPath();
      drawDot(context, size * 0.2, size * 0.25, size * 0.055);
      context.fill();
      context.restore();
      drawPortArrows(context, left, top, size, orientation,
        WeldSide.Down, WeldSide.None, circuitPortCharges);
      break;
    }
    case TileDecorationStyle.Assembler: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      // Intake hopper on the pointed side narrowing into the anvil body.
      context.fillStyle = "#2a2019";
      context.strokeStyle = definition.decorationColor;
      context.beginPath();
      context.moveTo(-size * 0.3, -size * 0.32);
      context.lineTo(size * 0.3, -size * 0.32);
      context.lineTo(size * 0.12, -size * 0.08);
      context.lineTo(-size * 0.12, -size * 0.08);
      context.closePath();
      context.fill();
      context.stroke();
      // Anvil.
      context.beginPath();
      context.moveTo(-size * 0.28, size * 0.0);
      context.lineTo(size * 0.28, size * 0.0);
      context.lineTo(size * 0.16, size * 0.1);
      context.lineTo(size * 0.08, size * 0.1);
      context.lineTo(size * 0.08, size * 0.2);
      context.lineTo(size * 0.2, size * 0.28);
      context.lineTo(-size * 0.2, size * 0.28);
      context.lineTo(-size * 0.08, size * 0.2);
      context.lineTo(-size * 0.08, size * 0.1);
      context.lineTo(-size * 0.16, size * 0.1);
      context.closePath();
      context.fill();
      context.stroke();
      // Pending-output pips along the rear edge.
      const pendingCount = componentState?.type === "assembler"
        ? componentState.pending.length
        : 0;
      if (pendingCount > 0) {
        const pipRadius = Math.max(1, size * 0.035);
        const pipSpacing = size * 0.09;
        const shown = Math.min(pendingCount, 5);
        context.fillStyle = "#ffd27a";
        context.beginPath();
        for (let pip = 0; pip < shown; pip += 1) {
          drawDot(
            context,
            (pip - (shown - 1) / 2) * pipSpacing,
            size * 0.38,
            pipRadius,
          );
        }
        context.fill();
      }
      context.restore();
      break;
    }
    case TileDecorationStyle.Comparer: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.strokeStyle = definition.decorationColor;
      context.lineWidth = Math.max(1.5, size * 0.045);
      context.strokeRect(-size * 0.1, -size * 0.34, size * 0.2, size * 0.16);
      context.strokeRect(-size * 0.1, size * 0.18, size * 0.2, size * 0.16);
      context.strokeStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(-size * 0.15, -size * 0.06);
      context.lineTo(size * 0.15, -size * 0.06);
      context.moveTo(-size * 0.15, size * 0.06);
      context.lineTo(size * 0.15, size * 0.06);
      context.stroke();
      context.restore();
      break;
    }
    case TileDecorationStyle.Delivery: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.fillStyle = "#241a12";
      context.strokeStyle = definition.decorationColor;
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(-size * 0.25, -size * 0.29);
      context.lineTo(-size * 0.25, size * 0.23);
      context.lineTo(size * 0.25, size * 0.23);
      context.lineTo(size * 0.25, -size * 0.29);
      context.lineTo(size * 0.13, -size * 0.18);
      context.lineTo(-size * 0.13, -size * 0.18);
      context.closePath();
      context.fill();
      context.stroke();
      context.beginPath();
      context.moveTo(0, -size * 0.3);
      context.lineTo(0, size * 0.06);
      context.moveTo(-size * 0.1, -size * 0.04);
      context.lineTo(0, size * 0.06);
      context.lineTo(size * 0.1, -size * 0.04);
      context.stroke();
      context.fillStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      drawDot(context, 0, size * 0.16, Math.max(1.5, size * 0.06));
      context.fill();
      context.restore();
      break;
    }
    case TileDecorationStyle.Victory: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      // Jera: two opposed, offset harvest strokes.
      context.moveTo(size * 0.02, -size * 0.25);
      context.lineTo(-size * 0.2, -size * 0.08);
      context.lineTo(size * 0.02, size * 0.09);
      context.moveTo(-size * 0.02, -size * 0.09);
      context.lineTo(size * 0.2, size * 0.08);
      context.lineTo(-size * 0.02, size * 0.25);
      context.stroke();
      context.restore();
      break;
    }
    case TileDecorationStyle.Conveyor: {
      const inset = size * 0.2;
      context.save();
      context.strokeStyle = definition.decorationColor;
      context.lineWidth = Math.max(1.5, size * 0.065);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.setLineDash([size * 0.11, size * 0.09]);
      context.lineDashOffset = outputCharge === 0
        ? 0
        : -outputCharge * animationTime * size / 1000;
      context.beginPath();
      context.moveTo(left + inset, top + inset);
      context.lineTo(left + size - inset, top + inset);
      context.lineTo(left + size - inset, top + size - inset);
      context.lineTo(left + inset, top + size - inset);
      context.closePath();
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      drawDot(context, left + size / 2, top + size / 2, Math.max(2, size * 0.12));
      context.fill();
      context.restore();
      break;
    }
    case TileDecorationStyle.Conduit:
      context.fillStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      drawDot(context, left + size / 2, top + size / 2, Math.max(2, size * 0.13));
      context.fill();
      break;
    case TileDecorationStyle.FixedCharge: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.lineWidth = Math.max(1.5, size * 0.045);
      context.fillStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      context.moveTo(size * 0.04, -size * 0.24);
      context.lineTo(-size * 0.15, size * 0.03);
      context.lineTo(-size * 0.02, size * 0.03);
      context.lineTo(-size * 0.06, size * 0.24);
      context.lineTo(size * 0.16, -size * 0.06);
      context.lineTo(size * 0.03, -size * 0.06);
      context.closePath();
      context.fill();
      context.restore();
      break;
    }
    case TileDecorationStyle.Spark: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.lineWidth = Math.max(1.5, size * 0.045);
      context.lineCap = "round";
      context.strokeStyle = definition.decorationColor;
      context.beginPath();
      context.moveTo(-size * 0.24, -size * 0.24);
      context.lineTo(-size * 0.16, -size * 0.16);
      context.moveTo(size * 0.24, -size * 0.24);
      context.lineTo(size * 0.16, -size * 0.16);
      context.moveTo(size * 0.24, size * 0.24);
      context.lineTo(size * 0.16, size * 0.16);
      context.moveTo(-size * 0.24, size * 0.24);
      context.lineTo(-size * 0.16, size * 0.16);
      context.stroke();
      context.fillStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      context.moveTo(size * 0.04, -size * 0.24);
      context.lineTo(-size * 0.15, size * 0.03);
      context.lineTo(-size * 0.02, size * 0.03);
      context.lineTo(-size * 0.06, size * 0.24);
      context.lineTo(size * 0.16, -size * 0.06);
      context.lineTo(size * 0.03, -size * 0.06);
      context.closePath();
      context.fill();
      context.restore();
      break;
    }
    case TileDecorationStyle.Sensor:
    case TileDecorationStyle.ChargeSensor: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(0, -size * 0.2);
      context.lineTo(size * 0.25, 0);
      context.lineTo(0, size * 0.2);
      context.lineTo(-size * 0.25, 0);
      context.closePath();
      context.stroke();
      context.beginPath();
      context.moveTo(-size * 0.07, -size * 0.29);
      context.lineTo(0, -size * 0.36);
      context.lineTo(size * 0.07, -size * 0.29);
      context.stroke();
      context.fillStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      if (definition.decorationStyle === TileDecorationStyle.Sensor) {
        context.moveTo(0, -size * 0.09);
        context.lineTo(size * 0.09, 0);
        context.lineTo(0, size * 0.09);
        context.lineTo(-size * 0.09, 0);
      } else {
        context.moveTo(size * 0.035, -size * 0.13);
        context.lineTo(-size * 0.085, size * 0.025);
        context.lineTo(-size * 0.005, size * 0.025);
        context.lineTo(-size * 0.035, size * 0.13);
        context.lineTo(size * 0.085, -size * 0.025);
        context.lineTo(size * 0.005, -size * 0.025);
      }
      context.closePath();
      context.fill();
      context.restore();
      break;
    }
    case TileDecorationStyle.MovementSensor:
      context.lineWidth = Math.max(1.5, size * 0.05);
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(left + size * 0.5, top + size * 0.3);
      context.lineTo(left + size * 0.72, top + size * 0.5);
      context.lineTo(left + size * 0.5, top + size * 0.7);
      context.lineTo(left + size * 0.28, top + size * 0.5);
      context.closePath();
      context.stroke();
      context.beginPath();
      context.moveTo(left + size * 0.5, top + size * 0.42);
      context.lineTo(left + size * 0.58, top + size * 0.5);
      context.lineTo(left + size * 0.5, top + size * 0.58);
      context.lineTo(left + size * 0.42, top + size * 0.5);
      context.closePath();
      context.fill();
      drawPortArrows(context, left, top, size, Direction.Up,
        WeldSide.None, WeldSide.All, circuitPortCharges);
      break;
    case TileDecorationStyle.Inverter: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      // Hagalaz: two staves joined by a descending diagonal.
      context.moveTo(-size * 0.13, -size * 0.13);
      context.lineTo(-size * 0.13, size * 0.17);
      context.moveTo(size * 0.13, -size * 0.13);
      context.lineTo(size * 0.13, size * 0.17);
      context.moveTo(-size * 0.13, -size * 0.07);
      context.lineTo(size * 0.13, size * 0.10);
      context.stroke();
      context.fillStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      drawDot(context, 0, -size * 0.27, Math.max(1.5, size * 0.075));
      context.fill();
      context.strokeStyle = definition.decorationColor;
      context.stroke();
      context.restore();
      break;
    }
    case TileDecorationStyle.Rectifier: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      // Thurisaz turned counterclockwise: the thorn points toward the output.
      context.moveTo(-size * 0.2, size * 0.1);
      context.lineTo(size * 0.2, size * 0.1);
      context.moveTo(-size * 0.15, size * 0.1);
      context.lineTo(0, -size * 0.15);
      context.lineTo(size * 0.15, size * 0.1);
      context.stroke();
      drawPortArrows(context, -size / 2, -size / 2, size, Direction.Up,
        WeldSide.None, WeldSide.Up, CIRCUIT_CHARGE_COLORS[outputCharge]);
      context.restore();
      break;
    }
    case TileDecorationStyle.Combiner: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      const s = size * 0.18;
      context.moveTo(-s, 0);
      context.lineTo(s, 0);
      context.moveTo(0, -s);
      context.lineTo(0, s);
      context.stroke();
      drawPortArrows(context, -size / 2, -size / 2, size, Direction.Up,
        WeldSide.None, WeldSide.Up, CIRCUIT_CHARGE_COLORS[outputCharge]);
      context.restore();
      break;
    }
    case TileDecorationStyle.Multiplier: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      const s = size * 0.14;
      context.moveTo(-s, -s);
      context.lineTo(s, s);
      context.moveTo(s, -s);
      context.lineTo(-s, s);
      context.stroke();
      drawPortArrows(context, -size / 2, -size / 2, size, Direction.Up,
        WeldSide.None, WeldSide.Up, CIRCUIT_CHARGE_COLORS[outputCharge]);
      context.restore();
      break;
    }
    case TileDecorationStyle.Subtractor: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(-size * 0.18, 0);
      context.lineTo(size * 0.18, 0);
      context.moveTo(-size * 0.1, size * 0.15);
      context.lineTo(size * 0.1, size * 0.15);
      context.moveTo(0, 0);
      context.lineTo(0, size * 0.25);
      context.stroke();
      drawPortArrows(context, -size / 2, -size / 2, size, Direction.Up,
        WeldSide.None, WeldSide.Up, CIRCUIT_CHARGE_COLORS[outputCharge]);
      context.restore();
      break;
    }
    case TileDecorationStyle.Selector: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(-size * 0.19, size * 0.1);
      context.lineTo(0, -size * 0.04);
      context.lineTo(0, -size * 0.2);
      context.moveTo(size * 0.19, size * 0.1);
      context.lineTo(size * 0.07, size * 0.01);
      context.moveTo(0, size * 0.2);
      context.lineTo(0, size * 0.08);
      context.stroke();
      context.fillStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      drawDot(context, 0, -size * 0.24, Math.max(1.5, size * 0.055));
      context.fill();
      // Rear control selects the left input on +1 and the right input on -1.
      context.fillStyle = CIRCUIT_CHARGE_COLORS[1];
      context.beginPath();
      drawDot(context, -size * 0.3, size * 0.18, size * 0.055);
      context.fill();
      context.fillStyle = CIRCUIT_CHARGE_COLORS[-1];
      context.beginPath();
      drawDot(context, size * 0.3, size * 0.18, size * 0.055);
      context.fill();
      context.restore();
      break;
    }
    case TileDecorationStyle.Equality:
    case TileDecorationStyle.Minimum:
    case TileDecorationStyle.Maximum: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      if (definition.decorationStyle === TileDecorationStyle.Equality) {
        context.moveTo(-size * 0.15, -size * 0.04);
        context.lineTo(size * 0.15, -size * 0.04);
        context.moveTo(-size * 0.15, size * 0.1);
        context.lineTo(size * 0.15, size * 0.1);
      } else {
        const tipY = definition.decorationStyle === TileDecorationStyle.Minimum
          ? size * 0.11
          : -size * 0.08;
        const armY = definition.decorationStyle === TileDecorationStyle.Minimum
          ? -size * 0.08
          : size * 0.11;
        context.moveTo(-size * 0.14, armY);
        context.lineTo(0, tipY);
        context.lineTo(size * 0.14, armY);
      }
      context.stroke();
      drawPortArrows(context, -size / 2, -size / 2, size, Direction.Up,
        WeldSide.None, WeldSide.Up, CIRCUIT_CHARGE_COLORS[outputCharge]);
      context.restore();
      break;
    }
    case TileDecorationStyle.WireCrossing: {
      const centerX = left + size / 2;
      const centerY = top + size / 2;
      const innerOffset = size * 0.27;
      const traceWidth = Math.max(2, size * 0.12);
      context.lineCap = "round";
      context.lineWidth = traceWidth;
      context.strokeStyle = CIRCUIT_CHARGE_COLORS[
        circuitPortCharge(circuitPortCharges, Direction.Left)
      ];
      context.beginPath();
      context.moveTo(centerX - innerOffset, centerY);
      context.lineTo(centerX, centerY);
      context.stroke();
      context.strokeStyle = CIRCUIT_CHARGE_COLORS[
        circuitPortCharge(circuitPortCharges, Direction.Right)
      ];
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(centerX + innerOffset, centerY);
      context.stroke();
      context.strokeStyle = definition.fill;
      context.lineWidth = traceWidth * 1.75;
      context.beginPath();
      context.moveTo(centerX, centerY - innerOffset);
      context.lineTo(centerX, centerY + innerOffset);
      context.stroke();
      context.lineWidth = traceWidth;
      context.strokeStyle = CIRCUIT_CHARGE_COLORS[
        circuitPortCharge(circuitPortCharges, Direction.Up)
      ];
      context.beginPath();
      context.moveTo(centerX, centerY - innerOffset);
      context.lineTo(centerX, centerY);
      context.stroke();
      context.strokeStyle = CIRCUIT_CHARGE_COLORS[
        circuitPortCharge(circuitPortCharges, Direction.Down)
      ];
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(centerX, centerY + innerOffset);
      context.stroke();
      break;
    }
    case TileDecorationStyle.Delay: {
      const state = componentState?.type === "delay" ? componentState : null;
      const length = state?.length ?? 3;
      const cursor = state?.cursor ?? 0;
      const highlightedCursor = state === null ? cursor : (cursor + length - 1) % length;
      const columns = Math.ceil(Math.sqrt(length));
      const rows = Math.ceil(length / columns);
      const gridWidth = size * 0.5;
      const gridHeight = size * 0.5;
      const spacing = Math.min(gridWidth / columns, gridHeight / rows);
      const startX = left + size / 2 - (columns - 1) * spacing / 2;
      const startY = top + size / 2 - (rows - 1) * spacing / 2;
      const radius = Math.max(1, spacing * 0.22);
      for (let valueIndex = 0; valueIndex < length; valueIndex += 1) {
        const x = startX + (valueIndex % columns) * spacing;
        const y = startY + Math.floor(valueIndex / columns) * spacing;
        const charge = state?.data[valueIndex] ?? 0;
        context.fillStyle = CIRCUIT_CHARGE_COLORS[charge];
        context.beginPath();
        drawDot(context, x, y, radius);
        context.fill();
        if (valueIndex === highlightedCursor) {
          context.strokeStyle = "#f1cc38";
          context.lineWidth = Math.max(1, size * 0.025);
          context.beginPath();
          context.arc(x, y, radius * 1.55, 0, Math.PI * 2);
          context.stroke();
        }
      }
      drawPortArrows(
        context,
        left,
        top,
        size,
        orientation,
        WeldSide.Down,
        WeldSide.Up,
        circuitPortCharges,
      );
      break;
    }
    case TileDecorationStyle.Discard: {
      const state = componentState?.type === "discard" ? componentState : null;
      const remaining = (state?.length ?? DEFAULT_DISCARD_LENGTH) - (state?.discarded ?? 0);
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1, size * 0.04);
      context.lineCap = "round";
      context.lineJoin = "round";
      // A rear shutter blocks incoming ticks, then opens into a forward arrow.
      context.beginPath();
      context.moveTo(-size * 0.24, -size * 0.2);
      context.lineTo(-size * 0.24, size * 0.2);
      context.moveTo(size * 0.24, -size * 0.2);
      context.lineTo(size * 0.24, size * 0.2);
      if (remaining > 0) {
        context.moveTo(-size * 0.24, size * 0.2);
        context.lineTo(size * 0.24, size * 0.2);
        context.moveTo(0, size * 0.2);
        context.lineTo(0, size * 0.29);
      } else {
        context.moveTo(-size * 0.24, size * 0.2);
        context.lineTo(-size * 0.16, size * 0.2);
        context.moveTo(size * 0.16, size * 0.2);
        context.lineTo(size * 0.24, size * 0.2);
      }
      context.stroke();
      if (remaining === 0) {
        context.strokeStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
        context.lineWidth = Math.max(1.5, size * 0.06);
        context.beginPath();
        context.moveTo(0, size * 0.26);
        context.lineTo(0, -size * 0.23);
        context.moveTo(-size * 0.11, -size * 0.1);
        context.lineTo(0, -size * 0.23);
        context.lineTo(size * 0.11, -size * 0.1);
        context.stroke();
      }
      context.restore();
      if (remaining > 0) {
        context.save();
        context.fillStyle = definition.decorationColor;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.font = `700 ${Math.max(7, size * 0.26)}px ui-monospace, monospace`;
        context.fillText(String(remaining), left + size / 2, top + size / 2);
        context.restore();
      }
      drawPortArrows(
        context,
        left,
        top,
        size,
        orientation,
        WeldSide.Down,
        WeldSide.Up,
        circuitPortCharges,
      );
      break;
    }
    case TileDecorationStyle.Counter: {
      const state = componentState?.type === "counter" ? componentState : null;
      context.save();
      context.fillStyle = definition.decorationColor;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = `700 ${Math.max(8, size * 0.31)}px ui-monospace, monospace`;
      context.fillText(String(state?.count ?? 0), left + size / 2, top + size * 0.48);
      context.globalAlpha = 0.72;
      context.font = `600 ${Math.max(5, size * 0.12)}px ui-monospace, monospace`;
      context.fillText(
        `/ ${state?.threshold ?? 4}`,
        left + size / 2,
        top + size * 0.7,
      );
      context.restore();
      drawPortArrows(
        context,
        left,
        top,
        size,
        orientation,
        WeldSide.Down,
        WeldSide.Up,
        circuitPortCharges,
      );
      break;
    }
    case TileDecorationStyle.Rom:
    case TileDecorationStyle.Lut: {
      const isLut = definition.decorationStyle === TileDecorationStyle.Lut;
      const state = componentState?.type === "lut" || componentState?.type === "rom"
        ? componentState : null;
      const width = state?.width ?? 3;
      const height = state?.height ?? 3;
      const gridSize = size * 0.52;
      const cellSize = Math.min(gridSize / width, gridSize / height);
      const gridLeft = left + size / 2 - width * cellSize / 2;
      const gridTop = top + size / 2 - height * cellSize / 2;
      const inset = Math.max(0.5, cellSize * 0.08);
      for (let valueIndex = 0; valueIndex < width * height; valueIndex += 1) {
        const charge = state?.values[valueIndex] ?? 0;
        const x = gridLeft + (valueIndex % width) * cellSize;
        const y = gridTop + Math.floor(valueIndex / width) * cellSize;
        context.fillStyle = charge === 0 ? (isLut ? "#102e2a" : "#2b1838") : CIRCUIT_CHARGE_COLORS[charge];
        context.fillRect(
          x + inset,
          y + inset,
          Math.max(1, cellSize - inset * 2),
          Math.max(1, cellSize - inset * 2),
        );
        if (!isLut && valueIndex === (state?.type === "rom" ? state.cursor : 0)) {
          context.strokeStyle = "#f1cc38";
          context.lineWidth = Math.max(1, size * 0.025);
          context.strokeRect(
            x + inset / 2,
            y + inset / 2,
            Math.max(1, cellSize - inset),
            Math.max(1, cellSize - inset),
          );
        }
      }
      if (isLut) {
        context.strokeStyle = definition.decorationColor;
        context.lineWidth = Math.max(1, size * 0.025);
        context.strokeRect(gridLeft, gridTop, width * cellSize, height * cellSize);
      }
      drawPortArrows(
        context,
        left,
        top,
        size,
        orientation,
        WeldSide.Left | WeldSide.Down,
        isLut ? WeldSide.Up | WeldSide.Right : WeldSide.None,
        circuitPortCharges,
      );
      break;
    }
    case TileDecorationStyle.RuneArray: {
      drawRuneArrayGlyph(context, left, top, size, definition, nestedWorld);
      break;
    }
    case TileDecorationStyle.Checker: {
      const state = componentState?.type === "checker" ? componentState : null;
      const width = state?.width ?? 3;
      const height = state?.height ?? 3;
      const valueCount = width * height;
      const cursor = state?.cursor ?? 0;
      const failed = state?.failed ?? false;
      const gridSize = size * 0.46;
      const cellSize = Math.min(gridSize / width, gridSize / height);
      const gridLeft = left + size / 2 - width * cellSize / 2;
      const gridTop = top + size * 0.46 - height * cellSize / 2;
      const inset = Math.max(0.5, cellSize * 0.08);
      for (let valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
        const charge = state?.values[valueIndex] ?? 0;
        const x = gridLeft + (valueIndex % width) * cellSize;
        const y = gridTop + Math.floor(valueIndex / width) * cellSize;
        context.fillStyle = charge === 0 ? "#3a2c1a" : CIRCUIT_CHARGE_COLORS[charge];
        context.globalAlpha = valueIndex < cursor && !failed ? 0.45 : 1;
        context.fillRect(
          x + inset,
          y + inset,
          Math.max(1, cellSize - inset * 2),
          Math.max(1, cellSize - inset * 2),
        );
        context.globalAlpha = 1;
        if (valueIndex === cursor) {
          context.strokeStyle = failed ? CIRCUIT_CHARGE_COLORS[-1] : "#f1cc38";
          context.lineWidth = Math.max(1, size * 0.025);
          context.strokeRect(
            x + inset / 2,
            y + inset / 2,
            Math.max(1, cellSize - inset),
            Math.max(1, cellSize - inset),
          );
        }
      }
      // Verdict badge below the grid: a check mark once passed, a cross once failed.
      const badgeY = top + size * 0.8;
      const badgeSize = size * 0.07;
      context.save();
      context.lineWidth = Math.max(1, size * 0.04);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = outputCharge === 0 ? definition.decorationColor : CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      if (outputCharge === -1) {
        context.moveTo(left + size / 2 - badgeSize, badgeY - badgeSize);
        context.lineTo(left + size / 2 + badgeSize, badgeY + badgeSize);
        context.moveTo(left + size / 2 + badgeSize, badgeY - badgeSize);
        context.lineTo(left + size / 2 - badgeSize, badgeY + badgeSize);
      } else {
        context.globalAlpha = outputCharge === 1 ? 1 : 0.55;
        context.moveTo(left + size / 2 - badgeSize * 1.3, badgeY);
        context.lineTo(left + size / 2 - badgeSize * 0.3, badgeY + badgeSize);
        context.lineTo(left + size / 2 + badgeSize * 1.4, badgeY - badgeSize);
      }
      context.stroke();
      context.restore();
      drawPortArrows(
        context,
        left,
        top,
        size,
        orientation,
        WeldSide.Down,
        WeldSide.Up,
        definition.decorationColor,
      );
      break;
    }
    case TileDecorationStyle.Monitor: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.lineWidth = Math.max(1.5, size * 0.05);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.fillStyle = "#141821";
      context.fillRect(-size * 0.24, -size * 0.19, size * 0.48, size * 0.38);
      context.strokeStyle = definition.decorationColor;
      context.strokeRect(-size * 0.24, -size * 0.19, size * 0.48, size * 0.38);
      context.strokeStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      context.moveTo(-size * 0.18, size * 0.08);
      context.lineTo(-size * 0.09, size * 0.08);
      context.lineTo(-size * 0.09, -size * 0.08);
      context.lineTo(size * 0.03, -size * 0.08);
      context.lineTo(size * 0.03, size * 0.08);
      context.lineTo(size * 0.18, size * 0.08);
      context.stroke();
      context.restore();
      break;
    }
    case TileDecorationStyle.Grapher: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1.5, size * 0.05);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = definition.decorationColor;
      drawPortArrows(context, -size / 2, -size / 2, size, Direction.Up,
        WeldSide.None, WeldSide.Up, definition.decorationColor);
      const barHeights = [0.14, 0.26, 0.08, 0.2];
      const barWidth = size * 0.08;
      const gap = size * 0.04;
      const totalWidth = barHeights.length * barWidth + (barHeights.length - 1) * gap;
      const baseline = size * 0.2;
      context.fillStyle = definition.decorationColor;
      for (let bar = 0; bar < barHeights.length; bar += 1) {
        const barHeight = size * expectDefined(barHeights[bar], "grapher bar height");
        context.fillRect(
          -totalWidth / 2 + bar * (barWidth + gap),
          baseline - barHeight,
          barWidth,
          barHeight,
        );
      }
      context.strokeStyle = "#1c2528";
      context.lineWidth = Math.max(1, size * 0.03);
      context.beginPath();
      context.moveTo(-size * 0.28, baseline);
      context.lineTo(size * 0.28, baseline);
      context.stroke();
      context.restore();
      break;
    }
    case TileDecorationStyle.Piston:
    case TileDecorationStyle.PistonBase:
    case TileDecorationStyle.PistonArm: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      const isCombined = definition.decorationStyle === TileDecorationStyle.Piston;
      const isBase = definition.decorationStyle === TileDecorationStyle.PistonBase;
      const headOffset = isCombined && pistonTransition === -1
        ? -size * (1 - pistonTransitionProgress)
        : 0;
      if (isCombined || isBase) {
        context.fillStyle = "#3a3028";
        context.fillRect(-size * 0.3, -size * 0.02, size * 0.6, size * 0.32);
        context.strokeStyle = definition.decorationColor;
        context.lineWidth = Math.max(1.5, size * 0.055);
        context.strokeRect(-size * 0.3, -size * 0.02, size * 0.6, size * 0.32);
      }
      context.strokeStyle = definition.decorationColor;
      context.lineCap = "round";
      context.lineWidth = Math.max(2, size * 0.12);
      context.beginPath();
      if (isBase) {
        const extension = pistonTransition === 1 ? pistonTransitionProgress : 1;
        context.moveTo(0, size * 0.03);
        context.lineTo(0, -size * (0.43 * extension));
      } else if (isCombined) {
        context.moveTo(0, size * 0.03);
        context.lineTo(0, -size * 0.2 + headOffset);
      } else {
        // The arm slab follows the head. Its shaft ends at the moving base
        // anchor until there is room for the full shaft ahead of that base.
        const extension = pistonTransition === 1 ? pistonTransitionProgress : 1;
        context.moveTo(0, size * Math.min(0.43, 0.03 + extension));
        context.lineTo(0, -size * 0.25);
      }
      context.stroke();
      if (!isBase) {
        context.translate(0, headOffset);
        context.fillStyle = "#d1aa6b";
        context.fillRect(-size * 0.25, -size * 0.32, size * 0.5, size * 0.14);
        context.strokeStyle = "#4b3828";
        context.lineWidth = Math.max(1, size * 0.035);
        context.strokeRect(-size * 0.25, -size * 0.32, size * 0.5, size * 0.14);
      }
      context.restore();
      break;
    }
    case TileDecorationStyle.None:
      break;
  }
}

/**
 * Miniature map of a rune array's inner board: a dark panel with one cell per inner tile,
 * occupied cells filled with their tile color, and notches marking the four side ports.
 * Without an inner board (palette previews) it shows the default empty 5x5 grid.
 */
function drawRuneArrayGlyph(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  definition: TileDefinition,
  nestedWorld: World | null,
): void {
  const width = nestedWorld?.width ?? 5;
  const height = nestedWorld?.height ?? 5;
  const panelSize = size * 0.6;
  const panelLeft = left + (size - panelSize) / 2;
  const panelTop = top + (size - panelSize) / 2;
  context.fillStyle = "#10131f";
  context.fillRect(panelLeft, panelTop, panelSize, panelSize);

  const cellSize = panelSize / Math.max(width, height);
  const gridLeft = panelLeft + (panelSize - width * cellSize) / 2;
  const gridTop = panelTop + (panelSize - height * cellSize) / 2;
  const inset = Math.max(0.35, cellSize * 0.12);
  if (nestedWorld !== null) {
    for (let index = 0; index < nestedWorld.cellCount; index += 1) {
      const kind = nestedWorld.kindAtIndex(index);
      if (kind === TileKind.Empty) {
        continue;
      }
      const x = gridLeft + (index % width) * cellSize;
      const y = gridTop + Math.floor(index / width) * cellSize;
      context.fillStyle = TILE_DEFINITIONS[kind].fill;
      context.fillRect(
        x + inset,
        y + inset,
        Math.max(1, cellSize - inset * 2),
        Math.max(1, cellSize - inset * 2),
      );
    }
  }
  if (cellSize >= 4) {
    context.strokeStyle = "rgb(199 211 244 / 14%)";
    context.lineWidth = 1;
    context.beginPath();
    for (let column = 1; column < width; column += 1) {
      const x = Math.round(gridLeft + column * cellSize) + 0.5;
      context.moveTo(x, gridTop);
      context.lineTo(x, gridTop + height * cellSize);
    }
    for (let row = 1; row < height; row += 1) {
      const y = Math.round(gridTop + row * cellSize) + 0.5;
      context.moveTo(gridLeft, y);
      context.lineTo(gridLeft + width * cellSize, y);
    }
    context.stroke();
  }

  context.fillStyle = definition.decorationColor;
  const notch = Math.max(1.5, size * 0.07);
  for (let value = Direction.Up; value <= Direction.Left; value += 1) {
    const side = value as Direction;
    const portIndex = runeArrayPortCellIndex(width, height, side);
    const centerX = gridLeft + ((portIndex % width) + 0.5) * cellSize;
    const centerY = gridTop + (Math.floor(portIndex / width) + 0.5) * cellSize;
    const edgeX = side === Direction.Left
      ? panelLeft
      : side === Direction.Right
        ? panelLeft + panelSize
        : centerX;
    const edgeY = side === Direction.Up
      ? panelTop
      : side === Direction.Down
        ? panelTop + panelSize
        : centerY;
    context.fillRect(edgeX - notch / 2, edgeY - notch / 2, notch, notch);
  }
  context.strokeStyle = definition.decorationColor;
  context.lineWidth = Math.max(1, size * 0.03);
  context.strokeRect(panelLeft + 0.5, panelTop + 0.5, panelSize - 1, panelSize - 1);
}

function drawCircuitConnections(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  connections: WeldSide,
  portCharges: number,
  isolatedPorts: WeldSide,
  innerOffsetRatio: number,
  outputArrowPorts: WeldSide,
): void {
  const centerX = left + size / 2;
  const centerY = top + size / 2;
  context.lineWidth = Math.max(2, size * 0.12);
  context.lineCap = "round";

  for (let chargeValue = -1; chargeValue <= 1; chargeValue += 1) {
    const charge = chargeValue as Charge;
    let hasCharge = false;
    context.beginPath();
    for (let value = Direction.Up; value <= Direction.Left; value += 1) {
      const direction = value as Direction;
      if (
        (connections & (1 << direction)) === 0 ||
        circuitPortCharge(portCharges, direction) !== charge
      ) {
        continue;
      }

      const offsetX = directionX(direction);
      const offsetY = directionY(direction);
      if ((isolatedPorts & (1 << direction)) !== 0) {
        // Stop the rounded trace cap in the outward caret's tip, not behind its wings.
        const innerOffset = (outputArrowPorts & (1 << direction)) !== 0
          ? Math.min(size / 2, size * 0.37 + context.lineWidth / 2)
          : size * innerOffsetRatio;
        context.moveTo(
          centerX + offsetX * size / 2,
          centerY + offsetY * size / 2,
        );
        context.lineTo(
          centerX + offsetX * innerOffset,
          centerY + offsetY * innerOffset,
        );
      } else {
        context.moveTo(centerX, centerY);
        context.lineTo(
          centerX + offsetX * size / 2,
          centerY + offsetY * size / 2,
        );
      }
      hasCharge = true;
    }
    if (hasCharge) {
      context.strokeStyle = CIRCUIT_CHARGE_COLORS[charge];
      context.stroke();
    }
  }
}

function drawPortArrows(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  orientation: Direction,
  inputSides: WeldSide,
  outputSides: WeldSide,
  color: string | number,
): void {
  context.save();
  context.translate(left + size / 2, top + size / 2);
  context.rotate(orientation * Math.PI / 2);
  // Packed charges use absolute board directions; arrow masks are tile-relative.
  context.lineWidth = Math.max(1.5, size * 0.05);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (let value = Direction.Up; value <= Direction.Left; value += 1) {
    const direction = value as Direction;
    const side = 1 << direction;
    if ((inputSides & side) === 0 && (outputSides & side) === 0) {
      continue;
    }
    context.strokeStyle = typeof color === "string"
      ? color
      : CIRCUIT_CHARGE_COLORS[circuitPortCharge(
        color, ((orientation + direction) & 3) as Direction,
      )];
    context.beginPath();
    const sideX = directionX(direction);
    const sideY = directionY(direction);
    const flowSign = (outputSides & side) !== 0 ? 1 : -1;
    const flowX = sideX * flowSign;
    const flowY = sideY * flowSign;
    const centerX = sideX * size * 0.37;
    const centerY = sideY * size * 0.37;
    const tipX = centerX + flowX * size * 0.05;
    const tipY = centerY + flowY * size * 0.05;
    const baseX = tipX - flowX * size * 0.1;
    const baseY = tipY - flowY * size * 0.1;
    const wingX = -flowY * size * 0.1;
    const wingY = flowX * size * 0.1;
    context.moveTo(baseX + wingX, baseY + wingY);
    context.lineTo(tipX, tipY);
    context.lineTo(baseX - wingX, baseY - wingY);
    context.stroke();
  }
  context.restore();
}

/** Adds one filled circle to the current path without a connecting chord from the previous subpath. */
function drawDot(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  context.moveTo(centerX + radius, centerY);
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
}
