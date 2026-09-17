# Performance status and remaining work

Updated **2026-09-17**. The isolated spot measurements and source-status table below remain against revision `35a9bbc0b7dff729199001c17401350c869222dc`. The production workshop comparison uses `a00c9409fac594e87e3f174bb373e2a5f7715c8c`; each runner result records its own source identity and dirty-tree hashes.

This is the active plan, not an optimization changelog. The [original investigation and Updates 1–14](performance-history.md) are archived unchanged. Their timings, hotspot percentages, memory totals, and recommendations describe earlier revisions; do not use them as current baselines or add their memory savings together.

## Current assessment

* **Do not restart the original optimization list.** LOD, culling, geometry caching, sparse feature discovery, cached circuit connectivity, and most lazy-allocation work are implemented. See the status table below.
* **Separate software rasterization from hardware-GPU costs.** The production comparison below identifies a large main-thread Canvas-resource cost on SwiftShader, absent on the RTX 4060 capture. Hardware fitted falling cases have near-refresh RAF cadence, but dense welded cases still reach roughly 50 ms RAF p95. Neither proves low-end readiness or the isolated render budget.
* **Empty/static-platform simulation is no longer a board-size blocker in isolation.** Dense stationary and moving workloads still cost milliseconds to tens of milliseconds. A 5-tick/s throughput budget does not ensure smooth 60 FPS: a synchronous tick can interrupt a frame.
* **The largest evidence gap remains representative complete-workshop coverage.** A production browser runner now measures workshop RAF cadence, long tasks, and thresholded event timing for a deterministic initial subset (usage below). The isolated measurements below still exclude snapshot copying, signal capture, much of the UI, case transitions, and persistence. Current low-end-device performance and total retained browser memory are not established.

The product direction remains up to 400×300 tiles, 5 simulation ticks/s, and 60 FPS animation on low-end hardware. Treat maximum-size 60-tick/s playback as a separate requirement: the dense simulation cases below already exceed its 16.7 ms interval, but that does not mean every maximum-size workload does.

## Fresh spot measurements

### Method and limits

These are scoped observations, not release gates or a CPU hotspot profile:

* Run on 2026-09-16 through Vite development modules in an isolated browser page, without the application's animation loop. Host: Ryzen 9 5900X workstation. Browser: headless Chromium **146.0.7680.71**, no CPU throttle applied; CDP reported **ANGLE/SwiftShader software rendering**, not the NVIDIA GPU. Browser device-pixel ratio was **1.25**.
* Each scenario uses a fresh 400×300 `World` populated through `place`/`setWeld`. Timing uses `performance.now()`. Report median and nearest-rank p95 over **60 samples** after **15 warmup calls**; the simulation additionally records one first tick before warmup. Values rounded to 0.1 ms; zero means below effective timer resolution, not no work.
* Simulation timings cover `step()` only, without an interpolation-source world. Placement, construction, buffer inspection, rendering, and snapshots are outside the timed interval. First ticks are single observations with different JIT/allocation conditions, not a cold-start distribution.
* Rendering timings cover the synchronous `render()` call, including its preparation and Canvas submission, not completion of raster/compositor work or displayed frame intervals. Calls yield through `setTimeout(0)` between samples, not paced animation frames. An initial RAF-paced attempt timed out and is not included. Two completed render passes are reported separately where relevant; no before/after speedup is inferred from historical runs.
* No production-build, physical low-end, 4×-throttled, mixed-factory, nested-array, real-GPU, or full-workshop measurements were performed in this isolated spot refresh. The later production comparison below covers a subset separately.

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

The 5% and 10% fitted costs reproduced across both runs. The later production traces use different placements and a newer browser; they identify a software-backend Canvas-resource bottleneck, not a retrospective native-code explanation for these exact spot measurements.

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
| Repeatable performance gates | Runner implemented; gates open | The production workshop runner provides raw observations, not timing assertions. Complete the workload/device matrix and phase attribution before choosing gates. |

## Prioritized remaining work

These are profiling/implementation tasks, not assertions that every candidate should be optimized. Preserve deterministic phase ordering, stable IDs, and baseline/simulation/render ownership.

### 1. Establish a repeatable end-to-end baseline

- [ ] Extend the maintained browser runner below to the remaining workload matrix, repeated cold-start distributions, and isolated/attributed call timings. Its initial seven fixtures cover root-board occupancy, falling stones, dense welded stone/conduits, and a small puzzle scene; they do not complete this priority's exit criteria.
- [ ] Extend the production GPU measurements below to the remaining workshop matrix and representative low-end hardware. Use 4× CPU throttling only as a labeled relative proxy, not low-end certification. Collect frame intervals, long tasks, interaction latency, and CPU/GC/raster traces alongside isolated call durations.
- [ ] Attribute complete tick/frame cost: `previousWorld.copyFrom`, simulation, signal sampling, signal-panel derivation/drawing, interpolation/cache preparation, Canvas work, and DOM/layout. Exercise 5 and 60 ticks/s, animation on/off, manual steps, automatic puzzle tests, and fast verification. Fast mode's 8 ms/100-tick cooperative budget checks between indivisible ticks; it is not an enforced maximum frame time.

