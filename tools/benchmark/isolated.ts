import { CanvasRenderer } from "../../src/render/canvas-renderer";
import { SimulationClock } from "../../src/game/simulation-clock";
import { deserializeBoard, serializeBoard } from "../../src/simulation/board-export";
import { Simulation } from "../../src/simulation/simulation";
import { expectDefined } from "../../src/util/assert";

export interface ReplayOptions {
  readonly scene: string;
  readonly ticks: number;
  readonly runs: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly speed: 5 | 60;
  readonly animate: boolean;
  readonly zoomed: boolean;
}

function summary(samplesMs: number[]) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    samplesMs,
    count: sorted.length,
    totalMs: samplesMs.reduce((sum, value) => sum + value, 0),
    p50Ms: expectDefined(sorted[Math.ceil(sorted.length * 0.5) - 1], "Missing median sample"),
    p95Ms: expectDefined(sorted[Math.ceil(sorted.length * 0.95) - 1], "Missing p95 sample"),
    maxMs: expectDefined(sorted[sorted.length - 1], "Missing maximum sample"),
  };
}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

async function replay(options: ReplayOptions) {
  const canvas = document.getElementById("benchmark-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing benchmark canvas");
  canvas.style.width = `${options.cssWidth}px`;
  canvas.style.height = `${options.cssHeight}px`;
  const runs = [];
  let expectedFinalScene: string | undefined;
  for (let run = 0; run < options.runs; run += 1) {
    // Reimport on every pass: never warm up by consuming the interesting first 50 ticks.
    const simulationOnly = new Simulation(deserializeBoard(options.scene).world);
    const stepOnlyMs: number[] = [];
    const stepOnlyMovements: number[] = [];
    performance.mark(`benchmark:isolated-${run}-simulation`);
    const simulationStarted = performance.now();
    for (let tick = 0; tick < options.ticks; tick += 1) {
      const start = performance.now();
      const moved = simulationOnly.step();
      const elapsed = performance.now() - start;
      stepOnlyMs.push(elapsed);
      stepOnlyMovements.push(moved);
    }
    const simulationWallMs = performance.now() - simulationStarted;
    const finalScene = serializeBoard(simulationOnly.world, simulationOnly.tick);
    if (expectedFinalScene !== undefined && finalScene !== expectedFinalScene) {
      throw new Error("Simulation replay produced a different final scene");
    }
    expectedFinalScene = finalScene;

    const world = deserializeBoard(options.scene).world;
    const simulation = new Simulation(world);
    const previousWorld = world.clone();
    const renderer = new CanvasRenderer(canvas, world);
    const clock = new SimulationClock(options.speed, () => options.animate);
    const interpolation = clock.animationsEnabled();
    // Fixed progress samples, one per RAF. No catch-up/skipped ticks on slow backends.
    const framesPerTick = interpolation ? 12 : 1;
    const copyMs: number[] = [];
    const stepMs: number[] = [];
    const renderMs: number[] = [];
    const rafIntervalsMs: number[] = [];
    const movements: number[] = [];
    const firstRenderStart = performance.now();
    renderer.render(null, 1, firstRenderStart, false, options.animate);
    const firstRenderMs = performance.now() - firstRenderStart;
    if (options.zoomed) {
      renderer.zoomAtClientPoint(options.cssWidth / 2, options.cssHeight / 2, -Math.log(8) / 0.0015);
    }
    let previousRaf = await nextFrame();
    performance.mark(`benchmark:isolated-${run}-animated`);
    const replayStarted = performance.now();
    for (let tick = 0; tick < options.ticks; tick += 1) {
      const copyStart = performance.now();
      previousWorld.copyFrom(world);
      const stepStart = performance.now();
      const moved = simulation.step(interpolation ? previousWorld : undefined);
      const stepEnd = performance.now();
      copyMs.push(stepStart - copyStart);
      stepMs.push(stepEnd - stepStart);
      movements.push(moved);
      clock.beginAnimation(0, interpolation ? 1000 / options.speed : 0);
      for (let frame = 1; frame <= framesPerTick; frame += 1) {
        const timestamp = await nextFrame();
        rafIntervalsMs.push(timestamp - previousRaf);
        previousRaf = timestamp;
        const progress = clock.easedProgress(frame / framesPerTick * 1000 / options.speed);
        const start = performance.now();
        renderer.render(clock.animating ? previousWorld : null, progress, start, false, options.animate);
        renderMs.push(performance.now() - start);
      }
    }
    const replayWallMs = performance.now() - replayStarted;
    if (simulation.tick !== options.ticks || serializeBoard(world, simulation.tick) !== finalScene ||
        movements.some((moved, index) => moved !== stepOnlyMovements[index])) {
      throw new Error("Snapshot/render replay diverged from simulation-only replay");
    }
    runs.push({
      run: run + 1, initialTick: 0, finalTick: simulation.tick,
      simulationOnly: { wallMs: simulationWallMs, step: summary(stepOnlyMs), movements: stepOnlyMovements },
      rendered: {
        wallMs: replayWallMs, framesPerTick, firstRenderMs,
        snapshot: summary(copyMs), step: summary(stepMs), render: summary(renderMs),
        rafCadence: summary(rafIntervalsMs), movements,
      },
    });
  }
  return {
    method: {
      ticks: options.ticks, runs: options.runs, percentile: "nearest-rank",
      warmup: "None discarded. Each pass reimports tick zero with fresh simulation/renderer caches; later runs retain browser/JIT state. Simulation-only precedes rendered replay.",
      simulation: "50 by default: synchronous step() calls, excluding import, construction, snapshots and serialization; wallMs includes timing/sample collection overhead.",
      rendering: "Snapshot then step, followed by 12 fixed smoothstep progress samples per tick at 5 ticks/s with animation; one committed frame with animation off or at 60 ticks/s. One call per RAF, no catch-up. Actual wall time may exceed nominal playback.",
      scope: "render() measures synchronous JS/Canvas submission, not raster completion or displayed FPS. RAF cadence/wall time include browser scheduling/raster backpressure. No workshop DOM, signals, persistence or overlays.",
      firstRender: "Fresh fitted renderer per run, before requested zoom. Included separately, not in per-frame samples.",
      stateCheck: "Every replay must produce identical serialized final state and per-tick movement counts, with and without rendering.",
    },
    canvas: { cssWidth: options.cssWidth, cssHeight: options.cssHeight,
      backingWidth: canvas.width, backingHeight: canvas.height, devicePixelRatio },
    runs,
    finalScene: expectDefined(expectedFinalScene, "No scene replay completed"),
  };
}

declare global {
  interface Window {
    runSceneBenchmark: typeof replay;
  }
}
window.runSceneBenchmark = replay;
