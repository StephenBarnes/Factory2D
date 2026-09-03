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
import { WorldFeature } from "./world-features";

/**
 * Resolves and commits circuit state for a whole tree of worlds at once. Shared circuit
 * nodes are allocated only for circuit-capable cells: one for ordinary shared networks,
 * two for wire crossings, and four for rune arrays. The union topology is retained until
 * world geometry or the nested-world tree changes; only driver sums and sequential state
 * are recomputed each tick.
 *
 * A nested world's edge-center cells connect to the containing array's side nodes as if a
 * conduit sat just beyond the edge, so signals cross array boundaries within the same tick.
 * Victory blocks in any world are observed here too, since they read the same start-of-tick
 * port charges as gates, and they latch the root world's result.
 */
export class CircuitResolver {
  private roots = new Int32Array(0);
  private driveSums = new Int32Array(0);
  private nodeCount = 0;
  private readonly topologyRuntimes: WorldRuntime[] = [];
  private readonly topologyGeometryRevisions: number[] = [];
  private readonly topologyParents: (WorldRuntime | null)[] = [];
  private readonly topologyParentIndices: number[] = [];
  private hasWinIntent = false;
  private hasLossIntent = false;

  /** `runtimes[0]` must be the root; every other runtime's `parent` must precede it. */
  resolve(tick: number, runtimes: readonly WorldRuntime[]): void {
    const root = expectDefined(runtimes[0], "root world runtime");
    if (root.parent !== null) {
      throw new Error("The first circuit runtime must be the root world");
    }
    this.ensureTopology(runtimes);
    this.driveSums.fill(0, 0, this.nodeCount);
    this.hasWinIntent = false;
    this.hasLossIntent = false;

    for (const runtime of runtimes) {
      const world = runtime.world;
      for (
        let index = world.firstFeatureIndex(WorldFeature.Circuit);
        index >= 0;
        index = world.nextFeatureIndex(WorldFeature.Circuit, index)
      ) {
        runtime.nextCharges[index] = 0;
        runtime.nextCrossingVerticalCharges[index] = 0;
        runtime.nextIsolatedOutputCharges[index] = 0;
        runtime.furnaceDisabled[index] = 0;
        const portBase = index * 4;
        for (let side = 0; side < 4; side += 1) {
          runtime.nextPortCharges[portBase + side] = 0;
        }
      }
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

  private ensureTopology(runtimes: readonly WorldRuntime[]): void {
    if (!this.topologyIsCurrent(runtimes)) {
      this.rebuildTopology(runtimes);
    }
  }

  private topologyIsCurrent(runtimes: readonly WorldRuntime[]): boolean {
    if (runtimes.length !== this.topologyRuntimes.length) {
      return false;
    }
    for (let position = 0; position < runtimes.length; position += 1) {
      const runtime = expectDefined(runtimes[position], "circuit runtime");
      if (
        this.topologyRuntimes[position] !== runtime ||
        this.topologyGeometryRevisions[position] !== runtime.world.geometryRevision ||
        this.topologyParents[position] !== runtime.parent ||
        this.topologyParentIndices[position] !== runtime.parentIndex
      ) {
        return false;
      }
    }
    return true;
  }

  private rebuildTopology(runtimes: readonly WorldRuntime[]): void {
    let nodeCount = 0;
    for (const runtime of runtimes) {
      let nodes = runtime.circuitNodes;
      if (nodes === null) {
        nodes = new Int32Array(runtime.world.cellCount);
        runtime.circuitNodes = nodes;
      }
      nodes.fill(-1);
      const world = runtime.world;
      for (
        let index = world.firstFeatureIndex(WorldFeature.Circuit);
        index >= 0;
        index = world.nextFeatureIndex(WorldFeature.Circuit, index)
      ) {
        const kind = world.kindAtIndex(index);
        if (kind === TileKind.RuneArray) {
          nodes[index] = nodeCount;
          nodeCount += 4;
          continue;
        }
        const definition = TILE_DEFINITIONS[kind];
        const sharedPorts = definition.circuitPorts &
          ~(definition.circuitInputPorts | definition.circuitOutputPorts);
        if (sharedPorts !== 0) {
          nodes[index] = nodeCount;
          nodeCount += kind === TileKind.WireCrossing ? 2 : 1;
        }
      }
    }

    if (this.roots.length < nodeCount) {
      this.roots = new Int32Array(nodeCount);
      this.driveSums = new Int32Array(nodeCount);
    }
    for (let node = 0; node < nodeCount; node += 1) {
      this.roots[node] = node;
    }
    for (const runtime of runtimes) {
      this.unionConnections(runtime);
    }
    for (let node = 0; node < nodeCount; node += 1) {
      this.roots[node] = this.findRoot(node);
    }
    this.nodeCount = nodeCount;

    this.topologyRuntimes.length = runtimes.length;
    this.topologyGeometryRevisions.length = runtimes.length;
    this.topologyParents.length = runtimes.length;
    this.topologyParentIndices.length = runtimes.length;
    for (let position = 0; position < runtimes.length; position += 1) {
      const runtime = expectDefined(runtimes[position], "circuit runtime");
      this.topologyRuntimes[position] = runtime;
      this.topologyGeometryRevisions[position] = runtime.world.geometryRevision;
      this.topologyParents[position] = runtime.parent;
      this.topologyParentIndices[position] = runtime.parentIndex;
    }
  }

  private unionConnections(runtime: WorldRuntime): void {
    const world = runtime.world;
    for (
      let index = world.firstFeatureIndex(WorldFeature.Circuit);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.Circuit, index)
    ) {
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
          this.requireCircuitNode(runtime, index, direction),
          this.requireCircuitNode(runtime, neighbor, oppositeDirection(direction)),
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
        this.requireCircuitNode(runtime, index, side),
        this.requireCircuitNode(parent, runtime.parentIndex, side),
      );
    }
  }

