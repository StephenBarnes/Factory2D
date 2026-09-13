import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function rightwardPiston(world: World): void {
  world.place(1, 2, TileKind.Piston, Direction.Right);
  world.place(1, 3, TileKind.FixedCharge);
  world.place(1, 4, TileKind.Platform);
  world.setWeld(1, 2, 1, 3, true);
  world.setWeld(1, 3, 1, 4, true);
}

function rightwardConveyor(world: World): void {
  world.place(1, 3, TileKind.Conveyor);
  world.place(0, 3, TileKind.FixedCharge);
  world.place(0, 4, TileKind.Platform);
  world.setWeld(1, 3, 0, 3, true);
  world.setWeld(0, 3, 0, 4, true);
}

describe("sliders", () => {
  it("holds a loaded horizontal rail after cloning/save/load, then releases its unwelded load", () => {
    const original = new World(4, 5);
    original.place(1, 1, TileKind.Slider, Direction.Right);
    original.place(2, 1, TileKind.Stone);
    original.setWeld(1, 1, 2, 1, true);
    original.place(1, 0, TileKind.Stone);
    const world = deserializeBoard(serializeBoard(original.clone(), 0)).world;
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
    expect(world.kindAt(1, 1)).toBe(TileKind.Slider);
    expect(world.kindAt(2, 1)).toBe(TileKind.Stone);
    world.setWeld(1, 1, 2, 1, false);
    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Slider);
    expect(world.kindAt(2, 2)).toBe(TileKind.Stone);
  });

  it("lets vertical rails fall with their entire welded load", () => {
    const world = new World(4, 4);
    const slider = world.place(1, 0, TileKind.Slider, Direction.Down);
    const load = world.place(2, 0, TileKind.Stone);
    world.setWeld(1, 0, 2, 0, true);
    new Simulation(world).step();
    expect(world.idAt(1, 1)).toBe(slider);
    expect(world.idAt(2, 1)).toBe(load);
    expect(world.isWelded(1, 1, 2, 1)).toBe(true);
  });

  it("lets pistons push and pull along a rail", () => {
    const world = new World(6, 5);
    rightwardPiston(world);
    const slider = world.place(2, 2, TileKind.Slider, Direction.Left);
    world.setWeld(1, 2, 2, 2, true);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(3, 2)).toBe(slider);
    world.place(1, 3, TileKind.Inverter, Direction.Up);
    world.setWeld(1, 2, 1, 3, true);
    world.setWeld(1, 3, 1, 4, true);
    world.place(0, 3, TileKind.FixedCharge);
    world.setWeld(0, 3, 1, 3, true);
    simulation.step();
    simulation.step();
    expect(world.idAt(2, 2)).toBe(slider);
    expect(world.kindAt(1, 2)).toBe(TileKind.Piston);
  });

  it("jams a piston against perpendicular welded rails, then moves after the conflicting rail is removed", () => {
    const world = new World(6, 5);
    rightwardPiston(world);
    const horizontal = world.place(2, 2, TileKind.Slider, Direction.Right);
    world.place(3, 2, TileKind.Slider, Direction.Up);
    world.setWeld(2, 2, 3, 2, true);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(2, 2)).toBe(horizontal);
    expect(world.kindAt(1, 2)).toBe(TileKind.Piston);
    world.place(3, 2, TileKind.Empty);
    simulation.step();
    expect(world.idAt(3, 2)).toBe(horizontal);
    expect(world.kindAt(1, 2)).toBe(TileKind.PistonBase);
  });

  it.each([Direction.Right, Direction.Up])("applies rail constraints to piston recoil with orientation %s", (orientation) => {
    const world = new World(6, 5);
    world.place(2, 2, TileKind.Piston, Direction.Right);
    world.place(2, 3, TileKind.FixedCharge);
    world.place(2, 4, TileKind.Platform);
    world.setWeld(2, 2, 2, 3, true);
    const rail = world.place(1, 2, TileKind.Slider, orientation);
    world.setWeld(1, 2, 2, 2, true);
    const blocker = world.place(3, 2, TileKind.Slider, Direction.Up);
    world.place(3, 3, TileKind.Platform);
    new Simulation(world).step();
    expect(world.idAt(3, 2)).toBe(blocker);
    expect(world.idAt(orientation === Direction.Right ? 0 : 1, 2)).toBe(rail);
    expect(world.kindAt(orientation === Direction.Right ? 1 : 2, 2))
      .toBe(orientation === Direction.Right ? TileKind.PistonBase : TileKind.Piston);
  });

  it("moves horizontal conveyor loads but jams a pushed vertical rail", () => {
    const world = new World(6, 5);
    rightwardConveyor(world);
    const slider = world.place(1, 2, TileKind.Slider, Direction.Right);
    const blocker = world.place(2, 2, TileKind.Slider, Direction.Up);
    world.place(2, 3, TileKind.Platform);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(1, 2)).toBe(slider);
    expect(world.idAt(2, 2)).toBe(blocker);
    world.place(2, 2, TileKind.Empty);
    simulation.step();
    expect(world.idAt(2, 2)).toBe(slider);
  });

  it("rejects a conveyor's direct transverse force", () => {
    const world = new World(4, 5);
    rightwardConveyor(world);
    const slider = world.place(1, 2, TileKind.Slider, Direction.Up);
    new Simulation(world).step();
    expect(world.idAt(1, 2)).toBe(slider);
  });

  it("allows rotators to turn rails and applies the new axis on the next tick", () => {
    const world = new World(7, 7);
    world.place(3, 3, TileKind.Rotator, Direction.Up);
    world.place(3, 4, TileKind.FixedCharge);
    world.place(3, 5, TileKind.Platform);
    world.setWeld(3, 3, 3, 4, true);
    world.setWeld(3, 4, 3, 5, true);
    const slider = world.place(3, 2, TileKind.Slider, Direction.Right);
    const simulation = new Simulation(world);
    simulation.step();
    expect(world.idAt(4, 3)).toBe(slider);
    expect(world.orientationAt(4, 3)).toBe(Direction.Down);
    simulation.step();
    expect(world.idAt(4, 4)).toBe(slider);
  });
});
