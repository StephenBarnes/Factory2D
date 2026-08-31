# Factory 2D (working title)

## Concept

This is planned to be a game similar to a 2D Infinifactory. The game is a series of one-screen puzzles, where the player places square 2D tiles/blocks on a grid to accomplish some goal.

At each line between two non-empty blocks, they can be either welded together, or separate. Welded groups of blocks always move as one group. The simulation runs in discrete time steps, and blocks move in discrete one-block increments. Blocks can only rotate in 90-degree increments. Some blocks have internal state. Blocks have different types, like stone or sand or pistons or conveyor belts or wires. This is a side view, so unsupported blocks fall down one space every one time step. No continuous-time or continuous-space physics.

Planned game flow: We show a main menu. The player selects a puzzle, which defines the initial screen and constraints, e.g. inputs and outputs, fixed terrain, player-modifiable region. Player can select components; left click places, right click removes. They can also select a weld tool or a selection tool. With the weld tool, left click welds, right click unwelds. When placing, they can rotate the component in 90-degree increments. Later additional conveniences like placing lines/rectangles, bulk weld/unweld, selection and moving. Each puzzle defines fixed terrain, and which components are available, and prices for those components which are used to score solutions. The player presses a button to run/play the simulation and check behavior, with options to pause, step once, control speed, or reset to the state before running.

Implemented components:
* Solid blocks - can have downward gravity, diagonal gravity (sand), can be weldable on some sides, can be magnetic.
* Magnets attract a magnetic block in the direction they're facing. Magnetic contacts hold connected bodies together against gravity, couple conveyor movement along the contact normal, and allow conveyor-driven sliding tangent to the contact.
* Conduits instantly share signed-ternary charge across welded circuit connections; wire crossings keep horizontal and vertical networks separate.
* Conveyor belts use one all-side circuit network: +1 rolls clockwise, -1 counterclockwise, and 0 stops. Each active belt applies tangential force to every unwelded occupied neighbor and the opposite reaction force to its own body.
* Directional sensor runes emit +1 when the neighboring cell on their pointed side is occupied.
* Spark runes emit +1 across their welded circuit network on the first simulation tick, then remain neutral until reset.
* Directional inverter runes negate the sum of up to three isolated input networks onto their pointed output network one tick later.
* Directional combiner runes sum up to three isolated input networks and drive the sign of their sum onto a pointed output network one tick later.
* Furnace blocks that transform one neighbor cell into a different one after a delay: sand to glass, ore to metal.
* Directional delivery boxes absorb a front block when its tile kind matches the reference block behind the box, then emit a one-tick +1 pulse on both side ports.

Planned components:
* Conveyor belts apply a clockwise or counterclockwise force to their 4 neighbor blocks. A conveyor placed on a floor will try to roll in one direction, and try to push the platform in the other direction, unless it's welded onto the platform.
* Welders and splitters - weld or unweld all sides of the block they're facing. Laser splitters. Riveters that weld 2 blocks in a straight line.
* Pistons - 1 block which expands to 2 blocks when given a signal, pushing things around.
* Sensors that detect pushing force from a direction.
* Electrical components like logic gates, delays, fixed inputs, and brush connectors.
* Assemblers that convert a group of blocks welded in a specific way into one block. For example iron and copper blocks welded in a specific way are converted to a piston block.
* Flipper: attaches to one block, then flips the entire connected/welded group of blocks around that line horizontally or vertically, if it would not collide/overlap other blocks.
* Laser splitter: splits everything in a line.
* Configurable components where the player can enter a number in a text box, e.g. a configurable-delay repeater.
* Component that rotates a neighboring block or body around itself.
* Circuit-board components with internal grids where mini-components can be placed to program their behavior.

