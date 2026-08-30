# Factory 2D (working title)

## Concept

This is planned to be a game similar to a 2D Infinifactory. The game is a series of one-screen puzzles, where the player places square 2D tiles/blocks on a grid to accomplish some goal.

At each line between two non-empty blocks, they can be either welded together, or separate. Welded groups of blocks always move as one group. The simulation runs in discrete time steps, and blocks move in discrete one-block increments. Blocks can only rotate in 90-degree increments. Some blocks have internal state. Blocks have different types, like stone or sand or pistons or conveyor belts or wires. This is a side view, so unsupported blocks fall down one space every one time step. No continuous-time or continuous-space physics.

Planned game flow: We show a main menu. The player selects a puzzle, which defines the initial screen and constraints, e.g. inputs and outputs, fixed terrain, player-modifiable region. Player can select components; left click places, right click removes. They can also select a weld tool or a selection tool. With the weld tool, left click welds, right click unwelds. When placing, they can rotate the component in 90-degree increments. Later additional conveniences like placing lines/rectangles, bulk weld/unweld, selection and moving. Each puzzle defines fixed terrain, and which components are available, and prices for those components which are used to score solutions. The player presses a button to run/play the simulation and check behavior, with options to pause, step once, control speed, or reset to the state before running.

Implemented components:
* Solid blocks - can have downward gravity, diagonal gravity (sand), can be weldable on some sides, can be magnetic.
* Magnets - attract a block in the direction they're facing.
* Conduits instantly share signed-ternary charge across welded circuit connections.
* Directional sensor runes emit +1 when the neighboring cell on their pointed side is occupied.
* Directional inverter runes negate signed-ternary charge from an isolated back input network onto their pointed output network one tick later.

Planned components:
* Furnace blocks that transform one neighbor cell into a different one after a delay: sand to glass, ore to metal.
* Conveyor belts apply a clockwise or counterclockwise force to their 4 neighbor blocks. A conveyor placed on a floor will try to roll in one direction, and try to push the platform in the other direction, unless it's welded onto the platform.
* Welders and splitters - weld or unweld the 3 blocks above them.
* Pistons - 1 block which expands to 2 blocks when given a signal, pushing things around.
* Sensors that detect pushing force from a direction.
* Electrical components like logic gates, delays, diodes, and brush connectors.
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

We'll give the game a "dwarven engineering" theme. So replace magnets with lodestones, electrical components with glowing runes. Puzzles range from heavy industry based on moving around big chunks of stone/metal, bottling beer, circuit puzzles (runes and conduits), minecart control systems, bar challenges (remove this block without spilling the mug of ale on top), destroying elven defenses by building missiles or dwarven mechs, etc.

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
* Competing intents at the same priority jam rather than depending on iteration order. Driven movement will outrank passive gravity. Pushing will resolve the complete dependency chain before any body moves.
* Rendering may interpolate committed steps, but interpolation never feeds back into simulation state.

The current engine implements observation, intent conflict resolution, and commit phases for straight-down and diagonal gravity. Welded and magnetically constrained bodies move as groups, and unsupported touching bodies resolve complete downward movement dependency chains before committing together. Driven movement, general-purpose pushing, and rotation remain future simulation work.

## Development state

Keep this section up-to-date.

The first playable scaffold is implemented:

