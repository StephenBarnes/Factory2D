import { expectDefined } from "../util/assert";
import { Direction, oppositeDirection, TileKind } from "./tile";
import type { World } from "./world";
import { WeldedBodyIndex } from "./welded-body-index";

/** Collects complete-body delivery intents, jams shared targets, then commits absorption. */
export class DeliveryResolver {
  readonly absorptionTargetIndices: Int32Array;

  private readonly world: World;
  private readonly bodies: WeldedBodyIndex;
  private readonly absorbedBodyOwners: Int32Array;

  constructor(world: World, bodies: WeldedBodyIndex) {
    this.world = world;
    this.bodies = bodies;
    this.absorbedBodyOwners = new Int32Array(world.cellCount);
    this.absorptionTargetIndices = new Int32Array(world.cellCount);
  }

  collect(): void {
    this.absorbedBodyOwners.fill(-1);
    this.absorptionTargetIndices.fill(-1);

    for (let delivery = 0; delivery < this.world.cellCount; delivery += 1) {
      if (this.world.kindAtIndex(delivery) !== TileKind.Delivery) {
        continue;
      }
      const orientation = this.world.orientationAtIndex(delivery);
      const target = this.neighborIndex(delivery, orientation);
      const reference = this.neighborIndex(delivery, oppositeDirection(orientation));
      if (
        target < 0 ||
        reference < 0 ||
        this.world.kindAtIndex(target) === TileKind.Empty ||
        this.world.kindAtIndex(reference) === TileKind.Empty
      ) {
        continue;
      }

      const deliveryRoot = this.bodies.rootAt(delivery);
      const targetRoot = this.bodies.rootAt(target);
      const referenceRoot = this.bodies.rootAt(reference);
      if (
        targetRoot === deliveryRoot ||
        referenceRoot === deliveryRoot ||
        !this.bodies.matchesUnderTranslation(reference, target)
      ) {
        continue;
      }

      this.absorptionTargetIndices[delivery] = target;
      let member = this.bodies.headAtRoot(targetRoot);
      while (member >= 0) {
        const owner = expectDefined(
          this.absorbedBodyOwners[member],
          "delivery body owner",
        );
        this.absorbedBodyOwners[member] = owner === -1 || owner === delivery
          ? delivery
          : -2;
        member = this.bodies.nextMember(member);
      }
    }

    for (let delivery = 0; delivery < this.world.cellCount; delivery += 1) {
      const target = expectDefined(
        this.absorptionTargetIndices[delivery],
        "delivery target index",
      );
      if (target < 0) {
        continue;
      }
      const targetRoot = this.bodies.rootAt(target);
      let member = this.bodies.headAtRoot(targetRoot);
      while (member >= 0) {
        if (this.absorbedBodyOwners[member] !== delivery) {
          this.absorptionTargetIndices[delivery] = -1;
          break;
        }
        member = this.bodies.nextMember(member);
      }
    }
  }

  commit(): void {
    this.world.applyDeliveryAbsorptions(
      this.absorptionTargetIndices,
      this.absorbedBodyOwners,
    );
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