More concepts:
* Furnaces could have special behavior if said neighbor is surrounded by certain other neighbors. Or they could trigger a block to weld to neighbors after cooking it. There could be stages, e.g. cookie dough -> cookie -> burnt cookie, creating timing challenges.
* Each puzzle could have several test cases, with different timing of inputs.
* Puzzles could include terrain that makes it harder to fit a solution, or pre-placed components like teleporters. The solution might require welding blocks together, but there's only one welder present on the map, so it must be reused in different ways.
* Puzzles could include a wire input that switches on/off, and the solution must sort blocks into left vs right outputs dependent on the wire's charge.
* We'll introduce components gradually, as puzzles are completed. Each puzzle has a limited set of components available.
* Puzzle inputs and outputs will be physically present on the map. A dispenser block dispenses ore, which must be smelted to iron, which is then delivered to a delivery block; level is beaten when the delivery block has received enough iron blocks. We wire up the dispenser to a timer circuit physically present in the level, or to a button that the player can press.
* We'll show a sidebar with all interactions relevant for a given puzzle.
* Shareable puzzles and solutions. Sandbox and puzzle editor. Exporting solutions as GIFs. Histogram screen to compare performance on each metric with other players.

Example puzzles:
* Given inputs, weld them together and use an assembler to make intermediates; then weld together those intermediates and use an assembler to make a final product.
* Sort blocks into bins based on physical properties.
* Build a 4-bit adder using wires and logic gates.
* Build a 4-bit adder without wires and logic gates, by pushing around blocks mechanically.
* Mob farms - mobs are dispensed by a hive and move around according to rules, must be herded to a destination.
* Depalletizing - dispenser gives a 5x5 group of welded iron blocks, which must be split up and transported to the delivery block.
* Build a vehicle that picks up a block in one location and moves it to the target.
* Tree farms - trees grow in irregular patterns; once grown high enough, their leaves must be burned off and their wood blocks unwelded and packaged for delivery.

While the simulation has movement in discrete time steps and one-tile steps, we animate the tiles moving from one state to the next.

We'll give the game a "dwarven engineering" theme. So replace magnets with lodestones, electrical components with glowing runes. Puzzles range from heavy industry based on moving around big chunks of stone/metal, bottling beer, circuit puzzles (runes and conduits), minecart control systems, bar challenges (remove this block without spilling the mug of ale on top), destroying elven defenses by building missiles or dwarven mechs. Solutions will be rated by percentile as coal, iron, silver, gold, mithril, etc.

## Stack

* Strict TypeScript targeting modern browsers.
* Framework-free HTML and CSS.
* Canvas 2D rendered directly.
* Vite for development server and production bundling.
* Vitest with the Node environment for simulation tests.
* Browser APIs for later audio and persistence: Web Audio API and localStorage/IndexedDB.

Tiles are drawn procedurally using Canvas 2D functions and colors defined on `TILE_DEFINITIONS`.

### Simulation conventions

We want simulation rules to be deterministic, consistent, and understandable/predictable.
We'll write many small tests that simulate scenarios and check behavior.
As a general rule, a component can only observe the state at the beginning of a cycle, and react to it by making a change that becomes visible at the end of the cycle. Nothing reacts instantly to something that happened in the same tick.

* A world stores compact tile kinds separately from stable, nonzero tile IDs. Empty cells have ID 0.
* Each tick has observation, intent resolution, and commit phases. Components only observe the start-of-tick state.
* Gravity moves an eligible body at most one cell per tick. World boundaries are solid.
* Competing intents at the same priority jam rather than depending on iteration order. Gravity outranks conveyor movement: unsupported bodies fall before belts can redirect them, and belts cannot lift gravity-affected bodies. Magnetic contacts group bodies for gravity, constrain conveyor movement along their normal axis, and permit tangential conveyor sliding. Pushing resolves the complete dependency chain before any body moves.
* Rendering may interpolate committed steps, but interpolation never feeds back into simulation state.

The current engine implements observation, intent conflict resolution, and commit phases for gravity and conveyor-driven movement. Welded bodies always move rigidly. Magnetic contacts group bodies for gravity and normal-axis conveyor movement but permit tangential conveyor sliding, so a magnet can support a conveyor-driven machine moving along a magnetic ceiling. Unsupported touching bodies resolve complete downward movement dependency chains, and supported bodies resolve conveyor pushing chains before committing together. General-purpose non-conveyor pushing and rotation remain future simulation work.

## Development state

Keep this section up-to-date.

The game is in early development. Currently implemented:

