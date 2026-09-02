Original request: Could you help profile this game to determine whether we need to optimize it, and if so, which parts to focus on? Currently it runs fine, but all of the puzzles/sandbox we have are quite small - under 20x20. And we want to eventually have much larger grids like 400x300 for many puzzles.

# Conclusion

**Optimization is not urgent for current sub-20×20 puzzles, but it is required before 400×300 boards ship.**

Two distinct problems:

1. **Rendering is the immediate scalability blocker.** A 400×300 board with only 5% occupancy already misses a 60 FPS frame budget on this workstation.
2. **Simulation has acceptable 5-tick/s throughput for sparse boards, but repeatedly scans all 120,000 cells.** Circuit-heavy boards exceed the 200 ms tick budget under 4× CPU throttling.

Profiling used warmed synthetic workloads in headless Chromium through the Vite development build, on the Ryzen 9 5900X workstation. The 4× throttle is a useful relative proxy, not a substitute for profiling real low-end hardware.

## Simulation results

Median `Simulation.step()` time:

| Board | Cells | Empty | Fully occupied platform | Fully welded conduit network |
|---|---:|---:|---:|---:|
| 20×20 | 400 | 0.1 ms | 0.2 ms | 0.4 ms |
| 100×75 | 7,500 | 0.9 ms | 1.4 ms | 3.3 ms |
| 200×150 | 30,000 | 3.7 ms | 6.9 ms | 14.9 ms |
| 400×300 | 120,000 | 15.2 ms | 29.8 ms | 61.6 ms |

A 400×300 workload with 30,000 falling stones took approximately **19.1 ms/tick**.

At 4× CPU throttling, 400×300 results were:

| Workload | Median tick |
|---|---:|
| Empty | 73.0 ms |
| 1% static occupancy | 71.1 ms |
| Falling stones | 82.9 ms |
| Fully occupied platform | 134.4 ms |
| Fully welded circuit | 255.7 ms |

Implications:

- Normal 5-tick/s execution has a 200 ms interval. Sparse boards remain within it, but a 70–80 ms synchronous tick will still visibly interrupt rendering.
- Dense circuit workloads exceed the interval on the throttled proxy.
- The 60-tick/s mode has a 16.7 ms interval. A max-size **empty** board already consumes roughly that entire budget on the workstation.

### Why empty boards cost 15–18 ms

`Simulation.step()` invokes every subsystem regardless of whether the board contains relevant components:

- `src/simulation/world-runtime.ts:56-62` invokes welded-body, delivery, duplicator, assembler, and weld-operation collection.
- `src/simulation/world-runtime.ts:65-73` invokes every commit phase plus both ordinary and piston movement.
- `src/simulation/motion-workspace.ts:109-145` performs separate ordinary and piston topology/movement passes.
- `src/simulation/circuit-resolver.ts:85-342` has several complete-board passes: node registration, connection union, sources, gates, charge commit.
- `World.applyCircuitCharges()` performs another complete-board validation and commit pass at `src/simulation/world.ts:247-308`.

The empty-board CPU profile was consequently distributed across unrelated work:

- piston action collection: 7.8%
- circuit-charge application: 7.6%
- circuit-connection checks: 6.9%
- destination conflict resolution: 5.7%
- weld-operator scanning: 4.9%
- driven movement: 4.7%
- piston body collection: 4.0%
- ordinary welded-body collection: 4.0%
- welded-body index collection: 3.9%

This is primarily an **unnecessary work** problem, not a micro-optimization problem.

For the dense circuit workload, welded-body root traversal was the largest self-time at 19.7%; circuit connection union and port classification contributed another 13.4%.

## Rendering results

`CanvasRenderer.render()` was measured with a 1000×600 canvas and a 400×300 board fitted at approximately two pixels per cell.

| Occupancy | Tiles | Cached static frame | Animated frame | Cache-rebuilding frame |
|---:|---:|---:|---:|---:|
| 0% | 0 | 0.1 ms | — | 0.4 ms |
| 1% | 1,200 | 5.9 ms | 9.6 ms | 5.6 ms |
| 5% | 6,000 | 19.9 ms | 26.8 ms | 29.9 ms |
| 10% | 12,000 | 43.2 ms | 55.5 ms | 66.1 ms |
| 25% | 30,000 | 131.4 ms | — | 198.4 ms |
| 100% | 120,000 | 508.2 ms | — | 765.9 ms |

At 4× CPU throttling, even cached frames took:

| Occupancy | Median frame |
|---:|---:|
| 1% | 34.2 ms |
| 5% | 112.4 ms |
| 10% | 237.8 ms |

The renderer therefore becomes the limiting subsystem at a few thousand occupied cells, long before simulation throughput is exhausted.

### Rendering hotspots

On a cached 10%-occupied board:

