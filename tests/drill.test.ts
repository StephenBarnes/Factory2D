import { describe, expect, it } from "vitest";
import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("drills", () => {
  it("removes only the target and its welds, releasing the supported body before gravity", () => {
    const world = new World(4, 3);
    world.place(0, 0, TileKind.Drill, Direction.Right);
    world.place(0, 1, TileKind.Platform);
    world.place(1, 0, TileKind.Platform);
    world.place(2, 0, TileKind.Stone);
    world.setWeld(1, 0, 2, 0, true);
    const stoneId = world.idAt(2, 0);

    new Simulation(world).step();

    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
    expect(world.isWelded(1, 0, 2, 0)).toBe(false);
    expect(world.idAt(2, 1)).toBe(stoneId);
    expect(world.kindAt(0, 0)).toBe(TileKind.Drill);
  });

  it("destroys mutually facing drills simultaneously", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Drill, Direction.Right);
    world.place(1, 0, TileKind.Drill, Direction.Left);

    new Simulation(world).step();

    expect(world.kindAt(0, 0)).toBe(TileKind.Empty);
    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
  });

  it("jams competing drills and clears the claim when a drill is removed", () => {
    const world = new World(3, 1);
    world.place(0, 0, TileKind.Drill, Direction.Right);
    world.place(1, 0, TileKind.Stone);
    world.place(2, 0, TileKind.Drill, Direction.Left);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
    world.place(2, 0, TileKind.Empty);
    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
  });

  it("preserves side-disable control on save/load and resumes from neutral", () => {
    const original = new World(1, 2);
    original.place(0, 0, TileKind.Stone);
    original.place(0, 1, TileKind.Drill, Direction.Up);
    original.setCharge(0, 1, -1);
    const { world } = deserializeBoard(serializeBoard(original, 0));
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(0, 0)).toBe(TileKind.Stone);
    simulation.step();
    expect(world.kindAt(0, 0)).toBe(TileKind.Empty);
  });

  it("does not wrap horizontal targets across board boundaries", () => {
    const world = new World(2, 2);
    world.place(1, 0, TileKind.Drill, Direction.Right);
    world.place(1, 1, TileKind.Platform);
    world.place(0, 1, TileKind.Stone);

    new Simulation(world).step();

    expect(world.kindAt(0, 1)).toBe(TileKind.Stone);
  });

  it("waits until the next tick to destroy a block falling into its front cell", () => {
    const world = new World(2, 2);
    world.place(0, 1, TileKind.Drill, Direction.Right);
    world.place(1, 0, TileKind.Stone);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Stone);
    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
  });

  it("drills downward inside a nested rune array", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.RuneArray);
    world.configureRuneArray(0, 0, 1, 3, "");
    const inner = world.runeArrayWorldAt(0, 0);
    inner.place(0, 0, TileKind.Drill, Direction.Down);
    inner.place(0, 1, TileKind.Platform);
    inner.place(0, 2, TileKind.Platform);

    new Simulation(world).step();

    expect(inner.kindAt(0, 1)).toBe(TileKind.Drill);
    expect(inner.kindAt(0, 2)).toBe(TileKind.Platform);
  });
});
