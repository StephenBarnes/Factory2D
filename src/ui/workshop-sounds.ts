import type { World } from "../simulation/world";
import { BellObserver } from "./bell-observer";

type EditSound = "place" | "remove" | "weld" | "unweld";

const STORAGE_KEY = "factory2d.sounds";
const EDIT_TONES: Record<EditSound, readonly [number, number, OscillatorType]> = {
  place: [150, 55, "triangle"],
  remove: [180, 90, "triangle"],
  weld: [440, 180, "sine"],
  unweld: [550, 400, "sine"],
};

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
    for (let pitch = 0; pitch < 8; pitch += 1) {
      if ((pitches & (1 << pitch)) === 0) continue;
      // Eight body sizes span C6 down to C5; equal pitches share one voice.
      const frequency = 1046.502261 * 2 ** (-pitch / 7);
      this.tone(frequency, frequency, "sine", 0, 0.6);
      this.tone(frequency * 2.76, frequency * 2.76, "sine", 0, 0.16, 0.12);
    }
  }

  victory(): void {
    if (!this.canPlay()) return;
    this.tone(392, 392, "sine", 0, 0.22);
    this.tone(494, 494, "sine", 0.12, 0.22);
    this.tone(587, 587, "sine", 0.24, 0.38);
  }

  loss(): void {
    if (!this.canPlay()) return;
    this.tone(587, 587, "sine", 0, 0.22);
    this.tone(494, 494, "sine", 0.12, 0.22);
    this.tone(392, 392, "sine", 0.24, 0.38);
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
