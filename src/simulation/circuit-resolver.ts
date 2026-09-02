import { expectDefined } from "../util/assert";
import { chargeFromSum, type Charge } from "./circuit";
import { furnaceRecipeFor } from "./furnace";
import { PuzzleResult } from "./puzzle-result";
import { runeArrayPortCellIndex } from "./rune-array";
import {
  Direction,
  directionX,
  directionY,
  orientedSides,
  oppositeDirection,
  TILE_DEFINITIONS,
  TileKind,
  type WeldSide,
} from "./tile";
import type { World } from "./world";
import type { WorldRuntime } from "./world-runtime";

/** Circuit nodes per cell: one per side so rune arrays can expose four separate networks. */
const NODES_PER_CELL = 4;

/**
 * Resolves and commits circuit state for a whole tree of worlds at once using persistent,
 * allocation-free scratch buffers. Every cell owns four node slots: ordinary circuit tiles
 * use slot 0, wire crossings use slots 0 (horizontal) and 1 (vertical), and rune arrays use
 * one slot per side. A nested world's edge-center cells connect to the containing array's
 * side nodes as if a conduit sat just beyond the edge, so signals cross array boundaries
 * within the same tick. Victory blocks in any world are observed here too, since they read
 * the same start-of-tick port charges as gates, and they latch the root world's result.
 */
export class CircuitResolver {
  private roots = new Int32Array(0);
  private driveSums = new Int32Array(0);
  private hasWinIntent = false;
  private hasLossIntent = false;

  /** `runtimes[0]` must be the root; every other runtime's `parent` must precede it. */
  resolve(tick: number, runtimes: readonly WorldRuntime[]): void {
    const root = expectDefined(runtimes[0], "root world runtime");
    if (root.parent !== null) {
      throw new Error("The first circuit runtime must be the root world");
    }
    let nodeCount = 0;
    for (const runtime of runtimes) {
      runtime.nodeBase = nodeCount;
      nodeCount += runtime.world.cellCount * NODES_PER_CELL;
    }
    if (this.roots.length < nodeCount) {
      this.roots = new Int32Array(nodeCount);
      this.driveSums = new Int32Array(nodeCount);
    }
    this.roots.fill(-1, 0, nodeCount);
    this.driveSums.fill(0, 0, nodeCount);
    this.hasWinIntent = false;
    this.hasLossIntent = false;

    for (const runtime of runtimes) {
      runtime.nextCharges.fill(0);
      runtime.nextCrossingVerticalCharges.fill(0);
      runtime.nextIsolatedOutputCharges.fill(0);
      runtime.nextPortCharges.fill(0);
      runtime.furnaceDisabled.fill(0);
      this.registerNodes(runtime);
    }
    for (const runtime of runtimes) {
      this.unionConnections(runtime);
    }
    for (const runtime of runtimes) {
      this.driveSources(runtime, tick);
    }
    for (const runtime of runtimes) {
      this.driveGates(runtime);
    }
    for (const runtime of runtimes) {
      this.commitCharges(runtime);
    }
    if (
      root.world.puzzleResult === PuzzleResult.InProgress &&
      this.hasWinIntent !== this.hasLossIntent
    ) {
      root.world.markPuzzleResult(this.hasWinIntent ? PuzzleResult.Won : PuzzleResult.Lost);
    }
  }

  private registerNodes(runtime: WorldRuntime): void {
    const world = runtime.world;
    for (let index = 0; index < world.cellCount; index += 1) {
      const kind = world.kindAtIndex(index);
      const node = runtime.nodeBase + index * NODES_PER_CELL;
      if (kind === TileKind.RuneArray) {
        for (let side = 0; side < NODES_PER_CELL; side += 1) {
          this.roots[node + side] = node + side;
        }
        continue;
      }
      const definition = TILE_DEFINITIONS[kind];
      const sharedPorts = definition.circuitPorts &
        ~(definition.circuitInputPorts | definition.circuitOutputPorts);
      if (sharedPorts === 0) {
        continue;
      }
      this.roots[node] = node;
      if (kind === TileKind.WireCrossing) {
        this.roots[node + 1] = node + 1;
      }
    }
  }

