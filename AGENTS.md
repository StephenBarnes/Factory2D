# Factory 2D (working title)

## Concept

This is a game similar to Infinifactory but 2D. We have a series of one-screen puzzles where the player places square 2D tiles/blocks on a grid to accomplish some goal.

At each line between two non-empty blocks, they can be either welded together, or separate. Welded groups move as one rigid body. The simulation runs in discrete time steps and blocks move in discrete one-block increments; no continuous physics. Blocks can rotate in 90-degree increments. Blocks have different types, like stone or sand or pistons or conveyor belts or wires. This is a side view, so unsupported blocks fall down one space every one time step. Some blocks have internal state.

Game flow: On the main menu, the player selects a puzzle to view a briefing and create a new solution. The puzzle defines the initial screen state, which includes a region for the player to place blocks. Outside that region, the puzzle has in-world machinery like dispensers to supply inputs, delivery boxes to consume outputs, and a victory block which marks the puzzle solved when triggered by circuitry. The player selects and places blocks in the allowed region, building a machine to solve the puzzle, then presses play to see if their solution succeeds. They can also weld or unweld blocks. We also have a sandbox. The game starts on the sandbox screen currently for fast testing during development.

Implemented components:
* Solid blocks like sand, stone, and iron, with gravity downward or diagonally (sand).
* Conduits instantly share signed-ternary charge across welded circuit connections; wire crossings keep horizontal and vertical networks separate.
* Directional sensor runes emit +1 when forward neighbor is occupied.
* Spark runes emit +1 across their welded circuit network on the first simulation tick, then remain neutral until reset. Fixed charge runes emit +1 on every tick.
* Several runes combine up to 3 inputs to produce an output: inverter, combiner, subtractor, rectifier, multiplier, and selector.
* Magnets attract a magnetic block in the direction they're facing. Magnetic contacts hold connected bodies together against gravity, couple conveyor movement along the contact normal, and allow conveyor-driven sliding tangent to the contact.
* Conveyor belts use one all-side circuit network: +1 rolls clockwise, -1 counterclockwise, and 0 stops. Each active belt applies tangential force to every unwelded occupied neighbor and the opposite reaction force to its own body.
* Furnace blocks transform one neighbor cell into a different one after a delay: sand to glass, ore to metal.
* Directional delivery boxes absorb a front block when its tile kind matches the reference block behind the box, then emit a one-tick +1 pulse.
* Directional pistons use one retracted tile and separate welded base/arm tiles while extended. +1 prefers extending the arm and pushing complete obstruction chains forward; when that is blocked, it instead recoils the base and pushes the rear obstruction chain. The solid world boundary can brace the same recoil. -1 retracts and pulls a head-welded body; 0 holds state. The head weld follows the arm, while the base retains its other three welds and circuit connections.

Planned components:
* Welders and splitters - weld or unweld all sides of the block they're facing. Laser splitters, riveters.
* More circuit components like delays, miniaturized rune arrays, ROMs.
* Mechanical belts and gears - similar to the circuit system, ternary (clockwise/counterclockwise/still) but with more difficult mechanics.
* Assemblers that convert a group of blocks welded in a specific way into one block.
* Flippers and rotators that flip or rotate welded groups of blocks.

Example puzzles:
* Given inputs, weld them together and use an assembler to make intermediates; then weld together those intermediates and use an assembler to make a final product.
* Sort blocks into bins based on a circuit signal.
* Build a 4-bit adder using circuit components.
* Build a 4-bit adder without circuit components, by pushing around blocks mechanically.
* Minecraft-style mob farming.
* Depalletizing - unweld a 5x5 chunk of iron blocks and transported them down a chute.
* Tree farms - trees grow in irregular patterns; once grown high enough, their leaves must be burned off and their wood blocks unwelded and delivered.
* Build a vehicle that drives back and forth to evade the arms of a giant crushing contraption.
* Build a corridor that allows dwarves to walk through, but traps elves.
* The player must weld several different things, but they can't place welders and there's only one pre-placed welder that must be multiplexed.
* The player is given an impossible task. The only way to win is by building a machine that drills into the ground to reach the in-world puzzle infrastructure and triggers the victory block directly.

While the simulation has movement in discrete time steps and one-tile steps, we animate the tiles moving from one state to the next.

We'll make puzzles and solutions shareable, exportable as images, GIFs, and JSON files. The sandbox allows creating and sharing puzzles. Histogram screen to compare performance on each metric with other players. This will require eventually adding a backend server and database.

