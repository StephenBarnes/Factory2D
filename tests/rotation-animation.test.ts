import { describe, expect, it } from "vitest";
import { rotationAnimationFor } from "../src/simulation/rotation-animation";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function placePoweredRotator(world: World, x = 3, y = 3): void {
  world.place(x, y, TileKind.Rotator, Direction.Up);
  world.place(x, y + 1, TileKind.FixedCharge);
  world.place(x, y + 2, TileKind.Platform);
  world.setWeld(x, y, x, y + 1, true);
  world.setWeld(x, y + 1, x, y + 2, true);
}

function rotatingWorld(): { world: World; targetId: number; simulation: Simulation } {
  const world = new World(7, 7);
  placePoweredRotator(world);
  world.place(4, 4, TileKind.Platform);
  const targetId = world.place(3, 2, TileKind.Stone);
  return { world, targetId, simulation: new Simulation(world) };
}

const turn = { pivotX: 3, pivotY: 3, quarterTurn: 1, sourceX: 3, sourceY: 2 };

describe("rotation animation records", () => {
  it("records the accepted turn from the position after ordinary movement", () => {
    const { world, simulation } = rotatingWorld();
    world.place(3, 2, TileKind.Empty);
    const targetId = world.place(3, 1, TileKind.Stone);
    const previous = world.clone();

    simulation.step(previous);

    expect(world.idAt(4, 3)).toBe(targetId);
    expect(previous.idAt(3, 1)).toBe(targetId);
    expect(rotationAnimationFor(world, previous)?.get(targetId)).toEqual(turn);
    expect(rotationAnimationFor(world, previous.clone())).toBeNull();
    expect(rotationAnimationFor(world, null)).toBeNull();
  });

  it("includes swept and enclosed loose contents in an accepted container turn", () => {
    const world = new World(9, 9);
    placePoweredRotator(world, 2, 4);
    const sources = new Map<number, { x: number; y: number }>();
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) {
        const id = world.place(x, y, x === 2 && y === 2 ? TileKind.Iron : TileKind.Stone);
        sources.set(id, { x, y });
      }
    }
    for (let offset = 1; offset < 3; offset += 1) {
      world.setWeld(offset, 1, offset + 1, 1, true);
      world.setWeld(offset, 3, offset + 1, 3, true);
      world.setWeld(1, offset, 1, offset + 1, true);
      world.setWeld(3, offset, 3, offset + 1, true);
    }
    const sweptId = world.place(4, 2, TileKind.Stone);
    const previous = world.clone();

    new Simulation(world).step(previous);

    const records = rotationAnimationFor(world, previous);
    for (const [id, source] of sources) {
      expect(records?.get(id)).toEqual({
        pivotX: 2, pivotY: 4, quarterTurn: 1, sourceX: source.x, sourceY: source.y,
      });
      expect(world.idAt(6 - source.y, source.x + 2)).toBe(id);
    }
    expect(records?.get(sweptId)).toEqual({
      pivotX: 2, pivotY: 4, quarterTurn: 1, sourceX: 4, sourceY: 3,
    });
    expect(world.idAt(3, 6)).toBe(sweptId);
  });

  it("does not expose a blocked or mutually jammed turn", () => {
    const { world, targetId, simulation } = rotatingWorld();
    world.place(4, 3, TileKind.Platform);
    const previous = world.clone();
    simulation.step(previous);
    expect(world.idAt(3, 2)).toBe(targetId);
    expect(rotationAnimationFor(world, previous)).toBeNull();

    const jammed = new World(8, 7);
    placePoweredRotator(jammed, 2, 3);
    jammed.place(4, 3, TileKind.Rotator, Direction.Up);
    jammed.place(4, 4, TileKind.Inverter, Direction.Up);
    jammed.place(4, 5, TileKind.FixedCharge);
    jammed.place(4, 6, TileKind.Platform);
    jammed.setWeld(4, 3, 4, 4, true);
    jammed.setWeld(4, 4, 4, 5, true);
    jammed.setWeld(4, 5, 4, 6, true);
    jammed.setCharge(4, 5, 1);
    const leftId = jammed.place(2, 2, TileKind.Stone);
    const rightId = jammed.place(4, 2, TileKind.Stone);
    const priorJam = jammed.clone();
    new Simulation(jammed).step(priorJam);
    expect(jammed.chargeAt(2, 3)).toBe(1);
    expect(jammed.chargeAt(4, 3)).toBe(-1);
    expect(jammed.idAt(2, 2)).toBe(leftId);
    expect(jammed.idAt(4, 2)).toBe(rightId);
    expect(rotationAnimationFor(jammed, priorJam)).toBeNull();
  });

  it("expires on the next tick even when no new turn is accepted", () => {
    const { world, simulation, targetId } = rotatingWorld();
    const previous = world.clone();
    simulation.step(previous);
    expect(rotationAnimationFor(world, previous)?.get(targetId)).toEqual(turn);
    previous.copyFrom(world);
    simulation.step(previous);
    expect(world.idAt(4, 3)).toBe(targetId);
    expect(rotationAnimationFor(world, previous)).toBeNull();
  });

  it("does not retain captures across disabled interpolation, edits, or reset", () => {
    const { world, simulation, targetId } = rotatingWorld();
    const baseline = world.clone();
    const previous = world.clone();
    simulation.step(previous);
    expect(rotationAnimationFor(world, previous)?.get(targetId)).toEqual(turn);
    previous.place(0, 0, TileKind.Platform);
    expect(rotationAnimationFor(world, previous)).toBeNull();

    simulation.resetTo(baseline);
    previous.copyFrom(world);
    simulation.step(previous);
    expect(rotationAnimationFor(world, previous)?.get(targetId)).toEqual(turn);
    world.place(0, 0, TileKind.Platform);
    expect(rotationAnimationFor(world, previous)).toBeNull();

    simulation.resetTo(baseline);
    previous.copyFrom(world);
    simulation.step(previous);
    expect(rotationAnimationFor(world, previous)?.get(targetId)).toEqual(turn);
    simulation.resetTo(baseline);
    expect(rotationAnimationFor(world, previous)).toBeNull();
    simulation.step();
    expect(world.idAt(4, 3)).toBe(targetId);
    expect(rotationAnimationFor(world, previous)).toBeNull();
  });

  it("seals against the prior snapshot after production updates it", () => {
    const world = new World(11, 7);
    placePoweredRotator(world);
    const targetId = world.place(3, 2, TileKind.Stone);
    world.place(8, 1, TileKind.Duplicator, Direction.Down);
    world.setCharge(8, 1, 1);
    world.place(7, 1, TileKind.Platform);
    world.setWeld(7, 1, 8, 1, true);
    world.place(8, 0, TileKind.Stone);
    const previous = world.clone();

    new Simulation(world).step(previous);

    expect(previous.kindAt(8, 2)).toBe(TileKind.Stone);
    expect(world.idAt(4, 3)).toBe(targetId);
    expect(rotationAnimationFor(world, previous)?.get(targetId)).toEqual(turn);
  });

  it.each([false, true])("matches an inner snapshot before its containing array moves: %s", (moving) => {
    const world = new World(3, 3);
    const arrayId = world.place(1, 0, TileKind.RuneArray);
    if (!moving) world.place(1, 1, TileKind.Platform);
    world.configureRuneArray(1, 0, 7, 7, "");
    const inner = world.runeArrayWorldAt(1, 0);
    const fixture = rotatingWorld();
    inner.copyFrom(fixture.world);
    const previous = world.clone();
    const previousInner = previous.runeArrayWorldAt(1, 0);
    const simulation = new Simulation(world);

    simulation.step(previous);

    expect(world.idAt(1, moving ? 1 : 0)).toBe(arrayId);
    expect(world.runeArrayWorldAt(1, moving ? 1 : 0)).toBe(inner);
    expect(inner.idAt(4, 3)).toBe(fixture.targetId);
    expect(rotationAnimationFor(inner, previousInner)?.get(fixture.targetId)).toEqual(turn);
    simulation.step();
    expect(rotationAnimationFor(inner, previousInner)).toBeNull();
  });

  it.each(["identity", "dimensions"] as const)("rejects an inner snapshot with mismatched %s", (mismatch) => {
    const world = new World(3, 3);
    world.place(1, 0, TileKind.RuneArray);
    world.configureRuneArray(1, 0, 7, 7, "");
    const previous = world.clone();
    const previousInner = previous.runeArrayWorldAt(1, 0);
    if (mismatch === "identity") {
      world.place(1, 0, TileKind.Empty);
      world.place(1, 0, TileKind.RuneArray);
      world.configureRuneArray(1, 0, 7, 7, "");
    } else {
      previous.configureRuneArray(1, 0, 5, 5, "");
    }
    const inner = world.runeArrayWorldAt(1, 0);
    const fixture = rotatingWorld();
    inner.copyFrom(fixture.world);

    new Simulation(world).step(previous);

    expect(inner.idAt(4, 3)).toBe(fixture.targetId);
    expect(rotationAnimationFor(inner, previousInner)).toBeNull();
    expect(rotationAnimationFor(inner, previous.runeArrayWorldAt(1, 0))).toBeNull();
  });
});