- Canvas `save()`: 35.7%
- tile decorations: 12.2%
- Canvas `clip()`: 9.0%
- `drawBody()`: 8.9%
- Canvas `restore()`: 7.5%
- Canvas `translate()`: 6.7%
- Canvas `fill()`: 6.6%
- Canvas `stroke()`: 5.8%

The relevant structure is:

- `src/main.ts:1835-1846` redraws the complete workshop on every animation frame.
- `src/render/canvas-renderer.ts:731-821` iterates every cached body without viewport culling.
- Every body gets save, translation, shadow, clipping, fill, decoration, bevel, rim, and restore operations in `src/render/tile-renderer.ts:106-170`.
- `src/render/canvas-renderer.ts:824-859` rebuilds the entire body cache whenever the single world revision or scale changes.
- That rebuild allocates a new cell array and `Path2D` for every body.

During a dirty 10% render profile, `createBodyPath`, `Path2D`, and garbage collection accounted for approximately another 11% combined. The full-revision cache is too coarse: a circuit charge change invalidates body geometry even though positions and weld topology did not change.

## Memory

Measured backing-storage deltas for one 400×300 board:

| State | Incremental backing storage |
|---|---:|
| `World` | 3.89 MiB |
| `Simulation` constructor | 25.52 MiB |
| First circuit resolution | 3.66 MiB |
| Total world and initialized runtime | 33.07 MiB |

A workshop also has `baseline` and `previousWorld` clones, making the typed-array footprint approximately **40.85 MiB per large workshop session** before renderer caches and general JS objects.

A fully occupied renderer cache added approximately:

- **16.68 MiB JS heap**
- **0.92 MiB typed backing**
- unmeasured native `Path2D` storage

`WorkshopSessionController` retains every visited solution session in `solutionSessions` at `src/game/workshop-session.ts:41-73`. Several visited 400×300 solutions could therefore consume hundreds of MiB even while inactive.

## Recommended order

### 1. Fix rendering before anything else

Highest return:

1. **Add a low-detail rendering path for small screen cells.**
   - At the fitted 400×300 size, cells are about two pixels wide.
   - Batch simple fills by material/charge.
   - Skip per-body shadows, clips, bevels, rounded corners, and decorations below a chosen pixel threshold.
   - Full procedural detail is not visible at that scale anyway.

2. **Cull bodies outside the visible grid rectangle.**
   - Store each cached body’s AABB.
   - Expand the visible rectangle by one cell for shadows/interpolation.
   - This is especially important when zoomed into a small part of a large board. Currently offscreen bodies are still submitted to Canvas.

3. **Separate topology revision from visual-state revision.**
   - Body membership and `Path2D` depend on positions, kinds, and weld topology.
   - Charges and most component-state changes should update decoration data without rebuilding paths.
   - Movement and weld edits invalidate affected geometry.

4. **Add chunk-level invalidation if dirty frames remain expensive.**
   - Rebuild only chunks intersecting moved, placed, removed, transformed, or rewelded cells.
   - Chunking is preferable to trying to incrementally mutate individual body paths.

5. **Stop continuous redraws when the view is static.**
   - Request frames while simulation interpolation, pointer feedback, panning, selection, or charged-conveyor animation is active.
   - Otherwise render on invalidation.
   - This mainly reduces idle CPU and battery usage; LOD and culling are still required for active simulation.

Do not begin with minor `drawDecoration()` arithmetic changes. The dominant cost is tens of thousands of Canvas state and clipping operations.

### 2. Eliminate irrelevant simulation passes

Track feature presence or stable row-major component indices in `World`:

- circuit-capable cells
- pistons and piston bases
- delivery boxes
- duplicators
- assemblers
- welders/splitters
- furnaces
- movable/gravity-affected cells
- magnets and conveyors

Then:

- Skip `resolvePistons()` when there is no active piston action.
- Skip the circuit resolver when the world tree contains no circuit behavior.
- Skip rare resolver collection and commit work when the corresponding component set is empty.
- Iterate sparse component indices instead of scanning all 120,000 cells to locate a few machines.

The lists must be maintained centrally through placement, clearing, movement, duplication, assembly, furnace conversion, imports, and transforms. Preserve deterministic row-major processing where conflict behavior depends on stable ordering.

Added: A possible alternative is to make `Simulation.step()` scan the entire grid once every tick, to collect a list of components relevant to each resolver, and pass that into each resolver, instead of making each resolver do its own walk. Each `TileKind` in `TILE_DEFINITIONS` could define which resolvers need to be aware of it. But this still requires a walk per frame, so tracking a list of component indices might be better - not sure.

### 3. Compact and cache circuit topology

The circuit solver currently reserves four nodes for every cell and reconstructs the union-find every tick.

Recommended direction:

