import { describe, expect, it } from "vitest";

import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("directional furnaces", () => {
  it.each([
    { input: TileKind.Sand, output: TileKind.Glass, bakeTime: 4 },
    { input: TileKind.IronOre, output: TileKind.Iron, bakeTime: 6 },
  ])(
    "transforms $input into $output after $bakeTime active ticks",
    ({ input, output, bakeTime }) => {
      const world = new World(2, 1);
      world.place(0, 0, TileKind.Furnace, Direction.Right);
      const targetId = world.place(1, 0, input);
      const simulation = new Simulation(world);

      for (let progress = 1; progress < bakeTime; progress += 1) {
        simulation.step();
        expect(world.kindAt(1, 0)).toBe(input);
        expect(world.furnaceProgressAt(0, 0)).toBe(progress);
      }

      simulation.step();

      expect(world.kindAt(1, 0)).toBe(output);
      expect(world.idAt(1, 0)).toBe(targetId);
      expect(world.furnaceProgressAt(0, 0)).toBe(0);
    },
  );

  it("restarts when the target identity changes", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Furnace, Direction.Right);
    const firstTargetId = world.place(1, 0, TileKind.Sand);
    const simulation = new Simulation(world);

    simulation.step();
    simulation.step();
    expect(world.furnaceProgressAt(0, 0)).toBe(2);

    world.place(1, 0, TileKind.Empty);
    const replacementId = world.place(1, 0, TileKind.Sand);
    expect(replacementId).not.toBe(firstTargetId);
    simulation.step();

    expect(world.furnaceProgressAt(0, 0)).toBe(1);
  });

  it("cuts baking short when the target moves away", () => {
    const world = new World(3, 3);
    world.place(0, 0, TileKind.Furnace, Direction.Right);
    world.place(0, 1, TileKind.Platform);
    world.setWeld(0, 0, 0, 1, true);
    const sandId = world.place(1, 0, TileKind.Sand);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(1, 1)).toBe(sandId);
    expect(world.furnaceProgressAt(0, 0)).toBe(1);

    simulation.step();
    expect(world.furnaceProgressAt(0, 0)).toBe(0);
  });

  it("pauses on rear charge and drives both side outputs while active", () => {
    const world = new World(5, 3);
    world.place(2, 0, TileKind.Sand);
    world.place(2, 1, TileKind.Furnace, Direction.Up);
    world.place(1, 1, TileKind.Conduit);
    world.place(3, 1, TileKind.Conduit);
    world.place(2, 2, TileKind.Conduit);
    world.setWeld(2, 1, 1, 1, true);
    world.setWeld(2, 1, 3, 1, true);
    world.setWeld(2, 1, 2, 2, true);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.furnaceProgressAt(2, 1)).toBe(1);
    expect(world.chargeAt(1, 1)).toBe(1);
    expect(world.chargeAt(2, 1)).toBe(1);
    expect(world.chargeAt(3, 1)).toBe(1);

    world.setCharge(2, 2, -1);
    simulation.step();
    expect(world.furnaceProgressAt(2, 1)).toBe(1);
    expect(world.chargeAt(1, 1)).toBe(0);
    expect(world.chargeAt(2, 1)).toBe(0);
    expect(world.chargeAt(3, 1)).toBe(0);

    simulation.step();
    expect(world.furnaceProgressAt(2, 1)).toBe(2);
    expect(world.chargeAt(1, 1)).toBe(1);
    expect(world.chargeAt(3, 1)).toBe(1);

    simulation.step();
    simulation.step();
    expect(world.kindAt(2, 0)).toBe(TileKind.Glass);
    expect(world.chargeAt(1, 1)).toBe(1);
    expect(world.chargeAt(3, 1)).toBe(1);

    simulation.step();
    expect(world.chargeAt(1, 1)).toBe(0);
    expect(world.chargeAt(2, 1)).toBe(0);
    expect(world.chargeAt(3, 1)).toBe(0);
  });

  it("restores bake progress with a simulation snapshot", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Furnace, Direction.Right);
    world.place(1, 0, TileKind.Sand);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    const snapshot = world.clone();

    simulation.step();
    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Glass);

    simulation.resetTo(snapshot);
    expect(world.kindAt(1, 0)).toBe(TileKind.Sand);
    expect(world.furnaceProgressAt(0, 0)).toBe(2);
  });
});
