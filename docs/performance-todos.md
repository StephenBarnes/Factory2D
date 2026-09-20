# Performance status and remaining work

Updated **2026-09-20**. Each measurement section names its source revision and scope. The isolated spot measurements and source-status table remain against `35a9bbc0b7dff729199001c17401350c869222dc`, except the explicitly updated stationary-redraw row. The Firefox comparison uses `a951619c58b75c2a2cb59ebcde234b728a5c5eae` before/after interpolation-aware redraw suppression. Production runner results retain their own source identity and dirty-tree hashes.

This is the active plan, not an optimization changelog. The [original investigation and Updates 1–14](performance-history.md) are archived unchanged. Their timings, hotspot percentages, memory totals, and recommendations describe earlier revisions; do not use them as current baselines or add their memory savings together.

## Current assessment

* **Do not restart the original optimization list.** LOD, culling, geometry caching, sparse feature discovery, cached circuit connectivity, and most lazy-allocation work are implemented. See the status table below.
* **Separate software rasterization from hardware-GPU costs.** The production comparison below identifies a large main-thread Canvas-resource cost on SwiftShader, absent on the RTX 4060 capture. Hardware fitted falling cases have near-refresh RAF cadence, but dense welded cases still reach roughly 50 ms RAF p95. Neither proves low-end readiness or the isolated render budget.
* **Stationary low-detail path construction is now cached.** Dense hardware traces identified repeated construction of 120,000 rectangles per animation frame. Reusing the same combined paths substantially reduces RAF callback work, but the untraced dense-board RAF p95 remains about 50 ms. Tick/interpolation preparation and native Canvas work still need attention; this is not a frame-budget pass.
* **Empty/static-platform simulation is no longer a board-size blocker in isolation.** Dense stationary and moving workloads still cost milliseconds to tens of milliseconds. A 5-tick/s throughput budget does not ensure smooth 60 FPS: a synchronous tick can interrupt a frame.
* **The largest evidence gap remains representative complete-workshop coverage.** A production browser runner measures workshop RAF cadence, long tasks, and thresholded event timing. The saved small geode factory now also has a 50-tick isolated snapshot/simulation/render replay (below); the earlier 400×300 spot measurements still exclude snapshots and UI work. Current low-end-device performance and total retained browser memory are not established.
* **Firefox CPU use is not explained by simulation throughput.** The focused Firefox capture below puts most active geode CPU on the native Canvas thread. Stationary tick interpolation now avoids unnecessary repaints, reducing CPU for a held-piston control, but the animated geode workload remains expensive. Prioritize native Canvas submission/raster work rather than another simulation optimization pass for this report.

The product direction remains up to 400×300 tiles, 5 simulation ticks/s, and 60 FPS animation on low-end hardware. Treat maximum-size 60-tick/s playback as a separate requirement: the dense simulation cases below already exceed its 16.7 ms interval, but that does not mean every maximum-size workload does.

## Firefox CPU investigation — 2026-09-20

Compared the renderer at `a951619c58b75c2a2cb59ebcde234b728a5c5eae` with the interpolation-aware redraw suppression in this change. Headed Playwright Firefox **153.0**, Linux/Ryzen 9 5900X, Vite development modules, 1280×800 viewport, DPR 1.25, canvas 1008×687 CSS / 1260×859 backing pixels. Playback: 5 ticks/s, animation and audio enabled. These are workstation observations, not production or laptop battery measurements.

CPU is the sum of `/proc/<pid>/stat` user+system CPU deltas for the isolated Firefox process tree over an eight-second window, divided by wall time (`CLK_TCK=100`). **100% means one occupied logical CPU**, not the whole machine. Each window starts playback from reset. Baseline source was preserved and served through browser request interception; the current version used a reload without interception. One window per final comparison, not a repeated-run distribution:

| Workload | Original CPU | Updated CPU |
|---|---:|---:|
| 20×15 held-piston control: ROM at (7,14), right-facing piston at (8,14), mallet at (9,14), welded together; 1×1 ROM containing +1 | 40.2% | 12.9% |
| Saved `geode` factory | 94.6% | 95.3% |