The game has a dwarven engineering theme. Magnets are lodestones, electrical components are glowing runes. Puzzles range from heavy industry based on moving around big chunks of stone/metal, bottling beer, circuit puzzles (runes and conduits), minecart control systems, bar challenges (remove this block without spilling the mug of ale on top), destroying elven defenses by building missiles or dwarven mechs.

## Stack

* Strict TypeScript targeting modern browsers.
* Framework-free HTML and CSS.
* Canvas 2D rendered directly.
* Vite for development server and production bundling.
* Vitest with the Node environment for simulation tests.
* Browser APIs for later audio and persistence: Web Audio API and localStorage/IndexedDB.
* Optional happy-dom for testing.

Tiles are drawn procedurally using Canvas 2D functions and colors defined on `TILE_DEFINITIONS`.

### Simulation conventions

Simulation rules should be deterministic, consistent, and understandable/predictable. Write tests to check behavior. A component can only observe the state at the beginning of a cycle, and react to it by making a change that becomes visible at the end of the cycle. Nothing reacts instantly to something that happened in the same tick.

* A world stores compact tile kinds separately from stable, nonzero tile IDs. Empty cells have ID 0.
* Each tick has observation, intent resolution, and commit phases. Components only observe the start-of-tick state.
* Gravity moves an eligible body at most one cell per tick. World boundaries are solid.
* Competing intents at the same priority jam rather than depending on iteration order. Gravity outranks conveyor movement: unsupported bodies fall before belts can redirect them, and belts cannot lift gravity-affected bodies. Magnetic contacts group bodies for gravity, constrain conveyor movement along their normal axis, and permit tangential conveyor sliding. Pushing resolves the complete dependency chain before any body moves.
* Rendering may interpolate committed steps, but interpolation never feeds back into simulation state.

The current engine implements observation, intent conflict resolution, and commit phases for gravity and conveyor-driven movement. Welded bodies always move rigidly. Magnetic contacts group bodies for gravity and normal-axis conveyor movement but permit tangential conveyor sliding, so a magnet can support a conveyor-driven machine moving along a magnetic ceiling. Unsupported touching bodies resolve complete downward movement dependency chains, and supported bodies resolve conveyor pushing chains before committing together. General-purpose non-conveyor pushing and rotation remain future simulation work.

## Development state

Keep this section up-to-date.

The game is in early development. Currently implemented:

