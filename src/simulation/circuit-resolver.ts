import { expectDefined } from "../util/assert";
import { chargeFromSum, type Charge } from "./circuit";
import { furnaceRecipeFor } from "./furnace";
import {
  Direction,
  orientedSides,
  oppositeDirection,
  TILE_DEFINITIONS,
  TileKind,
  type WeldSide,
} from "./tile";
import type { World } from "./world";

/** Resolves and commits circuit state using persistent, allocation-free scratch buffers. */
export class CircuitResolver {
  readonly furnaceDisabled: Uint8Array;

  private readonly world: World;
  private readonly roots: Int32Array;
  private readonly driveSums: Int32Array;
  private readonly nextCharges: Int8Array;
  private readonly nextCrossingVerticalCharges: Int8Array;

  constructor(world: World) {
    this.world = world;
    this.roots = new Int32Array(world.cellCount * 2);
    this.driveSums = new Int32Array(world.cellCount * 2);
    this.nextCharges = new Int8Array(world.cellCount);
    this.nextCrossingVerticalCharges = new Int8Array(world.cellCount);
    this.furnaceDisabled = new Uint8Array(world.cellCount);
  }

  resolve(tick: number, deliveryAbsorptionTargets: Int32Array): void {
    this.roots.fill(-1);
    this.driveSums.fill(0);
    this.nextCharges.fill(0);
    this.nextCrossingVerticalCharges.fill(0);
    this.furnaceDisabled.fill(0);

    for (let index = 0; index < this.world.cellCount; index += 1) {
      const kind = this.world.kindAtIndex(index);
      const definition = TILE_DEFINITIONS[kind];
      if (definition.circuitPorts === 0 || definition.circuitInputPorts !== 0) {
        continue;
      }

      const primaryNode = index * 2;
      this.roots[primaryNode] = primaryNode;
      if (kind === TileKind.WireCrossing) {
        this.roots[primaryNode + 1] = primaryNode + 1;
      }
    }

    for (let index = 0; index < this.world.cellCount; index += 1) {
      for (let value = Direction.Right; value <= Direction.Down; value += 1) {
        const direction = value as Direction;
        if (!this.world.hasCircuitConnectionAtIndex(index, direction)) {
          continue;
        }
        const neighbor = this.neighborIndex(index, direction);
        if (neighbor < 0) {
          throw new Error(`Connected circuit at index ${index} has no neighbor`);
        }
        const ownNode = this.circuitNode(index, direction);
        const neighborNode = this.circuitNode(neighbor, oppositeDirection(direction));
        if (
          expectDefined(this.roots[ownNode], "circuit root marker") >= 0 &&
          expectDefined(this.roots[neighborNode], "neighbor circuit root marker") >= 0
        ) {
          this.unionNodes(ownNode, neighborNode);
        }
      }
    }

    for (let index = 0; index < this.world.cellCount; index += 1) {
      const kind = this.world.kindAtIndex(index);
      let outputCharge: Charge;
      if (kind === TileKind.FixedCharge) {
        outputCharge = 1;
      } else if (kind === TileKind.Spark) {
        outputCharge = tick === 0 ? 1 : 0;
      } else if (kind === TileKind.Sensor) {
        outputCharge = this.world.sensorOutputAtIndex(index);
      } else if (kind === TileKind.Delivery) {
        outputCharge = expectDefined(
          deliveryAbsorptionTargets[index],
          "delivery absorption target",
        ) >= 0 ? 1 : 0;
      } else {
        continue;
      }

      if (outputCharge !== 0) {
        const root = this.findRoot(this.circuitNode(index, Direction.Up));
        this.driveSums[root] =
          expectDefined(this.driveSums[root], "circuit drive sum") + outputCharge;
      }
    }

    for (let index = 0; index < this.world.cellCount; index += 1) {
      const kind = this.world.kindAtIndex(index);
      const definition = TILE_DEFINITIONS[kind];
      if (definition.circuitInputPorts === 0 || kind === TileKind.Victory) {
        continue;
      }

      const orientation = this.world.orientationAtIndex(index);
      if (kind === TileKind.ChargeSensor) {
        const inputIndex = this.neighborIndex(index, orientation);
        const outputCharge = inputIndex < 0
          ? 0
          : this.world.chargeAtPortIndex(inputIndex, oppositeDirection(orientation));
        this.driveOutputs(
          index,
          orientedSides(definition.circuitOutputPorts, orientation),
          outputCharge,
        );
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
          !this.world.hasCircuitConnectionAtIndex(index, direction)
        ) {
          continue;
        }
        const inputIndex = this.neighborIndex(index, direction);
        if (inputIndex < 0) {
          throw new Error(`Connected circuit input at index ${index} has no neighbor`);
        }
        const inputCharge = this.world.chargeAtPortIndex(
          inputIndex,
          oppositeDirection(direction),
        );
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
        case TileKind.Furnace: {
          const disabled = rearInput !== 0;
          this.furnaceDisabled[index] = disabled ? 1 : 0;
          const targetIndex = this.neighborIndex(index, orientation);
          const targetKind = targetIndex < 0
            ? TileKind.Empty
            : this.world.kindAtIndex(targetIndex);
          outputCharge = !disabled && furnaceRecipeFor(targetKind) !== undefined ? 1 : 0;
          break;
        }
        default:
          throw new Error(`Tile kind ${kind} defines circuit inputs without a gate behavior`);
      }
      this.driveOutputs(
        index,
        orientedSides(definition.circuitOutputPorts, orientation),
        outputCharge,
      );
    }

