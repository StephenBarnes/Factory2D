import {
  finishMachineryActivity,
  watchMachineryActivity,
  type MachineryActivity,
  type MachineryActivityEvent,
} from "../simulation/machinery-activity";
import { directionX, directionY, oppositeDirection, TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";
import { WorldFeature } from "../simulation/world-features";
import type { LocatedSound } from "./spatial-sound";

export type MachinerySound = MachineryActivity |
  "extend" | "retract" | "drill" | "grinder" | "furnace" |
  "welder" | "splitter" | "laserSplitter" | "dismantler";

const MACHINE_FEATURES = [
  WorldFeature.Piston, WorldFeature.Drill, WorldFeature.Furnace, WorldFeature.WeldOperator,
] as const;

interface MachineryObservation {
  capture: number;
  readonly kinds: Map<number, TileKind>;
  activity: readonly MachineryActivityEvent[] | null;
}

/** An extended piston keeps its original identity in its arm, not its new base. */
function machineId(world: World, index: number, kind: TileKind): number {
  if (kind !== TileKind.PistonBase) return world.idAtIndex(index);
  const direction = world.orientationAtIndex(index);
  const x = index % world.width + directionX(direction);
  const y = Math.floor(index / world.width) + directionY(direction);
  // An orphaned base is valid board state, but cannot make a stroke.
  if (x < 0 || x >= world.width || y < 0 || y >= world.height) return 0;
  const arm = y * world.width + x;
  if (world.kindAtIndex(arm) !== TileKind.PistonArm ||
      world.orientationAtIndex(arm) !== direction || !world.hasWeldAtIndex(index, direction)) return 0;
  return world.idAtIndex(arm);
}

/** Browser-only, sparse tick observations; cloned/new machines never inherit activity. */
export class MachineryObserver {
  private readonly observations = new WeakMap<World, MachineryObservation>();
  private readonly sounds: LocatedSound<MachinerySound>[] = [];
  private readonly activityWorlds: World[] = [];
  private captureNumber = 0;
  private pending = false;

  capture(world: World): void {
    this.finishActivity();
    this.captureNumber += 1;
    this.pending = true;
    this.visitWorld(world, true);
  }

  /** Preserve every committed site across the board tree; consume each capture once. */
  collectSounds(world: World): readonly LocatedSound<MachinerySound>[] {
    this.sounds.length = 0;
    if (this.pending) {
      this.pending = false;
      this.finishActivity();
      this.visitWorld(world, false);
    }
    return this.sounds;
  }

  private finishActivity(): void {
    for (const world of this.activityWorlds) finishMachineryActivity(world);
    this.activityWorlds.length = 0;
  }

  private visitWorld(world: World, capture: boolean): void {
    let observation = this.observations.get(world);
    const hasActivity = world.hasFeature(WorldFeature.Duplicator) || world.hasFeature(WorldFeature.Assembler) ||
      world.hasFeature(WorldFeature.Drill) || world.hasFeature(WorldFeature.Fragile) ||
      world.hasFeature(WorldFeature.Fastener);
    if (capture && (hasActivity || MACHINE_FEATURES.some((feature) => world.hasFeature(feature)))) {
      if (observation === undefined) {
        observation = { capture: this.captureNumber, kinds: new Map(), activity: null };
        this.observations.set(world, observation);
      }
      observation.capture = this.captureNumber;
      observation.kinds.clear();
      observation.activity = hasActivity ? watchMachineryActivity(world) : null;
      if (hasActivity) this.activityWorlds.push(world);
    }
    if (observation?.capture === this.captureNumber) {
      if (!capture && observation.activity !== null) {
        for (const { voice, index } of observation.activity) this.sounds.push({ voice, world, index });
      }
      for (const feature of MACHINE_FEATURES) {
        for (
          let index = world.firstFeatureIndex(feature);
          index >= 0;
          index = world.nextFeatureIndex(feature, index)
        ) {
          const kind = world.kindAtIndex(index);
          const id = machineId(world, index, kind);
          if (id === 0) continue;
          if (capture) {
            observation.kinds.set(id, kind);
            continue;
          }
          const previousKind = observation.kinds.get(id);
          if (previousKind === undefined) continue;
          if (kind === TileKind.PistonBase && previousKind === TileKind.Piston) {
            this.sounds.push({ voice: "extend", world, index });
          } else if (kind === TileKind.Piston && previousKind === TileKind.PistonBase) {
            this.sounds.push({ voice: "retract", world, index });
          } else if (kind === previousKind &&
              world.chargeAtPortIndex(index, oppositeDirection(world.orientationAtIndex(index))) === 1) {
            // Isolated rear outputs report active processing or successful weld changes.
            let voice: MachinerySound;
            if (kind === TileKind.Drill) voice = "drill";
            else if (kind === TileKind.Grinder) voice = "grinder";
            else if (kind === TileKind.Furnace) voice = "furnace";
            else if (kind === TileKind.Welder) voice = "welder";
            else if (kind === TileKind.Splitter) voice = "splitter";
            else if (kind === TileKind.LaserSplitter) voice = "laserSplitter";
            else if (kind === TileKind.Dismantler) voice = "dismantler";
            else continue;
            this.sounds.push({ voice, world, index });
          }
        }
      }
    }
    for (
      let index = world.firstFeatureIndex(WorldFeature.RuneArray);
      index >= 0;
      index = world.nextFeatureIndex(WorldFeature.RuneArray, index)
    ) {
      this.visitWorld(world.runeArrayWorldAtIndex(index), capture);
    }
  }
}