* A 20x14 editable Canvas 2D grid with procedural sand, falling stone, glass, iron ore, magnetic iron, directional magnets, pistons, furnaces, delivery boxes, and victory blocks, clockwise/counterclockwise conveyor belts, circuit conduits and wire crossings, and fixed charge, spark, occupancy sensor, charge sensor, inverter, combiner, rectifier, multiplier, subtractor, and selector runes.
* A full-viewport black board layer behind responsive floating left and bottom control panels. The initial view fits the entire grid into the unobscured region; mouse-wheel zoom stays anchored beneath the pointer; and arrow keys, middle-button drags, or Alt-right-button drags pan within bounds that keep the screen center over the grid.
* Build controls for gap-free click-and-drag placement and removal, including Shift-left placement welded to every eligible occupied neighbor, drags that leave the grid, middle-click or Q picking that preserves directional component orientation and reselects the previous tile when aimed at an empty cell, middle-button drag panning, metadata-driven WASD rotation and aiming shared by palette previews, placement ghosts, and placed tiles, stepping, running, pausing, resetting, clearing, PNG image downloads, speed selection, and an animation toggle. Component palette definitions, categories, compact board codes, descriptions, and ordering come from the single tile definition registry. The palette groups image-only component buttons into raw-material, mechanism, circuit, machine, and puzzle-tool grids, keeps the compact weld tool above them, and overlays 1-9 and 0 on each workshop's first ten visible components.
* A separate weld tool for joining eligible occupied neighbors into rigid bodies and unwelding them, with gap-free fast-drag traversal, an immediate held-Control temporary override, and red invalid-edge feedback. Sand is not weldable, and magnets reject welds on their pointed side.
* One shared procedural tile renderer for the Canvas board, placement preview, and component palette. Palette previews use density-aware, supersampled backing stores and redraw when browser zoom or display density changes. Each welded body renders from traced, inset rounded-slab outlines whose occupied neighbors merge only across locally welded edges, so unwelded cuts stay visually stable when another cut splits the body and closed seam ends receive rounded caps. Rendering includes a drop shadow, per-cell fills that remain locally stable when different tile kinds are joined, decorations clipped to the outline, and top-left highlight and bottom-right shade bevels. Diagonally touching cells render as a rounded pinch. Per-body cells and `Path2D` outlines are cached across animation frames and rebuilt only after world changes or board geometry changes.
* Circuit-capable tiles render charge-colored traces only across welded circuit connections. Conduits have a compact charge-colored center socket; fixed charge runes show a charged plus inside a ring; spark runes show a charge-colored lightning bolt; conveyor belts have charge-colored sockets and perimeter dashes that animate in the driven direction; wire crossings render independently colored horizontal and vertical traces with a visible bridge; occupancy sensor runes isolate their pointed side from circuit links and color their arrow by sensed output independently from the connected network's charge; directional gates and furnaces render isolated input and output segments in each port's own charge color; victory blocks render isolated inputs around a trophy; and delivery boxes render a directional intake with a charge-colored pulse indicator.
* A typed-array world with stable tile IDs, per-tile orientation and signed-ternary charge, independent horizontal and vertical wire-crossing charge, furnace bake progress and target identities, latched puzzle result, edge weld storage, and allocation-free per-tick movement, phase-specific welded, magnetic, and piston body grouping, circuit-network, furnace, delivery-intent, and piston-intent buffers.
* Deterministic movement resolves straight-down gravity, complete downward body dependencies, parity-selected diagonal sand gravity, and direct-fall priority before lower-priority conveyor force sums. Magnetic groups preserve support during gravity; conveyor movement then restores welded bodies, couples magnetic contacts only along their normal axis, and permits tangential sliding. Conveyor movement also resolves opposite belt reactions, complete pushing chains, fixed-body blocking, gravity-destination blocking, and equal-priority destination jamming. Charged pistons split their head connection during kinematic resolution, prefer pushing complete chains forward on extension, recoil the base and rear obstruction chain when forward extension is blocked by terrain or the solid world boundary, pull only head-welded bodies on retraction, preserve base/head weld ownership, and jam conflicting or blocked intents.
* Deterministic circuit resolution rebuilds welded networks from the start-of-tick state, sums their drivers, takes the sign, and commits the result before movement. Wire crossings resolve horizontal and vertical axes as independent networks. Fixed charge runes contribute +1 constantly, spark runes contribute +1 on the first simulation tick, and directional occupancy sensor runes contribute +1 when their pointed neighboring cell is occupied. Gates keep every input and output network isolated and drive tick t+1 from charges observed at tick t: charge sensors read their pointed adjacent tile without requiring a weld and copy its charge to the other three sides, inverters negate the sum of up to three inputs, combiners resolve the sign of up to three inputs, rectifiers pass positive sums from up to three inputs, multipliers multiply up to three circuit-connected inputs, subtractors drive `sign(back - left - right)`, and selectors use the rear input to choose between left and right. Directional furnaces bake sand into glass in four active ticks or iron ore into iron in six active ticks, pause while their isolated rear input is charged, reset when the target identity changes, and emit +1 from both side outputs while actively baking. Directional delivery boxes compare the start-of-tick tile kinds in front and behind, absorb a matching non-empty front tile, and pulse +1 sideways for that tick; boxes competing for one target jam. Victory blocks latch a win from positive welded inputs or a loss from negative welded inputs; opposing same-tick intents jam.
* Simulation commits remain discrete and deterministic while stable tile IDs drive optional smooth eased rendering between any adjacent previous and current positions. Piston arm IDs follow the moving head and drive dedicated extension/retraction decoration animation. Manual steps animate for 200 ms; automatic steps animate for up to 250 ms without delaying simulation ticks. A 60-ticks-per-second mode forces discrete rendering without changing or disabling the player's animation preference.
* A responsive top-right inspector shows palette component names, prices, hotkeys, and descriptions on palette hover or keyboard focus. Over the board it shows the hovered tile's stable ID, movement behavior, effective weldable sides, current welds, circuit connections and charge, magnetic state, orientation, attraction direction/range, and furnace recipe progress. It hides over empty cells and refreshes after simulation commits even when the pointer remains stationary.
* Deterministic tests cover piston extension, retraction, pushing, pulling, weld ownership, blocking, conflicts, circuit ports, and board round-trips; conveyor force direction, gravity priority, magnetic ceiling traversal and detachment, normal magnetic constraints, neutral stopping, reaction forces, weld isolation, complete push chains, delivery absorption and conflicts, victory results and conflicts, gravity chains, sand overhangs, welded and magnetically constrained bodies, furnace recipes, fixed and first-tick spark circuit drivers, gate truth tables, boundaries, stable IDs, reset behavior, rendering, pointer gesture classification, and visible-order component shortcuts.
* Board export and import controls round-trip deterministic, versioned JSON with compact fixed-code ASCII tile and weld grids plus the latched puzzle result, sparse non-up orientations, nonzero circuit charges, independent wire-crossing axis charges, and in-progress furnace state. Weld cells use `.`, `-`, `|`, or `+` for no forward weld, right, down, or both. Exports up to one million characters are also copied to the clipboard. Imports derive dimensions from the tile grid, validate both grids and all sparse state before replacing the live board, support board sizes up to 400x300, and reconstruct fresh runtime tile IDs because IDs are intentionally excluded from the file.
* Tagged screen routing supports the main menu, per-puzzle briefing and saved-solution management, sandbox, and puzzle workshops. Focused navigation, saved-solution, and workshop-session controllers own those transitions and persistence while the browser entry point retains event wiring and animation. Development still boots directly into the sandbox through a single `INITIAL_SCREEN` setting. The responsive main menu presents the sandbox and a prerequisite-gated puzzle route. Each puzzle briefing shows its description, objective, feature list, and locally persisted solutions with placeholder price, cycle, and footprint scores. Players can create, duplicate, select, edit, and delete solutions; each solution retains an independent workshop design across reloads. A puzzle's latched victory result marks it complete after a simulation step, persists completed puzzle IDs in versioned local storage, and unlocks dependent puzzles on the menu.
* Puzzle definitions provide reusable unions of rectangular editable regions. Puzzle workshops render their boundaries as dotted gold outlines, restrict cell edits to the region, allow weld edits on internal and perimeter edges, and keep the outer grid boundary non-interactive. Starting or stepping a puzzle simulation locks board editing until reset, while sandbox editing remains available during simulation. Clearing and board imports preserve fixed terrain outside the region.
* Each puzzle owns a validated, priced component catalog. Puzzle workshops show only those components and their costs, reject unavailable palette shortcuts and picks, and enforce availability again at placement; the sandbox retains the complete unpriced palette.

