import { expectDefined } from "../util/assert";
import { chargeFromSum, type Charge } from "./circuit";
import { furnaceNeighborsPresent, isProcessingMachine, processingRecipeFor } from "./furnace";
import { magicLinksFor } from "./magic-link";
import { PuzzleResult } from "./puzzle-result";
import { runeArrayPortCellIndex } from "./rune-array";
import {
  Direction,
  directionX,
  directionY,
  orientedDirection,
  orientedSides,
  oppositeDirection,
  TILE_DEFINITIONS,
  TileKind,
  WeldSide,
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
  private beamBodyVisits = new Uint32Array(0);
  private beamBodyVisitGeneration = 0;

  /** Freeze link controls before any observer collects mechanical bodies. */
  observeMagicLinks(runtimes: readonly WorldRuntime[]): void {
    for (const runtime of runtimes) {
      const world = runtime.world;
      const links = magicLinksFor(world);
      if (links === undefined) {
        continue;
      }
      links.beginControls();
      for (
        let index = world.firstFeatureIndex(WorldFeature.MagicLink);
        index >= 0;
        index = world.nextFeatureIndex(WorldFeature.MagicLink, index)
      ) {
        const rear = oppositeDirection(world.orientationAtIndex(index));
        if (this.hasConnectedNeighbor(runtime, index, rear) &&
            this.neighborPortCharge(runtime, index, rear) === -1) {
          links.disable(index);
        }
      }
      links.commitControls();
    }
  }

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
      if (!runtime.world.hasFeature(WorldFeature.Circuit)) {
        // Keep previously allocated storage, but never expose old node numbers.
        nodes?.fill(-1);
        continue;
      }
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
    for (
      let index = world.firstFeatureIndex(WorldFeature.CircuitSource);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.CircuitSource, index)
    ) {
      const kind = world.kindAtIndex(index);
      if (kind === TileKind.MovementSensor) {
        const state = world.movementSensorStateAtIndex(index);
        for (let side = Direction.Up; side <= Direction.Left; side += 1) {
          const outputCharge = chargeFromSum(
            directionX(side) * state.motionX + directionY(side) * state.motionY,
          );
          runtime.nextPortCharges[index * 4 + side] = outputCharge;
          this.driveOutputs(runtime, index, 1 << side, outputCharge, false);
        }
        continue;
      }
      if (isProcessingMachine(kind)) {
        const orientation = world.orientationAtIndex(index);
        const leftSide = orientedDirection(
          Direction.Left, orientation, world.mirroredAtIndex(index),
        );
        const disabled = world.chargeAtPortIndex(index, leftSide) === -1;
        runtime.furnaceDisabled[index] = disabled ? 1 : 0;
        const targetIndex = neighborIndex(world, index, orientation);
        const targetKind = targetIndex < 0 ? TileKind.Empty : world.kindAtIndex(targetIndex);
        const recipe = processingRecipeFor(kind, targetKind);
        const outputCharge = kind === TileKind.Drill
          ? runtime.drillResolver.activeDrills[index] === 1 ? 1 : 0
          : !disabled && recipe !== undefined &&
            furnaceNeighborsPresent(world, targetIndex, recipe, orientation) ? 1 : 0;
        runtime.nextIsolatedOutputCharges[index] = outputCharge;
        this.driveOutputs(
          runtime,
          index,
          orientedSides(
            TILE_DEFINITIONS[kind].circuitOutputPorts, orientation, world.mirroredAtIndex(index),
          ),
          outputCharge,
          false,
        );
        continue;
      }
      if (kind === TileKind.Welder || kind === TileKind.Riveter || kind === TileKind.Grabber ||
          kind === TileKind.Splitter || kind === TileKind.LaserSplitter ||
          kind === TileKind.Dismantler || kind === TileKind.Assembler) {
        const outputCharge = (kind === TileKind.Assembler
          ? runtime.assemblerResolver.willEmit(index)
          : runtime.weldOperationResolver.successfulOperationIndices[index] === 1) ? 1 : 0;
        runtime.nextIsolatedOutputCharges[index] = outputCharge;
        const orientation = world.orientationAtIndex(index);
        this.driveOutputs(
          runtime,
          index,
          orientedSides(
            TILE_DEFINITIONS[kind].circuitOutputPorts, orientation, world.mirroredAtIndex(index),
          ),
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
      } else if (kind === TileKind.Resonator) {
        const state = world.resonatorStateAtIndex(index);
        this.driveOutputs(runtime, index, WeldSide.All, state.pending ? 1 : 0);
        state.pending = false;
        continue;
      } else if (kind === TileKind.Sensor) {
        outputCharge = world.sensorOutputAtIndex(index);
      } else if (kind === TileKind.Delivery) {
        outputCharge = expectDefined(
          runtime.deliveryResolver.absorptionTargetIndices[index],
          "delivery absorption target",
        ) >= 0 ? 1 : 0;
      } else if (kind === TileKind.BlockComparer) {
        const orientation = world.orientationAtIndex(index);
        const front = neighborIndex(world, index, orientation);
        const rear = neighborIndex(world, index, oppositeDirection(orientation));
        outputCharge = front >= 0 && rear >= 0 &&
          world.kindAtIndex(front) !== TileKind.Empty &&
          world.kindAtIndex(front) === world.kindAtIndex(rear) ? 1 : 0;
      } else if (kind === TileKind.BeamBlockSensor) {
        const orientation = world.orientationAtIndex(index);
        const rear = neighborIndex(world, index, oppositeDirection(orientation));
        const targetKind = rear < 0 ? TileKind.Empty : world.kindAtIndex(rear);
        const configuration = world.beamSensorConfigurationAtIndex(index);
        let count = 0;
        if (configuration.matchAll || targetKind !== TileKind.Empty) {
          for (
            let target = neighborIndex(world, index, orientation);
            target >= 0;
            target = neighborIndex(world, target, orientation)
          ) {
            const targetType = world.kindAtIndex(target);
            if (targetType !== TileKind.Empty &&
                (configuration.matchAll || targetType === targetKind)) {
              count += 1;
              if (count > configuration.threshold) break;
            }
          }
        }
        outputCharge = chargeFromSum(count - configuration.threshold);
      } else if (kind === TileKind.BeamBodySensor) {
        outputCharge = this.beamBodyOutput(runtime, index);
      } else if (kind === TileKind.Comparer) {
        const orientation = world.orientationAtIndex(index);
        const rear = neighborIndex(world, index, oppositeDirection(orientation));
        const front = neighborIndex(world, index, orientation);
        const bodies = runtime.weldedBodies;
        outputCharge = rear >= 0 && front >= 0 &&
          world.kindAtIndex(rear) !== TileKind.Empty &&
          world.kindAtIndex(front) !== TileKind.Empty &&
          bodies.rootAt(rear) !== bodies.rootAt(index) &&
          bodies.rootAt(front) !== bodies.rootAt(index) &&
          bodies.matchesUnderTranslation(rear, front) ? 1 : 0;
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

  private beamBodyOutput(runtime: WorldRuntime, index: number): Charge {
    const world = runtime.world;
    const configuration = world.beamSensorConfigurationAtIndex(index);
    const orientation = world.orientationAtIndex(index);
    const rear = neighborIndex(world, index, oppositeDirection(orientation));
    const bodies = runtime.weldedBodies;
    const ownRoot = bodies.rootAt(index);
    if (!configuration.matchAll && (rear < 0 ||
        world.kindAtIndex(rear) === TileKind.Empty || bodies.rootAt(rear) === ownRoot)) {
      return chargeFromSum(-configuration.threshold);
    }

    // Reuse root marks across sensors and nested boards, without clearing per ray.
    const cellCount = world.width * world.height;
    if (this.beamBodyVisits.length < cellCount) {
      this.beamBodyVisits = new Uint32Array(cellCount);
    }
    this.beamBodyVisitGeneration = (this.beamBodyVisitGeneration + 1) >>> 0;
    if (this.beamBodyVisitGeneration === 0) {
      this.beamBodyVisits.fill(0);
      this.beamBodyVisitGeneration = 1;
    }
    const generation = this.beamBodyVisitGeneration;
    let count = 0;
    for (
      let target = neighborIndex(world, index, orientation);
      target >= 0;
      target = neighborIndex(world, target, orientation)
    ) {
      if (world.kindAtIndex(target) === TileKind.Empty) continue;
      const root = bodies.rootAt(target);
      if (this.beamBodyVisits[root] === generation) continue;
      this.beamBodyVisits[root] = generation;
      if (configuration.matchAll ||
          (root !== ownRoot && bodies.matchesUnderTranslation(rear, target))) {
        count += 1;
        if (count > configuration.threshold) return 1;
      }
    }
    return chargeFromSum(count - configuration.threshold);
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
      const mirrored = world.mirroredAtIndex(index);
      if (kind === TileKind.MagicLink) {
        // Already observed before body-dependent production/matching intents.
        continue;
      }
      if (kind === TileKind.ChargeSensor) {
        const outputCharge = this.sensorObservedCharge(runtime, index, orientation);
        this.driveOutputs(
          runtime,
          index,
          orientedSides(definition.circuitOutputPorts, orientation, mirrored),
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
      if (kind === TileKind.LevitationProjector) {
        const rear = oppositeDirection(orientation);
        if (
          this.hasConnectedNeighbor(runtime, index, rear) &&
          this.neighborPortCharge(runtime, index, rear) === -1
        ) {
          runtime.motionWorkspace.disableLevitation(index);
        }
        continue;
      }
      if (kind === TileKind.ForceProjector) {
        const rear = oppositeDirection(orientation);
        if (this.hasConnectedNeighbor(runtime, index, rear)) {
          const charge = this.neighborPortCharge(runtime, index, rear);
          if (charge !== 0) {
            runtime.motionWorkspace.collectProjectedForce(
              index,
              charge === 1 ? orientation : rear,
            );
          }
        }
        continue;
      }
      if (kind === TileKind.Swapper) {
        const left = orientedDirection(Direction.Left, orientation);
        const right = oppositeDirection(left);
        if ((this.hasConnectedNeighbor(runtime, index, left) &&
             this.neighborPortCharge(runtime, index, left) === 1) ||
            (this.hasConnectedNeighbor(runtime, index, right) &&
             this.neighborPortCharge(runtime, index, right) === 1)) {
          runtime.swapperResolver.collect(index);
        }
        continue;
      }
      if (kind === TileKind.ControlledThruster) {
        let thrustDirection: Direction | undefined;
        for (let side = Direction.Up; side <= Direction.Left; side += 1) {
          if (
            !this.hasConnectedNeighbor(runtime, index, side) ||
            this.neighborPortCharge(runtime, index, side) !== 1
          ) {
            continue;
          }
          if (thrustDirection !== undefined) {
            thrustDirection = undefined;
            break;
          }
          thrustDirection = side;
        }
        if (thrustDirection !== undefined) {
          runtime.motionWorkspace.collectControlledThrust(index, thrustDirection);
        }
        continue;
      }
      const inputSides = orientedSides(definition.circuitInputPorts, orientation, mirrored);
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
        const relativeDirection = orientedDirection(
          ((direction - orientation + 4) & 3) as Direction, Direction.Up, mirrored,
        );
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
        case TileKind.DelayGate:
          outputCharge = rearInput;
          break;
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
        case TileKind.Discard:
          outputCharge = world.advanceDiscardAtIndex(index, rearInput);
          break;
        case TileKind.Counter:
          outputCharge = world.advanceCounterAtIndex(index, rearInput);
          break;
        case TileKind.Checker:
          outputCharge = world.advanceCheckerAtIndex(index, rearInput);
          break;
        case TileKind.Lut:
          outputCharge = world.lookupLutAtIndex(index, leftInput, rearInput);
          break;
        case TileKind.Rom: {
          const leftInputSide = orientedDirection(Direction.Left, orientation, mirrored);
          const rearInputSide = orientedDirection(Direction.Down, orientation, mirrored);
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
        default:
          throw new Error(`Tile kind ${kind} defines circuit inputs without a gate behavior`);
      }
      this.driveOutputs(
        runtime,
        index,
        orientedSides(definition.circuitOutputPorts, orientation, mirrored),
        outputCharge,
      );
    }
  }

  private commitCharges(runtime: WorldRuntime): void {
    const world = runtime.world;
    if (!world.hasFeature(WorldFeature.Circuit)) {
      return;
    }
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

  /** Read the first detectable forward cell, continuing through enclosing edge-center ports. */
  private sensorObservedCharge(
    runtime: WorldRuntime,
    index: number,
    direction: Direction,
  ): Charge {
    while (true) {
      const world = runtime.world;
      const neighbor = neighborIndex(world, index, direction);
      if (neighbor >= 0) {
        const neighborKind = world.kindAtIndex(neighbor);
        if (
          neighborKind !== TileKind.Empty &&
          !TILE_DEFINITIONS[neighborKind].invisibleToSensor
        ) {
          return world.chargeAtPortIndex(neighbor, oppositeDirection(direction));
        }
        index = neighbor;
        continue;
      }
      if (
        runtime.parent === null ||
        index !== runeArrayPortCellIndex(world.width, world.height, direction)
      ) {
        return 0;
      }
      index = runtime.parentIndex;
      runtime = runtime.parent;
    }
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
    if (
      parent === null ||
      index !== runeArrayPortCellIndex(world.width, world.height, direction)
    ) {
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
      world.mirroredAtIndex(index),
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
  const ports = orientedSides(
    definition.circuitPorts, world.orientationAtIndex(index), world.mirroredAtIndex(index),
  );
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
