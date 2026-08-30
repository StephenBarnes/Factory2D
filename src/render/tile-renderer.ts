import {
  Direction,
  TILE_DEFINITIONS,
  TileDecorationStyle,
  type TileKind,
} from "../simulation/tile";

export const enum InnerCorner {
  None = 0,
  UpLeft = 1,
  UpRight = 2,
  DownRight = 4,
  DownLeft = 8,
}

export function drawTile(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  kind: TileKind,
  orientation: Direction = Direction.Up,
  joinedSides = 0,
  innerCorners = InnerCorner.None,
): void {
  const definition = TILE_DEFINITIONS[kind];
  const joinedUp = (joinedSides & (1 << Direction.Up)) !== 0;
  const joinedRight = (joinedSides & (1 << Direction.Right)) !== 0;
  const joinedDown = (joinedSides & (1 << Direction.Down)) !== 0;
  const joinedLeft = (joinedSides & (1 << Direction.Left)) !== 0;
  const tileLeft = left + (joinedLeft ? 0 : 2);
  const tileTop = top + (joinedUp ? 0 : 2);
  const tileRight = left + size - (joinedRight ? 0 : 2);
  const tileBottom = top + size - (joinedDown ? 0 : 2);
  const width = tileRight - tileLeft;
  const height = tileBottom - tileTop;
  const edge = Math.max(2, Math.floor(size / 8));

  context.fillStyle = definition.shadow;
  context.fillRect(tileLeft, tileTop, width, height);
  context.fillStyle = definition.fill;
  context.fillRect(
    tileLeft,
    tileTop,
    width - (joinedRight ? 0 : edge),
    height - (joinedDown ? 0 : edge),
  );

  if (!joinedUp) {
    const highlightLeft = tileLeft + (joinedLeft ? 0 : edge);
    const highlightRight = tileRight - (joinedRight ? 0 : edge);
    context.fillStyle = definition.highlight;
    context.fillRect(
      highlightLeft,
      tileTop + edge,
      highlightRight - highlightLeft,
      Math.max(2, edge / 2),
    );
  }

  context.fillStyle = definition.decorationColor;
  context.strokeStyle = definition.decorationColor;
  context.lineWidth = Math.max(1, Math.floor(size / 24));
  switch (definition.decorationStyle) {
    case TileDecorationStyle.Crack:
      context.beginPath();
      context.moveTo(tileLeft + width * 0.35, tileTop + edge);
      context.lineTo(tileLeft + width * 0.48, tileTop + height * 0.45);
      context.moveTo(tileLeft + width * 0.42, tileTop + height * 0.55);
      context.lineTo(tileLeft + width * 0.37, tileTop + height - edge);
      context.stroke();
      break;
    case TileDecorationStyle.Grains: {
      const grainSize = Math.max(1, Math.floor(size / 16));
      context.fillRect(tileLeft + width * 0.25, tileTop + height * 0.42, grainSize, grainSize);
      context.fillRect(tileLeft + width * 0.68, tileTop + height * 0.7, grainSize, grainSize);
      break;
    }
    case TileDecorationStyle.Magnet:
      context.save();
      context.translate(tileLeft + width / 2, tileTop + height / 2);
      context.rotate(orientation * Math.PI / 2);
      context.beginPath();
      context.moveTo(0, -height * 0.31);
      context.lineTo(width * 0.22, height * 0.04);
      context.lineTo(width * 0.08, height * 0.04);
      context.lineTo(width * 0.08, height * 0.25);
      context.lineTo(-width * 0.08, height * 0.25);
      context.lineTo(-width * 0.08, height * 0.04);
      context.lineTo(-width * 0.22, height * 0.04);
      context.closePath();
      context.fill();
      context.restore();
      break;
    case TileDecorationStyle.Metal: {
      const rivetSize = Math.max(2, Math.floor(size / 10));
      context.fillRect(tileLeft + edge, tileTop + edge, rivetSize, rivetSize);
      context.fillRect(tileRight - edge - rivetSize, tileTop + edge, rivetSize, rivetSize);
      context.fillRect(tileLeft + edge, tileBottom - edge - rivetSize, rivetSize, rivetSize);
      context.fillRect(tileRight - edge - rivetSize, tileBottom - edge - rivetSize, rivetSize, rivetSize);
      break;
    }
    case TileDecorationStyle.None:
      break;
  }

  context.strokeStyle = definition.shadow;
  context.lineWidth = Math.max(1, Math.floor(edge / 2));
  if ((innerCorners & InnerCorner.UpLeft) !== 0) {
    drawInnerFillet(context, tileLeft, tileTop, edge, -1, -1);
  }
  if ((innerCorners & InnerCorner.UpRight) !== 0) {
    drawInnerFillet(context, tileRight, tileTop, edge, 1, -1);
  }
  if ((innerCorners & InnerCorner.DownRight) !== 0) {
    drawInnerFillet(context, tileRight, tileBottom, edge, 1, 1);
  }
  if ((innerCorners & InnerCorner.DownLeft) !== 0) {
    drawInnerFillet(context, tileLeft, tileBottom, edge, -1, 1);
  }
}

function drawInnerFillet(
  context: CanvasRenderingContext2D,
  cornerX: number,
  cornerY: number,
  edge: number,
  horizontalSign: -1 | 1,
  verticalSign: -1 | 1,
): void {
  const inset = 1;
  const depth = edge + inset;
  context.beginPath();
  context.moveTo(
    cornerX - horizontalSign * depth,
    cornerY - verticalSign * inset,
  );
  context.quadraticCurveTo(
    cornerX - horizontalSign * depth,
    cornerY - verticalSign * depth,
    cornerX - horizontalSign * inset,
    cornerY - verticalSign * depth,
  );
  context.stroke();
}