Minimum workload matrix: 400×300 at 0%, 1%, 5%, and 10% occupancy; continuous falling material; dense stationary welded stone and circuits; representative mixed moving factory; nested arrays; fitted and zoomed views. Include visual-only changes, local edits, giant-body split/merge, sustained movement/rotation, first render, zoom/remount, and unchanged idle frames. Vary board area separately from visible area and occupied/body counts. Keep at least one current small puzzle as a control.

**Exit:** reproducible results and attributed costs, with actual full-frame behavior; no declaration that 400×300 is ready based only on `step()` or suppressed `render()` calls.

#### Running the workshop baseline

`npm run benchmark` builds production assets, starts an isolated Vite preview on port 4174, and drives the real workshop through Playwright. Install its Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` as for the browser suite. No benchmark hooks enter the production bundle. Only workload validity fails the run (browser errors, failed imports/steps, no active tick advancement, or a falling fixture reaching its settling bound); unstable timings are never assertions.

The default is one worker, fresh browser context per fixture, a 1280×800 viewport at DPR 1.25, fitted view, animations enabled, 5 ticks/s, 15 RAF warmups, and 120 requested frame intervals per idle/active window. Seven deterministic fixtures live in `tools/benchmark/fixtures.ts`: `empty`, `falling-1`, `falling-5`, `falling-10`, `welded-stone`, `welded-conduit`, and `stone-drop`. Falling stones occupy upper checkerboard rows with documented clearance; **these placements differ from the earlier spot checks**. The small puzzle solution runs as a sandbox scene, not as an automatic puzzle test.

Each fixture writes `result.json` and `workshop.png` under `test-results/benchmark/`. JSON includes raw samples, nearest-rank p50/p95/max, actual sample counts, first-import/manual-step action latency, separate idle/retained-active windows, source revision and dirty-tree hashes, scene hash, browser/version, CDP graphics backend, host CPU, throttle, canvas CSS/backing sizes, and initial root occupancy/body-size metadata. First use means the fixture's first import/step **after shell startup**, not a cold browser or cold-JIT distribution. Warmup counts are RAF callbacks, not simulation ticks.

Useful runs:

```sh
npm run benchmark
BENCH_FIXTURES=falling-5,falling-10 BENCH_TRACE=1 npm run benchmark -- --output temp/fitted-trace
BENCH_FIXTURES=empty BENCH_SAMPLES=30 BENCH_SPEED=60 BENCH_ANIMATE=0 BENCH_VIEW=zoomed BENCH_THROTTLE=4 npm run benchmark -- --output temp/options-smoke
BENCH_HEADED=1 npm run benchmark -- --output temp/headed-baseline
```

`BENCH_SAMPLES` and `BENCH_WARMUP` override frame counts; use enough samples to observe committed ticks. `BENCH_SPEED` accepts 5/60, `BENCH_THROTTLE` accepts 1/4, and `BENCH_VIEW` accepts fitted/zoomed (requests 8× center zoom, subject to the normal cell-size cap). A 4× throttle is only a relative proxy. Headed mode does not guarantee hardware acceleration: inspect `environment.graphics`. Playwright clears the selected output directory on the next run; use distinct `--output` paths to preserve comparisons.

High-speed or heavily throttled falling runs can exhaust their finite clearances before the requested frames finish. Completed windows are saved with `validity.valid: false` and reasons before failing the run; do not treat them as continuous-falling measurements. Reduce frame counts or select a stationary workload. The empty-fixture command above is an option smoke check, not a loaded 60-tick/s performance result.

`BENCH_TRACE=1` additionally writes `chrome-trace.json` with CPU samples, timeline/GC and compositor/raster events, plus `benchmark:` phase marks, for inspection in Chrome's Performance panel or Perfetto. Capture traces separately from untraced timing baselines because profiling changes timings. RAF intervals describe callback cadence, **not displayed FPS or isolated Canvas time**. Event Timing is thresholded and may omit events still awaiting presentation at the window boundary; unsupported observers report null, not zero. Host action latency includes automation and two subsequent RAF callbacks, not input-to-photon latency.

`npm run benchmark:trace -- <fixture-directory>/result.json` summarizes the sibling `chrome-trace.json` offline and writes `trace-summary.json`. This command uses Node's native TypeScript support (Node 22.18+ or 24+). It aligns the trace mark's browser timestamp with the measurement window, clips intersecting complete slices, and reports per-thread/category/event count, union coverage, and nearest-rank slice-duration p50/p95/max. The console shows the top twelve main-thread groups; JSON retains all renderer-process groups and the run's source/environment/workload/validity. **Different groups overlap; do not add their times.** These are not exclusive JS costs, per-frame totals, or GPU-process execution times. Missing events are not proven zero work. The input trace and result must come from the same fixture run.

#### Production workshop comparison

Measured 2026-09-17 at `a00c9409fac594e87e3f174bb373e2a5f7715c8c`, using the maintained fixtures and production bundle. Headless inputs were clean; headed inputs include only uncommitted offline trace-tool/package/test work, not application changes (exact identities in each `result.json`). Host: Ryzen 9 5900X, Chromium **151.0.7922.34**, no throttle, 1280×800 viewport, DPR 1.25; canvas 1008×728 CSS pixels / 1260×910 backing pixels. CDP confirmed headless **ANGLE/SwiftShader** and headed **ANGLE/OpenGL NVIDIA RTX 4060**, driver 580.173.02. This is one workstation, not a low-end certification.

One untraced run per backend/fixture, fitted view, 5 ticks/s, animation enabled, 15 RAF warmups and **90 measured active RAF intervals**. All validity checks passed. These are callback intervals, not displayed FPS or isolated render timings; different wall-clock durations mean different committed tick counts, especially in the slow dense cases.

| Fixture | SwiftShader RAF p50 / p95 / max (ms) | RTX 4060 RAF p50 / p95 / max (ms) | Long tasks, software / GPU |
|---|---:|---:|---:|
| `falling-5` | 16.7 / 33.4 / 33.4 | 16.7 / 16.7 / 16.8 | 0 / 0 |
| `falling-10` | 33.3 / 50.0 / 50.0 | 16.7 / 16.8 / 33.3 | 1 / 0 |
| `welded-stone` | 366.7 / 416.6 / 450.0 | 16.7 / 49.9 / 50.1 | 92 / 5 |
| `welded-conduit` | 383.3 / 433.4 / 483.4 | 16.7 / 50.0 / 66.7 | 92 / 5 |

Separate traced 5%/10% runs used the same settings. In the 10% active window, main-thread `Canvas2DResourceProviderSharedImage::ProduceCanvasResource` covered **2,181.5 ms** of a 2,605.2 ms software window, with a **39.0 ms** maximum slice. On hardware it covered **18.6 ms** of a 1,530.1 ms window, maximum **0.177 ms**. `FireAnimationFrame` coverage was 339.6 / 436.1 ms respectively; these include application and benchmark callbacks, not just `render()`. Software recorded one 0.5 ms `MinorGC` slice and no `MajorGC` slices in that active window. Many Canvas-resource calls are tiny: their slice p95 is not a game-frame budget. The raw timeline, not summed nested event groups, establishes that the dominant software stall is outside the RAF callbacks during Canvas resource production. Native rasterization versus backpressure remains unresolved.

A separate Canvas correctness probe compared one combined rectangle path, per-rectangle fills, and row-sized paths. Both alternatives **were rejected**: on a dense 30×30 grid at 2.13-pixel cells with fractional origin (0.17, 0.37), readback and visual inspection showed internal seams absent from the combined path. No renderer optimization was shipped. Any replacement must preserve fractional-scale coverage, same-kind overlap, interpolation, and rotation before its timing matters.

Reproduce the production comparison and attribution:

```sh
BENCH_FIXTURES=falling-5,falling-10,welded-stone,welded-conduit BENCH_SAMPLES=90 npm run benchmark -- --output temp/fitted-before
BENCH_FIXTURES=falling-5,falling-10,welded-stone,welded-conduit BENCH_SAMPLES=90 BENCH_HEADED=1 npm run benchmark -- --output temp/fitted-headed
BENCH_FIXTURES=falling-5,falling-10 BENCH_SAMPLES=90 BENCH_TRACE=1 npm run benchmark -- --output temp/fitted-before-trace
BENCH_FIXTURES=falling-5,falling-10 BENCH_SAMPLES=90 BENCH_TRACE=1 BENCH_HEADED=1 npm run benchmark -- --output temp/fitted-headed-trace
npm run benchmark:trace -- temp/fitted-before-trace/workshop.bench.ts-falling-10/result.json
npm run benchmark:trace -- temp/fitted-headed-trace/workshop.bench.ts-falling-10/result.json
```

Local raw results, screenshots, traces, and generated summaries remain in those output directories; they are not checked-in timing gates. Headed GPU availability depends on the display/driver environment: verify `environment.graphics` on every run. Mixed factories, nested arrays, dirty split/merge frames, rotation, remounts, puzzle verification/case transitions, repeated cold starts, memory retention, and isolated tick-phase attribution remain open. **Next measured target:** trace the dense welded cases on hardware to distinguish synchronous tick/snapshot work from Canvas cost; do not infer that split from the sparse traces.

### 2. Investigate fitted active rendering

- [ ] Trace dirty-frame tails and dense welded hardware cases; separate native rasterization/backpressure from JS/path construction. The fitted 5%/10% production comparison above establishes a large software-specific Canvas-resource cost, not its native implementation cause.
- [ ] Measure `drawLowDetailTiles`, `TranslationInterpolation.prepare`, detailed cache scans/state refresh, large partially visible bodies, and topology/scale rebuilds. Compare any low-detail candidate on both backends and check fractional-cell seams and overlapping same-kind cells, not only throughput. Consider cached low-detail batches, sparse visible iteration, more selective visual refresh, or dirty-region/chunk indexing **only for measured costs**. Interpolation and rotation must retain their existing visibility and identity rules.

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
