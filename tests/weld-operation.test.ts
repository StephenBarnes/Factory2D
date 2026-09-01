import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import {
  Direction,
  PaletteCategory,
  TILE_DEFINITIONS,
  TileKind,
  WeldSide,
} from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function placeTransversePlatforms(world: World, orientation: Direction): void {
  world.place(2, 2, TileKind.Platform);
  if (orientation === Direction.Up || orientation === Direction.Down) {
    world.place(1, 2, TileKind.Platform);
    world.place(3, 2, TileKind.Platform);
  } else {
    world.place(2, 1, TileKind.Platform);
    world.place(2, 3, TileKind.Platform);
  }
}

function operatorPosition(orientation: Direction): readonly [number, number] {
  switch (orientation) {
    case Direction.Up:
      return [2, 3];
    case Direction.Right:
      return [1, 2];
    case Direction.Down:
      return [2, 1];
    case Direction.Left:
      return [3, 2];
  }
}

describe("welder and splitter operations", () => {
  it.each([
    Direction.Up,
    Direction.Right,
    Direction.Down,
    Direction.Left,
  ])("welds both edges transverse to orientation %s", (orientation) => {
    const world = new World(5, 5);
    placeTransversePlatforms(world, orientation);
    const [operatorX, operatorY] = operatorPosition(orientation);
    world.place(operatorX, operatorY, TileKind.Welder, orientation);

    new Simulation(world).step();

    if (orientation === Direction.Up || orientation === Direction.Down) {
      expect(world.isWelded(1, 2, 2, 2)).toBe(true);
      expect(world.isWelded(2, 2, 3, 2)).toBe(true);
    } else {
      expect(world.isWelded(2, 1, 2, 2)).toBe(true);
      expect(world.isWelded(2, 2, 2, 3)).toBe(true);
    }
  });

  it("splits both transverse welds", () => {
    const world = new World(5, 5);
    placeTransversePlatforms(world, Direction.Up);
    world.place(2, 3, TileKind.Splitter, Direction.Up);
    world.place(2, 4, TileKind.Platform);
    world.setWeld(1, 2, 2, 2, true);
    world.setWeld(2, 2, 3, 2, true);

    new Simulation(world).step();

    expect(world.isWelded(1, 2, 2, 2)).toBe(false);
    expect(world.isWelded(2, 2, 3, 2)).toBe(false);
    expect(world.chargeAtPort(2, 3, Direction.Down)).toBe(1);
  });

  it("rejects opposing requests for the same edge and pulses neither operator", () => {
    const world = new World(5, 4);
    world.place(2, 2, TileKind.Platform);
    world.place(3, 2, TileKind.Platform);
    world.place(2, 3, TileKind.Welder, Direction.Up);
    world.place(3, 1, TileKind.Splitter, Direction.Down);

    new Simulation(world).step();

    expect(world.isWelded(2, 2, 3, 2)).toBe(false);
    expect(world.chargeAtPort(2, 3, Direction.Down)).toBe(0);
    expect(world.chargeAtPort(3, 1, Direction.Up)).toBe(0);
  });

  it("does not weld non-weldable sand edges", () => {
    const world = new World(5, 4);
    world.place(1, 2, TileKind.Platform);
    world.place(2, 2, TileKind.Sand);
    world.place(3, 2, TileKind.Platform);
    world.place(2, 3, TileKind.Welder, Direction.Up);

    new Simulation(world).step();

    expect(world.isWelded(1, 2, 2, 2)).toBe(false);
    expect(world.isWelded(2, 2, 3, 2)).toBe(false);
  });

  it("reads one shared side network and disables only on -1", () => {
    const disabled = new World(5, 4);
    placeTransversePlatforms(disabled, Direction.Up);
    disabled.place(2, 3, TileKind.Welder, Direction.Up);
    disabled.setCharge(2, 3, -1);

    new Simulation(disabled).step();

    expect(disabled.isWelded(1, 2, 2, 2)).toBe(false);
    expect(disabled.isWelded(2, 2, 3, 2)).toBe(false);

    const bridged = new World(5, 3);
    bridged.place(1, 2, TileKind.FixedCharge);
    bridged.place(2, 2, TileKind.Welder, Direction.Up);
    bridged.place(3, 2, TileKind.Conduit);
    bridged.setWeld(1, 2, 2, 2, true);
    bridged.setWeld(2, 2, 3, 2, true);

    new Simulation(bridged).step();

    expect(bridged.chargeAtPort(2, 2, Direction.Left)).toBe(1);
    expect(bridged.chargeAtPort(2, 2, Direction.Right)).toBe(1);
    expect(bridged.chargeAt(3, 2)).toBe(1);
  });

  it("pulses the isolated rear output for exactly one successful tick", () => {
    const world = new World(4, 4);
    world.place(0, 3, TileKind.Conduit);
    world.place(1, 3, TileKind.Welder, Direction.Right);
    world.place(2, 2, TileKind.Platform);
    world.place(2, 3, TileKind.Platform);
    world.setWeld(0, 3, 1, 3, true);
    const simulation = new Simulation(world);

    simulation.step();

    expect(world.isWelded(2, 2, 2, 3)).toBe(true);
    expect(world.chargeAtPort(1, 3, Direction.Left)).toBe(1);
    expect(world.chargeAt(0, 3)).toBe(1);

    simulation.step();

    expect(world.chargeAtPort(1, 3, Direction.Left)).toBe(0);
    expect(world.chargeAt(0, 3)).toBe(0);
  });

  it("commits topology before motion resolves", () => {
    const world = new World(4, 4);
    world.place(1, 1, TileKind.Platform);
    world.place(2, 1, TileKind.Stone);
    world.place(2, 2, TileKind.Welder, Direction.Up);
    world.place(2, 3, TileKind.Platform);

    new Simulation(world).step();

    expect(world.kindAt(2, 1)).toBe(TileKind.Stone);
    expect(world.isWelded(1, 1, 2, 1)).toBe(true);
  });

  it("round-trips isolated output charge through board JSON", () => {
    const world = new World(3, 2);
    world.place(1, 1, TileKind.Welder, Direction.Right);
    world.setCharge(1, 1, -1);
    world.setIsolatedOutputCharge(1, 1, 1);

    const serialized = serializeBoard(world, 4);
    const imported = deserializeBoard(serialized);

    expect(JSON.parse(serialized)).toMatchObject({
      grid: ["...", ".J."],
      isolatedOutputCharges: [{ x: 1, y: 1, charge: 1 }],
    });
    expect(imported.world.chargeAt(1, 1)).toBe(-1);
    expect(imported.world.chargeAtPort(1, 1, Direction.Left)).toBe(1);
  });
});

describe("welder and splitter metadata", () => {
  it.each([TileKind.Welder, TileKind.Splitter])(
    "defines directional mechanism ports and excludes its forward weld for kind %s",
    (kind) => {
      const definition = TILE_DEFINITIONS[kind];
      expect(definition.palette?.category).toBe(PaletteCategory.Mechanisms);
      expect(definition.usesOrientation).toBe(true);
      expect(definition.weldableSides).toBe(WeldSide.All);
      expect(definition.excludesFacingWeld).toBe(true);
      expect(definition.circuitPorts).toBe(
        WeldSide.Right | WeldSide.Down | WeldSide.Left,
      );
      expect(definition.circuitOutputPorts).toBe(WeldSide.Down);

      const world = new World(3, 3);
      world.place(1, 1, kind, Direction.Right);
      world.place(2, 1, TileKind.Platform);
      world.place(0, 1, TileKind.Platform);
      expect(world.canWeld(1, 1, 2, 1)).toBe(false);
      expect(world.canWeld(1, 1, 0, 1)).toBe(true);
    },
  );
});
