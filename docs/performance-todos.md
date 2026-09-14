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

# Update 3

Implemented localized body-cache invalidation and unchanged-frame suppression, covering the fourth and fifth rendering priorities without adding mutation bookkeeping to `World`.

## Changes

- `src/render/canvas-renderer.ts`
  - Keeps compact snapshots of tile kinds and right/down welds for detailed-render cache entries.
  - On a geometry revision, scans those snapshots once, invalidates only bodies touching changed cells, and rebuilds the affected welded components.
  - Reuses vacated body-cache slots and releases obsolete body paths after merges and splits.
  - Skips all canvas drawing when world state, interpolation, viewport, overlays, hover, and nested port charges are unchanged.
  - Continues redrawing visible charged conveyors because their perimeter animation depends on wall-clock time.
- `tests/canvas-renderer.test.ts`
  - Verifies a local tile-kind change constructs one replacement body path rather than rebuilding unrelated bodies.
  - Verifies unchanged static frames perform no second canvas clear.
  - Verifies charged conveyors still redraw for time-based animation.

## Verification

- `npm test -- --run tests/canvas-renderer.test.ts`: 9 tests passed.
- `npm test`: 41 files and 599 tests passed.
- `npm run build`: TypeScript and the production Vite bundle passed.
- Browser benchmark used a 400×300 board with 6,000 isolated tiles, zoomed to the detailed path at approximately 6.64 screen pixels per cell:
  - Before this change, a one-cell geometry edit measured median **11.1 ms**, p95 **26.3 ms**.
  - After localized invalidation, the same edit measured median **1.2 ms**, p95 **4.1 ms**.
  - Unchanged static `render()` calls measured median **0 ms**, p95 **0.1 ms** after suppression.
- Browser screenshot inspection confirmed the edited detailed tile remained visible on the benchmark canvas.

The renderer still receives a `requestAnimationFrame` callback while a workshop is open, but static callbacks now perform only revision/input comparisons and no drawing. Fully event-driven frame scheduling would save the remaining callback overhead; simulation feature-presence tracking is the next higher-impact scalability task.

# Update 4

Implemented simulation feature-presence tracking and sparse row-major pass iteration, covering the second optimization priority.

## Changes

- `src/simulation/world-features.ts` and `src/simulation/world.ts`
  - Added centrally maintained bitset indices for occupied, gravity-affected, circuit, piston, magnet, conveyor, rune-array, and rare machine cells.
  - Preserved deterministic row-major and reverse-row-major iteration.
  - Updates the indices through placement, clearing, copying, furnace conversion, duplication, piston transitions, and body movement.
- `src/simulation/simulation.ts` and `src/simulation/world-runtime.ts`
  - Skip forest-wide circuit resolution when no board contains circuit behavior.
  - Skip welded-body collection and each rare resolver when its corresponding component set is empty.
  - Skip ordinary movement when no gravity-affected cell exists and piston resolution when no piston action tile exists.
  - Enumerate nested rune arrays from their sparse index instead of scanning every outer-board cell.
- Simulation resolvers
  - Circuit, motion, welded-body, delivery, duplicator, assembler, furnace, piston, conveyor, and magnet passes now locate relevant cells through sparse indices rather than complete-board scans.
  - Furnace scratch reset touches only furnace indices.
  - Welder/splitter edge resolution retains a touched-edge bitset, avoiding complete edge-buffer scans while preserving row-major commit order.
- `tests/world-features.test.ts`
  - Covers subsystem classification, forward and reverse row-major order, placement/replacement/clear, clone/copy, body movement, and piston transitions.

## Verification

