# Factory 2D (working title)

## Concept

This is a Zachtronics-like game about 2D machines built out of square tiles, using discrete tile physics and sequential logic, similar to Infinifactory but 2D. We have a series of one-screen puzzles where the player places tiles/blocks on a grid to accomplish some goal.

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
* Directional welders and splitters weld or remove the two transverse edges of the block ahead. Their left and right circuit links form one disable network, where -1 inhibits operation, and the isolated rear output pulses +1 after changing at least one edge.

Planned components:
* Welder/splitter variants: laser splitters, riveters.
* More circuit components like miniaturized rune arrays.
* Mechanical chain drives and gears - similar to the circuit system, ternary (clockwise/counterclockwise/still) but with more difficult mechanics.
* Assemblers that convert a group of blocks welded in a specific way into one block.
* Flippers and rotators that flip or rotate welded groups of blocks.
* Fragility flag for blocks like glass, which makes them shatter when they fall.

Example planned puzzles:
* Implement circuit behaviors with runes.
* Sort blocks into bins based on a circuit signal.
* Build a 4-bit adder using circuit components; or without circuit components, by pushing blocks around.
* Minecraft-style mob farming.
* Depalletizing - unweld a 5x5 chunk of iron blocks and drop them down a 1-wide chute.
* Given inputs, weld them together and use an assembler to make intermediates; then weld together those intermediates and use an assembler to make a final product.
* Tree farms - trees grow in irregular patterns, and once grown high enough, their leaves must be removed and wood blocks unwelded.
* Build a vehicle that drives back and forth to evade the arms of a giant crushing contraption.
* Build a corridor that allows dwarves to walk through, but traps elves.
* Puzzles that require multiplexing a single welder or furnace.
* The player is given an impossible task. The only way to win is by instead building a machine that drills into the ground to reach the in-world puzzle infrastructure and triggers the victory block directly.

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

