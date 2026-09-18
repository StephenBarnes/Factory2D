import { afterEach, describe, expect, it, vi } from "vitest";

import { TileSelectionState } from "../src/game/tile-selection";
import {
  WorkshopSurfaceController,
  type WorkshopSurfaceFactories,
} from "../src/game/workshop-surface-controller";
import { WorkshopSessionController } from "../src/game/workshop-session";
import { CanvasRenderer } from "../src/render/canvas-renderer";
import type { World } from "../src/simulation/world";
import { World as MutableWorld } from "../src/simulation/world";
import type { TileInspector } from "../src/ui/tile-inspector";
import { TileKind } from "../src/simulation/tile";

afterEach(() => vi.unstubAllGlobals());

interface SurfaceHarness {
  readonly sessions: WorkshopSessionController;
  readonly surface: WorkshopSurfaceController;
}

function surfaceHarness(initialWorld: World): SurfaceHarness {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  const canvas = {
    clientWidth: 640,
    clientHeight: 480,
    width: 0,
    height: 0,
    getContext: () => ({ setTransform: () => {} }),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLCanvasElement;
  const sessions = new WorkshopSessionController(initialWorld);
  const factories: WorkshopSurfaceFactories = {
    createRenderer: (canvas, world, region, nested) => new CanvasRenderer(canvas, world, region, nested),
    createSelection: (width, height) => new TileSelectionState(width, height),
    createInspector: () => ({} as TileInspector),
  };
  const surface = new WorkshopSurfaceController(
    sessions,
    canvas,
    {} as HTMLElement,
    factories,
  );
  surface.renderer.fitBoardToViewport();
  return { sessions, surface };
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
  });

  it("uses the same mount path without fitting when only bindings need refresh", () => {
    const harness = surfaceHarness(new MutableWorld(2, 2));
    const runtime = new MutableWorld(2, 2);
    harness.surface.renderer.zoomAtClientPoint(300, 200, 400);
    harness.surface.renderer.panByPixels(50, 20);
    const point = harness.surface.renderer.gridPointFromClientPoint(123, 234);
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
    expect(harness.surface.renderer.gridPointFromClientPoint(123, 234)).toEqual(point);
  });

  it("restores each parent's zoom and pan when leaving multiple nested arrays", () => {
    const world = new MutableWorld(30, 20);
    world.place(4, 4, TileKind.RuneArray);
    world.runeArrayWorldAt(4, 4).place(2, 2, TileKind.RuneArray);
    const { surface } = surfaceHarness(world);
    surface.renderer.zoomAtClientPoint(300, 200, -250);
    surface.renderer.panByPixels(80, -30);
    const rootPoint = surface.renderer.gridPointFromClientPoint(123, 234);
    surface.enterRuneArray({ x: 4, y: 4 });
    surface.renderer.zoomAtClientPoint(300, 200, -150);
    surface.renderer.panByPixels(-40, 20);
    const innerPoint = surface.renderer.gridPointFromClientPoint(123, 234);
    surface.enterRuneArray({ x: 2, y: 2 });
    surface.renderer.panByPixels(60, 60);

    surface.exitRuneArray();
    expect(surface.renderer.gridPointFromClientPoint(123, 234)).toEqual(innerPoint);
    surface.exitRuneArray();
    expect(surface.renderer.gridPointFromClientPoint(123, 234)).toEqual(rootPoint);
  });

  it("restores the root camera when a remount leaves a nested view", () => {
    const world = new MutableWorld(30, 20);
    world.place(4, 4, TileKind.RuneArray);
    const { surface, sessions } = surfaceHarness(world);
    surface.renderer.panByPixels(80, -30);
    const rootPoint = surface.renderer.gridPointFromClientPoint(123, 234);
    surface.enterRuneArray({ x: 4, y: 4 });

    surface.mountActiveSession({
      fitBoard: false,
      cancelInteraction: true,
      updateSession: () => sessions.showActiveRuntime(world.clone()),
    });
    expect(surface.viewDepth).toBe(0);
    expect(surface.renderer.gridPointFromClientPoint(123, 234)).toEqual(rootPoint);
    surface.enterRuneArray({ x: 4, y: 4 });
    surface.exitRuneArray();
    expect(surface.renderer.gridPointFromClientPoint(123, 234)).toEqual(rootPoint);
  });

  it("restores the surviving ancestor's view when an entered array disappears", () => {
    const world = new MutableWorld(30, 20);
    world.place(4, 4, TileKind.RuneArray);
    world.runeArrayWorldAt(4, 4).place(2, 2, TileKind.RuneArray);
    const { surface } = surfaceHarness(world);
    surface.renderer.panByPixels(80, -30);
    const rootPoint = surface.renderer.gridPointFromClientPoint(123, 234);
    surface.enterRuneArray({ x: 4, y: 4 });
    surface.enterRuneArray({ x: 2, y: 2 });
    world.place(4, 4, TileKind.Empty);

    surface.refreshView();
    expect(surface.viewDepth).toBe(0);
    expect(surface.renderer.gridPointFromClientPoint(123, 234)).toEqual(rootPoint);
  });
});
