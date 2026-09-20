import { describe, expect, it } from "vitest";

import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("gravity simulation", () => {
  it("rebuilds stationary body topology after splitting, movement, and reset", () => {
    const world = new World(2, 4);
    world.place(0, 0, TileKind.Platform);
    const stoneId = world.place(1, 0, TileKind.Stone);
    world.setWeld(0, 0, 1, 0, true);
    const baseline = world.clone();
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(0);
    expect(simulation.step()).toBe(0);
    world.setWeld(0, 0, 1, 0, false);
    expect(simulation.step()).toBe(1);
    expect(world.idAt(1, 1)).toBe(stoneId);
    expect(simulation.step()).toBe(1);
    expect(world.idAt(1, 2)).toBe(stoneId);

    simulation.resetTo(baseline);
    expect(simulation.step()).toBe(0);
    expect(simulation.step()).toBe(0);
    expect(world.idAt(1, 0)).toBe(stoneId);
    expect(world.isWelded(0, 0, 1, 0)).toBe(true);
  });

  it("moves sand down exactly one cell per tick and preserves its identity", () => {
    const world = new World(3, 4);
    const sandId = world.place(1, 0, TileKind.Sand);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(1);
    expect(world.tileAt(1, 0)).toEqual({ kind: TileKind.Empty, id: 0 });
    expect(world.tileAt(1, 1)).toEqual({ kind: TileKind.Sand, id: sandId });
    expect(simulation.tick).toBe(1);
  });

  it("moves an unsupported column together from the start-of-tick state", () => {
    const world = new World(1, 4);
    const upperId = world.place(0, 0, TileKind.Stone);
    const lowerId = world.place(0, 1, TileKind.Stone);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(2);
    expect(world.kindAt(0, 0)).toBe(TileKind.Empty);
    expect(world.idAt(0, 1)).toBe(upperId);
    expect(world.idAt(0, 2)).toBe(lowerId);
  });

  it("keeps a gravity dependency chain still when its base is fixed", () => {
    const world = new World(1, 4);
    const upperId = world.place(0, 0, TileKind.Stone);
    const lowerId = world.place(0, 1, TileKind.Stone);
    world.place(0, 2, TileKind.Platform);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(0);
    expect(world.idAt(0, 0)).toBe(upperId);
    expect(world.idAt(0, 1)).toBe(lowerId);
  });

  it("does not move sand through fixed blocks or the world boundary", () => {
    const world = new World(2, 3);
    world.place(0, 1, TileKind.Sand);
    world.place(0, 2, TileKind.Platform);
    world.place(1, 2, TileKind.Sand);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(0);
    expect(world.kindAt(0, 1)).toBe(TileKind.Sand);
    expect(world.kindAt(1, 2)).toBe(TileKind.Sand);
  });

  it("moves stone down while a fixed platform stays in place", () => {
    const world = new World(2, 3);
    world.place(0, 0, TileKind.Stone);
    world.place(1, 0, TileKind.Platform);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(1);
    expect(world.kindAt(0, 1)).toBe(TileKind.Stone);
    expect(world.kindAt(1, 0)).toBe(TileKind.Platform);
  });

  it("does not slide stone diagonally around an obstacle", () => {
    const world = new World(3, 3);
    world.place(1, 0, TileKind.Stone);
    world.place(1, 1, TileKind.Platform);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(0);
    expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
  });

  it("resets both world state and tick count to an edited snapshot", () => {
    const world = new World(1, 3);
    world.place(0, 0, TileKind.Sand);
    const snapshot = world.clone();
    const simulation = new Simulation(world);
    simulation.step();

    simulation.resetTo(snapshot);

    expect(simulation.tick).toBe(0);
    expect(world.kindAt(0, 0)).toBe(TileKind.Sand);
    expect(world.kindAt(0, 1)).toBe(TileKind.Empty);
  });
});

