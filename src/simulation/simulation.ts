import { TILE_DEFINITIONS, TileKind } from "./tile";
import { World } from "./world";

/**
 * Advances a world in discrete ticks. Every movement decision is collected from
 * the start-of-tick state, then committed as a separate phase.
 */
export class Simulation {
  readonly world: World;
  tick = 0;

  private readonly bodyRoots: Int32Array;
  private readonly bodyHeads: Int32Array;
  private readonly nextBodyMember: Int32Array;
  private readonly bodyFalls: Uint8Array;
  private readonly horizontalMoves: Int8Array;
  private readonly jammedBodies: Uint8Array;
  private readonly destinationOwners: Int32Array;

  constructor(world: World) {
    this.world = world;
    this.bodyRoots = new Int32Array(world.cellCount);
    this.bodyHeads = new Int32Array(world.cellCount);
    this.nextBodyMember = new Int32Array(world.cellCount);
    this.bodyFalls = new Uint8Array(world.cellCount);
    this.horizontalMoves = new Int8Array(world.cellCount);
    this.jammedBodies = new Uint8Array(world.cellCount);
    this.destinationOwners = new Int32Array(world.cellCount);
  }

  step(): number {
    this.collectBodies();
    this.chooseMovements();
    this.resolveDestinationConflicts();

    const movementCount = this.world.moveBodiesDown(this.bodyRoots, this.horizontalMoves);
    this.tick += 1;
    return movementCount;
  }

  resetTo(snapshot: World): void {
    this.world.copyFrom(snapshot);
    this.tick = 0;
  }

  private collectBodies(): void {
    this.bodyRoots.fill(-1);
    for (let index = 0; index < this.world.cellCount; index += 1) {
      if (this.world.kindAtIndex(index) !== TileKind.Empty) {
        this.bodyRoots[index] = index;
      }
    }

    for (let index = 0; index < this.world.cellCount; index += 1) {
      if ((this.bodyRoots[index] ?? -1) < 0) {
        continue;
      }
      if (this.world.hasRightWeldAtIndex(index)) {
        this.unionBodies(index, index + 1);
      }
      if (this.world.hasDownWeldAtIndex(index)) {
        this.unionBodies(index, index + this.world.width);
      }
    }

    this.bodyHeads.fill(-1);
    this.bodyFalls.fill(1);
    for (let index = this.world.cellCount - 1; index >= 0; index -= 1) {
      if ((this.bodyRoots[index] ?? -1) < 0) {
        continue;
      }

      const root = this.findBodyRoot(index);
      this.bodyRoots[index] = root;
      this.nextBodyMember[index] = this.bodyHeads[root] ?? -1;
      this.bodyHeads[root] = index;
      const kind = this.world.kindAtIndex(index);
      if (!TILE_DEFINITIONS[kind].affectedByGravity) {
        this.bodyFalls[root] = 0;
      }
    }
  }

  private chooseMovements(): void {
    this.horizontalMoves.fill(2);
    for (let root = 0; root < this.world.cellCount; root += 1) {
      if ((this.bodyHeads[root] ?? -1) < 0 || this.bodyFalls[root] === 0) {
        continue;
      }

      if (this.canBodyMove(root, 0)) {
        this.horizontalMoves[root] = 0;
        continue;
      }

      const rootX = root % this.world.width;
      const rootY = Math.floor(root / this.world.width);
      const preferredDirection: -1 | 1 = (rootX + rootY + this.tick) % 2 === 0 ? -1 : 1;
      const alternateDirection: -1 | 1 = preferredDirection === -1 ? 1 : -1;
      if (this.canBodyMove(root, preferredDirection)) {
        this.horizontalMoves[root] = preferredDirection;
      } else if (this.canBodyMove(root, alternateDirection)) {
        this.horizontalMoves[root] = alternateDirection;
      }
    }
  }

  private resolveDestinationConflicts(): void {
    this.destinationOwners.fill(-1);
    this.jammedBodies.fill(0);

    for (let root = 0; root < this.world.cellCount; root += 1) {
      const horizontalMove = this.horizontalMoves[root] ?? 2;
      if (horizontalMove < -1 || horizontalMove > 1) {
        continue;
      }

      for (let member = this.bodyHeads[root] ?? -1; member >= 0; member = this.nextBodyMember[member] ?? -1) {
        const destination = member + this.world.width + horizontalMove;
        const owner = this.destinationOwners[destination] ?? -1;
        if (owner >= 0 && owner !== root) {
          this.jammedBodies[root] = 1;
          this.jammedBodies[owner] = 1;
        } else {
          this.destinationOwners[destination] = root;
        }
      }
    }

    for (let root = 0; root < this.world.cellCount; root += 1) {
      if (this.jammedBodies[root] === 1) {
        this.horizontalMoves[root] = 2;
      }
    }
  }

  private canBodyMove(root: number, horizontalMove: -1 | 0 | 1): boolean {
    for (let member = this.bodyHeads[root] ?? -1; member >= 0; member = this.nextBodyMember[member] ?? -1) {
      const x = member % this.world.width;
      const y = Math.floor(member / this.world.width);
      const destinationX = x + horizontalMove;
      if (y >= this.world.height - 1 || destinationX < 0 || destinationX >= this.world.width) {
        return false;
      }

      const destination = member + this.world.width + horizontalMove;
      if (
        this.world.kindAtIndex(destination) !== TileKind.Empty &&
        this.bodyRoots[destination] !== root
      ) {
        return false;
      }
    }
    return true;
  }

  private unionBodies(first: number, second: number): void {
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

  private findBodyRoot(index: number): number {
    let root = index;
    while (this.bodyRoots[root] !== root) {
      root = this.bodyRoots[root] ?? -1;
    }

    while (index !== root) {
      const parent = this.bodyRoots[index] ?? root;
      this.bodyRoots[index] = root;
      index = parent;
    }
    return root;
  }
}
