import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TILE_DEFINITIONS, TileKind, WeldSide } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function placePoweredFixedPiston(world: World, x: number, y: number): void {
  world.place(x, y, TileKind.Piston, Direction.Up);
  world.place(x - 1, y, TileKind.Conduit);
  world.place(x - 2, y, TileKind.FixedCharge);
  world.place(x, y + 1, TileKind.Conduit);
  world.place(x, y + 2, TileKind.Platform);
  world.setWeld(x, y, x - 1, y, true);
  world.setWeld(x - 1, y, x - 2, y, true);
  world.setWeld(x, y, x, y + 1, true);
  world.setWeld(x, y + 1, x, y + 2, true);
}

function placeNegativelyPoweredFixedBase(world: World, x: number, y: number): void {
  world.place(x, y, TileKind.PistonBase, Direction.Up);
  world.place(x, y - 1, TileKind.PistonArm, Direction.Up);
  world.setWeld(x, y, x, y - 1, true);
  world.place(x - 1, y, TileKind.Inverter, Direction.Right);
  world.place(x - 1, y + 1, TileKind.FixedCharge);
  world.place(x - 2, y, TileKind.Platform);
  world.setWeld(x, y, x - 1, y, true);
  world.setWeld(x - 1, y, x - 1, y + 1, true);
  world.setWeld(x - 1, y, x - 2, y, true);
}