describe("diagonal sand gravity", () => {
  it("uses coordinate and tick parity to choose between open lower diagonals", () => {
    const evenTickWorld = new World(3, 3);
    evenTickWorld.place(1, 0, TileKind.Sand);
    evenTickWorld.place(1, 1, TileKind.Platform);
    const evenTickSimulation = new Simulation(evenTickWorld);

    expect(evenTickSimulation.step()).toBe(1);
    expect(evenTickWorld.kindAt(2, 1)).toBe(TileKind.Sand);

    const oddTickWorld = new World(3, 3);
    oddTickWorld.place(1, 0, TileKind.Sand);
    oddTickWorld.place(1, 1, TileKind.Platform);
    const oddTickSimulation = new Simulation(oddTickWorld);
    oddTickSimulation.tick = 1;

    expect(oddTickSimulation.step()).toBe(1);
    expect(oddTickWorld.kindAt(0, 1)).toBe(TileKind.Sand);
  });

  it("falls through the other lower diagonal when the preferred side is blocked", () => {
    const world = new World(3, 3);
    world.place(1, 0, TileKind.Sand);
    world.place(1, 1, TileKind.Platform);
    world.place(2, 1, TileKind.Platform);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(1);
    expect(world.kindAt(0, 1)).toBe(TileKind.Sand);
  });

  it.each([0, 1])("alternates diagonal contention priority at tick %i without losing either grain", (tick) => {
    const world = new World(3, 4);
    const rightId = world.place(2, 0, TileKind.Sand);
    const leftId = world.place(0, 0, TileKind.Sand);
    world.place(0, 1, TileKind.Platform);
    world.place(2, 1, TileKind.Platform);
    const simulation = new Simulation(world);
    simulation.tick = tick;
    const winnerId = tick === 0 ? rightId : leftId;
    const waitingId = tick === 0 ? leftId : rightId;
    const waitingX = tick === 0 ? 0 : 2;

    expect(simulation.step()).toBe(1);
    expect(world.idAt(1, 1)).toBe(winnerId);
    expect(world.idAt(waitingX, 0)).toBe(waitingId);
    expect(world.kindAt(2 - waitingX, 0)).toBe(TileKind.Empty);

    simulation.step();
    simulation.step();
    expect(world.idAt(1, 1)).toBe(waitingId);
    expect(world.idAt(1, 3)).toBe(winnerId);
  });

  it("drains every column of a symmetric sand funnel while preserving all grains", () => {
    const world = new World(9, 12);
    const sandIds: number[] = [];
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x <= y; x += 1) {
        world.place(x, y, TileKind.Platform);
        world.place(8 - x, y, TileKind.Platform);
      }
      if (y < 3) {
        for (let x = y + 1; x < 8 - y; x += 1) {
          sandIds.push(world.place(x, y, TileKind.Sand));
        }
      }
    }
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 80; tick += 1) simulation.step();

    const drainedIds: number[] = [];
    for (let y = 0; y < world.height; y += 1) {
      for (let x = 0; x < world.width; x += 1) {
        if (world.kindAt(x, y) === TileKind.Sand) {
          expect(y).toBeGreaterThan(3);
          drainedIds.push(world.idAt(x, y));
        }
      }
    }
    expect(drainedIds.sort((a, b) => a - b)).toEqual(sandIds.sort((a, b) => a - b));
  });

  it("lets unsupported overhangs fall before blocked sand can move diagonally", () => {
    const world = new World(7, 4);
    for (let x = 1; x <= 5; x += 1) {
      world.place(x, 1, TileKind.Sand);
    }
    for (let x = 2; x <= 4; x += 1) {
      world.place(x, 2, TileKind.Platform);
    }
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(2);
    expect(world.kindAt(1, 2)).toBe(TileKind.Sand);
    expect(world.kindAt(5, 2)).toBe(TileKind.Sand);
    expect(world.kindAt(2, 1)).toBe(TileKind.Sand);
    expect(world.kindAt(4, 1)).toBe(TileKind.Sand);
  });
});

describe("welded bodies", () => {
  it("moves welded stone as one body while preserving IDs and the weld", () => {
    const world = new World(3, 3);
    const leftId = world.place(0, 0, TileKind.Stone);
    const rightId = world.place(1, 0, TileKind.Stone);
    expect(world.setWeld(0, 0, 1, 0, true)).toBe(true);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(2);
    expect(world.idAt(0, 1)).toBe(leftId);
    expect(world.idAt(1, 1)).toBe(rightId);
    expect(world.isWelded(0, 1, 1, 1)).toBe(true);
  });

  it("moves overlapping destinations in a vertical welded body", () => {
    const world = new World(1, 4);
    const upperId = world.place(0, 0, TileKind.Stone);
    const lowerId = world.place(0, 1, TileKind.Stone);
    world.setWeld(0, 0, 0, 1, true);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(2);
    expect(world.idAt(0, 1)).toBe(upperId);
    expect(world.idAt(0, 2)).toBe(lowerId);
    expect(world.isWelded(0, 1, 0, 2)).toBe(true);
  });

  it("does not move a body containing a fixed block", () => {
    const world = new World(2, 3);
    world.place(0, 0, TileKind.Stone);
    world.place(1, 0, TileKind.Platform);
    world.setWeld(0, 0, 1, 0, true);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(0);
    expect(world.kindAt(0, 0)).toBe(TileKind.Stone);
    expect(world.kindAt(1, 0)).toBe(TileKind.Platform);
  });

  it("moves a welded body and every unsupported body beneath it together", () => {
    const world = new World(2, 4);
    const upperLeftId = world.place(0, 0, TileKind.Stone);
    const upperRightId = world.place(1, 0, TileKind.Stone);
    const lowerLeftId = world.place(0, 1, TileKind.Stone);
    const lowerRightId = world.place(1, 1, TileKind.Stone);
    world.setWeld(0, 0, 1, 0, true);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(4);
    expect(world.idAt(0, 1)).toBe(upperLeftId);
    expect(world.idAt(1, 1)).toBe(upperRightId);
    expect(world.idAt(0, 2)).toBe(lowerLeftId);
    expect(world.idAt(1, 2)).toBe(lowerRightId);
  });
});


