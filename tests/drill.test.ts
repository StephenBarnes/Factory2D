import { describe, expect, it } from "vitest";
import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("drills", () => {
  it("removes only the target and its welds, releasing the supported body before gravity", () => {
    const world = new World(4, 3);
    world.place(0, 0, TileKind.Drill, Direction.Right);
    world.place(0, 1, TileKind.Platform);
    world.place(1, 0, TileKind.Stone);
    world.place(1, 1, TileKind.Platform);
    world.place(2, 0, TileKind.Stone);
    world.setWeld(1, 0, 2, 0, true);
    const stoneId = world.idAt(2, 0);

    const simulation = new Simulation(world);
    for (let tick = 0; tick < 3; tick += 1) {
      simulation.step();
      expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
      expect(world.isWelded(1, 0, 2, 0)).toBe(true);
    }
    simulation.step();

    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
    expect(world.isWelded(1, 0, 2, 0)).toBe(false);
    expect(world.idAt(2, 1)).toBe(stoneId);
    expect(world.kindAt(0, 0)).toBe(TileKind.Drill);
  });

  it("destroys mutually facing drills simultaneously", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Drill, Direction.Right);
    world.place(1, 0, TileKind.Drill, Direction.Left);

    const simulation = new Simulation(world);
    for (let tick = 0; tick < 4; tick += 1) simulation.step();

    expect(world.kindAt(0, 0)).toBe(TileKind.Empty);
    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
  });

  it("jams competing drills and clears the claim when a drill is removed", () => {
    const world = new World(3, 1);
    world.place(0, 0, TileKind.Drill, Direction.Right);
    world.place(1, 0, TileKind.Stone);
    world.place(2, 0, TileKind.Drill, Direction.Left);
    const simulation = new Simulation(world);

    for (let tick = 0; tick < 5; tick += 1) simulation.step();
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(0);
    expect(world.chargeAtPort(2, 0, Direction.Right)).toBe(0);
    expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
    world.place(2, 0, TileKind.Empty);
    for (let tick = 0; tick < 3; tick += 1) {
      simulation.step();
      expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
    }
    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
  });

  it("preserves side-disable control on save/load and resumes from neutral", () => {
    const original = new World(1, 2);
    original.place(0, 0, TileKind.Stone);
    original.place(0, 1, TileKind.Drill, Direction.Up);
    original.setCharge(0, 1, -1);
    const { world } = deserializeBoard(serializeBoard(original, 0));
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(0, 0)).toBe(TileKind.Stone);
    for (let tick = 0; tick < 4; tick += 1) simulation.step();
    expect(world.kindAt(0, 0)).toBe(TileKind.Empty);
  });

  it("does not wrap horizontal targets across board boundaries", () => {
    const world = new World(2, 2);
    world.place(1, 0, TileKind.Drill, Direction.Right);
    world.place(1, 1, TileKind.Platform);
    world.place(0, 1, TileKind.Stone);

    const simulation = new Simulation(world);
    for (let tick = 0; tick < 5; tick += 1) simulation.step();

    expect(world.kindAt(0, 1)).toBe(TileKind.Stone);
  });

  it("starts drilling a falling block only after it reaches the front cell", () => {
    const world = new World(2, 2);
    world.place(0, 1, TileKind.Drill, Direction.Right);
    world.place(1, 0, TileKind.Stone);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Stone);
    for (let tick = 0; tick < 3; tick += 1) {
      simulation.step();
      expect(world.kindAt(1, 1)).toBe(TileKind.Stone);
    }
    simulation.step();
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
  });

  it("drills downward inside a nested rune array", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.RuneArray);
    world.configureRuneArray(0, 0, 1, 3, "");
    const inner = world.runeArrayWorldAt(0, 0);
    inner.place(0, 0, TileKind.Drill, Direction.Down);
    inner.place(0, 1, TileKind.Stone);
    inner.place(0, 2, TileKind.Platform);

    const simulation = new Simulation(world);
    for (let tick = 0; tick < 4; tick += 1) simulation.step();

    expect(inner.kindAt(0, 1)).toBe(TileKind.Drill);
    expect(inner.kindAt(0, 2)).toBe(TileKind.Platform);
  });

  it("preserves indestructible terrain and its welded body under repeated drilling", () => {
    const original = new World(3, 3);
    original.place(0, 0, TileKind.Drill, Direction.Right);
    original.place(0, 1, TileKind.Platform);
    original.place(1, 0, TileKind.Platform);
    original.place(2, 0, TileKind.Stone);
    original.setWeld(1, 0, 2, 0, true);
    const { world } = deserializeBoard(serializeBoard(original, 0));
    const platformId = world.idAt(1, 0);
    const stoneId = world.idAt(2, 0);
    const simulation = new Simulation(world);

    for (let tick = 0; tick < 5; tick += 1) simulation.step();
    expect(world.chargeAtPort(0, 0, Direction.Left)).toBe(0);

    expect(world.idAt(1, 0)).toBe(platformId);
    expect(world.kindAt(1, 0)).toBe(TileKind.Platform);
    expect(world.isWelded(1, 0, 2, 0)).toBe(true);
    expect(world.idAt(2, 0)).toBe(stoneId);

    world.place(1, 0, TileKind.Stone);
    for (let tick = 0; tick < 4; tick += 1) simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
    expect(world.idAt(2, 2)).toBe(stoneId);
  });

  it("isolates rear activity from side control and resumes saved partial progress", () => {
    const world = new World(5, 3);
    world.place(2, 0, TileKind.Stone);
    world.place(2, 1, TileKind.Drill, Direction.Up);
    world.place(1, 1, TileKind.Conduit);
    world.place(3, 1, TileKind.Conduit);
    world.place(2, 2, TileKind.Conduit);
    world.setWeld(2, 1, 1, 1, true);
    world.setWeld(2, 1, 3, 1, true);
    world.setWeld(2, 1, 2, 2, true);
    const simulation = new Simulation(world);

    world.setCharge(2, 2, -1);
    simulation.step();
    expect(world.chargeAt(2, 2)).toBe(1);
    expect(world.chargeAt(1, 1)).toBe(0);
    expect(world.chargeAt(3, 1)).toBe(0);
    simulation.step();

    for (let tick = 0; tick < 5; tick += 1) {
      world.setCharge(2, 1, -1);
      simulation.step();
      expect(world.kindAt(2, 0)).toBe(TileKind.Stone);
      expect(world.chargeAt(2, 2)).toBe(0);
    }
    const restored = deserializeBoard(serializeBoard(world, simulation.tick)).world;
    const resumed = new Simulation(restored);
    restored.setCharge(2, 1, 1);
    resumed.step();
    expect(restored.kindAt(2, 0)).toBe(TileKind.Stone);
    expect(restored.chargeAt(2, 2)).toBe(1);
    resumed.step();
    expect(restored.kindAt(2, 0)).toBe(TileKind.Empty);
    expect(restored.chargeAt(2, 2)).toBe(1);
    resumed.step();
    expect(restored.chargeAt(2, 2)).toBe(0);
  });

  it("restarts the full duration when a same-kind target is replaced while paused", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Drill, Direction.Right);
    world.place(1, 0, TileKind.Stone);
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 3; tick += 1) simulation.step();
    world.place(1, 0, TileKind.Empty);
    const replacement = world.place(1, 0, TileKind.Stone);
    world.setCharge(0, 0, -1);
    simulation.step();
    for (let tick = 0; tick < 3; tick += 1) {
      simulation.step();
      expect(world.idAt(1, 0)).toBe(replacement);
    }
    simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
  });

  it("carries progress while drill and target fall, and independently continues a clone", () => {
    const world = new World(2, 4);
    world.place(0, 0, TileKind.Drill, Direction.Right);
    const target = world.place(1, 0, TileKind.Stone);
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 3; tick += 1) simulation.step();
    expect(world.kindAt(0, 3)).toBe(TileKind.Drill);
    expect(world.idAt(1, 3)).toBe(target);

    const clone = world.clone();
    new Simulation(clone).step();
    expect(clone.kindAt(1, 3)).toBe(TileKind.Empty);
    expect(world.idAt(1, 3)).toBe(target);
    expect(clone.chargeAtPort(0, 3, Direction.Left)).toBe(1);
  });
});
