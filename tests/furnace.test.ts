import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
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

  it("ignites wood after two active ticks, removes welds, and spreads fire only on the following tick", () => {
    let world = new World(3, 1);
    world.place(0, 0, TileKind.Furnace, Direction.Right);
    world.place(1, 0, TileKind.Wood);
    world.place(2, 0, TileKind.Wood);
    world.setWeld(1, 0, 2, 0, true);
    let simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Wood);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(1);
    world.setCharge(0, 0, -1);
    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Wood);
    expect(world.isWelded(1, 0, 2, 0)).toBe(true);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(0);

    world = deserializeBoard(serializeBoard(world, simulation.tick)).world;
    simulation = new Simulation(world);
    world.setCharge(0, 0, 0);
    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Fire);
    expect(world.kindAt(2, 0)).toBe(TileKind.Wood);
    expect(world.isWelded(1, 0, 2, 0)).toBe(false);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(1);

    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
    expect(world.kindAt(2, 0)).toBe(TileKind.Fire);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(0);
    simulation.step();
    expect(world.kindAt(2, 0)).toBe(TileKind.Empty);
  });

  it("pauses copper smelting and its output without wood, including across save/load", () => {
    let world = new World(3, 1);
    world.place(0, 0, TileKind.Furnace, Direction.Right);
    const oreId = world.place(1, 0, TileKind.CopperOre);
    let simulation = new Simulation(world);
    simulation.step();
    expect(world.furnaceProgressAt(0, 0)).toBe(0);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(0);

    const woodId = world.place(2, 0, TileKind.Wood);
    simulation.step();
    simulation.step();
    expect(world.furnaceProgressAt(0, 0)).toBe(2);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(1);
    expect(world.idAt(1, 0)).toBe(oreId);
    expect(world.idAt(2, 0)).toBe(woodId);

    world.place(2, 0, TileKind.Empty);
    simulation.step();
    expect(world.furnaceProgressAt(0, 0)).toBe(2);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(0);
    world = deserializeBoard(serializeBoard(world, simulation.tick)).world;
    simulation = new Simulation(world);
    simulation.step();
    expect(world.furnaceProgressAt(0, 0)).toBe(2);

    world.place(2, 0, TileKind.Wood);
    for (let tick = 0; tick < 3; tick += 1) simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.CopperOre);
    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Copper);
    expect(world.kindAt(2, 0)).toBe(TileKind.Fire);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(1);
    simulation.step();
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(0);
  });

  it("ignites every adjacent catalyst only on completion and spreads fire on the next tick", () => {
    const world = new World(4, 3);
    world.place(0, 2, TileKind.Furnace, Direction.Right);
    world.place(1, 2, TileKind.CopperOre);
    const woodId = world.place(2, 2, TileKind.Wood);
    world.place(3, 2, TileKind.Wood);
    world.place(1, 1, TileKind.Wood);
    world.setWeld(1, 1, 1, 2, true);
    world.setWeld(1, 2, 2, 2, true);
    world.setWeld(2, 2, 3, 2, true);
    const simulation = new Simulation(world);

    for (let tick = 0; tick < 5; tick += 1) simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Wood);
    expect(world.kindAt(2, 2)).toBe(TileKind.Wood);
    expect(world.isWelded(1, 2, 2, 2)).toBe(true);
    simulation.step();
    expect(world.kindAt(1, 2)).toBe(TileKind.Copper);
    expect(world.kindAt(1, 1)).toBe(TileKind.Fire);
    expect(world.kindAt(2, 2)).toBe(TileKind.Fire);
    expect(world.idAt(2, 2)).not.toBe(woodId);
    expect(world.isWelded(1, 1, 1, 2)).toBe(false);
    expect(world.isWelded(1, 2, 2, 2)).toBe(false);
    expect(world.isWelded(2, 2, 3, 2)).toBe(false);
    expect(world.kindAt(3, 2)).toBe(TileKind.Wood);

    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(2, 2)).toBe(TileKind.Empty);
    expect(world.kindAt(3, 2)).toBe(TileKind.Fire);
  });

  it("lets simultaneous copper products share a catalyst without furnace-order bias", () => {
    const world = new World(5, 1);
    world.place(0, 0, TileKind.Furnace, Direction.Right);
    world.place(1, 0, TileKind.CopperOre);
    world.place(2, 0, TileKind.Wood);
    world.place(3, 0, TileKind.CopperOre);
    world.place(4, 0, TileKind.Furnace, Direction.Left);
    const simulation = new Simulation(world);

    for (let tick = 0; tick < 6; tick += 1) simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Copper);
    expect(world.kindAt(3, 0)).toBe(TileKind.Copper);
    expect(world.kindAt(2, 0)).toBe(TileKind.Fire);
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(1);
    expect(world.chargeAtPort(4, 0, Direction.Right)).toBe(1);
  });

  it("does not treat diagonal or row-wrapped wood as adjacent to copper ore", () => {
    const world = new World(3, 2);
    world.place(1, 1, TileKind.Furnace, Direction.Left);
    world.place(0, 1, TileKind.CopperOre);
    world.place(1, 0, TileKind.Wood);
    world.place(2, 0, TileKind.Wood);
    world.place(2, 1, TileKind.Platform);
    world.setWeld(1, 0, 2, 0, true);
    world.setWeld(2, 0, 2, 1, true);
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 6; tick += 1) simulation.step();
    expect(world.kindAt(0, 1)).toBe(TileKind.CopperOre);
    expect(world.furnaceProgressAt(1, 1)).toBe(0);

    world.place(0, 0, TileKind.Wood);
    for (let tick = 0; tick < 6; tick += 1) simulation.step();
    expect(world.kindAt(0, 1)).toBe(TileKind.Copper);
  });

  it.each([
    { facing: Direction.Up, rear: Direction.Down, dx: 0, dy: -1 },
    { facing: Direction.Right, rear: Direction.Left, dx: 1, dy: 0 },
    { facing: Direction.Down, rear: Direction.Up, dx: 0, dy: 1 },
    { facing: Direction.Left, rear: Direction.Right, dx: -1, dy: 0 },
  ])(
    "smelts tin with either lateral bend, but not opposite or diagonal wood, facing $facing",
    ({ facing, rear, dx, dy }) => {
      for (const side of [-1, 1]) {
        const world = new World(7, 7);
        const furnaceX = 3 - dx;
        const furnaceY = 3 - dy;
        const lateralX = -dy * side;
        const lateralY = dx * side;
        world.place(furnaceX, furnaceY, TileKind.Furnace, facing);
        world.place(3 - 2 * dx, 3 - 2 * dy, TileKind.Platform);
        world.setWeld(furnaceX, furnaceY, 3 - 2 * dx, 3 - 2 * dy, true);
        const oreId = world.place(3, 3, TileKind.TinOre);
        world.setWeld(3, 3, furnaceX, furnaceY, true);
        world.place(3 + dx, 3 + dy, TileKind.Wood);
        world.place(3 + 2 * dx, 3 + 2 * dy, TileKind.Platform);
        world.setWeld(3 + dx, 3 + dy, 3 + 2 * dx, 3 + 2 * dy, true);
        const diagonalX = 3 + dx + lateralX;
        const diagonalY = 3 + dy + lateralY;
        world.place(diagonalX, diagonalY, TileKind.Wood);
        world.place(diagonalX + dx, diagonalY + dy, TileKind.Platform);
        world.setWeld(diagonalX, diagonalY, diagonalX + dx, diagonalY + dy, true);
        const simulation = new Simulation(world);

        for (let tick = 0; tick < 6; tick += 1) {
          simulation.step();
          expect(world.furnaceProgressAt(furnaceX, furnaceY)).toBe(0);
          expect(world.chargeAtPort(furnaceX, furnaceY, rear)).toBe(0);
        }
        expect(world.kindAt(3, 3)).toBe(TileKind.TinOre);

        const woodX = 3 + lateralX;
        const woodY = 3 + lateralY;
        world.place(woodX, woodY, TileKind.Wood);
        world.place(3 + 2 * lateralX, 3 + 2 * lateralY, TileKind.Platform);
        world.setWeld(woodX, woodY, 3 + 2 * lateralX, 3 + 2 * lateralY, true);
        for (let progress = 1; progress < 6; progress += 1) {
          simulation.step();
          expect(world.furnaceProgressAt(furnaceX, furnaceY)).toBe(progress);
          expect(world.chargeAtPort(furnaceX, furnaceY, rear)).toBe(1);
          expect(world.kindAt(3, 3)).toBe(TileKind.TinOre);
          expect(world.kindAt(woodX, woodY)).toBe(TileKind.Wood);
          expect(world.kindAt(3 + dx, 3 + dy)).toBe(TileKind.Wood);
        }

        simulation.step();
        expect(world.kindAt(3, 3)).toBe(TileKind.Tin);
        expect(world.idAt(3, 3)).toBe(oreId);
        expect(world.furnaceProgressAt(furnaceX, furnaceY)).toBe(0);
        expect(world.chargeAtPort(furnaceX, furnaceY, rear)).toBe(1);
        expect(world.kindAt(woodX, woodY)).toBe(TileKind.Fire);
        expect(world.kindAt(3 + dx, 3 + dy)).toBe(TileKind.Fire);
        expect(world.kindAt(diagonalX, diagonalY)).toBe(TileKind.Wood);
      }
    },
  );

  it("requires both lateral woods for steel and preserves paused progress across save/load", () => {
    let world = new World(5, 5);
    world.place(1, 2, TileKind.Furnace, Direction.Right);
    world.place(0, 2, TileKind.Platform);
    world.setWeld(0, 2, 1, 2, true);
    world.place(2, 2, TileKind.Iron);
    world.setWeld(1, 2, 2, 2, true);
    world.place(2, 0, TileKind.Platform);
    world.place(2, 4, TileKind.Platform);
    world.place(2, 1, TileKind.Wood);
    world.setWeld(2, 0, 2, 1, true);
    world.place(3, 2, TileKind.Wood);
    world.place(4, 2, TileKind.Platform);
    world.setWeld(3, 2, 4, 2, true);
    let simulation = new Simulation(world);

    for (let tick = 0; tick < 8; tick += 1) {
      simulation.step();
      expect(world.furnaceProgressAt(1, 2)).toBe(0);
      expect(world.chargeAtPort(1, 2, Direction.Left)).toBe(0);
    }
    expect(world.kindAt(2, 2)).toBe(TileKind.Iron);

    world.place(2, 1, TileKind.Empty);
    world.place(2, 3, TileKind.Wood);
    world.setWeld(2, 3, 2, 4, true);
    simulation.step();
    expect(world.furnaceProgressAt(1, 2)).toBe(0);
    expect(world.chargeAtPort(1, 2, Direction.Left)).toBe(0);

    world.place(2, 1, TileKind.Wood);
    world.setWeld(2, 0, 2, 1, true);
    simulation.step();
    simulation.step();
    expect(world.furnaceProgressAt(1, 2)).toBe(2);
    expect(world.chargeAtPort(1, 2, Direction.Left)).toBe(1);
    world.place(2, 1, TileKind.Empty);
    simulation.step();
    expect(world.furnaceProgressAt(1, 2)).toBe(2);
    expect(world.chargeAtPort(1, 2, Direction.Left)).toBe(0);

    world = deserializeBoard(serializeBoard(world, simulation.tick)).world;
    const ironId = world.idAt(2, 2);
    simulation = new Simulation(world);
    simulation.step();
    expect(world.furnaceProgressAt(1, 2)).toBe(2);
    expect(world.chargeAtPort(1, 2, Direction.Left)).toBe(0);
    world.place(2, 1, TileKind.Wood);
    world.setWeld(2, 0, 2, 1, true);
    for (let progress = 3; progress < 8; progress += 1) {
      simulation.step();
      expect(world.furnaceProgressAt(1, 2)).toBe(progress);
      expect(world.kindAt(2, 2)).toBe(TileKind.Iron);
      expect(world.kindAt(2, 1)).toBe(TileKind.Wood);
      expect(world.kindAt(2, 3)).toBe(TileKind.Wood);
      expect(world.kindAt(3, 2)).toBe(TileKind.Wood);
    }
    simulation.step();
    expect(world.kindAt(2, 2)).toBe(TileKind.Steel);
    expect(world.idAt(2, 2)).toBe(ironId);
    expect(world.furnaceProgressAt(1, 2)).toBe(0);
    expect(world.chargeAtPort(1, 2, Direction.Left)).toBe(1);
    expect(world.kindAt(2, 1)).toBe(TileKind.Fire);
    expect(world.kindAt(2, 3)).toBe(TileKind.Fire);
    expect(world.kindAt(3, 2)).toBe(TileKind.Fire);
    simulation.step();
    expect(world.chargeAtPort(1, 2, Direction.Left)).toBe(0);
  });

  it.each([
    { missingX: 2, missingY: 1 },
    { missingX: 3, missingY: 2 },
    { missingX: 2, missingY: 3 },
  ])(
    "requires tin on all three free sides for bronze, including ($missingX, $missingY)",
    ({ missingX, missingY }) => {
      const world = new World(5, 5);
      world.place(1, 2, TileKind.Furnace, Direction.Right);
      world.place(0, 2, TileKind.Platform);
      world.setWeld(0, 2, 1, 2, true);
      const copperId = world.place(2, 2, TileKind.Copper);
      world.setWeld(1, 2, 2, 2, true);
      const catalysts = [
        { x: 2, y: 1, supportX: 2, supportY: 0 },
        { x: 3, y: 2, supportX: 4, supportY: 2 },
        { x: 2, y: 3, supportX: 2, supportY: 4 },
      ];
      for (const { x, y, supportX, supportY } of catalysts) {
        world.place(supportX, supportY, TileKind.Platform);
        if (x === missingX && y === missingY) continue;
        world.place(x, y, TileKind.Tin);
        world.setWeld(x, y, supportX, supportY, true);
      }
      const simulation = new Simulation(world);
      for (let tick = 0; tick < 8; tick += 1) {
        simulation.step();
        expect(world.furnaceProgressAt(1, 2)).toBe(0);
        expect(world.chargeAtPort(1, 2, Direction.Left)).toBe(0);
      }
      expect(world.kindAt(2, 2)).toBe(TileKind.Copper);

      world.place(missingX, missingY, TileKind.Tin);
      world.setWeld(missingX, missingY, 2 * missingX - 2, 2 * missingY - 2, true);
      const tinIds = catalysts.map(({ x, y }) => world.idAt(x, y));
      for (let progress = 1; progress < 8; progress += 1) {
        simulation.step();
        expect(world.furnaceProgressAt(1, 2)).toBe(progress);
        expect(world.chargeAtPort(1, 2, Direction.Left)).toBe(1);
        expect(world.kindAt(2, 2)).toBe(TileKind.Copper);
      }
      simulation.step();
      expect(world.kindAt(2, 2)).toBe(TileKind.Bronze);
      expect(world.idAt(2, 2)).toBe(copperId);
      expect(world.furnaceProgressAt(1, 2)).toBe(0);
      expect(world.chargeAtPort(1, 2, Direction.Left)).toBe(1);
      simulation.step();
      expect(world.chargeAtPort(1, 2, Direction.Left)).toBe(0);
      for (const [index, { x, y, supportX, supportY }] of catalysts.entries()) {
        expect(world.kindAt(x, y)).toBe(TileKind.Tin);
        expect(world.idAt(x, y)).toBe(tinIds[index]);
        expect(world.isWelded(x, y, supportX, supportY)).toBe(true);
      }
    },
  );

  it("welds cooked glass only to adjacent glass on completion", () => {
    const world = new World(3, 3);
    world.place(1, 0, TileKind.Furnace, Direction.Down);
    world.place(1, 1, TileKind.Sand);
    world.place(0, 1, TileKind.Glass);
    world.place(2, 1, TileKind.Iron);
    world.place(1, 2, TileKind.Glass);
    world.place(0, 2, TileKind.Platform);
    world.place(2, 2, TileKind.Platform);
    const simulation = new Simulation(world);

    for (let tick = 0; tick < 3; tick += 1) simulation.step();
    expect(world.isWelded(1, 1, 0, 1)).toBe(false);
    expect(world.isWelded(1, 1, 1, 2)).toBe(false);
    world.setCharge(1, 0, -1);
    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Sand);
    expect(world.isWelded(1, 1, 0, 1)).toBe(false);
    world.setCharge(1, 0, 0);
    simulation.step();

    expect(world.kindAt(1, 1)).toBe(TileKind.Glass);
    expect(world.isWelded(1, 1, 0, 1)).toBe(true);
    expect(world.isWelded(1, 1, 1, 2)).toBe(true);
    expect(world.isWelded(1, 1, 2, 1)).toBe(false);
    expect(world.isWelded(1, 1, 1, 0)).toBe(false);
    const restored = deserializeBoard(serializeBoard(world, simulation.tick)).world;
    expect(restored.isWelded(1, 1, 0, 1)).toBe(true);
    expect(restored.isWelded(1, 1, 1, 2)).toBe(true);
  });

  it("welds simultaneously cooked glass across both axes without restoring later cuts", () => {
    const world = new World(4, 2);
    for (let y = 0; y < 2; y += 1) {
      world.place(0, y, TileKind.Furnace, Direction.Right);
      world.place(1, y, TileKind.Sand);
      world.place(2, y, TileKind.Sand);
      world.place(3, y, TileKind.Furnace, Direction.Left);
    }
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 4; tick += 1) simulation.step();

    for (let y = 0; y < 2; y += 1) {
      expect(world.kindAt(1, y)).toBe(TileKind.Glass);
      expect(world.kindAt(2, y)).toBe(TileKind.Glass);
      expect(world.isWelded(1, y, 2, y)).toBe(true);
    }
    expect(world.isWelded(1, 0, 1, 1)).toBe(true);
    expect(world.isWelded(2, 0, 2, 1)).toBe(true);

    world.setWeld(1, 0, 2, 0, false);
    simulation.step();
    expect(world.isWelded(1, 0, 2, 0)).toBe(false);
  });

  it("waits for a paused neighboring sand block to finish before welding", () => {
    const world = new World(2, 2);
    for (let x = 0; x < 2; x += 1) {
      world.place(x, 0, TileKind.Furnace, Direction.Down);
      world.place(x, 1, TileKind.Sand);
    }
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 3; tick += 1) simulation.step();
    world.setCharge(1, 0, -1);
    simulation.step();

    expect(world.kindAt(0, 1)).toBe(TileKind.Glass);
    expect(world.kindAt(1, 1)).toBe(TileKind.Sand);
    expect(world.isWelded(0, 1, 1, 1)).toBe(false);

    world.setCharge(1, 0, 0);
    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Glass);
    expect(world.isWelded(0, 1, 1, 1)).toBe(true);
  });

  it("leaves iron smelting unwelded next to iron and glass", () => {
    const world = new World(3, 2);
    world.place(0, 1, TileKind.Glass);
    world.place(1, 0, TileKind.Furnace, Direction.Down);
    world.place(1, 1, TileKind.IronOre);
    world.place(2, 1, TileKind.Iron);
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 6; tick += 1) simulation.step();

    expect(world.kindAt(1, 1)).toBe(TileKind.Iron);
    expect(world.isWelded(1, 1, 0, 1)).toBe(false);
    expect(world.isWelded(1, 1, 2, 1)).toBe(false);
  });

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

  it("pauses only on negative side charge and isolates its rear baking output", () => {
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

    world.setCharge(2, 2, -1);
    simulation.step();
    expect(world.furnaceProgressAt(2, 1)).toBe(1);
    expect(world.chargeAt(2, 2)).toBe(1);
    expect(world.chargeAt(1, 1)).toBe(0);
    expect(world.chargeAt(3, 1)).toBe(0);

    world.setCharge(2, 1, -1);
    simulation.step();
    expect(world.furnaceProgressAt(2, 1)).toBe(1);
    expect(world.chargeAt(2, 2)).toBe(0);

    world.setCharge(2, 1, 1);
    simulation.step();
    expect(world.furnaceProgressAt(2, 1)).toBe(2);
    expect(world.chargeAtPort(2, 1, Direction.Down)).toBe(1);
    expect(world.chargeAtPort(2, 1, Direction.Left)).toBe(0);

    const imported = deserializeBoard(serializeBoard(world, simulation.tick)).world;
    expect(imported.furnaceProgressAt(2, 1)).toBe(2);
    expect(imported.chargeAtPort(2, 1, Direction.Down)).toBe(1);
    expect(imported.chargeAtPort(2, 1, Direction.Left)).toBe(0);

    simulation.step();
    simulation.step();
    expect(world.kindAt(2, 0)).toBe(TileKind.Glass);
    expect(world.chargeAt(2, 2)).toBe(1);
    simulation.step();
    expect(world.chargeAt(2, 2)).toBe(0);
  });

  it("disables a welded row together and resumes after disconnecting the negative source", () => {
    const world = new World(4, 3);
    world.place(0, 1, TileKind.FixedCharge);
    world.place(1, 1, TileKind.Inverter, Direction.Right);
    world.place(1, 2, TileKind.Platform);
    world.setWeld(0, 1, 1, 1, true);
    for (const x of [2, 3]) {
      world.place(x, 0, TileKind.Sand);
      world.place(x, 1, TileKind.Furnace, Direction.Up);
      world.place(x, 2, TileKind.Conduit);
      world.setWeld(x - 1, 1, x, 1, true);
      world.setWeld(x, 1, x, 2, true);
    }
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 6; tick += 1) simulation.step();
    for (const x of [2, 3]) {
      expect(world.furnaceProgressAt(x, 1)).toBe(2);
      expect(world.chargeAt(x, 1)).toBe(-1);
      expect(world.chargeAt(x, 2)).toBe(0);
      expect(world.kindAt(x, 0)).toBe(TileKind.Sand);
    }

    world.setWeld(1, 1, 2, 1, false);
    simulation.step();
    simulation.step();
    simulation.step();
    for (const x of [2, 3]) {
      expect(world.kindAt(x, 0)).toBe(TileKind.Glass);
      expect(world.chargeAt(x, 2)).toBe(1);
    }
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
