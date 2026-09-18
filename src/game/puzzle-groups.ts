export interface PuzzleGroupDefinition {
  readonly id: string;
  readonly name: string;
  readonly displayOrder: number;
  readonly gemstoneThreshold: number;
  readonly initialUnlockedPuzzleCount: number;
}


export const PUZZLE_GROUPS: readonly PuzzleGroupDefinition[] = Object.freeze([
  Object.freeze({
    id: "basics",
    name: "Tutorial",
    displayOrder: 0,
    gemstoneThreshold: 0,
    initialUnlockedPuzzleCount: 1,
  }),
  Object.freeze({
    id: "transport",
    name: "Transportation",
    displayOrder: 1,
    gemstoneThreshold: 4,
    initialUnlockedPuzzleCount: 3,
  }),
  Object.freeze({
    id: "manufacturing",
    name: "Manufacturing",
    displayOrder: 2,
    gemstoneThreshold: 4,
    initialUnlockedPuzzleCount: 3,
  }),
  Object.freeze({
    id: "extraction",
    name: "Extraction",
    displayOrder: 3,
    gemstoneThreshold: 4,
    initialUnlockedPuzzleCount: 3,
  }),
  Object.freeze({
    id: "mining",
    name: "Mining",
    displayOrder: 4,
    gemstoneThreshold: 4,
    initialUnlockedPuzzleCount: 3,
  }),
  Object.freeze({
    id: "runelore",
    name: "Runelore",
    displayOrder: 5,
    gemstoneThreshold: 8,
    initialUnlockedPuzzleCount: 3,
  }),
  Object.freeze({
    id: "advanced-runelore",
    name: "Advanced Runelore",
    displayOrder: 6,
    gemstoneThreshold: 20,
    initialUnlockedPuzzleCount: 2,
  }),
  Object.freeze({
    id: "elves",
    name: "Elves",
    displayOrder: 7,
    gemstoneThreshold: 20,
    initialUnlockedPuzzleCount: 2,
  }),
]);

const groupsById: Record<string, PuzzleGroupDefinition | undefined> = Object.create(null);
const displayOrders = new Set<number>();
for (const group of PUZZLE_GROUPS) {
  if (groupsById[group.id] !== undefined) {
    throw new Error(`Duplicate puzzle group id "${group.id}"`);
  }
  if (displayOrders.has(group.displayOrder)) {
    throw new Error(`Duplicate puzzle group display order ${group.displayOrder}`);
  }
  if (!Number.isSafeInteger(group.gemstoneThreshold) || group.gemstoneThreshold < 0) {
    throw new Error(`Puzzle group "${group.id}" has an invalid gemstone threshold`);
  }
  if (
    !Number.isSafeInteger(group.initialUnlockedPuzzleCount) ||
    group.initialUnlockedPuzzleCount < 1
  ) {
    throw new Error(`Puzzle group "${group.id}" has an invalid initial puzzle count`);
  }
  groupsById[group.id] = group;
  displayOrders.add(group.displayOrder);
}

export function puzzleGroupById(id: string): PuzzleGroupDefinition | undefined {
  return groupsById[id];
}
