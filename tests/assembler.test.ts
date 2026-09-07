import { describe, expect, it } from "vitest";

import { ASSEMBLER_PATTERNS, ASSEMBLER_RECIPES } from "../src/simulation/assembler";
import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import {
  MAX_ASSEMBLER_OUTPUTS,
  hasComponentState,
  transformComponentSnapshot,
} from "../src/simulation/configurable-components";
import { Simulation } from "../src/simulation/simulation";
import {
  Direction,
  TILE_DEFINITIONS,
  TileKind,
  WeldSide,
} from "../src/simulation/tile";
import { World } from "../src/simulation/world";

/** Glass welded left of iron: the "Sensor pair" recipe input in its unrotated form. */
function placeSensorPairInput(world: World, x: number, y: number): void {
  world.place(x, y, TileKind.Glass);
  world.place(x + 1, y, TileKind.Iron);
  world.setWeld(x, y, x + 1, y, true);
}

function pendingKinds(world: World, x: number, y: number): TileKind[] {
  const state = world.componentStateSnapshotAt(x, y);
  if (state?.type !== "assembler") {
    throw new Error("Expected an assembler state");
  }
  return state.pending.map((output) => output.kind);
}

describe("assembler recipes", () => {
  it("precomputes distinct rotations of every recipe with rotated outputs", () => {
    for (const recipe of ASSEMBLER_RECIPES) {
      const patterns = ASSEMBLER_PATTERNS.filter((pattern) => pattern.recipe === recipe);
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns.length).toBeLessThanOrEqual(4);
      expect(patterns[0]?.rotation).toBe(0);
      for (const pattern of patterns) {
        expect(pattern.cells.length).toBe(patterns[0]?.cells.length);
        expect(pattern.outputs.length).toBe(recipe.outputs.length);
        expect(pattern.outputs.length).toBeLessThanOrEqual(MAX_ASSEMBLER_OUTPUTS);
      }
    }
    const lodestone = ASSEMBLER_PATTERNS.filter((pattern) => pattern.recipe.name === "Lodestone");
    expect(lodestone.map((pattern) => pattern.rotation)).toEqual([0, 1, 2, 3]);
    expect(lodestone.map((pattern) => pattern.outputs[0]?.orientation)).toEqual([
      Direction.Right,
      Direction.Down,
      Direction.Left,
      Direction.Up,
    ]);
    const conduits = ASSEMBLER_PATTERNS.filter((pattern) => pattern.recipe.name === "Conduits");
    expect(conduits.map((pattern) => pattern.rotation)).toEqual([0]);
  });

  it("rotates welds along with cells", () => {
    const piston = ASSEMBLER_PATTERNS.filter((pattern) => pattern.recipe.name === "Piston");
    expect(piston).toHaveLength(4);
    const clockwise = piston[1];
    expect(clockwise?.cells).toEqual([
      { dx: 0, dy: 0, kind: TileKind.Stone, orientation: Direction.Up, rightWeld: true, downWeld: false },
      { dx: 1, dy: 0, kind: TileKind.Iron, orientation: Direction.Up, rightWeld: false, downWeld: false },
    ]);
    expect(clockwise?.outputs).toEqual([{ kind: TileKind.Piston, orientation: Direction.Right }]);
  });
});

