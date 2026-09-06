import { describe, expect, it } from "vitest";

import { TileSelectionState } from "../src/game/tile-selection";
import { WorkshopEditingState } from "../src/game/workshop-editing-state";
import type { WorkshopSession } from "../src/game/workshop-session";
import type { CanvasRenderer } from "../src/render/canvas-renderer";
import type { GridCell, GridEdge, GridPoint } from "../src/render/grid-drag";
import { Simulation } from "../src/simulation/simulation";
import { TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";
import {
  CanvasInteractionController,
  type BuildTool,
  type CanvasInteractionCallbacks,
  type CanvasInteractionSurface,
} from "../src/ui/canvas-interaction-controller";

class FakeClassList {
  private readonly values = new Set<string>();

  add(value: string): void {
    this.values.add(value);
  }

  remove(value: string): void {
    this.values.delete(value);
  }

  contains(value: string): boolean {
    return this.values.has(value);
  }
}

class FakeCanvas {
  readonly classList = new FakeClassList();
  readonly captured = new Set<number>();

  addEventListener(): void {
    // Tests drive the public handlers directly.
  }

  setPointerCapture(pointerId: number): void {
    this.captured.add(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captured.has(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.captured.delete(pointerId);
  }
}

class FakeRenderer {
  readonly pans: Array<readonly [number, number]> = [];

  constructor(private readonly world: World) {}

  gridPointFromClientPoint(clientX: number, clientY: number): GridPoint {
    return { x: clientX, y: clientY };
  }

  cellFromGridPoint(point: GridPoint): GridCell | null {
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    return x >= 0 && x < this.world.width && y >= 0 && y < this.world.height
      ? { x, y }
      : null;
  }

  edgeFromGridPoint(_point: GridPoint): GridEdge | null {
    return null;
  }

  panByPixels(deltaX: number, deltaY: number): void {
    this.pans.push([deltaX, deltaY]);
  }
}

interface MutableFakeSurface extends CanvasInteractionSurface {
  session: WorkshopSession;
}

interface InteractionHarness {
  readonly controller: CanvasInteractionController;
  readonly surface: MutableFakeSurface;
  readonly canvas: FakeCanvas;
  readonly renderer: FakeRenderer;
  readonly editedLines: Array<{ from: GridCell; to: GridCell }>;
  readonly counts: {
    weld: number;
    pick: number;
    commit: number;
    hover: number;
  };
  setTool(tool: BuildTool): void;
}

function sessionFor(world: World): WorkshopSession {
  return {
    world,
    simulation: new Simulation(world),
    baseline: world.clone(),
    previousWorld: world.clone(),
    editableRegion: null,
    editableRegionAuthoring: null,
    availableComponents: null,
    puzzleAuthoring: null,
    editingState: new WorkshopEditingState(false),
  };
}

function event(
  type: string,
  options: Partial<{
    pointerId: number;
    button: number;
    buttons: number;
    clientX: number;
    clientY: number;
    altKey: boolean;
    shiftKey: boolean;
  }> = {},
) {
  const button = options.button ?? 0;
  const pressedButtons = button === 1 ? 4 : button === 2 ? 2 : 1;
  const buttons = options.buttons ??
    (type === "pointerup" || type === "pointercancel" || type === "lostpointercapture"
      ? 0
      : pressedButtons);
  return {
    type,
    pointerId: options.pointerId ?? 1,
    button,
    buttons,
    clientX: options.clientX ?? 0.5,
    clientY: options.clientY ?? 0.5,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
    preventDefault: () => undefined,
  };
}

function interactionHarness(): InteractionHarness {
  const world = new World(4, 2);
  const canvas = new FakeCanvas();
  const renderer = new FakeRenderer(world);
  const surface: MutableFakeSurface = {
    canvas: canvas as unknown as HTMLCanvasElement,
    session: sessionFor(world),
    world,
    renderer: renderer as unknown as CanvasRenderer,
    selection: new TileSelectionState(world.width, world.height),
    hoveredCell: null,
    hoveredEdge: null,
    clearPointerHover() {
      this.hoveredCell = null;
      this.hoveredEdge = null;
    },
  };
  let selectedTool: BuildTool = "tile";
  const editedLines: Array<{ from: GridCell; to: GridCell }> = [];
  const counts = { weld: 0, pick: 0, commit: 0, hover: 0 };
  const callbacks: CanvasInteractionCallbacks = {
    getSelectedTool: () => selectedTool,
    getSelectedKind: () => TileKind.Stone,
    editCellLine: (from, to) => {
      editedLines.push({ from: { ...from }, to: { ...to } });
      return true;
    },
    editWeld: () => {
      counts.weld += 1;
      return true;
    },
    editWeldSegment: () => {
      counts.weld += 1;
      return true;
    },
    commitSelection: () => undefined,
    syncSelectionOverlay: () => undefined,
    syncEditableRegionOverlay: () => undefined,
    refreshHover: () => {
      counts.hover += 1;
    },
    pickTile: () => {
      counts.pick += 1;
    },
    openConfiguration: () => undefined,
    commitEditTransaction: () => {
      counts.commit += 1;
    },
  };
  return {
    controller: new CanvasInteractionController(surface, callbacks),
    surface,
    canvas,
    renderer,
    editedLines,
    counts,
    setTool(tool) {
      selectedTool = tool;
    },
  };
}

describe("canvas interaction controller", () => {
  it("cancels a captured edit and commits its transaction exactly once", () => {
    const harness = interactionHarness();
    harness.controller.handlePointerDown(event("pointerdown"));

    expect(harness.canvas.captured.has(1)).toBe(true);
    expect(harness.controller.cancel()).toBe(true);
    expect(harness.controller.cancel()).toBe(false);

    expect(harness.counts.commit).toBe(1);
    expect(harness.canvas.captured.has(1)).toBe(false);
    expect(harness.controller.activePointerId).toBeNull();
  });

  it("cancels before moving when the initiating button is no longer pressed", () => {
    const harness = interactionHarness();
    harness.controller.handlePointerDown(event("pointerdown", {
      button: 2,
      shiftKey: true,
    }));
    expect(harness.editedLines).toHaveLength(1);

    harness.controller.handlePointerMove(event("pointermove", {
      button: 2,
      buttons: 0,
      clientX: 2.5,
    }));
    harness.controller.handlePointerMove(event("pointermove", {
      buttons: 0,
      clientX: 3.5,
    }));

    expect(harness.editedLines).toHaveLength(1);
    expect(harness.counts.commit).toBe(1);
    expect(harness.controller.activePointerId).toBeNull();
    expect(harness.canvas.captured.has(1)).toBe(false);
  });

  it("keeps an edit continuous after leaving and re-entering the grid", () => {
    const harness = interactionHarness();
    harness.controller.handlePointerDown(event("pointerdown", { clientX: 0.5 }));
    harness.controller.handlePointerLeave();
    harness.controller.handlePointerMove(event("pointermove", { clientX: -1 }));
    harness.controller.handlePointerMove(event("pointermove", { clientX: 2.5 }));
    harness.controller.handlePointerFinish(event("pointerup", { clientX: 2.5 }));

    expect(harness.editedLines.at(-1)?.to).toEqual({ x: 2, y: 0 });
    expect(harness.counts.commit).toBe(1);
    expect(harness.controller.activePointerId).toBeNull();
  });

  it("distinguishes a middle-click pick from a middle-button pan", () => {
    const pickHarness = interactionHarness();
    pickHarness.controller.handlePointerDown(event("pointerdown", { button: 1 }));
    pickHarness.controller.handlePointerFinish(event("pointerup", { button: 1 }));
    expect(pickHarness.counts.pick).toBe(1);
    expect(pickHarness.renderer.pans).toHaveLength(0);

    const panHarness = interactionHarness();
    panHarness.controller.handlePointerDown(event("pointerdown", { button: 1 }));
    panHarness.controller.handlePointerMove(event("pointermove", {
      button: 1,
      clientX: 10.5,
    }));
    panHarness.controller.handlePointerFinish(event("pointerup", {
      button: 1,
      clientX: 10.5,
    }));
    expect(panHarness.counts.pick).toBe(0);
    expect(panHarness.renderer.pans).toEqual([[10, 0]]);
  });

  it("keeps middle-button and Alt-secondary-button pans active across simulation steps", () => {
    const middleHarness = interactionHarness();
    middleHarness.controller.handlePointerDown(event("pointerdown", { button: 1 }));
    middleHarness.controller.handlePointerMove(event("pointermove", {
      button: 1,
      clientX: 10.5,
    }));
    middleHarness.controller.prepareSimulationStep();
    middleHarness.controller.handlePointerMove(event("pointermove", {
      button: 1,
      clientX: 15.5,
    }));

    expect(middleHarness.canvas.captured.has(1)).toBe(true);
    expect(middleHarness.renderer.pans).toEqual([[10, 0], [5, 0]]);

    const alternateHarness = interactionHarness();
    alternateHarness.controller.handlePointerDown(event("pointerdown", {
      button: 2,
      altKey: true,
    }));
    alternateHarness.controller.prepareSimulationStep();
    alternateHarness.controller.handlePointerMove(event("pointermove", {
      button: 2,
      clientX: 5.5,
    }));

    expect(alternateHarness.canvas.captured.has(1)).toBe(true);
    expect(alternateHarness.renderer.pans).toEqual([[5, 0]]);
  });

  it("uses the tool captured at pointer-down for the entire gesture", () => {
    const harness = interactionHarness();
    harness.controller.handlePointerDown(event("pointerdown"));
    harness.setTool("weld");
    harness.controller.handlePointerMove(event("pointermove", { clientX: 2.5 }));
    harness.controller.handlePointerFinish(event("pointerup", { clientX: 2.5 }));

    expect(harness.editedLines.length).toBeGreaterThan(1);
    expect(harness.counts.weld).toBe(0);
    expect(harness.counts.commit).toBe(1);
  });

  it("cancels stale captured state when the mounted session changes", () => {
    const harness = interactionHarness();
    harness.controller.handlePointerDown(event("pointerdown"));
    const replacementWorld = new World(4, 2);
    harness.surface.session = sessionFor(replacementWorld);

    harness.controller.handlePointerMove(event("pointermove", { clientX: 1.5 }));
    harness.controller.handlePointerFinish(event("pointerup", { clientX: 1.5 }));

    expect(harness.counts.commit).toBe(1);
    expect(harness.controller.activePointerId).toBeNull();
    expect(harness.canvas.captured.has(1)).toBe(false);
  });

  it("commits a pointer-cancel edit once and never opens completion actions", () => {
    const harness = interactionHarness();
    harness.controller.handlePointerDown(event("pointerdown"));
    harness.controller.handlePointerFinish(event("pointercancel"));
    harness.controller.handlePointerFinish(event("pointercancel"));

    expect(harness.counts.commit).toBe(1);
    expect(harness.counts.pick).toBe(0);
  });
});