- Focused simulation verification: 11 files and 428 tests passed.
- `npm test`: 42 files and 706 tests passed.
- `npm run build`: TypeScript and the production Vite bundle passed.
- Warmed headless-Chromium benchmark on 400×300 boards:
  - Empty: median **0 ms**, p95 **0.1 ms** (previous profile: median **15.2 ms**).
  - Fully occupied static platform: median **0 ms**, p95 **0.1 ms** (previous profile: median **29.8 ms**).
  - 1%-occupied static stone: median **0.5 ms**, p95 **0.9 ms**.
  - Single welder: median **0.6 ms**, p95 **0.7 ms**.
  - 30,000 falling stones: median **9.6 ms**, p95 **16.5 ms** (previous profile: approximately **19.1 ms**).
  - Fully welded conduit network: median **54.3 ms**, p95 **83.5 ms** (previous profile: median **61.6 ms**).

Compact, cached circuit topology is implemented in Update 5 below.

# Update 5

Implemented compact circuit nodes and cached forest-wide union topology, covering the third optimization priority.

## Changes

- `src/simulation/circuit-resolver.ts` and `src/simulation/world-runtime.ts`
  - Allocate one node for an ordinary shared circuit tile, two for a wire crossing, and four for a rune array instead of reserving four nodes for every board cell.
  - Lazily allocate one cell-index-to-node lookup only for worlds that participate in circuit resolution.
  - Cache the flattened union topology across ticks while every participating world's geometry revision and nested runtime parent/index structure remain unchanged.
  - Rebuild after placement, removal, orientation, weld, movement, reset, nested-array replacement, or tree-position changes.
  - Recompute driver sums, sequential gate state, circuit charges, and victory intents every tick.
- `tests/circuit.test.ts` and `tests/rune-array.test.ts`
  - Verify compact node counts, reuse across visual-only circuit ticks, geometry-triggered rebuilding, and invalidation when a resized rune array replaces its inner world.

## Verification

- Focused circuit verification: 3 files and 317 tests passed.
- `npm test`: 42 files and 708 tests passed.
- `npm run build`: TypeScript and the production Vite bundle passed.
- Warmed headless-Chromium benchmark on a fully welded 400×300 conduit network:
  - First topology-building tick: **126.6 ms**.
  - Cached ticks: median **42.7 ms**, p95 **56.6 ms**.
  - Previous feature-index benchmark: median **54.3 ms**, p95 **83.5 ms**.
  - Circuit topology storage for 120,000 conduits is **1.37 MiB**: 0.46 MiB each for roots, driver sums, and the cell-to-node lookup. The previous roots and driver sums alone reserved **3.66 MiB**.

The cached dense-circuit median is below the 50 ms workstation target, while p95 remains 6.6 ms above it. Motion/runtime scratch allocation is the next listed optimization priority.

# Update 6

Implemented the connected-body caching task from `todos.md`.

## Changes

- `WeldedBodyIndex.collect()` reuses membership, linked member lists, counts, and bounds while its world's geometry revision is unchanged.
- `MotionWorkspace` reuses its existing ordinary welded-root buffer under the same revision check, copying roots back into mutable motion scratch before magnetic grouping. This adds no cell-sized storage.
- Placement/removal, orientation changes, weld edits, movement, and reset invalidate through the existing geometry revision. Visual-only changes do not rebuild these caches.
- Magnetic contacts, movement properties, and charge-dependent piston topology still recompute each pass. Start-of-tick observer topology and post-commit motion topology retain separate ownership.
- Rendering already caches welded membership and paths with localized geometry invalidation. It remains independent: rendering consumes committed worlds (including previews), not simulation's start-of-tick observations or temporary magnetic/piston groups. A simulation getter would not replace those caches safely.

## Verification

- Focused simulation checks: 10 files, 152 tests passed, including a regression covering stationary ticks followed by weld splitting, falling, and reset.
- `npm run build` passed.
- Warmed headless-Chromium Vite benchmark: 400×300 board filled with one fully welded stationary stone body; 10 warmup calls and 40 measured calls per operation, same browser session before/after:

