import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function upwardConveyor(world: World): void {
  world.place(1, 2, TileKind.Conveyor);
  world.place(1, 3, TileKind.FixedCharge);
  world.place(1, 4, TileKind.Platform);
  world.setWeld(1, 2, 1, 3, true);
  world.setWeld(1, 3, 1, 4, true);
}

function upwardPiston(world: World): void {
  world.place(2, 3, TileKind.Piston, Direction.Up);
  world.place(1, 3, TileKind.FixedCharge);
  world.place(2, 4, TileKind.Platform);
  world.setWeld(2, 3, 1, 3, true);
  world.setWeld(2, 3, 2, 4, true);
}

describe("fasteners", () => {
  it("holds a saved welded body aloft and releases it when unwelded", () => {
    const original = new World(3, 4);
    original.place(0, 0, TileKind.Fastener);
    original.place(1, 0, TileKind.Stone);
    original.setWeld(0, 0, 1, 0, true);
    const world = deserializeBoard(serializeBoard(original.clone(), 0)).world;
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.kindAt(0, 0)).toBe(TileKind.Fastener);
    expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
    world.setWeld(0, 0, 1, 0, false);
    simulation.step();
    expect(world.kindAt(0, 0)).toBe(TileKind.Fastener);
    expect(world.kindAt(1, 1)).toBe(TileKind.Stone);
  });

  it("survives downward movement caused by independent falling weight", () => {
    const world = new World(1, 6);
    world.place(0, 0, TileKind.Stone);
    const fastener = world.place(0, 1, TileKind.Fastener);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(0, 2)).toBe(fastener);
    world.place(0, 1, TileKind.Empty);
    simulation.step();
    expect(world.idAt(0, 2)).toBe(fastener);
  });

  it("breaks after a conveyor lifts its load, which then falls on the next tick", () => {
    const world = new World(4, 5);
    upwardConveyor(world);
    world.place(0, 2, TileKind.Fastener);
    const load = world.place(0, 3, TileKind.Stone);
    world.setWeld(0, 2, 0, 3, true);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.kindAt(0, 1)).toBe(TileKind.Empty);
    expect(world.idAt(0, 2)).toBe(load);
    expect(world.isWelded(0, 1, 0, 2)).toBe(false);
    simulation.step();
    expect(world.idAt(0, 3)).toBe(load);
  });

  it("retains fasteners when a conveyor's movement is blocked", () => {
    const world = new World(4, 5);
    upwardConveyor(world);
    const fastener = world.place(0, 2, TileKind.Fastener);
    world.place(0, 1, TileKind.Platform);
    new Simulation(world).step();
    expect(world.idAt(0, 2)).toBe(fastener);
  });

  it("breaks every fastener in a piston-pushed load without losing the surviving body", () => {
    const world = new World(5, 6);
    upwardPiston(world);
    world.place(2, 2, TileKind.Fastener);
    world.place(3, 2, TileKind.Fastener);
    const load = world.place(4, 2, TileKind.Stone);
    world.setWeld(2, 2, 3, 2, true);
    world.setWeld(3, 2, 4, 2, true);
    world.setWeld(2, 3, 2, 2, true);
    new Simulation(world).step();
    expect(world.kindAt(2, 2)).toBe(TileKind.PistonArm);
    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(3, 1)).toBe(TileKind.Empty);
    expect(world.idAt(4, 1)).toBe(load);
    expect(world.isWelded(2, 2, 2, 1)).toBe(false);
    expect(world.isWelded(3, 1, 4, 1)).toBe(false);
  });
  it("breaks a fastener carried by a recoiling piston base", () => {
    const world = new World(5, 5);
    world.place(2, 2, TileKind.Piston, Direction.Down);
    const input = world.place(1, 2, TileKind.FixedCharge);
    world.place(3, 2, TileKind.Fastener);
    world.setWeld(2, 2, 1, 2, true);
    world.setWeld(2, 2, 3, 2, true);
    world.place(2, 3, TileKind.Platform);
    new Simulation(world).step();
    expect(world.kindAt(2, 1)).toBe(TileKind.PistonBase);
    expect(world.kindAt(2, 2)).toBe(TileKind.PistonArm);
    expect(world.idAt(1, 1)).toBe(input);
    expect(world.kindAt(3, 1)).toBe(TileKind.Empty);
    expect(world.isWelded(2, 1, 3, 1)).toBe(false);
  });


  it("removes a retracted head-welded fastener only after the piston transition", () => {
    const world = new World(5, 6);
    upwardPiston(world);
    const simulation = new Simulation(world);
    simulation.step();
    world.place(2, 1, TileKind.Fastener);
    world.setWeld(2, 2, 2, 1, true);
    world.place(1, 3, TileKind.Inverter, Direction.Right);
    world.place(1, 4, TileKind.FixedCharge);
    world.setWeld(1, 3, 2, 3, true);
    world.setWeld(1, 3, 1, 4, true);
    simulation.step();
    expect(world.kindAt(2, 3)).toBe(TileKind.PistonBase);
    simulation.step();
    expect(world.kindAt(2, 3)).toBe(TileKind.Piston);
    expect(world.kindAt(2, 2)).toBe(TileKind.Empty);
    expect(world.isWelded(2, 3, 2, 2)).toBe(false);
  });

  it("does not break a load when both piston extension and recoil are blocked", () => {
    const world = new World(5, 6);
    upwardPiston(world);
    const fastener = world.place(2, 2, TileKind.Fastener);
    world.place(2, 1, TileKind.Platform);
    new Simulation(world).step();
    expect(world.idAt(2, 2)).toBe(fastener);
    expect(world.kindAt(2, 3)).toBe(TileKind.Piston);
  });

  it.each([false, true])("breaks only on accepted rotator turns (blocked: %s)", (blocked) => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Rotator, Direction.Up);
    world.place(3, 4, TileKind.FixedCharge);
    world.place(3, 5, TileKind.Platform);
    world.setWeld(3, 3, 3, 4, true);
    world.setWeld(3, 4, 3, 5, true);
    const fastener = world.place(3, 2, TileKind.Fastener);
    const load = world.place(3, 1, TileKind.Stone);
    world.setWeld(3, 2, 3, 1, true);
    if (blocked) world.place(4, 3, TileKind.Platform);
    new Simulation(world).step();
    if (blocked) {
      expect(world.idAt(3, 2)).toBe(fastener);
      expect(world.idAt(3, 1)).toBe(load);
    } else {
      expect(world.kindAt(4, 3)).toBe(TileKind.Empty);
      expect(world.idAt(5, 3)).toBe(load);
      expect(world.isWelded(4, 3, 5, 3)).toBe(false);
    }
  });

  it("runs the same fastener release inside a nested rune array", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.RuneArray);
    const inner = world.runeArrayWorldAt(0, 0);
    upwardConveyor(inner);
    inner.place(0, 2, TileKind.Fastener);
    const load = inner.place(0, 3, TileKind.Stone);
    inner.setWeld(0, 2, 0, 3, true);
    new Simulation(world).step();
    expect(inner.kindAt(0, 1)).toBe(TileKind.Empty);
    expect(inner.idAt(0, 2)).toBe(load);
  });
});
