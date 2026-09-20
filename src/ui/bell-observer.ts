import { BELL_PITCH_COUNT, BELL_STEPS_PER_OCTAVE } from "../simulation/bell-pitch";
import { StrikeTimbre, TILE_DEFINITIONS } from "../simulation/tile";
import { TonalObserver } from "../simulation/tonal-observer";
import type { World } from "../simulation/world";
import { WorldFeature } from "../simulation/world-features";
import { expectDefined } from "../util/assert";
import type { LocatedSound } from "./spatial-sound";

const BELL_HIGHEST_MIDI_NOTE = 77; // F5
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;

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
  readonly tones: TonalObserver;
}

/** Browser-side tick observations; neither snapshots nor cloned worlds inherit them. */
export class BellObserver {
  private readonly observations = new WeakMap<World, BellObservation>();
  private readonly sounds: LocatedSound<number>[] = [];
  private captureNumber = 0;
  private pending = false;

  constructor(private readonly onRing?: (world: World, index: number) => void) {}

  capture(world: World): void {
    this.captureNumber += 1;
    this.pending = true;
    this.captureWorld(world);
  }

  /** Voices pack timbre * BELL_PITCH_COUNT + pitch; the returned array is reused. */
  collectSounds(world: World): readonly LocatedSound<number>[] {
    this.sounds.length = 0;
    if (this.pending) {
      this.pending = false;
      this.collectWorldSounds(world);
    }
    return this.sounds;
  }

  private captureWorld(world: World): void {
    if (world.hasFeature(WorldFeature.Bell) || world.hasFeature(WorldFeature.Mallet)) {
      let observation = this.observations.get(world);
      if (observation === undefined) {
        observation = { capture: this.captureNumber, tones: new TonalObserver(world) };
        this.observations.set(world, observation);
      }
      observation.capture = this.captureNumber;
      observation.tones.capture();
    }
    for (
      let index = world.firstFeatureIndex(WorldFeature.RuneArray);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.RuneArray, index)
    ) {
      this.captureWorld(world.runeArrayWorldAtIndex(index));
    }
  }

  private collectWorldSounds(world: World): void {
    const observation = this.observations.get(world);
    if (observation?.capture === this.captureNumber) {
      for (const event of observation.tones.collect()) {
        this.onRing?.(world, event.index);
        const timbre = TILE_DEFINITIONS[world.kindAtIndex(event.index)].strikeTimbre ?? StrikeTimbre.Metal;
        this.sounds.push({ voice: timbre * BELL_PITCH_COUNT + event.pitch, world, index: event.index });
      }
    }
    for (
      let index = world.firstFeatureIndex(WorldFeature.RuneArray);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.RuneArray, index)
    ) {
      this.collectWorldSounds(world.runeArrayWorldAtIndex(index));
    }
  }
}
