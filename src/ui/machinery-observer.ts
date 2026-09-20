import { watchProductionActivity, type ProductionActivity } from "../simulation/production-activity";
import { directionX, directionY, oppositeDirection, TileKind } from "../simulation/tile";
import type { World } from "../simulation/world";
import { WorldFeature } from "../simulation/world-features";

export type MachinerySound = ProductionActivity |
  "extend" | "retract" | "drill" | "grinder" | "furnace" |
  "welder" | "splitter" | "laserSplitter" | "dismantler";

const MACHINE_FEATURES = [
  WorldFeature.Piston, WorldFeature.Drill, WorldFeature.Furnace, WorldFeature.WeldOperator,
] as const;

interface MachineryObservation {
  capture: number;
  readonly kinds: Map<number, TileKind>;
  production: ReadonlySet<ProductionActivity> | null;
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
  private readonly sounds = new Set<MachinerySound>();
  private captureNumber = 0;
  private pending = false;

  capture(world: World): void {
    this.captureNumber += 1;
    this.pending = true;
    this.visitWorld(world, true);
  }

  /** Coalesce each voice across the board tree; consume each capture only once. */
  collectSounds(world: World): ReadonlySet<MachinerySound> {
    this.sounds.clear();
    if (this.pending) {
      this.pending = false;
      this.visitWorld(world, false);
    }
    return this.sounds;
  }

  private visitWorld(world: World, capture: boolean): void {
    let observation = this.observations.get(world);
    const hasProduction = world.hasFeature(WorldFeature.Duplicator) || world.hasFeature(WorldFeature.Assembler);
    if (capture && (hasProduction || MACHINE_FEATURES.some((feature) => world.hasFeature(feature)))) {
      if (observation === undefined) {
        observation = { capture: this.captureNumber, kinds: new Map(), production: null };
        this.observations.set(world, observation);
      }
      observation.capture = this.captureNumber;
      observation.kinds.clear();
      observation.production = hasProduction ? watchProductionActivity(world) : null;
    }
    if (observation?.capture === this.captureNumber) {
      if (!capture && observation.production !== null) {
        for (const activity of observation.production) this.sounds.add(activity);
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
            this.sounds.add("extend");
          } else if (kind === TileKind.Piston && previousKind === TileKind.PistonBase) {
            this.sounds.add("retract");
          } else if (kind === previousKind &&
              world.chargeAtPortIndex(index, oppositeDirection(world.orientationAtIndex(index))) === 1) {
            // Isolated rear outputs report active processing or successful weld changes.
            if (kind === TileKind.Drill) this.sounds.add("drill");
            else if (kind === TileKind.Grinder) this.sounds.add("grinder");
            else if (kind === TileKind.Furnace) this.sounds.add("furnace");
            else if (kind === TileKind.Welder) this.sounds.add("welder");
            else if (kind === TileKind.Splitter) this.sounds.add("splitter");
            else if (kind === TileKind.LaserSplitter) this.sounds.add("laserSplitter");
            else if (kind === TileKind.Dismantler) this.sounds.add("dismantler");
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
