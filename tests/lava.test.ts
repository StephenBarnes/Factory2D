import { describe, expect, it } from "vitest";
import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { PistonResolver } from "../src/simulation/piston-resolver";
import { RotatorResolver } from "../src/simulation/rotator-resolver";
import { watchShatterAnimation } from "../src/simulation/shatter-animation";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("lava terrain", () => {
  it("cuts only the contacting part of a falling body and removes its welds", () => {
    const world = new World(4, 5);
    world.place(1, 1, TileKind.Stone);
    const survivor = world.place(2, 1, TileKind.Stone);
    world.setWeld(1, 1, 2, 1, true);
    const lava = world.place(1, 2, TileKind.Lava);
    const effects = watchShatterAnimation(world);
    new Simulation(world).step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(world.idAt(2, 2)).toBe(survivor);
    expect(world.idAt(1, 2)).toBe(lava);
    expect(world.isWelded(1, 2, 2, 2)).toBe(false);
    expect(effects.get(9)?.kind).toBe(TileKind.Stone);
  });

  it("destroys an incoming destroyer without destroying or displacing the lava", () => {
    const world = new World(3, 5);
    world.place(1, 1, TileKind.Destroyer);
    const lava = world.place(1, 2, TileKind.Lava);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(world.idAt(1, 2)).toBe(lava);
    expect(world.kindAt(1, 3)).toBe(TileKind.Empty);
  });

  it("supports indestructible blocks and leaves adjacent stationary blocks alone", () => {
    const world = new World(4, 5);
    const channel = world.place(1, 1, TileKind.IndestructibleConduit);
    const lava = world.place(1, 2, TileKind.Lava);
    const stone = world.place(2, 2, TileKind.Stone);
    world.place(2, 3, TileKind.Platform);
    expect(world.setWeld(1, 2, 2, 2, true)).toBe(false);
    new Simulation(world).step();
    expect(world.idAt(1, 1)).toBe(channel);
    expect(world.idAt(1, 2)).toBe(lava);
    expect(world.idAt(2, 2)).toBe(stone);
  });

  it("does not burn a body whose fall is blocked elsewhere", () => {
    const world = new World(4, 5);
    const stone = world.place(1, 1, TileKind.Stone);
    world.place(2, 1, TileKind.Stone);
    world.setWeld(1, 1, 2, 1, true);
    world.place(1, 2, TileKind.Lava);
    world.place(2, 2, TileKind.Platform);
    new Simulation(world).step();
    expect(world.idAt(1, 1)).toBe(stone);
    expect(world.isWelded(1, 1, 2, 1)).toBe(true);
  });

  it("destroys a newly extended piston arm without pushing lava", () => {
    const world = new World(5, 5);
    world.place(1, 2, TileKind.Piston, Direction.Right);
    world.setCharge(1, 2, 1);
    world.place(1, 3, TileKind.Platform);
    world.setWeld(1, 2, 1, 3, true);
    const lava = world.place(2, 2, TileKind.Lava);
    new PistonResolver(world).resolve();
    expect(world.kindAt(1, 2)).toBe(TileKind.PistonBase);
    expect(world.idAt(2, 2)).toBe(lava);
    expect(world.isWelded(1, 2, 2, 2)).toBe(false);
  });

  it("cuts a rotating head at a swept-only contact without capturing lava", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Rotator, Direction.Up);
    world.setCharge(3, 3, 1);
    world.place(3, 2, TileKind.Stone);
    world.setWeld(3, 3, 3, 2, true);
    const lava = world.place(4, 2, TileKind.Lava);
    new RotatorResolver(world).resolve();
    expect(world.kindAt(3, 2)).toBe(TileKind.Empty);
    expect(world.kindAt(4, 3)).toBe(TileKind.Empty);
    expect(world.idAt(4, 2)).toBe(lava);
    expect(world.rotatorDirectionAtIndex(24)).toBe(Direction.Right);
  });

  it("preserves lava contact behavior inside serialized nested arrays", () => {
    const original = new World(1, 1);
    original.place(0, 0, TileKind.RuneArray);
    const inner = original.runeArrayWorldAt(0, 0);
    inner.place(2, 1, TileKind.Stone);
    inner.place(2, 2, TileKind.Lava);
    const world = deserializeBoard(serializeBoard(original, 0)).world;
    new Simulation(world).step();
    expect(world.runeArrayWorldAt(0, 0).kindAt(2, 1)).toBe(TileKind.Empty);
    expect(world.runeArrayWorldAt(0, 0).kindAt(2, 2)).toBe(TileKind.Lava);
  });
});
