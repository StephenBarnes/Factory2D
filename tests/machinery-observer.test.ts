import { describe, expect, it } from "vitest";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";
import { MachineryObserver } from "../src/ui/machinery-observer";

describe("machinery sound observations", () => {
  it("follows piston head identity through extension and retraction, not held charge", () => {
    const world = new World(5, 1);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.Conduit);
    world.place(2, 0, TileKind.Piston, Direction.Right);
    world.setWeld(0, 0, 1, 0, true);
    world.setWeld(1, 0, 2, 0, true);
    const simulation = new Simulation(world);
    const observer = new MachineryObserver();
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual(new Set(["extend"]));
    expect(observer.collectSounds(world)).toEqual(new Set());
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual(new Set());

    world.place(1, 0, TileKind.Inverter, Direction.Right);
    world.setWeld(0, 0, 1, 0, true);
    world.setWeld(1, 0, 2, 0, true);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual(new Set(["retract"]));
  });

  it("keeps blocked pistons and competing drills silent", () => {
    const world = new World(6, 1);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.Piston, Direction.Right);
    world.setWeld(0, 0, 1, 0, true);
    world.place(2, 0, TileKind.Platform);
    world.place(3, 0, TileKind.Drill, Direction.Right);
    world.place(4, 0, TileKind.Stone);
    world.place(5, 0, TileKind.Drill, Direction.Left);
    const observer = new MachineryObserver();
    observer.capture(world);
    new Simulation(world).step();
    expect(observer.collectSounds(world)).toEqual(new Set());
  });

  it("sounds for active processing including completion, but not pause or idle ticks", () => {
    const world = new World(6, 1);
    world.place(0, 0, TileKind.Furnace, Direction.Right);
    world.place(1, 0, TileKind.Sand);
    world.place(2, 0, TileKind.Grinder, Direction.Right);
    world.place(3, 0, TileKind.Stone);
    world.place(4, 0, TileKind.Drill, Direction.Right);
    world.place(5, 0, TileKind.Stone);
    for (const x of [0, 2, 4]) world.setCharge(x, 0, -1);
    const observer = new MachineryObserver();
    const simulation = new Simulation(world);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual(new Set());
    for (let tick = 0; tick < 4; tick += 1) {
      observer.capture(world);
      simulation.step();
      expect(observer.collectSounds(world)).toEqual(new Set(
        tick === 3 ? ["furnace", "grinder", "drill", "break"] : ["furnace", "grinder", "drill"],
      ));
    }
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual(new Set());
  });

  it("observes nested machines without replaying activity from copies or skipped captures", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.RuneArray);
    world.configureRuneArray(0, 0, 3, 1, "");
    const inner = world.runeArrayWorldAt(0, 0);
    inner.place(0, 0, TileKind.Drill, Direction.Right);
    inner.place(1, 0, TileKind.Stone);
    const observer = new MachineryObserver();
    const simulation = new Simulation(world);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual(new Set(["drill"]));
    simulation.step();
    expect(observer.collectSounds(world)).toEqual(new Set());

    observer.capture(world);
    simulation.step();
    world.place(1, 0, TileKind.RuneArray);
    world.configureRuneArray(1, 0, 3, 1, "");
    world.runeArrayWorldAt(1, 0).copyFrom(inner);
    world.place(0, 0, TileKind.Empty);
    expect(observer.collectSounds(world)).toEqual(new Set());
  });

  it("hears unwatched nested glass landings without replaying skipped ticks or erased tiles", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.RuneArray);
    world.configureRuneArray(0, 0, 3, 3, "");
    const inner = world.runeArrayWorldAt(0, 0);
    inner.place(0, 0, TileKind.Glass);
    inner.place(1, 0, TileKind.Glass);
    inner.place(2, 0, TileKind.Glass);
    inner.place(2, 2, TileKind.Platform);
    const observer = new MachineryObserver();
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 2; tick += 1) {
      observer.capture(world);
      simulation.step();
      expect(observer.collectSounds(world)).toEqual(new Set());
    }
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual(new Set(["shatter"]));
    expect(observer.collectSounds(world)).toEqual(new Set());

    inner.place(0, 0, TileKind.Glass);
    simulation.step();
    simulation.step();
    simulation.step();
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual(new Set());
    observer.capture(world);
    inner.place(2, 1, TileKind.Empty);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual(new Set());
  });

  it("snaps only after accepted fastener movement, even without a mounted animation", () => {
    const world = new World(3, 1);
    world.place(0, 0, TileKind.Thruster, Direction.Right);
    world.place(1, 0, TileKind.Fastener);
    world.setWeld(0, 0, 1, 0, true);
    world.place(2, 0, TileKind.Platform);
    const observer = new MachineryObserver();
    const simulation = new Simulation(world);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual(new Set());
    world.place(2, 0, TileKind.Empty);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual(new Set(["snap"]));
  });
});
