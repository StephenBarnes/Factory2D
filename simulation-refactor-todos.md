Looking through @src/simulation/simulation.ts to check if there's any high-priority refactoring we should do for this file, or if we should extract some code to separate files, etc.

## Conclusion

Yes. One small correctness refactor is urgent; one structural extraction is worthwhile before adding more simulation components. I would not rewrite the simulation architecture or introduce an ECS/general event system.

The file is large—1,780 lines, 64 KB, 49 typed-array scratch buffers—but much of that is justified by deterministic, allocation-free resolution. The problem is not size alone. It is that several buffers change meaning between phases, and those phase invariants exist only in call order.

## Implementation status

Completed:

- Body-root lookup now uses `expectDefined` for every typed-array access and throws descriptive errors when a root chain reaches an empty index. The silent fallbacks in `collectWeldedBodies()` and `collectBodyMembers()` are gone.
- Circuit resolution now lives in `src/simulation/circuit-resolver.ts`. `CircuitResolver` owns persistent typed-array scratch storage, commits charges to `World`, exposes furnace-disabled state, and consumes the delivery-intent buffer plus the current tick.
- Delivery intent collection/commit and furnace resolution now live in `src/simulation/delivery-resolver.ts` and `src/simulation/furnace-resolver.ts`. Both retain their scratch buffers for their lifetimes.
- `Simulation.step()` remains the explicit phase coordinator; the load-bearing phase order is unchanged. `simulation.ts` is now 1,435 lines, down from 1,780.
- Focused resolver/simulation coverage passes (222 tests), the full unit suite passes (402 tests), and the production TypeScript/Vite build passes.

Still left:

- Introduce a `MotionWorkspace` that encodes the changing body-topology, movement-vector, dependency, destination, and magnetic-constraint invariants.
- Move ordinary and piston motion code out of `simulation.ts` after that workspace boundary exists.
- Reconsider a separate `PistonResolver` only after motion extraction exposes a small named API.
- Add explicit timing coverage for ordinary movement and piston movement affecting one another in the same tick before changing their orchestration.
- Optionally consolidate the small duplicated neighbor-index helpers. Victory-block resolution should remain in `Simulation` unless it grows.

## Priority 0: make body-root failures loud

`findBodyRoot()` can loop forever if it receives an empty or corrupted index:

```ts
while (this.bodyRoots[root] !== root) {
  root = this.bodyRoots[root] ?? -1;
}
```

Once `root` becomes `-1`, `bodyRoots[-1]` is `undefined`; `?? -1` leaves it at `-1` forever. That directly conflicts with the repository rule that violated invariants must crash descriptively.

Related silent fallbacks occur at:

- `collectWeldedBodies()`: line 1042
- `collectBodyMembers()`: lines 1148 and 1154
- `findBodyRoot()`: lines 1769–1775

These should use `expectDefined`, with `findBodyRoot()` explicitly rejecting a negative parent. This is more than stylistic cleanup: it changes an internal invariant failure from a hung simulation to a useful exception.

I would do this before structural extraction.

## Priority 1: extract circuit resolution first

The cleanest independent subsystem is:

- `resolveCircuits()`
- `driveCircuitOutputs()`
- `unionCircuitNodes()`
- `findCircuitRoot()`
- `circuitNode()`
- `circuitRoots`
- `circuitDriveSums`
- `nextCircuitCharges`
- `nextCrossingVerticalCharges`

Move these to a focused `src/simulation/circuit-resolver.ts`, instantiated once by `Simulation`. It should retain its typed arrays for its lifetime, preserving the current no-allocation tick path.

The only explicit cross-system inputs/outputs are:

- Input: current tick, for spark behavior.
- Input: delivery absorption intents, for the delivery pulse.
- Output: furnace-disabled flags.
- Commit: next circuit charges to `World`.

A reasonable interface:

```ts
class CircuitResolver {
  readonly furnaceDisabled: Uint8Array;

  constructor(world: World);

  resolve(
    tick: number,
    deliveryAbsorptionTargets: Int32Array,
  ): void;
}
```

This extracts roughly 300 lines without disturbing movement semantics. `Simulation.step()` remains the authoritative phase coordinator.

## Priority 1: encapsulate phase-dependent movement scratch

This is the largest maintenance risk.

`bodyRoots` successively means:

1. Welded body topology in `collectWeldedBodies()`.
2. Magnetically connected gravity groups after `connectMagneticallyAttractedBodies()`.
3. Welded bodies again after `restoreWeldedBodiesAfterGravity()`.
4. Piston-specific bodies after `collectPistonBodies()` excludes kinematic edges.

Likewise, `horizontalMoves` and `verticalMoves` successively contain gravity, conveyor, and piston decisions.

