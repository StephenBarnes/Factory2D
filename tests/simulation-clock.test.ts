import { describe, expect, it } from "vitest";

import { SimulationClock } from "../src/game/simulation-clock";

function recordSteps(clock: SimulationClock, currentTime: number, elapsed: number) {
  const steps: { duration: number; startedAt: number }[] = [];
  clock.advance(currentTime, elapsed, (duration, startedAt) => {
    steps.push({ duration, startedAt });
  });
  return steps;
}

describe("SimulationClock", () => {
  it("steps once per tick that came due and dates each step from its tick boundary", () => {
    const clock = new SimulationClock(5, () => true);
    clock.setRunning(true);
    expect(recordSteps(clock, 1000, 150)).toEqual([]);
    expect(recordSteps(clock, 1100, 100)).toEqual([{ duration: 200, startedAt: 1050 }]);
    expect(recordSteps(clock, 1600, 500)).toEqual([
      { duration: 200, startedAt: 1250 },
      { duration: 200, startedAt: 1450 },
    ]);
  });

  it("does not accumulate time while paused and restarts from zero when resumed", () => {
    const clock = new SimulationClock(5, () => true);
    expect(recordSteps(clock, 0, 1000)).toEqual([]);
    clock.setRunning(true);
    expect(recordSteps(clock, 1000, 199)).toEqual([]);
    clock.setRunning(false);
    clock.setRunning(true);
    expect(recordSteps(clock, 1000, 199)).toEqual([]);
  });

  it("caps automatic animations and disables them at high speed or when toggled off", () => {
    let toggled = true;
    const clock = new SimulationClock(1, () => toggled);
    clock.setRunning(true);
    expect(recordSteps(clock, 1000, 1000)).toEqual([{ duration: 250, startedAt: 1000 }]);
    expect(clock.manualStepDuration).toBe(200);
    clock.setTicksPerSecond(60);
    expect(clock.animationsEnabled()).toBe(false);
    expect(recordSteps(clock, 2000, 1000 / 60)).toEqual([{ duration: 0, startedAt: 2000 }]);
    toggled = false;
    clock.setTicksPerSecond(1);
    expect(clock.manualStepDuration).toBe(0);
    expect(clock.animationsEnabled(5)).toBe(false);
  });

  it("eases animation progress and ends the animation once it completes", () => {
    const clock = new SimulationClock(5, () => true);
    expect(clock.animating).toBe(false);
    expect(clock.easedProgress(0)).toBe(1);
    clock.beginAnimation(100, 200);
    expect(clock.animating).toBe(true);
    expect(clock.easedProgress(50)).toBe(0);
    expect(clock.easedProgress(200)).toBe(0.5);
    expect(clock.animating).toBe(true);
    expect(clock.easedProgress(300)).toBe(1);
    expect(clock.animating).toBe(false);
    clock.beginAnimation(0, 200);
    clock.finishAnimation();
    expect(clock.animating).toBe(false);
  });

  it("rejects non-positive speeds", () => {
    expect(() => new SimulationClock(0, () => true)).toThrow(RangeError);
    expect(() => new SimulationClock(5, () => true).setTicksPerSecond(-1)).toThrow(RangeError);
  });
});
