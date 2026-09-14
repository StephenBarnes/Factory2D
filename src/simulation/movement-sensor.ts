import { chargeFromSum } from "./circuit";
import type { World } from "./world";
import { WorldFeature } from "./world-features";

/** Records net displacement across every committed motion phase, never render interpolation. */
export class MovementSensorObserver {
  private readonly initialIndices = new Map<number, number>();

  constructor(private readonly world: World) {}

  collect(): void {
    const world = this.world;
    this.initialIndices.clear();
    for (
      let index = world.firstFeatureIndex(WorldFeature.MovementSensor);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.MovementSensor, index)
    ) {
      this.initialIndices.set(world.idAtIndex(index), index);
    }
  }

  commit(): void {
    const world = this.world;
    for (
      let index = world.firstFeatureIndex(WorldFeature.MovementSensor);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.MovementSensor, index)
    ) {
      const state = world.movementSensorStateAtIndex(index);
      const initial = this.initialIndices.get(world.idAtIndex(index));
      // A newly produced tile has no start-of-tick position, even if its template moved.
      state.motionX = initial === undefined ? 0 : chargeFromSum(
        index % world.width - initial % world.width,
      );
      state.motionY = initial === undefined ? 0 : chargeFromSum(
        Math.floor(index / world.width) - Math.floor(initial / world.width),
      );
    }
  }
}
