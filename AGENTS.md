# Factory 2D (working title)

## Concept

This is planned to be a game similar to a 2D Infinifactory. The game is a series of one-screen puzzles, where the player places square 2D tiles/blocks on a grid to accomplish some goal.

At each line between two non-empty blocks, they can be either welded together, or separate. Welded groups of blocks always move as one group. The simulation runs in discrete time steps, and blocks move in discrete one-block increments. Blocks can only rotate in 90-degree increments. Some blocks have internal state. Blocks have different types, like stone or sand or pistons or conveyor belts or wires. This is a side view, so most unsupported blocks will fall down one space every one time step. No continuous-time or continuous-space physics.

Game flow: We show a main menu. The player selects a puzzle, which defines the initial screen and constraints, e.g. inputs and outputs and fixed terrain. They can select components to place from a list, or use keys and mousewheel. Left click places, right click removes tiles. We'll have several tools: tile changes, select/move, and weld tool. With the weld tool selected, left click welds, right click unwelds. When placing, they can rotate the component in 90-degree increments. Later additional conveniences like placing lines/rectangles, bulk weld/unweld, selection and moving. Each puzzle defines the fixed terrain, and which components are available, and prices for those components which are used to score solutions. The player presses a button to run/play the simulation and check behavior, with options to pause, step once, control speed, or reset to state before running.

Examples of components:
* Solid blocks.
* Wire blocks which transmit voltage to other wire blocks welded to them. Not a boolean value, but an integer or float, so signals can be sent and processed.
* Furnace blocks that transform one neighbor cell into a different one (e.g. ore -> iron, sand -> glass) after a delay.
* Conveyor belts, which apply a clockwise or counterclockwise force to their 4 neighbor blocks. For example a conveyor belt placed on a floor will try to roll in one direction, and try to push the platform in the other direction, unless it's welded onto the platform.
* Welders and splitters - weld or unweld the 3 blocks above them.
* Pistons - 1 block which expands to 2 blocks when given a signal, pushing things around.
* Sensors that emit a signal if they have a neighboring block in a certain direction. Or sensors that detect pushing force from a direction.
* Electrical components like logic gates, delays, diodes, brushes.
* Magnets that pull blocks closer.
* Assemblers that convert a group of blocks welded in a specific way into one block. For example iron and copper blocks welded in a specific way are converted to a battery block.
* A flipper: attaches to one block, then flips the entire connected/welded group of blocks around that line horizontally or vertically, if it would not collide.
* Laser splitter: splits everything in a line. Welder variants, e.g. welding together 2 blocks in a straight line on one side.
* Configurable components where the player can enter a number in a text box. For example a configurable-delay repeater.
* Maybe programmable components with a simple programming language.
* Component that rotates a neighboring block, or group of connected blocks.

More concepts:
* Some blocks like sand have a tendency to move diagonally down when downward falling is blocked.
* Furnaces could have special behavior if said neighbor is surrounded by certain other neighbors. Or they could trigger a block to weld to neighbors after cooking it. Or there could be stages, e.g. ore -> iron -> steel, and to make iron you'd have to build a machine that deactivates the furnace (or pushes the iron aside) before it turns the iron into steel.
* Each puzzle could have several test cases, e.g. with different timing of inputs.
* Puzzles could include terrain that makes it harder to fit a solution, or components like teleporters, etc. For example the solution might require welding blocks together, but there's only one welder present on the map, so it must be reused in different ways.
* Puzzles could include a wire input that switches on/off, and the solution must e.g. sort blocks into left vs right outputs dependent on the wire's charge.
* Probably we introduce components gradually, as puzzles are completed. Each puzzle has a limited set of components available.
* Puzzle inputs and outputs could be physically present on the map. For example a dispenser block dispenses ore, which must be smelted to iron, which is then delivered to a delivery block; level is won when delivery block has received 10 iron blocks. We could wire up the dispenser to a timer circuit shown in the level, or to a button that the player can press.
* We'll show a sidebar with all interactions relevant for a given puzzle.
* Potentially later: Shareable puzzles and solutions. Sandbox and puzzle editor. Exporting solutions as GIFs.

Example puzzles:
* Given inputs, weld them together and use an assembler to make intermediates; then weld together those intermediates and use an assembler to make a final product.
* Sort blocks into bins based on physical properties.
* Build a 4-bit adder using wires and logic gates.
* Build a 4-bit adder but no wires or logic gates are available - so you have to instead simulate it by pushing around blocks mechanically.
* Mob farms - mobs are dispensed by a hive and move around according to rules, must be killed and processed.
* Depalletizing - dispenser gives a 5x5 group of welded iron blocks, which must be split up and transported to the delivery block.
* Build a vehicle that picks up a block in one location and moves it to the target.

While the simulation has movement in sharp one-tile increments, we want to animate them moving. So the simulation loop is something like:
* Every n frames, compute what happens in the next frame - a motion direction for each connected group of tiles.
* Then for the next n frames, animate them moving or rotating.
* Then repeat, computing new motion directions.
We could do the simulation computation while the last update is still being animated.
We'll have time settings to disable this for faster verification.

We want simulation rules to be deterministic, consistent, and understandable/predictable.
We'll write many small tests that simulate scenarios and check behavior.
As a general rule, we should enforce that a component can only observe the state at the beginning of a cycle, and react to it by making a change that becomes visible at the end of the cycle. So nothing reacts instantly to something that happened in the same tick.

