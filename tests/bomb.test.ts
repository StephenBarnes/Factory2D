import { describe, expect, it } from "vitest";

import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { DRILL_TICKS } from "../src/simulation/furnace";
import { watchMachineryActivity } from "../src/simulation/machinery-activity";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TILE_DEFINITIONS, TILE_KINDS, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function row(world: World, y = 0): TileKind[] {
  return Array.from({ length: world.width }, (_, x) => world.kindAt(x, y));
}

describe("bombs", () => {
  it.each([-1, 1] as const)("detonates on resolved %i charge and fills diagonal and empty cells", (charge) => {
    const world = new World(5, 3);
    world.place(0, 1, TileKind.Conduit);
    world.place(1, 1, TileKind.Inverter, Direction.Right);
    world.place(2, 1, TileKind.Bomb);
    world.setWeld(0, 1, 1, 1, true);
    world.setWeld(1, 1, 2, 1, true);
    world.setCharge(0, 1, charge === 1 ? -1 : 1);
    const bombId = world.idAt(2, 1);
    const events = watchMachineryActivity(world);

    new Simulation(world).step();

    for (let y = 0; y < 3; y += 1) {
      for (let x = 1; x < 4; x += 1) expect(world.kindAt(x, y)).toBe(TileKind.Fire);
    }
    expect(world.idAt(2, 1)).not.toBe(bombId);
    expect(events).toEqual([{ voice: "bomb", index: 7 }]);
  });

  it("does not detonate from stale charge on an undriven network", () => {
    const world = new World(2, 1);
    const id = world.place(0, 0, TileKind.Bomb);
    world.setCharge(0, 0, 1);
    const events = watchMachineryActivity(world);

    new Simulation(world).step();

    expect(row(world)).toEqual([TileKind.Bomb, TileKind.Empty]);
    expect(world.idAt(0, 0)).toBe(id);
    expect(world.chargeAt(0, 0)).toBe(0);
    expect(events).toEqual([]);
  });

  it("remains inert when positive and negative resolved drivers cancel", () => {
    const world = new World(4, 1);
    world.place(0, 0, TileKind.Conduit);
    world.place(1, 0, TileKind.Inverter, Direction.Right);
    world.place(2, 0, TileKind.Bomb);
    world.place(3, 0, TileKind.FixedCharge);
    for (let x = 0; x < 3; x += 1) world.setWeld(x, 0, x + 1, 0, true);
    world.setCharge(0, 0, 1);

    new Simulation(world).step();

    expect(world.kindAt(2, 0)).toBe(TileKind.Bomb);
    expect(world.chargeAt(2, 0)).toBe(0);
    expect(world.kindAt(3, 0)).toBe(TileKind.FixedCharge);
  });

  it("detonates overlapping charged bombs simultaneously without chaining through an uncharged bomb", () => {
    const world = new World(6, 1);
    world.place(0, 0, TileKind.FixedCharge);
    for (let x = 1; x <= 3; x += 1) world.place(x, 0, TileKind.Bomb);
    world.place(4, 0, TileKind.Wood);
    world.place(5, 0, TileKind.Stone);
    world.setWeld(0, 0, 1, 0, true);
    world.setWeld(1, 0, 2, 0, true);
    const events = watchMachineryActivity(world);

    new Simulation(world).step();

    expect(row(world)).toEqual([
      TileKind.Fire, TileKind.Fire, TileKind.Fire, TileKind.Fire, TileKind.Wood, TileKind.Stone,
    ]);
    expect(events).toEqual([{ voice: "bomb", index: 1 }, { voice: "bomb", index: 2 }]);
  });

  it.each(TILE_KINDS.filter((kind) => TILE_DEFINITIONS[kind].indestructible))(
    "preserves indestructible kind %i and its identity inside the blast",
    (kind) => {
      const world = new World(3, 1);
      world.place(0, 0, TileKind.FixedCharge);
      world.place(1, 0, TileKind.Bomb);
      const id = world.place(2, 0, kind);
      world.setWeld(0, 0, 1, 0, true);

      new Simulation(world).step();

      expect(row(world)).toEqual([TileKind.Fire, TileKind.Fire, kind]);
      expect(world.idAt(2, 0)).toBe(id);
    },
  );

  it("clips a corner explosion without wrapping into the opposite column", () => {
    const world = new World(3, 2);
    world.place(0, 0, TileKind.Bomb);
    world.place(0, 1, TileKind.FixedCharge);
    world.place(2, 1, TileKind.Wood);
    world.setWeld(0, 0, 0, 1, true);

    new Simulation(world).step();

    expect(row(world, 0)).toEqual([TileKind.Fire, TileKind.Fire, TileKind.Empty]);
    expect(row(world, 1)).toEqual([TileKind.Fire, TileKind.Fire, TileKind.Wood]);
  });

  it("keeps blast fire fresh until the next tick before spreading and expiring", () => {
    const world = new World(4, 1);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.Bomb);
    const oldFireId = world.place(2, 0, TileKind.Fire);
    world.setWeld(0, 0, 1, 0, true);
    const simulation = new Simulation(world);

    simulation.step();
    expect(row(world)).toEqual([TileKind.Fire, TileKind.Fire, TileKind.Fire, TileKind.Empty]);
    expect(world.idAt(2, 0)).not.toBe(oldFireId);
    world.place(3, 0, TileKind.Wood);
    simulation.step();
    expect(row(world)).toEqual([TileKind.Empty, TileKind.Empty, TileKind.Empty, TileKind.Fire]);
    simulation.step();
    expect(row(world)).toEqual(Array(4).fill(TileKind.Empty));
  });

  it("removes destroyed component state and welds before surviving structures fall", () => {
    const world = new World(4, 2);
    world.place(0, 0, TileKind.FixedCharge);
    world.place(1, 0, TileKind.Bomb);
    const delayId = world.place(2, 0, TileKind.Delay);
    world.configureNumericComponent(2, 0, 7);
    const stoneId = world.place(3, 0, TileKind.Stone);
    for (let x = 0; x < 3; x += 1) world.setWeld(x, 0, x + 1, 0, true);

    new Simulation(world).step();

    expect(world.kindAt(2, 0)).toBe(TileKind.Fire);
    expect(world.idAt(2, 0)).not.toBe(delayId);
    expect(world.componentStateSnapshotAt(2, 0)).toBeNull();
    expect(world.chargeAt(2, 0)).toBe(0);
    expect(world.isWelded(1, 0, 2, 0)).toBe(false);
    expect(world.isWelded(2, 0, 3, 0)).toBe(false);
    expect(world.kindAt(3, 0)).toBe(TileKind.Empty);
    expect(world.idAt(3, 1)).toBe(stoneId);
  });

  it("cancels a charged source destroyed by drilling before the bomb phase", () => {
    const world = new World(4, 1);
    world.place(0, 0, TileKind.Drill, Direction.Right);
    const bombId = world.place(1, 0, TileKind.Bomb);
    world.place(2, 0, TileKind.FixedCharge);
    world.place(3, 0, TileKind.Stone);
    world.setWeld(1, 0, 2, 0, true);
    world.applyDrillProgress(0, DRILL_TICKS - 1, bombId);
    const events = watchMachineryActivity(world);

    new Simulation(world).step();

    expect(row(world)).toEqual([TileKind.Drill, TileKind.Empty, TileKind.FixedCharge, TileKind.Stone]);
    expect(events.filter((event) => event.voice === "bomb")).toEqual([]);
  });

  it("waits until the next tick to detonate a newly duplicated charged bomb", () => {
    const world = new World(4, 2);
    world.place(0, 0, TileKind.Bomb);
    world.place(0, 1, TileKind.FixedCharge);
    world.setWeld(0, 0, 0, 1, true);
    world.place(1, 0, TileKind.Duplicator, Direction.Right);
    world.setCharge(1, 0, 1);
    const simulation = new Simulation(world);

    simulation.step();

    expect(world.kindAt(0, 0)).toBe(TileKind.Fire);
    expect(world.kindAt(2, 0)).toBe(TileKind.Bomb);
    expect(world.chargeAt(2, 0)).toBe(1);
    expect(world.kindAt(2, 1)).toBe(TileKind.FixedCharge);
    simulation.step();
    expect(row(world, 0)).toEqual([TileKind.Empty, TileKind.Fire, TileKind.Fire, TileKind.Fire]);
    expect(row(world, 1)).toEqual([TileKind.Empty, TileKind.Fire, TileKind.Fire, TileKind.Fire]);
  });

  it("resolves external charge through nested ports and confines blasts after save/load and reset", () => {
    const original = new World(2, 1);
    original.place(0, 0, TileKind.FixedCharge);
    original.place(1, 0, TileKind.RuneArray);
    original.setWeld(0, 0, 1, 0, true);
    original.configureRuneArray(1, 0, 3, 1, "");
    const middle = original.runeArrayWorldAt(1, 0);
    middle.place(0, 0, TileKind.RuneArray);
    middle.configureRuneArray(0, 0, 3, 1, "");
    middle.place(1, 0, TileKind.Wood);
    const inner = middle.runeArrayWorldAt(0, 0);
    inner.place(0, 0, TileKind.Bomb);
    inner.place(2, 0, TileKind.Stone);
    const world = deserializeBoard(serializeBoard(original, 0)).world;
    const baseline = world.clone();
    const simulation = new Simulation(world);

    for (let run = 0; run < 2; run += 1) {
      simulation.step();
      const currentMiddle = world.runeArrayWorldAt(1, 0);
      expect(row(currentMiddle.runeArrayWorldAt(0, 0))).toEqual([TileKind.Fire, TileKind.Fire, TileKind.Stone]);
      expect(row(currentMiddle)).toEqual([TileKind.RuneArray, TileKind.Wood, TileKind.Empty]);
      expect(row(world)).toEqual([TileKind.FixedCharge, TileKind.RuneArray]);
      simulation.resetTo(baseline);
    }
  });
});
