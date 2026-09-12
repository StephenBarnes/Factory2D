import { describe, expect, it } from "vitest";

import {
  Direction,
  orientationForKind,
  TileKind,
} from "../src/simulation/tile";

describe("tile orientation", () => {
  it.each([
    TileKind.Magnet,
    TileKind.Sensor,
    TileKind.Inverter,
    TileKind.Combiner,
    TileKind.Rectifier,
    TileKind.Multiplier,
    TileKind.Subtractor,
    TileKind.ChargeSensor,
    TileKind.Selector,
    TileKind.Equality,
    TileKind.Minimum,
    TileKind.Maximum,
    TileKind.Furnace,
    TileKind.Piston,
    TileKind.PistonBase,
    TileKind.PistonArm,
    TileKind.Delay,
    TileKind.Counter,
    TileKind.Rom,
    TileKind.Welder,
    TileKind.Splitter,
  ])(
    "preserves the selected orientation for directional kind %s",
    (kind) => {
      expect(orientationForKind(kind, Direction.Left)).toBe(Direction.Left);
    },
  );

  it.each([
    TileKind.Sand,
    TileKind.Conduit,
    TileKind.FixedCharge,
    TileKind.Spark,
    TileKind.WireCrossing,
    TileKind.Conveyor,
  ])(
    "uses the canonical orientation for non-directional kind %s",
    (kind) => {
      expect(orientationForKind(kind, Direction.Left)).toBe(Direction.Up);
    },
  );
});
