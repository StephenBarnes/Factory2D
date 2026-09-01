export interface PuzzleGroupDefinition {
  readonly id: string;
  readonly name: string;
  readonly displayOrder: number;
  readonly gemstoneThreshold: number;
}

export const INITIAL_UNLOCKED_PUZZLES_PER_GROUP = 3;

export const PUZZLE_GROUPS: readonly PuzzleGroupDefinition[] = Object.freeze([
  Object.freeze({
    id: "basics",
    name: "Basics",
    displayOrder: 0,
    gemstoneThreshold: 0,
  }),
  Object.freeze({
    id: "runelore",
    name: "Runelore",
    displayOrder: 1,
    gemstoneThreshold: 2,
  }),
  Object.freeze({
    id: "advanced-runelore",
    name: "Advanced Runelore",
    displayOrder: 2,
    gemstoneThreshold: 8,
  }),
  Object.freeze({
    id: "elves",
    name: "Elves",
    displayOrder: 3,
    gemstoneThreshold: 15,
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
  groupsById[group.id] = group;
  displayOrders.add(group.displayOrder);
}

export function puzzleGroupById(id: string): PuzzleGroupDefinition | undefined {
  return groupsById[id];
}