The control is a constructed **held-piston** scene, not the user's unsupplied exact small scene or a continuously striking machine. No geode CPU improvement is established. Its active conveyor and processing glyphs still legitimately invalidate frames.

An earlier attributed geode window used about 88% CPU: 40 simulation steps totaled 35 ms across eight seconds, versus 418 ms in 480 synchronous renderer calls. A separate six-second thread sample attributed about 56.5% of one CPU to Firefox's native `CanvasRenderer` thread, versus 7.3% to Web Content. Muting audio did not materially lower total CPU. A native Firefox startup profile also captured Canvas work in libxul and NVIDIA EGL; it is not fully symbolicated, so it does not establish a specific native function as the culprit.

The shipped fix only suppresses unchanged frames when interpolation has no visual work, including fresh stationary snapshots. It preserves moving/rotating/flipping bodies, piston transitions, production effects, and grip-only rotator turns. It also stops hidden conveyor/processing decorations below the 12-pixel cutoff from forcing repaints. A real-Canvas stationary-snapshot probe made four clears with the original renderer and one with the fix. A 60-frame geode pixel comparison, including backward progress seeks, matched byte-for-byte in Firefox. Chromium workshop playback was visually checked; its pixel comparison also exhibited small differences in an original-versus-original control, so no Chromium byte-equivalence claim is made.

Rejected experiments included opaque/software Canvas contexts, grid raster reuse, detailed fill batching, and stationary artwork raster caches. They did not establish a worthwhile visually equivalent improvement: the more elaborate raster cache changed edge pixels and added memory/complexity. None is shipped. **Next target:** reduce the complete animated scene's native Canvas work while preserving clipping, fractional-scale edges, motion ordering, and effects; measure process CPU, not only JavaScript timings or RAF cadence.

Local evidence: `temp/firefox-cpu-results.json`, `temp/simple-perf-scene.json`, and `temp/firefox-canvas-profile.json`. The existing geode fixture remains unchanged. Reproduce CPU sampling with the same viewport/DPR, browser mode, eight-second reset/play windows, and summed process-tree CPU deltas; the maintained Chromium benchmark does not measure these Firefox CPU costs.

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
| Stop continuous static redraws | Partly implemented | Stationary interpolation progress/snapshots no longer force repaints; hidden time-based glyphs respect the decoration cutoff. `render()` still checks size/DPR and interpolation state; the application still schedules RAF and workshop bookkeeping. Event-driven scheduling remains optional pending idle measurements. |
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

- [ ] Extend the maintained browser runner below to the remaining workload matrix, repeated cold-start distributions, and isolated/attributed call timings. Its eight fixtures cover root-board occupancy, falling stones, dense welded stone/conduits, a small puzzle control, and the saved geode factory. The geode replay separates snapshot, step, and render calls, but does not complete this priority's exit criteria.
- [ ] Extend the production GPU measurements below to the remaining workshop matrix and representative low-end hardware. Use 4× CPU throttling only as a labeled relative proxy, not low-end certification. Collect frame intervals, long tasks, interaction latency, and CPU/GC/raster traces alongside isolated call durations.
- [ ] Attribute complete tick/frame cost: `previousWorld.copyFrom`, simulation, signal sampling, signal-panel derivation/drawing, interpolation/cache preparation, Canvas work, and DOM/layout. Exercise 5 and 60 ticks/s, animation on/off, manual steps, automatic puzzle tests, and fast verification. Fast mode's 8 ms/100-tick cooperative budget checks between indivisible ticks; it is not an enforced maximum frame time.
- [ ] Extend the Firefox CPU capture above to the user's exact small scene, display/DPR, and a production build. The native Canvas thread dominates the captured geode workload; reducing stationary repaints helps the held-piston control but not the active factory. Fully symbolize the native profile and validate any rendering change against both CPU and pixels.

