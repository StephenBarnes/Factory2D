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

  constructor(button: HTMLButtonElement) {
    button.setAttribute("aria-pressed", String(this.enabled));
    button.addEventListener("click", () => {
      const enabled = !this.enabled;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(enabled));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(`Could not save sound settings: ${message}`);
        return;
      }
      this.enabled = enabled;
      button.setAttribute("aria-pressed", String(enabled));
      if (this.output !== null && this.context !== null) {
        this.output.gain.setValueAtTime(enabled ? 0.12 : 0, this.context.currentTime);
      }
      if (enabled) this.unlock();
    });
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

  private tone(start: number, end: number, type: OscillatorType, delay: number, duration: number): void {
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
    envelope.gain.linearRampToValueAtTime(0.7, at + 0.004);
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
