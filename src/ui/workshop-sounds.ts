import { BELL_PITCH_COUNT, BELL_STEPS_PER_OCTAVE } from "../simulation/bell-pitch";
import { StrikeTimbre } from "../simulation/tile";
import { expectDefined } from "../util/assert";
import { bellFrequencyForPitch } from "./bell-observer";
import type { MachinerySound } from "./machinery-observer";
import { soundPosition, spatialSounds, type LocatedSound, type SoundPosition, type SoundView } from "./spatial-sound";

type EditSound = "place" | "remove" | "weld" | "unweld";

interface VolumeControl {
  input: HTMLInputElement;
  output: HTMLOutputElement;
}

interface SpatialBus {
  gain: GainNode;
  panner: StereoPannerNode;
  sources: number;
}

// Equal slider steps give equal decibel changes (-40 dB to 0 dB).
// Zero is a separate, truly silent endpoint.
function volumeGain(percent: number): number {
  return percent === 0 ? 0 : 10 ** ((percent - 100) / 50);
}

const STORAGE_KEY = "factory2d.sounds";
const EDIT_TONES: Record<EditSound, readonly [number, number, OscillatorType]> = {
  place: [150, 55, "triangle"],
  remove: [180, 90, "triangle"],
  weld: [440, 180, "sine"],
  unweld: [550, 400, "sine"],
};

const BELL_DEEP_VOICE_START_OCTAVES = 5 / 7;
// Ratio, gains at sizes 1/13/37, durations at sizes 1/13/37 (seconds).
// Deep bells shift energy out of the hum and into upper ringing/strike modes.
// Bell mode reference: https://www.hibberts.co.uk/identifying-bell-partials/
const BELL_PARTIALS = [
  [0.50,  0.16, 0.08, 0.02,   1.80, 4.80, 1.80], // Hum
  [1.00,  0.42, 0.24, 0.18,   1.80, 4.00, 2.20], // Prime
  [1.20,  0.00, 0.14, 0.12,   1.80, 3.40, 2.50], // Minor-third tierce
  [1.203, 0.00, 0.04, 0.08,   1.80, 3.40, 2.50], // Split tierce: gentle beating, not vibrato
  [1.50,  0.16, 0.11, 0.12,   1.15, 2.80, 2.00], // Quint
  [2.03,  0.13, 0.22, 0.22,   0.85, 3.20, 3.60], // Slightly stretched nominal
  [2.67,  0.10, 0.10, 0.15,   0.60, 1.65, 2.80],
  [3.91,  0.06, 0.07, 0.24,   0.32, 0.90, 2.00],
  [5.43,  0.00, 0.03, 0.18,   0.16, 0.35, 1.80],
  [8.21,  0.00, 0.00, 0.20,   0.16, 0.16, 2.80], // Deep-bell metallic strike
  [11.17, 0.00, 0.00, 0.15,   0.10, 0.10, 1.20],
] as const;

// Frequency ratio, gain, decay seconds. Keep the fundamental at the shared body-size pitch.
const STRIKE_PARTIALS: Readonly<Record<number, readonly (readonly [number, number, number])[]>> = {
  [StrikeTimbre.Stone]: [
    [1, 0.65, 0.65], [2.76, 0.22, 0.24], [5.4, 0.09, 0.10],
  ],
  [StrikeTimbre.Wood]: [
    [1, 0.75, 0.22], [3, 0.18, 0.085], [6, 0.06, 0.035],
  ],
  [StrikeTimbre.Glass]: [
    [1, 0.48, 2.4], [2.32, 0.22, 1.4], [4.25, 0.12, 0.65], [6.63, 0.06, 0.3],
  ],
};

/** Browser-only feedback; never participates in simulation state or timing. */
export class WorkshopSounds {
  private enabled = window.localStorage.getItem(STORAGE_KEY) !== "false";
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private bellOutput: GainNode | null = null;
  private machineryNoise: AudioBuffer | null = null;
  private masterVolume = 100;
  private bellVolume = 100;
  private lastEditTime = -Infinity;

