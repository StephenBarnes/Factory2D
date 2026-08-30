Components:
* Add a piston block. It should be one block showing the arm and base of the piston overlapping. When it receives a charge, it should extend the arm, making it two separate blocks (considered welded together). When no charge is received, it should try to retract. This is a special case because we have effectively 2 blocks that can overlap, which is not usually allowed; but we could model it without overlaps, as 3 separate block types (arm, base, and combined arm+base), though we would still need to modify animation to show the arm extending.
* Implement a target component that absorbs adjacent blocks of a specified type, and marks the puzzle as completed once some number have been absorbed. Requires a UI for setting which block to absorb, and how many. This will be used in the sandbox for designing puzzles.
* Add a dispenser component that dispenses a selected block when it receives charge. Used for creating puzzle inputs.
* Welder blocks.
* Splitter blocks.
* Comparer-sensors.
* Electrical components like logic gates, delays, latches, diodes, brush connectors (or voltage sensors, rather).
* Assemblers that convert a group of blocks welded in a specific way into one block. For example iron and copper blocks welded in a specific way are converted to a piston block.
* Flipper: attaches to one block, then flips the entire connected/welded group of blocks around that line horizontally or vertically, if it would not collide/overlap other blocks.
* Laser splitter: splits everything in a line.
* Configurable components where the player can enter a number in a text box, e.g. a configurable-delay repeater.
* Component that rotates a neighboring block or body around itself.

Performance:
* Profile to determine if there's any need to optimize, and if so, what to optimize.
* Check if we're caching connected/welded bodies, or flood-filling every frame. Can easily cache it and update only on the infrequent weld/unweld operations.
* Mark some tiles or regions as asleep, if they have no updates. Wake up only regions where things are happening. E.g. a static structure made of only solid no-action blocks doesn't need to be processed every frame, doesn't need to re-check gravity every frame, etc.
* Cache circuit networks instead of rebuilding every tick.
* Maybe: Compute the next simulation step async, while the last update is still being animated. Would improve performance if simulation step time grows to exceed frame time.

Circuit network:
* Add configurable delays.
* Figure out how to handle wires that become split or welded together while a game runs. May already be handled correctly.
* Maybe extend the set of charges (0, +1, -1) to add orthogonal +i and -i charges, or add a 2-wire tile with components for reading the different wires.
* Maybe add min() and max() gates.
* Implement a "rune array" component for miniaturizing circuits. When placed, or when clicking on the array with array tile selected, or when pressing F key with mouse over it, open a modal box that allows configuring it by placing "miniature" components on a 5x5 grid "inside" the array. The 4 edge-center tiles of the array's grid are logically connected to the rune array's 4 sides.

Game flow:
* Change the editing model when solving puzzles: the player edits the initial board state, but as soon as they've played/run the simulation, they can no longer edit, they have to reset. Because puzzles won't allow modifying the board halfway through running a solution. We can still allow mid-run edits in the sandbox.
* Further compact orientations and charges in the export/import format, possibly storing charges per network instead of per tile. More complex per-tile state added later (e.g. furnace stored ticks or target/delivery-block configuration) can remain verbose.
* Implement puzzle selection and unlocking: puzzles are arranged in a digraph / map, with each puzzle having a set of prerequisites, arranged into groups like "runelore" and "vehicles" and "dealing with elves". Add zoom/pan for the map.
* Implement a way to show text boxes on the game screen, for tutorial puzzles. Specify their position and text as part of the puzzle definition.
* Implement restrictions on where the player can place blocks, defined as a region of the game grid. Specify in the puzzle definition.
* When selecting a puzzle, add a menu that shows saved solutions and their scores, and allows creating a new solution, duplicating an existing solution, editing selected solution, and deleting.

UI:
* Add a selection tool, for selecting a rectangular region of tiles and copying, pasting, moving, and rotating.
* Add a way to copy selection to a clipboard, for transferring machines between puzzles.