import { WeldedBodyIndex } from "../simulation/welded-body-index";
import type { World } from "../simulation/world";
import { WorldFeature } from "../simulation/world-features";

// Preserve the original eight pitches per octave, including both endpoints.
export const BELL_STEPS_PER_OCTAVE = 7;
// Three octaves: F5 down to F2. Keep within 32 pitches for the bitmask below.
export const BELL_PITCH_COUNT = 3 * BELL_STEPS_PER_OCTAVE + 1;

interface BellObservation {
  capture: number;
  readonly initialXs: Map<number, number>;
  bodies?: WeldedBodyIndex;
}

/** Browser-side tick observations; neither snapshots nor cloned worlds inherit them. */
export class BellObserver {
  private readonly observations = new WeakMap<World, BellObservation>();
  private captureNumber = 0;
  private pending = false;

  capture(world: World): void {
    this.captureNumber += 1;
    this.pending = true;
    this.captureWorld(world);
  }

  /** Bit (body size - 1), clamped to sizes 1..BELL_PITCH_COUNT; each pitch rings at most once. */
  collectPitches(world: World): number {
    if (!this.pending) return 0;
    this.pending = false;
    return this.collectWorldPitches(world);
  }

  private captureWorld(world: World): void {
    if (world.hasFeature(WorldFeature.Bell)) {
      let observation = this.observations.get(world);
      if (observation === undefined) {
        observation = { capture: this.captureNumber, initialXs: new Map() };
        this.observations.set(world, observation);
      }
      observation.capture = this.captureNumber;
      observation.initialXs.clear();
      for (
        let index = world.firstFeatureIndex(WorldFeature.Bell);
        index >= 0;
        index = world.nextFeatureIndex(WorldFeature.Bell, index)
      ) {
        observation.initialXs.set(world.idAtIndex(index), index % world.width);
      }
    }
    for (
      let index = world.firstFeatureIndex(WorldFeature.RuneArray);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.RuneArray, index)
    ) {
      this.captureWorld(world.runeArrayWorldAtIndex(index));
    }
  }

  private collectWorldPitches(world: World): number {
    let pitches = 0;
    const observation = this.observations.get(world);
    if (observation?.capture === this.captureNumber) {
      let bodies: WeldedBodyIndex | undefined;
      for (
        let index = world.firstFeatureIndex(WorldFeature.Bell);
        index >= 0;
        index = world.nextFeatureIndex(WorldFeature.Bell, index)
      ) {
        const initialX = observation.initialXs.get(world.idAtIndex(index));
        if (initialX === undefined || initialX === index % world.width) continue;
        // Retain topology scratch, but only collect it when a surviving bell moved.
        if (bodies === undefined) {
          bodies = observation.bodies ??= new WeldedBodyIndex(world);
          bodies.collect();
        }
        const size = Math.max(1, Math.min(BELL_PITCH_COUNT, bodies.memberCountAtRoot(bodies.rootAt(index))));
        pitches |= 1 << (size - 1);
      }
    }
    for (
      let index = world.firstFeatureIndex(WorldFeature.RuneArray);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.RuneArray, index)
    ) {
      pitches |= this.collectWorldPitches(world.runeArrayWorldAtIndex(index));
    }
    return pitches;
  }
}