For tiles with internal state, we likely want to keep stable tile IDs, so that a tile that moves can still keep the same data in-place. So probably the tile grid contains, in each cell, a tile type (empty, stone, etc.) plus optional ID indexing into an array of tile states.
Each tile type could have bits for various properties: subject to gravity, can move diagonal-down, is magnetic, is conductive, is insulating (for later heat mechanics), is transparent (for laser mechanics or sensors), etc. So e.g. a magnet block would check whether a tile is magnetic to decide how to modify it.

There may be some cases where desired behavior is not clear. For example, a group of welded blocks being pushed upward by one piston, and rightward by another. Or a 2x2 group of 4 pistons trying to push each other in a spiral. Or an object falling, but a piston tries to push it right. We need to decide how these cases should behave.
Probably each component submits a force or attempt to push, and then we resolve conflicts by either jamming (preventing all movement), or by priority (pistons are higher priority than gravity).
We need to allow a piston to push say 4 separate blocks in a row. If a driven body wants to move in a direction, but is blocked by some other body, it should try to push that body as well, causing many bodies in a row to be pushed in the same direction.

## Stack

* Strict TypeScript targeting modern browsers.
* Framework-free HTML and CSS.
* Canvas 2D rendered directly.
* Vite for development server and production bundling.
* Vitest with the Node environment for simulation tests.
* Browser APIs for later audio and persistence: Web Audio API and localStorage/IndexedDB.

We have no sprite assets. Tiles are drawn procedurally using Canvas 2D functions and colors defined on `TILE_DEFINITIONS`.

### Simulation conventions

* A world stores compact tile kinds separately from stable, nonzero tile IDs. Empty cells have ID 0.
* Each tick has observation, intent resolution, and commit phases. Components only observe the start-of-tick state.
* Gravity moves an eligible body at most one cell per tick. World boundaries are solid.
* Competing intents at the same priority jam rather than depending on iteration order. Driven movement will outrank passive gravity. Pushing will resolve the complete dependency chain before any body moves.
* Rendering may interpolate committed steps, but interpolation never feeds back into simulation state.

The current engine implements observation, intent conflict resolution, and commit phases for straight-down and diagonal gravity. Welded bodies move as rigid groups, and unsupported touching bodies resolve complete downward movement dependency chains before committing together. Driven movement, general-purpose pushing, and rotation remain future simulation work.

## Development state

Keep this section up-to-date.

The first playable scaffold is implemented:

* A 20x14 editable Canvas 2D grid with procedural sand, falling stone, magnetic metal, directional magnets, and fixed platform tiles.
* Build controls for click-and-drag placement, right-click removal, magnet rotation and aiming, stepping, running, pausing, resetting, clearing, and speed selection.
* A separate weld tool for joining eligible occupied neighbors into rigid bodies and unwelding them, with an immediate held-Control temporary override and red invalid-edge feedback. Sand is not weldable, and magnets reject welds on their pointed side.
* One shared procedural tile renderer for the Canvas board, placement preview, and component palette. Welded neighbors render continuously without an internal gutter, including inset curved inner borders on L-shaped bodies.
* A typed-array world with stable tile IDs, per-tile orientation, edge weld storage, and allocation-free per-tick movement buffers.
* Deterministic straight-down gravity for stone, metal, magnets, and sand; complete downward body-dependency resolution; parity-selected diagonal gravity for sand; direct-fall priority; equal-priority destination jamming; and reciprocal magnetic attraction that takes priority over gravity for both bodies.
* Deterministic tests for gravity chains, sand overhangs, welded bodies, conflicts, directional welding, reciprocal magnetic attraction, orientation snapshots, boundaries, stable IDs, and reset behavior.

## Code map

* `index.html` — Application shell, tile and weld palette, canvas, and simulation controls.
* `src/main.ts` — Browser entry point, example world setup, input handling, build tools, and animation loop.
* `src/styles.css` — Responsive application, palette, board, and control styling.
* `src/vite-env.d.ts` — Vite client type declarations.
* `src/render/canvas-renderer.ts` — Responsive Canvas 2D grid, continuous welded-body rendering, hit testing, placement previews, and hover feedback.
* `src/render/tile-renderer.ts` — Shared definition-driven procedural tile drawing for the board and component palette.
* `src/simulation/tile.ts` — Tile kinds, directions, and immutable tile behavior/render definitions.
* `src/simulation/world.ts` — Typed-array tile, orientation, and weld storage; stable IDs; snapshots; editing; and body movement commits.
* `src/simulation/simulation.ts` — Allocation-free welded-body collection, gravity and magnetic intent selection, conflict resolution, and tick advancement.
* `tests/simulation.test.ts` — Deterministic world, gravity, diagonal movement, conflict, weld, magnet, identity, and reset tests.
* `vite.config.ts` — Vite configuration with Vitest's Node test environment.
* `tsconfig.json` — Strict browser TypeScript and project build configuration.

## Current TODOs

Adding features:
* Add powerful magnets with a range of two cells. This requires driven movement toward the magnet when a magnetic body is not yet adjacent.
* Add electromagnets that are active only while connected to charged wires.

## Development guidelines

Keep the simulation deterministic and independent of rendering.

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