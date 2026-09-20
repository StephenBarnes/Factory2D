import { describe, expect, it } from "vitest";
import { watchMachineryActivity } from "../src/simulation/machinery-activity";
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
    expect(observer.collectSounds(world)).toEqual([{ voice: "extend", world, index: 2 }]);
    expect(observer.collectSounds(world)).toEqual([]);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([]);

    world.place(1, 0, TileKind.Inverter, Direction.Right);
    world.setWeld(0, 0, 1, 0, true);
    world.setWeld(1, 0, 2, 0, true);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([{ voice: "retract", world, index: 2 }]);
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
    expect(observer.collectSounds(world)).toEqual([]);
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
    expect(observer.collectSounds(world)).toEqual([]);
    for (let tick = 0; tick < 4; tick += 1) {
      observer.capture(world);
      simulation.step();
      expect(observer.collectSounds(world)).toEqual([
        ...(tick === 3 ? [{ voice: "break", world, index: 5 }] : []),
        { voice: "drill", world, index: 4 },
        { voice: "furnace", world, index: 0 },
        { voice: "grinder", world, index: 2 },
      ]);
    }
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([]);
  });

  it("retains every committed producer site through batched consumption and emission", () => {
    const world = new World(16, 1);
    for (const x of [1, 5]) {
      world.place(x - 1, 0, TileKind.Stone);
      world.place(x, 0, TileKind.Duplicator, Direction.Right);
      world.setCharge(x, 0, 1);
    }
    for (const x of [9, 13]) {
      world.place(x, 0, TileKind.Assembler, Direction.Right);
      world.place(x + 1, 0, TileKind.Iron);
      world.place(x + 2, 0, TileKind.Stone);
      world.setWeld(x + 1, 0, x + 2, 0, true);
    }
    const observer = new MachineryObserver();
    const simulation = new Simulation(world);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([
      { voice: "duplicator", world, index: 1 },
      { voice: "duplicator", world, index: 5 },
      { voice: "assembler", world, index: 9 },
      { voice: "assembler", world, index: 13 },
    ]);

    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([
      { voice: "assembler", world, index: 9 },
      { voice: "assembler", world, index: 13 },
    ]);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([]);
  });

  it("stops retaining unobserved commits after collection and reopens a fresh window", () => {
    const world = new World(3, 1);
    world.place(0, 0, TileKind.Stone);
    world.place(1, 0, TileKind.Duplicator, Direction.Right);
    world.setCharge(1, 0, 1);
    const activity = watchMachineryActivity(world);
    const observer = new MachineryObserver();
    const simulation = new Simulation(world);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([{ voice: "duplicator", world, index: 1 }]);

    for (let tick = 0; tick < 100; tick += 1) {
      world.place(2, 0, TileKind.Empty);
      world.setCharge(1, 0, 1);
      simulation.step();
    }
    expect(activity).toEqual([{ voice: "duplicator", index: 1 }]);

    world.place(2, 0, TileKind.Empty);
    world.setCharge(1, 0, 1);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([{ voice: "duplicator", world, index: 1 }]);
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
    expect(observer.collectSounds(world)).toEqual([{ voice: "drill", world: inner, index: 0 }]);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([]);

    observer.capture(world);
    simulation.step();
    world.place(1, 0, TileKind.RuneArray);
    world.configureRuneArray(1, 0, 3, 1, "");
    world.runeArrayWorldAt(1, 0).copyFrom(inner);
    world.place(0, 0, TileKind.Empty);
    expect(observer.collectSounds(world)).toEqual([]);
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
      expect(observer.collectSounds(world)).toEqual([]);
    }
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([
      { voice: "shatter", world: inner, index: 6 },
      { voice: "shatter", world: inner, index: 7 },
    ]);
    expect(observer.collectSounds(world)).toEqual([]);

    inner.place(0, 0, TileKind.Glass);
    simulation.step();
    simulation.step();
    simulation.step();
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([]);
    observer.capture(world);
    inner.place(2, 1, TileKind.Empty);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([]);
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
    expect(observer.collectSounds(world)).toEqual([]);
    world.place(2, 0, TileKind.Empty);
    observer.capture(world);
    simulation.step();
    expect(observer.collectSounds(world)).toEqual([{ voice: "snap", world, index: 2 }]);
  });
});
