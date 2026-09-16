import { AssemblerResolver } from "./assembler-resolver";
import { DeliveryResolver } from "./delivery-resolver";
import { DuplicatorResolver } from "./duplicator-resolver";
import { DrillResolver } from "./drill-resolver";
import { FurnaceResolver } from "./furnace-resolver";
import { MotionWorkspace } from "./motion-workspace";
import { MovementSensorObserver } from "./movement-sensor";
import { PistonResolver } from "./piston-resolver";
import { RotatorResolver } from "./rotator-resolver";
import { WeldOperationResolver } from "./weld-operation-resolver";
import { WeldedBodyIndex } from "./welded-body-index";
import type { World } from "./world";
import { WorldFeature } from "./world-features";

/**
 * Per-world resolvers are allocated on first use and retained for this board's lifetime.
 * Feature checks must happen at each phase, not construction: edits and earlier commits
 * can introduce new machinery. The circuit solver spans the root and all inner boards,
 * so the tree position fields are refreshed by the simulation before every tick.
 */
export class WorldRuntime {
  readonly world: World;
  private weldedBodiesValue: WeldedBodyIndex | undefined;
  private assemblerResolverValue: AssemblerResolver | undefined;
  private deliveryResolverValue: DeliveryResolver | undefined;
  private duplicatorResolverValue: DuplicatorResolver | undefined;
  private furnaceResolverValue: FurnaceResolver | undefined;
  private drillResolverValue: DrillResolver | undefined;
  private motionWorkspaceValue: MotionWorkspace | undefined;
  private pistonResolverValue: PistonResolver | undefined;
  private rotatorResolverValue: RotatorResolver | undefined;
  private weldOperationResolverValue: WeldOperationResolver | undefined;
  private movementSensorObserver: MovementSensorObserver | undefined;
  private nextChargesValue: Int8Array | undefined;
  private nextCrossingVerticalChargesValue: Int8Array | undefined;
  private nextIsolatedOutputChargesValue: Int8Array | undefined;
  private nextPortChargesValue: Int8Array | undefined;
  private furnaceDisabledValue: Uint8Array | undefined;

  /** Runtime owning the rune array that contains this world, or null for the root. */
  parent: WorldRuntime | null = null;
  /** Cell index of the containing rune array inside `parent`, or -1 for the root. */
  parentIndex = -1;
  depth = 0;
  /** Matching pre-step snapshot, resolved before any containing array moves. */
  interpolationSource: World | undefined;
  /**
   * Global node base by cell for the circuit topology currently cached by CircuitResolver.
   * Allocated lazily only for worlds that participate in circuit resolution; -1 means the
   * cell has no shared circuit node.
   */
  circuitNodes: Int32Array | null = null;

  private collectedDuplicators = false;
  private collectedWeldOperators = false;
  private collectedDeliveries = false;
  private collectedAssemblers = false;
  private collectedDrills = false;
  constructor(world: World) {
    this.world = world;
  }

  get nextCharges(): Int8Array {
    return this.nextChargesValue ??= new Int8Array(this.world.cellCount);
  }

  get nextCrossingVerticalCharges(): Int8Array {
    return this.nextCrossingVerticalChargesValue ??= new Int8Array(this.world.cellCount);
  }

  get nextIsolatedOutputCharges(): Int8Array {
    return this.nextIsolatedOutputChargesValue ??= new Int8Array(this.world.cellCount);
  }

  /** Four resolved side charges per cell for arrays and independent sensor outputs. */
  get nextPortCharges(): Int8Array {
    return this.nextPortChargesValue ??= new Int8Array(this.world.cellCount * 4);
  }

  get furnaceDisabled(): Uint8Array {
    return this.furnaceDisabledValue ??= new Uint8Array(this.world.cellCount);
  }

  get weldedBodies(): WeldedBodyIndex {
    return this.weldedBodiesValue ??= new WeldedBodyIndex(this.world);
  }

  get assemblerResolver(): AssemblerResolver {
    return this.assemblerResolverValue ??= new AssemblerResolver(this.world, this.weldedBodies);
  }

  get deliveryResolver(): DeliveryResolver {
    return this.deliveryResolverValue ??= new DeliveryResolver(this.world, this.weldedBodies);
  }

  get duplicatorResolver(): DuplicatorResolver {
    return this.duplicatorResolverValue ??= new DuplicatorResolver(this.world, this.weldedBodies);
  }

  get furnaceResolver(): FurnaceResolver {
    return this.furnaceResolverValue ??= new FurnaceResolver(this.world);
  }

  get drillResolver(): DrillResolver {
    return this.drillResolverValue ??= new DrillResolver(this.world);
  }

  get motionWorkspace(): MotionWorkspace {
    return this.motionWorkspaceValue ??= new MotionWorkspace(this.world);
  }

  get pistonResolver(): PistonResolver {
    return this.pistonResolverValue ??= new PistonResolver(this.world);
  }

  get rotatorResolver(): RotatorResolver {
    return this.rotatorResolverValue ??= new RotatorResolver(this.world);
  }

  get weldOperationResolver(): WeldOperationResolver {
    return this.weldOperationResolverValue ??= new WeldOperationResolver(this.world);
  }

  /** Observes start-of-tick state and collects every intent that precedes circuit resolution. */
  collectIntents(): void {
    const world = this.world;
    this.motionWorkspaceValue?.clearCircuitCommands();
    if (world.hasFeature(WorldFeature.MovementSensor)) {
      this.movementSensorObserver ??= new MovementSensorObserver(world);
    }
    this.movementSensorObserver?.collect();
    this.collectedDuplicators = world.hasFeature(WorldFeature.Duplicator);
    this.collectedWeldOperators = world.hasFeature(WorldFeature.WeldOperator);
    this.collectedDeliveries = world.hasFeature(WorldFeature.Delivery);
    this.collectedAssemblers = world.hasFeature(WorldFeature.Assembler);
    this.collectedDrills = world.hasFeature(WorldFeature.Drill);
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
      this.assemblerResolver.collect(
        this.collectedDuplicators ? this.duplicatorResolver : null,
        this.collectedDeliveries ? this.deliveryResolver : null,
      );
    }
    if (this.collectedWeldOperators) {
      this.weldOperationResolver.collect();
    }
    if (this.collectedDrills) {
      this.drillResolver.collect();
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
    if (this.collectedDrills) {
      this.drillResolver.commit();
    }
    let movementCount = this.world.hasFeature(WorldFeature.Gravity) ||
      this.world.hasFeature(WorldFeature.Thruster)
      ? this.motionWorkspace.resolveOrdinaryMovements(tick)
      : 0;
    if (this.world.hasFeature(WorldFeature.Rotator)) {
      movementCount += this.rotatorResolver.resolve();
    }
    if (this.world.hasFeature(WorldFeature.Piston)) {
      movementCount += this.pistonResolver.resolve();
    }
    this.movementSensorObserver?.commit();
    return movementCount;
  }
}