    for (let index = 0; index < this.world.cellCount; index += 1) {
      const primaryNode = index * 2;
      if (expectDefined(this.roots[primaryNode], "circuit root marker") >= 0) {
        const root = this.findRoot(primaryNode);
        this.nextCharges[index] = chargeFromSum(
          expectDefined(this.driveSums[root], "circuit drive sum"),
        );
      }
      const verticalNode = primaryNode + 1;
      if (expectDefined(this.roots[verticalNode], "circuit root marker") >= 0) {
        const root = this.findRoot(verticalNode);
        this.nextCrossingVerticalCharges[index] = chargeFromSum(
          expectDefined(this.driveSums[root], "vertical circuit drive sum"),
        );
      }
    }
    this.world.applyCircuitCharges(
      this.nextCharges,
      this.nextCrossingVerticalCharges,
    );
  }

  private driveOutputs(index: number, outputSides: WeldSide, outputCharge: Charge): void {
    this.nextCharges[index] = outputCharge;
    for (let value = Direction.Up; value <= Direction.Left; value += 1) {
      const outputDirection = value as Direction;
      if ((outputSides & (1 << outputDirection)) === 0) {
        continue;
      }
      const outputIndex = this.neighborIndex(index, outputDirection);
      if (
        outputIndex < 0 ||
        !this.world.hasCircuitConnectionAtIndex(index, outputDirection)
      ) {
        continue;
      }
      const outputNode = this.circuitNode(
        outputIndex,
        oppositeDirection(outputDirection),
      );
      if (expectDefined(this.roots[outputNode], "output circuit root marker") < 0) {
        continue;
      }
      const outputRoot = this.findRoot(outputNode);
      this.driveSums[outputRoot] =
        expectDefined(this.driveSums[outputRoot], "circuit drive sum") + outputCharge;
    }
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

  private circuitNode(index: number, direction: Direction): number {
    const verticalAxis = this.world.kindAtIndex(index) === TileKind.WireCrossing &&
      (direction === Direction.Up || direction === Direction.Down);
    return index * 2 + (verticalAxis ? 1 : 0);
  }

  private neighborIndex(index: number, direction: Direction): number {
    const x = index % this.world.width;
    switch (direction) {
      case Direction.Up:
        return index >= this.world.width ? index - this.world.width : -1;
      case Direction.Right:
        return x < this.world.width - 1 ? index + 1 : -1;
      case Direction.Down:
        return index < this.world.cellCount - this.world.width
          ? index + this.world.width
          : -1;
      case Direction.Left:
        return x > 0 ? index - 1 : -1;
      default:
        throw new RangeError(`Invalid direction ${direction as number}`);
    }
  }

  private findRoot(index: number): number {
    let root = index;
    let parent = expectDefined(this.roots[root], "circuit parent");
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