* A variable-size editable Canvas 2D grid, bounded from 1x1 through 400x300, with procedural sand, falling stone, glass, iron ore, magnetic iron, directional magnets, pistons, welders, splitters, furnaces, delivery boxes, and victory blocks, clockwise/counterclockwise conveyor belts, circuit conduits and wire crossings, fixed charge, spark, occupancy sensor, charge sensor, inverter, combiner, rectifier, multiplier, subtractor, selector, configurable delay, charge counter, and ROM runes.
* A responsive workshop frame anchors the component palette to the left screen edge and the simulation controls to the bottom edge, with the Canvas limited to the remaining rectangular board region. On narrow screens the controls span the full bottom edge below both the palette and board. Entering any workshop or importing a scene resets the view to the largest zoom that keeps the entire grid visible and centered in `#game-canvas`, including subpixel tile sizes for maximum-size boards; mouse-wheel zoom stays anchored beneath the pointer; and arrow keys, middle-button drags, or Alt-right-button drags pan within bounds that keep the canvas center over the grid.
* Build controls for gap-free click-and-drag placement and removal, including Shift-left placement welded to every eligible occupied neighbor, drags that leave the grid, middle-click or Q picking that preserves directional component orientation and reselects the previous tile when aimed at an empty cell, middle-button drag panning, metadata-driven WASD rotation and aiming shared by palette previews, placement ghosts, and placed tiles, stepping, running, pausing, resetting, clearing, PNG image downloads, speed selection, and an animation toggle. Component palette definitions, categories, compact board codes, descriptions, and ordering come from the single tile definition registry. The palette groups image-only component buttons into raw-material, mechanism, circuit, machine, and puzzle-tool grids, keeps the compact weld tool above them, and overlays 1-9 and 0 on each workshop's first ten visible components.
* Browser composition uses focused controllers instead of parallel runtime aliases: `WorkshopSurfaceController` atomically mounts every session-bound world/view reference, `PuzzleTestController` owns the tagged puzzle-verification lifecycle and presentation, and `CanvasInteractionController` owns pointer capture plus gesture state and cancellation.
* A rectangular selection tool supports grid-aligned left-drag selection, floating overlap-safe moves committed when clicking outside the selection, Delete, Ctrl+C/X/V, occupied-tile AABB selection with Ctrl+A, absolute WASD rotation, horizontal and vertical flipping, and an in-memory clipboard. Floating previews preserve transformed internal welds. A contextual icon bar follows the selected box. Puzzle selections are intersected with editable regions; previews may cross fixed gaps, but invalid destinations render red and cancel instead of modifying fixed cells.
* Configurable components use one modal workflow: delay and counter modals open on placement, every configurable component opens from E while hovered, and numeric configurations adjust directly with Shift-mouse-wheel. The ROM editor supports dimensions through 9x9 plus left-click ternary cycling and right-click clearing.
* A separate weld tool for joining eligible occupied neighbors into rigid bodies and unwelding them, with gap-free fast-drag traversal, an immediate held-Control temporary override, and red invalid-edge feedback. Sand is not weldable, and magnets reject welds on their pointed side.
* A sandbox-only editable-region authoring tool sits beside the weld tool. Left drags add inclusive rectangles, right clicks remove every rectangle under the clicked cell, and gold overlays preview the authored union without constraining sandbox tile or weld edits. Puzzle-template downloads preserve the authored rectangle list, including an empty region.
* One shared procedural tile renderer for the Canvas board, placement preview, and component palette. Palette previews use density-aware, supersampled backing stores and redraw when browser zoom or display density changes. Each welded body renders from traced, inset rounded-slab outlines whose occupied neighbors merge only across locally welded edges, so unwelded cuts stay visually stable when another cut splits the body and closed seam ends receive rounded caps. Rendering includes a drop shadow, per-cell fills that remain locally stable when different tile kinds are joined, decorations clipped to the outline, and top-left highlight and bottom-right shade bevels. Diagonally touching cells render as a rounded pinch. Per-body cells and `Path2D` outlines are cached across animation frames and rebuilt only after world changes or board geometry changes.
* Circuit-capable tiles render charge-colored traces only across welded circuit connections. Conduits have a compact charge-colored center socket; fixed charge runes show a charged plus inside a ring; spark runes show a charge-colored lightning bolt; conveyor belts have charge-colored sockets and perimeter dashes that animate in the driven direction; wire crossings render independently colored horizontal and vertical traces with a visible bridge; occupancy sensor runes isolate their pointed side from circuit links and color their arrow by sensed output independently from the connected network's charge; directional gates and furnaces render isolated input and output segments in each port's own charge color; victory blocks render isolated inputs around a trophy; and delivery boxes render a directional intake with a charge-colored pulse indicator.
* Delay runes render ring-buffer charges with the currently emitted slot highlighted, charge counters render their live count and threshold, and ROMs render dark-purple neutral cells in a two-dimensional grid with a highlighted cursor. Directional markers identify configurable-component inputs and outputs without overlapping their shortened circuit traces.
* A typed-array world with stable tile IDs, per-tile orientation and signed-ternary charge, independent horizontal and vertical wire-crossing charge, isolated welder/splitter output charge, furnace bake progress and target identities, latched puzzle result, and edge weld storage. Focused circuit, weld-operation, delivery, furnace, and motion resolvers retain their typed-array scratch buffers for allocation-free per-tick execution; `MotionWorkspace` privately owns phase-specific welded, magnetic, piston, dependency, destination, and movement state.
* Configurable component definitions and sparse stable-tile-ID state preserve delay buffers, counter progress, and ROM contents across movement, cloning, reset, and import/export without allocating per tick.
* Deterministic movement resolves straight-down gravity, complete downward body dependencies, parity-selected diagonal sand gravity, and direct-fall priority before lower-priority conveyor force sums. Magnetic groups preserve support during gravity; conveyor movement then restores welded bodies, couples magnetic contacts only along their normal axis, and permits tangential sliding. Conveyor movement also resolves opposite belt reactions, complete pushing chains, fixed-body blocking, gravity-destination blocking, and equal-priority destination jamming. Charged pistons split their head connection during kinematic resolution, prefer pushing complete chains forward on extension, recoil the base and rear obstruction chain when forward extension is blocked by terrain or the solid world boundary, pull only head-welded bodies on retraction, preserve base/head weld ownership, and jam conflicting or blocked intents.
* Deterministic circuit resolution rebuilds welded networks from the start-of-tick state, sums their drivers, takes the sign, and commits the result before movement. Wire crossings resolve horizontal and vertical axes as independent networks. Fixed charge runes contribute +1 constantly, spark runes contribute +1 on the first simulation tick, and directional occupancy sensor runes contribute +1 when their pointed neighboring cell is occupied. Gates keep every input and output network isolated and drive tick t+1 from charges observed at tick t: charge sensors read their pointed adjacent tile without requiring a weld and copy its charge to the other three sides, inverters negate the sum of up to three inputs, combiners resolve the sign of up to three inputs, rectifiers pass positive sums from up to three inputs, multipliers multiply up to three circuit-connected inputs, subtractors drive `sign(back - left - right)`, and selectors use the rear input to choose between left and right. Directional furnaces bake sand into glass in four active ticks or iron ore into iron in six active ticks, pause while their isolated rear input is charged, reset when the target identity changes, and emit +1 from both side outputs while actively baking. Directional delivery boxes compare the start-of-tick tile kinds in front and behind, absorb a matching non-empty front tile, and pulse +1 sideways for that tick; boxes competing for one target jam. Victory blocks latch a win from positive welded inputs or a loss from negative welded inputs; opposing same-tick intents jam.
* Welder and splitter intents are collected from one stable start-of-tick topology before circuit resolution. Opposing operations on the same edge jam; accepted changes commit together after circuit resolution and before movement, so circuits observe the old weld graph while physics observes the new rigid-body topology. The rear success pulse is resolved in the same circuit phase.
* Delays and counters use isolated rear inputs. Delays advance a configurable 1-27-slot ternary ring buffer, and counters add signed inputs modulo a configurable threshold and emit a direction-signed pulse on wrap. ROMs use isolated relative-left and rear inputs to move a wrapping 2D cursor: +1 moves away from the physical input side and -1 moves toward it for every tile orientation. Crossing either grid edge carries into the other dimension so either input alone visits every cell. The selected value drives the relative-front and right outputs.
* Simulation commits remain discrete and deterministic while stable tile IDs drive optional smooth eased rendering between any adjacent previous and current positions. Piston arm IDs follow the moving head and drive dedicated extension/retraction decoration animation. Manual steps animate for 200 ms; automatic steps animate for up to 250 ms without delaying simulation ticks. A 60-ticks-per-second mode forces discrete rendering without changing or disabling the player's animation preference.
* A compact responsive top-right inspector shows component names with bronze gear prices and palette-style hotkey badges, plus descriptions, only while the pointer is over a palette button or occupied board cell. Board details retain stable IDs, attraction direction/range, furnace recipe progress, configurable state, and E/Shift-wheel prompts while omitting visually redundant orientation and circuit rows. It hides over empty cells, canvas space outside the grid, and the inspector itself, and refreshes after simulation commits even when the pointer remains stationary.
* Deterministic tests cover welder and splitter orientation, weld eligibility, circuit disabling and bridging, isolated success pulses, conflicts, topology-before-motion behavior, and board round-trips; piston extension, retraction, pushing, pulling, weld ownership, blocking, conflicts, circuit ports, and board round-trips; conveyor force direction, gravity priority, magnetic ceiling traversal and detachment, normal magnetic constraints, neutral stopping, reaction forces, weld isolation, complete push chains, delivery absorption and conflicts, victory results and conflicts, gravity chains, sand overhangs, welded and magnetically constrained bodies, furnace recipes, fixed and first-tick spark circuit drivers, configurable delay timing, counter pulses, ROM cursor movement, configurable-state serialization, gate truth tables, boundaries, stable IDs, reset behavior, rendering, pointer gesture classification, and visible-order component shortcuts.
* Board import and export controls round-trip deterministic, versioned JSON with explicit validated width and height, compact fixed-code ASCII tile and weld grids, the latched puzzle result, sparse non-up orientations, nonzero shared circuit charges, isolated component-output charges, independent wire-crossing axis charges, and in-progress furnace state. Weld cells use `.`, `-`, `|`, or `+` for no forward weld, right, down, or both. An export dropup separates scene-file download, explicit clipboard copy for exports up to one million characters, and PNG image download. In the sandbox it also downloads a shipped-format puzzle-authoring template with placeholder metadata, full-board editable region, all palette components at placeholder prices, and one inherited test case; puzzle workshops hide puzzle-authoring actions, and sharing remains disabled until a backend exists. Imports require dimensions from 1x1 through 400x300, validate both grids against those dimensions and all sparse state before replacing the live board, and reconstruct fresh runtime tile IDs because IDs are intentionally excluded from the file.
* Board format version 10 stores validated sparse delay, counter, and ROM configuration/runtime state alongside furnace, shared-circuit, wire-crossing, and isolated-output circuit state.
* URL-backed tagged screen routing supports the main menu, sandbox, per-puzzle briefing, and saved-solution workshops. Browser Back/Forward transitions use the same persistence boundary as in-app navigation; invalid, locked, or stale direct routes are replaced with the nearest permitted canonical route. Focused navigation, saved-solution, and workshop-session controllers own screen transitions and persistence while the browser entry point retains event wiring and animation. The responsive main menu presents gemstone count plus code-defined, collapsible puzzle groups with compact puzzle buttons. Gemstone thresholds unlock groups, each unlocked group exposes its first three puzzles plus one additional puzzle per completion in that group, and locked or fully completed groups start collapsed. Each puzzle briefing shows its description, objective, feature list, and locally persisted solutions with confirmed-success status plus price, summed-cycle, editable-block footprint, and combined scores. Players can create, duplicate, select, edit, and delete solutions; each solution retains an independent workshop design and score record across reloads. Successful all-case solution tests persist their scores and completed puzzle IDs in versioned local storage and immediately update grouped menu and direct-route access.
* Shipped puzzles are versioned JSON files under `src/game/puzzles/`. The eager registry loads every file through one strict parser, orders them by code-defined group display order and per-puzzle numeric order with puzzle IDs breaking ties, validates file names, unique IDs, defined group membership, component codes/prices, editable regions, cycle limits, explicit dimensions from 1x1 through 400x300, and matching embedded production board state, then exposes fresh cloned worlds. Every base board and resolved test-case board must contain at least one victory block. Each puzzle declares one or more stable, named test cases whose sparse overrides replace only selected `initialBoard` state fields; parsing validates unique test-case IDs, permitted override fields, complete inherited board state, and dimensions matching the base board, and the registry exposes an independent world factory for every case. Cycle limits default to 1,000, may be set per puzzle and overridden per test case, and cannot exceed 10,000. Puzzle workshops copy only editable cells, configurable state, and editable perimeter/internal welds from the saved design into each isolated test world. Tests render on the workshop board, accelerate smoothly from 5 through 60 ticks per second, pause briefly between successful cases, and offer unrendered fast-forward. The first loss or cycle limit stops verification on that exact state and shows an in-workshop failure message; only all-case success opens the score report modal. A test-case dropup selects the fixed case state shown behind the shared editable design. Puzzle workshops render editable-region boundaries as dotted gold outlines, restrict cell edits to the region, allow weld edits on internal and perimeter edges, and keep the outer grid boundary non-interactive. Starting or stepping a puzzle simulation locks board editing until reset, while sandbox editing remains available during simulation. Clearing and board imports preserve fixed terrain outside the region.
* Each puzzle owns a validated, priced component catalog. Puzzle workshops show only those components and their costs, reject unavailable palette shortcuts and picks, and enforce availability again at placement; the sandbox retains the complete unpriced palette.
* A development-only read-only diagnostic API exposes current routing, simulation, tool, hover, revision, and serialized-board state for browser automation; Vite removes it from production builds. A Playwright suite uses deterministic production-format local-storage fixtures to cover route access, solution creation/edit persistence, duplication, deletion, reload restoration, malformed storage recovery, puzzle test reports and controls, and narrow puzzle-info overflow.

