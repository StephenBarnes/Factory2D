import { readFileSync } from "node:fs";

import { collectWorldBodies } from "../../src/render/body-cells";
import { deserializeBoard, serializeBoard } from "../../src/simulation/board-export";
import { TileKind } from "../../src/simulation/tile";
import { World } from "../../src/simulation/world";

export interface BenchmarkFixture {
  readonly id: string;
  readonly scene: string;
  readonly metadata: {
    readonly width: number;
    readonly height: number;
    readonly occupiedCells: number;
    /** Occupied root-board cells divided by all root-board cells, in [0, 1]. */
    readonly occupancy: number;
    readonly bodyCount: number;
    /** Occupied cells per physically welded body; both sizes are zero for an empty board. */
    readonly minBodySize: number;
    readonly maxBodySize: number;
    readonly description: string;
    /**
     * Exclusive total-tick bound from the initial scene: the first tick on which
     * any falling stone cannot move. Include warmup ticks when checking this.
     * Null means this fixture makes no continuous-falling guarantee.
     */
    readonly continuousMotionTickLimit: number | null;
  };
}

const WIDTH = 400;
const HEIGHT = 300;
const METADATA_DESCRIPTION = "Metadata describes the initial root board only. " +
  "Bodies are occupied-cell connected components joined by physical welds, not touching contacts; " +
  "body sizes count occupied cells (zero for an empty board).";

function fixture(
  id: string,
  world: World,
  description: string,
  continuousMotionTickLimit: number | null = null,
): BenchmarkFixture {
  const bodies = collectWorldBodies(world);
  let occupiedCells = 0;
  let minBodySize = bodies.length === 0 ? 0 : world.cellCount;
  let maxBodySize = 0;
  for (const body of bodies) {
    occupiedCells += body.length;
    minBodySize = Math.min(minBodySize, body.length);
    maxBodySize = Math.max(maxBodySize, body.length);
  }
  return {
    id,
    scene: serializeBoard(world, 0),
    metadata: {
      width: world.width,
      height: world.height,
      occupiedCells,
      occupancy: occupiedCells / world.cellCount,
      bodyCount: bodies.length,
      minBodySize,
      maxBodySize,
      description: `${description} ${METADATA_DESCRIPTION}`,
      continuousMotionTickLimit,
    },
  };
}

function fallingFixture(percent: 1 | 5 | 10): BenchmarkFixture {
  const world = new World(WIDTH, HEIGHT);
  // Half-filled checkerboard rows give exact whole-board occupancy without welds.
  // Every stone translates equally until the lowest row reaches the solid floor.
  const rows = HEIGHT * percent / 50;
  for (let y = 0; y < rows; y += 1) {
    for (let x = y % 2; x < WIDTH; x += 2) {
      world.place(x, y, TileKind.Stone);
    }
  }
  const clearance = HEIGHT - rows;
  return fixture(
    `falling-${percent}`,
    world,
    `${percent}% unwelded falling stone in the top ${rows} checkerboard rows. ` +
      `${clearance} empty rows below the lowest stone permit every stone to fall on ticks ` +
      `1 through ${clearance}; tick ${clearance + 1} is the first with blocked stones. ` +
      "Warmup plus measured ticks must remain below that exclusive limit.",
    clearance + 1,
  );
}

function weldedFixture(id: string, kind: TileKind.Stone | TileKind.Conduit): BenchmarkFixture {
  const world = new World(WIDTH, HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      world.place(x, y, kind);
      if (x > 0) {
        world.setWeld(x - 1, y, x, y, true);
      }
      if (y > 0) {
        world.setWeld(x, y - 1, x, y, true);
      }
    }
  }
  return fixture(
    id,
    world,
    `100% occupied ${kind === TileKind.Stone ? "stone" : "conduit"} board with every ` +
      "orthogonal neighbor pair welded into one stationary body supported by the solid board floor. " +
      (kind === TileKind.Conduit ? "The conduit network has no charge source. " : "") +
      "No continuous motion is expected.",
  );
}

/** Builds fresh deterministic scenes; no mutable benchmark World escapes this module. */
export function benchmarkFixtures(): readonly BenchmarkFixture[] {
  const stoneDrop = deserializeBoard(readFileSync(
    new URL("../../tests/fixtures/puzzle-solutions/stone-drop.json", import.meta.url),
    "utf8",
  )).world;
  return [
    fixture("empty", new World(WIDTH, HEIGHT), "Empty maximum-size board; no motion is expected."),
    fallingFixture(1),
    fallingFixture(5),
    fallingFixture(10),
    weldedFixture("welded-stone", TileKind.Stone),
    weldedFixture("welded-conduit", TileKind.Conduit),
    fixture(
      "stone-drop",
      stoneDrop,
      "Small shipped Stone Drop solution control, loaded through the normal scene importer from " +
        "tests/fixtures/puzzle-solutions/stone-drop.json and reserialized at tick zero. " +
        "Its natural falling, delivery, and completion lifecycle is intentional; " +
        "it has no continuous-motion guarantee.",
    ),
    fixture(
      "geode",
      deserializeBoard(readFileSync(new URL("./fixtures/geode.json", import.meta.url), "utf8")).world,
      "11x12 geode extraction machine saved from a slow browser session in " +
        "temp/geode-bench-scene.json; preserved in tools/benchmark/fixtures/geode.json. " +
        "Includes conveyors, drills, duplication, delivery, and circuits. " +
        "No continuous-motion guarantee.",
    ),
  ];
}
