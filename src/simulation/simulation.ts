import { chargeFromSum, type Charge } from "./circuit";
import { furnaceRecipeFor } from "./furnace";
import {
  Direction,
  directionX,
  directionY,
  orientedSides,
  oppositeDirection,
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
  private readonly verticalMoves: Int8Array;
  private readonly bodyForceX: Int32Array;
  private readonly bodyForceY: Int32Array;
  private readonly drivenBodies: Uint8Array;
  private readonly movementGroupRoots: Int32Array;
  private readonly blockedMovementGroups: Uint8Array;
  private readonly movementQueue: Int32Array;
  private readonly jammedBodies: Uint8Array;
  private readonly destinationOwners: Int32Array;
  private readonly dependencyHeads: Int32Array;
  private readonly dependencyDependents: Int32Array;
  private readonly nextDependency: Int32Array;
  private readonly blockedBodyQueue: Int32Array;
  private readonly circuitRoots: Int32Array;
  private readonly circuitDriveSums: Int32Array;
  private readonly nextCircuitCharges: Int8Array;
  private readonly nextCrossingVerticalCharges: Int8Array;
  private readonly furnaceDisabled: Uint8Array;
  private readonly nextFurnaceProgress: Uint16Array;
  private readonly nextFurnaceTargetIds: Uint32Array;
  private readonly furnaceTransformTargetIndices: Int32Array;
  private readonly furnaceTransformKinds: Uint8Array;

  constructor(world: World) {
    this.world = world;
    this.bodyRoots = new Int32Array(world.cellCount);
    this.bodyHeads = new Int32Array(world.cellCount);
    this.nextBodyMember = new Int32Array(world.cellCount);
    this.bodyFalls = new Uint8Array(world.cellCount);
    this.bodySlidesDiagonally = new Uint8Array(world.cellCount);
    this.horizontalMoves = new Int8Array(world.cellCount);
    this.verticalMoves = new Int8Array(world.cellCount);
    this.bodyForceX = new Int32Array(world.cellCount);
    this.bodyForceY = new Int32Array(world.cellCount);
    this.drivenBodies = new Uint8Array(world.cellCount);
    this.movementGroupRoots = new Int32Array(world.cellCount);
    this.blockedMovementGroups = new Uint8Array(world.cellCount);
    this.movementQueue = new Int32Array(world.cellCount);
    this.jammedBodies = new Uint8Array(world.cellCount);
    this.destinationOwners = new Int32Array(world.cellCount);
    this.dependencyHeads = new Int32Array(world.cellCount);
    this.dependencyDependents = new Int32Array(world.cellCount);
    this.nextDependency = new Int32Array(world.cellCount);
    this.blockedBodyQueue = new Int32Array(world.cellCount);
    this.circuitRoots = new Int32Array(world.cellCount * 2);
    this.circuitDriveSums = new Int32Array(world.cellCount * 2);
    this.nextCircuitCharges = new Int8Array(world.cellCount);
    this.nextCrossingVerticalCharges = new Int8Array(world.cellCount);
    this.furnaceDisabled = new Uint8Array(world.cellCount);
    this.nextFurnaceProgress = new Uint16Array(world.cellCount);
    this.nextFurnaceTargetIds = new Uint32Array(world.cellCount);
    this.furnaceTransformTargetIndices = new Int32Array(world.cellCount);
    this.furnaceTransformKinds = new Uint8Array(world.cellCount);
  }

  step(): number {
    this.resolveCircuits();
    this.resolveFurnaces();
    this.collectWeldedBodies();
    this.connectMagneticallyAttractedBodies();
    this.collectBodyMembers();
    this.chooseMovements();
    this.resolveDestinationConflicts();

    const movementCount = this.world.moveBodies(
      this.bodyRoots,
      this.horizontalMoves,
      this.verticalMoves,
    );
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
    this.nextCrossingVerticalCharges.fill(0);
    this.furnaceDisabled.fill(0);

    for (let index = 0; index < this.world.cellCount; index += 1) {
      const kind = this.world.kindAtIndex(index);
      const definition = TILE_DEFINITIONS[kind];
      if (definition.circuitPorts === 0 || definition.circuitInputPorts !== 0) {
        continue;
      }

      const primaryNode = index * 2;
      this.circuitRoots[primaryNode] = primaryNode;
      if (kind === TileKind.WireCrossing) {
        this.circuitRoots[primaryNode + 1] = primaryNode + 1;
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
          expectDefined(this.circuitRoots[ownNode], "circuit root marker") >= 0 &&
          expectDefined(this.circuitRoots[neighborNode], "neighbor circuit root marker") >= 0
        ) {
          this.unionCircuitNodes(ownNode, neighborNode);
        }
      }
    }

    for (let index = 0; index < this.world.cellCount; index += 1) {
      if (this.world.kindAtIndex(index) !== TileKind.Sensor) {
        continue;
      }

      const outputCharge = this.world.sensorOutputAtIndex(index);
      if (outputCharge !== 0) {
        const root = this.findCircuitRoot(this.circuitNode(index, Direction.Up));
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
        const outputCharge = inputIndex < 0
          ? 0
          : this.world.chargeAtPortIndex(inputIndex, oppositeDirection(orientation));
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
      this.driveCircuitOutputs(
        index,
        orientedSides(definition.circuitOutputPorts, orientation),
        outputCharge,
      );
    }

    for (let index = 0; index < this.world.cellCount; index += 1) {
      const primaryNode = index * 2;
      if (expectDefined(this.circuitRoots[primaryNode], "circuit root marker") >= 0) {
        const root = this.findCircuitRoot(primaryNode);
        this.nextCircuitCharges[index] = chargeFromSum(
          expectDefined(this.circuitDriveSums[root], "circuit drive sum"),
        );
      }
      const verticalNode = primaryNode + 1;
      if (expectDefined(this.circuitRoots[verticalNode], "circuit root marker") >= 0) {
        const root = this.findCircuitRoot(verticalNode);
        this.nextCrossingVerticalCharges[index] = chargeFromSum(
          expectDefined(this.circuitDriveSums[root], "vertical circuit drive sum"),
        );
      }
    }
    this.world.applyCircuitCharges(
      this.nextCircuitCharges,
      this.nextCrossingVerticalCharges,
    );
  }

  private resolveFurnaces(): void {
    this.nextFurnaceProgress.fill(0);
    this.nextFurnaceTargetIds.fill(0);
    this.furnaceTransformTargetIndices.fill(-1);
    this.furnaceTransformKinds.fill(TileKind.Empty);

    for (let index = 0; index < this.world.cellCount; index += 1) {
      if (this.world.kindAtIndex(index) !== TileKind.Furnace) {
        continue;
      }

      const targetIndex = this.neighborIndex(index, this.world.orientationAtIndex(index));
      if (targetIndex < 0) {
        continue;
      }
      const recipe = furnaceRecipeFor(this.world.kindAtIndex(targetIndex));
      if (recipe === undefined) {
        continue;
      }
      const targetId = this.world.idAtIndex(targetIndex);
      const previousTargetId = this.world.furnaceTargetIdAtIndex(index);
      const previousProgress = this.world.furnaceProgressAtIndex(index);
      if (this.furnaceDisabled[index] === 1) {
        if (targetId === previousTargetId && previousProgress > 0) {
          this.nextFurnaceProgress[index] = previousProgress;
          this.nextFurnaceTargetIds[index] = targetId;
        }
        continue;
      }

      const progress = targetId === previousTargetId ? previousProgress + 1 : 1;
      this.nextFurnaceTargetIds[index] = targetId;
      if (progress < recipe.bakeTime) {
        this.nextFurnaceProgress[index] = progress;
        continue;
      }
      this.furnaceTransformTargetIndices[index] = targetIndex;
      this.furnaceTransformKinds[index] = recipe.output;
    }

    this.world.applyFurnaceResults(
      this.nextFurnaceProgress,
      this.nextFurnaceTargetIds,
      this.furnaceTransformTargetIndices,
      this.furnaceTransformKinds,
    );
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
        !this.world.hasCircuitConnectionAtIndex(index, outputDirection)
      ) {
        continue;
      }
      const outputNode = this.circuitNode(
        outputIndex,
        oppositeDirection(outputDirection),
      );
      if (expectDefined(this.circuitRoots[outputNode], "output circuit root marker") < 0) {
        continue;
      }
      const outputRoot = this.findCircuitRoot(outputNode);
      this.circuitDriveSums[outputRoot] =
        expectDefined(this.circuitDriveSums[outputRoot], "circuit drive sum") + outputCharge;
    }
  }

  private unionCircuitNodes(first: number, second: number): void {
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
    this.horizontalMoves.fill(0);
    this.verticalMoves.fill(0);
    this.collectConveyorForces();
    this.resolveDrivenMovements();
    this.chooseGravityMovements();
  }

  private collectConveyorForces(): void {
    this.bodyForceX.fill(0);
    this.bodyForceY.fill(0);
    for (let index = 0; index < this.world.cellCount; index += 1) {
      if (this.world.kindAtIndex(index) !== TileKind.Conveyor) {
        continue;
      }
      const charge = this.world.chargeAtPortIndex(index, Direction.Up);
      if (charge === 0) {
        continue;
      }

      const conveyorRoot = expectDefined(this.bodyRoots[index], "conveyor body root");
      for (let value = Direction.Up; value <= Direction.Left; value += 1) {
        const side = value as Direction;
        const neighbor = this.neighborIndex(index, side);
        if (neighbor < 0 || this.world.kindAtIndex(neighbor) === TileKind.Empty) {
          continue;
        }
        const neighborRoot = expectDefined(this.bodyRoots[neighbor], "conveyor neighbor body root");
        if (neighborRoot === conveyorRoot) {
          continue;
        }

        const forceDirection = ((side + charge + 4) & 3) as Direction;
        this.addBodyForce(neighborRoot, forceDirection);
        this.addBodyForce(conveyorRoot, oppositeDirection(forceDirection));
      }
    }
  }

  private addBodyForce(root: number, direction: Direction): void {
    this.bodyForceX[root] =
      expectDefined(this.bodyForceX[root], "horizontal body force") + directionX(direction);
    this.bodyForceY[root] =
      expectDefined(this.bodyForceY[root], "vertical body force") + directionY(direction);
  }

  private resolveDrivenMovements(): void {
    this.drivenBodies.fill(0);
    this.movementGroupRoots.fill(-1);
    this.blockedMovementGroups.fill(0);
    let queueLength = 0;

    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (expectDefined(this.bodyHeads[root], "body head") < 0) {
        continue;
      }
      this.movementGroupRoots[root] = root;
    }

    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (expectDefined(this.bodyHeads[root], "body head") < 0) {
        continue;
      }
      const forceX = expectDefined(this.bodyForceX[root], "horizontal body force");
      const forceY = expectDefined(this.bodyForceY[root], "vertical body force");
      if (forceX === 0 && forceY === 0) {
        continue;
      }
      this.horizontalMoves[root] = forceX < 0 ? -1 : forceX > 0 ? 1 : 0;
      this.verticalMoves[root] = forceY < 0 ? -1 : forceY > 0 ? 1 : 0;
      this.drivenBodies[root] = 1;
      this.movementQueue[queueLength] = root;
      queueLength += 1;
      if (this.bodyFalls[root] === 0) {
        this.blockMovementGroup(root);
      }
    }

    let queueHead = 0;
    while (queueHead < queueLength) {
      const root = expectDefined(this.movementQueue[queueHead], "driven movement queue entry");
      queueHead += 1;
      const moveX = expectDefined(this.horizontalMoves[root], "horizontal driven movement");
      const moveY = expectDefined(this.verticalMoves[root], "vertical driven movement");
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        const x = member % this.world.width;
        const y = (member - x) / this.world.width;
        const destinationX = x + moveX;
        const destinationY = y + moveY;
        if (
          destinationX < 0 ||
          destinationX >= this.world.width ||
          destinationY < 0 ||
          destinationY >= this.world.height
        ) {
          this.blockMovementGroup(root);
          continue;
        }

        const destination = destinationY * this.world.width + destinationX;
        const blocker = expectDefined(this.bodyRoots[destination], "destination body root");
        if (blocker < 0 || blocker === root) {
          continue;
        }
        if (this.bodyFalls[blocker] === 0) {
          this.blockMovementGroup(root);
          continue;
        }
        if (this.drivenBodies[blocker] === 0) {
          this.drivenBodies[blocker] = 1;
          this.horizontalMoves[blocker] = moveX;
          this.verticalMoves[blocker] = moveY;
          this.movementQueue[queueLength] = blocker;
          queueLength += 1;
          this.unionMovementGroups(root, blocker);
          continue;
        }
        if (
          this.horizontalMoves[blocker] !== moveX ||
          this.verticalMoves[blocker] !== moveY
        ) {
          this.blockMovementGroup(root);
          this.blockMovementGroup(blocker);
          continue;
        }
        this.unionMovementGroups(root, blocker);
      }
    }

    this.destinationOwners.fill(-1);
    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (
        this.drivenBodies[root] === 0 ||
        this.isMovementGroupBlocked(root)
      ) {
        continue;
      }
      const moveX = expectDefined(this.horizontalMoves[root], "horizontal driven movement");
      const moveY = expectDefined(this.verticalMoves[root], "vertical driven movement");
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        const destination = member + moveX + moveY * this.world.width;
        const owner = expectDefined(this.destinationOwners[destination], "destination owner");
        if (
          owner >= 0 &&
          this.findMovementGroup(owner) !== this.findMovementGroup(root)
        ) {
          this.blockMovementGroup(root);
          this.blockMovementGroup(owner);
        } else {
          this.destinationOwners[destination] = root;
        }
      }
    }

    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (this.drivenBodies[root] === 1 && this.isMovementGroupBlocked(root)) {
        this.horizontalMoves[root] = 0;
        this.verticalMoves[root] = 0;
      }
    }
  }

  private chooseGravityMovements(): void {
    this.destinationOwners.fill(-1);
    this.jammedBodies.fill(0);
    this.dependencyHeads.fill(-1);
    let dependencyCount = 0;

    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (
        this.drivenBodies[root] === 0 ||
        this.horizontalMoves[root] === 0 && this.verticalMoves[root] === 0
      ) {
        continue;
      }
      const moveX = expectDefined(this.horizontalMoves[root], "horizontal driven movement");
      const moveY = expectDefined(this.verticalMoves[root], "vertical driven movement");
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        this.destinationOwners[member + moveX + moveY * this.world.width] = root;
      }
    }

    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (
        expectDefined(this.bodyHeads[root], "body head") < 0 ||
        this.drivenBodies[root] === 1
      ) {
        continue;
      }
      if (this.bodyFalls[root] === 0) {
        this.jammedBodies[root] = 1;
        continue;
      }

      this.verticalMoves[root] = 1;
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        if (member >= this.world.cellCount - this.world.width) {
          this.jammedBodies[root] = 1;
          continue;
        }
        const destination = member + this.world.width;
        if (expectDefined(this.destinationOwners[destination], "destination owner") >= 0) {
          this.jammedBodies[root] = 1;
          continue;
        }
        const blocker = expectDefined(this.bodyRoots[destination], "gravity blocker root");
        if (blocker < 0 || blocker === root) {
          continue;
        }
        if (this.drivenBodies[blocker] === 1) {
          this.jammedBodies[root] = 1;
          continue;
        }

        this.dependencyDependents[dependencyCount] = root;
        this.nextDependency[dependencyCount] = expectDefined(
          this.dependencyHeads[blocker],
          "gravity dependency head",
        );
        this.dependencyHeads[blocker] = dependencyCount;
        dependencyCount += 1;
      }
    }

    let queueHead = 0;
    let queueLength = 0;
    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (this.jammedBodies[root] === 1) {
        this.blockedBodyQueue[queueLength] = root;
        queueLength += 1;
      }
    }
    while (queueHead < queueLength) {
      const blocker = expectDefined(this.blockedBodyQueue[queueHead], "blocked body queue entry");
      queueHead += 1;
      for (
        let dependency = expectDefined(
          this.dependencyHeads[blocker],
          "gravity dependency head",
        );
        dependency >= 0;
        dependency = expectDefined(this.nextDependency[dependency], "next gravity dependency")
      ) {
        const dependent = expectDefined(
          this.dependencyDependents[dependency],
          "gravity dependent",
        );
        if (this.jammedBodies[dependent] === 1) {
          continue;
        }
        this.jammedBodies[dependent] = 1;
        this.blockedBodyQueue[queueLength] = dependent;
        queueLength += 1;
      }
    }

    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (this.jammedBodies[root] === 1 && this.drivenBodies[root] === 0) {
        this.horizontalMoves[root] = 0;
        this.verticalMoves[root] = 0;
      }
    }

    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (
        expectDefined(this.bodyHeads[root], "body head") < 0 ||
        this.drivenBodies[root] === 1 ||
        this.bodyFalls[root] === 0 ||
        this.jammedBodies[root] === 0 ||
        this.bodySlidesDiagonally[root] === 0
      ) {
        continue;
      }
      const rootX = root % this.world.width;
      const rootY = (root - rootX) / this.world.width;
      const preferredDirection: -1 | 1 = (rootX + rootY + this.tick) % 2 === 0 ? -1 : 1;
      const alternateDirection: -1 | 1 = preferredDirection === -1 ? 1 : -1;
      if (this.canGravityBodyMove(root, preferredDirection)) {
        this.horizontalMoves[root] = preferredDirection;
        this.verticalMoves[root] = 1;
        this.jammedBodies[root] = 0;
      } else if (this.canGravityBodyMove(root, alternateDirection)) {
        this.horizontalMoves[root] = alternateDirection;
        this.verticalMoves[root] = 1;
        this.jammedBodies[root] = 0;
      }
    }
  }

  private resolveDestinationConflicts(): void {
    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (
        this.drivenBodies[root] === 1 ||
        this.horizontalMoves[root] !== 0 ||
        this.verticalMoves[root] !== 1
      ) {
        continue;
      }
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        const destination = member + this.world.width;
        const owner = expectDefined(this.destinationOwners[destination], "destination owner");
        if (owner >= 0 && owner !== root) {
          this.jammedBodies[root] = 1;
          break;
        }
        this.destinationOwners[destination] = root;
      }
    }

    for (let root = 0; root < this.world.cellCount; root += 1) {
      const horizontalMove = expectDefined(
        this.horizontalMoves[root],
        "horizontal gravity movement",
      );
      if (
        this.drivenBodies[root] === 1 ||
        (horizontalMove !== -1 && horizontalMove !== 1) ||
        this.verticalMoves[root] !== 1
      ) {
        continue;
      }
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        const destination = member + this.world.width + horizontalMove;
        if (expectDefined(this.destinationOwners[destination], "destination owner") >= 0) {
          this.jammedBodies[root] = 1;
          break;
        }
      }
    }

    for (let root = 0; root < this.world.cellCount; root += 1) {
      const horizontalMove = expectDefined(
        this.horizontalMoves[root],
        "horizontal gravity movement",
      );
      if (
        this.drivenBodies[root] === 1 ||
        this.jammedBodies[root] === 1 ||
        (horizontalMove !== -1 && horizontalMove !== 1) ||
        this.verticalMoves[root] !== 1
      ) {
        continue;
      }
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        const destination = member + this.world.width + horizontalMove;
        const owner = expectDefined(this.destinationOwners[destination], "destination owner");
        if (owner >= 0 && owner !== root) {
          this.jammedBodies[root] = 1;
          this.jammedBodies[owner] = 1;
        } else {
          this.destinationOwners[destination] = root;
        }
      }
    }

    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (this.drivenBodies[root] === 0 && this.jammedBodies[root] === 1) {
        this.horizontalMoves[root] = 0;
        this.verticalMoves[root] = 0;
      }
    }
  }

  private canGravityBodyMove(root: number, horizontalMove: -1 | 1): boolean {
    for (
      let member = expectDefined(this.bodyHeads[root], "body head");
      member >= 0;
      member = expectDefined(this.nextBodyMember[member], "next body member")
    ) {
      const x = member % this.world.width;
      const y = (member - x) / this.world.width;
      const destinationX = x + horizontalMove;
      if (y >= this.world.height - 1 || destinationX < 0 || destinationX >= this.world.width) {
        return false;
      }
      const destination = member + this.world.width + horizontalMove;
      if (
        expectDefined(this.destinationOwners[destination], "destination owner") >= 0 ||
        this.world.kindAtIndex(destination) !== TileKind.Empty &&
          this.bodyRoots[destination] !== root
      ) {
        return false;
      }
    }
    return true;
  }

  private blockMovementGroup(root: number): void {
    this.blockedMovementGroups[this.findMovementGroup(root)] = 1;
  }

  private isMovementGroupBlocked(root: number): boolean {
    return this.blockedMovementGroups[this.findMovementGroup(root)] === 1;
  }

  private unionMovementGroups(first: number, second: number): void {
    const firstRoot = this.findMovementGroup(first);
    const secondRoot = this.findMovementGroup(second);
    if (firstRoot === secondRoot) {
      return;
    }
    const combinedRoot = Math.min(firstRoot, secondRoot);
    const removedRoot = Math.max(firstRoot, secondRoot);
    this.movementGroupRoots[removedRoot] = combinedRoot;
    if (this.blockedMovementGroups[removedRoot] === 1) {
      this.blockedMovementGroups[combinedRoot] = 1;
    }
  }

  private findMovementGroup(root: number): number {
    let group = root;
    let parent = expectDefined(this.movementGroupRoots[group], "movement group parent");
    if (parent < 0) {
      throw new Error(`Body root ${root} has no movement group`);
    }
    while (parent !== group) {
      group = parent;
      parent = expectDefined(this.movementGroupRoots[group], "movement group parent");
    }
    while (root !== group) {
      const next = expectDefined(this.movementGroupRoots[root], "movement group parent");
      this.movementGroupRoots[root] = group;
      root = next;
    }
    return group;
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