  private unionConnections(runtime: WorldRuntime): void {
    const world = runtime.world;
    for (let index = 0; index < world.cellCount; index += 1) {
      for (let value = Direction.Right; value <= Direction.Down; value += 1) {
        const direction = value as Direction;
        if (!world.hasCircuitConnectionAtIndex(index, direction)) {
          continue;
        }
        const neighbor = neighborIndex(world, index, direction);
        if (neighbor < 0) {
          throw new Error(`Connected circuit at index ${index} has no neighbor`);
        }
        if (
          !this.isSharedCircuitPort(world, index, direction) ||
          !this.isSharedCircuitPort(world, neighbor, oppositeDirection(direction))
        ) {
          continue;
        }
        this.unionNodes(
          this.circuitNode(runtime, index, direction),
          this.circuitNode(runtime, neighbor, oppositeDirection(direction)),
        );
      }
    }

    const parent = runtime.parent;
    if (parent === null) {
      return;
    }
    for (let value = Direction.Up; value <= Direction.Left; value += 1) {
      const side = value as Direction;
      const index = runeArrayPortCellIndex(world.width, world.height, side);
      if (!this.isSharedCircuitPort(world, index, side)) {
        continue;
      }
      this.unionNodes(
        this.circuitNode(runtime, index, side),
        parent.nodeBase + runtime.parentIndex * NODES_PER_CELL + side,
      );
    }
  }

  private driveSources(runtime: WorldRuntime, tick: number): void {
    const world = runtime.world;
    const successfulWeldOperations = runtime.weldOperationResolver.successfulOperationIndices;
    const deliveryAbsorptionTargets = runtime.deliveryResolver.absorptionTargetIndices;
    for (let index = 0; index < world.cellCount; index += 1) {
      const kind = world.kindAtIndex(index);
      if (kind === TileKind.Welder || kind === TileKind.Splitter) {
        const outputCharge = successfulWeldOperations[index] === 1 ? 1 : 0;
        runtime.nextIsolatedOutputCharges[index] = outputCharge;
        const orientation = world.orientationAtIndex(index);
        this.driveOutputs(
          runtime,
          index,
          orientedSides(TILE_DEFINITIONS[kind].circuitOutputPorts, orientation),
          outputCharge,
          false,
        );
        continue;
      }
      let outputCharge: Charge;
      if (kind === TileKind.FixedCharge) {
        outputCharge = 1;
      } else if (kind === TileKind.Spark) {
        outputCharge = tick === 0 ? 1 : 0;
      } else if (kind === TileKind.Sensor) {
        outputCharge = world.sensorOutputAtIndex(index);
      } else if (kind === TileKind.Delivery) {
        outputCharge = expectDefined(
          deliveryAbsorptionTargets[index],
          "delivery absorption target",
        ) >= 0 ? 1 : 0;
      } else {
        continue;
      }

      if (outputCharge !== 0) {
        const root = this.findRoot(this.circuitNode(runtime, index, Direction.Up));
        this.driveSums[root] =
          expectDefined(this.driveSums[root], "circuit drive sum") + outputCharge;
      }
    }
  }

