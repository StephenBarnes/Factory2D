import {
  Direction,
  directionX,
  directionY,
  oppositeDirection,
  orientedSides,
  TILE_DEFINITIONS,
  TileKind,
  WeldSide,
} from "../simulation/tile";
import type { World } from "../simulation/world";
import { expectDefined } from "../util/assert";
import { type BodyCell, setCircuitPortCharge } from "./tile-renderer";

/** Creates an empty, reusable body cell record. */
export function createBodyCell(): BodyCell {
  return {
    x: 0,
    y: 0,
    kind: TileKind.Empty,
    orientation: Direction.Up,
    outputCharge: 0,
    circuitConnections: WeldSide.None,
    circuitPortCharges: 0,
    componentState: null,
    seamRight: false,
    seamDown: false,
  };
}

/**
 * Fills `cell` with the renderable state of the tile at `index`: position,
 * kind, orientation, emitted charge, circuit connections with per-port
 * charges, and configurable-component state. Seams are left untouched because
 * they depend on the surrounding body.
 */
export function populateBodyCell(world: World, index: number, cell: BodyCell): void {
  const width = world.width;
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
  cell.componentState = world.componentStateSnapshotAtIndex(index);
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
}

/**
 * Collects every welded body of `world` as freshly allocated cell arrays in
 * row-major order of each body's first cell. Intended for small boards such
 * as snippet thumbnails; the board renderer keeps its own allocation-free cache.
 */
export function collectWorldBodies(world: World): BodyCell[][] {
  const width = world.width;
  const height = world.height;
  const cellCount = world.cellCount;
  const bodyStamps = new Int32Array(cellCount);
  const stack: number[] = [];
  const bodies: BodyCell[][] = [];

  for (let startIndex = 0; startIndex < cellCount; startIndex += 1) {
    if (bodyStamps[startIndex] !== 0 || world.kindAtIndex(startIndex) === TileKind.Empty) {
      continue;
    }
    const stamp = startIndex + 1;
    const cells: BodyCell[] = [];
    bodyStamps[startIndex] = stamp;
    stack.push(startIndex);
    while (stack.length > 0) {
      const index = expectDefined(stack.pop(), "welded body stack entry");
      const cell = createBodyCell();
      populateBodyCell(world, index, cell);
      cells.push(cell);
      const x = cell.x;
      const y = cell.y;
      const neighbors: number[] = [];
      if (x + 1 < width && world.hasRightWeldAtIndex(index)) {
        neighbors.push(index + 1);
      }
      if (x > 0 && world.hasRightWeldAtIndex(index - 1)) {
        neighbors.push(index - 1);
      }
      if (y + 1 < height && world.hasDownWeldAtIndex(index)) {
        neighbors.push(index + width);
      }
      if (y > 0 && world.hasDownWeldAtIndex(index - width)) {
        neighbors.push(index - width);
      }
      for (const neighbor of neighbors) {
        if (bodyStamps[neighbor] !== stamp) {
          bodyStamps[neighbor] = stamp;
          stack.push(neighbor);
        }
      }
    }
    for (const cell of cells) {
      const index = cell.y * width + cell.x;
      cell.seamRight = cell.x < width - 1 &&
        bodyStamps[index + 1] === stamp &&
        !world.hasRightWeldAtIndex(index);
      cell.seamDown = cell.y < height - 1 &&
        bodyStamps[index + width] === stamp &&
        !world.hasDownWeldAtIndex(index);
    }
    bodies.push(cells);
  }
  return bodies;
}
