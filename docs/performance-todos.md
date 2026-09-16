# Performance status and remaining work

Updated **2026-09-16**, against source revision `35a9bbc0b7dff729199001c17401350c869222dc`.

This is the active plan, not an optimization changelog. The [original investigation and Updates 1–14](performance-history.md) are archived unchanged. Their timings, hotspot percentages, memory totals, and recommendations describe earlier revisions; do not use them as current baselines or add their memory savings together.

## Current assessment

* **Do not restart the original optimization list.** LOD, culling, geometry caching, sparse feature discovery, cached circuit connectivity, and most lazy-allocation work are implemented. See the status table below.
* **Active fitted rendering is still a priority to investigate.** Fresh synthetic measurements below exceed the proposed 12 ms render p95 at 5% occupancy and become much more expensive at 10%. These are headless software-renderer results, not measured gameplay FPS on the workstation GPU.
* **Empty/static-platform simulation is no longer a board-size blocker in isolation.** Dense stationary and moving workloads still cost milliseconds to tens of milliseconds. A 5-tick/s throughput budget does not ensure smooth 60 FPS: a synchronous tick can interrupt a frame.
* **The largest evidence gap is the complete workshop.** Isolated `Simulation.step()` and `CanvasRenderer.render()` measurements exclude snapshot copying, signal capture, much of the UI, case transitions, and persistence. Current low-end-device performance and total retained browser memory are not established.

The product direction remains up to 400×300 tiles, 5 simulation ticks/s, and 60 FPS animation on low-end hardware. Treat maximum-size 60-tick/s playback as a separate requirement: the dense simulation cases below already exceed its 16.7 ms interval, but that does not mean every maximum-size workload does.

## Fresh spot measurements

### Method and limits

These are scoped observations, not release gates or a CPU hotspot profile:

* Run on 2026-09-16 through Vite development modules in an isolated browser page, without the application's animation loop. Host: Ryzen 9 5900X workstation. Browser: headless Chromium **146.0.7680.71**, no CPU throttle applied; CDP reported **ANGLE/SwiftShader software rendering**, not the NVIDIA GPU. Browser device-pixel ratio was **1.25**.
* Each scenario uses a fresh 400×300 `World` populated through `place`/`setWeld`. Timing uses `performance.now()`. Report median and nearest-rank p95 over **60 samples** after **15 warmup calls**; the simulation additionally records one first tick before warmup. Values rounded to 0.1 ms; zero means below effective timer resolution, not no work.
* Simulation timings cover `step()` only, without an interpolation-source world. Placement, construction, buffer inspection, rendering, and snapshots are outside the timed interval. First ticks are single observations with different JIT/allocation conditions, not a cold-start distribution.
* Rendering timings cover the synchronous `render()` call, including its preparation and Canvas submission, not completion of raster/compositor work or displayed frame intervals. Calls yield through `setTimeout(0)` between samples, not paced animation frames. An initial RAF-paced attempt timed out and is not included. Two completed render passes are reported separately where relevant; no before/after speedup is inferred from historical runs.
* No production-build, physical low-end, 4×-throttled, mixed-factory, nested-array, real-GPU, or full-workshop measurements were performed in this refresh. Those remain work below.

### Simulation

| Workload | First tick (ms) | Warm median / p95 (ms) | Runtime backing bytes after sampling |
|---|---:|---:|---:|
| Empty | 1.3 | <0.1 / 0.1 | 0 |
| Fully occupied, unwelded platforms | <0.1 | <0.1 / 0.1 | 0 |
| One stone at (200, 299) | 6.5 | 0.2 / 0.3 | 7,320,000 |
| 30,000 falling stones | 44.6 | 8.5 / 8.7 | 7,320,000 |
| Fully welded stationary stone board | 39.0 | 18.7 / 19.2 | 7,320,000 |
| Fully welded stationary conduit board | 73.7 | 27.6 / 28.2 | 9,720,000 |

Reproduction details:

* Falling stones occupy every even x in rows 0–149. After the first tick, 15 warmups, and 60 measured ticks they have not reached the floor. All 30,000 moved on every measured tick (1,800,000 total movements); this is not a settled-board benchmark.
* Fully welded boards occupy all cells and weld every horizontal and vertical neighbor pair. The boundary supports them; the conduit mesh has no powered source and tests cached connectivity/neutral-charge work, not a factory of active gates.
* Memory counts unique typed-array/ArrayBuffer backing stores reachable through runtime object properties, arrays, Maps, and Sets from `Simulation`, excluding `World` storage. WeakMaps are not enumerable; the active runtimes are also reachable through ordinary runtime references. These six scenarios have zero such runtime bytes immediately after construction. This is **not total memory**: worlds, baseline/interpolation/authoring snapshots, JS objects, renderer caches, and native Canvas/Path2D storage are excluded. Do not extrapolate it to a per-session total.

