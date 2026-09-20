import type { World } from "../simulation/world";
import {
  BELL_PITCH_COUNT,
  BELL_STEPS_PER_OCTAVE,
  BellObserver,
  bellFrequencyForPitch,
} from "./bell-observer";

type EditSound = "place" | "remove" | "weld" | "unweld";

const STORAGE_KEY = "factory2d.sounds";
const EDIT_TONES: Record<EditSound, readonly [number, number, OscillatorType]> = {
  place: [150, 55, "triangle"],
  remove: [180, 90, "triangle"],
  weld: [440, 180, "sine"],
  unweld: [550, 400, "sine"],
};

const BELL_DEEP_VOICE_START_PITCH = 5;
// Ratio, gains at sizes 1/8/22, durations at sizes 1/8/22 (seconds).
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

/** Browser-only feedback; never participates in simulation state or timing. */
export class WorkshopSounds {
  private enabled = window.localStorage.getItem(STORAGE_KEY) !== "false";
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private lastEditTime = -Infinity;
  private readonly bells = new BellObserver();
  private bellStepPending = false;

  constructor(button: HTMLButtonElement, muteButton: HTMLButtonElement) {
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
      if (this.output !== null && this.context !== null) {
        this.output.gain.setValueAtTime(enabled ? 0.12 : 0, this.context.currentTime);
      }
      if (enabled) this.unlock();
    };
    button.addEventListener("click", toggle);
    muteButton.addEventListener("click", toggle);
    // Resume during an actual user gesture, before edits or automatic test ticks.
    document.addEventListener("pointerdown", () => this.unlock(), { capture: true });
    document.addEventListener("keydown", () => this.unlock(), { capture: true });
  }

  private unlock(): void {
    if (!this.enabled || typeof AudioContext === "undefined") return;
    if (this.context === null) {
      this.context = new AudioContext();
      this.output = this.context.createGain();
      this.output.gain.value = 0.12;
      this.output.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      void this.context.resume().catch((error: unknown) => {
        console.warn("Could not resume workshop audio", error);
      });
    }
  }

  edit(sound: EditSound): void {
    const now = performance.now();
    // A fast drag can cross many cells in one event; keep the feedback bounded.
    if (now - this.lastEditTime < 45 || !this.canPlay()) return;
    this.lastEditTime = now;
    const [start, end, type] = EDIT_TONES[sound];
    this.tone(start, end, type, 0, 0.09);
  }

  beforeStep(world: World, ticksPerSecond: number): void {
    this.bellStepPending = ticksPerSecond < 10 && this.canPlay();
    if (this.bellStepPending) this.bells.capture(world);
  }

  afterStep(world: World): void {
    if (!this.bellStepPending) return;
    this.bellStepPending = false;
    const pitches = this.bells.collectPitches(world);
    if (!this.canPlay()) return;
    for (let pitch = 0; pitch < BELL_PITCH_COUNT; pitch += 1) {
      if ((pitches & (1 << pitch)) === 0) continue;
      this.bell(pitch);
    }
  }

  private bell(pitch: number): void {
    const octaves = pitch / BELL_STEPS_PER_OCTAVE;
    const frequency = bellFrequencyForPitch(pitch);
    const size = Math.min(1, octaves);
    const deep = Math.max(0, Math.min(1,
      (pitch - BELL_DEEP_VOICE_START_PITCH) / (BELL_PITCH_COUNT - 1 - BELL_DEEP_VOICE_START_PITCH),
    ));
    for (const [ratio, smallGain, largeGain, deepGain, smallDuration, largeDuration, deepDuration] of BELL_PARTIALS) {
      const baseGain = smallGain + (largeGain - smallGain) * size;
      const gain = baseGain + (deepGain - baseGain) * deep;
      if (gain === 0) continue;
      const baseDuration = smallDuration + (largeDuration - smallDuration) * size;
      const duration = baseDuration + (deepDuration - baseDuration) * deep;
      const partial = frequency * ratio;
      this.tone(partial, partial, "sine", 0, duration, gain);
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
    return this.enabled && !document.hidden && this.context?.state === "running";
  }

  private tone(start: number, end: number, type: OscillatorType, delay: number, duration: number, volume = 0.7): void {
    const context = this.context;
    const output = this.output;
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
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
    };
    oscillator.start(at);
    oscillator.stop(at + duration);
  }
}
