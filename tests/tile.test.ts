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
  ])(
    "preserves the selected orientation for directional kind %s",
    (kind) => {
      expect(orientationForKind(kind, Direction.Left)).toBe(Direction.Left);
    },
  );

  it.each([TileKind.Sand, TileKind.Conduit])(
    "uses the canonical orientation for non-directional kind %s",
    (kind) => {
      expect(orientationForKind(kind, Direction.Left)).toBe(Direction.Up);
    },
  );
});
