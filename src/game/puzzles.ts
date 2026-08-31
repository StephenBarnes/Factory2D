import { GridRegion } from "./grid-region";
import { PuzzleComponents } from "./puzzle-components";
import { Direction, TileKind } from "../simulation/tile";
import { World } from "../simulation/world";
import { expectDefined } from "../util/assert";

export type PuzzleId = "first-shift" | "beltworks" | "runic-relay";

export interface PuzzleDefinition {
  readonly id: PuzzleId;
  readonly name: string;
  readonly description: string;
  readonly goal: string;
  readonly editableRegion: GridRegion;
  readonly availableComponents: PuzzleComponents;
  readonly prerequisitePuzzleIds: readonly PuzzleId[];
  readonly createInitialWorld: () => World;
}

function addFloor(world: World): void {
  for (let x = 0; x < world.width; x += 1) {
    world.place(x, world.height - 1, TileKind.Platform);
  }
}

function createFirstShiftWorld(): World {
  const world = new World(20, 14);
  addFloor(world);
  for (let x = 3; x <= 7; x += 1) {
    world.place(x, 9, TileKind.Platform);
  }
  world.place(5, 3, TileKind.Sand);
  world.place(5, 4, TileKind.Sand);
  return world;
}

function createBeltworksWorld(): World {
  const world = new World(20, 14);
  addFloor(world);
  for (let x = 3; x <= 8; x += 1) {
    world.place(x, 10, TileKind.Platform);
  }
  world.place(5, 9, TileKind.Conveyor);
  world.place(6, 9, TileKind.Conveyor);
  world.place(7, 9, TileKind.Conveyor);
  world.place(5, 8, TileKind.Stone);
  return world;
}

function createRunicRelayWorld(): World {
  const world = new World(20, 14);
  addFloor(world);
  world.place(7, 9, TileKind.Sensor, Direction.Right);
  world.place(8, 9, TileKind.Conduit);
  world.place(9, 9, TileKind.Conduit);
  world.place(10, 9, TileKind.Inverter, Direction.Right);
  world.place(11, 9, TileKind.Conduit);
  world.place(12, 9, TileKind.Conduit);
  return world;
}

export function createSandboxWorld(): World {
  const world = new World(20, 14);
  addFloor(world);
  for (let x = 3; x <= 7; x += 1) {
    world.place(x, 9, TileKind.Platform);
  }
  for (let x = 13; x <= 16; x += 1) {
    world.place(x, 11, TileKind.Platform);
  }
  world.place(5, 3, TileKind.Sand);
  world.place(5, 4, TileKind.Sand);
  world.place(11, 2, TileKind.Sand);
  world.place(15, 5, TileKind.Sand);
  return world;
}

export const PUZZLES: readonly PuzzleDefinition[] = [
  {
    id: "first-shift",
    name: "First Shift",
    description: "A small gravity workshop for the first puzzle flow.",
    goal: "Move both loads of sand below the raised platform.",
    editableRegion: new GridRegion([{ x: 8, y: 2, width: 10, height: 11 }]),
    availableComponents: new PuzzleComponents([
      { kind: TileKind.Stone, price: 1 },
      { kind: TileKind.Platform, price: 3 },
    ]),
    prerequisitePuzzleIds: [],
    createInitialWorld: createFirstShiftWorld,
  },
  {
    id: "beltworks",
    name: "Beltworks",
    description: "A conveyor workshop unlocked after the first shift.",
    goal: "Carry the stone to the far side of the platform.",
    editableRegion: new GridRegion([{ x: 9, y: 3, width: 9, height: 10 }]),
    availableComponents: new PuzzleComponents([
      { kind: TileKind.Stone, price: 1 },
      { kind: TileKind.Platform, price: 3 },
      { kind: TileKind.Conveyor, price: 5 },
      { kind: TileKind.Conduit, price: 1 },
      { kind: TileKind.FixedCharge, price: 2 },
    ]),
    prerequisitePuzzleIds: ["first-shift"],
    createInitialWorld: createBeltworksWorld,
  },
  {
    id: "runic-relay",
    name: "Runic Relay",
    description: "A signal-routing workshop unlocked after Beltworks.",
    goal: "Route and invert the sensor signal.",
    editableRegion: new GridRegion([
      { x: 2, y: 2, width: 4, height: 10 },
      { x: 13, y: 2, width: 5, height: 10 },
    ]),
    availableComponents: new PuzzleComponents([
      { kind: TileKind.Conduit, price: 1 },
      { kind: TileKind.FixedCharge, price: 2 },
      { kind: TileKind.Spark, price: 3 },
      { kind: TileKind.Inverter, price: 4 },
      { kind: TileKind.Combiner, price: 4 },
      { kind: TileKind.WireCrossing, price: 3 },
    ]),
    prerequisitePuzzleIds: ["beltworks"],
    createInitialWorld: createRunicRelayWorld,
  },
];

const PUZZLES_BY_ID: Readonly<Record<PuzzleId, PuzzleDefinition>> = {
  "first-shift": expectDefined(PUZZLES[0], "Missing first-shift puzzle definition"),
  beltworks: expectDefined(PUZZLES[1], "Missing beltworks puzzle definition"),
  "runic-relay": expectDefined(PUZZLES[2], "Missing runic-relay puzzle definition"),
};

export function puzzleById(id: PuzzleId): PuzzleDefinition {
  return PUZZLES_BY_ID[id];
}

export function isPuzzleUnlocked(
  puzzle: PuzzleDefinition,
  completedPuzzleIds: ReadonlySet<PuzzleId>,
): boolean {
  return puzzle.prerequisitePuzzleIds.every((id) => completedPuzzleIds.has(id));
}