  private driveSources(runtime: WorldRuntime, tick: number): void {
    const world = runtime.world;
    const successfulWeldOperations = runtime.weldOperationResolver.successfulOperationIndices;
    const deliveryAbsorptionTargets = runtime.deliveryResolver.absorptionTargetIndices;
    for (
      let index = world.firstFeatureIndex(WorldFeature.CircuitSource);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.CircuitSource, index)
    ) {
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
        const root = this.findRoot(
          this.requireCircuitNode(runtime, index, Direction.Up),
        );
        this.driveSums[root] =
          expectDefined(this.driveSums[root], "circuit drive sum") + outputCharge;
      }
    }
  }

  private driveGates(runtime: WorldRuntime): void {
    const world = runtime.world;
    for (
      let index = world.firstFeatureIndex(WorldFeature.CircuitGate);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.CircuitGate, index)
    ) {
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
      let firstInput: Charge = 0;
      let allInputsEqual = true;
      let hasInput = false;
      let minimumInput: Charge = 1;
      let maximumInput: Charge = -1;
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
        } else if (kind === TileKind.Equality) {
          if (hasInput && inputCharge !== firstInput) {
            allInputsEqual = false;
          }
          firstInput = inputCharge;
        } else if (kind === TileKind.Minimum && inputCharge < minimumInput) {
          minimumInput = inputCharge;
        } else if (kind === TileKind.Maximum && inputCharge > maximumInput) {
          maximumInput = inputCharge;
        }
        hasInput = true;
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
        case TileKind.Equality:
          outputCharge = allInputsEqual ? 1 : 0;
          break;
        case TileKind.Minimum:
          outputCharge = minimumInput;
          break;
        case TileKind.Maximum:
          outputCharge = maximumInput;
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
    for (
      let index = world.firstFeatureIndex(WorldFeature.Circuit);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.Circuit, index)
    ) {
      const kind = world.kindAtIndex(index);
      const node = this.circuitNode(
        runtime,
        index,
        kind === TileKind.WireCrossing ? Direction.Right : Direction.Up,
      );
      if (kind === TileKind.RuneArray) {
        const arrayNode = this.requireCircuitNode(runtime, index, Direction.Up);
        for (let side = 0; side < 4; side += 1) {
          runtime.nextPortCharges[index * 4 + side] = this.resolvedCharge(arrayNode + side);
        }
        continue;
      }
      if (node >= 0) {
        runtime.nextCharges[index] = this.resolvedCharge(node);
        if (kind === TileKind.WireCrossing) {
          runtime.nextCrossingVerticalCharges[index] = this.resolvedCharge(node + 1);
        }
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
      if (outputNode < 0) {
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
    return this.requireCircuitNode(parent, runtime.parentIndex, direction);
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
    const nodes = runtime.circuitNodes;
    if (nodes === null) {
      throw new Error("Circuit node lookup is unavailable before topology construction");
    }
    const node = expectDefined(nodes[index], "circuit node");
    if (node < 0) {
      return -1;
    }
    const kind = runtime.world.kindAtIndex(index);
    if (kind === TileKind.RuneArray) {
      return node + direction;
    }
    const verticalAxis = kind === TileKind.WireCrossing &&
      (direction === Direction.Up || direction === Direction.Down);
    return node + (verticalAxis ? 1 : 0);
  }

  private requireCircuitNode(
    runtime: WorldRuntime,
    index: number,
    direction: Direction,
  ): number {
    const node = this.circuitNode(runtime, index, direction);
    if (node < 0) {
      throw new Error(`Circuit cell at index ${index} has no shared node`);
    }
    return node;
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