describe("assemblers", () => {
  it("defines directional ports and carries queue state without configuration", () => {
    const definition = TILE_DEFINITIONS[TileKind.Assembler];
    expect(definition.boardCode).toBe("H");
    expect(definition.usesOrientation).toBe(true);
    expect(definition.weldableSides).toBe(WeldSide.Right | WeldSide.Left);
    expect(definition.circuitPorts).toBe(WeldSide.None);
    expect(hasComponentState(TileKind.Assembler)).toBe(true);

    const world = new World(3, 3);
    world.place(1, 1, TileKind.Assembler, Direction.Up);
    expect(world.componentStateSnapshotAt(1, 1)).toEqual({ type: "assembler", pending: [] });
    expect(world.assemblerPendingCountAtIndex(4)).toBe(0);
  });

  it("consumes a matching body ahead, then emits outputs one per tick behind it", () => {
    const world = new World(4, 6);
    world.place(1, 0, TileKind.Platform);
    world.place(2, 0, TileKind.Platform);
    placeSensorPairInput(world, 1, 1);
    world.place(1, 2, TileKind.Assembler, Direction.Up);
    world.place(0, 2, TileKind.Platform);
    world.setWeld(0, 2, 1, 2, true);
    world.place(1, 4, TileKind.Platform);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
    expect(pendingKinds(world, 1, 2)).toEqual([TileKind.Sensor, TileKind.Sensor]);
    expect(world.kindAt(1, 3)).toBe(TileKind.Empty);

    simulation.step();
    expect(world.kindAt(1, 3)).toBe(TileKind.Sensor);
    expect(world.orientationAt(1, 3)).toBe(Direction.Up);
    expect(world.isWelded(1, 2, 1, 3)).toBe(false);
    expect(pendingKinds(world, 1, 2)).toEqual([TileKind.Sensor]);

    simulation.step();
    expect(world.kindAt(1, 3)).toBe(TileKind.Sensor);
    expect(pendingKinds(world, 1, 2)).toEqual([TileKind.Sensor]);

    world.place(1, 3, TileKind.Empty);
    simulation.step();
    expect(world.kindAt(1, 3)).toBe(TileKind.Sensor);
    expect(pendingKinds(world, 1, 2)).toEqual([]);
  });

  it("does not consume while outputs are pending", () => {
    const world = new World(4, 4);
    world.place(1, 0, TileKind.Platform);
    world.place(2, 0, TileKind.Platform);
    placeSensorPairInput(world, 1, 1);
    world.place(1, 2, TileKind.Assembler, Direction.Up);
    world.place(0, 2, TileKind.Platform);
    world.setWeld(0, 2, 1, 2, true);
    const simulation = new Simulation(world);

    simulation.step();
    expect(pendingKinds(world, 1, 2)).toHaveLength(2);
    placeSensorPairInput(world, 1, 1);

    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Glass);
    expect(pendingKinds(world, 1, 2)).toHaveLength(1);
    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Glass);
    expect(pendingKinds(world, 1, 2)).toHaveLength(1);
    world.place(1, 3, TileKind.Empty);
    simulation.step();
    expect(pendingKinds(world, 1, 2)).toHaveLength(0);
    expect(world.kindAt(1, 1)).toBe(TileKind.Glass);
    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(pendingKinds(world, 1, 2)).toHaveLength(2);
  });

  it.each([
    { rotation: 0, cells: [[2, 3], [2, 4], [3, 4]], assembler: [4, 4, Direction.Left], output: [5, 4], magnet: Direction.Right },
    { rotation: 1, cells: [[3, 3], [2, 3], [2, 4]], assembler: [1, 4, Direction.Right], output: [0, 4], magnet: Direction.Down },
    { rotation: 2, cells: [[3, 4], [3, 3], [2, 3]], assembler: [4, 4, Direction.Left], output: [5, 4], magnet: Direction.Left },
    { rotation: 3, cells: [[2, 4], [3, 4], [3, 3]], assembler: [4, 4, Direction.Left], output: [5, 4], magnet: Direction.Up },
  ])(
    "rotates the output with the input body (rotation $rotation)",
    ({ cells, assembler, output, magnet }) => {
      const world = new World(6, 5);
      world.place(assembler[0] ?? 0, assembler[1] ?? 0, TileKind.Assembler, assembler[2]);
      const at = (cell: number): readonly [number, number] => {
        const entry = cells[cell];
        if (entry === undefined) {
          throw new Error(`Missing L cell ${cell}`);
        }
        return [entry[0] ?? 0, entry[1] ?? 0];
      };
      for (let cell = 0; cell < 3; cell += 1) {
        world.place(...at(cell), TileKind.Iron);
      }
      world.setWeld(...at(0), ...at(1), true);
      world.setWeld(...at(1), ...at(2), true);
      const simulation = new Simulation(world);

      simulation.step();
      for (let cell = 0; cell < 3; cell += 1) {
        expect(world.kindAt(...at(cell))).toBe(TileKind.Empty);
      }
      simulation.step();
      expect(world.kindAt(output[0] ?? 0, output[1] ?? 0)).toBe(TileKind.Magnet);
      expect(world.orientationAt(output[0] ?? 0, output[1] ?? 0)).toBe(magnet);
    },
  );

  it("rejects bodies with a different weld topology, extra cells, or the wrong kind", () => {
    const world = new World(4, 4);
    world.place(1, 0, TileKind.Platform);
    world.place(2, 0, TileKind.Platform);
    world.place(1, 2, TileKind.Assembler, Direction.Up);
    world.place(0, 2, TileKind.Platform);
    world.setWeld(0, 2, 1, 2, true);
    world.place(1, 1, TileKind.Glass);
    world.place(2, 1, TileKind.Iron);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Glass);

    world.setWeld(1, 1, 2, 1, true);
    world.place(3, 1, TileKind.Iron);
    world.setWeld(2, 1, 3, 1, true);
    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Glass);

    world.place(3, 1, TileKind.Empty);
    world.place(1, 1, TileKind.Stone);
    world.setWeld(1, 1, 2, 1, true);
    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Stone);
  });

  it("ignores its own welded body and cells beyond the board", () => {
    const world = new World(3, 3);
    world.place(1, 0, TileKind.Iron);
    world.place(1, 1, TileKind.Stone);
    world.setWeld(1, 0, 1, 1, true);
    world.place(1, 2, TileKind.Assembler, Direction.Up);
    world.setWeld(1, 1, 1, 2, true);
    expect(world.isWelded(1, 1, 1, 2)).toBe(false);
    world.place(0, 2, TileKind.Platform);
    world.setWeld(0, 2, 1, 2, true);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(pendingKinds(world, 1, 2)).toEqual([TileKind.Piston]);
    simulation.step();
    simulation.step();
    expect(pendingKinds(world, 1, 2)).toEqual([TileKind.Piston]);
  });

  it("jams two assemblers claiming the same body", () => {
    const world = new World(5, 2);
    world.place(0, 1, TileKind.Assembler, Direction.Right);
    world.place(1, 1, TileKind.Iron);
    world.place(2, 1, TileKind.Glass);
    world.setWeld(1, 1, 2, 1, true);
    world.place(3, 1, TileKind.Assembler, Direction.Left);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Iron);
    expect(world.kindAt(2, 1)).toBe(TileKind.Glass);
    expect(pendingKinds(world, 0, 1)).toEqual([]);
    expect(pendingKinds(world, 3, 1)).toEqual([]);
  });

  it("jams two assemblers emitting into the same cell", () => {
    const world = new World(5, 3);
    world.place(1, 1, TileKind.Assembler, Direction.Left);
    world.place(1, 0, TileKind.Platform);
    world.setWeld(1, 0, 1, 1, true);
    world.place(3, 1, TileKind.Assembler, Direction.Right);
    world.place(3, 0, TileKind.Platform);
    world.setWeld(3, 0, 3, 1, true);
    world.restoreComponentState(1, 1, {
      type: "assembler",
      pending: [{ kind: TileKind.Stone, orientation: Direction.Up }],
    });
    world.restoreComponentState(3, 1, {
      type: "assembler",
      pending: [{ kind: TileKind.Sand, orientation: Direction.Up }],
    });
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
    expect(pendingKinds(world, 1, 1)).toEqual([TileKind.Stone]);
    expect(pendingKinds(world, 3, 1)).toEqual([TileKind.Sand]);
  });

  it("lets a delivery box absorbing the same body win over consumption", () => {
    const world = new World(4, 4);
    world.place(1, 0, TileKind.Assembler, Direction.Down);
    world.place(0, 0, TileKind.Platform);
    world.setWeld(0, 0, 1, 0, true);
    placeSensorPairInput(world, 1, 1);
    world.place(1, 2, TileKind.Delivery, Direction.Up);
    world.place(0, 2, TileKind.Conduit);
    world.setWeld(0, 2, 1, 2, true);
    placeSensorPairInput(world, 1, 3);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(world.chargeAt(0, 2)).toBe(1);
    expect(world.kindAt(1, 3)).toBe(TileKind.Glass);
    expect(pendingKinds(world, 1, 0)).toEqual([]);
  });

  it("emitted outputs fall and animate from the output cell", () => {
    const world = new World(3, 5);
    world.place(1, 0, TileKind.Assembler, Direction.Up);
    world.place(0, 0, TileKind.Platform);
    world.setWeld(0, 0, 1, 0, true);
    world.restoreComponentState(1, 0, {
      type: "assembler",
      pending: [{ kind: TileKind.Stone, orientation: Direction.Up }],
    });
    const previous = world.clone();
    const simulation = new Simulation(world);

    simulation.step(previous);

    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(1, 2)).toBe(TileKind.Stone);
    expect(previous.kindAt(1, 1)).toBe(TileKind.Stone);
    expect(previous.idAt(1, 1)).toBe(world.idAt(1, 2));
  });

  it("keeps the queue through movement, cloning, and reset", () => {
    const world = new World(3, 4);
    world.place(1, 0, TileKind.Assembler, Direction.Down);
    world.restoreComponentState(1, 0, {
      type: "assembler",
      pending: [
        { kind: TileKind.Magnet, orientation: Direction.Left },
        { kind: TileKind.Stone, orientation: Direction.Up },
      ],
    });
    const id = world.idAt(1, 0);
    const snapshot = world.clone();
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Assembler);
    expect(world.idAt(1, 1)).toBe(id);
    expect(pendingKinds(world, 1, 1)).toEqual([TileKind.Magnet, TileKind.Stone]);

    simulation.resetTo(snapshot);
    expect(world.componentStateSnapshotAt(1, 0)).toEqual(snapshot.componentStateSnapshotAt(1, 0));
  });

  it("mirrors queued orientations when duplicated and rotates them in transforms", () => {
    const snapshot = {
      type: "assembler" as const,
      pending: [
        { kind: TileKind.Magnet, orientation: Direction.Right },
        { kind: TileKind.Stone, orientation: Direction.Up },
      ],
    };
    expect(transformComponentSnapshot(snapshot, 1, false, false)).toEqual({
      type: "assembler",
      pending: [
        { kind: TileKind.Magnet, orientation: Direction.Down },
        { kind: TileKind.Stone, orientation: Direction.Up },
      ],
    });
    expect(transformComponentSnapshot(snapshot, 0, true, false)).toEqual({
      type: "assembler",
      pending: [
        { kind: TileKind.Magnet, orientation: Direction.Left },
        { kind: TileKind.Stone, orientation: Direction.Up },
      ],
    });

    const world = new World(5, 5);
    world.place(2, 2, TileKind.Duplicator, Direction.Right);
    world.place(2, 1, TileKind.Platform);
    world.setWeld(2, 1, 2, 2, true);
    world.place(1, 2, TileKind.Assembler, Direction.Up);
    world.restoreComponentState(1, 2, snapshot);
    world.place(0, 2, TileKind.Platform);
    world.setWeld(0, 2, 1, 2, true);
    world.setCharge(2, 2, 1);
    new Simulation(world).step();

    expect(world.kindAt(3, 2)).toBe(TileKind.Assembler);
    expect(world.componentStateSnapshotAt(3, 2)).toEqual({
      type: "assembler",
      pending: [
        { kind: TileKind.Magnet, orientation: Direction.Left },
        { kind: TileKind.Stone, orientation: Direction.Up },
      ],
    });
  });

  it("round-trips pending outputs through the board format", () => {
    const world = new World(2, 2);
    world.place(0, 0, TileKind.Assembler, Direction.Left);
    world.restoreComponentState(0, 0, {
      type: "assembler",
      pending: [
        { kind: TileKind.Magnet, orientation: Direction.Down },
        { kind: TileKind.Sensor, orientation: Direction.Right },
      ],
    });
    world.place(1, 1, TileKind.Assembler);
    const serialized = serializeBoard(world, 3);
    const parsed = JSON.parse(serialized) as { components: unknown[] };
    expect(parsed.components).toEqual([
      {
        x: 0,
        y: 0,
        type: "assembler",
        pending: [
          { code: "L", direction: "down" },
          { code: "S", direction: "right" },
        ],
      },
      { x: 1, y: 1, type: "assembler", pending: [] },
    ]);

    const imported = deserializeBoard(serialized);
    expect(imported.world.componentStateSnapshotAt(0, 0)).toEqual(world.componentStateSnapshotAt(0, 0));
    expect(imported.world.orientationAt(0, 0)).toBe(Direction.Left);
    expect(imported.world.componentStateSnapshotAt(1, 1)).toEqual({ type: "assembler", pending: [] });
  });

  it("rejects malformed pending outputs", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.Assembler);
    const base = JSON.parse(serializeBoard(world, 0)) as {
      components: { pending: unknown }[];
    };
    const withPending = (pending: unknown): string => {
      const components = [{ ...base.components[0], pending }];
      return JSON.stringify({ ...base, components });
    };

    expect(() => deserializeBoard(withPending([{ code: ".", direction: "up" }]))).toThrow(
      /invalid tile code/,
    );
    expect(() => deserializeBoard(withPending([{ code: "#", direction: "sideways" }]))).toThrow(
      /unknown direction/,
    );
    expect(() => deserializeBoard(withPending(
      Array.from({ length: MAX_ASSEMBLER_OUTPUTS + 1 }, () => ({ code: "#", direction: "up" })),
    ))).toThrow(/at most/);
    expect(() => deserializeBoard(JSON.stringify({ ...base, components: [] }))).toThrow(
      /missing state/,
    );
  });
});
