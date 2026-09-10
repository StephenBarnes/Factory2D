import { expectDefined } from "../util/assert";
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
 * - Extract a separate `PistonResolver`, only if future piston work exposes a
 *   small named API.
 * - Consolidate the small duplicated neighbor-index helpers in
 *   `Simulation`, `MotionWorkspace`, and `World`.
 */

/**
 * Owns the reusable scratch storage and ordered topology transitions used by
 * ordinary and piston movement resolution.
 */
export class MotionWorkspace {
  readonly world: World;
  private tick = 0;
  private readonly bodyRoots: Int32Array;
  private readonly weldedBodyRoots: Int32Array;
  private readonly bodyHeads: Int32Array;
  private readonly nextBodyMember: Int32Array;
  private readonly bodyFalls: Uint8Array;
  private readonly bodyImmovable: Uint8Array;
  private readonly gravityActivated: Uint8Array;
  private hasFloatingTiles = false;
  private readonly bodySlidesDiagonally: Uint8Array;
  private readonly horizontalMoves: Int8Array;
  private readonly verticalMoves: Int8Array;
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
  private readonly magneticConstraintHeads: Int32Array;
  private readonly magneticConstraintOtherBodies: Int32Array;
  private readonly magneticConstraintIsVertical: Uint8Array;
  private readonly nextMagneticConstraint: Int32Array;
  private magneticConstraintCount = 0;
  private readonly pistonActions: Int8Array;
  private readonly pistonHeadWelds: Uint8Array;
  private readonly pistonArmIds: Uint32Array;
  private readonly pistonTargetRoots: Int32Array;
  private readonly pistonBaseRoots: Int32Array;
  private readonly pistonCanPush: Uint8Array;
  private readonly pistonAnchoredBodies: Uint8Array;
  private readonly pistonVacatedOwners: Int32Array;
  private readonly pistonRecoilExtensions: Uint8Array;
  private readonly pistonTransitionActions: Int8Array;
  private readonly pistonTransitionHeadWelds: Uint8Array;

  constructor(world: World) {
    this.world = world;
    this.bodyRoots = new Int32Array(world.cellCount);
    this.weldedBodyRoots = new Int32Array(world.cellCount);
    this.bodyHeads = new Int32Array(world.cellCount);
    this.nextBodyMember = new Int32Array(world.cellCount);
    this.bodyFalls = new Uint8Array(world.cellCount);
    this.bodyImmovable = new Uint8Array(world.cellCount);
    this.gravityActivated = new Uint8Array(world.cellCount);
    this.bodySlidesDiagonally = new Uint8Array(world.cellCount);
    this.horizontalMoves = new Int8Array(world.cellCount);
    this.verticalMoves = new Int8Array(world.cellCount);
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
    this.magneticConstraintHeads = new Int32Array(world.cellCount);
    this.magneticConstraintOtherBodies = new Int32Array(world.cellCount * 2);
    this.magneticConstraintIsVertical = new Uint8Array(world.cellCount * 2);
    this.nextMagneticConstraint = new Int32Array(world.cellCount * 2);
    this.pistonActions = new Int8Array(world.cellCount);
    this.pistonHeadWelds = new Uint8Array(world.cellCount);
    this.pistonArmIds = new Uint32Array(world.cellCount);
    this.pistonTargetRoots = new Int32Array(world.cellCount);
    this.pistonBaseRoots = new Int32Array(world.cellCount);
    this.pistonCanPush = new Uint8Array(world.cellCount);
    this.pistonAnchoredBodies = new Uint8Array(world.cellCount);
    this.pistonVacatedOwners = new Int32Array(world.cellCount);
    this.pistonRecoilExtensions = new Uint8Array(world.cellCount);
    this.pistonTransitionActions = new Int8Array(world.cellCount);
    this.pistonTransitionHeadWelds = new Uint8Array(world.cellCount);
  }