  private driveGates(runtime: WorldRuntime): void {
    const world = runtime.world;
    for (let index = 0; index < world.cellCount; index += 1) {
      const kind = world.kindAtIndex(index);
      const definition = TILE_DEFINITIONS[kind];
      if (definition.circuitInputPorts === 0) {
        continue;
      }

      const orientation = world.orientationAtIndex(index);
      if (kind === TileKind.ChargeSensor) {
        const outputCharge = this.neighborPortCharge(runtime, index, orientation);
        this.driveOutputs(
          runtime,
          index,
          orientedSides(definition.circuitOutputPorts, orientation),
          outputCharge,
        );
        continue;
      }
      if (kind === TileKind.Victory) {
        for (let value = Direction.Up; value <= Direction.Left; value += 1) {
          const direction = value as Direction;
          if (!this.hasConnectedNeighbor(runtime, index, direction)) {
            continue;
          }
          const inputCharge = this.neighborPortCharge(runtime, index, direction);
          this.hasWinIntent ||= inputCharge === 1;
          this.hasLossIntent ||= inputCharge === -1;
        }
        continue;
      }
      const inputSides = orientedSides(definition.circuitInputPorts, orientation);
      let inputSum = 0;
      let inputProduct = 1;
      let leftInput: Charge = 0;
      let rightInput: Charge = 0;
      let rearInput: Charge = 0;
      for (let value = Direction.Up; value <= Direction.Left; value += 1) {
        const direction = value as Direction;
        if (
          (inputSides & (1 << direction)) === 0 ||
          !this.hasConnectedNeighbor(runtime, index, direction)
        ) {
          continue;
        }
        const inputCharge = this.neighborPortCharge(runtime, index, direction);
        if (kind === TileKind.Multiplier) {
          inputProduct *= inputCharge;
        }
        inputSum += inputCharge;
        const relativeDirection = ((direction - orientation + 4) & 3) as Direction;
        if (relativeDirection === Direction.Left) {
          leftInput = inputCharge;
        } else if (relativeDirection === Direction.Right) {
          rightInput = inputCharge;
        } else if (relativeDirection === Direction.Down) {
          rearInput = inputCharge;
        }
      }

      let outputCharge: Charge;
      switch (kind) {
        case TileKind.Inverter:
          outputCharge = chargeFromSum(-inputSum);
          break;
        case TileKind.Combiner:
          outputCharge = chargeFromSum(inputSum);
          break;
        case TileKind.Rectifier:
          outputCharge = inputSum > 0 ? 1 : 0;
          break;
        case TileKind.Multiplier:
          outputCharge = chargeFromSum(inputProduct);
          break;
        case TileKind.Subtractor:
          outputCharge = chargeFromSum(inputSum - 2 * leftInput - 2 * rightInput);
          break;
        case TileKind.Selector:
          outputCharge = rearInput === 1 ? leftInput : rearInput === -1 ? rightInput : 0;
          break;
        case TileKind.Delay:
          outputCharge = world.advanceDelayAtIndex(index, rearInput);
          break;
        case TileKind.Counter:
          outputCharge = world.advanceCounterAtIndex(index, rearInput);
          break;
        case TileKind.Checker:
          outputCharge = world.advanceCheckerAtIndex(index, rearInput);
          break;
        case TileKind.Rom: {
          const leftInputSide = ((orientation + Direction.Left) & 3) as Direction;
          const rearInputSide = ((orientation + Direction.Down) & 3) as Direction;
          const cursorDeltaX = chargeFromSum(
            -directionX(leftInputSide) * leftInput -
              directionX(rearInputSide) * rearInput,
          );
          const cursorDeltaY = chargeFromSum(
            -directionY(leftInputSide) * leftInput -
              directionY(rearInputSide) * rearInput,
          );
          outputCharge = world.advanceRomAtIndex(index, cursorDeltaX, cursorDeltaY);
          break;
        }
        case TileKind.Furnace: {
          const disabled = rearInput !== 0;
          runtime.furnaceDisabled[index] = disabled ? 1 : 0;
          const targetIndex = neighborIndex(world, index, orientation);
          const targetKind = targetIndex < 0
            ? TileKind.Empty
            : world.kindAtIndex(targetIndex);
          outputCharge = !disabled && furnaceRecipeFor(targetKind) !== undefined ? 1 : 0;
          break;
        }
        default:
          throw new Error(`Tile kind ${kind} defines circuit inputs without a gate behavior`);
      }
      this.driveOutputs(
        runtime,
        index,
        orientedSides(definition.circuitOutputPorts, orientation),
        outputCharge,
      );
    }
  }

  private commitCharges(runtime: WorldRuntime): void {
    const world = runtime.world;
    for (let index = 0; index < world.cellCount; index += 1) {
      const node = runtime.nodeBase + index * NODES_PER_CELL;
      if (world.kindAtIndex(index) === TileKind.RuneArray) {
        for (let side = 0; side < NODES_PER_CELL; side += 1) {
          runtime.nextPortCharges[index * NODES_PER_CELL + side] = this.resolvedCharge(node + side);
        }
        continue;
      }
      if (expectDefined(this.roots[node], "circuit root marker") >= 0) {
        runtime.nextCharges[index] = this.resolvedCharge(node);
      }
      if (expectDefined(this.roots[node + 1], "circuit root marker") >= 0) {
        runtime.nextCrossingVerticalCharges[index] = this.resolvedCharge(node + 1);
      }
    }
    world.applyCircuitCharges(
      runtime.nextCharges,
      runtime.nextCrossingVerticalCharges,
      runtime.nextIsolatedOutputCharges,
      runtime.nextPortCharges,
    );
  }

  private resolvedCharge(node: number): Charge {
    const root = this.findRoot(node);
    return chargeFromSum(expectDefined(this.driveSums[root], "circuit drive sum"));
  }

  private driveOutputs(
    runtime: WorldRuntime,
    index: number,
    outputSides: WeldSide,
    outputCharge: Charge,
    storeOnTile = true,
  ): void {
    if (storeOnTile) {
      runtime.nextCharges[index] = outputCharge;
    }
    for (let value = Direction.Up; value <= Direction.Left; value += 1) {
      const outputDirection = value as Direction;
      if ((outputSides & (1 << outputDirection)) === 0) {
        continue;
      }
      const outputNode = this.connectedNeighborNode(runtime, index, outputDirection);
      if (outputNode < 0 || expectDefined(this.roots[outputNode], "output circuit root marker") < 0) {
        continue;
      }
      const outputRoot = this.findRoot(outputNode);
      this.driveSums[outputRoot] =
        expectDefined(this.driveSums[outputRoot], "circuit drive sum") + outputCharge;
    }
  }