describe("world editing", () => {
  it("assigns stable nonzero IDs and does not replace an unchanged tile", () => {
    const world = new World(2, 1);
    const firstId = world.place(0, 0, TileKind.Stone);

    expect(firstId).toBeGreaterThan(0);
    expect(world.place(0, 0, TileKind.Stone)).toBe(firstId);
    expect(world.place(0, 0, TileKind.Sand)).not.toBe(firstId);
  });

  it("creates welds only between weldable neighbors and clears incident welds with a tile", () => {
    const world = new World(2, 2);
    world.place(0, 0, TileKind.Stone);

    expect(world.canWeld(0, 0, 1, 0)).toBe(false);
    expect(world.setWeld(0, 0, 1, 0, true)).toBe(false);
    world.place(1, 0, TileKind.Sand);
    expect(world.canWeld(0, 0, 1, 0)).toBe(false);
    expect(world.setWeld(0, 0, 1, 0, true)).toBe(false);
    world.place(1, 0, TileKind.Stone);
    expect(world.canWeld(0, 0, 1, 0)).toBe(true);
    expect(world.setWeld(0, 0, 1, 0, true)).toBe(true);
    expect(world.isWelded(0, 0, 1, 0)).toBe(true);
    expect(world.clone().isWelded(0, 0, 1, 0)).toBe(true);

    world.place(1, 0, TileKind.Empty);
    expect(world.isWelded(0, 0, 1, 0)).toBe(false);
  });

  it("welds a tile to every eligible occupied neighbor", () => {
    const world = new World(3, 3);
    world.place(1, 1, TileKind.Magnet, Direction.Right);
    world.place(0, 1, TileKind.Iron);
    world.place(2, 1, TileKind.Iron);
    world.place(1, 0, TileKind.Stone);
    world.place(1, 2, TileKind.Sand);

    expect(world.weldEligibleNeighbors(1, 1)).toBe(true);
    expect(world.isWelded(1, 1, 0, 1)).toBe(true);
    expect(world.isWelded(1, 1, 1, 0)).toBe(true);
    expect(world.isWelded(1, 1, 2, 1)).toBe(false);
    expect(world.isWelded(1, 1, 1, 2)).toBe(false);
    expect(world.weldEligibleNeighbors(1, 1)).toBe(false);
  });
});

