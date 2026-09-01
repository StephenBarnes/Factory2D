import { CircuitResolver } from "./circuit-resolver";
import { DeliveryResolver } from "./delivery-resolver";
import { FurnaceResolver } from "./furnace-resolver";
import { MotionWorkspace } from "./motion-workspace";
import { PuzzleResult } from "./puzzle-result";
import { WeldOperationResolver } from "./weld-operation-resolver";
import { Direction, oppositeDirection, TileKind } from "./tile";
import { World } from "./world";

/**
 * Advances a world in discrete ticks. Every movement decision is collected from
 * the start-of-tick state, then committed as a separate phase.
 */
export class Simulation {
  readonly world: World;
  private readonly circuitResolver: CircuitResolver;
  private readonly deliveryResolver: DeliveryResolver;
  private readonly furnaceResolver: FurnaceResolver;
  private readonly motionWorkspace: MotionWorkspace;
  private readonly weldOperationResolver: WeldOperationResolver;
  tick = 0;

  constructor(world: World) {
    this.world = world;
    this.circuitResolver = new CircuitResolver(world);
    this.deliveryResolver = new DeliveryResolver(world);
    this.furnaceResolver = new FurnaceResolver(world);
    this.motionWorkspace = new MotionWorkspace(world);
    this.weldOperationResolver = new WeldOperationResolver(world);
  }

  step(): number {
    this.resolveVictoryBlocks();
    this.deliveryResolver.collect();
    this.weldOperationResolver.collect();
    this.circuitResolver.resolve(
      this.tick,
      this.deliveryResolver.absorptionTargetIndices,
      this.weldOperationResolver.successfulOperationIndices,
    );
    this.weldOperationResolver.commit();
    this.furnaceResolver.resolve(this.circuitResolver.furnaceDisabled);
    this.deliveryResolver.commit();
    const movementCount = this.motionWorkspace.resolveOrdinaryMovements(this.tick);
    const pistonMovementCount = this.motionWorkspace.resolvePistons();
    this.tick += 1;
    return movementCount + pistonMovementCount;
  }

  private resolveVictoryBlocks(): void {
    if (this.world.puzzleResult !== PuzzleResult.InProgress) {
      return;
    }

    let hasWinIntent = false;
    let hasLossIntent = false;
    for (let index = 0; index < this.world.cellCount; index += 1) {
      if (this.world.kindAtIndex(index) !== TileKind.Victory) {
        continue;
      }

      for (let value = Direction.Up; value <= Direction.Left; value += 1) {
        const direction = value as Direction;
        if (!this.world.hasCircuitConnectionAtIndex(index, direction)) {
          continue;
        }
        const inputIndex = this.neighborIndex(index, direction);
        if (inputIndex < 0) {
          throw new Error(`Connected victory input at index ${index} has no neighbor`);
        }
        const inputCharge = this.world.chargeAtPortIndex(
          inputIndex,
          oppositeDirection(direction),
        );
        hasWinIntent ||= inputCharge === 1;
        hasLossIntent ||= inputCharge === -1;
      }
    }

    if (hasWinIntent !== hasLossIntent) {
      this.world.markPuzzleResult(hasWinIntent ? PuzzleResult.Won : PuzzleResult.Lost);
    }
  }

  resetTo(snapshot: World): void {
    this.world.copyFrom(snapshot);
    this.tick = 0;
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

}