| Operation | Before median / p95 | After median / p95 |
|---|---:|---:|
| `Simulation.step()` | 37.3 / 38.4 ms | 23.8 / 25.2 ms |
| `WeldedBodyIndex.collect()` | 6.1 / 6.3 ms | below timer resolution |

These results cover unchanged geometry, not moving factories; geometry-changing ticks still rebuild topology. The remaining motion passes still inspect bodies each tick.

# Update 7

Implemented lazy per-world resolver allocation from the motion/runtime memory priority.

## Changes

- `WorldRuntime` allocates each machine resolver, its shared observer `WeldedBodyIndex`, and `MotionWorkspace` on first use rather than at construction.
- Existing feature-gated phases still check the live world each tick, including after earlier production commits. Components added after empty ticks or reset can activate their resolver without constructing a new simulation.
- Resolvers remain cached once used; removing their components or resetting does not release their buffers. This preserves reuse without allocation churn.
- Circuit source collection no longer accesses delivery and weld-operation scratch unconditionally; unrelated circuits do not allocate those resolvers.
- Circuit output buffers remain eager. Magnetic buffers inside an activated `MotionWorkspace` and inactive-session eviction remain separate future work.

## Verification

- `npm test`: 57 files, 914 tests passed, including a new regression for adding powered pistons after empty ticks and repeating after reset.
- `npm run build` passed.
- Browser smoke check exercised an initially empty simulation, then added a falling stone, a powered piston lifting a welded load, and a rune array whose initially empty inner board later received a falling stone.
- Headless Chromium through Vite, 400×300 boards: counted distinct typed-array backing buffers reachable from `Simulation`, excluding `World` storage. These figures measure runtime backing storage, not total browser memory or JS object overhead.

| Board after one tick | Before | After |
|---|---:|---:|
| Empty | 33.67 MiB | 0.92 MiB |
| One platform | 33.67 MiB | 0.92 MiB |
| One stone | 33.67 MiB | 11.33 MiB |
| One conduit | 34.13 MiB | 11.79 MiB |

Immediately after construction, all four scenarios use 0.92 MiB instead of 33.67 MiB. Motion and circuit allocations occur on their first relevant tick; this defers their initialization cost rather than eliminating it. No tick-throughput improvement is claimed.

# Update 8

Implemented lazy magnetic scratch allocation inside `MotionWorkspace`, continuing the motion/runtime memory priority.

## Changes

- Allocate the four magnetic contact buffers only when a magnet first attracts a distinct welded body. Non-magnetic boards and magnets without contacts allocate none of them.
- Retain allocated storage across edits and reset. Reset the active contact count each ordinary-motion pass and clear contact heads only when its first contact is recorded; contact-free ticks never traverse stale buffers.
- Added a behavioral regression covering late magnetic activation, rotation away from a target, removal of the last magnet, and resets with/without magnetic contacts.

## Verification

- `npm run build` passed.
- `npm test`: 61 files, 969 tests passed.
- Headless Chromium through Vite, 400×300 boards after one tick: counted distinct typed-array backing buffers reachable from `Simulation`, excluding `World` storage, using the same method before/after. These are runtime backing-storage measurements, not total browser memory.

| Board | Before | After |
|---|---:|---:|
| Empty | 960,000 bytes | 960,000 bytes |
| One stone | 11,880,000 bytes | 9,240,000 bytes |
| One conduit | 12,360,008 bytes | 9,720,008 bytes |
| One magnet without a target | 11,880,000 bytes | 9,240,000 bytes |

This saves 22 bytes per cell, or **2.52 MiB per 400×300 runtime**, until the first magnetic contact. Magnetic factories still require the same buffers once activated; no tick-throughput improvement is claimed.

The browser smoke scenario also exercised a thruster-driven body before magnets existed, late-added attraction to fixed iron, rotation away, restored contact after reset, last-magnet removal, and reset to a non-magnetic snapshot. Motion matched each state, and allocated backing storage stayed constant after first contact.
