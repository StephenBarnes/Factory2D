import { describe, expect, it } from "vitest";
import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { watchMachineryActivity } from "../src/simulation/machinery-activity";
import { watchShatterAnimation } from "../src/simulation/shatter-animation";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function anchoredSaw(world: World, x: number, y: number): number {
  const id = world.place(x, y, TileKind.Destroyer);
  world.place(x, y + 1, TileKind.Platform);
  world.setWeld(x, y, x, y + 1, true);
  return id;
}

function slab(world: World, left: number, top: number, width: number, height: number): void {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      world.place(x, y, TileKind.Stone);
      if (x > left) world.setWeld(x - 1, y, x, y, true);
      if (y > top) world.setWeld(x, y - 1, x, y, true);
    }
  }
}

describe("destroyer translation", () => {
  it("cuts a falling 5x5 body into two independently welded halves", () => {
    const world = new World(9, 10);
    slab(world, 2, 0, 5, 5);
    const left = world.idAt(2, 0);
    const right = world.idAt(6, 0);
    const saw = anchoredSaw(world, 4, 5);
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 5; tick += 1) simulation.step();
    expect(world.idAt(2, 5)).toBe(left);
    expect(world.idAt(6, 5)).toBe(right);
    expect(world.idAt(4, 5)).toBe(saw);
    for (let y = 5; y < 10; y += 1) {
      expect(world.kindAt(3, y)).toBe(TileKind.Stone);
      expect(world.kindAt(5, y)).toBe(TileKind.Stone);
      expect(world.hasRightWeldAtIndex(y * world.width + 3)).toBe(false);
      expect(world.hasRightWeldAtIndex(y * world.width + 4)).toBe(false);
      if (y > 6) expect(world.kindAt(4, y)).toBe(TileKind.Empty);
    }
    expect(world.isWelded(2, 5, 2, 6)).toBe(true);
    expect(world.isWelded(5, 5, 6, 5)).toBe(true);
  });

  it("cuts a body carried sideways by a conveyor in the movement tick", () => {
    const world = new World(9, 9);
    slab(world, 0, 1, 5, 5);
    for (let x = 0; x < 9; x += 1) world.place(x, 6, TileKind.Platform);
    world.place(2, 6, TileKind.Conveyor);
    world.place(2, 7, TileKind.FixedCharge);
    world.place(2, 8, TileKind.Platform);
    world.setWeld(2, 6, 2, 7, true);
    world.setWeld(2, 7, 2, 8, true);
    const saw = world.place(5, 3, TileKind.Destroyer);
    world.place(6, 3, TileKind.Platform);
    world.setWeld(5, 3, 6, 3, true);
    const upper = world.idAt(4, 2);
    const lower = world.idAt(4, 4);
    new Simulation(world).step();
    expect(world.idAt(5, 2)).toBe(upper);
    expect(world.idAt(5, 4)).toBe(lower);
    expect(world.idAt(5, 3)).toBe(saw);
    expect(world.isWelded(5, 2, 5, 3)).toBe(false);
    expect(world.isWelded(5, 3, 5, 4)).toBe(false);
  });

  it("lets a loose saw fall through welded ground, but not indestructible terrain", () => {
    const world = new World(4, 5);
    const saw = world.place(1, 0, TileKind.Destroyer);
    for (let y = 1; y < 4; y += 1) {
      world.place(1, y, TileKind.Stone);
      world.place(2, y, TileKind.Platform);
      world.setWeld(1, y, 2, y, true);
    }
    world.place(1, 4, TileKind.Platform);
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 4; tick += 1) simulation.step();
    expect(world.idAt(1, 3)).toBe(saw);
    expect(world.kindAt(1, 4)).toBe(TileKind.Platform);
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(1, 2)).toBe(TileKind.Empty);
    expect(world.isWelded(1, 3, 2, 3)).toBe(false);
  });

  it("destroys both saws and removes the stationary saw's anchoring weld", () => {
    const world = new World(3, 4);
    world.place(1, 0, TileKind.Destroyer);
    anchoredSaw(world, 1, 1);
    new Simulation(world).step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
    expect(world.kindAt(1, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(1, 2)).toBe(TileKind.Platform);
    expect(world.isWelded(1, 1, 1, 2)).toBe(false);
  });

  it("does not cut when another part of the falling body is blocked", () => {
    const world = new World(4, 4);
    slab(world, 0, 0, 2, 1);
    anchoredSaw(world, 0, 1);
    world.place(1, 1, TileKind.Platform);
    const events = watchMachineryActivity(world);
    new Simulation(world).step();
    expect(world.kindAt(0, 0)).toBe(TileKind.Stone);
    expect(world.kindAt(1, 0)).toBe(TileKind.Stone);
    expect(events).toEqual([]);
  });

  it("keeps moving indestructible channels solid against a saw", () => {
    const world = new World(3, 4);
    const channel = world.place(1, 0, TileKind.IndestructibleConduit);
    const saw = anchoredSaw(world, 1, 1);
    new Simulation(world).step();
    expect(world.idAt(1, 0)).toBe(channel);
    expect(world.idAt(1, 1)).toBe(saw);
  });

  it("does not cut co-moving welded tiles or a tile falling away ahead", () => {
    const world = new World(4, 5);
    const saw = world.place(1, 0, TileKind.Destroyer);
    const stone = world.place(1, 1, TileKind.Stone);
    world.setWeld(1, 0, 1, 1, true);
    const loose = world.place(1, 2, TileKind.Stone);
    new Simulation(world).step();
    expect(world.idAt(1, 1)).toBe(saw);
    expect(world.idAt(1, 2)).toBe(stone);
    expect(world.idAt(1, 3)).toBe(loose);
    expect(world.isWelded(1, 1, 1, 2)).toBe(true);
  });

  it("jams opposing cutters whose carried drives also claim their destinations", () => {
    const world = new World(4, 3);
    const left = world.place(0, 1, TileKind.Thruster, Direction.Right);
    world.place(1, 1, TileKind.Destroyer);
    world.place(2, 1, TileKind.Destroyer);
    const right = world.place(3, 1, TileKind.Thruster, Direction.Left);
    world.setWeld(0, 1, 1, 1, true);
    world.setWeld(2, 1, 3, 1, true);
    new Simulation(world).step();
    expect(world.idAt(0, 1)).toBe(left);
    expect(world.idAt(3, 1)).toBe(right);
    expect(world.kindAt(1, 1)).toBe(TileKind.Destroyer);
    expect(world.kindAt(2, 1)).toBe(TileKind.Destroyer);
    expect(world.isWelded(0, 1, 1, 1)).toBe(true);
    expect(world.isWelded(2, 1, 3, 1)).toBe(true);
  });

  it("resolves accepted opposing destroyer edge crossings atomically", () => {
    const world = new World(2, 1);
    world.place(0, 0, TileKind.Destroyer);
    world.place(1, 0, TileKind.Destroyer);
    world.moveBodies(new Int32Array([0, 1]), new Int8Array([1, -1]), new Int8Array(2));
    expect(world.kindAt(0, 0)).toBe(TileKind.Empty);
    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
  });

  it("jams rival destination claims without destroying their stationary target", () => {
    const world = new World(5, 4);
    world.place(0, 1, TileKind.Thruster, Direction.Right);
    world.place(1, 1, TileKind.Destroyer);
    world.place(3, 1, TileKind.Destroyer);
    world.place(4, 1, TileKind.Thruster, Direction.Left);
    world.setWeld(0, 1, 1, 1, true);
    world.setWeld(3, 1, 4, 1, true);
    const target = world.place(2, 1, TileKind.Stone);
    world.place(2, 2, TileKind.Platform);
    world.setWeld(2, 1, 2, 2, true);
    const events = watchMachineryActivity(world);
    new Simulation(world).step();
    expect(world.idAt(2, 1)).toBe(target);
    expect(world.kindAt(1, 1)).toBe(TileKind.Destroyer);
    expect(world.kindAt(3, 1)).toBe(TileKind.Destroyer);
    expect(events).toEqual([]);
  });

  it("reports the destroyed material and contact site to fracture and sound observers", () => {
    const world = new World(3, 4);
    world.place(1, 0, TileKind.Glass);
    anchoredSaw(world, 1, 1);
    const fractures = watchShatterAnimation(world);
    const events = watchMachineryActivity(world);
    new Simulation(world).step();
    expect(fractures.get(4)?.kind).toBe(TileKind.Glass);
    expect(events).toEqual([{ voice: "shatter", index: 4 }]);
    expect(world.kindAt(1, 0)).toBe(TileKind.Empty);
  });

  it("cuts using the same rules inside a serialized nested array", () => {
    const original = new World(1, 1);
    original.place(0, 0, TileKind.RuneArray);
    const inner = original.runeArrayWorldAt(0, 0);
    inner.place(2, 1, TileKind.Stone);
    anchoredSaw(inner, 2, 2);
    const world = deserializeBoard(serializeBoard(original, 0)).world;
    new Simulation(world).step();
    expect(world.runeArrayWorldAt(0, 0).kindAt(2, 1)).toBe(TileKind.Empty);
    expect(world.runeArrayWorldAt(0, 0).kindAt(2, 2)).toBe(TileKind.Destroyer);
  });

  it("cuts with a powered destroyer instead of pushing the target's welded body", () => {
    const world = new World(6, 4);
    world.place(0, 1, TileKind.Thruster, Direction.Right);
    const saw = world.place(1, 1, TileKind.Destroyer);
    world.setWeld(0, 1, 1, 1, true);
    world.place(2, 1, TileKind.Counter);
    world.place(2, 2, TileKind.Platform);
    world.setWeld(2, 1, 2, 2, true);
    new Simulation(world).step();
    expect(world.idAt(2, 1)).toBe(saw);
    expect(world.isWelded(2, 1, 2, 2)).toBe(false);
    expect(world.isWelded(1, 1, 2, 1)).toBe(true);
    expect(deserializeBoard(serializeBoard(world, 1)).world.kindAt(2, 1)).toBe(TileKind.Destroyer);
  });
});