## Code map

* `index.html` — Application shell, responsive main menu, puzzle briefing and saved-solution screen, tile and weld palette, canvas, hovered-cell inspector, and simulation controls.
* `src/main.ts` — Browser entry point, DOM event wiring, build tools, bounded pan/zoom controls, inspector-aware viewport insets, inspector coordination, and animation loop.
* `src/styles.css` — Responsive main menu, puzzle briefing and solution list, application, palette, inspector, board, and control styling; the dwarven-mine color palette (stone, bronze, gold, ember, gem accents) lives in CSS custom properties on `:root`, with gilded corner ornaments on major panels and a serif display-heading stack.
* `src/vite-env.d.ts` — Vite client type declarations.
* `src/dev/diagnostic-snapshot.ts` — Development-only read-only browser diagnostic snapshot contract and installer.
* `src/game/puzzles.ts` — Eager shipped-puzzle registry, deterministic group-and-puzzle sorting, grouped unlock checks, and fresh sandbox, puzzle, and test-case world factories.
* `src/game/puzzle-groups.ts` — Code-defined puzzle-group names, display order, gemstone thresholds, and initial per-group unlock count.
* `src/game/puzzle-export.ts` — Sandbox puzzle-authoring template serialization using the shipped puzzle format, current scene, placeholder metadata, full-board editable region, palette component catalog, and inherited test case.
* `src/game/puzzle-format.ts` — Versioned strict puzzle JSON parser for group and order metadata, feature labels, priced components, editable regions, embedded board state, and sparse named test-case overrides.
* `src/game/puzzle-test-runner.ts` — Incremental isolated puzzle-case execution, live case worlds, first-failure stopping, terminal outcome capture, and all-case success and summed-cycle score reporting.
* `src/game/puzzle-test-controller.ts` — Tagged puzzle-test UI lifecycle, case selection and mounting, visible timing and transitions, fast-forwarding, failure status, and success report ownership around `PuzzleTestRun`.
* `src/game/editable-solution.ts` — Editable-region tile, configurable-state, and weld transfer between the canonical solution and isolated puzzle-case worlds.
* `src/game/puzzles/*.json` — Shipped puzzle definitions loaded automatically into the ordered main-menu registry.
* `src/game/puzzle-components.ts` — Validated priced puzzle-component catalogs with constant-time availability and price lookup.
* `src/game/puzzle-scores.ts` — Successful-solution price, summed-cycle, editable-block AABB footprint, and combined score calculation plus persisted-score validation.
* `src/game/grid-region.ts` — Validated unions of axis-aligned grid rectangles with cell, edge, board-bounds, and deduplicated boundary queries.
* `src/game/editable-region-authoring.ts` — Sandbox-owned rectangle drag, commit, overlap removal, and board-replacement state for puzzle editable-region authoring.
* `src/game/tile-selection.ts` — Rectangular selection capture, editable-region intersection, floating move transforms, copy/paste/delete, rotation, horizontal flip, weld/configuration preservation, and destination validation.
* `src/game/puzzle-progress.ts` — Versioned local-storage serialization, validation, and victory recording for completed puzzle IDs.
* `src/game/puzzle-solutions.ts` — Versioned local-storage serialization, score validation, naming, duplication, board updates, and deletion for per-puzzle saved solutions.
* `src/game/app-route.ts` — Canonical application paths plus direct-route validation for grouped puzzle progression and saved-solution ownership.
* `src/game/screen.ts` — Tagged application-screen contract for the main menu, sandbox, puzzle briefing, and saved-solution workshop.
* `src/game/navigation-controller.ts` — URL and History API screen transitions, menu and puzzle-info rendering, workshop activation, dirty-board persistence boundaries, and puzzle-progress consumption.
* `src/game/saved-solution-controller.ts` — Saved-solution selection, creation, duplication, deletion, dirty-board tracking, and local-storage persistence.
* `src/game/workshop-session.ts` — Independent sandbox and saved-solution world, baseline, previous-world, simulation, component-catalog, and editing-lock session ownership.
* `src/game/workshop-surface-controller.ts` — Atomic active-session world, simulation, previous-world, renderer, selection, inspector, and hover binding with pre-mount interaction cancellation and optional viewport fitting.
* `src/game/workshop-editing-state.ts` — Per-session puzzle edit locking after simulation starts, with reset and unrestricted sandbox policies.
* `src/render/canvas-renderer.ts` — Responsive Canvas 2D grid, editable-region boundary rendering and invalid-hover feedback, canvas-centered camera fitting, bounded pan and pointer-anchored zoom, revision-and-scale-keyed welded-body geometry cache, stable-ID movement interpolation in every adjacent direction, hit testing, placement previews, and hover feedback.
* `src/render/grid-drag.ts` — Board-clipped tile-drag endpoints and continuous weld-edge traversal between pointer events.
* `src/render/pointer-gesture.ts` — Button/modifier gesture classification and middle-click drag-threshold policy.
* `src/render/tile-renderer.ts` — Body outline tracing and rounded-slab drawing (fill, bevel lighting, decorations), including animated conveyor perimeters, for the board and component palette.
* `src/simulation/circuit.ts` — Signed-ternary charge type, validation, sum resolution, and render colors.
* `src/simulation/configurable-components.ts` — Configuration metadata, limits, defaults, cloning, snapshots, and validation for delays, counters, and ROMs.
* `src/simulation/circuit-resolver.ts` — Persistent circuit-network scratch storage, start-of-tick driver evaluation, configurable sequential component updates, furnace-control output, and charge commits.
* `src/simulation/delivery-resolver.ts` — Persistent delivery-intent ownership and absorption buffers plus delivery collection and commit.
* `src/simulation/furnace.ts` — Directional furnace recipe inputs, outputs, bake times, and lookup.
* `src/simulation/furnace-resolver.ts` — Persistent furnace transformation buffers and circuit-controlled recipe progress resolution.
* `src/simulation/weld-operation-resolver.ts` — Persistent edge-intent and per-operator request buffers, opposing-operation conflict resolution, weld eligibility checks, success pulses, and batched topology commits.
* `src/simulation/tile.ts` — Tile kinds, directions, and immutable tile behavior, render, board-code, and sandbox-palette definitions.
* `src/simulation/board-export.ts` — Deterministic compact ASCII tile-and-weld-grid JSON serialization with explicit bounded dimensions and strict validation/deserialization for sharing board, furnace, configurable-component, and puzzle-result state.
* `src/simulation/puzzle-result.ts` — Latched in-progress, won, and lost puzzle-result states.
* `src/simulation/world.ts` — Typed-array tile, orientation, charge, wire-crossing axis charge, furnace progress/target, puzzle-result, and weld storage plus sparse configurable-component state; stable IDs; render revisions; snapshots; editing; piston topology transitions; transformations; and body movement commits.
* `src/simulation/motion-workspace.ts` — Private allocation-free body topology, member, gravity, force, dependency, destination, magnetic-constraint, and piston scratch storage plus ordered ordinary and piston movement resolution.
* `src/simulation/simulation.ts` — Thin explicit coordinator for victory observation, delivery and weld-operation intents, circuits, topology commits, furnaces, delivery commits, ordinary motion, piston motion, and tick advancement.
* `src/ui/tile-inspector.ts` — Palette metadata and revision-aware hovered-cell property presentation, including effective directional weldability, current welds, furnace bake progress, configurable state, and control prompts.
* `src/ui/component-configuration-dialog.ts` — Shared numeric and ternary-grid modal editing for configurable components.
* `src/ui/canvas-interaction-controller.ts` — Canvas pointer capture and discriminated edit, selection, authoring, pick, pan, finish, and cancellation gesture state with session/tool capture.
* `src/ui/component-palette.ts` — Definition-driven categorized compact grids for sandbox and priced puzzle components, with visible-order keyboard-shortcut assignment.
* `src/ui/main-menu.ts` — Gemstone count and compact collapsible puzzle groups with available, locked, and completed presentation.
* `src/ui/puzzle-info.ts` — Puzzle briefing, feature list, saved-solution selection, confirmed status and scores, and solution action rendering.
* `src/util/assert.ts` — `expectDefined` assertion that crashes loudly on violated lookups instead of falling back silently.
* `src/ui/puzzle-test-report.ts` — Accessible per-case success/failure modal rendering, successful score presentation, and report actions.
* `tests/component-palette.test.ts` — Sandbox and puzzle category, compact-button metadata, and visible-order shortcut tests.
* `tests/board-export.test.ts` — Compact board format dimensions, ordering, configurable state, round-trip, boundary, and malformed-input validation tests.
* `tests/canvas-renderer.test.ts` — Maximum-size, canvas-coordinate, and player-modified viewport fitting regression tests.
* `tests/circuit.test.ts` — Fixed and sensed circuit drivers, instant welded-network propagation, wire-crossing axis isolation, occupancy and charge sensor directionality, isolated gate networks, configurable delays and counters, ROM cursor/output behavior, combiner, multiplier, subtractor, and selector truth tables, disconnection, and moving-charge tests.
* `tests/furnace.test.ts` — Furnace recipe timing, target identity and movement, circuit control/output, and snapshot tests.
* `tests/weld-operation.test.ts` — Welder and splitter orientation, transverse-edge changes, weld eligibility, circuit control and output isolation, conflict, phase ordering, metadata, and board round-trip tests.
* `tests/delivery.test.ts` — Delivery matching, one-tick circuit pulses, competing-target jamming, and board-format round-trip tests.
* `tests/victory.test.ts` — Victory input, conflict, latching, reset, metadata, and board-format tests.
* `tests/conveyor.test.ts` — Conveyor circuit direction, force and gravity priority, magnetic ceiling crawling, normal magnetic constraints, reaction, weld isolation, push-chain, metadata, and board-format tests.
* `tests/piston.test.ts` — Piston circuit activation, extension/retraction, head/base weld ownership, pushing/pulling, fixed blocking, intent conflicts, arm weld restrictions, and board-format tests.
* `tests/simulation.test.ts` — Deterministic world, gravity, diagonal movement, conflict, weld, magnet, identity, and reset tests.
* `tests/grid-drag.test.ts` — Continuous tile and weld drag traversal tests, including board-boundary clipping.
* `tests/grid-region.test.ts` — Rectangular-union membership, editable-edge, deduplicated boundary, validation, and board-bounds tests.
* `tests/editable-region-authoring.test.ts` — Inclusive rectangle drag, overlap removal, cancellation, and board-replacement tests.
* `tests/tile-selection.test.ts` — Selection movement, overlapping replacement, configuration and weld preservation, rotation, editable-region constraints, copy/paste, and deletion tests.
* `tests/pointer-gesture.test.ts` — Pointer button, modifier, and drag-threshold regression tests.
* `tests/workshop-surface-controller.test.ts` — Interaction-cancel ordering, atomic active-runtime rebinding, fit behavior, and mount notification tests.
* `tests/puzzle-test-controller.test.ts` — Visible case transition, fast-forward success, cycle-limit and simulation failure, reset, selection, and navigation-stop lifecycle tests.
* `tests/canvas-interaction-controller.test.ts` — Pointer cancellation, grid leave/re-entry, pick-versus-pan, captured-tool, stale-session, and one-time commit tests.
* `tests/app-route.test.ts` — Canonical path, malformed route, grouped progression locking, and saved-solution route validation tests.
* `tests/tile-renderer.test.ts` — Rounded body-outline and mixed-kind fill stability regression tests.
* `tests/tile.test.ts` — Directional and non-directional tile orientation resolution regression tests.
* `tests/puzzles.test.ts` — Group threshold and sequence unlocking, deterministic puzzle ordering, priced component-catalog validation, and independent initial-world factory tests.
* `tests/puzzle-test-runner.test.ts` — Editable-design and configuration transfer, incremental case transitions, first-failure stopping, all-case success scores, loss, and cycle-limit tests.
* `tests/puzzle-format.test.ts` — Production shipped-puzzle loading, strict field validation, group membership and order tie handling, sparse test-case overrides, dimension invariants, and independent world-factory tests.
* `tests/puzzle-export.test.ts` — Puzzle-authoring template format, scene-state reset, editable region, component catalog, test-case, and parser compatibility tests.
* `tests/puzzle-progress.test.ts` — Puzzle victory recording, deterministic persistence, initial state, and malformed stored-progress tests.
* `tests/puzzle-solutions.test.ts` — Saved-solution creation, duplication, board and score updates, deletion, deterministic persistence, ID allocation, and malformed-data validation tests.
* `tests/puzzle-scores.test.ts` — Component price, editable-block AABB footprint, cycle, and combined score tests.
* `tests/workshop-editing-state.test.ts` — Puzzle lock/reset and unrestricted sandbox editing-policy tests.
* `tests/controllers.test.ts` — Workshop-session isolation/import and saved-solution selection, dirty persistence, duplication, and deletion tests.
* `e2e/app-lifecycle.spec.ts` — Playwright lifecycle coverage for grouped menu progression and responsive layout, routing, edge-panel and canvas geometry, solution persistence/actions and successful scores, visible and fast-forwarded puzzle tests, paused failure state, test-case selection, export dropup availability and downloads, and narrow puzzle-info overflow.
* `vite.config.ts` — Vite configuration with Vitest's Node test environment.
* `playwright.config.ts` — Chromium browser-suite and Vite web-server configuration.
* `tsconfig.json` — Strict browser TypeScript and project build configuration.