* A 20x14 editable Canvas 2D grid with procedural sand, falling stone, glass, iron ore, magnetic iron, directional magnets, furnaces, delivery boxes, and victory blocks, clockwise/counterclockwise conveyor belts, circuit conduits and wire crossings, and fixed charge, spark, occupancy sensor, charge sensor, inverter, combiner, rectifier, multiplier, subtractor, and selector runes.
* A full-viewport black board layer behind responsive floating left and bottom control panels. The initial view fits the entire grid into the unobscured region; mouse-wheel zoom stays anchored beneath the pointer; and arrow keys, middle-button drags, or Alt-right-button drags pan within bounds that keep the screen center over the grid.
* Build controls for gap-free click-and-drag placement and removal, including Shift-left placement welded to every eligible occupied neighbor, drags that leave the grid, middle-click picking that preserves directional component orientation while middle-button drags pan, metadata-driven rotation and aiming shared by palette previews, placement ghosts, and placed tiles, stepping, running, pausing, resetting, clearing, PNG image downloads, speed selection, and an animation toggle. The sandbox component palette, compact board codes, descriptions, ordering, and keyboard shortcuts are generated from the single tile definition registry.
* A separate weld tool for joining eligible occupied neighbors into rigid bodies and unwelding them, with gap-free fast-drag traversal, an immediate held-Control temporary override, and red invalid-edge feedback. Sand is not weldable, and magnets reject welds on their pointed side.
* One shared procedural tile renderer for the Canvas board, placement preview, and component palette. Palette previews use density-aware, supersampled backing stores and redraw when browser zoom or display density changes. Each welded body renders from traced, inset rounded-slab outlines whose occupied neighbors merge only across locally welded edges, so unwelded cuts stay visually stable when another cut splits the body and closed seam ends receive rounded caps. Rendering includes a drop shadow, per-cell fills that remain locally stable when different tile kinds are joined, decorations clipped to the outline, and top-left highlight and bottom-right shade bevels. Diagonally touching cells render as a rounded pinch. Per-body cells and `Path2D` outlines are cached across animation frames and rebuilt only after world changes or board geometry changes.
* Circuit-capable tiles render charge-colored traces only across welded circuit connections. Conduits have a compact charge-colored center socket; fixed charge runes show a charged plus inside a ring; spark runes show a charge-colored lightning bolt; conveyor belts have charge-colored sockets and perimeter dashes that animate in the driven direction; wire crossings render independently colored horizontal and vertical traces with a visible bridge; occupancy sensor runes isolate their pointed side from circuit links and color their arrow by sensed output independently from the connected network's charge; directional gates and furnaces render isolated input and output segments in each port's own charge color; victory blocks render isolated inputs around a trophy; and delivery boxes render a directional intake with a charge-colored pulse indicator.
* A typed-array world with stable tile IDs, per-tile orientation and signed-ternary charge, independent horizontal and vertical wire-crossing charge, furnace bake progress and target identities, latched puzzle result, edge weld storage, and allocation-free per-tick movement, phase-specific welded and magnetic body grouping, circuit-network, furnace, and delivery-intent buffers.
* Deterministic movement resolves straight-down gravity, complete downward body dependencies, parity-selected diagonal sand gravity, and direct-fall priority before lower-priority conveyor force sums. Magnetic groups preserve support during gravity; conveyor movement then restores welded bodies, couples magnetic contacts only along their normal axis, and permits tangential sliding. Conveyor movement also resolves opposite belt reactions, complete pushing chains, fixed-body blocking, gravity-destination blocking, and equal-priority destination jamming.
* Deterministic circuit resolution rebuilds welded networks from the start-of-tick state, sums their drivers, takes the sign, and commits the result before movement. Wire crossings resolve horizontal and vertical axes as independent networks. Fixed charge runes contribute +1 constantly, spark runes contribute +1 on the first simulation tick, and directional occupancy sensor runes contribute +1 when their pointed neighboring cell is occupied. Gates keep every input and output network isolated and drive tick t+1 from charges observed at tick t: charge sensors read their pointed adjacent tile without requiring a weld and copy its charge to the other three sides, inverters negate the sum of up to three inputs, combiners resolve the sign of up to three inputs, rectifiers pass positive sums from up to three inputs, multipliers multiply up to three circuit-connected inputs, subtractors drive `sign(back - left - right)`, and selectors use the rear input to choose between left and right. Directional furnaces bake sand into glass in four active ticks or iron ore into iron in six active ticks, pause while their isolated rear input is charged, reset when the target identity changes, and emit +1 from both side outputs while actively baking. Directional delivery boxes compare the start-of-tick tile kinds in front and behind, absorb a matching non-empty front tile, and pulse +1 sideways for that tick; boxes competing for one target jam. Victory blocks latch a win from positive welded inputs or a loss from negative welded inputs; opposing same-tick intents jam.
* Simulation commits remain discrete and deterministic while stable tile IDs drive optional smooth eased rendering between any adjacent previous and current positions. Manual steps animate for 200 ms; automatic steps animate for up to 250 ms without delaying simulation ticks. A 60-ticks-per-second mode forces discrete rendering.
* A responsive top-right cell inspector shows the hovered tile's stable ID, movement behavior, effective weldable sides, current welds, circuit connections and charge, magnetic state, orientation, attraction direction/range, and furnace recipe progress. It hides over empty cells and refreshes after simulation commits even when the pointer remains stationary.
* Deterministic tests cover conveyor force direction, gravity priority, magnetic ceiling traversal and detachment, normal magnetic constraints, neutral stopping, reaction forces, weld isolation, complete push chains, delivery absorption and conflicts, victory results and conflicts, board round-trips, gravity chains, sand overhangs, welded and magnetically constrained bodies, furnace recipes, fixed and first-tick spark circuit drivers, gate truth tables, conflicts, boundaries, stable IDs, reset behavior, rendering, and pointer gesture classification.
* Board export and import controls round-trip deterministic, versioned JSON with compact fixed-code ASCII tile and weld grids plus the latched puzzle result, sparse non-up orientations, nonzero circuit charges, independent wire-crossing axis charges, and in-progress furnace state. Weld cells use `.`, `-`, `|`, or `+` for no forward weld, right, down, or both. Exports up to one million characters are also copied to the clipboard. Imports derive dimensions from the tile grid, validate both grids and all sparse state before replacing the live board, support board sizes up to 400x300, and reconstruct fresh runtime tile IDs because IDs are intentionally excluded from the file.
* Tagged screen routing supports the main menu, sandbox, and per-definition puzzle workshops. Development still boots directly into the sandbox through a single `INITIAL_SCREEN` setting. The responsive main menu presents the sandbox and a prerequisite-gated puzzle route; puzzle definitions own names, goals, unlock prerequisites, and fresh initial-world factories, while each visited workshop retains an independent session. A puzzle's latched victory result marks it complete after a simulation step, persists completed puzzle IDs in versioned local storage, and unlocks dependent puzzles on the menu.