describe("directional magnets", () => {
  it("rebuilds magnetic contacts after late placement, rotation, removal, and reset", () => {
    const world = new World(8, 5);
    world.place(2, 2, TileKind.Iron);
    world.place(2, 3, TileKind.Platform);
    world.setWeld(2, 2, 2, 3, true);
    const thrusterId = world.place(4, 2, TileKind.Thruster, Direction.Right);
    world.place(3, 2, TileKind.Stone);
    world.setWeld(3, 2, 4, 2, true);
    const nonMagnetic = world.clone();
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(2);
    expect(world.idAt(5, 2)).toBe(thrusterId);

    simulation.resetTo(nonMagnetic);
    world.place(3, 2, TileKind.Magnet, Direction.Left);
    world.setWeld(3, 2, 4, 2, true);
    const magnetic = world.clone();
    expect(simulation.step()).toBe(0);
    expect(world.idAt(4, 2)).toBe(thrusterId);

    // Losing the last contact must release the body even while a magnet remains.
    world.place(3, 2, TileKind.Magnet, Direction.Up);
    expect(simulation.step()).toBe(2);
    expect(world.idAt(5, 2)).toBe(thrusterId);

    simulation.resetTo(magnetic);
    expect(simulation.step()).toBe(0);
    expect(world.idAt(4, 2)).toBe(thrusterId);

    world.place(3, 2, TileKind.Stone);
    world.setWeld(3, 2, 4, 2, true);
    expect(simulation.step()).toBe(2);
    expect(world.idAt(5, 2)).toBe(thrusterId);

    simulation.resetTo(nonMagnetic);
    expect(simulation.step()).toBe(2);
    expect(world.idAt(5, 2)).toBe(thrusterId);
  });

  it("stores orientation through snapshots and movement", () => {
    const world = new World(2, 3);
    const magnetId = world.place(0, 0, TileKind.Magnet, Direction.Right);
    const snapshot = world.clone();
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(1);
    expect(world.idAt(0, 1)).toBe(magnetId);
    expect(world.orientationAt(0, 1)).toBe(Direction.Right);
    expect(snapshot.orientationAt(0, 0)).toBe(Direction.Right);
  });

  it("rejects the magnet's facing weld and removes a weld exposed by rotation", () => {
    const world = new World(3, 3);
    const magnetId = world.place(1, 1, TileKind.Magnet, Direction.Right);
    world.place(0, 1, TileKind.Iron);
    world.place(2, 1, TileKind.Iron);
    world.place(1, 2, TileKind.Iron);

    expect(world.canWeld(1, 1, 2, 1)).toBe(false);
    expect(world.setWeld(1, 1, 2, 1, true)).toBe(false);
    expect(world.setWeld(1, 1, 0, 1, true)).toBe(true);
    expect(world.setWeld(1, 1, 1, 2, true)).toBe(true);

    expect(world.place(1, 1, TileKind.Magnet, Direction.Down)).toBe(magnetId);
    expect(world.orientationAt(1, 1)).toBe(Direction.Down);
    expect(world.isWelded(1, 1, 0, 1)).toBe(true);
    expect(world.isWelded(1, 1, 1, 2)).toBe(false);
  });

  it("holds a falling magnetic block when it reaches the pointed side", () => {
    const world = new World(3, 4);
    world.place(1, 2, TileKind.Magnet, Direction.Right);
    world.place(1, 3, TileKind.Platform);
    const metalId = world.place(2, 0, TileKind.Iron);
    const simulation = new Simulation(world);

    simulation.step();
    simulation.step();
    expect(world.idAt(2, 2)).toBe(metalId);
    expect(simulation.step()).toBe(0);
    expect(world.idAt(2, 2)).toBe(metalId);
  });

  it("lets an unsupported attracting pair fall together", () => {
    const world = new World(3, 4);
    const magnetId = world.place(1, 0, TileKind.Magnet, Direction.Right);
    const metalId = world.place(2, 0, TileKind.Iron);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(2);
    expect(world.idAt(1, 1)).toBe(magnetId);
    expect(world.idAt(2, 1)).toBe(metalId);
  });

  it("falls with an unsupported body beneath an attracting pair", () => {
    const world = new World(3, 5);
    const magnetId = world.place(1, 0, TileKind.Magnet, Direction.Down);
    const metalId = world.place(1, 1, TileKind.Iron);
    const stoneId = world.place(1, 2, TileKind.Stone);
    const simulation = new Simulation(world);

    expect(simulation.step()).toBe(3);
    expect(world.idAt(1, 1)).toBe(magnetId);
    expect(world.idAt(1, 2)).toBe(metalId);
    expect(world.idAt(1, 3)).toBe(stoneId);
  });

  it("holds a falling magnet when it reaches fixed metal", () => {
    const world = new World(3, 5);
    const magnetId = world.place(1, 0, TileKind.Magnet, Direction.Right);
    world.place(2, 2, TileKind.Iron);
    world.place(2, 3, TileKind.Platform);
    world.setWeld(2, 2, 2, 3, true);
    const simulation = new Simulation(world);

    simulation.step();
    simulation.step();
    expect(world.idAt(1, 2)).toBe(magnetId);
    expect(simulation.step()).toBe(0);
    expect(world.idAt(1, 2)).toBe(magnetId);
  });

  it("does not attract non-magnetic blocks", () => {
    const world = new World(3, 4);
    world.place(1, 2, TileKind.Magnet, Direction.Right);
    world.place(1, 3, TileKind.Platform);
    const stoneId = world.place(2, 0, TileKind.Stone);
    const simulation = new Simulation(world);

    simulation.step();
    simulation.step();
    simulation.step();
    expect(world.idAt(2, 3)).toBe(stoneId);
  });
});
