import { AssemblerResolver } from "./assembler-resolver";
import { DeliveryResolver } from "./delivery-resolver";
import { DuplicatorResolver } from "./duplicator-resolver";
import { FurnaceResolver } from "./furnace-resolver";
import { MotionWorkspace } from "./motion-workspace";
import { WeldOperationResolver } from "./weld-operation-resolver";
import { WeldedBodyIndex } from "./welded-body-index";
import type { World } from "./world";
import { WorldFeature } from "./world-features";

/**
 * Every per-world resolver and scratch buffer needed to tick one board. The root board
 * and each rune array's inner board own one runtime; the circuit solver spans all of them,
 * so the tree position fields are refreshed by the simulation before every tick.
 */
export class WorldRuntime {
  readonly world: World;
  readonly weldedBodies: WeldedBodyIndex;
  readonly assemblerResolver: AssemblerResolver;
  readonly deliveryResolver: DeliveryResolver;
  readonly duplicatorResolver: DuplicatorResolver;
  readonly furnaceResolver: FurnaceResolver;
  readonly motionWorkspace: MotionWorkspace;
  readonly weldOperationResolver: WeldOperationResolver;
  readonly nextCharges: Int8Array;
  readonly nextCrossingVerticalCharges: Int8Array;
  readonly nextIsolatedOutputCharges: Int8Array;
  /** Four resolved side charges per cell, used only by rune array cells. */
  readonly nextPortCharges: Int8Array;
  readonly furnaceDisabled: Uint8Array;

  /** Runtime owning the rune array that contains this world, or null for the root. */
  parent: WorldRuntime | null = null;
  /** Cell index of the containing rune array inside `parent`, or -1 for the root. */
  parentIndex = -1;
  depth = 0;
  /** First global circuit node of this world's cells for the current tick. */
  nodeBase = 0;

  private collectedDuplicators = false;
  private collectedWeldOperators = false;
  private collectedDeliveries = false;
  private collectedAssemblers = false;
  constructor(world: World) {
    this.world = world;
    this.weldedBodies = new WeldedBodyIndex(world);
    this.assemblerResolver = new AssemblerResolver(world, this.weldedBodies);
    this.deliveryResolver = new DeliveryResolver(world, this.weldedBodies);
    this.duplicatorResolver = new DuplicatorResolver(world, this.weldedBodies);
    this.furnaceResolver = new FurnaceResolver(world);
    this.motionWorkspace = new MotionWorkspace(world);
    this.weldOperationResolver = new WeldOperationResolver(world);
    this.nextCharges = new Int8Array(world.cellCount);
    this.nextCrossingVerticalCharges = new Int8Array(world.cellCount);
    this.nextIsolatedOutputCharges = new Int8Array(world.cellCount);
    this.nextPortCharges = new Int8Array(world.cellCount * 4);
    this.furnaceDisabled = new Uint8Array(world.cellCount);
  }

  /** Observes start-of-tick state and collects every intent that precedes circuit resolution. */
  collectIntents(): void {
    const world = this.world;
    this.collectedDuplicators = world.hasFeature(WorldFeature.Duplicator);
    this.collectedWeldOperators = world.hasFeature(WorldFeature.WeldOperator);
    this.collectedDeliveries = world.hasFeature(WorldFeature.Delivery);
    this.collectedAssemblers = world.hasFeature(WorldFeature.Assembler);
    if (world.hasFeature(WorldFeature.WeldedBodyObserver)) {
      this.weldedBodies.collect();
    }
    if (this.collectedDeliveries) {
      this.deliveryResolver.collect();
    }
    if (this.collectedDuplicators) {
      this.duplicatorResolver.collect();
    }
    if (this.collectedAssemblers) {
      this.assemblerResolver.collect();
    }
    if (this.collectedWeldOperators) {
      this.weldOperationResolver.collect();
    }
  }

  /** Commits the post-circuit phases in order and returns the number of moved bodies. */
  commitPhases(tick: number, interpolationSource: World | undefined): number {
    if (this.collectedDuplicators) {
      this.duplicatorResolver.commit(interpolationSource);
    }
    if (this.collectedWeldOperators) {
      this.weldOperationResolver.commit();
    }
    if (this.world.hasFeature(WorldFeature.Furnace)) {
      this.furnaceResolver.resolve(this.furnaceDisabled);
    }
    if (this.collectedDeliveries) {
      this.deliveryResolver.commit();
    }
    if (this.collectedAssemblers) {
      this.assemblerResolver.commit(interpolationSource);
    }
    let movementCount = this.world.hasFeature(WorldFeature.Gravity)
      ? this.motionWorkspace.resolveOrdinaryMovements(tick)
      : 0;
    if (this.world.hasFeature(WorldFeature.Piston)) {
      movementCount += this.motionWorkspace.resolvePistons();
    }
    return movementCount;
  }
}