describe("pistons", () => {
  it("extends its welded head while leaving the other base welds in place", () => {
    const world = new World(5, 6);
    placePoweredFixedPiston(world, 2, 3);
    const pistonId = world.idAt(2, 3);
    const headId = world.place(2, 2, TileKind.Conduit);
    world.place(3, 3, TileKind.Conduit);
    world.setWeld(2, 3, 2, 2, true);
    world.setWeld(2, 3, 3, 3, true);

    expect(new Simulation(world).step()).toBe(2);

    expect(world.kindAt(2, 3)).toBe(TileKind.PistonBase);
    expect(world.kindAt(2, 2)).toBe(TileKind.PistonArm);
    expect(world.idAt(2, 2)).toBe(pistonId);
    expect(world.idAt(2, 1)).toBe(headId);
    expect(world.isWelded(2, 3, 2, 2)).toBe(true);
    expect(world.isWelded(2, 2, 2, 1)).toBe(true);
    expect(world.isWelded(2, 3, 1, 3)).toBe(true);
    expect(world.isWelded(2, 3, 3, 3)).toBe(true);
    expect(world.isWelded(2, 3, 2, 4)).toBe(true);
  });

  it("pushes a complete obstruction chain when extending", () => {
    const world = new World(5, 7);
    placePoweredFixedPiston(world, 2, 4);
    const weldedHeadId = world.place(2, 3, TileKind.Conduit);
    const blockerId = world.place(2, 2, TileKind.Stone);
    world.setWeld(2, 4, 2, 3, true);

    expect(new Simulation(world).step()).toBe(3);

    expect(world.kindAt(2, 3)).toBe(TileKind.PistonArm);
    expect(world.idAt(2, 2)).toBe(weldedHeadId);
    expect(world.idAt(2, 1)).toBe(blockerId);
    expect(world.isWelded(2, 3, 2, 2)).toBe(true);
  });

  it("extends a powered three-piston stack from top to bottom without deadlocking", () => {
    const world = new World(6, 6);
    for (let y = 3; y <= 5; y += 1) {
      world.place(2, y, TileKind.Piston);
      world.place(3, y, TileKind.FixedCharge);
      world.setWeld(2, y, 3, y, true);
    }
    const simulation = new Simulation(world);

    for (let tick = 1; tick <= 3; tick += 1) {
      simulation.step();
      for (let piston = 0; piston < 3; piston += 1) {
        const extended = piston < tick;
        const y = extended ? 4 + piston * 2 - tick : 3 + piston;
        expect(world.kindAt(2, y)).toBe(extended ? TileKind.PistonBase : TileKind.Piston);
        expect(world.kindAt(3, y)).toBe(TileKind.FixedCharge);
        expect(world.isWelded(2, y, 3, y)).toBe(true);
        if (extended) {
          expect(world.kindAt(2, y - 1)).toBe(TileKind.PistonArm);
          expect(world.isWelded(2, y, 2, y - 1)).toBe(true);
        }
      }
    }
  });

  it("lifts a load with stacked pistons despite a blocked push against the active base", () => {
    const world = new World(6, 6);
    for (let y = 4; y <= 5; y += 1) {
      world.place(2, y, TileKind.Piston);
      world.place(3, y, TileKind.FixedCharge);
      world.setWeld(2, y, 3, y, true);
    }
    const loadId = world.place(2, 3, TileKind.Stone);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(2, 2)).toBe(loadId);
    expect(world.kindAt(2, 4)).toBe(TileKind.PistonBase);
    expect(world.kindAt(2, 5)).toBe(TileKind.Piston);

    simulation.step();
    expect(world.idAt(2, 1)).toBe(loadId);
    expect(world.kindAt(2, 3)).toBe(TileKind.PistonBase);
    expect(world.kindAt(2, 5)).toBe(TileKind.PistonBase);
  });

  it("lets a piston push a body after gravity moves it into the path that tick", () => {
    const world = new World(6, 5);
    const pistonId = world.place(1, 2, TileKind.Piston, Direction.Right);
    world.place(0, 2, TileKind.FixedCharge);
    world.place(1, 3, TileKind.Platform);
    world.setWeld(1, 2, 0, 2, true);
    world.setWeld(1, 2, 1, 3, true);
    const targetId = world.place(2, 1, TileKind.Stone);

    expect(new Simulation(world).step()).toBe(3);

    expect(world.kindAt(1, 2)).toBe(TileKind.PistonBase);
    expect(world.kindAt(2, 2)).toBe(TileKind.PistonArm);
    expect(world.idAt(2, 2)).toBe(pistonId);
    expect(world.idAt(3, 2)).toBe(targetId);
    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
  });

  it("recoils its base when the arm is blocked", () => {
    const world = new World(5, 5);
    const pistonId = world.place(2, 2, TileKind.Piston, Direction.Down);
    const inputId = world.place(1, 2, TileKind.FixedCharge);
    world.setWeld(2, 2, 1, 2, true);
    world.place(2, 3, TileKind.Platform);

    expect(new Simulation(world).step()).toBe(3);

    expect(world.kindAt(2, 1)).toBe(TileKind.PistonBase);
    expect(world.kindAt(2, 2)).toBe(TileKind.PistonArm);
    expect(world.idAt(2, 2)).toBe(pistonId);
    expect(world.idAt(1, 1)).toBe(inputId);
    expect(world.kindAt(2, 3)).toBe(TileKind.Platform);
    expect(world.isWelded(2, 1, 2, 2)).toBe(true);
    expect(world.isWelded(2, 1, 1, 1)).toBe(true);
  });

  it("recoils when its arm faces the world boundary", () => {
    const world = new World(5, 4);
    const pistonId = world.place(2, 3, TileKind.Piston, Direction.Down);
    const inputId = world.place(1, 3, TileKind.FixedCharge);
    world.setWeld(2, 3, 1, 3, true);

    expect(new Simulation(world).step()).toBe(3);

    expect(world.kindAt(2, 2)).toBe(TileKind.PistonBase);
    expect(world.kindAt(2, 3)).toBe(TileKind.PistonArm);
    expect(world.idAt(2, 3)).toBe(pistonId);
    expect(world.idAt(1, 2)).toBe(inputId);
    expect(world.isWelded(2, 2, 2, 3)).toBe(true);
    expect(world.isWelded(2, 2, 1, 2)).toBe(true);
  });

  it("pushes a complete obstruction chain while recoiling", () => {
    const world = new World(5, 6);
    world.place(2, 3, TileKind.Piston, Direction.Down);
    world.place(1, 3, TileKind.FixedCharge);
    world.setWeld(2, 3, 1, 3, true);
    const nearId = world.place(2, 2, TileKind.Stone);
    const farId = world.place(2, 1, TileKind.Stone);
    world.place(2, 4, TileKind.Platform);

    expect(new Simulation(world).step()).toBe(5);

    expect(world.kindAt(2, 2)).toBe(TileKind.PistonBase);
    expect(world.kindAt(2, 3)).toBe(TileKind.PistonArm);
    expect(world.idAt(2, 1)).toBe(nearId);
    expect(world.idAt(2, 0)).toBe(farId);
  });

  it("prefers moving the arm when forward and recoil extensions are possible", () => {
    const world = new World(5, 5);
    const pistonId = world.place(2, 2, TileKind.Piston, Direction.Down);
    const inputId = world.place(1, 2, TileKind.FixedCharge);
    world.setWeld(2, 2, 1, 2, true);
    world.place(1, 3, TileKind.Platform);

    expect(new Simulation(world).step()).toBe(1);

    expect(world.kindAt(2, 2)).toBe(TileKind.PistonBase);
    expect(world.kindAt(2, 3)).toBe(TileKind.PistonArm);
    expect(world.idAt(2, 3)).toBe(pistonId);
    expect(world.idAt(1, 2)).toBe(inputId);
    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
  });

  it("stays retracted when its extension chain is blocked by fixed terrain", () => {
    const world = new World(5, 6);
    placePoweredFixedPiston(world, 2, 3);
    world.place(2, 2, TileKind.Platform);

    expect(new Simulation(world).step()).toBe(0);

    expect(world.kindAt(2, 3)).toBe(TileKind.Piston);
    expect(world.kindAt(2, 2)).toBe(TileKind.Platform);
  });
  it("jams two pistons that try to extend into the same empty cell", () => {
    const world = new World(5, 3);
    world.place(1, 1, TileKind.Piston, Direction.Right);
    world.place(0, 1, TileKind.FixedCharge);
    world.place(1, 2, TileKind.Platform);
    world.setWeld(1, 1, 0, 1, true);
    world.setWeld(1, 1, 1, 2, true);
    world.place(3, 1, TileKind.Piston, Direction.Left);
    world.place(4, 1, TileKind.FixedCharge);
    world.place(3, 2, TileKind.Platform);
    world.setWeld(3, 1, 4, 1, true);
    world.setWeld(3, 1, 3, 2, true);

    expect(new Simulation(world).step()).toBe(0);

    expect(world.kindAt(1, 1)).toBe(TileKind.Piston);
    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(3, 1)).toBe(TileKind.Piston);
  });


  it("retracts a welded head target and preserves its head weld", () => {
    const world = new World(5, 6);
    placeNegativelyPoweredFixedBase(world, 3, 3);
    const armId = world.idAt(3, 2);
    const targetId = world.place(3, 1, TileKind.Stone);
    world.setWeld(3, 2, 3, 1, true);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(3, 3)).toBe(TileKind.PistonBase);
    simulation.step();

    expect(world.kindAt(3, 3)).toBe(TileKind.Piston);
    expect(world.idAt(3, 3)).toBe(armId);
    expect(world.idAt(3, 2)).toBe(targetId);
    expect(world.isWelded(3, 3, 3, 2)).toBe(true);
  });

  it("keeps an inactive piston head weld rigid while retracting it", () => {
    const world = new World(7, 6);
    placeNegativelyPoweredFixedBase(world, 3, 4);
    const targetId = world.place(3, 2, TileKind.Piston, Direction.Up);
    const headId = world.place(3, 1, TileKind.Stone);
    world.setWeld(3, 3, 3, 2, true);
    world.setWeld(3, 2, 3, 1, true);
    const simulation = new Simulation(world);

    simulation.step();
    simulation.step();

    expect(world.kindAt(3, 4)).toBe(TileKind.Piston);
    expect(world.idAt(3, 3)).toBe(targetId);
    expect(world.idAt(3, 2)).toBe(headId);
    expect(world.kindAt(3, 1)).toBe(TileKind.Empty);
    expect(world.isWelded(3, 4, 3, 3)).toBe(true);
    expect(world.isWelded(3, 3, 3, 2)).toBe(true);
    simulation.step();
    expect(world.idAt(3, 3)).toBe(targetId);
    expect(world.idAt(3, 2)).toBe(headId);
  });

  it("stays extended when a welded target cannot move into the arm cell", () => {
    const world = new World(7, 7);
    placeNegativelyPoweredFixedBase(world, 3, 4);
    const targetId = world.place(3, 2, TileKind.Stone);
    const sideId = world.place(2, 2, TileKind.Stone);
    world.place(2, 3, TileKind.Platform);
    world.setWeld(3, 3, 3, 2, true);
    world.setWeld(3, 2, 2, 2, true);
    const simulation = new Simulation(world);

    simulation.step();
    simulation.step();

    expect(world.kindAt(3, 4)).toBe(TileKind.PistonBase);
    expect(world.kindAt(3, 3)).toBe(TileKind.PistonArm);
    expect(world.idAt(3, 2)).toBe(targetId);
    expect(world.idAt(2, 2)).toBe(sideId);
  });


  it("retracts without pulling an unwelded block", () => {
    const world = new World(5, 6);
    placeNegativelyPoweredFixedBase(world, 3, 3);
    const targetId = world.place(3, 1, TileKind.Platform);
    const simulation = new Simulation(world);

    simulation.step();
    simulation.step();

    expect(world.kindAt(3, 3)).toBe(TileKind.Piston);
    expect(world.kindAt(3, 2)).toBe(TileKind.Empty);
    expect(world.idAt(3, 1)).toBe(targetId);
  });

  it("does nothing at zero charge in either piston state", () => {
    const retracted = new World(3, 3);
    retracted.place(1, 1, TileKind.Piston, Direction.Right);
    retracted.place(1, 2, TileKind.Platform);
    retracted.setWeld(1, 1, 1, 2, true);
    new Simulation(retracted).step();
    expect(retracted.kindAt(1, 1)).toBe(TileKind.Piston);

    const extended = new World(3, 3);
    extended.place(1, 1, TileKind.PistonBase, Direction.Right);
    extended.place(2, 1, TileKind.PistonArm, Direction.Right);
    extended.place(1, 2, TileKind.Platform);
    extended.setWeld(1, 1, 2, 1, true);
    extended.setWeld(1, 1, 1, 2, true);
    new Simulation(extended).step();
    expect(extended.kindAt(1, 1)).toBe(TileKind.PistonBase);
    expect(extended.kindAt(2, 1)).toBe(TileKind.PistonArm);
  });

  it("allows arm welds only along the piston axis", () => {
    const world = new World(3, 3);
    world.place(1, 1, TileKind.PistonArm, Direction.Right);
    world.place(0, 1, TileKind.Stone);
    world.place(2, 1, TileKind.Stone);
    world.place(1, 0, TileKind.Stone);
    world.place(1, 2, TileKind.Stone);

    expect(world.canWeld(1, 1, 0, 1)).toBe(true);
    expect(world.canWeld(1, 1, 2, 1)).toBe(true);
    expect(world.canWeld(1, 1, 1, 0)).toBe(false);
    expect(world.canWeld(1, 1, 1, 2)).toBe(false);
  });

  it("connects circuits on the base sides but not through the arm head", () => {
    const definition = TILE_DEFINITIONS[TileKind.Piston];
    expect(definition.circuitPorts).toBe(WeldSide.Right | WeldSide.Down | WeldSide.Left);

    const world = new World(3, 3);
    world.place(1, 1, TileKind.Piston, Direction.Up);
    world.place(1, 0, TileKind.Conduit);
    world.place(0, 1, TileKind.Conduit);
    world.setWeld(1, 1, 1, 0, true);
    world.setWeld(1, 1, 0, 1, true);

    expect(world.hasCircuitConnectionAtIndex(4, Direction.Up)).toBe(false);
    expect(world.hasCircuitConnectionAtIndex(4, Direction.Left)).toBe(true);
  });

  it("round-trips retracted and extended piston tiles", () => {
    const world = new World(3, 2);
    world.place(0, 0, TileKind.Piston, Direction.Right);
    world.place(1, 1, TileKind.PistonBase, Direction.Left);
    world.place(0, 1, TileKind.PistonArm, Direction.Left);
    world.setWeld(0, 1, 1, 1, true);

    const imported = deserializeBoard(serializeBoard(world, 7));

    expect(imported.tick).toBe(7);
    expect(imported.world.kindAt(0, 0)).toBe(TileKind.Piston);
    expect(imported.world.orientationAt(0, 0)).toBe(Direction.Right);
    expect(imported.world.kindAt(1, 1)).toBe(TileKind.PistonBase);
    expect(imported.world.kindAt(0, 1)).toBe(TileKind.PistonArm);
    expect(imported.world.isWelded(0, 1, 1, 1)).toBe(true);
  });
});
