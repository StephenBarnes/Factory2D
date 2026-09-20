import { WeldedBodyIndex } from "../simulation/welded-body-index";
import type { World } from "../simulation/world";
import { WorldFeature } from "../simulation/world-features";
import { expectDefined } from "../util/assert";

// Twelve equal-tempered semitones per octave, tuned to A4 = 440 Hz.
export const BELL_STEPS_PER_OCTAVE = 12;
// Three octaves: F5 down to F2.
export const BELL_PITCH_COUNT = 3 * BELL_STEPS_PER_OCTAVE + 1;
const BELL_HIGHEST_MIDI_NOTE = 77; // F5
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;

/** Zero-based pitch, descending as the welded body grows. */
export function bellPitchForBodySize(size: number): number {
  return Math.max(1, Math.min(BELL_PITCH_COUNT, size)) - 1;
}

export function bellFrequencyForPitch(pitch: number): number {
  return 440 * 2 ** ((BELL_HIGHEST_MIDI_NOTE - pitch - 69) / BELL_STEPS_PER_OCTAVE);
}

export function bellNoteForPitch(pitch: number): string {
  const midiNote = BELL_HIGHEST_MIDI_NOTE - pitch;
  const name = expectDefined(NOTE_NAMES[midiNote % BELL_STEPS_PER_OCTAVE], "Invalid bell note");
  return `${name}${Math.floor(midiNote / BELL_STEPS_PER_OCTAVE) - 1}`;
}

interface BellObservation {
  capture: number;
  readonly initialXs: Map<number, number>;
  bodies?: WeldedBodyIndex;
}

/** Browser-side tick observations; neither snapshots nor cloned worlds inherit them. */
export class BellObserver {
  private readonly observations = new WeakMap<World, BellObservation>();
  private readonly pitches = new Set<number>();
  private captureNumber = 0;
  private pending = false;

  capture(world: World): void {
    this.captureNumber += 1;
    this.pending = true;
    this.captureWorld(world);
  }

  /** Each pitch rings once; the returned set is reused by the next collection. */
  collectPitches(world: World): ReadonlySet<number> {
    this.pitches.clear();
    if (this.pending) {
      this.pending = false;
      this.collectWorldPitches(world);
    }
    return this.pitches;
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

  private collectWorldPitches(world: World): void {
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
        this.pitches.add(bellPitchForBodySize(bodies.memberCountAtRoot(bodies.rootAt(index))));
      }
    }
    for (
      let index = world.firstFeatureIndex(WorldFeature.RuneArray);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.RuneArray, index)
    ) {
      this.collectWorldPitches(world.runeArrayWorldAtIndex(index));
    }
  }
}
