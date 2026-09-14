import { expectDefined } from "../util/assert";
import { recordShatterAnimation } from "./shatter-animation";
import {
  Direction,
  directionX,
  directionY,
  oppositeDirection,
  TILE_DEFINITIONS,
  TileKind,
} from "./tile";
import { World } from "./world";
import { WorldFeature } from "./world-features";

/**
 * Potential refactors for this file:
 * - Consolidate the small duplicated neighbor-index helpers in
 *   `Simulation`, `MotionWorkspace`, and `World`.
 */

/**
 * Owns the reusable scratch storage and ordered topology transitions used by
 * gravity, conveyor, and thruster movement resolution.
 */
export class MotionWorkspace {
  readonly world: World;
  private tick = 0;
  private readonly bodyRoots: Int32Array;
  private readonly weldedBodyRoots: Int32Array;
  private weldedGeometryRevision = -1;
  private readonly bodyHeads: Int32Array;
  private readonly nextBodyMember: Int32Array;
  private readonly bodyFalls: Uint8Array;
  /** Bit 0 blocks horizontal translation; bit 1 blocks vertical translation. */
  private readonly bodyBlockedAxes: Uint8Array;
  private readonly gravityActivated: Uint8Array;
  private hasFloatingTiles = false;
  private readonly bodySlidesDiagonally: Uint8Array;
  private readonly horizontalMoves: Int16Array;
  private readonly verticalMoves: Int16Array;
  private readonly gravityHorizontalMoves: Int8Array;
  private readonly gravityVerticalMoves: Int8Array;
  private readonly bodyForceX: Int32Array;
  private readonly bodyForceY: Int32Array;
  private readonly drivenBodies: Uint8Array;
  private readonly movementGroupRoots: Int32Array;
  private readonly blockedMovementGroups: Uint8Array;
  private readonly movementQueue: Int32Array;
  private readonly jammedBodies: Uint8Array;
  private readonly destinationOwners: Int32Array;
  private readonly gravityDestinationOwners: Int32Array;
  private readonly dependencyHeads: Int32Array;
  private readonly dependencyDependents: Int32Array;
  private readonly nextDependency: Int32Array;
  private readonly blockedBodyQueue: Int32Array;
  private magneticConstraints: {
    readonly heads: Int32Array;
    readonly otherBodies: Int32Array;
    readonly isVertical: Uint8Array;
    readonly next: Int32Array;
  } | undefined;
  private magneticConstraintCount = 0;
  private readonly breakingFastenerDestinations: number[] = [];
  private readonly breakingFragileDestinations: number[] = [];
  /** Start-of-tick commands keyed by identity so production cannot inherit a removed tile's thrust. */
  private controlledThrust: Map<number, Direction> | undefined;

  constructor(world: World) {
    this.world = world;
    this.bodyRoots = new Int32Array(world.cellCount);
    this.weldedBodyRoots = new Int32Array(world.cellCount);
    this.bodyHeads = new Int32Array(world.cellCount);
    this.nextBodyMember = new Int32Array(world.cellCount);
    this.bodyFalls = new Uint8Array(world.cellCount);
    this.bodyBlockedAxes = new Uint8Array(world.cellCount);
    this.gravityActivated = new Uint8Array(world.cellCount);
    this.bodySlidesDiagonally = new Uint8Array(world.cellCount);
    this.horizontalMoves = new Int16Array(world.cellCount);
    this.verticalMoves = new Int16Array(world.cellCount);
    this.gravityHorizontalMoves = new Int8Array(world.cellCount);
    this.gravityVerticalMoves = new Int8Array(world.cellCount);
    this.bodyForceX = new Int32Array(world.cellCount);
    this.bodyForceY = new Int32Array(world.cellCount);
    this.drivenBodies = new Uint8Array(world.cellCount);
    this.movementGroupRoots = new Int32Array(world.cellCount);
    this.blockedMovementGroups = new Uint8Array(world.cellCount);
    this.movementQueue = new Int32Array(world.cellCount);
    this.jammedBodies = new Uint8Array(world.cellCount);
    this.destinationOwners = new Int32Array(world.cellCount);
    this.gravityDestinationOwners = new Int32Array(world.cellCount);
    this.dependencyHeads = new Int32Array(world.cellCount);
    this.dependencyDependents = new Int32Array(world.cellCount);
    this.nextDependency = new Int32Array(world.cellCount);
    this.blockedBodyQueue = new Int32Array(world.cellCount);
  }

  clearControlledThrust(): void {
    this.controlledThrust?.clear();
  }