## Code map

* `index.html` — Application shell, responsive main menu, tile and weld palette, canvas, hovered-cell inspector, and simulation controls.
* `src/main.ts` — Browser entry point, screen navigation and retained workshop sessions, puzzle victory consumption and progress persistence, input handling, build tools, bounded pan/zoom controls, overlay-aware viewport insets, inspector coordination, and animation loop.
* `src/styles.css` — Responsive main menu, application, palette, inspector, board, and control styling.
* `src/vite-env.d.ts` — Vite client type declarations.
* `src/game/puzzles.ts` — Ordered puzzle definitions, prerequisite-based unlock checks, and fresh sandbox and puzzle world factories.
* `src/game/puzzle-progress.ts` — Versioned local-storage serialization, validation, and victory recording for completed puzzle IDs.
* `src/game/screen.ts` — Tagged application-screen contract and the single development initial-screen setting.
* `src/render/canvas-renderer.ts` — Responsive Canvas 2D grid, overlay-aware camera fitting, bounded pan and pointer-anchored zoom, revision-and-scale-keyed welded-body geometry cache, stable-ID movement interpolation in every adjacent direction, hit testing, placement previews, and hover feedback.
* `src/render/grid-drag.ts` — Board-clipped tile-drag endpoints and continuous weld-edge traversal between pointer events.
* `src/render/pointer-gesture.ts` — Button/modifier gesture classification and middle-click drag-threshold policy.
* `src/render/tile-renderer.ts` — Body outline tracing and rounded-slab drawing (fill, bevel lighting, decorations), including animated conveyor perimeters, for the board and component palette.
* `src/simulation/circuit.ts` — Signed-ternary charge type, validation, sum resolution, and render colors.
* `src/simulation/furnace.ts` — Directional furnace recipe inputs, outputs, bake times, and lookup.
* `src/simulation/tile.ts` — Tile kinds, directions, and immutable tile behavior, render, board-code, and sandbox-palette definitions.
* `src/simulation/board-export.ts` — Deterministic compact ASCII tile-and-weld-grid JSON serialization and strict validation/deserialization for sharing board, furnace, and puzzle-result state.
* `src/simulation/puzzle-result.ts` — Latched in-progress, won, and lost puzzle-result states.
* `src/simulation/world.ts` — Typed-array tile, orientation, charge, wire-crossing axis charge, furnace progress/target, puzzle-result, and weld storage; stable IDs; render revisions; snapshots; editing; transformations; and body movement commits.
* `src/simulation/simulation.ts` — Allocation-free circuit-network, delayed gate, furnace, delivery-box, and victory-block resolution; phase-specific welded and magnetic body collection; gravity support; tangential magnetic sliding; conveyor force/reaction and pushing-chain resolution; conflict resolution; and tick advancement.
* `src/ui/tile-inspector.ts` — Revision-aware hovered-cell property presentation, including effective directional weldability, current welds, and furnace bake progress.
* `src/ui/component-palette.ts` — Definition-driven sandbox component palette construction and keyboard-shortcut lookup.
* `src/ui/main-menu.ts` — Definition-driven puzzle-map buttons with available, locked, and completed presentation.
* `src/util/assert.ts` — `expectDefined` assertion that crashes loudly on violated lookups instead of falling back silently.
* `tests/board-export.test.ts` — Compact board format ordering, round-trip, state, and malformed-input validation tests.
* `tests/circuit.test.ts` — Fixed and sensed circuit drivers, instant welded-network propagation, wire-crossing axis isolation, occupancy and charge sensor directionality, isolated gate networks and delay, combiner, multiplier, subtractor, and selector truth tables, disconnection, and moving-charge tests.
* `tests/furnace.test.ts` — Furnace recipe timing, target identity and movement, circuit control/output, and snapshot tests.
* `tests/delivery.test.ts` — Delivery matching, one-tick circuit pulses, competing-target jamming, and board-format round-trip tests.
* `tests/victory.test.ts` — Victory input, conflict, latching, reset, metadata, and board-format tests.
* `tests/conveyor.test.ts` — Conveyor circuit direction, force and gravity priority, magnetic ceiling crawling, normal magnetic constraints, reaction, weld isolation, push-chain, metadata, and board-format tests.
* `tests/simulation.test.ts` — Deterministic world, gravity, diagonal movement, conflict, weld, magnet, identity, and reset tests.
* `tests/grid-drag.test.ts` — Continuous tile and weld drag traversal tests, including board-boundary clipping.
* `tests/pointer-gesture.test.ts` — Pointer button, modifier, and drag-threshold regression tests.
* `tests/tile-renderer.test.ts` — Rounded body-outline and mixed-kind fill stability regression tests.
* `tests/tile.test.ts` — Directional and non-directional tile orientation resolution regression tests.
* `tests/puzzles.test.ts` — Puzzle ordering, prerequisite unlocking, and independent initial-world factory tests.
* `tests/puzzle-progress.test.ts` — Puzzle victory recording, deterministic persistence, initial state, and malformed stored-progress tests.
* `vite.config.ts` — Vite configuration with Vitest's Node test environment.
* `tsconfig.json` — Strict browser TypeScript and project build configuration.

