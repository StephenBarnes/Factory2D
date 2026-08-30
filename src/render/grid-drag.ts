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

export function visitCrossedGridEdges(
  from: GridPoint,
  to: GridPoint,
  width: number,
  height: number,
  visit: EdgeVisitor,
): void {
  const segment = clipToGrid(from, to, width, height);
  if (segment === null) {
    return;
  }

  const deltaX = segment.toX - segment.fromX;
  const deltaY = segment.toY - segment.fromY;
  if (deltaX === 0 && Number.isInteger(segment.fromX)) {
    const line = segment.fromX;
    if (line > 0 && line < width) {
      const firstRow = Math.max(0, Math.floor(Math.min(segment.fromY, segment.toY)));
      const lastRow = Math.min(
        height - 1,
        Math.ceil(Math.max(segment.fromY, segment.toY)) - 1,
      );
      for (let row = firstRow; row <= lastRow; row += 1) {
        visit(line - 1, row, line, row);
      }
    }
    return;
  }

  if (deltaY === 0 && Number.isInteger(segment.fromY)) {
    const line = segment.fromY;
    if (line > 0 && line < height) {
      const firstColumn = Math.max(0, Math.floor(Math.min(segment.fromX, segment.toX)));
      const lastColumn = Math.min(
        width - 1,
        Math.ceil(Math.max(segment.fromX, segment.toX)) - 1,
      );
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        visit(column, line - 1, column, line);
      }
    }
    return;
  }

  if (deltaX !== 0) {
    const firstLine = deltaX > 0 ? Math.floor(segment.fromX) + 1 : Math.ceil(segment.fromX) - 1;
    const lastLine = deltaX > 0 ? Math.ceil(segment.toX) - 1 : Math.floor(segment.toX) + 1;
    const step = deltaX > 0 ? 1 : -1;
    for (let x = firstLine; deltaX > 0 ? x <= lastLine : x >= lastLine; x += step) {
      if (x <= 0 || x >= width) {
        continue;
      }
      const progress = (x - segment.fromX) / deltaX;
      const y = segment.fromY + deltaY * progress;
      if (y >= 0 && y < height) {
        const row = Math.floor(y);
        visit(x - 1, row, x, row);
      }
    }
  }

  if (deltaY !== 0) {
    const firstLine = deltaY > 0 ? Math.floor(segment.fromY) + 1 : Math.ceil(segment.fromY) - 1;
    const lastLine = deltaY > 0 ? Math.ceil(segment.toY) - 1 : Math.floor(segment.toY) + 1;
    const step = deltaY > 0 ? 1 : -1;
    for (let y = firstLine; deltaY > 0 ? y <= lastLine : y >= lastLine; y += step) {
      if (y <= 0 || y >= height) {
        continue;
      }
      const progress = (y - segment.fromY) / deltaY;
      const x = segment.fromX + deltaX * progress;
      if (x >= 0 && x < width) {
        const column = Math.floor(x);
        visit(column, y - 1, column, y);
      }
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
