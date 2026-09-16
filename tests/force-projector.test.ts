import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("force projectors", () => {
  it("lets a conveyor slide levitated stone sideways when projected lift hits a braced ceiling", () => {
    const world = new World(6, 7);
    for (let x = 0; x < 6; x += 1) {
      world.place(x, 0, TileKind.Stone);
      world.place(x, 1, x === 5 ? TileKind.FixedCharge : TileKind.Conveyor);
      world.setCharge(x, 1, 1);
      world.setWeld(x, 0, x, 1, true);
      if (x > 0) {
        world.setWeld(x - 1, 0, x, 0, true);
        world.setWeld(x - 1, 1, x, 1, true);
      }
    }
    const stone = world.place(2, 2, TileKind.Stone);
    world.place(2, 4, TileKind.ForceProjector, Direction.Up);
    world.place(2, 5, TileKind.FixedCharge);
    world.place(2, 6, TileKind.LevitationProjector, Direction.Up);
    world.setCharge(2, 5, 1);
    world.setWeld(2, 4, 2, 5, true);
    world.setWeld(2, 5, 2, 6, true);

    new Simulation(world).step();

    expect(world.idAt(1, 2)).toBe(stone);
    expect(world.kindAt(2, 2)).toBe(TileKind.Empty);
    expect(world.kindAt(2, 1)).toBe(TileKind.Conveyor);
  });

  it("discards a blocked horizontal push chain without cancelling vertical thrust", () => {
    const world = new World(7, 6);
    const target = world.place(2, 3, TileKind.Thruster, Direction.Up);
    world.place(0, 4, TileKind.Platform);
    const pushed = world.place(3, 3, TileKind.Floatstone);
    world.place(4, 3, TileKind.Platform);
    world.place(0, 3, TileKind.FixedCharge);
    world.setCharge(0, 3, 1);
    world.place(1, 3, TileKind.ForceProjector, Direction.Right);
    world.setWeld(0, 3, 1, 3, true);

    new Simulation(world).step();

    expect(world.idAt(2, 2)).toBe(target);
    expect(world.idAt(3, 3)).toBe(pushed);
  });

  it("waits for the old rear charge and stops when that input is disconnected", () => {
    const world = new World(9, 3);
    const projector = world.place(1, 2, TileKind.ForceProjector, Direction.Right);
    world.place(0, 2, TileKind.FixedCharge);
    world.setWeld(0, 2, 1, 2, true);
    const target = world.place(4, 2, TileKind.Stone);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(4, 2)).toBe(target);
    simulation.step();
    expect(world.idAt(5, 2)).toBe(target);
    expect(world.idAt(1, 2)).toBe(projector);

    world.setWeld(0, 2, 1, 2, false);
    // A welded positive side input cannot replace the disconnected rear input.
    world.place(1, 1, TileKind.FixedCharge);
    world.setCharge(1, 1, 1);
    world.setWeld(1, 1, 1, 2, true);
    simulation.step();
    simulation.step();
    expect(world.idAt(5, 2)).toBe(target);
    expect(world.idAt(1, 2)).toBe(projector);
  });

  it("pushes and pulls only the first occupied body through gaps, preserving its welded load after scene round-trip", () => {
    const original = new World(11, 3);
    original.place(1, 2, TileKind.ForceProjector, Direction.Right);
    original.place(0, 2, TileKind.Conduit);
    original.setWeld(0, 2, 1, 2, true);
    original.setCharge(0, 2, 1);
    original.place(4, 2, TileKind.Glass);
    original.place(5, 2, TileKind.Stone);
    original.setWeld(4, 2, 5, 2, true);
    original.place(9, 2, TileKind.Stone);
    const world = deserializeBoard(serializeBoard(original.clone(), 0)).world;
    const glass = world.idAt(4, 2);
    const load = world.idAt(5, 2);
    const farther = world.idAt(9, 2);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(5, 2)).toBe(glass);
    expect(world.idAt(6, 2)).toBe(load);
    expect(world.isWelded(5, 2, 6, 2)).toBe(true);
    expect(world.idAt(9, 2)).toBe(farther);

    world.setCharge(0, 2, -1);
    simulation.step();
    expect(world.idAt(4, 2)).toBe(glass);
    expect(world.idAt(5, 2)).toBe(load);
    expect(world.isWelded(4, 2, 5, 2)).toBe(true);
    simulation.step();
    simulation.step();
    expect(world.idAt(4, 2)).toBe(glass);
    expect(world.idAt(5, 2)).toBe(load);
    expect(world.idAt(9, 2)).toBe(farther);
    expect(world.kindAt(1, 2)).toBe(TileKind.ForceProjector);
  });

  it("stops at fixed terrain and jams a contact chain until its destination is cleared", () => {
    const world = new World(10, 3);
    world.place(1, 2, TileKind.ForceProjector, Direction.Right);
    world.place(0, 2, TileKind.FixedCharge);
    world.setCharge(0, 2, 1);
    world.setWeld(0, 2, 1, 2, true);
    world.place(3, 2, TileKind.Platform);
    const first = world.place(5, 2, TileKind.Stone);
    const second = world.place(6, 2, TileKind.Stone);
    world.place(7, 2, TileKind.Platform);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(5, 2)).toBe(first);
    expect(world.idAt(6, 2)).toBe(second);
    world.place(7, 2, TileKind.Empty);
    simulation.step();
    expect(world.idAt(5, 2)).toBe(first);
    expect(world.idAt(6, 2)).toBe(second);

    world.place(3, 2, TileKind.Empty);
    world.place(7, 2, TileKind.Platform);
    simulation.step();
    expect(world.idAt(5, 2)).toBe(first);
    expect(world.idAt(6, 2)).toBe(second);
    world.place(7, 2, TileKind.Empty);
    simulation.step();
    expect(world.idAt(6, 2)).toBe(first);
    expect(world.idAt(7, 2)).toBe(second);
  });

  it("obeys the target slider's axis rather than bypassing it", () => {
    const world = new World(8, 3);
    world.place(1, 2, TileKind.ForceProjector, Direction.Right);
    world.place(0, 2, TileKind.FixedCharge);
    world.setCharge(0, 2, 1);
    world.setWeld(0, 2, 1, 2, true);
    const slider = world.place(4, 2, TileKind.Slider, Direction.Up);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(4, 2)).toBe(slider);
    world.place(4, 2, TileKind.Slider, Direction.Right);
    simulation.step();
    expect(world.idAt(5, 2)).toBe(slider);
  });

  it("sums projected force with an opposing thruster and reverses with negative input", () => {
    const world = new World(9, 3);
    const projector = world.place(1, 2, TileKind.ForceProjector, Direction.Right);
    world.place(0, 2, TileKind.Conduit);
    world.setCharge(0, 2, 1);
    world.setWeld(0, 2, 1, 2, true);
    const thruster = world.place(4, 2, TileKind.Thruster, Direction.Left);
    const load = world.place(5, 2, TileKind.Stone);
    world.setWeld(4, 2, 5, 2, true);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(4, 2)).toBe(thruster);
    expect(world.idAt(5, 2)).toBe(load);
    world.setCharge(0, 2, -1);
    simulation.step();
    expect(world.idAt(3, 2)).toBe(thruster);
    expect(world.idAt(4, 2)).toBe(load);
    expect(world.idAt(1, 2)).toBe(projector);
  });

  it("lets its own welded body occlude the ray without applying force to itself or looking past it", () => {
    const world = new World(9, 3);
    const projector = world.place(1, 2, TileKind.ForceProjector, Direction.Right);
    world.place(0, 2, TileKind.FixedCharge);
    world.setCharge(0, 2, 1);
    world.setWeld(0, 2, 1, 2, true);
    const shield = world.place(2, 2, TileKind.Stone);
    world.setWeld(1, 2, 2, 2, true);
    const farther = world.place(6, 2, TileKind.Stone);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(1, 2)).toBe(projector);
    expect(world.idAt(2, 2)).toBe(shield);
    expect(world.idAt(6, 2)).toBe(farther);
    world.setWeld(1, 2, 2, 2, false);
    simulation.step();
    expect(world.idAt(1, 2)).toBe(projector);
    expect(world.idAt(3, 2)).toBe(shield);
    expect(world.idAt(6, 2)).toBe(farther);
  });

  it("gives gravity priority for both the target and the unsupported projector", () => {
    const world = new World(9, 6);
    const projector = world.place(1, 1, TileKind.ForceProjector, Direction.Right);
    const source = world.place(0, 1, TileKind.FixedCharge);
    world.setCharge(0, 1, 1);
    world.setWeld(0, 1, 1, 1, true);
    const falling = world.place(5, 1, TileKind.Stone);

    new Simulation(world).step();
    expect(world.idAt(1, 2)).toBe(projector);
    expect(world.idAt(0, 2)).toBe(source);
    expect(world.idAt(5, 2)).toBe(falling);
  });

  it("cannot lift supported stone but pushes and pulls a floatstone target with the same welded load", () => {
    const world = new World(7, 7);
    world.place(3, 5, TileKind.ForceProjector, Direction.Up);
    world.place(3, 6, TileKind.Conduit);
    world.setCharge(3, 6, 1);
    world.setWeld(3, 5, 3, 6, true);
    const stone = world.place(3, 2, TileKind.Stone);
    const load = world.place(4, 2, TileKind.Stone);
    world.setWeld(3, 2, 4, 2, true);
    world.place(4, 3, TileKind.Platform);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(3, 2)).toBe(stone);
    expect(world.idAt(4, 2)).toBe(load);
    const floating = world.place(3, 2, TileKind.Floatstone);
    world.setWeld(3, 2, 4, 2, true);
    world.setCharge(3, 6, 1);
    simulation.step();
    expect(world.idAt(3, 1)).toBe(floating);
    expect(world.idAt(4, 1)).toBe(load);
    expect(world.isWelded(3, 1, 4, 1)).toBe(true);
    world.setCharge(3, 6, -1);
    simulation.step();
    expect(world.idAt(3, 2)).toBe(floating);
    expect(world.idAt(4, 2)).toBe(load);
    expect(world.isWelded(3, 2, 4, 2)).toBe(true);
  });

  it("reads old virtual array input, clears it after disconnection, and stops its ray at the local boundary", () => {
    const world = new World(5, 1);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.RuneArray);
    world.setWeld(0, 0, 1, 0, true);
    const outside = world.place(3, 0, TileKind.Stone);
    const inner = world.runeArrayWorldAt(1, 0);
    const projector = inner.place(0, 2, TileKind.ForceProjector, Direction.Right);
    inner.place(0, 3, TileKind.Platform);
    inner.setWeld(0, 2, 0, 3, true);
    const target = inner.place(1, 2, TileKind.Floatstone);
    const simulation = new Simulation(world);

    simulation.step();
    expect(inner.idAt(1, 2)).toBe(target);
    simulation.step();
    expect(inner.idAt(2, 2)).toBe(target);
    world.place(0, 0, TileKind.Empty);
    simulation.step();
    expect(inner.idAt(3, 2)).toBe(target);
    simulation.step();
    expect(inner.idAt(3, 2)).toBe(target);

    inner.place(3, 2, TileKind.Empty);
    world.place(0, 0, TileKind.FixedCharge);
    world.setWeld(0, 0, 1, 0, true);
    simulation.step();
    simulation.step();
    expect(world.idAt(3, 0)).toBe(outside);
    expect(inner.idAt(0, 2)).toBe(projector);
  });

  it("does not retarget past a tile destroyed by a drill until the next tick", () => {
    const world = new World(10, 3);
    world.place(1, 2, TileKind.ForceProjector, Direction.Right);
    world.place(0, 2, TileKind.FixedCharge);
    world.setCharge(0, 2, 1);
    world.setWeld(0, 2, 1, 2, true);
    world.place(4, 2, TileKind.Stone);
    const farther = world.place(7, 2, TileKind.Stone);
    world.place(4, 1, TileKind.Drill, Direction.Down);
    world.place(5, 1, TileKind.Platform);
    world.setWeld(4, 1, 5, 1, true);
    world.restoreFurnaceProgress(4, 1, 3);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(4, 2)).toBe(TileKind.Empty);
    expect(world.idAt(7, 2)).toBe(farther);
    simulation.step();
    expect(world.idAt(8, 2)).toBe(farther);
  });
});