  constructor(
    button: HTMLButtonElement,
    muteButton: HTMLButtonElement,
    master: VolumeControl,
    bells: VolumeControl,
    private readonly getView: () => SoundView | null,
  ) {
    this.bindVolume(master, "masterVolume", "factory2d.master-volume");
    this.bindVolume(bells, "bellVolume", "factory2d.bell-volume");
    const syncButtons = (): void => {
      button.setAttribute("aria-pressed", String(this.enabled));
      muteButton.setAttribute("aria-pressed", String(!this.enabled));
      muteButton.textContent = this.enabled ? "♪" : "×";
      muteButton.title = this.enabled ? "Mute sound effects" : "Unmute sound effects";
    };
    syncButtons();
    const toggle = (): void => {
      const enabled = !this.enabled;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(enabled));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(`Could not save sound settings: ${message}`);
        return;
      }
      this.enabled = enabled;
      syncButtons();
      this.updateGains();
      if (enabled) this.unlock();
    };
    button.addEventListener("click", toggle);
    muteButton.addEventListener("click", toggle);
    // Resume during an actual user gesture, before edits or automatic test ticks.
    document.addEventListener("pointerdown", () => this.unlock(), { capture: true });
    document.addEventListener("keydown", () => this.unlock(), { capture: true });
  }

  private bindVolume(
    control: VolumeControl,
    field: "masterVolume" | "bellVolume",
    storageKey: string,
  ): void {
    const stored = window.localStorage.getItem(storageKey);
    const percent = stored === null || stored.trim() === "" ? NaN : Number(stored);
    this[field] = Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : 100;
    const sync = (): void => {
      control.input.value = String(this[field]);
      const label = this[field] === 0 ? "Muted" : `${this[field]}%`;
      control.output.value = label;
      control.input.setAttribute("aria-valuetext", label);
    };
    sync();
    control.input.addEventListener("input", () => {
      const volume = control.input.valueAsNumber;
      try {
        window.localStorage.setItem(storageKey, String(volume));
      } catch (error) {
        sync();
        const message = error instanceof Error ? error.message : String(error);
        window.alert(`Could not save sound settings: ${message}`);
        return;
      }
      this[field] = volume;
      sync();
      this.updateGains();
    });
  }

  private updateGains(): void {
    if (this.context === null || this.output === null || this.bellOutput === null) return;
    const at = this.context.currentTime;
    this.output.gain.setValueAtTime(this.enabled ? 0.12 * volumeGain(this.masterVolume) : 0, at);
    this.bellOutput.gain.setValueAtTime(volumeGain(this.bellVolume), at);
  }

  private unlock(): void {
    if (!this.enabled || typeof AudioContext === "undefined") return;
    if (this.context === null) {
      this.context = new AudioContext();
      this.output = this.context.createGain();
      this.bellOutput = this.context.createGain();
      this.updateGains();
      this.bellOutput.connect(this.output);
      this.output.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      void this.context.resume().catch((error: unknown) => {
        console.warn("Could not resume workshop audio", error);
      });
    }
  }

  edit(sound: EditSound, x: number, y: number): void {
    const now = performance.now();
    // A fast drag can cross many cells in one event; keep the feedback bounded.
    if (now - this.lastEditTime < 45 || !this.canPlay()) return;
    const view = this.getView();
    if (view === null) return;
    const bus = this.spatialBus(soundPosition(view, x, y));
    if (bus === null) return;
    this.lastEditTime = now;
    const [start, end, type] = EDIT_TONES[sound];
    this.tone(start, end, type, 0, 0.09, 0.7, bus);
  }

  playBells(events: readonly LocatedSound<number>[]): void {
    if (events.length === 0 || !this.canPlay() || this.bellVolume === 0) return;
    const view = this.getView();
    if (view === null) return;
    for (const [voice, position] of spatialSounds(events, view)) {
      const pitch = voice % BELL_PITCH_COUNT;
      const timbre = Math.floor(voice / BELL_PITCH_COUNT);
      const bus = this.spatialBus(position, this.bellOutput);
      if (bus === null) continue;
      if (timbre === StrikeTimbre.Metal) this.bell(pitch, bus);
      else this.strike(pitch, timbre, bus);
    }
  }

  playMachinery(events: readonly LocatedSound<MachinerySound>[]): void {
    if (events.length === 0 || !this.canPlay()) return;
    const view = this.getView();
    if (view === null) return;
    for (const [sound, position] of spatialSounds(events, view)) {
      const bus = this.spatialBus(position);
      if (bus === null) continue;
      switch (sound) {
        case "extend":
          this.noise("bandpass", 900, 0.12, 0.35, bus);
          this.tone(160, 65, "triangle", 0.07, 0.08, 0.45, bus);
          break;
        case "retract":
          this.noise("bandpass", 600, 0.10, 0.3, bus);
          this.tone(110, 55, "triangle", 0.05, 0.07, 0.4, bus);
          break;
        case "drill":
          this.noise("bandpass", 2200, 0.12, 0.3, bus);
          this.tone(95, 80, "sawtooth", 0, 0.10, 0.06, bus);
          break;
        case "grinder":
          this.noise("lowpass", 1400, 0.14, 0.35, bus);
          this.tone(55, 40, "triangle", 0, 0.12, 0.2, bus);
          break;
        case "furnace":
          this.noise("lowpass", 450, 0.18, 0.5, bus);
          break;
        case "welder":
          this.noise("highpass", 2800, 0.08, 0.3, bus);
          this.tone(620, 180, "triangle", 0, 0.10, 0.25, bus);
          break;
        case "splitter":
          this.noise("highpass", 1800, 0.05, 0.4, bus);
          this.tone(240, 80, "triangle", 0, 0.07, 0.35, bus);
          break;
        case "laserSplitter":
          this.tone(1800, 450, "sawtooth", 0, 0.10, 0.08, bus);
          this.noise("bandpass", 3200, 0.08, 0.2, bus);
          break;
        case "dismantler":
          this.noise("bandpass", 1100, 0.14, 0.4, bus);
          this.tone(180, 55, "triangle", 0.02, 0.10, 0.35, bus);
          break;
        case "duplicator":
          this.tone(220, 660, "sine", 0, 0.12, 0.35, bus);
          this.tone(440, 880, "sine", 0.04, 0.10, 0.2, bus);
          break;
        case "assembler":
          this.noise("bandpass", 750, 0.07, 0.3, bus);
          this.tone(130, 70, "triangle", 0, 0.08, 0.4, bus);
          this.tone(390, 260, "sine", 0.06, 0.08, 0.2, bus);
          break;
        case "break":
          this.noise("lowpass", 1800, 0.16, 0.65, bus);
          this.tone(150, 45, "triangle", 0, 0.12, 0.5, bus);
          break;
        case "shatter":
          this.noise("highpass", 3600, 0.18, 0.5, bus);
          this.tone(2600, 1700, "sine", 0, 0.12, 0.18, bus);
          this.tone(3900, 2400, "sine", 0.025, 0.15, 0.12, bus);
          break;
        case "snap":
          this.noise("bandpass", 2600, 0.055, 0.6, bus);
          this.tone(950, 320, "triangle", 0, 0.075, 0.4, bus);
          break;
        case "bomb":
          this.noise("allpass", 800, 0.5, 1, bus);
          this.noise("allpass", 1000, 0.5, 1, bus);
          this.tone(100, 28, "triangle", 0, 0.2, 1, bus);
          break;
      }
    }
  }

  private spatialBus(position: SoundPosition, output = this.output): SpatialBus | null {
    const amount = Math.max(0, Math.min(1, position.gain));
    if (!(amount > 0) || !Number.isFinite(position.pan)) return null;
    const context = this.context;
    if (context === null || output === null) throw new Error("Workshop audio is not initialized");
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    gain.gain.setValueAtTime(amount, context.currentTime);
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, position.pan)), context.currentTime);
    gain.connect(panner);
    panner.connect(output);
    return { gain, panner, sources: 0 };
  }

  private releaseBus(bus: SpatialBus | null): void {
    if (bus === null || --bus.sources !== 0) return;
    bus.gain.disconnect();
    bus.panner.disconnect();
  }

  private noise(type: BiquadFilterType, frequency: number, duration: number, volume: number, bus: SpatialBus): void {
    const context = this.context;
    if (context === null) throw new Error("Workshop audio is not initialized");
    if (this.machineryNoise === null) {
      this.machineryNoise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.2), context.sampleRate);
      const samples = this.machineryNoise.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    }
    const at = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = this.machineryNoise;
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, at);
    filter.Q.setValueAtTime(0.7, at);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.001, at + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(bus.gain);
    bus.sources += 1;
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
      this.releaseBus(bus);
    };
    source.start(at);
    source.stop(at + duration);
  }

  private bell(pitch: number, bus: SpatialBus): void {
    const octaves = pitch / BELL_STEPS_PER_OCTAVE;
    const frequency = bellFrequencyForPitch(pitch);
    const size = Math.min(1, octaves);
    const deep = Math.max(0, Math.min(1,
      (octaves - BELL_DEEP_VOICE_START_OCTAVES) /
      ((BELL_PITCH_COUNT - 1) / BELL_STEPS_PER_OCTAVE - BELL_DEEP_VOICE_START_OCTAVES),
    ));
    for (const [ratio, smallGain, largeGain, deepGain, smallDuration, largeDuration, deepDuration] of BELL_PARTIALS) {
      const baseGain = smallGain + (largeGain - smallGain) * size;
      const gain = baseGain + (deepGain - baseGain) * deep;
      if (gain === 0) continue;
      const baseDuration = smallDuration + (largeDuration - smallDuration) * size;
      const duration = baseDuration + (deepDuration - baseDuration) * deep;
      const partial = frequency * ratio;
      this.tone(partial, partial, "sine", 0, duration, gain, bus);
    }
  }

  private strike(pitch: number, timbre: StrikeTimbre, bus: SpatialBus): void {
    const frequency = bellFrequencyForPitch(pitch);
    const durationScale = 1 + pitch / (BELL_PITCH_COUNT - 1) * 0.6;
    const partials = expectDefined(STRIKE_PARTIALS[timbre], "Unknown mallet sound character");
    for (const [ratio, gain, duration] of partials) {
      const partial = frequency * ratio;
      this.tone(partial, partial, "sine", 0, duration * durationScale, gain, bus);
    }
  }

  victory(): void {
    if (!this.canPlay()) return;
    this.tone(392, 392, "sine",     0.00, 0.16, 0.6);
    this.tone(494, 494, "sine",     0.09, 0.16, 0.65);
    this.tone(587, 587, "sine", 0.18, 0.20, 0.65);
    this.tone(784, 800, "sine",     0.30, 0.42, 0.7);
  }

  loss(): void {
    if (!this.canPlay()) return;
    this.tone(330, 294, "triangle", 0, 0.22, 0.6);
    this.tone(262, 220, "triangle", 0.16, 0.26, 0.55);
    this.tone(196, 147, "sine",     0.34, 0.42, 0.5);
  }

  private canPlay(): boolean {
    return this.enabled && this.masterVolume > 0 && !document.hidden && this.context?.state === "running";
  }

  private tone(
    start: number, end: number, type: OscillatorType, delay: number, duration: number,
    volume = 0.7, bus: SpatialBus | null = null,
  ): void {
    const context = this.context;
    const output = bus === null ? this.output : bus.gain;
    if (context === null || output === null) throw new Error("Workshop audio is not initialized");
    const at = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(start, at);
    oscillator.frequency.exponentialRampToValueAtTime(end, at + duration);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.001, at + duration);
    oscillator.connect(envelope);
    envelope.connect(output);
    if (bus !== null) bus.sources += 1;
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
      this.releaseBus(bus);
    };
    oscillator.start(at);
    oscillator.stop(at + duration);
  }
}
