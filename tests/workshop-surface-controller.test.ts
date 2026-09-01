import { describe, expect, it } from "vitest";

import { TileSelectionState } from "../src/game/tile-selection";
import {
  WorkshopSurfaceController,
  type WorkshopSurfaceFactories,
} from "../src/game/workshop-surface-controller";
import { WorkshopSessionController } from "../src/game/workshop-session";
import type { CanvasRenderer } from "../src/render/canvas-renderer";
import type { World } from "../src/simulation/world";
import { World as MutableWorld } from "../src/simulation/world";
import type { TileInspector } from "../src/ui/tile-inspector";

class FakeRenderer {
  fitCount = 0;

  fitBoardToViewport(): void {
    this.fitCount += 1;
  }
}

interface SurfaceHarness {
  readonly sessions: WorkshopSessionController;
  readonly surface: WorkshopSurfaceController;
  readonly renderers: FakeRenderer[];
  readonly inspectorWorlds: World[];
}

function surfaceHarness(initialWorld: World): SurfaceHarness {
  const sessions = new WorkshopSessionController(initialWorld);
  const renderers: FakeRenderer[] = [];
  const inspectorWorlds: World[] = [];
  const factories: WorkshopSurfaceFactories = {
    createRenderer: () => {
      const renderer = new FakeRenderer();
      renderers.push(renderer);
      return renderer as unknown as CanvasRenderer;
    },
    createSelection: (width, height) => new TileSelectionState(width, height),
    createInspector: (_panel, world) => {
      inspectorWorlds.push(world);
      return {} as TileInspector;
    },
  };
  const surface = new WorkshopSurfaceController(
    sessions,
    {} as HTMLCanvasElement,
    {} as HTMLElement,
    factories,
  );
  return { sessions, surface, renderers, inspectorWorlds };
}

describe("workshop surface controller", () => {
  it("cancels interaction before replacing and atomically mounting a runtime", () => {
    const initialWorld = new MutableWorld(2, 2);
    const replacementWorld = new MutableWorld(3, 1);
    const harness = surfaceHarness(initialWorld);
    const order: string[] = [];
    harness.surface.hoveredCell = { x: 1, y: 1 };
    harness.surface.hoveredEdge = { x1: 0, y1: 0, x2: 1, y2: 0 };
    harness.surface.setInteractionCanceler(() => {
      order.push("cancel");
      expect(harness.surface.world).toBe(initialWorld);
    });
    harness.surface.setMountListener(() => {
      order.push("mounted");
      expect(harness.surface.world).toBe(replacementWorld);
      expect(harness.surface.simulation.world).toBe(replacementWorld);
      expect(harness.surface.previousWorld).not.toBe(replacementWorld);
    });

    harness.surface.mountActiveSession({
      fitBoard: true,
      cancelInteraction: true,
      updateSession: () => {
        order.push("replace");
        harness.sessions.replaceActiveWorld(replacementWorld, 7);
      },
    });

    expect(order).toEqual(["cancel", "replace", "mounted"]);
    expect(harness.surface.session).toBe(harness.sessions.active);
    expect(harness.surface.selection).toBeInstanceOf(TileSelectionState);
    expect(harness.surface.selection.overlay(() => true, () => true)).toBeNull();
    expect(harness.surface.hoveredCell).toBeNull();
    expect(harness.surface.hoveredEdge).toBeNull();
    expect(harness.surface.simulation.tick).toBe(7);
    expect(harness.renderers.at(-1)?.fitCount).toBe(1);
    expect(harness.inspectorWorlds.at(-1)).toBe(replacementWorld);
  });

  it("uses the same mount path without fitting when only bindings need refresh", () => {
    const harness = surfaceHarness(new MutableWorld(2, 2));
    const runtime = new MutableWorld(2, 2);
    let canceled = 0;
    let mounted = 0;
    harness.surface.setInteractionCanceler(() => {
      canceled += 1;
    });
    harness.surface.setMountListener(() => {
      mounted += 1;
    });

    harness.surface.mountActiveSession({
      fitBoard: false,
      cancelInteraction: false,
      updateSession: () => harness.sessions.showActiveRuntime(runtime),
    });

    expect(canceled).toBe(0);
    expect(mounted).toBe(1);
    expect(harness.surface.world).toBe(runtime);
    expect(harness.renderers.at(-1)?.fitCount).toBe(0);
  });
});