  /**
   * Node of the port facing back at `index` across `direction`, or -1 without a connection.
   * At a nested world's edge-center cell, the containing rune array's side node stands in
   * for the missing neighbor whenever the cell exposes a circuit port on that side.
   */
  private connectedNeighborNode(
    runtime: WorldRuntime,
    index: number,
    direction: Direction,
  ): number {
    const world = runtime.world;
    const neighbor = neighborIndex(world, index, direction);
    if (neighbor >= 0) {
      return world.hasCircuitConnectionAtIndex(index, direction)
        ? this.circuitNode(runtime, neighbor, oppositeDirection(direction))
        : -1;
    }
    const parent = runtime.parent;
    if (parent === null || !isVirtualPort(world, index, direction)) {
      return -1;
    }
    return parent.nodeBase + runtime.parentIndex * NODES_PER_CELL + direction;
  }

  /** Whether a welded circuit link or a virtual array port faces `index` across `direction`. */
  private hasConnectedNeighbor(
    runtime: WorldRuntime,
    index: number,
    direction: Direction,
  ): boolean {
    const world = runtime.world;
    if (neighborIndex(world, index, direction) >= 0) {
      return world.hasCircuitConnectionAtIndex(index, direction);
    }
    return runtime.parent !== null && isVirtualPort(world, index, direction);
  }

  /**
   * Start-of-tick charge of the port facing back at `index` across `direction`, whether or
   * not a weld connects them, or 0 beyond the board without a virtual array port.
   */
  private neighborPortCharge(
    runtime: WorldRuntime,
    index: number,
    direction: Direction,
  ): Charge {
    const world = runtime.world;
    const neighbor = neighborIndex(world, index, direction);
    if (neighbor >= 0) {
      return world.chargeAtPortIndex(neighbor, oppositeDirection(direction));
    }
    const parent = runtime.parent;
    if (parent === null || !isVirtualPort(world, index, direction)) {
      return 0;
    }
    return parent.world.chargeAtPortIndex(runtime.parentIndex, direction);
  }

  private isSharedCircuitPort(world: World, index: number, direction: Direction): boolean {
    const kind = world.kindAtIndex(index);
    if (kind === TileKind.RuneArray) {
      return true;
    }
    const definition = TILE_DEFINITIONS[kind];
    const orientation = world.orientationAtIndex(index);
    const sharedPorts = orientedSides(
      (definition.circuitPorts &
        ~(definition.circuitInputPorts | definition.circuitOutputPorts)) as WeldSide,
      orientation,
    );
    return (sharedPorts & (1 << direction)) !== 0;
  }

  private unionNodes(first: number, second: number): void {
    const firstRoot = this.findRoot(first);
    const secondRoot = this.findRoot(second);
    if (firstRoot === secondRoot) {
      return;
    }
    if (firstRoot < secondRoot) {
      this.roots[secondRoot] = firstRoot;
    } else {
      this.roots[firstRoot] = secondRoot;
    }
  }

  private circuitNode(runtime: WorldRuntime, index: number, direction: Direction): number {
    const kind = runtime.world.kindAtIndex(index);
    const node = runtime.nodeBase + index * NODES_PER_CELL;
    if (kind === TileKind.RuneArray) {
      return node + direction;
    }
    const verticalAxis = kind === TileKind.WireCrossing &&
      (direction === Direction.Up || direction === Direction.Down);
    return node + (verticalAxis ? 1 : 0);
  }

  private findRoot(index: number): number {
    let root = index;
    let parent = expectDefined(this.roots[root], "circuit parent");
    if (parent < 0) {
      throw new Error(`Circuit node ${index} is not registered`);
    }
    while (parent !== root) {
      root = parent;
      parent = expectDefined(this.roots[root], "circuit parent");
    }
    while (index !== root) {
      const nextIndex = expectDefined(this.roots[index], "circuit parent");
      this.roots[index] = root;
      index = nextIndex;
    }
    return root;
  }
}

/** Whether `index` is the edge-center cell wired to `side` and exposes a circuit port there. */
function isVirtualPort(world: World, index: number, side: Direction): boolean {
  if (index !== runeArrayPortCellIndex(world.width, world.height, side)) {
    return false;
  }
  const definition = TILE_DEFINITIONS[world.kindAtIndex(index)];
  const ports = orientedSides(definition.circuitPorts, world.orientationAtIndex(index));
  return (ports & (1 << side)) !== 0;
}

function neighborIndex(world: World, index: number, direction: Direction): number {
  const x = index % world.width;
  switch (direction) {
    case Direction.Up:
      return index >= world.width ? index - world.width : -1;
    case Direction.Right:
      return x < world.width - 1 ? index + 1 : -1;
    case Direction.Down:
      return index < world.cellCount - world.width ? index + world.width : -1;
    case Direction.Left:
      return x > 0 ? index - 1 : -1;
    default:
      throw new RangeError(`Invalid direction ${direction as number}`);
  }
}
