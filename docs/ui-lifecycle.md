# UI and application lifecycle reference

For tools, controls, dialogs, routing, saved designs, puzzle authoring, and verification. See [rendering](rendering.md) for Canvas drawing and [simulation](simulation.md) for world behavior and scene serialization.

## Ownership and entry points

* `src/main.ts` wires DOM events, active controllers, and the animation loop. `index.html` and `src/styles.css` define the framework-free shell and responsive layout.
* `src/game/navigation-controller.ts` owns screen transitions. `screen.ts` defines the complete tagged `AppScreen`; `app-route.ts` defines canonical paths and access checks.
* `saved-sandbox-controller.ts` and `saved-solution-controller.ts` own records and dirty sets; `saved-sandboxes.ts` and `puzzle-solutions.ts` own validated storage models.
* `workshop-session.ts` owns per-saved-ID sessions and editing locks. `workshop-surface-controller.ts` atomically mounts all session-bound world/view references and the nested-array path, cancelling gestures before rebinding.
* `puzzle-test-controller.ts` owns the tagged verification UI lifecycle; `puzzle-test-runner.ts` runs isolated cases. `src/ui/canvas-interaction-controller.ts` owns pointer capture and gesture state.

Use these ownership boundaries rather than adding parallel session state to the entry point.

## Navigation and persistence invariants

Canonical routes are `/`, `/sandbox`, `/sandbox/:sandboxId`, `/puzzles/:puzzleId`, and `/puzzles/:puzzleId/solutions/:solutionId`. Both in-app navigation and browser Back/Forward pass through the same access checks. Unknown/malformed routes and locked puzzles resolve to `/`; missing sandboxes resolve to their briefing; missing or wrongly owned solutions resolve to the unlocked puzzle's briefing. Noncanonical paths are replaced, not added to history.

Persist the active dirty workshop before every transition; `pagehide` is the final boundary. Creation, duplication, deletion, completed edit gestures, imports, property changes, case changes, and clearing persist immediately. Sandbox snapshots contain the complete authoring workspace and selected case; solutions contain the editable baseline and optional scores. Sessions are created lazily per saved ID and reused on return; deleting a record also forgets its session.

A session has four related runtime references:

* `world`: current mutable simulation state.
* `simulation`: advances that world.
* `baseline`: tick-zero editable design used for reset and persistence.
* `previousWorld`: render-only interpolation state, copied before stepping and synchronized after edits/reset.

Import replacement updates them together and starts the simulation at the imported tick. Only `WorkshopSurfaceController` supplies active session references to the browser entry point. Simulation never writes into the baseline.

Accepted sandbox edits copy the current world to baseline. Puzzle edits transfer only editable cells, configurable state, and permitted welds to the canonical baseline, never the selected test case's fixed terrain. Edits reset tick/result, synchronize previous state, and mark the record dirty. Starting or stepping calls `beginSimulation` before the first tick; puzzles remain locked until reset, while sandboxes remain editable. Reset stops running, rebuilds the selected case from fixed state plus baseline, unlocks editing, and synchronizes interpolation.

## Workshop editing contracts

