export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export interface GridCell {
  readonly x: number;
  readonly y: number;
}

export interface GridEdge {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface GridCellSegment {
  readonly from: GridCell;
  readonly to: GridCell;
}

type EdgeVisitor = (x1: number, y1: number, x2: number, y2: number) => void;

interface ClippedSegment {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}
export function clampedCellFromGridPoint(
  point: GridPoint,
  width: number,
  height: number,
): GridCell {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new RangeError("Grid dimensions must be positive integers");
  }
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor(point.x))),
    y: Math.max(0, Math.min(height - 1, Math.floor(point.y))),
  };
}


export function cellsOnGridSegment(
  from: GridPoint,
  to: GridPoint,
  width: number,
  height: number,
): GridCellSegment | null {
  const segment = clipToGrid(from, to, width, height);
  if (segment === null) {
    return null;
  }

  return {
    from: cellAtClippedPoint(segment.fromX, segment.fromY, width, height),
    to: cellAtClippedPoint(segment.toX, segment.toY, width, height),
  };
}

// Grid-space half-size of the square target centered on each weldable edge.
export const WELD_HIT_RADIUS = 0.3;

export function visitWeldEdgesOnGridSegment(
  from: GridPoint,
  to: GridPoint,
  width: number,
  height: number,
  visit: EdgeVisitor,
): void {
  const segment = clipToGrid(from, to, width, height);
  if (segment === null) return;

  visitWeldStrips(
    segment.fromX, segment.fromY, segment.toX, segment.toY,
    width, height, false, visit,
  );
  visitWeldStrips(
    segment.fromY, segment.fromX, segment.toY, segment.toX,
    height, width, true, visit,
  );
}

/** Clip to each edge's normal band, then visit midpoint targets along that band. */
function visitWeldStrips(
  fromNormal: number,
  fromAlong: number,
  toNormal: number,
  toAlong: number,
  normalSize: number,
  alongSize: number,
  horizontal: boolean,
  visit: EdgeVisitor,
): void {
  const deltaNormal = toNormal - fromNormal;
  const deltaAlong = toAlong - fromAlong;
  const first = Math.max(1, Math.ceil(Math.min(fromNormal, toNormal) - WELD_HIT_RADIUS));
  const last = Math.min(normalSize - 1, Math.floor(Math.max(fromNormal, toNormal) + WELD_HIT_RADIUS));
  const step = deltaNormal < 0 ? -1 : 1;
  for (let line = step > 0 ? first : last; line >= first && line <= last; line += step) {
    let start = 0;
    let end = 1;
    if (deltaNormal !== 0) {
      const enter = (line - WELD_HIT_RADIUS - fromNormal) / deltaNormal;
      const leave = (line + WELD_HIT_RADIUS - fromNormal) / deltaNormal;
      start = Math.max(0, Math.min(enter, leave));
      end = Math.min(1, Math.max(enter, leave));
      if (start > end) continue;
    }
    const alongStart = fromAlong + deltaAlong * start;
    const alongEnd = fromAlong + deltaAlong * end;
    const firstCell = Math.max(
      0, Math.ceil(Math.min(alongStart, alongEnd) - 0.5 - WELD_HIT_RADIUS),
    );
    const lastCell = Math.min(
      alongSize - 1, Math.floor(Math.max(alongStart, alongEnd) - 0.5 + WELD_HIT_RADIUS),
    );
    const alongStep = deltaAlong < 0 ? -1 : 1;
    for (
      let cell = alongStep > 0 ? firstCell : lastCell;
      cell >= firstCell && cell <= lastCell;
      cell += alongStep
    ) {
      if (horizontal) visit(cell, line - 1, cell, line);
      else visit(line - 1, cell, line, cell);
    }
  }
}

function clipToGrid(
  from: GridPoint,
  to: GridPoint,
  width: number,
  height: number,
): ClippedSegment | null {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  let start = 0;
  let end = 1;

  if (deltaX === 0) {
    if (from.x < 0 || from.x > width) {
      return null;
    }
  } else {
    const atLeft = -from.x / deltaX;
    const atRight = (width - from.x) / deltaX;
    start = Math.max(start, Math.min(atLeft, atRight));
    end = Math.min(end, Math.max(atLeft, atRight));
  }

  if (deltaY === 0) {
    if (from.y < 0 || from.y > height) {
      return null;
    }
  } else {
    const atTop = -from.y / deltaY;
    const atBottom = (height - from.y) / deltaY;
    start = Math.max(start, Math.min(atTop, atBottom));
    end = Math.min(end, Math.max(atTop, atBottom));
  }

  if (start > end) {
    return null;
  }

  return {
    fromX: from.x + deltaX * start,
    fromY: from.y + deltaY * start,
    toX: from.x + deltaX * end,
    toY: from.y + deltaY * end,
  };
}

function cellAtClippedPoint(x: number, y: number, width: number, height: number): GridCell {
  return {
    x: Math.min(Math.floor(x), width - 1),
    y: Math.min(Math.floor(y), height - 1),
  };
}
