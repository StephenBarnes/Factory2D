import { CIRCUIT_CHARGE_COLORS, type Charge } from "../simulation/circuit";
import {
  Direction,
  directionX,
  directionY,
  TILE_DEFINITIONS,
  TileDecorationStyle,
  type TileDefinition,
  WeldSide,
  type TileKind,
} from "../simulation/tile";
import { expectDefined } from "../util/assert";

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
  /** The right neighbor belongs to the same body but this edge is not welded. */
  seamRight: boolean;
  /** The down neighbor belongs to the same body but this edge is not welded. */
  seamDown: boolean;
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
const DROP_SHADOW_X_RATIO = 0.05;
const DROP_SHADOW_Y_RATIO = 0.1;

const HIGHLIGHT_STYLE = "rgba(255, 255, 255, 0.25)";
const SHADE_STYLE = "rgba(0, 0, 0, 0.28)";
const DROP_SHADOW_STYLE = "rgba(0, 0, 0, 0.35)";

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
  path?: Path2D,
): void {
  if (cellCount === 0) {
    return;
  }
  const bodyPath = path ?? createBodyPath(originX, originY, cellSize, cells, cellCount);


  context.save();
  context.translate(cellSize * DROP_SHADOW_X_RATIO, cellSize * DROP_SHADOW_Y_RATIO);
  context.fillStyle = DROP_SHADOW_STYLE;
  context.fill(bodyPath);
  context.restore();

  context.save();
  context.clip(bodyPath);
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
  for (let i = 0; i < cellCount; i += 1) {
    const cell = expectDefined(cells[i], "body cell");
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
    );
  }

  const bevel = Math.max(1.5, cellSize * BEVEL_RATIO);
  context.lineWidth = bevel * 2;
  context.translate(bevel, bevel);
  context.strokeStyle = HIGHLIGHT_STYLE;
  context.stroke(bodyPath);
  context.translate(-2 * bevel, -2 * bevel);
  context.strokeStyle = SHADE_STYLE;
  context.stroke(bodyPath);

  context.restore();

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
    seamRight: false,
    seamDown: false,
  },
];

/** Draws a lone tile (palette previews and placement hover). */
export function drawTile(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  kind: TileKind,
  orientation: Direction = Direction.Up,
): void {
  SINGLE_CELL[0].kind = kind;
  SINGLE_CELL[0].orientation = orientation;
  drawBody(context, left, top, size, SINGLE_CELL, 1);
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
): void {
  if (circuitConnections !== WeldSide.None) {
    drawCircuitConnections(
      context,
      left,
      top,
      size,
      circuitConnections,
      circuitPortCharges,
      definition.circuitInputPorts !== WeldSide.None,
    );
  }
  context.fillStyle = definition.decorationColor;
  context.strokeStyle = definition.decorationColor;

  switch (definition.decorationStyle) {
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
    case TileDecorationStyle.Metal: {
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
    case TileDecorationStyle.Conduit:
      context.beginPath();
      drawDot(context, left + size / 2, top + size / 2, Math.max(2, size * 0.19));
      context.fill();
      context.strokeStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.lineWidth = Math.max(1, size * 0.045);
      context.stroke();
      break;
    case TileDecorationStyle.Sensor:
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.fillStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      context.moveTo(0, -size * 0.34);
      context.lineTo(size * 0.14, -size * 0.12);
      context.lineTo(-size * 0.14, -size * 0.12);
      context.closePath();
      context.fill();
      context.fillStyle = definition.decorationColor;
      context.beginPath();
      context.moveTo(0, -size * 0.14);
      context.lineTo(size * 0.17, 0);
      context.lineTo(0, size * 0.17);
      context.lineTo(-size * 0.17, 0);
      context.closePath();
      context.fill();
      context.restore();
      break;
    case TileDecorationStyle.Inverter: {
      context.save();
      context.translate(left + size / 2, top + size / 2);
      context.rotate(orientation * Math.PI / 2);
      context.lineWidth = Math.max(1.5, size * 0.055);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(-size * 0.2, size * 0.16);
      context.lineTo(0, -size * 0.17);
      context.lineTo(size * 0.2, size * 0.16);
      context.closePath();
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
      context.moveTo(-size * 0.18, size * 0.12);
      context.lineTo(0, -size * 0.11);
      context.lineTo(size * 0.18, size * 0.12);
      context.moveTo(-size * 0.18, -size * 0.18);
      context.lineTo(size * 0.18, -size * 0.18);
      context.stroke();
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
      context.moveTo(-size * 0.11, 0);
      context.lineTo(size * 0.11, 0);
      context.moveTo(0, -size * 0.11);
      context.lineTo(0, size * 0.11);
      context.stroke();
      context.strokeStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      context.moveTo(-size * 0.14, -size * 0.14);
      context.lineTo(0, -size * 0.22);
      context.lineTo(size * 0.14, -size * 0.14);
      context.stroke();
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
      context.moveTo(-size * 0.1, -size * 0.1);
      context.lineTo(size * 0.1, size * 0.1);
      context.moveTo(size * 0.1, -size * 0.1);
      context.lineTo(-size * 0.1, size * 0.1);
      context.stroke();
      context.strokeStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      context.moveTo(-size * 0.14, -size * 0.14);
      context.lineTo(0, -size * 0.22);
      context.lineTo(size * 0.14, -size * 0.14);
      context.stroke();
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
      context.moveTo(-size * 0.12, 0);
      context.lineTo(size * 0.12, 0);
      context.stroke();
      context.strokeStyle = CIRCUIT_CHARGE_COLORS[outputCharge];
      context.beginPath();
      context.moveTo(-size * 0.14, -size * 0.14);
      context.lineTo(0, -size * 0.22);
      context.lineTo(size * 0.14, -size * 0.14);
      context.stroke();
      context.restore();
      break;
    }
    case TileDecorationStyle.None:
      break;
  }
}

function drawCircuitConnections(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  connections: WeldSide,
  portCharges: number,
  isolatePorts: boolean,
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
      if (isolatePorts) {
        context.moveTo(
          centerX + offsetX * size / 2,
          centerY + offsetY * size / 2,
        );
        context.lineTo(
          centerX + offsetX * size * 0.26,
          centerY + offsetY * size * 0.26,
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
