import { chargeFromSum, type Charge } from "./circuit";
import {
  Direction,
  directionX,
  directionY,
  orientedSides,
  TILE_DEFINITIONS,
  TileKind,
  WeldSide,
} from "./tile";
import { World } from "./world";
import { expectDefined } from "../util/assert";

/**
 * Advances a world in discrete ticks. Every movement decision is collected from
 * the start-of-tick state, then committed as a separate phase.
 */
export class Simulation {
  readonly world: World;
  tick = 0;

  private readonly bodyRoots: Int32Array;
  private readonly bodyHeads: Int32Array;
  private readonly nextBodyMember: Int32Array;
  private readonly bodyFalls: Uint8Array;
  private readonly bodySlidesDiagonally: Uint8Array;
  private readonly horizontalMoves: Int8Array;
  private readonly jammedBodies: Uint8Array;
  private readonly destinationOwners: Int32Array;
  private readonly dependencyHeads: Int32Array;
  private readonly dependencyDependents: Int32Array;
  private readonly nextDependency: Int32Array;
  private readonly blockedBodyQueue: Int32Array;
  private readonly circuitRoots: Int32Array;
  private readonly circuitDriveSums: Int32Array;
  private readonly nextCircuitCharges: Int8Array;

  constructor(world: World) {
    this.world = world;
    this.bodyRoots = new Int32Array(world.cellCount);
    this.bodyHeads = new Int32Array(world.cellCount);
    this.nextBodyMember = new Int32Array(world.cellCount);
    this.bodyFalls = new Uint8Array(world.cellCount);
    this.bodySlidesDiagonally = new Uint8Array(world.cellCount);
    this.horizontalMoves = new Int8Array(world.cellCount);
    this.jammedBodies = new Uint8Array(world.cellCount);
    this.destinationOwners = new Int32Array(world.cellCount);
    this.dependencyHeads = new Int32Array(world.cellCount);
    this.dependencyDependents = new Int32Array(world.cellCount);
    this.nextDependency = new Int32Array(world.cellCount);
    this.blockedBodyQueue = new Int32Array(world.cellCount);
    this.circuitRoots = new Int32Array(world.cellCount);
    this.circuitDriveSums = new Int32Array(world.cellCount);
    this.nextCircuitCharges = new Int8Array(world.cellCount);
  }

  step(): number {
    this.resolveCircuits();
    this.collectWeldedBodies();
    this.connectMagneticallyAttractedBodies();
    this.collectBodyMembers();
    this.chooseMovements();
    this.resolveDestinationConflicts();

    const movementCount = this.world.moveBodiesDown(this.bodyRoots, this.horizontalMoves);
    this.tick += 1;
    return movementCount;
  }

  resetTo(snapshot: World): void {
    this.world.copyFrom(snapshot);
    this.tick = 0;
  }

