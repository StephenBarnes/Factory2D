import {
  Direction,
  directionX,
  directionY,
  TILE_DEFINITIONS,
  TileDecorationStyle,
  type TileDefinition,
  type TileKind,
} from "../simulation/tile";
import { expectDefined } from "../util/assert";

/** One cell of a rendered body, in grid coordinates. */
export interface BodyCell {
  x: number;
  y: number;
  kind: TileKind;
  orientation: Direction;
  /** The right neighbor belongs to the same body but this edge is not welded. */
  seamRight: boolean;
  /** The down neighbor belongs to the same body but this edge is not welded. */
  seamDown: boolean;
}

/** Corner rounding radius for convex corners and concave weld fillets. */
const CORNER_RADIUS_RATIO = 0.2;
/** Gap between a body outline and its cell boundary, so unwelded neighbors stay visually separate. */
const INSET_RATIO = 0.05;
/** Thickness of the top-left highlight and bottom-right shade bands. */
const BEVEL_RATIO = 0.12;
/** Thickness of the dark rim around a body. */
const OUTLINE_RATIO = 0.055;
const DROP_SHADOW_X_RATIO = 0.05;
const DROP_SHADOW_Y_RATIO = 0.1;
/** Thickness of the groove marking an unwelded edge interior to a body. */
const SEAM_RATIO = 0.08;

const HIGHLIGHT_STYLE = "rgba(255, 255, 255, 0.25)";
const SHADE_STYLE = "rgba(0, 0, 0, 0.28)";
const DROP_SHADOW_STYLE = "rgba(0, 0, 0, 0.35)";
const SEAM_STYLE = "rgba(0, 0, 0, 0.4)";
const MIXED_BODY_OUTLINE_STYLE = "#161d26";

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
 * Draws one welded body as a single rounded polyomino slab: drop shadow, per-cell
 * fill and decorations clipped to the outline, top-left/bottom-right bevel
 * lighting, dark grooves along unwelded interior edges, and a dark rim.
 */