* `component-palette.ts` derives categories, visible-order shortcuts, and availability from tile metadata and the puzzle catalog. Sandbox palettes stay complete/unpriced even though new authored puzzle catalogs start disabled. Suggested authoring prices come from `TileDefinition.defaultPrice`; enabled saved/imported prices are explicit. Empty puzzle catalogs are valid and select the weld tool.
* The palette sidebar's right-edge separator supports pointer dragging, Left/Right adjustments, Home/End limits, and double-click reset. Width is retained across in-app navigation, not reloads, and bounded to preserve board space. Narrow palettes shrink component icons and move the workshop title below its buttons.
* `canvas-interaction-controller.ts`, `src/render/pointer-gesture.ts`, and `grid-drag.ts` classify gestures and provide continuous grid traversal. Cancel pending gestures on blur, capture loss, stale initiating-button masks, or session changes. Palette/snippet drag-and-drop follows the same edit and cancellation policies as board tools.
* Simulation ticks retain sandbox tile-placement, erasure, and weld/unweld pointer capture, committing changed segments before stepping. Holding a gesture without further edits does not update the baseline. Selection, editable-region, and text-box gestures finish before stepping; puzzle edits still end before simulation locks editing.
* Ordinary placement welds consecutive eligible cells along the drag path; Shift placement welds all eligible neighbors. Fast diagonals use an edge-connected staircase. Weld edits respect tile eligibility and editable perimeter/internal edges. Temporary Control welding restores the previous tool on release/blur and must not interfere with clipboard selection shortcuts.
* `src/game/tile-selection.ts` owns rectangular capture, floating overlap-safe moves, clipboard, rotation/reflection, deletion, configuration/weld preservation, and destination validation. Puzzle selections intersect editable regions. Invalid destinations cancel rather than modify fixed cells. Enter commits/deselects before any array navigation; V toggles selection versus the remembered tool.
* Root sandbox selections offer a confirmed crop action. It commits floating selection edits, stops simulation, crops every authored test case to the displayed selection rectangle, translates/clips annotations and editable regions, refits the camera, and persists immediately. Internal welds and component state survive; perimeter welds are removed. Puzzle boards and nested-array views do not offer cropping.
* `component-configuration-dialog.ts` owns numeric, name, ternary-grid, and array configuration. Save and Escape share validation; invalid drafts stay open, Cancel discards, and IME composition does not submit. E can inspect fixed components read-only while puzzle editing is unlocked; simulation-locked puzzle configuration is unavailable. Ternary painting uses pointer capture and the normal cancellation rules.
* Sequence checker configuration includes “Ignore zero inputs”, off by default. Enabling it requires every expected grid cell to be +1 or -1; invalid drafts cannot save, including through Escape. The option is disabled when viewing fixed components read-only.
* `src/game/snippet-library.ts`, its controller, and `snippet-panel.ts` persist reusable fragments independently of puzzles. Snippets are cropped tick-zero boards retaining configuration, orientation, and welds, not live charges. Placement uses floating selections; unavailable puzzle components are removed, and wholly unavailable snippets are disabled.
* `src/simulation/text-box.ts` owns immutable annotations; `text-box-tool.ts` owns editing. Text is independent of tiles, physics, prices, and footprint. Authored puzzle text is read-only to solvers; player text persists across case views and may lie outside tile-editable regions. Fixed nested arrays and simulation locks reject edits. Transforms keep text upright; resizing clips/drops cropped boxes.

Keep keyboard shortcuts isolated from text entry, modal editing, IME composition, inappropriate modifiers, and held-key repeats. Transport shortcuts respect availability. Menus retain keyboard navigation and Escape/focus-leave/outside-click dismissal. Inspect current event wiring and `e2e/` for exact bindings rather than duplicating shortcut logic.

## Nested views and signal traces

`WorkshopSurfaceController` tracks array tile-ID paths from the root, following moved arrays and surviving resets. Enter/leave reuses the main canvas, palette, tools, inspector, and configuration UI. Editable arrays allow all inner cells; fixed arrays allow none. A breadcrumb climbs outward; the renderer receives the containing array's side charges for virtual ports.

The session world, simulation, baseline, and previous world stay root-level even while a nested world is displayed. Steps, exports, puzzle scores, and signal traces use the root. Do not accidentally persist a displayed inner board as the session root.

`src/game/signal-traces.ts` records every monitor in the root and recursively nested arrays once per committed tick, keyed by its containing array-ID path plus stable tile ID. Histories follow moved arrays without colliding with equal IDs in other boards. Every step path, including fast-forward via `afterStep`, must notify it; missing ticks throw. History restarts on world replacement, backward ticks, or tick-zero edits, including inner-board-only edits. `signal-panel.ts` displays monitor history and complete ROM/checker contents in depth-first row-major order; nested labels identify the array-ID path, with full labels available on hover. Hover highlights a component only when its owning board is displayed. Ordinary checker alignment uses the first active input tick, not latency assumed from tick zero. Ignore-zero checkers instead show sequence positions starting at row zero, with a “(pulses)” label: unknown gaps cannot be mapped to future ticks. Trace history and checker start ticks are display-only.

## Puzzles, authoring, and completion

