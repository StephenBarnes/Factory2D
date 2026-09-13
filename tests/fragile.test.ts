import { describe, expect, it } from "vitest";

import { TileSelectionState } from "../src/game/tile-selection";
import { deserializeBoard, serializeBoard } from "../src/simulation/board-export";
import { Simulation } from "../src/simulation/simulation";
import { Direction, TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("fragile glass", () => {
  it("survives resting and one-cell drops but breaks on the landing tick after a longer drop", () => {
    const world = new World(3, 4);
    const restingId = world.place(0, 3, TileKind.Glass);
    const shortDropId = world.place(1, 0, TileKind.Glass);
    const longDropId = world.place(2, 0, TileKind.Glass);
    world.place(1, 2, TileKind.Platform);
    world.place(2, 3, TileKind.Platform);
    const simulation = new Simulation(world);

    simulation.step();
    expect(world.idAt(1, 1)).toBe(shortDropId);
    expect(world.idAt(2, 1)).toBe(longDropId);
    simulation.step();
    expect(world.idAt(1, 1)).toBe(shortDropId);
    expect(world.idAt(2, 2)).toBe(longDropId);
    simulation.step();
    expect(world.kindAt(2, 2)).toBe(TileKind.Empty);
    simulation.step();
    expect(world.idAt(0, 3)).toBe(restingId);
    expect(world.idAt(1, 1)).toBe(shortDropId);
  });

  it("does not accumulate distance across separate safe drops", () => {
    const world = new World(1, 4);
    const glassId = world.place(0, 0, TileKind.Glass);
    world.place(0, 2, TileKind.Platform);
    const simulation = new Simulation(world);

    simulation.step();
    simulation.step();
    expect(world.idAt(0, 1)).toBe(glassId);
    world.place(0, 2, TileKind.Empty);
    world.place(0, 3, TileKind.Platform);
    simulation.step();
    simulation.step();
    expect(world.idAt(0, 2)).toBe(glassId);
    world.place(0, 3, TileKind.Empty);
    simulation.step();
    simulation.step();
    expect(world.idAt(0, 3)).toBe(glassId);
  });

  it("clears a long fall when welded in midair and starts a fresh drop after unwelding", () => {
    const world = new World(2, 7);
    const glassId = world.place(0, 0, TileKind.Glass);
    world.place(0, 6, TileKind.Platform);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    world.place(1, 2, TileKind.Stone);
    expect(world.setWeld(0, 2, 1, 2, true)).toBe(true);

    simulation.step();
    simulation.step();
    expect(world.idAt(0, 4)).toBe(glassId);
    expect(world.isWelded(0, 4, 1, 4)).toBe(true);
    world.setWeld(0, 4, 1, 4, false);
    simulation.step();
    simulation.step();
    expect(world.idAt(0, 5)).toBe(glassId);
    world.place(0, 6, TileKind.Empty);
    simulation.step();
    simulation.step();
    expect(world.idAt(0, 6)).toBe(glassId);
  });

  it("survives being welded only at landing without retaining the earlier long fall", () => {
    const world = new World(2, 4);
    const glassId = world.place(0, 0, TileKind.Glass);
    world.place(0, 3, TileKind.Platform);
    world.place(1, 2, TileKind.Platform);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    expect(world.setWeld(0, 2, 1, 2, true)).toBe(true);

    simulation.step();
    expect(world.idAt(0, 2)).toBe(glassId);
    world.setWeld(0, 2, 1, 2, false);
    world.place(0, 3, TileKind.Empty);
    simulation.step();
    simulation.step();
    expect(world.idAt(0, 3)).toBe(glassId);
  });

  it("lands dependency stacks simultaneously regardless of tile creation order", () => {
    const world = new World(2, 5);
    world.place(0, 1, TileKind.Glass);
    world.place(0, 2, TileKind.Glass);
    world.place(1, 2, TileKind.Glass);
    world.place(1, 1, TileKind.Glass);
    const leftStoneId = world.place(0, 0, TileKind.Stone);
    const rightStoneId = world.place(1, 0, TileKind.Stone);
    const simulation = new Simulation(world);

    simulation.step();
    simulation.step();
    for (const x of [0, 1]) {
      expect(world.kindAt(x, 3)).toBe(TileKind.Glass);
      expect(world.kindAt(x, 4)).toBe(TileKind.Glass);
    }
    simulation.step();
    for (const x of [0, 1]) {
      expect(world.kindAt(x, 3)).toBe(TileKind.Empty);
      expect(world.kindAt(x, 4)).toBe(TileKind.Empty);
    }
    expect(world.idAt(0, 2)).toBe(leftStoneId);
    expect(world.idAt(1, 2)).toBe(rightStoneId);
    simulation.step();
    expect(world.idAt(0, 3)).toBe(leftStoneId);
    expect(world.idAt(1, 3)).toBe(rightStoneId);
  });

  it("clones ongoing falls independently and restores their landing behavior on reset", () => {
    const world = new World(1, 3);
    const glassId = world.place(0, 0, TileKind.Glass);
    const simulation = new Simulation(world);
    simulation.step();
    const snapshot = world.clone();

    simulation.step();
    simulation.step();
    expect(world.kindAt(0, 2)).toBe(TileKind.Empty);
    expect(snapshot.idAt(0, 1)).toBe(glassId);
    simulation.resetTo(snapshot);
    simulation.step();
    expect(world.idAt(0, 2)).toBe(glassId);
    simulation.step();
    expect(world.kindAt(0, 2)).toBe(TileKind.Empty);
    const clonedSimulation = new Simulation(snapshot);
    clonedSimulation.step();
    expect(snapshot.idAt(0, 2)).toBe(glassId);
    clonedSimulation.step();
    expect(snapshot.kindAt(0, 2)).toBe(TileKind.Empty);
  });

  it("resumes both ongoing and landing-ready falls through scene roundtrips", () => {
    const world = new World(1, 3);
    world.place(0, 0, TileKind.Glass);
    const simulation = new Simulation(world);
    simulation.step();
    const ongoing = deserializeBoard(serializeBoard(world, simulation.tick));
    const resumed = new Simulation(ongoing.world);

    resumed.step();
    expect(ongoing.world.kindAt(0, 2)).toBe(TileKind.Glass);
    const landing = deserializeBoard(serializeBoard(ongoing.world, resumed.tick));
    new Simulation(landing.world).step();
    expect(landing.world.kindAt(0, 2)).toBe(TileKind.Empty);
    resumed.step();
    expect(ongoing.world.kindAt(0, 2)).toBe(TileKind.Empty);
  });

  it("preserves a long fall when rotating its tile onto a support", () => {
    const world = new World(4, 4);
    const glassId = world.place(1, 0, TileKind.Glass);
    world.place(2, 2, TileKind.Platform);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    const selected = new Uint8Array(world.cellCount);
    selected[2 * world.width + 1] = 1;

    world.rotateCells(selected, 2 * world.width + 2, 1);
    expect(world.idAt(2, 1)).toBe(glassId);
    simulation.step();
    expect(world.kindAt(2, 1)).toBe(TileKind.Empty);
  });

  it("preserves a long fall when reflecting a selection onto a support", () => {
    const world = new World(3, 4);
    world.place(0, 0, TileKind.Glass);
    world.place(2, 3, TileKind.Platform);
    const simulation = new Simulation(world);
    simulation.step();
    simulation.step();
    const selection = new TileSelectionState(world.width, world.height);
    selection.beginSelection(0, 2);
    selection.updateSelection(2, 2);
    expect(selection.finishSelection(world, null)).toBe(true);
    expect(selection.flipHorizontally()).toBe(true);
    expect(selection.commit(world, () => true, () => true).accepted).toBe(true);

    expect(world.kindAt(2, 2)).toBe(TileKind.Glass);
    simulation.step();
    expect(world.kindAt(2, 2)).toBe(TileKind.Empty);
  });

  it("duplicates an ongoing fall so both the source and its copy break after landing", () => {
    const world = new World(5, 4);
    const sourceId = world.place(1, 0, TileKind.Glass);
    world.place(2, 1, TileKind.Duplicator, Direction.Right);
    world.place(2, 0, TileKind.Platform);
    world.setWeld(2, 0, 2, 1, true);
    world.place(1, 3, TileKind.Platform);
    world.place(3, 3, TileKind.Platform);
    const simulation = new Simulation(world);
    simulation.step();
    world.setCharge(2, 1, 1);

    simulation.step();
    expect(world.idAt(1, 2)).toBe(sourceId);
    expect(world.kindAt(3, 2)).toBe(TileKind.Glass);
    expect(world.idAt(3, 2)).not.toBe(sourceId);
    simulation.step();
    expect(world.kindAt(1, 2)).toBe(TileKind.Empty);
    expect(world.kindAt(3, 2)).toBe(TileKind.Empty);
  });

  it("tracks fragility for glass newly produced by a furnace", () => {
    const world = new World(2, 4);
    world.place(0, 0, TileKind.Furnace, Direction.Right);
    world.place(0, 1, TileKind.Platform);
    world.setWeld(0, 0, 0, 1, true);
    const targetId = world.place(1, 0, TileKind.Sand);
    world.place(1, 1, TileKind.Platform);
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 4; tick += 1) simulation.step();
    expect(world.kindAt(1, 0)).toBe(TileKind.Glass);
    expect(world.idAt(1, 0)).toBe(targetId);

    world.place(1, 1, TileKind.Empty);
    for (let tick = 0; tick < 3; tick += 1) simulation.step();
    expect(world.kindAt(1, 3)).toBe(TileKind.Glass);
    simulation.step();
    expect(world.kindAt(1, 3)).toBe(TileKind.Empty);
  });

  it("rejects negative, fractional, and unsaturated scene fall distances", () => {
    const world = new World(1, 1);
    world.place(0, 0, TileKind.Glass);
    const board = JSON.parse(serializeBoard(world, 0)) as Record<string, unknown>;

    for (const fallDistance of [-1, 0.5, 3]) {
      board.components = [{ x: 0, y: 0, type: "fragile", fallDistance }];
      expect(() => deserializeBoard(JSON.stringify(board))).toThrow();
    }
  });
});