## Current TODOs

Game flow:
* Implement restrictions on where the player can place blocks, defined as a region of the game grid - probably union of rectangles. Specify in the puzzle definition. Display on the puzzle as a dotted outline. (May want to define a general "union of rectangular regions" abstraction since the selection tool later could also use that.)
* Extend puzzle definitions with editable regions, available components and their prices, physical inputs/outputs, and test cases, then enforce those constraints in puzzle workshops.
* Change the editing model when solving puzzles: the player edits the initial board state, but as soon as they've played/run the simulation, they can no longer edit, they have to reset. Because puzzles won't allow modifying the board halfway through running a solution. We can still allow mid-run edits in the sandbox.
* Implement a way to show text boxes on the game screen, for tutorial puzzles. Specify their position and text as part of the puzzle definition.
* When selecting a puzzle, before jumping straight into the puzzle's game screen, add a puzzle info screen. It should show a description of the puzzle, a list of saved solutions and their scores, and have buttons to create a new solution, duplicate an existing solution, edit selected solution, and delete solutions.
* Add a way to specify multiple test cases for each puzzle. These will likely take the form of slight modifications to the puzzle definition, e.g. changing the values stored in one ROM component. The player builds one solution inside their allowed modification region; this must work for all test cases, where each test case modifies the in-world puzzle machinery outside that region, e.g. changing the delays on inputs.
* Add a button to test the current solution - runs all test cases in series, then checks if all resulted in victory, and if so, displays a report with the puzzle's score (price, cycles, footprint) with buttons to edit more or go back to the puzzle info screen.
* Add a signal-monitor component, and ROM-grapher component. In the puzzle screen, add an additional panel on the right that shows a readout of the signal received by the signal monitor every tick, and also shows a graph of the values in any ROM adjacent to the ROM-monitor. This is for puzzles - we can show the signals that the player will receive, the signals we expect them to output, and the actual signal they emit, similar to a Zachtronics game.

