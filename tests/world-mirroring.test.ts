import { describe, expect, it } from "vitest";
import { MAX_ASSEMBLER_OUTPUTS } from "../src/simulation/configurable-components";
import { Direction, orientedDirection, orientedSides, TileKind, WeldSide } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

function emit(world: World, assembler: number, target: number): void {
  const emitTargets = new Int32Array(world.cellCount).fill(-1);
  emitTargets[assembler] = target;
  const queueLength = world.cellCount * MAX_ASSEMBLER_OUTPUTS;
  world.applyAssemblerResults(
    new Int32Array(world.cellCount).fill(-1),
    new Int32Array(world.cellCount).fill(-1),
    new Uint8Array(world.cellCount),
    new Uint8Array(queueLength),
    new Uint8Array(queueLength),
    new Uint8Array(queueLength),
    emitTargets,
  );
}

describe("world handedness", () => {
  it("reflects local directions and masks before orientation rotation", () => {
    expect(orientedDirection(Direction.Left, Direction.Right, true)).toBe(Direction.Down);
    expect(orientedDirection(Direction.Left, Direction.Right)).toBe(Direction.Up);
    expect(orientedSides(WeldSide.Left | WeldSide.Up, Direction.Right, true))
      .toBe(WeldSide.Down | WeldSide.Right);
  });

  it("updates geometry without replacing identity and clears handedness on replacement", () => {
    const world = new World(1, 1);
    const id = world.place(0, 0, TileKind.Selector);
    const revision = world.geometryRevision;
    expect(world.place(0, 0, TileKind.Selector, Direction.Up, true)).toBe(id);
    expect(world.mirroredAtIndex(0)).toBe(true);
    expect(world.geometryRevision).toBeGreaterThan(revision);
    const mirroredRevision = world.geometryRevision;
    world.place(0, 0, TileKind.Selector, Direction.Up, true);
    expect(world.geometryRevision).toBe(mirroredRevision);
    world.place(0, 0, TileKind.Iron, Direction.Up, true);
    expect(world.mirroredAt(0, 0)).toBe(false);
    world.place(0, 0, TileKind.Selector, Direction.Up, true);
    world.place(0, 0, TileKind.Empty);
    expect(world.mirroredAt(0, 0)).toBe(false);
    world.place(0, 0, TileKind.Selector, Direction.Up, true);
    world.clear();
    expect(world.mirroredAt(0, 0)).toBe(false);
  });

  it("moves an existing rotator's grip with a handedness edit", () => {
    const world = new World(1, 1);
    const id = world.place(0, 0, TileKind.Rotator, Direction.Right);
    world.restoreComponentState(0, 0, { type: "rotator", direction: Direction.Up });
    world.place(0, 0, TileKind.Rotator, Direction.Down, true);
    expect(world.idAt(0, 0)).toBe(id);
    expect(world.componentStateSnapshotAt(0, 0)).toEqual({
      type: "rotator", direction: Direction.Left,
    });
  });

  it("exposes mirrored input and output ports to neighboring circuits", () => {
    const world = new World(3, 3);
    world.place(1, 1, TileKind.Lut, Direction.Up, true);
    world.place(0, 1, TileKind.Conduit);
    world.place(2, 1, TileKind.Conduit);
    expect(world.setWeld(0, 1, 1, 1, true)).toBe(true);
    expect(world.setWeld(1, 1, 2, 1, true)).toBe(true);
    world.setCharge(1, 1, -1);
    expect(world.hasCircuitConnectionAtIndex(4, Direction.Left)).toBe(true);
    expect(world.chargeAtPort(1, 1, Direction.Left)).toBe(-1);
    expect(world.chargeAtPort(1, 1, Direction.Right)).toBe(0);
    const rotated = world.transformed(1, false, false);
    expect(rotated.chargeAtPort(1, 1, Direction.Up)).toBe(-1);
    expect(rotated.chargeAtPort(1, 1, Direction.Down)).toBe(0);
  });

  it("preserves handedness through movement, rotation, cloning and centered resize", () => {
    const world = new World(5, 5);
    const id = world.place(1, 1, TileKind.Selector, Direction.Left, true);
    const baseline = world.clone();
    const roots = Int32Array.from({ length: world.cellCount }, (_, index) => index);
    const horizontal = new Int8Array(world.cellCount);
    horizontal[6] = 1;
    world.moveBodies(roots, horizontal, new Int8Array(world.cellCount));
    expect(world.mirroredAt(1, 1)).toBe(false);
    expect(world.idAt(2, 1)).toBe(id);
    expect(world.mirroredAt(2, 1)).toBe(true);
    const selected = new Uint8Array(world.cellCount);
    selected[7] = 1;
    world.rotateCells(selected, 12, 1);
    expect(world.idAt(3, 2)).toBe(id);
    expect(world.orientationAt(3, 2)).toBe(Direction.Up);
    expect(world.mirroredAt(3, 2)).toBe(true);
    expect(world.mirroredAt(2, 1)).toBe(false);
    const resized = new World(7, 7);
    resized.copyCenteredFrom(world);
    expect(resized.mirroredAt(4, 3)).toBe(true);
    world.copyFrom(baseline);
    expect(world.mirroredAt(1, 1)).toBe(true);
    expect(world.idAt(1, 1)).toBe(id);
    expect(world.mirroredAt(3, 2)).toBe(false);
  });

  it.each([
    TileKind.Selector, TileKind.Rom, TileKind.Lut,
    TileKind.Assembler, TileKind.LaserSplitter, TileKind.Rotator,
  ])("composes reflection parity and rotations for kind %s", (kind) => {
    const world = new World(1, 1);
    world.place(0, 0, kind, Direction.Right, true);
    const reflected = world.transformed(0, true, false);
    expect(reflected.mirroredAt(0, 0)).toBe(false);
    expect(reflected.orientationAt(0, 0)).toBe(Direction.Left);
    expect(reflected.transformed(0, true, false).mirroredAt(0, 0)).toBe(true);
    const both = world.transformed(1, true, true);
    expect(both.mirroredAt(0, 0)).toBe(true);
    expect(both.orientationAt(0, 0)).toBe(Direction.Up);
    expect(world.transformed(1, false, false).mirroredAt(0, 0)).toBe(true);
  });

  it("reflects nested boards and pending products, keeping cloned queues independent", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.RuneArray);
    const inner = world.runeArrayWorldAt(0, 0);
    inner.place(1, 1, TileKind.Assembler, Direction.Up, true);
    inner.restoreComponentState(1, 1, {
      type: "assembler",
      pending: [
        { kind: TileKind.Selector, orientation: Direction.Right, mirrored: true },
        { kind: TileKind.Lut, orientation: Direction.Up },
      ],
    });
    const reflected = world.transformed(0, true, false);
    const reflectedInner = reflected.runeArrayWorldAt(0, 0);
    const assemblerX = inner.width - 2;
    expect(reflected.mirroredAt(0, 0)).toBe(false);
    expect(reflectedInner.mirroredAt(assemblerX, 1)).toBe(false);
    expect(reflectedInner.componentStateSnapshotAt(assemblerX, 1)).toEqual({
      type: "assembler",
      pending: [
        { kind: TileKind.Selector, orientation: Direction.Left },
        { kind: TileKind.Lut, orientation: Direction.Up, mirrored: true },
      ],
    });
    const clone = reflected.clone();
    const clonedInner = clone.runeArrayWorldAt(0, 0);
    const assembler = clonedInner.width + assemblerX;
    emit(clonedInner, assembler, 0);
    emit(clonedInner, assembler, 1);
    expect(clonedInner.kindAt(0, 0)).toBe(TileKind.Selector);
    expect(clonedInner.orientationAt(0, 0)).toBe(Direction.Left);
    expect(clonedInner.mirroredAt(0, 0)).toBe(false);
    expect(clonedInner.kindAt(1, 0)).toBe(TileKind.Lut);
    expect(clonedInner.mirroredAt(1, 0)).toBe(true);
    expect(clonedInner.assemblerPendingCountAtIndex(assembler)).toBe(0);
    expect(reflectedInner.assemblerPendingCountAtIndex(assembler)).toBe(2);
    expect(inner.mirroredAt(1, 1)).toBe(true);
  });

  it("duplicates handedness and queued products with fresh identities", () => {
    const world = new World(3, 5);
    world.place(1, 2, TileKind.Duplicator, Direction.Up);
    const id = world.place(1, 3, TileKind.Assembler, Direction.Right, true);
    world.restoreComponentState(1, 3, {
      type: "assembler",
      pending: [{ kind: TileKind.Rom, orientation: Direction.Up }],
    });
    const sources = new Int32Array(world.cellCount).fill(-1);
    const owners = new Int32Array(world.cellCount).fill(-1);
    sources[4] = 10;
    owners[4] = 7;
    world.applyDuplications(sources, owners);
    expect(world.idAt(1, 1)).not.toBe(id);
    expect(world.orientationAt(1, 1)).toBe(Direction.Right);
    expect(world.mirroredAt(1, 1)).toBe(false);
    emit(world, 4, 0);
    expect(world.kindAt(0, 0)).toBe(TileKind.Rom);
    expect(world.orientationAt(0, 0)).toBe(Direction.Down);
    expect(world.mirroredAt(0, 0)).toBe(true);
    expect(world.assemblerPendingCountAtIndex(10)).toBe(1);
    expect(world.mirroredAt(1, 3)).toBe(true);
  });

  it("normalizes symmetric queued outputs and rejects invalid handedness", () => {
    const world = new World(2, 2);
    world.place(0, 0, TileKind.Assembler);
    world.restoreComponentState(0, 0, {
      type: "assembler",
      pending: [{ kind: TileKind.Iron, orientation: Direction.Up, mirrored: true }],
    });
    emit(world, 0, 1);
    expect(world.kindAt(1, 0)).toBe(TileKind.Iron);
    expect(world.mirroredAt(1, 0)).toBe(false);
    expect(() => world.restoreComponentState(0, 0, {
      type: "assembler",
      pending: [{ kind: TileKind.Rom, orientation: Direction.Up, mirrored: 1 as unknown as boolean }],
    })).toThrow(RangeError);
  });
});