  private resolveCircuits(): void {
    this.circuitRoots.fill(-1);
    this.circuitDriveSums.fill(0);
    this.nextCircuitCharges.fill(0);

    for (let index = 0; index < this.world.cellCount; index += 1) {
      const definition = TILE_DEFINITIONS[this.world.kindAtIndex(index)];
      if (
        definition.circuitPorts !== 0 &&
        definition.circuitInputPorts === 0
      ) {
        this.circuitRoots[index] = index;
      }
    }

    for (let index = 0; index < this.world.cellCount; index += 1) {
      if (expectDefined(this.circuitRoots[index], "circuit root marker") < 0) {
        continue;
      }
      if (
        this.world.hasCircuitConnectionAtIndex(index, Direction.Right) &&
        expectDefined(this.circuitRoots[index + 1], "neighbor circuit root marker") >= 0
      ) {
        this.unionCircuitTiles(index, index + 1);
      }
      if (
        this.world.hasCircuitConnectionAtIndex(index, Direction.Down) &&
        expectDefined(
          this.circuitRoots[index + this.world.width],
          "neighbor circuit root marker",
        ) >= 0
      ) {
        this.unionCircuitTiles(index, index + this.world.width);
      }
    }

    for (let index = 0; index < this.world.cellCount; index += 1) {
      if (this.world.kindAtIndex(index) !== TileKind.Sensor) {
        continue;
      }

      const outputCharge = this.world.sensorOutputAtIndex(index);
      if (outputCharge !== 0) {
        const root = this.findCircuitRoot(index);
        this.circuitDriveSums[root] =
          expectDefined(this.circuitDriveSums[root], "circuit drive sum") + outputCharge;
      }
    }

    for (let index = 0; index < this.world.cellCount; index += 1) {
      const kind = this.world.kindAtIndex(index);
      const definition = TILE_DEFINITIONS[kind];
      if (definition.circuitInputPorts === 0) {
        continue;
      }

      const orientation = this.world.orientationAtIndex(index);
      if (kind === TileKind.ChargeSensor) {
        const inputIndex = this.neighborIndex(index, orientation);
        const outputCharge = inputIndex < 0 ? 0 : this.world.chargeAtIndex(inputIndex);
        this.driveCircuitOutputs(
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
        const inputCharge = this.world.chargeAtIndex(inputIndex);
        if (kind === TileKind.Multiplier) {
          inputProduct *= inputCharge;
        }
        inputSum += inputCharge;
        const relativeDirection = ((direction - orientation + 4) & 3) as Direction;
        if (relativeDirection === Direction.Left) {
          leftInput = inputCharge;
        } else if (relativeDirection === Direction.Right) {
          rightInput = inputCharge;
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
        default:
          throw new Error(`Tile kind ${kind} defines circuit inputs without a gate behavior`);
      }
      this.driveCircuitOutputs(
        index,
        orientedSides(definition.circuitOutputPorts, orientation),
        outputCharge,
      );
    }

    for (let index = 0; index < this.world.cellCount; index += 1) {
      if (expectDefined(this.circuitRoots[index], "circuit root marker") < 0) {
        continue;
      }
      const root = this.findCircuitRoot(index);
      this.nextCircuitCharges[index] = chargeFromSum(
        expectDefined(this.circuitDriveSums[root], "circuit drive sum"),
      );
    }
    this.world.applyCircuitCharges(this.nextCircuitCharges);
  }

  private driveCircuitOutputs(
    index: number,
    outputSides: WeldSide,
    outputCharge: Charge,
  ): void {
    this.nextCircuitCharges[index] = outputCharge;
    for (let value = Direction.Up; value <= Direction.Left; value += 1) {
      const outputDirection = value as Direction;
      if ((outputSides & (1 << outputDirection)) === 0) {
        continue;
      }
      const outputIndex = this.neighborIndex(index, outputDirection);
      if (
        outputIndex < 0 ||
        !this.world.hasCircuitConnectionAtIndex(index, outputDirection) ||
        expectDefined(this.circuitRoots[outputIndex], "output circuit root marker") < 0
      ) {
        continue;
      }
      const outputRoot = this.findCircuitRoot(outputIndex);
      this.circuitDriveSums[outputRoot] =
        expectDefined(this.circuitDriveSums[outputRoot], "circuit drive sum") + outputCharge;
    }
  }

  private unionCircuitTiles(first: number, second: number): void {
    const firstRoot = this.findCircuitRoot(first);
    const secondRoot = this.findCircuitRoot(second);
    if (firstRoot === secondRoot) {
      return;
    }
    if (firstRoot < secondRoot) {
      this.circuitRoots[secondRoot] = firstRoot;
    } else {
      this.circuitRoots[firstRoot] = secondRoot;
    }
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
        throw new RangeError(`Invalid circuit direction ${direction as number}`);
    }
  }

  private findCircuitRoot(index: number): number {
    let root = index;
    let parent = expectDefined(this.circuitRoots[root], "circuit parent");
    while (parent !== root) {
      root = parent;
      parent = expectDefined(this.circuitRoots[root], "circuit parent");
    }
    while (index !== root) {
      const nextIndex = expectDefined(this.circuitRoots[index], "circuit parent");
      this.circuitRoots[index] = root;
      index = nextIndex;
    }
    return root;
  }

  private collectWeldedBodies(): void {
    this.bodyRoots.fill(-1);
    for (let index = 0; index < this.world.cellCount; index += 1) {
      if (this.world.kindAtIndex(index) !== TileKind.Empty) {
        this.bodyRoots[index] = index;
      }
    }

    for (let index = 0; index < this.world.cellCount; index += 1) {
      if ((this.bodyRoots[index] ?? -1) < 0) {
        continue;
      }
      if (this.world.hasRightWeldAtIndex(index)) {
        this.unionBodies(index, index + 1);
      }
      if (this.world.hasDownWeldAtIndex(index)) {
        this.unionBodies(index, index + this.world.width);
      }
    }
  }

  /**
   * Magnetic contact constrains two bodies against separating; it does not
   * override gravity. Treating each connected set as one movement group lets
   * an unsupported set fall while support under any member holds the set.
   */
  private connectMagneticallyAttractedBodies(): void {
    for (let magnet = 0; magnet < this.world.cellCount; magnet += 1) {
      const magnetDefinition = TILE_DEFINITIONS[this.world.kindAtIndex(magnet)];
      if (magnetDefinition.attractionRange === 0) {
        continue;
      }

      const orientation = this.world.orientationAtIndex(magnet);
      const stepX = directionX(orientation);
      const stepY = directionY(orientation);
      const magnetX = magnet % this.world.width;
      const magnetY = Math.floor(magnet / this.world.width);
      for (let distance = 1; distance <= magnetDefinition.attractionRange; distance += 1) {
        const targetX = magnetX + stepX * distance;
        const targetY = magnetY + stepY * distance;
        if (
          targetX < 0 ||
          targetX >= this.world.width ||
          targetY < 0 ||
          targetY >= this.world.height
        ) {
          break;
        }

        const target = targetY * this.world.width + targetX;
        const targetKind = this.world.kindAtIndex(target);
        if (targetKind === TileKind.Empty) {
          continue;
        }
        if (TILE_DEFINITIONS[targetKind].magnetic) {
          this.unionBodies(magnet, target);
        }
        break;
      }
    }
  }

  private collectBodyMembers(): void {
    this.bodyHeads.fill(-1);
    this.bodyFalls.fill(1);
    this.bodySlidesDiagonally.fill(1);
    for (let index = this.world.cellCount - 1; index >= 0; index -= 1) {
      if ((this.bodyRoots[index] ?? -1) < 0) {
        continue;
      }

      const root = this.findBodyRoot(index);
      this.bodyRoots[index] = root;
      this.nextBodyMember[index] = this.bodyHeads[root] ?? -1;
      this.bodyHeads[root] = index;
      const definition = TILE_DEFINITIONS[this.world.kindAtIndex(index)];
      if (!definition.affectedByGravity) {
        this.bodyFalls[root] = 0;
      }
      if (!definition.slidesDiagonally) {
        this.bodySlidesDiagonally[root] = 0;
      }
    }
  }

  private chooseMovements(): void {
    this.horizontalMoves.fill(2);
    this.jammedBodies.fill(0);
    this.dependencyHeads.fill(-1);
    let dependencyCount = 0;

    for (let root = 0; root < this.world.cellCount; root += 1) {
      if ((this.bodyHeads[root] ?? -1) < 0) {
        continue;
      }
      if (this.bodyFalls[root] === 0) {
        this.jammedBodies[root] = 1;
        continue;
      }

      this.horizontalMoves[root] = 0;
      for (let member = this.bodyHeads[root] ?? -1; member >= 0; member = this.nextBodyMember[member] ?? -1) {
        if (member >= this.world.cellCount - this.world.width) {
          this.jammedBodies[root] = 1;
          continue;
        }

        const blocker = this.bodyRoots[member + this.world.width] ?? -1;
        if (blocker < 0 || blocker === root) {
          continue;
        }

        this.dependencyDependents[dependencyCount] = root;
        this.nextDependency[dependencyCount] = this.dependencyHeads[blocker] ?? -1;
        this.dependencyHeads[blocker] = dependencyCount;
        dependencyCount += 1;
      }
    }

    let queueHead = 0;
    let queueLength = 0;
    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (this.jammedBodies[root] === 1) {
        this.horizontalMoves[root] = 2;
        this.blockedBodyQueue[queueLength] = root;
        queueLength += 1;
      }
    }

    while (queueHead < queueLength) {
      const blocker = this.blockedBodyQueue[queueHead] ?? -1;
      queueHead += 1;
      for (
        let dependency = this.dependencyHeads[blocker] ?? -1;
        dependency >= 0;
        dependency = this.nextDependency[dependency] ?? -1
      ) {
        const dependent = this.dependencyDependents[dependency] ?? -1;
        if (this.jammedBodies[dependent] === 1) {
          continue;
        }
        this.jammedBodies[dependent] = 1;
        this.horizontalMoves[dependent] = 2;
        this.blockedBodyQueue[queueLength] = dependent;
        queueLength += 1;
      }
    }

    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (
        (this.bodyHeads[root] ?? -1) < 0 ||
        this.bodyFalls[root] === 0 ||
        this.horizontalMoves[root] === 0 ||
        this.bodySlidesDiagonally[root] === 0
      ) {
        continue;
      }

      const rootX = root % this.world.width;
      const rootY = Math.floor(root / this.world.width);
      const preferredDirection: -1 | 1 = (rootX + rootY + this.tick) % 2 === 0 ? -1 : 1;
      const alternateDirection: -1 | 1 = preferredDirection === -1 ? 1 : -1;
      if (this.canBodyMove(root, preferredDirection)) {
        this.horizontalMoves[root] = preferredDirection;
      } else if (this.canBodyMove(root, alternateDirection)) {
        this.horizontalMoves[root] = alternateDirection;
      }
    }
  }

  private resolveDestinationConflicts(): void {
    this.destinationOwners.fill(-1);
    this.jammedBodies.fill(0);

    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (this.horizontalMoves[root] !== 0) {
        continue;
      }
      for (let member = this.bodyHeads[root] ?? -1; member >= 0; member = this.nextBodyMember[member] ?? -1) {
        this.destinationOwners[member + this.world.width] = root;
      }
    }

    for (let root = 0; root < this.world.cellCount; root += 1) {
      const horizontalMove = this.horizontalMoves[root] ?? 2;
      if (horizontalMove !== -1 && horizontalMove !== 1) {
        continue;
      }
      for (let member = this.bodyHeads[root] ?? -1; member >= 0; member = this.nextBodyMember[member] ?? -1) {
        const destination = member + this.world.width + horizontalMove;
        if ((this.destinationOwners[destination] ?? -1) >= 0) {
          this.jammedBodies[root] = 1;
          break;
        }
      }
    }

    for (let root = 0; root < this.world.cellCount; root += 1) {
      const horizontalMove = this.horizontalMoves[root] ?? 2;
      if (
        this.jammedBodies[root] === 1 ||
        (horizontalMove !== -1 && horizontalMove !== 1)
      ) {
        continue;
      }

      for (let member = this.bodyHeads[root] ?? -1; member >= 0; member = this.nextBodyMember[member] ?? -1) {
        const destination = member + this.world.width + horizontalMove;
        const owner = this.destinationOwners[destination] ?? -1;
        if (owner >= 0 && owner !== root) {
          this.jammedBodies[root] = 1;
          this.jammedBodies[owner] = 1;
        } else {
          this.destinationOwners[destination] = root;
        }
      }
    }

    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (this.jammedBodies[root] === 1) {
        this.horizontalMoves[root] = 2;
      }
    }
  }

  private canBodyMove(root: number, horizontalMove: -1 | 1): boolean {
    for (let member = this.bodyHeads[root] ?? -1; member >= 0; member = this.nextBodyMember[member] ?? -1) {
      const x = member % this.world.width;
      const y = Math.floor(member / this.world.width);
      const destinationX = x + horizontalMove;
      if (y >= this.world.height - 1 || destinationX < 0 || destinationX >= this.world.width) {
        return false;
      }

      const destination = member + this.world.width + horizontalMove;
      if (
        this.world.kindAtIndex(destination) !== TileKind.Empty &&
        this.bodyRoots[destination] !== root
      ) {
        return false;
      }
    }
    return true;
  }

  private unionBodies(first: number, second: number): void {
    const firstRoot = this.findBodyRoot(first);
    const secondRoot = this.findBodyRoot(second);
    if (firstRoot === secondRoot) {
      return;
    }

    if (firstRoot < secondRoot) {
      this.bodyRoots[secondRoot] = firstRoot;
    } else {
      this.bodyRoots[firstRoot] = secondRoot;
    }
  }

  private findBodyRoot(index: number): number {
    let root = index;
    while (this.bodyRoots[root] !== root) {
      root = this.bodyRoots[root] ?? -1;
    }

    while (index !== root) {
      const parent = this.bodyRoots[index] ?? root;
      this.bodyRoots[index] = root;
      index = parent;
    }
    return root;
  }
}
