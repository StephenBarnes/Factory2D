import { describe, expect, it } from "vitest";

import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { WorldFeature } from "../src/simulation/world-features";
import { World } from "../src/simulation/world";

function featureIndices(world: World, feature: WorldFeature): number[] {
  const indices: number[] = [];
  for (
    let index = world.firstFeatureIndex(feature);
    index >= 0;
    index = world.nextFeatureIndex(feature, index)
  ) {
    indices.push(index);
  }
  return indices;
}

function reverseFeatureIndices(world: World, feature: WorldFeature): number[] {
  const indices: number[] = [];
  for (
    let index = world.lastFeatureIndex(feature);
    index >= 0;
    index = world.previousFeatureIndex(feature, index)
  ) {
    indices.push(index);
  }
  return indices;
}

describe("world feature index", () => {
  it("tracks feature presence in deterministic row-major order across placement and clearing", () => {
    const world = new World(40, 2);

    world.place(39, 0, TileKind.Sand);
    world.place(2, 0, TileKind.Platform);
    world.place(32, 0, TileKind.FixedCharge);

    expect(featureIndices(world, WorldFeature.Occupied)).toEqual([2, 32, 39]);
    expect(reverseFeatureIndices(world, WorldFeature.Occupied)).toEqual([39, 32, 2]);
    expect(featureIndices(world, WorldFeature.Gravity)).toEqual([32, 39]);
    expect(featureIndices(world, WorldFeature.Circuit)).toEqual([32]);
    expect(world.hasFeature(WorldFeature.Piston)).toBe(false);

    world.place(39, 0, TileKind.Platform);
    world.place(32, 0, TileKind.Empty);

    expect(featureIndices(world, WorldFeature.Occupied)).toEqual([2, 39]);
    expect(world.hasFeature(WorldFeature.Gravity)).toBe(false);
    expect(world.hasFeature(WorldFeature.Circuit)).toBe(false);

    world.clear();
    expect(world.hasFeature(WorldFeature.Occupied)).toBe(false);
    expect(featureIndices(world, WorldFeature.Occupied)).toEqual([]);
  });

  it("copies feature indices with cloned and reset worlds", () => {
    const source = new World(4, 3);
    source.place(3, 0, TileKind.Delivery, Direction.Left);
    source.place(0, 2, TileKind.RuneArray);

    const clone = source.clone();
    expect(featureIndices(clone, WorldFeature.Delivery)).toEqual([3]);
    expect(featureIndices(clone, WorldFeature.RuneArray)).toEqual([8]);
    expect(clone.hasFeature(WorldFeature.WeldedBodyObserver)).toBe(true);

    const target = new World(4, 3);
    target.place(1, 1, TileKind.Conveyor);
    target.copyFrom(source);

    expect(featureIndices(target, WorldFeature.Delivery)).toEqual([3]);
    expect(featureIndices(target, WorldFeature.RuneArray)).toEqual([8]);
    expect(target.hasFeature(WorldFeature.Conveyor)).toBe(false);
  });

  it("rebuilds row-major indices after body movement", () => {
    const world = new World(3, 4);
    world.place(2, 0, TileKind.Stone);
    world.place(0, 1, TileKind.Sand);

    const simulation = new Simulation(world);
    expect(simulation.step()).toBe(2);

    expect(featureIndices(world, WorldFeature.Occupied)).toEqual([5, 6]);
    expect(featureIndices(world, WorldFeature.Gravity)).toEqual([5, 6]);
  });

  it("updates piston features through extension transitions", () => {
    const world = new World(4, 1);
    const base = 1;
    world.place(base, 0, TileKind.Piston, Direction.Right);
    const actions = new Int8Array(world.cellCount);
    const headWelds = new Uint8Array(world.cellCount);
    const armIds = new Uint32Array(world.cellCount);
    const retractingBases = new Uint8Array(world.cellCount);
    actions[base] = 1;

    expect(world.applyPistonTransitions(actions, headWelds, armIds, retractingBases)).toBe(1);

    expect(featureIndices(world, WorldFeature.Piston)).toEqual([base]);
    expect(featureIndices(world, WorldFeature.Occupied)).toEqual([base, base + 1]);
    expect(world.kindAtIndex(base)).toBe(TileKind.PistonBase);
    expect(world.kindAtIndex(base + 1)).toBe(TileKind.PistonArm);
  });
});