* A 20x14 editable Canvas 2D grid with procedural sand, falling stone, magnetic metal, directional magnets, sensor and inverter runes, circuit conduits, and fixed platform tiles.
* A full-viewport black board layer behind responsive floating left and bottom control panels. The initial view fits the entire grid into the unobscured region; mouse-wheel zoom stays anchored beneath the pointer; and arrow keys, middle-button drags, or Alt-right-button drags pan within bounds that keep the screen center over the grid.
* Build controls for gap-free click-and-drag placement and removal, including Shift-left placement welded to every eligible occupied neighbor, drags that leave the grid, middle-click picking that preserves directional component orientation while middle-button drags pan, metadata-driven rotation and aiming shared by palette previews, placement ghosts, and placed tiles, stepping, running, pausing, resetting, clearing, speed selection, and an animation toggle.
* A separate weld tool for joining eligible occupied neighbors into rigid bodies and unwelding them, with gap-free fast-drag traversal, an immediate held-Control temporary override, and red invalid-edge feedback. Sand is not weldable, and magnets reject welds on their pointed side.
* One shared procedural tile renderer for the Canvas board, placement preview, and component palette. Palette previews use density-aware, supersampled backing stores and redraw when browser zoom or display density changes. Each welded body renders from traced, inset rounded-slab outlines whose occupied neighbors merge only across locally welded edges, so unwelded cuts stay visually stable when another cut splits the body and closed seam ends receive rounded caps. Rendering includes a drop shadow, per-cell fills that remain locally stable when different tile kinds are joined, decorations clipped to the outline, and top-left highlight and bottom-right shade bevels. Diagonally touching cells render as a rounded pinch. Per-body cells and `Path2D` outlines are cached across animation frames and rebuilt only after world changes or board geometry changes.
* Circuit-capable tiles render charge-colored traces only across welded circuit connections. Conduits have a dark center socket; sensor runes show their sensing direction and resolved charge; inverter runes show their pointed output and resolved output charge.
* A typed-array world with stable tile IDs, per-tile orientation and signed-ternary charge, edge weld storage, and allocation-free per-tick movement and circuit-network buffers.
* Deterministic straight-down gravity for stone, metal, magnets, and sand; complete downward body-dependency resolution; parity-selected diagonal gravity for sand; direct-fall priority; equal-priority destination jamming; and reciprocal magnetic constraints that hold bodies when supported while allowing unsupported attracting groups to fall.
* Deterministic circuit resolution rebuilds welded networks from the start-of-tick state, sums their drivers, takes the sign, and commits the result before movement. Directional sensor runes contribute +1 when their pointed neighboring cell is occupied. Directional inverter runes keep their back input and pointed output networks isolated and drive the negated start-of-tick input charge onto the output network.
* Simulation commits remain discrete and deterministic while stable tile IDs drive optional smooth eased rendering between the previous and current positions. Manual steps animate for 200 ms; automatic steps animate for up to 250 ms without delaying simulation ticks. A 60-ticks-per-second mode forces discrete rendering.
* A responsive top-right cell inspector shows the hovered tile's stable ID, movement behavior, effective weldable sides, current welds, circuit connections and charge, magnetic state, orientation, and attraction direction/range. It refreshes after simulation commits even when the pointer remains stationary.
* Deterministic tests for gravity chains, sand overhangs, welded and magnetically constrained bodies, circuit propagation, sensor directionality, isolated inverter ports and gate delay, conflicts, directional welding, orientation snapshots and preview resolution, boundaries, stable IDs, reset behavior, and pointer gesture classification.
* Board export and import controls round-trip deterministic, versioned JSON containing dimensions, simulation tick, non-empty tile kinds, non-up orientations, nonzero circuit charges, and each weld edge once. Imports validate the complete file before replacing the live board, support board sizes up to 400x300, and reconstruct fresh runtime tile IDs because IDs are intentionally excluded from the file.

## Code map