## Code map

* `index.html` — Application shell, responsive main menu, puzzle briefing and saved-solution screen, tile and weld palette, canvas, hovered-cell inspector, and simulation controls.
* `src/main.ts` — Browser entry point, DOM event wiring, build tools, bounded pan/zoom controls, overlay-aware viewport insets, inspector coordination, and animation loop.
* `src/styles.css` — Responsive main menu, puzzle briefing and solution list, application, palette, inspector, board, and control styling.
* `src/vite-env.d.ts` — Vite client type declarations.
* `src/game/puzzles.ts` — Ordered puzzle definitions, prerequisite-based unlock checks, and fresh sandbox and puzzle world factories.
* `src/game/puzzle-components.ts` — Validated priced puzzle-component catalogs with constant-time availability and price lookup.
* `src/game/grid-region.ts` — Validated unions of axis-aligned grid rectangles with cell, edge, board-bounds, and deduplicated boundary queries.
* `src/game/puzzle-progress.ts` — Versioned local-storage serialization, validation, and victory recording for completed puzzle IDs.
* `src/game/puzzle-solutions.ts` — Versioned local-storage serialization, validation, naming, duplication, board updates, and deletion for per-puzzle saved solutions.
* `src/game/screen.ts` — Tagged application-screen contract and the single development initial-screen setting.
* `src/game/navigation-controller.ts` — Application screen transitions, menu and puzzle-info rendering, workshop activation, dirty-board persistence boundaries, and puzzle-progress consumption.
* `src/game/saved-solution-controller.ts` — Saved-solution selection, creation, duplication, deletion, dirty-board tracking, and local-storage persistence.
* `src/game/workshop-session.ts` — Independent sandbox and saved-solution world, baseline, previous-world, simulation, component-catalog, and editing-lock session ownership.
* `src/game/workshop-editing-state.ts` — Per-session puzzle edit locking after simulation starts, with reset and unrestricted sandbox policies.
* `src/render/canvas-renderer.ts` — Responsive Canvas 2D grid, editable-region boundary rendering and invalid-hover feedback, overlay-aware camera fitting, bounded pan and pointer-anchored zoom, revision-and-scale-keyed welded-body geometry cache, stable-ID movement interpolation in every adjacent direction, hit testing, placement previews, and hover feedback.
* `src/render/grid-drag.ts` — Board-clipped tile-drag endpoints and continuous weld-edge traversal between pointer events.
* `src/render/pointer-gesture.ts` — Button/modifier gesture classification and middle-click drag-threshold policy.
* `src/render/tile-renderer.ts` — Body outline tracing and rounded-slab drawing (fill, bevel lighting, decorations), including animated conveyor perimeters, for the board and component palette.
* `src/simulation/circuit.ts` — Signed-ternary charge type, validation, sum resolution, and render colors.
* `src/simulation/furnace.ts` — Directional furnace recipe inputs, outputs, bake times, and lookup.
* `src/simulation/tile.ts` — Tile kinds, directions, and immutable tile behavior, render, board-code, and sandbox-palette definitions.
* `src/simulation/board-export.ts` — Deterministic compact ASCII tile-and-weld-grid JSON serialization and strict validation/deserialization for sharing board, furnace, and puzzle-result state.
* `src/simulation/puzzle-result.ts` — Latched in-progress, won, and lost puzzle-result states.
* `src/simulation/world.ts` — Typed-array tile, orientation, charge, wire-crossing axis charge, furnace progress/target, puzzle-result, and weld storage; stable IDs; render revisions; snapshots; editing; piston topology transitions; transformations; and body movement commits.
* `src/simulation/simulation.ts` — Allocation-free circuit-network, delayed gate, furnace, delivery-box, victory-block, and piston-intent resolution; phase-specific welded, magnetic, and piston body collection; gravity support; tangential magnetic sliding; conveyor and piston pushing-chain resolution; conflict resolution; and tick advancement.
* `src/ui/tile-inspector.ts` — Palette metadata and revision-aware hovered-cell property presentation, including effective directional weldability, current welds, and furnace bake progress.
* `src/ui/component-palette.ts` — Definition-driven categorized compact grids for sandbox and priced puzzle components, with visible-order keyboard-shortcut assignment.
* `src/ui/main-menu.ts` — Definition-driven puzzle-map buttons with available, locked, and completed presentation.
* `src/ui/puzzle-info.ts` — Puzzle briefing, feature list, saved-solution selection, placeholder scores, and solution action rendering.
* `src/util/assert.ts` — `expectDefined` assertion that crashes loudly on violated lookups instead of falling back silently.
* `tests/component-palette.test.ts` — Sandbox and puzzle category, compact-button metadata, and visible-order shortcut tests.
* `tests/board-export.test.ts` — Compact board format ordering, round-trip, state, and malformed-input validation tests.
* `tests/circuit.test.ts` — Fixed and sensed circuit drivers, instant welded-network propagation, wire-crossing axis isolation, occupancy and charge sensor directionality, isolated gate networks and delay, combiner, multiplier, subtractor, and selector truth tables, disconnection, and moving-charge tests.
* `tests/furnace.test.ts` — Furnace recipe timing, target identity and movement, circuit control/output, and snapshot tests.
* `tests/delivery.test.ts` — Delivery matching, one-tick circuit pulses, competing-target jamming, and board-format round-trip tests.
* `tests/victory.test.ts` — Victory input, conflict, latching, reset, metadata, and board-format tests.
* `tests/conveyor.test.ts` — Conveyor circuit direction, force and gravity priority, magnetic ceiling crawling, normal magnetic constraints, reaction, weld isolation, push-chain, metadata, and board-format tests.
* `tests/piston.test.ts` — Piston circuit activation, extension/retraction, head/base weld ownership, pushing/pulling, fixed blocking, intent conflicts, arm weld restrictions, and board-format tests.
* `tests/simulation.test.ts` — Deterministic world, gravity, diagonal movement, conflict, weld, magnet, identity, and reset tests.
* `tests/grid-drag.test.ts` — Continuous tile and weld drag traversal tests, including board-boundary clipping.
* `tests/grid-region.test.ts` — Rectangular-union membership, editable-edge, deduplicated boundary, validation, and board-bounds tests.
* `tests/pointer-gesture.test.ts` — Pointer button, modifier, and drag-threshold regression tests.
* `tests/tile-renderer.test.ts` — Rounded body-outline and mixed-kind fill stability regression tests.
* `tests/tile.test.ts` — Directional and non-directional tile orientation resolution regression tests.
* `tests/puzzles.test.ts` — Puzzle ordering, prerequisite unlocking, priced component-catalog validation, and independent initial-world factory tests.
* `tests/puzzle-progress.test.ts` — Puzzle victory recording, deterministic persistence, initial state, and malformed stored-progress tests.
* `tests/puzzle-solutions.test.ts` — Saved-solution creation, duplication, board updates, deletion, deterministic persistence, ID allocation, and malformed-data validation tests.
* `tests/workshop-editing-state.test.ts` — Puzzle lock/reset and unrestricted sandbox editing-policy tests.
* `tests/controllers.test.ts` — Workshop-session isolation/import and saved-solution selection, dirty persistence, duplication, and deletion tests.
* `vite.config.ts` — Vite configuration with Vitest's Node test environment.
* `tsconfig.json` — Strict browser TypeScript and project build configuration.