## Application lifecycle invariants

* `AppScreen` is the complete logical screen state. `appScreenPath` gives each state one canonical path; `NavigationController` is the only owner of screen transitions. Both in-app requests and browser `popstate` events resolve through the same route access checks before any screen is shown.
* `/` is the main menu, `/sandbox` is the sandbox, `/puzzles/:puzzleId` is a puzzle briefing, and `/puzzles/:puzzleId/solutions/:solutionId` is a saved-solution workshop. Unknown or malformed paths and locked puzzles resolve to `/`; a missing solution or one owned by another puzzle resolves to that unlocked puzzle's briefing. Noncanonical paths are replaced rather than added to browser history.
* `SavedSolutionController` owns saved-solution records, per-puzzle selection, score records, and the dirty set. Editable puzzle changes copy into the active session's `baseline` and mark that solution dirty. Every navigation transition persists the dirty baseline and clears its obsolete scores before changing sessions; `pagehide` is the final persistence boundary. Creation, duplication, deletion, completed pointer gestures, and explicit clearing persist immediately.
* `WorkshopSessionController` owns one long-lived sandbox session and one lazily created session per visited solution ID. Returning to a session reuses its runtime state. Deleting a solution must also forget its session. The browser entry point may cache references to the active session fields only through `loadActiveWorkshopSession` after activation.
* A session's `world` is the mutable state observed and committed by its `simulation`. `baseline` is the tick-zero editable design used for reset and saved-solution persistence. `previousWorld` is render-only interpolation state copied from `world` before a simulation step or synchronized after an edit/reset. Replacing an imported world replaces all four related runtime references together and creates a simulation at the imported tick.
* Every accepted sandbox edit copies `world` into `baseline`. Puzzle edits copy only editable-region cells, configurable state, and editable welds into the canonical baseline, so selecting an alternate test-case view never persists that case's fixed terrain. Every edit resets the puzzle result and simulation tick, synchronizes `previousWorld`, and marks an active saved solution dirty. Simulation never writes back to `baseline`.
* Starting or stepping simulation calls `beginSimulation` before the first tick. Puzzle sessions then stay non-editable until reset; the sandbox remains editable by policy. Reset stops automatic running, reconstructs the selected test-case view from its fixed initial world plus the editable baseline, resets the tick and puzzle editing lock, and synchronizes `previousWorld`.
* Puzzle completion is recorded only after visible or fast-forwarded execution of every declared test case succeeds. Successful tests atomically persist the current baseline and its price, summed-cycle, footprint, and combined scores; the first failed test clears prior confirmation, pauses on its terminal board state, and does not open the score report. Individual workshop steps never change puzzle progress. A failed case, a cycle limit, or an already-recorded success makes no progress change. Newly recorded progress changes gemstone totals, group and puzzle unlocks, and direct-route access without replacing the active workshop.