* `index.html` — Application shell, tile and weld palette, canvas, hovered-cell inspector, and simulation controls.
* `src/main.ts` — Browser entry point, example world setup, input handling, build tools, bounded pan/zoom controls, overlay-aware viewport insets, inspector coordination, and animation loop.
* `src/styles.css` — Responsive application, palette, inspector, board, and control styling.
* `src/vite-env.d.ts` — Vite client type declarations.
* `src/render/canvas-renderer.ts` — Responsive Canvas 2D grid, overlay-aware camera fitting, bounded pan and pointer-anchored zoom, revision-and-scale-keyed welded-body geometry cache, stable-ID movement interpolation, hit testing, placement previews, and hover feedback.
* `src/render/grid-drag.ts` — Board-clipped tile-drag endpoints and continuous weld-edge traversal between pointer events.
* `src/render/pointer-gesture.ts` — Button/modifier gesture classification and middle-click drag-threshold policy.
* `src/render/tile-renderer.ts` — Body outline tracing and rounded-slab drawing (fill, bevel lighting, decorations) for the board and component palette.
* `src/simulation/circuit.ts` — Signed-ternary charge type, validation, sum resolution, and render colors.
* `src/simulation/tile.ts` — Tile kinds, directions, and immutable tile behavior/render definitions.
* `src/simulation/board-export.ts` — Deterministic, versioned JSON serialization and strict validation/deserialization for sharing board state.
* `src/simulation/world.ts` — Typed-array tile, orientation, charge, and weld storage; stable IDs; render revisions; snapshots; editing; and body movement commits.
* `src/simulation/simulation.ts` — Allocation-free circuit-network and delayed inverter resolution, welded and magnetically constrained body collection, gravity intent selection, conflict resolution, and tick advancement.
* `src/ui/tile-inspector.ts` — Revision-aware hovered-cell property presentation, including effective directional weldability and current welds.
* `src/util/assert.ts` — `expectDefined` assertion that crashes loudly on violated lookups instead of falling back silently.
* `tests/board-export.test.ts` — Board export ordering, contents, and tick validation tests.
* `tests/circuit.test.ts` — Instant welded-network propagation, sensor directionality, isolated inverter networks and delay, disconnection, and moving-charge tests.
* `tests/simulation.test.ts` — Deterministic world, gravity, diagonal movement, conflict, weld, magnet, identity, and reset tests.
* `tests/grid-drag.test.ts` — Continuous tile and weld drag traversal tests, including board-boundary clipping.
* `tests/pointer-gesture.test.ts` — Pointer button, modifier, and drag-threshold regression tests.
* `tests/tile-renderer.test.ts` — Rounded body-outline and mixed-kind fill stability regression tests.
* `tests/tile.test.ts` — Directional and non-directional tile orientation resolution regression tests.
* `vite.config.ts` — Vite configuration with Vitest's Node test environment.
* `tsconfig.json` — Strict browser TypeScript and project build configuration.

## Current TODOs

New components:
* Add signed-ternary circuit components beyond the current +1 sensor source and directional inverter: other logic gates, delays, diodes, and non-welded charge-sensor runes. Gates should keep input and output networks separate and drive tick t+1 from values observed at tick t, so feedback remains deterministic. Add small tests.
* Add a directional furnace block, and some simple solid blocks to process (glass, iron ore, and iron replacing generic "metal" currently). Make the furnace block transform the block in its specified direction, according to a table of recipes and bake times - sand to glass, ore to iron. The furnace would need to store how long it's baked and count up to the bake time; baking should be cut short if the tile it's baking moves away. Allow circuit connections: back side charge deactivates the furnace, furnace outputs current bake state on the other 2 sides.
* Add a conveyor-belt block: applies forces to its 4 neighbors, if they're not welded to it, either clockwise or counterclockwise; applies the reaction force to itself. For rendering, draw a block with a dashed line, animated to move along each side. Allow connecting all sides (like a conduit, single network) and drive with charges - +1 clockwise, -1 counterclockwise, 0 stops.
* Add a piston block. It should be one block showing the arm and base of the piston overlapping. When it receives a charge, it should extend the arm, making it two separate blocks (considered welded together). When no charge is received, it should try to retract. This is a special case because we have effectively 2 blocks that can overlap, which is not usually allowed; but we could model it without overlaps, as 3 separate block types (arm, base, and combined arm+base), though we would still need to modify animation to show the arm extending.
* Implement a target component that absorbs adjacent blocks of a specified type, and marks the puzzle as completed once some number have been absorbed. Requires a UI for setting which block to absorb, and how many. This will be used in the sandbox for designing puzzles.
* Add a dispenser component that dispenses a selected block when it receives charge. Used for creating puzzle inputs.

Game flow:
* Implement a main menu. For now, continue booting straight to the sandbox for faster testing during development, but add a button to go to main menu. Main menu should have buttons for sandbox and puzzles.
* Implement a system for defining puzzles - probably similar to the current import/export format, with some extra fields. Each puzzle should define the grid size, blocks to pre-place, menu of enabled components with prices in talents, and region where player placement is allowed.
* Change the editing model when solving puzzles: the player edits the initial board state, but as soon as they've played/run the simulation, they can no longer edit, they have to reset. Because puzzles won't allow modifying the board halfway through running a solution. We can still allow mid-run edits in the sandbox.

Some more items in `deferred-todos.md`.

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