export function drawBody(
  context: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  cellSize: number,
  cells: readonly BodyCell[],
  cellCount: number = cells.length,
): void {
  if (cellCount === 0) {
    return;
  }
  const firstCell = expectDefined(cells[0], "first body cell");

  const firstDefinition = TILE_DEFINITIONS[firstCell.kind];
  let uniformKind = true;
  for (let i = 1; i < cellCount; i += 1) {
    if (expectDefined(cells[i], "body cell").kind !== firstCell.kind) {
      uniformKind = false;
      break;
    }
  }

  const path = buildBodyOutline(originX, originY, cellSize, cells, cellCount);

  context.save();
  context.translate(cellSize * DROP_SHADOW_X_RATIO, cellSize * DROP_SHADOW_Y_RATIO);
  context.fillStyle = DROP_SHADOW_STYLE;
  context.fill(path);
  context.restore();

  context.save();
  context.clip(path);
  context.fillStyle = firstDefinition.fill;
  context.fill(path);
  if (!uniformKind) {
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
  for (let i = 0; i < cellCount; i += 1) {
    const cell = expectDefined(cells[i], "body cell");
    drawDecoration(
      context,
      originX + cell.x * cellSize,
      originY + cell.y * cellSize,
      cellSize,
      TILE_DEFINITIONS[cell.kind],
      cell.orientation,
    );
  }

  const bevel = Math.max(1.5, cellSize * BEVEL_RATIO);
  context.lineWidth = bevel * 2;
  context.translate(bevel, bevel);
  context.strokeStyle = HIGHLIGHT_STYLE;
  context.stroke(path);
  context.translate(-2 * bevel, -2 * bevel);
  context.strokeStyle = SHADE_STYLE;
  context.stroke(path);

  context.lineCap = "butt";
  context.strokeStyle = SEAM_STYLE;
  context.lineWidth = Math.max(1.5, cellSize * SEAM_RATIO);
  context.beginPath();
  for (let i = 0; i < cellCount; i += 1) {
    const cell = expectDefined(cells[i], "body cell");
    if (cell.seamRight) {
      context.moveTo(originX + (cell.x + 1) * cellSize, originY + cell.y * cellSize);
      context.lineTo(originX + (cell.x + 1) * cellSize, originY + (cell.y + 1) * cellSize);
    }
    if (cell.seamDown) {
      context.moveTo(originX + cell.x * cellSize, originY + (cell.y + 1) * cellSize);
      context.lineTo(originX + (cell.x + 1) * cellSize, originY + (cell.y + 1) * cellSize);
    }
  }
  context.stroke();
  context.restore();

  context.strokeStyle = uniformKind ? firstDefinition.shadow : MIXED_BODY_OUTLINE_STYLE;
  context.lineWidth = Math.max(1, cellSize * OUTLINE_RATIO);
  context.stroke(path);
}

const SINGLE_CELL: [BodyCell] = [
  { x: 0, y: 0, kind: 0 as TileKind, orientation: Direction.Up, seamRight: false, seamDown: false },
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
 * Traces the boundary of a polyomino cell set into a rounded outline path.
 *
 * Boundary edges are directed so the body interior lies to their right, which
 * makes outer loops wind clockwise and hole loops counterclockwise; nonzero
 * winding then fills holes correctly. Edges are inset toward the interior so
 * separate bodies never touch, and every corner is rounded with `arcTo`, which
 * yields convex rounding and concave weld fillets from the same construction.
 */
function buildBodyOutline(
  originX: number,
  originY: number,
  cellSize: number,
  cells: readonly BodyCell[],
  cellCount: number,
): Path2D {
  const occupied = new Set<number>();
  for (let i = 0; i < cellCount; i += 1) {
    const cell = expectDefined(cells[i], "body cell");
    occupied.add(pointKey(cell.x, cell.y));
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
    const { x, y } = expectDefined(cells[i], "body cell");
    if (!occupied.has(pointKey(x, y - 1))) {
      addEdge(x, y, Direction.Right);
    }
    if (!occupied.has(pointKey(x + 1, y))) {
      addEdge(x + 1, y, Direction.Down);
    }
    if (!occupied.has(pointKey(x, y + 1))) {
      addEdge(x + 1, y + 1, Direction.Left);
    }
    if (!occupied.has(pointKey(x - 1, y))) {
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
      const next = takeNextEdge(edgesByVertex, vertexX, vertexY, edge.direction, firstEdge);
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
 * Picks the boundary edge continuing from a vertex. Where two body cells touch
 * only diagonally, four edges meet at one vertex; preferring the clockwise
 * (interior-hugging) turn keeps the contour from crossing itself and renders
 * the diagonal contact as two rounded corners meeting in a pinch.
 */
function takeNextEdge(
  edgesByVertex: ReadonlyMap<number, readonly BoundaryEdge[]>,
  vertexX: number,
  vertexY: number,
  incomingDirection: Direction,
  firstEdge: BoundaryEdge,
): BoundaryEdge {
  const candidates = edgesByVertex.get(pointKey(vertexX, vertexY));
  if (candidates === undefined) {
    throw new Error("Body outline is not closed");
  }
  const preferredDirection = rotateClockwise(incomingDirection);
  let fallback: BoundaryEdge | null = null;
  for (const candidate of candidates) {
    if (candidate.used && candidate !== firstEdge) {
      continue;
    }
    if (candidate.direction === preferredDirection) {
      return candidate;
    }
    fallback = candidate;
  }
  if (fallback === null) {
    throw new Error("Body outline is not closed");
  }
  return fallback;
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
  corners.push({
    x: originX + vertexX * cellSize +
      (directionX(inwardIncoming) + directionX(inwardOutgoing)) * inset,
    y: originY + vertexY * cellSize +
      (directionY(inwardIncoming) + directionY(inwardOutgoing)) * inset,
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
): void {
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
    case TileDecorationStyle.None:
      break;
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