Components useful for designing puzzles in-world:
* Add a charge counter component - counts up from zero every tick it receives a charge on the back, and outputs a charge once it reaches a configured threshold. Requires some kind of UI for setting the threshold - maybe open a modal input box once the block is placed, and when pressing the F key with mouse over the block. (We'll need similar modals for some other configurable components, like ROMs.) Render the current count on the block.
* Add a dispenser component that dispenses a copy of the block behind it, creating the duplicate in front of it, when it receives a charge on the side.
* Add ROM component: +1/-1 on one side moves cursor, other sides output the stored value, modal allows setting ROM size and value in each cell.

UI:
* Check for any potential bugs caused by listening only to mouse-up and mouse-down events, and assuming the mouse button is held down until a mouse-up is received. Can cause accidental deletion or placing of tiles if the mouse-up event is hidden by other window events.
* Implement undo and redo when editing.
* Make the left palette more compact. For tiles, show only the tile and price and hotkey, not any other info. On mouseover of palette tiles, show the tile inspector/detail panel with the palette entry's name and description.


More items in `deferred-todos.md`.

## Development guidelines

Keep the simulation deterministic and independent of rendering. Some information (e.g. list of connected bodies) can be shared.

Handle unexpected undefineds loudly. When a lookup is logically guaranteed to succeed (e.g. checked indexed access under `noUncheckedIndexedAccess`), narrow it with `expectDefined` from `src/util/assert.ts` rather than a silent fallback (`?? default`, guarded `break`/`continue`). We want violated expectations to crash with a descriptive message during development, never to continue silently with wrong state. Reserve explicit fallbacks for cases where absence is genuinely valid.

Prefer a new focused file for a new concern.

Let's target one screen of blocks, maybe 400x300 tiles at most, on low-end hardware, animated at 60 FPS, with maybe 5 sim update steps per second.

No legacy compatibility is required. We are in early development. Make clean cutovers and remove obsolete callsites/aliases.

After completing changes, commit them to `master` or the current worktree. Self-contained commits are preferred.

## Build and verification

* `npm install` installs dependencies.
* `npm run dev` starts the Vite development server.
* `npm run build` type-checks TypeScript and creates the production bundle in `dist/`.
* `npm test` runs the deterministic simulation tests once.
* `npm run test:watch` runs tests in watch mode.