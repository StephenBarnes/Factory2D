const MAX_AUTOMATIC_ANIMATION_MS = 250;
const MANUAL_STEP_ANIMATION_MS = 200;
const HIGH_SPEED_TICKS_PER_SECOND = 60;

/**
 * Paces a free-running simulation against wall-clock time and tracks the animation window
 * of the most recently committed step. Rendering reads the eased progress; the simulation
 * never reads anything back from this clock.
 */
export class SimulationClock {
  private runningValue = false;
  private accumulatedTime = 0;
  private ticksPerSecondValue: number;
  private animationStartedAt = 0;
  private animationDuration = 0;

  constructor(
    ticksPerSecond: number,
    private readonly animationsToggledOn: () => boolean,
  ) {
    this.ticksPerSecondValue = SimulationClock.validSpeed(ticksPerSecond);
  }

  get running(): boolean {
    return this.runningValue;
  }

  get ticksPerSecond(): number {
    return this.ticksPerSecondValue;
  }

  /** Whether a committed step is still being animated. */
  get animating(): boolean {
    return this.animationDuration !== 0;
  }

  /** Duration to animate a step the user triggers by hand. */
  get manualStepDuration(): number {
    return this.animationsEnabled() ? MANUAL_STEP_ANIMATION_MS : 0;
  }

  setRunning(running: boolean): void {
    this.runningValue = running;
    this.accumulatedTime = 0;
  }

  setTicksPerSecond(ticksPerSecond: number): void {
    this.ticksPerSecondValue = SimulationClock.validSpeed(ticksPerSecond);
    this.accumulatedTime = 0;
  }

  /** Whether committed steps animate at the given speed; the fastest speeds never animate. */
  animationsEnabled(ticksPerSecond = this.ticksPerSecondValue): boolean {
    return this.animationsToggledOn() && ticksPerSecond < HIGH_SPEED_TICKS_PER_SECOND;
  }

  /**
   * Accounts `elapsed` milliseconds while running and calls `step` once per tick that came
   * due, passing the step's animation duration and the wall-clock time it notionally started.
   */
  advance(
    currentTime: number,
    elapsed: number,
    step: (duration: number, startedAt: number) => void,
  ): void {
    if (!this.runningValue) {
      return;
    }
    this.accumulatedTime += elapsed;
    const tickDuration = 1000 / this.ticksPerSecondValue;
    while (this.accumulatedTime >= tickDuration) {
      this.accumulatedTime -= tickDuration;
      step(
        this.animationsEnabled() ? Math.min(tickDuration, MAX_AUTOMATIC_ANIMATION_MS) : 0,
        currentTime - this.accumulatedTime,
      );
    }
  }

  beginAnimation(startedAt: number, duration: number): void {
    this.animationStartedAt = startedAt;
    this.animationDuration = duration;
  }

  finishAnimation(): void {
    this.animationDuration = 0;
  }

  /** Smoothstep-eased progress of the current animation in [0, 1], ending it once complete. */
  easedProgress(currentTime: number): number {
    if (this.animationDuration === 0) {
      return 1;
    }
    const progress = Math.min(
      1,
      Math.max(0, (currentTime - this.animationStartedAt) / this.animationDuration),
    );
    if (progress === 1) {
      this.animationDuration = 0;
    }
    return progress * progress * (3 - 2 * progress);
  }

  private static validSpeed(ticksPerSecond: number): number {
    if (!Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) {
      throw new RangeError(`Invalid simulation speed ${ticksPerSecond}`);
    }
    return ticksPerSecond;
  }
}