That reuse is good for memory, but the invariants are currently unencapsulated. A future phase-order change can read validly typed but semantically stale data.

I would introduce a focused internal `BodyWorkspace` or `MotionWorkspace` owning:

- Body union-find storage.
- Body member lists.
- Gravity properties.
- Movement vectors.
- Movement-group union-find storage.
- Destination/dependency buffers.
- Magnetic constraints.

Its API should expose operations such as:

```ts
workspace.collectWeldedBodies();
workspace.connectMagneticContacts();
workspace.collectMembers();
workspace.restoreWeldedTopologyAfterGravity();
workspace.collectPistonBodies();
```

Do not expose a broad bag of mutable arrays to every resolver. The purpose is to encode which operations establish each invariant while retaining the existing buffers and algorithms.

## Priority 2: extract the small machine resolvers

After circuits, these are clean, low-risk extractions:

### `delivery-resolver.ts`

Own:

- `deliveryTargetOwners`
- `deliveryAbsorbTargetIndices`
- `collectDeliveryAbsorptions()`
- `resolveDeliveries()`

The absorption-target buffer should be a stable read-only output consumed by `CircuitResolver`.

### `furnace-resolver.ts`

Own:

- Furnace progress/target/transform buffers.
- `resolveFurnaces()`

Accept the circuit resolver’s furnace-disabled buffer as an input.

### Victory blocks

`resolveVictoryBlocks()` is only about 34 lines and has no scratch storage. I would leave it in `Simulation` for now. Extract it only if puzzle-result machinery grows.

Do not combine furnace, delivery, and victory behavior into a generic “device system.” They share tick placement, not domain behavior.

## Defer: separating pistons from general movement

The piston section is large—approximately lines 149–631—and deserves its own file eventually. I would not extract it first.

`resolvePistonMovements()` and `resolveDrivenMovements()` have a similar skeleton:

- Seed force-driven bodies.
- Traverse obstruction dependencies.
- Group bodies that must move together.
- Propagate blocked state.
- Resolve destination conflicts.
- Clear rejected movements.

But their policies differ materially:

- Piston anchoring.
- Conditional pushing.
- Vacated arm cells.
- Recoil.
- Magnetic coupling.
- Gravity-destination priority.
- Existing gravity movement.

Trying to deduplicate them immediately would likely produce a callback-heavy “generic movement engine” or many boolean policy flags—harder to understand than the current duplication.

Better sequence:

1. Introduce `MotionWorkspace`.
2. Move normal and piston movement together into `motion-resolver.ts`.
3. Observe the resulting internal boundary.
4. Extract `PistonResolver` only if it can consume a small, named motion API rather than 15 raw typed arrays.

Some duplication here is preferable to a prematurely generalized collision-policy framework.

## Keep `Simulation` as the phase coordinator

The order in `step()` is load-bearing:

```text
victory observation
delivery intent collection
circuit resolution
furnace resolution
delivery commit
gravity/conveyor resolution and commit
piston resolution and commit
tick increment
```

In particular:

- Delivery intents drive a pulse before the target is committed as absorbed.
- Circuit evaluation produces furnace control state.
- Victory is evaluated before new circuit charges are committed.
- Pistons currently resolve after ordinary movement.

After extraction, `simulation.ts` should remain a thin, explicit façade showing this order. Avoid a generic list of systems because it would hide these dependencies.

Before changing that orchestration, ensure observable timing is locked down. Existing feature tests cover much of it; the main thing to check explicitly is any currently uncovered interaction between ordinary movement and piston movement in the same tick.

## Low-priority cleanup

Useful, but not reasons to refactor immediately:

- `neighborIndex()` exists independently in both `Simulation` and `World`. A shared index helper could remove the duplication, but it is small and stable.
- Its error says `"Invalid circuit direction"` even though pistons, furnaces, deliveries, and conveyors also call it.
- Method ordering is difficult to scan: pistons, victory, reset, circuits, machines, then movement. Extraction will solve this more cleanly than manually rearranging the class.
- The three union-find implementations should not yet become one generic abstraction. Circuit nodes, body roots, and movement groups have different sentinel and metadata requirements.

## Recommended sequence

1. **Done:** Harden `findBodyRoot()` and remove the silent typed-array fallbacks.
2. **Done:** Extract `CircuitResolver`.
3. **Done:** Extract `DeliveryResolver` and `FurnaceResolver`.
4. **Remaining:** Introduce `MotionWorkspace` to encode topology and movement-buffer invariants.
5. **Remaining:** Move motion code out of `simulation.ts`.
6. **Remaining:** Reconsider a separate `PistonResolver`; do not force a generic movement algorithm.

No TypeScript/LSP diagnostics remain after the completed extractions. The remaining recommendation is driven by phase-invariant safety and change risk, not an existing type failure.