Minimum workload matrix: 400×300 at 0%, 1%, 5%, and 10% occupancy; continuous falling material; dense stationary welded stone and circuits; representative mixed moving factory; nested arrays; fitted and zoomed views. Include visual-only changes, local edits, giant-body split/merge, sustained movement/rotation, first render, zoom/remount, and unchanged idle frames. Vary board area separately from visible area and occupied/body counts. Keep at least one current small puzzle as a control.

**Exit:** reproducible results and attributed costs, with actual full-frame behavior; no declaration that 400×300 is ready based only on `step()` or suppressed `render()` calls.

#### Running the workshop baseline

`npm run benchmark` builds production assets and a separate benchmark-only replay page, starts an isolated Vite preview on port 4174, and drives the real workshop through Playwright. Install its Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` as for the browser suite. No benchmark hooks enter the application bundle; ordinary `npm run build` does not build the replay page. Only workload validity fails the run (browser errors, failed imports/steps, no active tick advancement, divergent replays, or a falling fixture reaching its settling bound); unstable timings are never assertions.

The default is one worker, fresh browser context per fixture, a 1280×800 viewport at DPR 1.25, fitted view, animations enabled, 5 ticks/s, 15 RAF warmups, and 120 requested frame intervals per idle/active window. Eight deterministic fixtures live in `tools/benchmark/fixtures.ts`: `empty`, `falling-1`, `falling-5`, `falling-10`, `welded-stone`, `welded-conduit`, `stone-drop`, and `geode`. **Geode's active window advances 50 ticks instead of counting frames**, followed by its isolated replay. Falling stones occupy upper checkerboard rows with documented clearance; **these placements differ from the earlier spot checks**. The small puzzle scenes run as sandboxes, not automatic puzzle tests.

Each fixture writes `result.json` and `workshop.png` under `test-results/benchmark/`. JSON includes raw samples, nearest-rank p50/p95/max, actual sample counts, first-import/manual-step action latency, separate idle/retained-active windows, source revision and dirty-tree hashes, scene hash, browser/version, CDP graphics backend, host CPU, throttle, canvas CSS/backing sizes, and initial root occupancy/body-size metadata. First use means the fixture's first import/step **after shell startup**, not a cold browser or cold-JIT distribution. Warmup counts are RAF callbacks, not simulation ticks.

Useful runs:

```sh
npm run benchmark
BENCH_FIXTURES=falling-5,falling-10 BENCH_TRACE=1 npm run benchmark -- --output temp/fitted-trace
BENCH_FIXTURES=empty BENCH_SAMPLES=30 BENCH_SPEED=60 BENCH_ANIMATE=0 BENCH_VIEW=zoomed BENCH_THROTTLE=4 npm run benchmark -- --output temp/options-smoke
BENCH_HEADED=1 npm run benchmark -- --output temp/headed-baseline
BENCH_FIXTURES=geode npm run benchmark -- --output temp/geode-baseline
BENCH_FIXTURES=geode BENCH_HEADED=1 npm run benchmark -- --output temp/geode-gpu
```

`BENCH_SAMPLES` and `BENCH_WARMUP` override frame counts; use enough samples to observe committed ticks. `BENCH_SPEED` accepts 5/60, `BENCH_THROTTLE` accepts 1/4, and `BENCH_VIEW` accepts fitted/zoomed (requests 8× center zoom, subject to the normal cell-size cap). A 4× throttle is only a relative proxy. Headed mode does not guarantee hardware acceleration: inspect `environment.graphics`. Playwright clears the selected output directory on the next run; use distinct `--output` paths to preserve comparisons.

For `geode`, `BENCH_TICKS` defaults to 50 and controls both the active workshop tick advancement and the isolated replay length; `BENCH_RUNS` defaults to 3 fresh tick-zero replay pairs. These are positive integers. `BENCH_SAMPLES` still controls geode's idle window. The isolated page uses the workshop's canvas CSS dimensions, DPR, view and animation/speed settings, recording its results under `result.json.isolated` and a final `isolated.png` screenshot.

Each isolated pair first times simulation-only `step()` calls synchronously, then reimports the original scene and separately times `previousWorld.copyFrom`, `step(previousWorld)`, and synchronous `render()` submission. Animated 5-tick/s replay samples 12 smoothstep progress values per tick, one per RAF; animations off or 60 ticks/s uses one committed frame per tick. Slow backends stretch wall time rather than skipping ticks/frames. This is a fixed replay, **not the workshop scheduler or raster-completion timing**. Raw per-call samples, totals, p50/p95/max, first fitted render, RAF intervals, wall time and per-tick movement counts are retained. Import/construction/serialization are untimed. No tick warmup consumes the scene: all passes start at zero with fresh world/runtime/renderer caches; later passes retain browser/JIT state, and simulation-only precedes rendered replay. Every pair must agree on final serialized state and every tick's movement count, as must repeated final states. Timer-resolution zeros do not mean no work. There are no timing pass/fail thresholds.

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

Local raw results, screenshots, traces, and generated summaries remain in those output directories; they are not checked-in timing gates. Headed GPU availability depends on the display/driver environment: verify `environment.graphics` on every run. Large mixed factories, nested arrays, targeted dirty split/merge frames, rotation, remounts, puzzle verification/case transitions, repeated cold starts, memory retention, and full tick-phase attribution remain open. The small geode factory below adds snapshot/step/render attribution separately. Dense welded hardware traces and the stationary-path optimization are covered next.

#### Stationary low-detail paths: measured optimization

Measured 2026-09-19 against clean `8136bfebf05e8f48cd8fefc2547dd3d639b21238`, then the same revision with the stationary-path cache and renderer regressions (tracked diff SHA-256 `0cf53b06b5d81ba0a844b522ddd7b56e55bce24809dc531747897e50fca07651`). Production Chromium **151.0.7922.34**, Ryzen 9 5900X, CDP-confirmed NVIDIA RTX 4060/OpenGL 580.173.02, no throttle, viewport 1280×800 at DPR 1.25; fitted canvas 1008×728 CSS / 1260×910 backing pixels. Animation on, 5 ticks/s, 15 RAF warmups. One untraced run per fixture/version, **120 requested active intervals**; separate traces request 90. All workload validity checks passed.

| Fixture | Untraced RAF p95 before / after (ms) | Untraced max before / after (ms) | Long tasks before / after |
|---|---:|---:|---:|
| `welded-stone` | 49.9 / 50.0 | 66.7 / 50.1 | 6 / 10 |
| `welded-conduit` | 50.0 / 50.0 | 66.6 / 66.6 | 9 / 12 |
| `falling-10` | 16.7 / 16.7 | 16.8 / 16.8 | 0 / 0 |

Untraced actual interval counts were stone 119→120, conduit 122→120, falling 120→120; median was 16.7 ms throughout. **No improvement in p95 or long-task counts is established.** The moving fixture intentionally retains its original drawing path.

The separate stone trace sampled about **802 ms** in `Path2D.rect`, **1,362 ms** inclusive under `render`, and **242 ms** inclusive under simulation `step` in its 1,920.6 ms active window. After caching, inclusive sampled render time was about **194 ms**, while step was **325 ms**, in a 1,845.9 ms window. These are CPU-profiler sample-delta estimates, not isolated call timings; nested inclusive costs overlap and tracing perturbs execution. In the offline timeline summaries, `FireAnimationFrame` union coverage fell **1,651.4→558.5 ms** for stone and **1,826.2→651.4 ms** for conduit. Stone collected 92→90 active RAF intervals; conduit 91→90 over 2,087.9→1,942.3 ms. Callback coverage includes benchmark callbacks and is neither per-frame latency nor displayed FPS. Slow tick frames remain despite much less between-tick work.

A post-change production **SwiftShader** run used the same settings except headless mode and 60 requested/actual active intervals per fixture. Stone RAF p50/p95/max was **316.7/350.0/366.6 ms**, conduit **333.3/366.7/383.3 ms**, and falling-10 **16.8/33.4/33.4 ms**, with 62/62/0 long tasks respectively. All validity checks passed. These results confirm that dense software rendering is still severely stalled; there is no matched pre-change software run here, so no software speedup is claimed. Artifacts are in `temp/dense-software-after`.

The renderer now retains stationary combined per-kind paths, keyed by geometry revision and camera/viewport geometry. Moving/rotating frames invalidate that cache; no per-rectangle or row-separated fills were introduced. A separate real-Canvas comparison against the original renderer at DPR 1.25 found identical RGBA bytes in **36 frames** covering fractional 2.13-pixel cells, dense adjacent fills, theme changes, fresh stationary snapshots, kind/removal edits, fractional pan, viewport expansion, detail-level changes, translation, piston extension, and actual rotator turns. Two permanent regressions cover stale painted geometry after edits/camera changes and seeks between committed/moving frames. This does not constitute the full visual/workload matrix.

Reproduction and local evidence:

```sh
# Run on each source version, using distinct output directories:
BENCH_FIXTURES=welded-stone,welded-conduit,falling-10 BENCH_SAMPLES=120 BENCH_HEADED=1 npm run benchmark -- --output temp/dense-after
BENCH_FIXTURES=welded-stone,welded-conduit BENCH_SAMPLES=90 BENCH_HEADED=1 BENCH_TRACE=1 npm run benchmark -- --output temp/dense-after-trace
npm run benchmark:trace -- temp/dense-after-trace/workshop.bench.ts-welded-stone/result.json
npm run benchmark:trace -- temp/dense-after-trace/workshop.bench.ts-welded-conduit/result.json
BENCH_FIXTURES=welded-stone,welded-conduit,falling-10 BENCH_SAMPLES=60 npm run benchmark -- --output temp/dense-software-after
```

Corresponding pre-change artifacts are in `temp/dense-before` and `temp/dense-before-trace`; pixel comparison results/screenshot are `temp/low-detail-pixel-comparison.{json,png}`. **Next dense-board target:** attribute slow tick frames to motion, snapshot copying, and interpolation identity preparation separately. The post-change stone CPU sample profile includes about 144 ms in interpolation `prepare` and 324 ms in ordinary motion over the active window; these are investigation leads, not grounds to merge phase ownership or cache dynamic state without invalidation.

#### Saved geode factory: 50-tick baseline

Measured 2026-09-17 at `867c6ad2190d3a21b5f563369df72f5cb3404dc1` plus the new benchmark tooling, with no simulation/rendering changes. The original `temp/geode-bench-scene.json` is preserved byte-for-byte as `tools/benchmark/fixtures/geode.json` (scene SHA-256 `470c27d45a27d83f02f021f907301ee6b63598c4be043a21050996be22c38711`). It is **11×12**, initially **86 occupied cells**, **3 welded bodies**, largest **80 cells**: conveyors, drills, duplicators, delivery and circuits, with geometry changing during extraction. This is a small detailed-rendering workload, not another fitted low-detail large board.

Untraced production Chromium **151.0.7922.34**, Ryzen 9 5900X, no CPU throttle, fitted view, dark theme/default bevels, animations on, 5 ticks/s. Viewport 1280×800 at DPR 1.25; canvas 1008×728 CSS / 1260×910 backing pixels. CDP confirmed headless SwiftShader and headed NVIDIA RTX 4060/OpenGL (580.173.02). Each backend ran one workshop window advancing ticks **2→52** after its first step/warmup, then **three fresh 0→50 isolated replay pairs**. Each rendered replay made 600 timed calls. These are single-session observations, not cold-start distributions or low-end certification.

| Measurement | SwiftShader | RTX 4060 |
|---|---:|---:|
| Simulation-only, 50 ticks total, passes 1 / 2 / 3 (ms) | 14.6 / 5.2 / 4.6 | 25.4 / 6.5 / 5.5 |
| Snapshot copies, total per 50-tick rendered pass (ms) | 1.0 | 0.4–0.8 |
| Simulation with interpolation source, total per rendered pass (ms) | 7.8–9.5 | 7.1–9.1 |
| First fitted render, passes 1 / 2 / 3 (ms) | 7.7 / 0.8 / 0.5 | 8.0 / 0.9 / 0.7 |
| 600 synchronous render calls, total per pass (ms) | 223.6–265.0 | 233.2–268.4 |
| Synchronous render p95 / worst call across passes (ms) | 0.6–0.7 / 1.6 | 0.6–0.7 / 1.8 |
| Workshop active RAF p50 / p95 / max (ms) | 16.7 / 16.8 / 16.8 | 16.7 / 16.7 / 16.8 |
| Workshop active long tasks | 0 | 0 |

Both workshop windows collected 596 RAF intervals over about 9.95 seconds. Each isolated animated pass took about 10 seconds because it was RAF-paced; **that wall time is not ten seconds of simulation/render CPU work**. All replay state/movement equivalence checks passed, with 278 tile movements over each 50-tick replay. Rendering is the larger accumulated synchronous cost here, but the observed call times and workshop cadence do not explain the reported slow session. No optimization or claim that the original slowdown is resolved follows from this baseline. Capture the affected environment/session next, rather than extending the old large-board hotspot attribution to this scene.

Reproduction and retained local artifacts:

```sh
BENCH_FIXTURES=geode BENCH_RUNS=3 BENCH_SAMPLES=90 npm run benchmark -- --output temp/geode-software-50
BENCH_FIXTURES=geode BENCH_RUNS=1 BENCH_SAMPLES=90 BENCH_HEADED=1 BENCH_TRACE=1 npm run benchmark -- --output temp/geode-hardware-trace
npm run benchmark:trace -- temp/geode-hardware-trace/workshop.bench.ts-geode/result.json
BENCH_FIXTURES=geode BENCH_RUNS=3 BENCH_SAMPLES=90 BENCH_HEADED=1 npm run benchmark -- --output temp/geode-hardware
```

The final `result.json` contains raw call timings and serialized final state; screenshots show the real workshop and isolated replay. Source/diff hashes distinguish the runner revisions used in each capture. The earlier `temp/geode-software` smoke capture used only 90 active workshop frames; it is **not** the 50-tick workshop baseline tabulated here.

A separate hardware trace passed with workshop RAF p95 **16.8 ms**, max **33.3 ms**, and zero long tasks. In its active window, `FireAnimationFrame` slices covered 549.3 ms (max 4.7 ms), Canvas resource production 193.5 ms (max 1.1 ms), and recorded major/minor GC slices 7.0/5.6 ms. These groups overlap and are not exclusive render/CPU totals; tracing perturbs timings. The offline summary covers workshop windows, while raw `benchmark:isolated-*` marks locate the replay in the full trace. This capture likewise does not identify a sustained stall.

Option smoke coverage also passed for `empty,geode` with `BENCH_SPEED=60 BENCH_ANIMATE=0 BENCH_VIEW=zoomed BENCH_THROTTLE=4 BENCH_RUNS=1 BENCH_SAMPLES=30`, saved under `temp/geode-options-smoke`. It exercises the single-committed-frame replay and existing fixture path; its throttled zoomed timings are not the fitted 5-tick/s baseline above.

### 2. Investigate fitted active rendering

- [ ] Trace remaining dirty-frame tails and moving workloads; separate native rasterization/backpressure from JS/path construction. Dense welded hardware attribution is now available above. The earlier fitted 5%/10% comparison establishes a large software-specific Canvas-resource cost, not its native implementation cause.
- [ ] Measure `TranslationInterpolation.prepare`, detailed cache scans/state refresh, large partially visible bodies, and topology/scale rebuilds. Stationary low-detail batches are now cached; investigate moving-batch reuse, sparse visible iteration, more selective visual refresh, or dirty-region/chunk indexing **only for measured costs**. Compare candidates on both backends and check fractional-cell seams and overlapping same-kind cells, not only throughput. Interpolation and rotation must retain their existing visibility and identity rules.

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