### Rendering

A 1000×600 CSS-pixel canvas (1250×750 backing store), dark theme, default bevel setting, no application overlays. The fitted board has 2-pixel cells; zoomed detail uses 16-pixel cells centered on the board. Occupied boards start with unwelded stones on every even row, at x spacing 50/10/5 for 1%/5%/10% occupancy, then advance one gravity tick. Thus body count equals occupied tile count, rather than one large welded body.

| Occupancy | Fitted repaint, run A median / p95 (ms) | Fitted repaint, run B median / p95 (ms) | Fitted interpolated, run B median / p95 (ms) | Zoomed repaint, run B median / p95 (ms) | Zoomed one-cell edit, run B median / p95 (ms) |
|---|---:|---:|---:|---:|---:|
| 0% | 0.5 / 0.6 | 0.4 / 0.7 | — | — | — |
| 1% (1,200) | 0.7 / 1.2 | 0.7 / 0.8 | 0.8 / 0.9 | 0.2 / 0.3 | 1.5 / 1.9 |
| 5% (6,000) | 10.6 / 16.9 | 10.8 / 13.8 | 10.8 / 12.3 | 0.5 / 0.7 | 1.8 / 3.4 |
| 10% (12,000) | 48.4 / 51.9 | 49.2 / 52.0 | 49.4 / 65.1 | 0.9 / 1.3 | 2.2 / 3.4 |

* Each occupancy uses one renderer. Modes run in order: unchanged fitted calls, forced fitted repaint, fitted interpolation, fitted one-cell edits, zoomed repaint, zoomed one-cell edits. Each mode gets its own warmups. Forced repaint varies `progress` as `(i % 60 + 1) / 61` with no previous world, triggering redraw without changing geometry. Interpolation uses the snapshot taken before the gravity tick and the same progress sequence.
* One-cell edit modes alternate (0, 1) between stone and sand before timing `render()`. That cell is **offscreen** in the centered zoomed view: the zoomed edit measures global change detection plus visible redraw, not the cost of rebuilding a visible giant body. Zoom is 8× the fitted scale, via `zoomAtClientPoint` at canvas center.
* Unchanged fitted calls at all four occupancies had median <0.1 ms and p95 0.1 ms in both runs. This is draw suppression, not the cost of an actively redrawn frame or the whole idle workshop.
* Fitted one-cell edits at 10% had median/p95 **49.4/477.0 ms** in run A and **49.1/50.0 ms** in run B. The large tail was not diagnosed; keep it as a reason to capture a timeline/GC/raster trace, not as an attributed code hotspot or a stable expected latency.

The 5% and 10% fitted costs reproduced across both runs. Their cause needs a current trace; the old percentages for `save`, `clip`, and decorations do not explain today's below-six-pixel path.

## Disposition of the original recommendations

Source-checked at the revision above. Durable contracts belong in [rendering](rendering.md), [simulation](simulation.md), and [UI/lifecycle](ui-lifecycle.md), not in another incremental log here.

