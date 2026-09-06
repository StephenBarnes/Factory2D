import { describe, expect, it } from "vitest";

import { GridRegion } from "../src/game/grid-region";
import { PuzzleComponents } from "../src/game/puzzle-components";
import {
  PuzzleTestController,
  type PuzzleTestControllerDependencies,
  type PuzzleTestControllerElements,
  type PuzzleTestControllerView,
} from "../src/game/puzzle-test-controller";
import type { PuzzleTestReport } from "../src/game/puzzle-test-runner";
import type {
  PuzzleDefinition,
  PuzzleTestCaseDefinition,
} from "../src/game/puzzles";
import { TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function puzzleWith(testCases: readonly PuzzleTestCaseDefinition[]): PuzzleDefinition {
  return {
    id: "controller-test",
    groupId: "basics",
    order: 0,
    name: "Controller Test",
    cycleLimit: 20,
    description: "Controller test puzzle",
    goal: "Trigger victory",
    editableRegion: new GridRegion([{ x: 0, y: 0, width: 1, height: 1 }]),
    availableComponents: new PuzzleComponents([{ kind: TileKind.FixedCharge, price: 1 }]),
    createInitialWorld: () => testCases[0]?.createInitialWorld() ?? emptyVictoryWorld(),
    testCases,
  };
}

function caseDefinition(
  id: string,
  cycleLimit: number,
  createInitialWorld: () => World,
): PuzzleTestCaseDefinition {
  return { id, name: `Case ${id}`, cycleLimit, createInitialWorld };
}

function emptyVictoryWorld(): World {
  const world = new World(2, 1);
  world.place(1, 0, TileKind.Victory);
  return world;
}

function chargedVictoryWorld(charge: -1 | 1): World {
  const world = new World(3, 1);
  world.place(1, 0, TileKind.Conduit);
  world.place(2, 0, TileKind.Victory);
  world.setWeld(1, 0, 2, 0, true);
  world.setCharge(1, 0, charge);
  return world;
}

function winningSolution(): World {
  const world = emptyVictoryWorld();
  world.place(0, 0, TileKind.FixedCharge);
  world.setWeld(0, 0, 1, 0, true);
  return world;
}

class FakeView implements PuzzleTestControllerView {
  selectedCaseId: string | null = null;
  configuredPuzzle: PuzzleDefinition | null = null;
  failure: string | null = null;
  report: PuzzleTestReport | null = null;
  optionsOpen = false;

  configureCases(puzzle: PuzzleDefinition | null, selectedCaseId: string | null): void {
    this.configuredPuzzle = puzzle;
    this.selectedCaseId = selectedCaseId;
    this.optionsOpen = false;
  }

  selectCase(testCaseId: string): void {
    this.selectedCaseId = testCaseId;
  }

  setCaseOptionsOpen(open: boolean): void {
    this.optionsOpen = open;
  }

  toggleCaseOptions(): void {
    this.optionsOpen = !this.optionsOpen;
  }

  hideStatus(): void {
    this.failure = null;
  }

  showFailure(message: string): void {
    this.failure = message;
  }

  showReport(report: PuzzleTestReport): void {
    this.report = report;
  }

  closeReport(): void {
    this.report = null;
  }
}

interface ControllerHarness {
  readonly controller: PuzzleTestController;
  readonly view: FakeView;
  readonly mountedCaseKinds: TileKind[];
  readonly recordedReports: Array<PuzzleTestReport["scores"]>;
  readonly counts: {
    prepare: number;
    reset: number;
    begin: number;
    finishAnimation: number;
    transport: number;
    hover: number;
  };
}

function controllerHarness(solution: World): ControllerHarness {
  const view = new FakeView();
  const mountedCaseKinds: TileKind[] = [];
  const recordedReports: Array<PuzzleTestReport["scores"]> = [];
  const counts = {
    prepare: 0,
    reset: 0,
    begin: 0,
    finishAnimation: 0,
    transport: 0,
    hover: 0,
  };
  const dependencies: PuzzleTestControllerDependencies = {
    getBaseline: () => solution,
    prepareForRuntimeChange: () => {
      counts.prepare += 1;
    },
    resetSession: () => {
      counts.reset += 1;
    },
    beginSimulation: () => {
      counts.begin += 1;
    },
    mountRuntime: (world) => {
      mountedCaseKinds.push(world.kindAt(1, 0));
    },
    beforeStep: () => solution,
    afterStep: () => undefined,
    setStepAnimation: () => undefined,
    finishAnimation: () => {
      counts.finishAnimation += 1;
    },
    animationsEnabled: () => false,
    recordResult: (scores) => {
      recordedReports.push(scores);
      return null;
    },
    refreshTransport: () => {
      counts.transport += 1;
    },
    refreshHover: () => {
      counts.hover += 1;
    },
    leaveWorkshop: () => undefined,
    getNextPuzzle: () => null,
    openPuzzle: () => undefined,
  };
  const controller = new PuzzleTestController(
    {} as PuzzleTestControllerElements,
    dependencies,
    () => view,
  );
  return { controller, view, mountedCaseKinds, recordedReports, counts };
}

function advanceUntilComplete(controller: PuzzleTestController): void {
  for (let frame = 1; controller.testing && frame <= 1_000; frame += 1) {
    controller.advanceFrame(frame * 16, 16);
  }
  if (controller.testing) throw new Error("Test run did not complete");
}

describe("puzzle test controller", () => {
  it("runs visible cases through the explicit between-cases transition", () => {
    const harness = controllerHarness(winningSolution());
    const puzzle = puzzleWith([
      caseDefinition("first", 5, emptyVictoryWorld),
      caseDefinition("second", 5, emptyVictoryWorld),
    ]);
    harness.controller.configure(puzzle);

    harness.controller.togglePlayback(0);
    harness.controller.advanceFrame(400, 400);
    expect(harness.controller.lifecycle.kind).toBe("between-cases");
    expect(harness.view.selectedCaseId).toBe("first");

    harness.controller.advanceFrame(1_000, 600);
    expect(harness.controller.lifecycle.kind).toBe("running");
    expect(harness.view.selectedCaseId).toBe("second");

    harness.controller.advanceFrame(1_400, 400);
    expect(harness.controller.lifecycle.kind).toBe("succeeded");
    expect(harness.view.report?.results.map((result) => result.id)).toEqual(["first", "second"]);
    expect(harness.recordedReports).toHaveLength(1);
    expect(harness.counts.begin).toBe(1);
    expect(harness.mountedCaseKinds).toHaveLength(2);
  });

  it("yields fast tests between frames and allows pausing and resetting unfinished runs", () => {
    const harness = controllerHarness(emptyVictoryWorld());
    harness.controller.configure(puzzleWith([
      caseDefinition("timeout", 10_000, emptyVictoryWorld),
    ]));
    harness.controller.fastForward();
    harness.controller.advanceFrame(16, 16);
    const state = harness.controller.lifecycle;
    if (state.kind !== "running") throw new Error("Expected unfinished fast case");
    const tick = state.run.simulation.tick;
    expect(tick).toBeGreaterThan(0);
    expect(tick).toBeLessThan(10_000);
    expect(harness.recordedReports).toEqual([]);
    harness.controller.togglePlayback(16);
    harness.controller.advanceFrame(1_000, 984);
    expect(state.run.simulation.tick).toBe(tick);
    harness.controller.step(0, 1_000);
    expect(state.run.simulation.tick).toBe(tick + 1);
    harness.controller.fastForward();
    harness.controller.advanceFrame(1_016, 16);
    expect(state.run.simulation.tick).toBeGreaterThan(tick + 1);
    harness.controller.reset();
    harness.controller.advanceFrame(2_000, 984);
    expect(harness.controller.lifecycle.kind).toBe("viewing-case");
    expect(harness.recordedReports).toEqual([]);
  });

  it("pauses without losing progress, steps once, and resumes without catching up paused time", () => {
    const harness = controllerHarness(emptyVictoryWorld());
    harness.controller.configure(puzzleWith([
      caseDefinition("timeout", 5, emptyVictoryWorld),
    ]));
    harness.controller.togglePlayback(0);
    harness.controller.advanceFrame(200, 200);
    harness.controller.togglePlayback(200);
    harness.controller.advanceFrame(10_000, 9_800);
    harness.controller.step(0, 10_000);
    const state = harness.controller.lifecycle;
    if (state.kind !== "running") throw new Error("Expected paused running case");
    expect(state.run.simulation.tick).toBe(2);
    expect(harness.controller.manualStepping).toBe(true);
    harness.controller.togglePlayback(10_000);
    harness.controller.advanceFrame(10_200, 200);
    expect(state.run.simulation.tick).toBe(3);
    harness.controller.fastForward();
    advanceUntilComplete(harness.controller);
    expect(harness.controller.lifecycle.kind).toBe("failed");
  });

  it.each(["step", "resume", "fast-forward"] as const)(
    "pauses between cases and completes through %s without restarting",
    (action) => {
      const harness = controllerHarness(winningSolution());
      harness.controller.configure(puzzleWith([
        caseDefinition("first", 5, emptyVictoryWorld),
        caseDefinition("second", 5, emptyVictoryWorld),
      ]));
      harness.controller.togglePlayback(0);
      harness.controller.advanceFrame(400, 400);
      harness.controller.togglePlayback(400);
      harness.controller.advanceFrame(10_000, 9_600);
      expect(harness.view.selectedCaseId).toBe("first");
      expect(harness.controller.lifecycle.kind).toBe("between-cases");
      expect(harness.recordedReports).toEqual([]);
      if (action === "step") {
        harness.controller.step(0, 10_000);
        harness.controller.step(0, 10_001);
      } else if (action === "resume") {
        harness.controller.togglePlayback(10_000);
        harness.controller.advanceFrame(10_600, 600);
        harness.controller.advanceFrame(11_000, 400);
      } else {
        harness.controller.fastForward();
        advanceUntilComplete(harness.controller);
      }
      expect(harness.view.report?.results.map(({ id }) => id)).toEqual(["first", "second"]);
      expect(harness.controller.lifecycle.kind).toBe("succeeded");
      expect(harness.recordedReports).toHaveLength(1);
    },
  );

  it.each(["ready", "running", "succeeded"] as const)("fast-forwards all cases from %s and presents success", (initialState) => {
    const harness = controllerHarness(winningSolution());
    harness.controller.configure(puzzleWith([
      caseDefinition("first", 5, emptyVictoryWorld),
      caseDefinition("second", 5, emptyVictoryWorld),
    ]));

    if (initialState !== "ready") {
      harness.controller.togglePlayback(0);
    }
    if (initialState === "succeeded") {
      harness.controller.fastForward();
      advanceUntilComplete(harness.controller);
    }
    harness.controller.fastForward();
    advanceUntilComplete(harness.controller);

    expect(harness.controller.lifecycle.kind).toBe("succeeded");
    expect(harness.view.report?.succeeded).toBe(true);
    expect(harness.view.selectedCaseId).toBe("second");
  });

  it("presents an exact cycle-limit failure and resets to the viewed case", () => {
    const harness = controllerHarness(emptyVictoryWorld());
    harness.controller.configure(puzzleWith([
      caseDefinition("timeout", 1, emptyVictoryWorld),
    ]));

    harness.controller.togglePlayback(0);
    harness.controller.advanceFrame(200, 200);

    expect(harness.controller.lifecycle.kind).toBe("failed");
    expect(harness.view.failure).toContain("reached cycle limit 1");
    expect(harness.recordedReports).toEqual([null]);

    harness.controller.reset();
    expect(harness.controller.lifecycle.kind).toBe("viewing-case");
    expect(harness.view.failure).toBeNull();
    expect(harness.counts.reset).toBe(2);
  });

  it("presents simulation loss and stops cleanly for navigation", () => {
    const solution = new World(3, 1);
    const harness = controllerHarness(solution);
    const puzzle = puzzleWith([
      caseDefinition("loss", 5, () => chargedVictoryWorld(-1)),
    ]);
    harness.controller.configure(puzzle);

    harness.controller.togglePlayback(0);
    harness.controller.advanceFrame(400, 400);
    expect(harness.controller.lifecycle.kind).toBe("failed");
    expect(harness.view.failure).toContain('test case "Case loss"');

    harness.controller.stop();
    expect(harness.controller.lifecycle).toEqual({ kind: "idle" });
    expect(harness.view.configuredPuzzle).toBeNull();
    expect(harness.view.failure).toBeNull();
  });

  it("mounts a selected case through the same runtime path", () => {
    const harness = controllerHarness(winningSolution());
    const puzzle = puzzleWith([
      caseDefinition("first", 5, emptyVictoryWorld),
      caseDefinition("second", 5, emptyVictoryWorld),
    ]);
    harness.controller.configure(puzzle);

    harness.controller.showCase("second");

    expect(harness.controller.lifecycle).toMatchObject({
      kind: "viewing-case",
      viewedCaseId: "second",
    });
    expect(harness.view.selectedCaseId).toBe("second");
    expect(harness.counts.prepare).toBe(1);
    expect(harness.counts.reset).toBe(1);
    expect(harness.mountedCaseKinds).toHaveLength(1);
  });

  it("steps every test case manually and presents success only after all pass", () => {
    const harness = controllerHarness(winningSolution());
    harness.controller.configure(puzzleWith([
      caseDefinition("first", 5, emptyVictoryWorld),
      caseDefinition("second", 5, emptyVictoryWorld),
    ]));

    harness.controller.step(0, 0);
    harness.controller.advanceFrame(10_000, 10_000);
    expect(harness.controller.lifecycle.kind).toBe("running");
    expect(harness.controller.manualStepping).toBe(true);
    harness.controller.step(0, 1);
    expect(harness.controller.lifecycle.kind).toBe("between-cases");

    harness.controller.step(0, 2);
    harness.controller.step(0, 3);

    expect(harness.controller.lifecycle.kind).toBe("succeeded");
    expect(harness.view.report?.results.map((result) => result.id)).toEqual(["first", "second"]);
    expect(harness.recordedReports).toHaveLength(1);
    expect(harness.counts.begin).toBe(1);
  });

  it("keeps a manual-step failure latched until reset", () => {
    const harness = controllerHarness(new World(3, 1));
    harness.controller.configure(puzzleWith([
      caseDefinition("loss", 5, () => chargedVictoryWorld(-1)),
    ]));

    harness.controller.step(0, 0);
    harness.controller.step(0, 1);
    expect(harness.controller.lifecycle.kind).toBe("failed");
    expect(harness.view.failure).toContain('test case "Case loss"');
    expect(harness.recordedReports).toEqual([null]);

    harness.controller.step(0, 2);
    expect(harness.controller.lifecycle.kind).toBe("failed");
    expect(harness.counts.begin).toBe(1);
    expect(harness.recordedReports).toEqual([null]);
  });
});