* `puzzles.ts` loads shipped JSON from `src/game/puzzles/` through `puzzle-format.ts`. Registry order follows `puzzle-groups.ts`, then numeric puzzle order and ID. Groups unlock by gemstones; completions reveal further puzzles within a group.
* Every puzzle has a validated priced component catalog, editable regions, explicit board dimensions, at least one victory block in every resolved case, and an implicit `standard` case. Additional named stable-ID cases apply sparse board-field overrides and must match base dimensions. Cycle limits default to 1,000 and cannot exceed 10,000.
* `sandbox-puzzle-authoring.ts` owns scene/puzzle import, metadata, independent case boards, case duplication/deletion, selected case, and board resizing/cropping. Properties resize from the top-left; selection cropping translates a chosen rectangle to the new origin across all cases. `puzzle-export.ts` serializes authored puzzles. Scene import and new sandbox catalogs start disabled; saved/imported enabled prices remain explicit. Puzzle imports restore metadata, catalog, regions, and all cases, not just tiles.
* `editable-solution.ts` transfers the shared editable design into each isolated fixed-case world. Catalog restrictions are enforced at placement as well as palette/shortcut selection. Puzzle clearing/import paths must preserve fixed terrain.
* Pre-placed components inside editable regions are starter suggestions, not fixed machinery: they count at full catalog price and may be removed or overwritten. New solutions inherit the standard board's suggestions; the saved editable baseline, including empty cells and removed perimeter welds, replaces those regions in every test case. Reset and reload retain the player's edited design, not the original suggestions.
* A complete visible or fast-forwarded test runs every case. First loss or cycle limit stops on that terminal board and clears prior solution confirmation without opening the success report. Only all-case success atomically persists baseline and price, summed-cycle, footprint, and combined scores, and records completion. Manual steps never update progress.
* Test/Space toggles automatic verification and paused manual mode without replacing the run, including between cases. Paused tests retain editing/case-selection locks and allow Step/N, Resume, or Fast/F. Resuming restarts the speed ramp and discards elapsed paused time; between-case resume waits the normal transition delay.
* Fast verification advances on animation frames, with at most 100 ticks or 8 ms of simulation/trace work per frame (a single tick is indivisible). It renders committed state without interpolation, records every tick's signals, and yields at case boundaries before mounting the next case. Pause, reset, and navigation can interrupt between batches; only terminal all-case success records completion. Headless `runPuzzleTests` remains synchronous.
* Newly recorded progress immediately updates gemstones, unlocks, and route access without replacing the workshop. Success reports offer the immediate next puzzle only if now unlocked; navigation uses the ordinary persistence boundary.
* Success reports compare each score against the minimum of that metric across previously confirmed saved solutions for the same puzzle, including the active solution's prior result. Capture these values before recording replaces that result; first completions show no deltas. Negative deltas indicate improvement because all four metrics are minimized.
* Puzzle-workshop download/open-in-sandbox actions use the original complete shipped puzzle, not the running state or player's design. Opening creates an independently saved sandbox. Sandbox export uses authored metadata/cases.

`puzzle-scores.ts`, `puzzle-progress.ts`, and `puzzle-components.ts` centralize scoring, progression storage, and catalog validation. `src/ui/main-menu.ts`, `puzzle-info.ts`, `sandbox-info.ts`, `workshop-info-dialog.ts`, and `puzzle-test-report.ts` present these models. Keep validation and lifecycle policy out of presentation code.

## Storage and verification

Scene and puzzle JSON are deterministic/versioned and fully validated before replacing live state; see the simulation reference for nested-board fields and fresh runtime IDs. `player-data.ts` exports all localStorage entries deterministically and imports an exact replacement with rollback on failure. Successful import/clear reloads the app; destructive actions require confirmation. There is no backend sharing yet.

Settings includes a persisted Light Mode toggle, defaulting to dark. A sun/moon button at the bottom-left of puzzle and sandbox workshops shares the same setting, with its icon and accessible label describing the next action. `src/ui/theme.ts` synchronizes both controls, applies `data-theme` on the document root, and stores `factory2d.theme`; the existing player-data export/import/clear includes this preference. `src/styles.css` owns both UI palettes and native-control color schemes. The active theme also controls the canvas surround, board background, grid lines, and outer board border; tile artwork and circuit signal colors remain unchanged.

`src/dev/diagnostic-snapshot.ts` exposes a development-only read-only snapshot of routes, tool/hover state, simulation, revisions, serialized boards, and nested view depth/dimensions. Use it with browser automation; Vite removes it from production.

Focused model/controller tests live in `tests/` alongside subsystem names. Playwright cases in `e2e/` exercise persisted production-format fixtures, routing, edit/cancel behavior, nested arrays, successful/failed verification, downloads, and responsive layout. For lifecycle changes, check navigation away/back and reload as well as the immediate on-screen result.