  collectControlledThrust(index: number, direction: Direction): void {
    const commands = this.controlledThrust ??= new Map<number, Direction>();
    commands.set(this.world.idAtIndex(index), direction);
  }

  resolveOrdinaryMovements(tick: number): number {
    this.tick = tick;
    this.collectWeldedBodies();
    this.connectMagneticallyAttractedBodies();
    this.collectBodyMembers();
    this.chooseMovements();
    this.collectBreakingFasteners();
    this.collectFragileLandings();
    const movementCount = this.world.moveBodies(
      this.bodyRoots,
      this.horizontalMoves,
      this.verticalMoves,
    );
    this.breakMovedFasteners();
    this.breakLandedFragileTiles();
    return movementCount;
  }


  private collectBreakingFasteners(): void {
    this.breakingFastenerDestinations.length = 0;
    for (
      let index = this.world.firstFeatureIndex(WorldFeature.Fastener);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.Fastener, index)
    ) {
      const root = expectDefined(this.bodyRoots[index], "fastener body root");
      if (this.drivenBodies[root] !== 1) {
        continue;
      }
      const moveX = expectDefined(this.horizontalMoves[root], "fastener horizontal movement");
      const moveY = expectDefined(this.verticalMoves[root], "fastener vertical movement");
      if (moveX !== 0 || moveY !== 0) {
        this.breakingFastenerDestinations.push(index + moveX + moveY * this.world.width);
      }
    }
  }

  private breakMovedFasteners(): void {
    for (const index of this.breakingFastenerDestinations) {
      if (this.world.kindAtIndex(index) !== TileKind.Fastener) {
        throw new Error(`Moved fastener missing at index ${index}`);
      }
      const x = index % this.world.width;
      recordShatterAnimation(this.world, index);
      this.world.place(x, (index - x) / this.world.width, TileKind.Empty);
    }
  }

  private collectFragileLandings(): void {
    this.breakingFragileDestinations.length = 0;
    for (
      let index = this.world.firstFeatureIndex(WorldFeature.Fragile);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.Fragile, index)
    ) {
      const root = expectDefined(this.bodyRoots[index], "fragile body root");
      const moveX = expectDefined(this.horizontalMoves[root], "fragile horizontal movement");
      const moveY = expectDefined(this.verticalMoves[root], "fragile vertical movement");
      const falling = moveY === 1 && this.drivenBodies[root] === 0;
      if (this.world.advanceFragileFallAtIndex(index, falling)) {
        this.breakingFragileDestinations.push(index + moveX + moveY * this.world.width);
      }
    }
  }

  private breakLandedFragileTiles(): void {
    // Keep landing cells solid until every body has resolved and committed its movement.
    for (const index of this.breakingFragileDestinations) {
      if (TILE_DEFINITIONS[this.world.kindAtIndex(index)].fragile !== true) {
        throw new Error(`Landed fragile tile missing at index ${index}`);
      }
      const x = index % this.world.width;
      recordShatterAnimation(this.world, index);
      this.world.place(x, (index - x) / this.world.width, TileKind.Empty);
    }
  }

  private collectWeldedBodies(): void {
    if (this.weldedGeometryRevision === this.world.geometryRevision) {
      // Magnetic grouping mutates bodyRoots, not this cache.
      this.bodyRoots.set(this.weldedBodyRoots);
      return;
    }
    this.bodyRoots.fill(-1);
    this.weldedBodyRoots.fill(-1);
    for (
      let index = this.world.firstFeatureIndex(WorldFeature.Occupied);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.Occupied, index)
    ) {
      if (this.world.kindAtIndex(index) !== TileKind.Empty) {
        this.bodyRoots[index] = index;
      }
    }

    for (
      let index = this.world.firstFeatureIndex(WorldFeature.Occupied);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.Occupied, index)
    ) {
      if (expectDefined(this.bodyRoots[index], "welded body root marker") < 0) {
        continue;
      }
      if (this.world.hasRightWeldAtIndex(index)) {
        this.unionBodies(index, index + 1);
      }
      if (this.world.hasDownWeldAtIndex(index)) {
        this.unionBodies(index, index + this.world.width);
      }
    }

    for (
      let index = this.world.firstFeatureIndex(WorldFeature.Occupied);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.Occupied, index)
    ) {
      if (expectDefined(this.bodyRoots[index], "welded body root") < 0) {
        continue;
      }
      const root = this.findBodyRoot(index);
      this.bodyRoots[index] = root;
      this.weldedBodyRoots[index] = root;
    }
    this.weldedGeometryRevision = this.world.geometryRevision;
  }

  /**
   * Magnetic contacts group bodies for gravity, preserving their existing
   * ability to hold one another up. Conveyor movement later uses the recorded
   * contact axis so tangential movement can slide without moving the target.
   */
  private connectMagneticallyAttractedBodies(): void {
    this.magneticConstraintCount = 0;
    for (
      let magnet = this.world.firstFeatureIndex(WorldFeature.Magnet);
      magnet >= 0;
      magnet = this.world.nextFeatureIndex(WorldFeature.Magnet, magnet)
    ) {
      const magnetDefinition = TILE_DEFINITIONS[this.world.kindAtIndex(magnet)];
      if (magnetDefinition.attractionRange === 0) {
        continue;
      }

      const orientation = this.world.orientationAtIndex(magnet);
      const stepX = directionX(orientation);
      const stepY = directionY(orientation);
      const magnetX = magnet % this.world.width;
      const magnetY = Math.floor(magnet / this.world.width);
      for (let distance = 1; distance <= magnetDefinition.attractionRange; distance += 1) {
        const targetX = magnetX + stepX * distance;
        const targetY = magnetY + stepY * distance;
        if (
          targetX < 0 ||
          targetX >= this.world.width ||
          targetY < 0 ||
          targetY >= this.world.height
        ) {
          break;
        }

        const target = targetY * this.world.width + targetX;
        const targetKind = this.world.kindAtIndex(target);
        if (targetKind === TileKind.Empty) {
          continue;
        }
        if (TILE_DEFINITIONS[targetKind].magnetic) {
          const magnetBody = expectDefined(
            this.weldedBodyRoots[magnet],
            "magnet welded body root",
          );
          const targetBody = expectDefined(
            this.weldedBodyRoots[target],
            "magnetic target welded body root",
          );
          if (magnetBody !== targetBody) {
            this.addMagneticConstraint(
              magnetBody,
              targetBody,
              stepY !== 0,
            );
            this.addMagneticConstraint(
              targetBody,
              magnetBody,
              stepY !== 0,
            );
          }
          this.unionBodies(magnet, target);
        }
        break;
      }
    }
  }

  private addMagneticConstraint(
    body: number,
    otherBody: number,
    isVertical: boolean,
  ): void {
    const constraints = this.magneticConstraints ??= {
      heads: new Int32Array(this.world.cellCount),
      otherBodies: new Int32Array(this.world.cellCount * 2),
      isVertical: new Uint8Array(this.world.cellCount * 2),
      next: new Int32Array(this.world.cellCount * 2),
    };
    // Retain storage across ticks/reset, but expose only this tick's contacts.
    if (this.magneticConstraintCount === 0) {
      constraints.heads.fill(-1);
    }
    const constraint = this.magneticConstraintCount;
    this.magneticConstraintCount += 1;
    constraints.otherBodies[constraint] = otherBody;
    constraints.isVertical[constraint] = isVertical ? 1 : 0;
    constraints.next[constraint] = expectDefined(
      constraints.heads[body],
      "magnetic constraint head",
    );
    constraints.heads[body] = constraint;
  }

  private collectBodyMembers(): void {
    this.bodyHeads.fill(-1);
    this.bodyFalls.fill(1);
    this.bodyBlockedAxes.fill(0);
    this.hasFloatingTiles = false;
    this.bodySlidesDiagonally.fill(1);
    for (
      let index = this.world.lastFeatureIndex(WorldFeature.Occupied);
      index >= 0;
      index = this.world.previousFeatureIndex(WorldFeature.Occupied, index)
    ) {
      if (expectDefined(this.bodyRoots[index], "body root marker") < 0) {
        continue;
      }

      const root = this.findBodyRoot(index);
      this.bodyRoots[index] = root;
      this.nextBodyMember[index] = expectDefined(this.bodyHeads[root], "body member head");
      this.bodyHeads[root] = index;
      const definition = TILE_DEFINITIONS[this.world.kindAtIndex(index)];
      if (!definition.affectedByGravity) {
        this.bodyFalls[root] = 0;
      }
      if (definition.immovable) {
        this.bodyBlockedAxes[root] = 3;
      }
      if (definition.slidesAlongOrientation) {
        this.bodyBlockedAxes[root] =
          expectDefined(this.bodyBlockedAxes[root], "body blocked axes") |
          (1 << (this.world.orientationAtIndex(index) & 1));
      }
      if (!definition.affectedByGravity && !definition.immovable) {
        this.hasFloatingTiles = true;
      }
      if (!definition.slidesDiagonally) {
        this.bodySlidesDiagonally[root] = 0;
      }
    }
    this.applyLevitationBeams();
  }

  private applyLevitationBeams(): void {
    for (
      let projector = this.world.firstFeatureIndex(WorldFeature.LevitationProjector);
      projector >= 0;
      projector = this.world.nextFeatureIndex(WorldFeature.LevitationProjector, projector)
    ) {
      const direction = this.world.orientationAtIndex(projector);
      for (
        let target = this.neighborIndex(projector, direction);
        target >= 0;
        target = this.neighborIndex(target, direction)
      ) {
        const root = expectDefined(this.bodyRoots[target], "levitation target body root");
        if (root < 0) {
          continue;
        }
        // Reapply to both magnetic gravity groups and restored welded drive groups.
        this.bodyFalls[root] = 0;
        this.hasFloatingTiles = true;
      }
    }
  }

  private blocksTranslation(root: number, moveX: number, moveY: number): boolean {
    const axes = expectDefined(this.bodyBlockedAxes[root], "body blocked axes");
    return (moveX !== 0 && (axes & 1) !== 0) || (moveY !== 0 && (axes & 2) !== 0);
  }

  private restoreWeldedBodiesAfterGravity(): void {
    this.gravityHorizontalMoves.fill(0);
    this.gravityVerticalMoves.fill(0);
    for (
      let index = this.world.firstFeatureIndex(WorldFeature.Occupied);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.Occupied, index)
    ) {
      const weldedRoot = expectDefined(this.weldedBodyRoots[index], "welded body root");
      if (weldedRoot < 0) {
        continue;
      }
      const gravityRoot = expectDefined(this.bodyRoots[index], "gravity body root");
      this.gravityHorizontalMoves[weldedRoot] = expectDefined(
        this.horizontalMoves[gravityRoot],
        "horizontal gravity movement",
      );
      this.gravityVerticalMoves[weldedRoot] = expectDefined(
        this.verticalMoves[gravityRoot],
        "vertical gravity movement",
      );
    }

    this.bodyRoots.set(this.weldedBodyRoots);
    this.horizontalMoves.set(this.gravityHorizontalMoves);
    this.verticalMoves.set(this.gravityVerticalMoves);
    this.collectBodyMembers();
  }

  /**
   * Gravity resolves before lower-priority conveyor and thruster movement.
   * Driving forces cannot redirect a falling body or claim its destination.
   */
  private chooseMovements(): void {
    this.horizontalMoves.fill(0);
    this.verticalMoves.fill(0);
    this.drivenBodies.fill(0);
    this.chooseGravityMovements();
    this.resolveDestinationConflicts();
    this.restoreWeldedBodiesAfterGravity();
    this.collectDrivingForces();
    this.resolveDrivenMovements();
  }

  private collectDrivingForces(): void {
    this.bodyForceX.fill(0);
    this.bodyForceY.fill(0);
    for (
      let index = this.world.firstFeatureIndex(WorldFeature.Conveyor);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.Conveyor, index)
    ) {
      if (this.world.kindAtIndex(index) !== TileKind.Conveyor) {
        continue;
      }
      const charge = this.world.chargeAtPortIndex(index, Direction.Up);
      if (charge === 0) {
        continue;
      }

      const conveyorRoot = expectDefined(this.bodyRoots[index], "conveyor body root");
      for (let value = Direction.Up; value <= Direction.Left; value += 1) {
        const side = value as Direction;
        const neighbor = this.neighborIndex(index, side);
        if (neighbor < 0 || this.world.kindAtIndex(neighbor) === TileKind.Empty) {
          continue;
        }
        const neighborRoot = expectDefined(this.bodyRoots[neighbor], "conveyor neighbor body root");
        if (neighborRoot === conveyorRoot) {
          continue;
        }

        const forceDirection = ((side + charge + 4) & 3) as Direction;
        this.addBodyForce(neighborRoot, forceDirection);
        this.addBodyForce(conveyorRoot, oppositeDirection(forceDirection));
      }
    }
    for (
      let index = this.world.firstFeatureIndex(WorldFeature.Thruster);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.Thruster, index)
    ) {
      const direction = this.world.kindAtIndex(index) === TileKind.ControlledThruster
        ? this.controlledThrust?.get(this.world.idAtIndex(index))
        : this.world.orientationAtIndex(index);
      if (direction !== undefined) {
        this.addBodyForce(expectDefined(this.bodyRoots[index], "thruster body root"), direction);
      }
    }
  }

  private addBodyForce(root: number, direction: Direction): void {
    this.bodyForceX[root] =
      expectDefined(this.bodyForceX[root], "horizontal body force") + directionX(direction);
    this.bodyForceY[root] =
      expectDefined(this.bodyForceY[root], "vertical body force") + directionY(direction);
  }

  private resolveDrivenMovements(): void {
    this.drivenBodies.fill(0);
    this.movementGroupRoots.fill(-1);
    this.blockedMovementGroups.fill(0);
    const magnetic = this.magneticConstraintCount === 0
      ? undefined
      : expectDefined(this.magneticConstraints, "active magnetic constraints");
    let queueLength = 0;

    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (expectDefined(this.bodyHeads[root], "body head") < 0) {
        continue;
      }
      this.movementGroupRoots[root] = root;
    }

    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (
        expectDefined(this.bodyHeads[root], "body head") < 0 ||
        this.verticalMoves[root] === 1
      ) {
        continue;
      }
      const forceX = expectDefined(this.bodyForceX[root], "horizontal body force");
      const forceY = expectDefined(this.bodyForceY[root], "vertical body force");
      const moveX = forceX < 0 ? -1 : forceX > 0 ? 1 : 0;
      const moveY = forceY > 0
        ? 1
        : forceY < 0 && this.bodyFalls[root] === 0
          ? -1
          : 0;
      if (moveX === 0 && moveY === 0) {
        continue;
      }
      this.horizontalMoves[root] = moveX;
      this.verticalMoves[root] = moveY;
      this.drivenBodies[root] = 1;
      this.movementQueue[queueLength] = root;
      queueLength += 1;
      if (this.blocksTranslation(root, moveX, moveY)) {
        this.blockMovementGroup(root);
      }
    }

    let queueHead = 0;
    while (queueHead < queueLength) {
      const root = expectDefined(this.movementQueue[queueHead], "driven movement queue entry");
      queueHead += 1;
      const moveX = expectDefined(this.horizontalMoves[root], "horizontal driven movement");
      const moveY = expectDefined(this.verticalMoves[root], "vertical driven movement");
      for (
        let constraint = magnetic === undefined
          ? -1
          : expectDefined(magnetic.heads[root], "magnetic constraint head");
        magnetic !== undefined && constraint >= 0;
        constraint = expectDefined(
          magnetic.next[constraint],
          "next magnetic constraint",
        )
      ) {
        const isVertical =
          expectDefined(
            magnetic.isVertical[constraint],
            "magnetic constraint axis",
          ) === 1;
        if (isVertical ? moveY === 0 : moveX === 0) {
          continue;
        }

        const otherBody = expectDefined(
          magnetic.otherBodies[constraint],
          "magnetically constrained body",
        );
        if (this.drivenBodies[otherBody] === 0) {
          if (this.verticalMoves[otherBody] === 1) {
            throw new Error(
              `Magnetic bodies ${root} and ${otherBody} disagree on gravity movement`,
            );
          }
          this.drivenBodies[otherBody] = 1;
          this.horizontalMoves[otherBody] = moveX;
          this.verticalMoves[otherBody] = moveY;
          this.movementQueue[queueLength] = otherBody;
          queueLength += 1;
          if (this.blocksTranslation(otherBody, moveX, moveY)) {
            this.blockMovementGroup(otherBody);
          }
          this.unionMovementGroups(root, otherBody);
          continue;
        }
        if (
          this.horizontalMoves[otherBody] !== moveX ||
          this.verticalMoves[otherBody] !== moveY
        ) {
          this.blockMovementGroup(root);
          this.blockMovementGroup(otherBody);
          continue;
        }
        this.unionMovementGroups(root, otherBody);
      }

      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        const x = member % this.world.width;
        const y = (member - x) / this.world.width;
        const destinationX = x + moveX;
        const destinationY = y + moveY;
        if (
          destinationX < 0 ||
          destinationX >= this.world.width ||
          destinationY < 0 ||
          destinationY >= this.world.height
        ) {
          this.blockMovementGroup(root);
          continue;
        }

        const destination = destinationY * this.world.width + destinationX;
        const blocker = expectDefined(this.bodyRoots[destination], "destination body root");
        if (blocker < 0 || blocker === root) {
          continue;
        }
        if (
          this.drivenBodies[blocker] === 0 &&
          this.verticalMoves[blocker] === 1
        ) {
          this.blockMovementGroup(root);
          continue;
        }
        if (this.blocksTranslation(blocker, moveX, moveY)) {
          this.blockMovementGroup(root);
          continue;
        }
        if (this.drivenBodies[blocker] === 0) {
          this.drivenBodies[blocker] = 1;
          this.horizontalMoves[blocker] = moveX;
          this.verticalMoves[blocker] = moveY;
          this.movementQueue[queueLength] = blocker;
          queueLength += 1;
          this.unionMovementGroups(root, blocker);
          continue;
        }
        if (
          this.horizontalMoves[blocker] !== moveX ||
          this.verticalMoves[blocker] !== moveY
        ) {
          this.blockMovementGroup(root);
          this.blockMovementGroup(blocker);
          continue;
        }
        this.unionMovementGroups(root, blocker);
      }
    }

    this.gravityDestinationOwners.fill(-1);
    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (this.drivenBodies[root] === 1 || this.verticalMoves[root] !== 1) {
        continue;
      }
      const moveX = expectDefined(this.horizontalMoves[root], "horizontal gravity movement");
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        const destination = member + moveX + this.world.width;
        this.gravityDestinationOwners[destination] = root;
      }
    }

    this.destinationOwners.fill(-1);
    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (
        this.drivenBodies[root] === 0 ||
        this.isMovementGroupBlocked(root)
      ) {
        continue;
      }
      const moveX = expectDefined(this.horizontalMoves[root], "horizontal driven movement");
      const moveY = expectDefined(this.verticalMoves[root], "vertical driven movement");
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        const destination = member + moveX + moveY * this.world.width;
        const owner = expectDefined(this.destinationOwners[destination], "destination owner");
        if (
          expectDefined(
            this.gravityDestinationOwners[destination],
            "gravity destination owner",
          ) >= 0
        ) {
          this.blockMovementGroup(root);
          continue;
        }
        if (
          owner >= 0 &&
          this.findMovementGroup(owner) !== this.findMovementGroup(root)
        ) {
          this.blockMovementGroup(root);
          this.blockMovementGroup(owner);
        } else {
          this.destinationOwners[destination] = root;
        }
      }
    }

    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (this.drivenBodies[root] === 1 && this.isMovementGroupBlocked(root)) {
        this.horizontalMoves[root] = 0;
        this.verticalMoves[root] = 0;
      }
    }
  }

  private chooseGravityMovements(): void {
    this.destinationOwners.fill(-1);
    this.jammedBodies.fill(0);
    this.dependencyHeads.fill(-1);
    let dependencyCount = 0;

    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (
        this.drivenBodies[root] === 0 ||
        this.horizontalMoves[root] === 0 && this.verticalMoves[root] === 0
      ) {
        continue;
      }
      const moveX = expectDefined(this.horizontalMoves[root], "horizontal driven movement");
      const moveY = expectDefined(this.verticalMoves[root], "vertical driven movement");
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        this.destinationOwners[member + moveX + moveY * this.world.width] = root;
      }
    }

    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (
        expectDefined(this.bodyHeads[root], "body head") < 0 ||
        this.drivenBodies[root] === 1
      ) {
        continue;
      }
      if (this.blocksTranslation(root, 0, 1)) {
        this.jammedBodies[root] = 1;
        continue;
      }

      this.verticalMoves[root] = 1;
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        if (member >= this.world.cellCount - this.world.width) {
          this.jammedBodies[root] = 1;
          continue;
        }
        const destination = member + this.world.width;
        if (expectDefined(this.destinationOwners[destination], "destination owner") >= 0) {
          this.jammedBodies[root] = 1;
          continue;
        }
        const blocker = expectDefined(this.bodyRoots[destination], "gravity blocker root");
        if (blocker < 0 || blocker === root) {
          continue;
        }
        if (this.drivenBodies[blocker] === 1) {
          this.jammedBodies[root] = 1;
          continue;
        }

        this.dependencyDependents[dependencyCount] = root;
        this.nextDependency[dependencyCount] = expectDefined(
          this.dependencyHeads[blocker],
          "gravity dependency head",
        );
        this.dependencyHeads[blocker] = dependencyCount;
        dependencyCount += 1;
      }
    }

    let queueHead = 0;
    let queueLength = 0;
    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (this.jammedBodies[root] === 1) {
        this.blockedBodyQueue[queueLength] = root;
        queueLength += 1;
      }
    }
    while (queueHead < queueLength) {
      const blocker = expectDefined(this.blockedBodyQueue[queueHead], "blocked body queue entry");
      queueHead += 1;
      for (
        let dependency = expectDefined(
          this.dependencyHeads[blocker],
          "gravity dependency head",
        );
        dependency >= 0;
        dependency = expectDefined(this.nextDependency[dependency], "next gravity dependency")
      ) {
        const dependent = expectDefined(
          this.dependencyDependents[dependency],
          "gravity dependent",
        );
        if (this.jammedBodies[dependent] === 1) {
          continue;
        }
        this.jammedBodies[dependent] = 1;
        this.blockedBodyQueue[queueLength] = dependent;
        queueLength += 1;
      }
    }

    if (this.hasFloatingTiles) {
      // Only successful falling bodies exert weight. Propagate it down through
      // contacts; a body supported elsewhere must not push a floating neighbor.
      this.gravityActivated.fill(0);
      queueHead = 0;
      queueLength = 0;
      for (
        let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
        root >= 0;
        root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
      ) {
        if (
          expectDefined(this.bodyHeads[root], "body head") >= 0 &&
          this.bodyFalls[root] === 1 && this.jammedBodies[root] === 0
        ) {
          this.gravityActivated[root] = 1;
          this.blockedBodyQueue[queueLength++] = root;
        }
      }
      while (queueHead < queueLength) {
        const root = expectDefined(this.blockedBodyQueue[queueHead++], "falling body queue entry");
        for (
          let member = expectDefined(this.bodyHeads[root], "body head");
          member >= 0;
          member = expectDefined(this.nextBodyMember[member], "next body member")
        ) {
          const blocker = expectDefined(this.bodyRoots[member + this.world.width], "gravity contact");
          if (blocker < 0 || this.gravityActivated[blocker] === 1) {
            continue;
          }
          this.gravityActivated[blocker] = 1;
          this.blockedBodyQueue[queueLength++] = blocker;
        }
      }
      for (
        let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
        root >= 0;
        root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
      ) {
        if (this.gravityActivated[root] === 0) {
          this.jammedBodies[root] = 1;
        }
      }
    }

    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (this.jammedBodies[root] === 1 && this.drivenBodies[root] === 0) {
        this.horizontalMoves[root] = 0;
        this.verticalMoves[root] = 0;
      }
    }

    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (
        expectDefined(this.bodyHeads[root], "body head") < 0 ||
        this.drivenBodies[root] === 1 ||
        this.bodyFalls[root] === 0 ||
        this.jammedBodies[root] === 0 ||
        this.bodySlidesDiagonally[root] === 0
      ) {
        continue;
      }
      const rootX = root % this.world.width;
      const rootY = (root - rootX) / this.world.width;
      const preferredDirection: -1 | 1 = (rootX + rootY + this.tick) % 2 === 0 ? -1 : 1;
      const alternateDirection: -1 | 1 = preferredDirection === -1 ? 1 : -1;
      if (this.canGravityBodyMove(root, preferredDirection)) {
        this.horizontalMoves[root] = preferredDirection;
        this.verticalMoves[root] = 1;
        this.jammedBodies[root] = 0;
      } else if (this.canGravityBodyMove(root, alternateDirection)) {
        this.horizontalMoves[root] = alternateDirection;
        this.verticalMoves[root] = 1;
        this.jammedBodies[root] = 0;
      }
    }
  }

  private resolveDestinationConflicts(): void {
    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (
        this.drivenBodies[root] === 1 ||
        this.horizontalMoves[root] !== 0 ||
        this.verticalMoves[root] !== 1
      ) {
        continue;
      }
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        const destination = member + this.world.width;
        const owner = expectDefined(this.destinationOwners[destination], "destination owner");
        if (owner >= 0 && owner !== root) {
          this.jammedBodies[root] = 1;
          break;
        }
        this.destinationOwners[destination] = root;
      }
    }

    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      const horizontalMove = expectDefined(
        this.horizontalMoves[root],
        "horizontal gravity movement",
      );
      if (
        this.drivenBodies[root] === 1 ||
        (horizontalMove !== -1 && horizontalMove !== 1) ||
        this.verticalMoves[root] !== 1
      ) {
        continue;
      }
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        const destination = member + this.world.width + horizontalMove;
        if (expectDefined(this.destinationOwners[destination], "destination owner") >= 0) {
          this.jammedBodies[root] = 1;
          break;
        }
      }
    }

    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      const horizontalMove = expectDefined(
        this.horizontalMoves[root],
        "horizontal gravity movement",
      );
      if (
        this.drivenBodies[root] === 1 ||
        this.jammedBodies[root] === 1 ||
        (horizontalMove !== -1 && horizontalMove !== 1) ||
        this.verticalMoves[root] !== 1
      ) {
        continue;
      }
      for (
        let member = expectDefined(this.bodyHeads[root], "body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next body member")
      ) {
        const destination = member + this.world.width + horizontalMove;
        const owner = expectDefined(this.destinationOwners[destination], "destination owner");
        if (owner >= 0 && owner !== root) {
          this.jammedBodies[root] = 1;
          this.jammedBodies[owner] = 1;
        } else {
          this.destinationOwners[destination] = root;
        }
      }
    }

    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (this.drivenBodies[root] === 0 && this.jammedBodies[root] === 1) {
        this.horizontalMoves[root] = 0;
        this.verticalMoves[root] = 0;
      }
    }
  }

  private canGravityBodyMove(root: number, horizontalMove: -1 | 1): boolean {
    for (
      let member = expectDefined(this.bodyHeads[root], "body head");
      member >= 0;
      member = expectDefined(this.nextBodyMember[member], "next body member")
    ) {
      const x = member % this.world.width;
      const y = (member - x) / this.world.width;
      const destinationX = x + horizontalMove;
      if (y >= this.world.height - 1 || destinationX < 0 || destinationX >= this.world.width) {
        return false;
      }
      const destination = member + this.world.width + horizontalMove;
      if (
        expectDefined(this.destinationOwners[destination], "destination owner") >= 0 ||
        this.world.kindAtIndex(destination) !== TileKind.Empty &&
          this.bodyRoots[destination] !== root
      ) {
        return false;
      }
    }
    return true;
  }

  private blockMovementGroup(root: number): void {
    this.blockedMovementGroups[this.findMovementGroup(root)] = 1;
  }

  private isMovementGroupBlocked(root: number): boolean {
    return this.blockedMovementGroups[this.findMovementGroup(root)] === 1;
  }

  private unionMovementGroups(first: number, second: number): void {
    const firstRoot = this.findMovementGroup(first);
    const secondRoot = this.findMovementGroup(second);
    if (firstRoot === secondRoot) {
      return;
    }
    const combinedRoot = Math.min(firstRoot, secondRoot);
    const removedRoot = Math.max(firstRoot, secondRoot);
    this.movementGroupRoots[removedRoot] = combinedRoot;
    if (this.blockedMovementGroups[removedRoot] === 1) {
      this.blockedMovementGroups[combinedRoot] = 1;
    }
  }

  private findMovementGroup(root: number): number {
    let group = root;
    let parent = expectDefined(this.movementGroupRoots[group], "movement group parent");
    if (parent < 0) {
      throw new Error(`Body root ${root} has no movement group`);
    }
    while (parent !== group) {
      group = parent;
      parent = expectDefined(this.movementGroupRoots[group], "movement group parent");
    }
    while (root !== group) {
      const next = expectDefined(this.movementGroupRoots[root], "movement group parent");
      this.movementGroupRoots[root] = group;
      root = next;
    }
    return group;
  }

  private unionBodies(first: number, second: number): void {
    if (
      expectDefined(this.bodyRoots[first], "first body root marker") < 0 ||
      expectDefined(this.bodyRoots[second], "second body root marker") < 0
    ) {
      throw new Error(`Cannot union bodies at indices ${first} and ${second}: one is empty`);
    }
    const firstRoot = this.findBodyRoot(first);
    const secondRoot = this.findBodyRoot(second);
    if (firstRoot === secondRoot) {
      return;
    }

    if (firstRoot < secondRoot) {
      this.bodyRoots[secondRoot] = firstRoot;
    } else {
      this.bodyRoots[firstRoot] = secondRoot;
    }
  }

  private neighborIndex(index: number, direction: Direction): number {
    const x = index % this.world.width;
    switch (direction) {
      case Direction.Up:
        return index >= this.world.width ? index - this.world.width : -1;
      case Direction.Right:
        return x < this.world.width - 1 ? index + 1 : -1;
      case Direction.Down:
        return index < this.world.cellCount - this.world.width
          ? index + this.world.width
          : -1;
      case Direction.Left:
        return x > 0 ? index - 1 : -1;
      default:
        throw new RangeError(`Invalid direction ${direction as number}`);
    }
  }

  private findBodyRoot(index: number): number {
    let root = index;
    let parent = expectDefined(this.bodyRoots[root], `body parent at index ${root}`);
    if (parent < 0) {
      throw new Error(`Cannot find body root for empty index ${index}`);
    }
    while (parent !== root) {
      root = parent;
      parent = expectDefined(this.bodyRoots[root], `body parent at index ${root}`);
      if (parent < 0) {
        throw new Error(`Body root chain from index ${index} reached empty index ${root}`);
      }
    }

    while (index !== root) {
      const parentIndex = expectDefined(this.bodyRoots[index], `body parent at index ${index}`);
      if (parentIndex < 0) {
        throw new Error(`Body root chain reached empty index ${index}`);
      }
      this.bodyRoots[index] = root;
      index = parentIndex;
    }
    return root;
  }

}