| Original recommendation | Current status | Remaining scope |
|---|---|---|
| Low-detail rendering and viewport culling | Implemented | Below 6 logical pixels: kind-batched solid fills. Below 12: no decorations; below 24: no bevels. Detailed bodies have transformed AABB culling, but still require cache traversal; partially visible large bodies retain their full cell lists. Profile active work rather than reimplementing LOD/culling. |
| Geometry vs visual revisions | Implemented | Charges/state reuse detailed body paths. Visual refresh still visits cached body cells, including offscreen ones. |
| Chunk-level dirty geometry | Goal addressed by localized **body** rebuilding, not chunks | Geometry changes still scan the board to find changes, then rebuild affected whole welded bodies. Large-body edits and scale changes can remain expensive. Do not add chunking without evidence. |
| Stop continuous static redraws | Partly implemented | Unchanged frames skip clearing/tile drawing. `render()` still checks size/DPR and sets Canvas state; the application still schedules RAF and workshop bookkeeping. Event-driven scheduling remains optional pending idle measurements. |
| Eliminate irrelevant simulation passes | Implemented through feature bitsets and live phase gating | Not all full-buffer work is gone. Piston presence triggers action collection even if no stroke is powered. The alternative once-per-tick full-grid discovery scan is superseded, not another todo. |
| Compact/cache circuit topology | Implemented | Compact shared nodes and forest-wide topology cache; drivers/gates/charges still update each tick. Participating boards still use cell-sized lookup/output arrays. Any tracked geometry/tree change can rebuild the whole forest. |
| Lazy runtime, piston/magnetic/circuit scratch | Largely implemented | Machine resolvers (including pistons), motion, observer topology, and circuit buffers allocate on first use. Magnetic-contact, floating-weight, and powered-motion sub-buffers are lazy. Activated storage remains allocated across removal/reset. |
| Reuse welded topology | Implemented where phase-safe | Observer membership and ordinary welded roots reuse geometry revisions. Contact-free gravity-to-drive reuse exists. Powered probes, magnetic groups, and phase-specific topology still do their required work; do not merge their ownership blindly. |
| Reduce full-array clears / compact occupied-body storage | Partial / open | Several scratch representations are narrower, and some clears are sparse. Ordinary motion and active resolvers still have board-sized arrays/fills/copies. Compact occupied-body storage has not been implemented. |
| Bound inactive session retention | Open | Both sandbox and solution maps retain visited sessions. Lazy allocation reduces unused scratch, not the number of retained worlds or previously activated buffers. |
| Repeatable performance gates | Open | The spot checks above are not a maintained benchmark runner or an end-to-end acceptance suite. |

## Prioritized remaining work

These are profiling/implementation tasks, not assertions that every candidate should be optimized. Preserve deterministic phase ordering, stable IDs, and baseline/simulation/render ownership.

### 1. Establish a repeatable end-to-end baseline

- [ ] Add a small browser benchmark runner with deterministic fixtures and machine-readable results. Record source revision, build mode, browser/version, actual graphics backend, CPU/throttle, DPR/canvas size, occupancy, body size/count, sample/warmup counts, and percentile method. Include cold first use and retained-state runs separately. Do not turn unstable timings into ordinary unit-test assertions.
- [ ] Run production-build workshop scenarios on the development GPU and representative low-end hardware. Use 4× CPU throttling only as a labeled relative proxy, not low-end certification. Collect frame intervals, long tasks, interaction latency, and CPU/GC/raster traces alongside isolated call durations.
- [ ] Attribute complete tick/frame cost: `previousWorld.copyFrom`, simulation, signal sampling, signal-panel derivation/drawing, interpolation/cache preparation, Canvas work, and DOM/layout. Exercise 5 and 60 ticks/s, animation on/off, manual steps, automatic puzzle tests, and fast verification. Fast mode's 8 ms/100-tick cooperative budget checks between indivisible ticks; it is not an enforced maximum frame time.

Minimum workload matrix: 400×300 at 0%, 1%, 5%, and 10% occupancy; continuous falling material; dense stationary welded stone and circuits; representative mixed moving factory; nested arrays; fitted and zoomed views. Include visual-only changes, local edits, giant-body split/merge, sustained movement/rotation, first render, zoom/remount, and unchanged idle frames. Vary board area separately from visible area and occupied/body counts. Keep at least one current small puzzle as a control.

**Exit:** reproducible results and attributed costs, with actual full-frame behavior; no declaration that 400×300 is ready based only on `step()` or suppressed `render()` calls.

### 2. Investigate fitted active rendering

- [ ] Capture a current trace of the reproducible 5%/10% low-detail cases and the long-tail dirty frames. Separate JS/path building, Canvas submission, raster/backpressure, and GC; compare software and hardware rendering before choosing an optimization.
- [ ] Measure `drawLowDetailTiles`, `TranslationInterpolation.prepare`, detailed cache scans/state refresh, large partially visible bodies, and topology/scale rebuilds. Consider cached low-detail batches, sparse visible iteration, more selective visual refresh, or dirty-region/chunk indexing **only for measured costs**. Interpolation and rotation must retain their existing visibility and identity rules.

Source starting points: `src/render/canvas-renderer.ts` (`drawTiles`, `drawLowDetailTiles`, `rebuildChangedBodyGeometry`, `refreshCachedBodyState`), `src/render/translation-interpolation.ts`, and `src/render/rotation-interpolation.ts`.

### 3. Measure and bound retained session memory