- Allocate nodes only for circuit-capable cells and rune-array ports.
- Keep an index-to-node lookup for neighbor access.
- Cache union topology while tile positions, welds, and nested array topology remain unchanged.
- Recompute driver sums and sequential gate state each tick, but not unchanged connectivity.

This targets both the 61.6 ms dense-circuit result and the 3.66 MiB first-tick circuit allocation.

### 4. Reduce motion and runtime memory

`MotionWorkspace` eagerly allocates more than thirty cell-sized typed arrays, including piston and magnetic scratch buffers.

After CPU behavior is addressed:

- Lazily allocate feature-specific piston and magnetic buffers.
- Avoid complete-array `.fill()` operations when a generation stamp or touched-index list is sufficient.
- Reuse already-collected welded topology where phase ordering makes that safe.
- Consider compact occupied-body storage instead of one slot per board cell.

### 5. Bound inactive session retention

Before large saved solutions are common:

- Lazily initialize simulation scratch storage, and/or
- evict inactive solution runtimes to a serialized snapshot with a small LRU cache.

The latter must deliberately preserve or redefine the current behavior where returning to a solution resumes its in-memory runtime state.

## Suggested performance gates

Add repeatable browser benchmarks before implementing large production puzzles:

- 400×300 at 0%, 1%, 5%, and 10% occupancy
- sparse moving raw materials
- welded circuit mesh
- representative mixed factory
- fitted and zoomed rendering
- cached, animated, and topology-dirty frames

Initial targets:

- **Rendering:** p95 below 12 ms on the development workstation, leaving headroom inside the 16.7 ms frame interval.
- **Normal simulation:** p95 below 50 ms on the workstation and below 150 ms on a representative low-end device.
- **Memory:** avoid allocating piston, magnetic, and full circuit scratch buffers for worlds that cannot exercise those systems.
- Treat 60-tick/s max-size simulation as a separate product requirement; it is not currently viable.

No repository changes were made. This was an execution and CPU/memory profiling pass against the actual `Simulation` and `CanvasRenderer` implementations.

# Update

Implemented the first two rendering priorities.

## Changes

- `src/render/canvas-renderer.ts`
  - Added a low-detail path for cells below 6 screen pixels.
  - Batches cells by tile kind and animation offset into `Path2D` fills.
  - Preserves one-cell movement interpolation.
  - Skips body shadows, clipping, decorations, bevels, and rounded outlines.
  - Stores grid-space AABBs on detailed cached bodies.
  - Culls detailed bodies outside the viewport, expanded by one cell for shadows and interpolation.

- `tests/canvas-renderer.test.ts`
  - Verifies same-kind low-detail cells use one batched fill.
  - Verifies low-detail rendering avoids procedural clipping.
  - Verifies zoomed rendering does not submit offscreen bodies.

## Verification

- Focused tests pass.
- Browser smoke benchmark, 400×300 board with 6,000 tiles:
  - Fitted low-detail frame: median **10.6 ms**, p95 **14.0 ms**
  - Zoomed detailed cached frame with culling: median **0.6 ms**, p95 **0.9 ms**
  - Canvas pixel inspection confirmed the low-detail tile fill rendered correctly.

The fitted p95 remains above the suggested 12 ms target, so topology/visual revision separation remains the next high-value rendering change.

# Update 2

Implemented topology/visual revision separation, the third rendering priority.

## Changes

- `src/simulation/world.ts`
  - Added a geometry revision that changes only when occupancy, tile kinds, positions, or weld topology may affect rendered body paths.
  - Kept the existing visual revision for charges, furnace progress, configurable component state, and nested rune-array contents.
  - Furnace progress updates remain visual-only; furnace transformations invalidate geometry.
- `src/render/canvas-renderer.ts`
  - Rebuilds welded-body membership, AABBs, cell arrays, and `Path2D` objects only when the geometry revision or cell size changes.
  - Refreshes cached cells from current visual state while reusing body paths after charge and component-state changes.
  - Fails loudly if occupancy changes without a geometry-revision increment.
- `tests/canvas-renderer.test.ts`
  - Verifies a conduit charge redraw updates its rendered charge color without constructing another body path.
  - Verifies replacing the tile still rebuilds geometry.

## Verification

- `npm test -- --run tests/canvas-renderer.test.ts`: 6 tests passed.
- `npm run build`: TypeScript and the production Vite bundle passed.
- Browser smoke test placed a welded fixed-charge rune and conduit, stepped the live sandbox, and confirmed tick 1 serialized both charges as +1 and rendered the charged conduit center as `[58, 167, 255, 255]`.

No comparative benchmark was rerun in this change. The next rendering work is chunk-level invalidation if topology-dirty frames remain expensive, then invalidation-driven redraws to reduce idle CPU.