## Current TODOs

App lifecycle / environment improvements:
* Add URL-backed application routing for the main menu, sandbox, puzzle briefing, and saved-solution workshop. Support browser Back/Forward, validate puzzle and solution IDs, enforce puzzle locking on direct routes, and preserve dirty solution edits during navigation.
* Add a minimal Playwright browser suite covering puzzle-info routing, solution creation, board persistence, duplication, deletion, reload restoration, and narrow-screen overflow. Seed local storage deterministically and prefer accessible selectors over broad `data-testid` coverage.
* Add a development-only, read-only browser diagnostic snapshot exposing the current screen, active puzzle and solution, simulation state, selected tool, hovered cell, world revision, and serialized board. Do not expose mutation commands or include the API in production builds.
* Add an “Application lifecycle invariants” section to this file `AGENTS.md` documenting ownership and transitions for `AppScreen`, saved solutions, workshop sessions, `world`, `baseline`, `previousWorld`, simulation locking, dirty persistence, reset, and puzzle completion.
* Add deterministic browser fixtures for puzzle progress and saved solutions, including empty, populated, unlocked, edited-board, and malformed-storage states. Seed the real versioned local-storage formats used by production.

Game/puzzle flow:
* Specify puzzles as JSON files in a folder; a puzzle registry can import and parse those files, similar to current import/export format with some additional fields like name and description. Move the existing 3 puzzles there, or create 3 arbitrary puzzles in that folder (since our current 3 puzzles are arbitrary placeholders). We want to work towards an easy authoring pipeline - export a puzzle from the sandbox, move it to that folder, and then the puzzle appears in the main menu. Define a versioned, strictly validated puzzle JSON schema containing metadata, feature labels, prerequisites, component prices, editable regions, and initial board state. Load every shipped puzzle through the production parser in tests, with file- and field-specific validation errors.
* Add a way to specify multiple test cases for each puzzle, in the puzzle or export format. These will be modifications to the puzzle definition, usually small, e.g. changing the values stored in one ROM component, so potentially store as a dictionary of only the changed fields of the puzzle definition. The player builds one solution which must work for all test cases. Implement this first for the JSON puzzle file format; later we'll add UI to create test cases in the sandbox.
* Add a button to test the current solution - runs all test cases in series, with some time limit (defined per puzzle or test case), then checks if all resulted in victory, and displays a report with the puzzle's success/failure, with buttons to continue editing or go back to puzzle info screen. As a follow-up, also compute and display score: price, cycles, footprint.

