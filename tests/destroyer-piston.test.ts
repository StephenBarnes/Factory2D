import { describe, expect, it } from "vitest";

import { watchMachineryActivity } from "../src/simulation/machinery-activity";
import { PistonResolver } from "../src/simulation/piston-resolver";
import { watchShatterAnimation } from "../src/simulation/shatter-animation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function fixedExtension(world: World): void {
  world.place(1, 2, TileKind.Piston, Direction.Right);
  world.setCharge(1, 2, 1);
  world.place(1, 3, TileKind.Platform);
  world.setWeld(1, 2, 1, 3, true);
}

function rightPull(world: World, head: TileKind = TileKind.Stone): number {
  world.place(1, 2, TileKind.PistonBase, Direction.Right);
  const armId = world.place(2, 2, TileKind.PistonArm, Direction.Right);
  world.place(3, 2, head);
  world.setWeld(1, 2, 2, 2, true);
  world.setWeld(2, 2, 3, 2, true);
  world.setCharge(1, 2, -1);
  return armId;
}

describe("destroyer piston contacts", () => {
  it("destroys a pushed welded head without pushing or welding its destroyer", () => {
    const world = new World(6, 5);
    fixedExtension(world);
    world.place(2, 2, TileKind.Stone);
    world.setWeld(1, 2, 2, 2, true);
    const destroyerId = world.place(3, 2, TileKind.Destroyer);
    world.place(3, 3, TileKind.Platform);
    world.setWeld(3, 2, 3, 3, true);
    const effects = watchShatterAnimation(world);
    const sounds = watchMachineryActivity(world);

    new PistonResolver(world).resolve();

    expect(world.kindAt(1, 2)).toBe(TileKind.PistonBase);
    expect(world.kindAt(2, 2)).toBe(TileKind.PistonArm);
    expect(world.idAt(3, 2)).toBe(destroyerId);
    expect(world.isWelded(2, 2, 3, 2)).toBe(false);
    expect(world.isWelded(3, 2, 3, 3)).toBe(true);
    expect(effects.get(2 * world.width + 3)?.kind).toBe(TileKind.Stone);
    expect(sounds).toEqual([{ voice: "break", index: 2 * world.width + 3 }]);
  });

  it("pushes a destroyer through one tile of welded ground without moving the ground", () => {
    const world = new World(6, 5);
    fixedExtension(world);
    const cutterId = world.place(2, 2, TileKind.Destroyer);
    world.setWeld(1, 2, 2, 2, true);
    world.place(3, 2, TileKind.Stone);
    const groundId = world.place(3, 3, TileKind.Platform);
    world.setWeld(3, 2, 3, 3, true);

    new PistonResolver(world).resolve();

    expect(world.idAt(3, 2)).toBe(cutterId);
    expect(world.idAt(3, 3)).toBe(groundId);
    expect(world.isWelded(2, 2, 3, 2)).toBe(true);
    expect(world.isWelded(3, 2, 3, 3)).toBe(false);
  });

  it("moves welded members out of the destroyer's way rather than destroying them", () => {
    const world = new World(6, 5);
    fixedExtension(world);
    const cutterId = world.place(2, 2, TileKind.Destroyer);
    const loadId = world.place(3, 2, TileKind.Stone);
    world.setWeld(1, 2, 2, 2, true);
    world.setWeld(2, 2, 3, 2, true);
    const sounds = watchMachineryActivity(world);

    new PistonResolver(world).resolve();

    expect(world.idAt(3, 2)).toBe(cutterId);
    expect(world.idAt(4, 2)).toBe(loadId);
    expect(world.isWelded(3, 2, 4, 2)).toBe(true);
    expect(sounds).toEqual([]);
  });

  it("pushes movable indestructible targets normally", () => {
    const world = new World(6, 5);
    fixedExtension(world);
    const cutterId = world.place(2, 2, TileKind.Destroyer);
    world.setWeld(1, 2, 2, 2, true);
    const targetId = world.place(3, 2, TileKind.IndestructibleConduit);
    const sounds = watchMachineryActivity(world);

    new PistonResolver(world).resolve();

    expect(world.idAt(3, 2)).toBe(cutterId);
    expect(world.idAt(4, 2)).toBe(targetId);
    expect(sounds).toEqual([]);
  });

  it("cannot cut through a fixed indestructible target", () => {
    const world = new World(6, 5);
    fixedExtension(world);
    const cutterId = world.place(2, 2, TileKind.Destroyer);
    world.setWeld(1, 2, 2, 2, true);
    const targetId = world.place(3, 2, TileKind.Platform);
    const sounds = watchMachineryActivity(world);

    expect(new PistonResolver(world).resolve()).toBe(0);

    expect(world.kindAt(1, 2)).toBe(TileKind.Piston);
    expect(world.idAt(2, 2)).toBe(cutterId);
    expect(world.idAt(3, 2)).toBe(targetId);
    expect(sounds).toEqual([]);
  });

  it("destroys both contacting destroyers and does not restore the lost head weld", () => {
    const world = new World(6, 5);
    fixedExtension(world);
    world.place(2, 2, TileKind.Destroyer);
    world.place(3, 2, TileKind.Destroyer);
    world.setWeld(1, 2, 2, 2, true);
    const sounds = watchMachineryActivity(world);

    new PistonResolver(world).resolve();

    expect(world.kindAt(2, 2)).toBe(TileKind.PistonArm);
    expect(world.kindAt(3, 2)).toBe(TileKind.Empty);
    expect(world.isWelded(2, 2, 3, 2)).toBe(false);
    expect(sounds).toEqual([
      { voice: "break", index: 2 * world.width + 3 },
      { voice: "break", index: 2 * world.width + 3 },
    ]);
  });

  it("shatters a generated arm instead of overwriting an unwelded destroyer", () => {
    const world = new World(6, 5);
    fixedExtension(world);
    const destroyerId = world.place(2, 2, TileKind.Destroyer);
    const effects = watchShatterAnimation(world);
    const sounds = watchMachineryActivity(world);

    const resolver = new PistonResolver(world);
    resolver.resolve();

    expect(world.kindAt(1, 2)).toBe(TileKind.PistonBase);
    expect(world.idAt(2, 2)).toBe(destroyerId);
    expect(world.isWelded(1, 2, 2, 2)).toBe(false);
    expect(effects.get(2 * world.width + 2)?.kind).toBe(TileKind.PistonArm);
    expect(sounds).toEqual([{ voice: "break", index: 2 * world.width + 2 }]);
    world.setCharge(1, 2, -1);
    expect(resolver.resolve()).toBe(0);
    expect(world.kindAt(1, 2)).toBe(TileKind.PistonBase);
  });

  it("jams rival arm generation at a destroyer before either arm shatters", () => {
    const world = new World(5, 4);
    world.place(1, 2, TileKind.Piston, Direction.Right);
    world.place(3, 2, TileKind.Piston, Direction.Left);
    world.setCharge(1, 2, 1);
    world.setCharge(3, 2, 1);
    const destroyerId = world.place(2, 2, TileKind.Destroyer);
    const sounds = watchMachineryActivity(world);

    expect(new PistonResolver(world).resolve()).toBe(0);

    expect(world.kindAt(1, 2)).toBe(TileKind.Piston);
    expect(world.kindAt(3, 2)).toBe(TileKind.Piston);
    expect(world.idAt(2, 2)).toBe(destroyerId);
    expect(sounds).toEqual([]);
  });

  it("jams rival moving destroyers before either can cut their shared target", () => {
    const world = new World(5, 4);
    world.place(0, 2, TileKind.Piston, Direction.Right);
    world.place(4, 2, TileKind.Piston, Direction.Left);
    world.setCharge(0, 2, 1);
    world.setCharge(4, 2, 1);
    const firstId = world.place(1, 2, TileKind.Destroyer);
    const secondId = world.place(3, 2, TileKind.Destroyer);
    world.setWeld(0, 2, 1, 2, true);
    world.setWeld(4, 2, 3, 2, true);
    const targetId = world.place(2, 2, TileKind.Stone);
    world.place(2, 3, TileKind.Platform);
    world.setWeld(2, 2, 2, 3, true);
    const sounds = watchMachineryActivity(world);

    expect(new PistonResolver(world).resolve()).toBe(0);

    expect(world.idAt(1, 2)).toBe(firstId);
    expect(world.idAt(3, 2)).toBe(secondId);
    expect(world.idAt(2, 2)).toBe(targetId);
    expect(world.isWelded(2, 2, 2, 3)).toBe(true);
    expect(sounds).toEqual([]);
  });

  it("does not destroy a load when a different member blocks the whole stroke", () => {
    const world = new World(6, 5);
    fixedExtension(world);
    const loadId = world.place(2, 2, TileKind.Stone);
    world.place(2, 1, TileKind.Stone);
    world.setWeld(1, 2, 2, 2, true);
    world.setWeld(2, 2, 2, 1, true);
    const destroyerId = world.place(3, 2, TileKind.Destroyer);
    world.place(3, 1, TileKind.Platform);
    const sounds = watchMachineryActivity(world);

    expect(new PistonResolver(world).resolve()).toBe(0);

    expect(world.idAt(2, 2)).toBe(loadId);
    expect(world.idAt(3, 2)).toBe(destroyerId);
    expect(world.isWelded(1, 2, 2, 2)).toBe(true);
    expect(world.isWelded(2, 2, 2, 1)).toBe(true);
    expect(sounds).toEqual([]);
  });

  it("pulls the surviving load while removing a side member entering a destroyer", () => {
    const world = new World(6, 5);
    const armId = rightPull(world);
    const headId = world.idAt(3, 2);
    world.place(3, 1, TileKind.Stone);
    world.setWeld(3, 2, 3, 1, true);
    const destroyerId = world.place(2, 1, TileKind.Destroyer);

    new PistonResolver(world).resolve();

    expect(world.kindAt(1, 2)).toBe(TileKind.Piston);
    expect(world.idAt(1, 2)).toBe(armId);
    expect(world.idAt(2, 2)).toBe(headId);
    expect(world.idAt(2, 1)).toBe(destroyerId);
    expect(world.kindAt(3, 1)).toBe(TileKind.Empty);
    expect(world.isWelded(1, 2, 2, 2)).toBe(true);
    expect(world.isWelded(2, 2, 2, 1)).toBe(false);
  });

  it("pulls a destroyer through fixed welded cargo without capturing its anchor", () => {
    const world = new World(6, 5);
    rightPull(world);
    const cutterId = world.place(3, 1, TileKind.Destroyer);
    world.setWeld(3, 2, 3, 1, true);
    world.place(2, 1, TileKind.Stone);
    const anchorId = world.place(2, 0, TileKind.Platform);
    world.setWeld(2, 1, 2, 0, true);

    new PistonResolver(world).resolve();

    expect(world.idAt(2, 1)).toBe(cutterId);
    expect(world.idAt(2, 0)).toBe(anchorId);
    expect(world.kindAt(1, 2)).toBe(TileKind.Piston);
    expect(world.isWelded(1, 2, 2, 2)).toBe(true);
    expect(world.isWelded(2, 2, 2, 1)).toBe(true);
    expect(world.isWelded(2, 1, 2, 0)).toBe(false);
  });

  it("pulls a destroyer through the retiring arm without treating retraction as destruction", () => {
    const world = new World(6, 5);
    const armId = rightPull(world, TileKind.Destroyer);
    const headId = world.idAt(3, 2);
    const sounds = watchMachineryActivity(world);

    new PistonResolver(world).resolve();

    expect(world.idAt(1, 2)).toBe(armId);
    expect(world.kindAt(1, 2)).toBe(TileKind.Piston);
    expect(world.idAt(2, 2)).toBe(headId);
    expect(world.isWelded(1, 2, 2, 2)).toBe(true);
    expect(sounds).toEqual([]);
  });

  it("recoils into a destroyer without recreating the destroyed active base or arm", () => {
    const world = new World(6, 5);
    world.place(2, 2, TileKind.Piston, Direction.Right);
    world.setCharge(2, 2, 1);
    world.place(3, 2, TileKind.Platform);
    const destroyerId = world.place(1, 2, TileKind.Destroyer);
    const cargoId = world.place(2, 1, TileKind.Stone);
    world.setWeld(2, 2, 2, 1, true);

    new PistonResolver(world).resolve();

    expect(world.idAt(1, 2)).toBe(destroyerId);
    expect(world.idAt(1, 1)).toBe(cargoId);
    expect(world.kindAt(2, 2)).toBe(TileKind.Empty);
    expect(world.isWelded(1, 1, 1, 2)).toBe(false);
  });

  it("lowers a retracting base while destroying only contacted side cargo", () => {
    const world = new World(6, 5);
    world.place(2, 1, TileKind.PistonBase, Direction.Down);
    const armId = world.place(2, 2, TileKind.PistonArm, Direction.Down);
    world.setWeld(2, 1, 2, 2, true);
    world.setCharge(2, 1, -1);
    world.place(3, 1, TileKind.Stone);
    world.setWeld(2, 1, 3, 1, true);
    const destroyerId = world.place(3, 2, TileKind.Destroyer);

    new PistonResolver(world).resolve();

    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
    expect(world.kindAt(2, 2)).toBe(TileKind.Piston);
    expect(world.idAt(2, 2)).toBe(armId);
    expect(world.idAt(3, 2)).toBe(destroyerId);
    expect(world.kindAt(3, 1)).toBe(TileKind.Empty);
    expect(world.isWelded(2, 2, 3, 2)).toBe(false);
  });

  it.each(["base", "arm"] as const)("can destroy a carried piston %s without moving its destroyer", (part) => {
    const world = new World(6, 5);
    world.place(1, 3, TileKind.Piston, Direction.Right);
    world.setCharge(1, 3, 1);
    const loadId = world.place(2, 3, TileKind.Stone);
    const baseId = world.place(2, 2, TileKind.PistonBase, Direction.Up);
    const armId = world.place(2, 1, TileKind.PistonArm, Direction.Up);
    world.setWeld(1, 3, 2, 3, true);
    world.setWeld(2, 3, 2, 2, true);
    world.setWeld(2, 2, 2, 1, true);
    const targetY = part === "base" ? 2 : 1;
    const destroyerId = world.place(3, targetY, TileKind.Destroyer);

    new PistonResolver(world).resolve();

    expect(world.idAt(3, 3)).toBe(loadId);
    expect(world.idAt(3, targetY)).toBe(destroyerId);
    expect(world.idAt(3, part === "base" ? 1 : 2)).toBe(part === "base" ? armId : baseId);
    expect(world.isWelded(3, 1, 3, 2)).toBe(false);
    expect(world.isWelded(3, 2, 3, 3)).toBe(part === "arm");
  });

  it("does not shatter a carried fastener twice when contact already destroyed it", () => {
    const world = new World(6, 5);
    fixedExtension(world);
    world.place(2, 2, TileKind.Fastener);
    world.setWeld(1, 2, 2, 2, true);
    const destroyerId = world.place(3, 2, TileKind.Destroyer);
    const sounds = watchMachineryActivity(world);

    new PistonResolver(world).resolve();

    expect(world.kindAt(2, 2)).toBe(TileKind.PistonArm);
    expect(world.idAt(3, 2)).toBe(destroyerId);
    expect(world.isWelded(2, 2, 3, 2)).toBe(false);
    expect(sounds).toEqual([{ voice: "snap", index: 2 * world.width + 3 }]);
  });
});