- [ ] Visit several large sandboxes and solutions, activate different machines, remove them/reset, navigate away/back, and measure retained/peak memory. Include authoring cases, nested worlds, baseline/previous snapshots, signal histories, renderer objects, native paths/canvases, and first-use allocation spikes. Report typed-array bytes separately from total browser memory.
- [ ] Choose a session retention budget and eviction policy once ownership/cost is measured. A small LRU or serialized inactive state remains a candidate. Returning currently resumes in-memory state; preserve that behavior or explicitly decide a new contract, including paused verification/editing state. Do not silently save only the tick-zero baseline and discard the running state.

Source starting points: `src/game/workshop-session.ts` (`sandboxSessions`, `solutionSessions`), `src/game/sandbox-puzzle-authoring.ts`, and `src/game/workshop-surface-controller.ts`. This is the original unresolved retention task, expanded to both session kinds; resolver laziness does not complete it.

### 4. Profile remaining motion, circuit, and machinery costs

- [ ] Compare steady stationary ticks with geometry-changing ticks. `World.moveBodies` copies cell storage and rebuilds feature indices after actual movement; rotations and some production commits also do board-wide work. Identify costly clears/copies before replacing them with touched lists, stamps, or compact body storage.
- [ ] Measure powered reservation probes, magnetic contacts, floatstone, long force/levitation rays, piston chains/recoil/jams, rotator sweeps, and production-heavy factories. These are missing coverage, not demonstrated regressions. Separate first activation from warm throughput and post-removal retained buffers.
- [ ] Measure circuit-forest rebuilds caused by moving machinery and nested-tree changes, including unrelated non-circuit geometry. Consider more selective invalidation or compact per-board outputs only if rebuilding/storage is material; cached neutral conduit ticks alone cannot settle this.

Source starting points: `src/simulation/motion-workspace.ts`, `world.ts`, `world-features.ts`, `circuit-resolver.ts`, `piston-resolver.ts`, `rotator-resolver.ts`, and machine resolvers. A warm topology cache still leaves per-tick body properties/forces and full-buffer operations. Further width reductions are not automatically the highest-value work.

### 5. Profile signal/UI overhead and idle scheduling

- [ ] Measure zero-monitor, many-monitor, nested, and long-running sessions with the signal panel visible/hidden/collapsed. `SignalTraceRecorder` samples recursively per committed tick and derives lines separately; hiding the panel does not stop recording. Histories grow until reset/world switch. Optimize discovery/derivation or choose a history budget only after measuring, preserving per-tick trace behavior.
- [ ] Measure full idle workshop/menu callbacks, not only `render()` early returns. If material, implement invalidation/deadline-driven scheduling with wakeups for simulation, verification, interpolation completion, effects, camera/input, resize/DPR, theme, and signal UI. Active belts and processing/effect animations legitimately need redraws.
- [ ] Include verification startup, case transitions, completion, imports, large edits, and persistence in interaction-latency measurements. These lie outside isolated tick timings and may create spikes even when warm simulation is cheap.

Source starting points: `src/main.ts` (`advanceSimulation`, `frame`), `src/game/signal-traces.ts`, `src/ui/signal-panel.ts`, `src/game/puzzle-test-controller.ts`, and `src/game/simulation-clock.ts`.

## Proposed budgets, not passing gates

Retain the original targets as provisional until a representative device/workload set is chosen:

* Active rendering: p95 below **12 ms** on the development workstation, leaving headroom within a 16.7 ms frame. Suppressed calls do not count as active-render success; full-frame measurements are required too.
* Normal simulation: p95 below **50 ms** on the workstation and **150 ms** on representative low-end hardware. These are throughput/headroom targets, not guarantees of jank-free animation on the main thread.
* Memory: unused features should not allocate feature-specific runtime scratch. Set a total active/retained-session budget after measuring complete ownership; no current total-MiB target is established.
* Cold starts, topology changes, long-tail/max latency, and high-speed verification must be reported separately rather than hidden in warm medians. The dense simulation spot checks meet the provisional workstation p95 target in isolation; low-end and full-workshop gates remain unverified.

## Keeping this document useful

Update the dated baseline and unresolved checklist in place. Remove completed tasks from the active list and summarize durable behavior in the appropriate architecture reference. Keep historical evidence in its archive/git history rather than appending “Update N” sections. Every new performance claim should name its revision, workload, method, environment, and measurement scope; label hypotheses and unmeasured areas explicitly.