## Current TODOs

Moved to `more-todos.md`.

## Development guidelines

Keep the simulation deterministic and independent of rendering. Some information (e.g. list of connected bodies) can be shared.

Handle unexpected undefineds loudly. When a lookup is logically guaranteed to succeed (e.g. checked indexed access under `noUncheckedIndexedAccess`), narrow it with `expectDefined` from `src/util/assert.ts` rather than a silent fallback (`?? default`, guarded `break`/`continue`). We want violated expectations to crash with a descriptive message during development, never to continue silently with wrong state. Reserve explicit fallbacks for cases where absence is genuinely valid.

Prefer a new focused file for a new concern.

For performance, target one screen of blocks, 400x300 tiles at most, on low-end hardware, animated at 60 FPS, with 5 sim update steps per second.

No legacy compatibility is required. We are in early development. Make clean cutovers and remove obsolete callsites/aliases.

After completing changes, commit them to `master` or the current worktree. Self-contained commits are preferred.

## Build and verification

* `npm install` installs dependencies.
* `npx playwright install chromium` installs the browser binary used by the Playwright suite when no system Chromium path is configured.
* `npm run dev` starts the Vite development server.
* `npm run build` type-checks TypeScript and creates the production bundle in `dist/`.
* `npm test` runs the deterministic simulation tests once.
* `npm run test:browser` runs the Playwright lifecycle suite once.
* `npm run test:watch` runs tests in watch mode.