UI:
* Rework overall UI structure. Anchor the floating palette panel (on the left) and floating control panel (bottom) to the screen borders, instead of floating on top of the visible grid. Limit the `#game-canvas` to the rectangular region not covered by those two panels, instead of occupying the entire background.

More items in `more-todos.md`.

## Development guidelines

Keep the simulation deterministic and independent of rendering. Some information (e.g. list of connected bodies) can be shared.

Handle unexpected undefineds loudly. When a lookup is logically guaranteed to succeed (e.g. checked indexed access under `noUncheckedIndexedAccess`), narrow it with `expectDefined` from `src/util/assert.ts` rather than a silent fallback (`?? default`, guarded `break`/`continue`). We want violated expectations to crash with a descriptive message during development, never to continue silently with wrong state. Reserve explicit fallbacks for cases where absence is genuinely valid.

Prefer a new focused file for a new concern.

For performance, target one screen of blocks, 400x300 tiles at most, on low-end hardware, animated at 60 FPS, with 5 sim update steps per second.

No legacy compatibility is required. We are in early development. Make clean cutovers and remove obsolete callsites/aliases.

After completing changes, commit them to `master` or the current worktree. Self-contained commits are preferred.

## Build and verification

* `npm install` installs dependencies.
* `npm run dev` starts the Vite development server.
* `npm run build` type-checks TypeScript and creates the production bundle in `dist/`.
* `npm test` runs the deterministic simulation tests once.
* `npm run test:watch` runs tests in watch mode.