  resolveOrdinaryMovements(tick: number): number {
    this.tick = tick;
    this.collectWeldedBodies();
    this.connectMagneticallyAttractedBodies();
    this.collectBodyMembers();
    this.chooseMovements();
    return this.world.moveBodies(
      this.bodyRoots,
      this.horizontalMoves,
      this.verticalMoves,
    );
  }

  resolvePistons(): number {
    this.collectPistonBodies();
    this.collectBodyMembers();
    this.collectPistonActions();
    // Arm-forward extension has priority. Only intents blocked in that pass
    // switch to base recoil before the complete piston intent set is resolved again.
    this.resolvePistonMovements();
    if (this.choosePistonRecoilExtensions()) {
      this.rebuildPistonForces();
      this.resolvePistonMovements();
    }
    this.validatePistonMovements();
    this.preparePistonTransitions();

    const movementCount = this.world.moveBodies(
      this.bodyRoots,
      this.horizontalMoves,
      this.verticalMoves,
    );
    return movementCount + this.world.applyPistonTransitions(
      this.pistonTransitionActions,
      this.pistonTransitionHeadWelds,
      this.pistonArmIds,
    );
  }

  /**
   * Active piston kinematics temporarily split the retractable head
   * connection from the base. Inactive pistons retain ordinary rigid welds.
   */
  private collectPistonBodies(): void {
    this.bodyRoots.fill(-1);
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
      if (expectDefined(this.bodyRoots[index], "piston body root marker") < 0) {
        continue;
      }
      if (
        this.world.hasRightWeldAtIndex(index) &&
        !this.isPistonKinematicEdge(index, index + 1)
      ) {
        this.unionBodies(index, index + 1);
      }
      if (
        this.world.hasDownWeldAtIndex(index) &&
        !this.isPistonKinematicEdge(index, index + this.world.width)
      ) {
        this.unionBodies(index, index + this.world.width);
      }
    }
    for (
      let index = this.world.firstFeatureIndex(WorldFeature.Occupied);
      index >= 0;
      index = this.world.nextFeatureIndex(WorldFeature.Occupied, index)
    ) {
      if (expectDefined(this.bodyRoots[index], "piston body root marker") >= 0) {
        this.bodyRoots[index] = this.findBodyRoot(index);
      }
    }
  }

  private isPistonKinematicEdge(first: number, second: number): boolean {
    const firstKind = this.world.kindAtIndex(first);
    const secondKind = this.world.kindAtIndex(second);
    if (
      firstKind === TileKind.PistonArm && this.isRetractingPistonArm(first) ||
      secondKind === TileKind.PistonArm && this.isRetractingPistonArm(second)
    ) {
      return true;
    }
    return (
      firstKind === TileKind.Piston &&
        this.pistonActionAt(first) === 1 &&
        this.neighborIndex(first, this.world.orientationAtIndex(first)) === second ||
      secondKind === TileKind.Piston &&
        this.pistonActionAt(second) === 1 &&
        this.neighborIndex(second, this.world.orientationAtIndex(second)) === first
    );
  }

  private isRetractingPistonArm(arm: number): boolean {
    const orientation = this.world.orientationAtIndex(arm);
    const base = this.neighborIndex(arm, oppositeDirection(orientation));
    return (
      base >= 0 &&
      this.world.kindAtIndex(base) === TileKind.PistonBase &&
      this.world.orientationAtIndex(base) === orientation &&
      this.world.hasWeldAtIndex(base, orientation) &&
      this.pistonActionAt(base) === -1
    );
  }

  private pistonActionAt(index: number): -1 | 0 | 1 {
    const kind = this.world.kindAtIndex(index);
    const charge = this.world.chargeAtPortIndex(index, Direction.Up);
    return kind === TileKind.Piston && charge === 1
      ? 1
      : kind === TileKind.PistonBase && charge === -1
        ? -1
        : 0;
  }

  private collectPistonActions(): void {
    this.pistonActions.fill(0);
    this.pistonHeadWelds.fill(0);
    this.pistonArmIds.fill(0);
    this.pistonTargetRoots.fill(-1);
    this.pistonBaseRoots.fill(-1);
    this.pistonCanPush.fill(0);
    this.pistonAnchoredBodies.fill(0);
    this.pistonVacatedOwners.fill(-1);
    this.pistonRecoilExtensions.fill(0);
    this.bodyForceX.fill(0);
    this.bodyForceY.fill(0);
    this.destinationOwners.fill(-1);

    for (
      let base = this.world.firstFeatureIndex(WorldFeature.Piston);
      base >= 0;
      base = this.world.nextFeatureIndex(WorldFeature.Piston, base)
    ) {
      const action = this.pistonActionAt(base);
      if (action === 0) {
        continue;
      }
      const orientation = this.world.orientationAtIndex(base);
      const arm = this.neighborIndex(base, orientation);
      if (arm < 0) {
        if (action === 1) {
          this.pistonActions[base] = action;
          this.pistonBaseRoots[base] = expectDefined(
            this.bodyRoots[base],
            "boundary-braced piston base body",
          );
          this.pistonRecoilExtensions[base] = 1;
        }
        continue;
      }
      if (
        action === -1 &&
        (
          this.world.kindAtIndex(arm) !== TileKind.PistonArm ||
          this.world.orientationAtIndex(arm) !== orientation ||
          !this.world.hasWeldAtIndex(base, orientation)
        )
      ) {
        continue;
      }

      const existingOwner = expectDefined(
        this.destinationOwners[arm],
        "piston transition destination owner",
      );
      if (existingOwner >= 0) {
        this.pistonActions[existingOwner] = 0;
        this.pistonActions[base] = 0;
        this.destinationOwners[arm] = -2;
        continue;
      }
      if (existingOwner === -2) {
        continue;
      }
      this.destinationOwners[arm] = base;
      this.pistonActions[base] = action;
      this.pistonBaseRoots[base] = expectDefined(this.bodyRoots[base], "piston base body");
      if (action === 1) {
        this.pistonHeadWelds[base] = this.world.hasWeldAtIndex(base, orientation) ? 1 : 0;
        if (this.world.kindAtIndex(arm) !== TileKind.Empty) {
          this.pistonTargetRoots[base] = expectDefined(
            this.bodyRoots[arm],
            "piston extension target body",
          );
        }
      } else {
        this.pistonArmIds[base] = this.world.idAtIndex(arm);
        const head = this.neighborIndex(arm, orientation);
        if (
          head >= 0 &&
          this.world.kindAtIndex(head) !== TileKind.Empty &&
          this.world.hasWeldAtIndex(arm, orientation)
        ) {
          this.pistonHeadWelds[base] = 1;
          this.pistonTargetRoots[base] = expectDefined(
            this.bodyRoots[head],
            "piston retraction target body",
          );
        }
      }
    }

    for (
      let base = this.world.firstFeatureIndex(WorldFeature.Piston);
      base >= 0;
      base = this.world.nextFeatureIndex(WorldFeature.Piston, base)
    ) {
      const action = expectDefined(this.pistonActions[base], "piston action");
      if (action === 0) {
        continue;
      }
      const baseRoot = expectDefined(this.pistonBaseRoots[base], "piston base root");
      this.pistonAnchoredBodies[baseRoot] = 1;
      if (action === -1) {
        const arm = this.neighborIndex(base, this.world.orientationAtIndex(base));
        const armRoot = expectDefined(this.bodyRoots[arm], "piston arm body");
        this.pistonAnchoredBodies[armRoot] = 1;
      }
    }

    for (
      let base = this.world.firstFeatureIndex(WorldFeature.Piston);
      base >= 0;
      base = this.world.nextFeatureIndex(WorldFeature.Piston, base)
    ) {
      const action = expectDefined(this.pistonActions[base], "piston action");
      if (action === 0) {
        continue;
      }
      const targetRoot = expectDefined(this.pistonTargetRoots[base], "piston target root");
      const baseRoot = expectDefined(this.pistonBaseRoots[base], "piston base root");
      if (targetRoot < 0) {
        continue;
      }
      if (
        targetRoot === baseRoot ||
        action === -1 && this.pistonAnchoredBodies[targetRoot] === 1
      ) {
        this.pistonActions[base] = 0;
        continue;
      }
      if (action === -1) {
        const arm = this.neighborIndex(base, this.world.orientationAtIndex(base));
        const existingOwner = expectDefined(
          this.pistonVacatedOwners[arm],
          "retracting piston vacancy owner",
        );
        if (existingOwner >= 0 && existingOwner !== targetRoot) {
          this.pistonActions[base] = 0;
          continue;
        }
        this.pistonVacatedOwners[arm] = targetRoot;
      }
    }
    this.rebuildPistonForces();
  }

  private choosePistonRecoilExtensions(): boolean {
    let foundRecoil = false;
    for (
      let base = this.world.firstFeatureIndex(WorldFeature.Piston);
      base >= 0;
      base = this.world.nextFeatureIndex(WorldFeature.Piston, base)
    ) {
      if (expectDefined(this.pistonActions[base], "piston action") !== 1) {
        continue;
      }
      const targetRoot = expectDefined(this.pistonTargetRoots[base], "piston target root");
      if (targetRoot < 0) {
        continue;
      }
      const orientation = this.world.orientationAtIndex(base);
      if (
        expectDefined(this.horizontalMoves[targetRoot], "piston target horizontal movement") ===
          directionX(orientation) &&
        expectDefined(this.verticalMoves[targetRoot], "piston target vertical movement") ===
          directionY(orientation)
      ) {
        continue;
      }
      this.pistonRecoilExtensions[base] = 1;
      foundRecoil = true;
    }
    return foundRecoil;
  }

  private rebuildPistonForces(): void {
    this.bodyForceX.fill(0);
    this.bodyForceY.fill(0);
    this.pistonCanPush.fill(0);
    this.pistonAnchoredBodies.fill(0);
    this.pistonVacatedOwners.fill(-1);

    for (
      let base = this.world.firstFeatureIndex(WorldFeature.Piston);
      base >= 0;
      base = this.world.nextFeatureIndex(WorldFeature.Piston, base)
    ) {
      const action = expectDefined(this.pistonActions[base], "piston action");
      if (action === 0) {
        continue;
      }
      const orientation = this.world.orientationAtIndex(base);
      const baseRoot = expectDefined(this.pistonBaseRoots[base], "piston base root");
      if (action === 1 && this.pistonRecoilExtensions[base] === 1) {
        this.addBodyForce(baseRoot, oppositeDirection(orientation));
        this.pistonCanPush[baseRoot] = 1;
        continue;
      }

      this.pistonAnchoredBodies[baseRoot] = 1;
      if (action === -1) {
        const arm = this.neighborIndex(base, orientation);
        const armRoot = expectDefined(this.bodyRoots[arm], "piston arm body");
        this.pistonAnchoredBodies[armRoot] = 1;
      }

      const targetRoot = expectDefined(this.pistonTargetRoots[base], "piston target root");
      if (targetRoot < 0) {
        continue;
      }
      const moveDirection = action === 1 ? orientation : oppositeDirection(orientation);
      this.addBodyForce(targetRoot, moveDirection);
      if (action === 1) {
        this.pistonCanPush[targetRoot] = 1;
      } else {
        const arm = this.neighborIndex(base, orientation);
        this.pistonVacatedOwners[arm] = targetRoot;
      }
    }
  }

  private validatePistonMovements(): void {
    for (
      let base = this.world.firstFeatureIndex(WorldFeature.Piston);
      base >= 0;
      base = this.world.nextFeatureIndex(WorldFeature.Piston, base)
    ) {
      const action = expectDefined(this.pistonActions[base], "piston action");
      if (action === 0) {
        continue;
      }
      const orientation = this.world.orientationAtIndex(base);
      const recoils = action === 1 && this.pistonRecoilExtensions[base] === 1;
      const movementRoot = recoils
        ? expectDefined(this.pistonBaseRoots[base], "piston base root")
        : expectDefined(this.pistonTargetRoots[base], "piston target root");
      if (movementRoot < 0) {
        continue;
      }
      const movementDirection = recoils || action === -1
        ? oppositeDirection(orientation)
        : orientation;
      if (
        expectDefined(this.horizontalMoves[movementRoot], "piston horizontal movement") !==
          directionX(movementDirection) ||
        expectDefined(this.verticalMoves[movementRoot], "piston vertical movement") !==
          directionY(movementDirection)
      ) {
        this.pistonActions[base] = 0;
      }
    }
  }

  private preparePistonTransitions(): void {
    this.pistonTransitionActions.fill(0);
    this.pistonTransitionHeadWelds.fill(0);
    for (
      let base = this.world.firstFeatureIndex(WorldFeature.Piston);
      base >= 0;
      base = this.world.nextFeatureIndex(WorldFeature.Piston, base)
    ) {
      const action = expectDefined(this.pistonActions[base], "piston action");
      if (action === 0) {
        continue;
      }
      const transitionBase = action === 1 && this.pistonRecoilExtensions[base] === 1
        ? this.neighborIndex(
            base,
            oppositeDirection(this.world.orientationAtIndex(base)),
          )
        : base;
      if (transitionBase < 0) {
        throw new Error(`Piston recoil at index ${base} leaves the world`);
      }
      if (this.pistonTransitionActions[transitionBase] !== 0) {
        throw new Error(`Piston transitions conflict at index ${transitionBase}`);
      }
      this.pistonTransitionActions[transitionBase] = action;
      this.pistonTransitionHeadWelds[transitionBase] = expectDefined(
        this.pistonHeadWelds[base],
        "piston head weld",
      );
    }
  }

  private resolvePistonMovements(): void {
    this.horizontalMoves.fill(0);
    this.verticalMoves.fill(0);
    this.drivenBodies.fill(0);
    this.movementGroupRoots.fill(-1);
    this.blockedMovementGroups.fill(0);
    let queueLength = 0;

    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (expectDefined(this.bodyHeads[root], "piston body head") >= 0) {
        this.movementGroupRoots[root] = root;
      }
    }
    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (expectDefined(this.bodyHeads[root], "piston body head") < 0) {
        continue;
      }
      const forceX = expectDefined(this.bodyForceX[root], "piston horizontal force");
      const forceY = expectDefined(this.bodyForceY[root], "piston vertical force");
      if ((forceX === 0) === (forceY === 0)) {
        continue;
      }
      this.horizontalMoves[root] = forceX < 0 ? -1 : forceX > 0 ? 1 : 0;
      this.verticalMoves[root] = forceY < 0 ? -1 : forceY > 0 ? 1 : 0;
      this.drivenBodies[root] = 1;
      this.movementQueue[queueLength] = root;
      queueLength += 1;
      if (this.bodyImmovable[root] === 1 || this.pistonAnchoredBodies[root] === 1) {
        this.blockMovementGroup(root);
      }
    }

    let queueHead = 0;
    while (queueHead < queueLength) {
      const root = expectDefined(this.movementQueue[queueHead], "piston movement queue entry");
      queueHead += 1;
      const moveX = expectDefined(this.horizontalMoves[root], "piston horizontal movement");
      const moveY = expectDefined(this.verticalMoves[root], "piston vertical movement");
      for (
        let member = expectDefined(this.bodyHeads[root], "piston body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next piston body member")
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
        const blocker = expectDefined(this.bodyRoots[destination], "piston movement blocker");
        if (
          blocker < 0 ||
          blocker === root ||
          expectDefined(this.pistonVacatedOwners[destination], "piston vacancy owner") === root
        ) {
          continue;
        }
        if (
          this.pistonCanPush[root] === 0 ||
          this.bodyImmovable[blocker] === 1 ||
          this.pistonAnchoredBodies[blocker] === 1
        ) {
          this.blockMovementGroup(root);
          continue;
        }
        if (this.drivenBodies[blocker] === 0) {
          this.drivenBodies[blocker] = 1;
          this.pistonCanPush[blocker] = 1;
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

    this.destinationOwners.fill(-1);
    for (
      let root = this.world.firstFeatureIndex(WorldFeature.Occupied);
      root >= 0;
      root = this.world.nextFeatureIndex(WorldFeature.Occupied, root)
    ) {
      if (this.drivenBodies[root] === 0 || this.isMovementGroupBlocked(root)) {
        continue;
      }
      const moveX = expectDefined(this.horizontalMoves[root], "piston horizontal movement");
      const moveY = expectDefined(this.verticalMoves[root], "piston vertical movement");
      for (
        let member = expectDefined(this.bodyHeads[root], "piston body head");
        member >= 0;
        member = expectDefined(this.nextBodyMember[member], "next piston body member")
      ) {
        const destination = member + moveX + moveY * this.world.width;
        const owner = expectDefined(this.destinationOwners[destination], "piston destination owner");
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


  private collectWeldedBodies(): void {
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
  }

  /**
   * Magnetic contacts group bodies for gravity, preserving their existing
   * ability to hold one another up. Conveyor movement later uses the recorded
   * contact axis so tangential movement can slide without moving the target.
   */
  private connectMagneticallyAttractedBodies(): void {
    this.magneticConstraintHeads.fill(-1);
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
    const constraint = this.magneticConstraintCount;
    this.magneticConstraintCount += 1;
    this.magneticConstraintOtherBodies[constraint] = otherBody;
    this.magneticConstraintIsVertical[constraint] = isVertical ? 1 : 0;
    this.nextMagneticConstraint[constraint] = expectDefined(
      this.magneticConstraintHeads[body],
      "magnetic constraint head",
    );
    this.magneticConstraintHeads[body] = constraint;
  }

  private collectBodyMembers(): void {
    this.bodyHeads.fill(-1);
    this.bodyFalls.fill(1);
    this.bodyImmovable.fill(0);
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
        this.bodyImmovable[root] = 1;
      }
      if (!definition.affectedByGravity && !definition.immovable) {
        this.hasFloatingTiles = true;
      }
      if (!definition.slidesDiagonally) {
        this.bodySlidesDiagonally[root] = 0;
      }
    }
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
   * Gravity resolves before lower-priority conveyor movement. A conveyor can
   * move a supported body, but cannot redirect a falling body or claim its
   * destination.
   */
  private chooseMovements(): void {
    this.horizontalMoves.fill(0);
    this.verticalMoves.fill(0);
    this.drivenBodies.fill(0);
    this.chooseGravityMovements();
    this.resolveDestinationConflicts();
    this.restoreWeldedBodiesAfterGravity();
    this.collectConveyorForces();
    this.resolveDrivenMovements();
  }

  private collectConveyorForces(): void {
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
      if (this.bodyImmovable[root] === 1) {
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
        let constraint = expectDefined(
          this.magneticConstraintHeads[root],
          "magnetic constraint head",
        );
        constraint >= 0;
        constraint = expectDefined(
          this.nextMagneticConstraint[constraint],
          "next magnetic constraint",
        )
      ) {
        const isVertical =
          expectDefined(
            this.magneticConstraintIsVertical[constraint],
            "magnetic constraint axis",
          ) === 1;
        if (isVertical ? moveY === 0 : moveX === 0) {
          continue;
        }

        const otherBody = expectDefined(
          this.magneticConstraintOtherBodies[constraint],
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
          if (this.bodyImmovable[otherBody] === 1) {
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
        if (this.bodyImmovable[blocker] === 1) {
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
      if (this.bodyImmovable[root] === 1) {
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
