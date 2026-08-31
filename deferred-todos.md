Components:
* Add a piston block. It should be one block showing the arm and base of the piston overlapping. When it receives a charge, it should extend the arm, making it two separate blocks (considered welded together). When no charge is received, it should try to retract. This is a special case because we have effectively 2 blocks that can overlap, which is not usually allowed; but we could model it without overlaps, as 3 separate block types (arm, base, and combined arm+base), though we would still need to modify animation to show the arm extending.
* A sensor that detects when the sensor's own tile moves, and outputs +1 on that side, -1 on the other side.
* Welder blocks.
* Splitter blocks.
* Comparers: compare front neighbor to back neighbor, and output +1 on sides if they're equal, else output 0.
* Electrical components like logic gates, delays, latches, diodes, brush connectors (or voltage sensors, rather).
* Assemblers that convert a group of blocks welded in a specific way into one block. For example iron and copper blocks welded in a specific way are converted to a piston block. We also want this to be able to convert one block to multiple (unwelded) blocks - so need to store a queue of blocks to emit, emit them one-by-one when the output tile is empty, and prevent the assembler from running when the queue is non-empty or over some limit.
* Flipper: attaches to one block, then flips the entire connected/welded group of blocks around that line horizontally or vertically, if it would not collide/overlap other blocks.
* Laser splitter: splits everything in a line.
* Configurable components where the player can enter a number in a text box, e.g. a configurable-delay repeater.
* Component that rotates a neighboring block or body around itself.
* Add a fragility flag to tile kinds, and set it to true for glass blocks. A fragile block that drops and then stops falling should be deleted, animated with a simple shatter effect.
* Add a cushion flag and cushion block. Fragile blocks that fall onto a cushion block do not shatter.
* Add a press/stamper/crusher. Behaves similarly to the piston, but (1) if piston extension is blocked by another tile, and that tile can't be moved, it instead unwelds and destroys that tile; and (2) we have a list of recipes for transforming the tile that the extended arm touches, on extension.
* Grinder blocks that process a block in front into a product block - exactly like the furnace, but with a distinct table of recipes and different appearance (and later animation and sound).
* A drill/destroyer block that destroys the block in front of it.
* Add an indestructible flag. Blocks like crushers and drills should not be able to destroy these. Needed to prevent some exploits when solving puzzles, e.g. by drilling into the ground and activating the victory block.

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
* Add a system of mechanical devices, a bit like our current ternary circuit system (conduits, inverter, etc.) but with different visuals and different mechanics. Since the game is 2D, we're restricted to 2D motion. Add chain drives that can rotate clockwise (+1), counterclockwise (-1), or stay still. Add gears (closer to one edge of the cell) that rotate in the inverse direction from that cell. Tint rotating components blue/red to make charges more visually distinct. Add equivalents for our runes: sensor rune becomes pressure plate, inverter is just a gear, wire-crossing is crossed chains. Others I'm not sure about: combiner, rectifier, multiplier, subtractor, sensor, selector. Also motors and generators to convert between runes/conduits and these clockwork components. We may add this as a later alternative to runes and conduits, for additional challenge.

Don't add, for circuit network, because they can be built from a few existing components:
* AND/OR, NAND/NOR. (Maybe add min/max, though.)
* Edge detectors: can be done by using an inverter to get `-x[t-1]` and using a combiner to add `x[t] - x[t-1]`.
* Latches: can be done by connecting a combiner's output to its input.
* Block that writes alternating red/blue charges every tick. Because we can create this with a spark plus inverter feeding itself.

Visuals:
* Mark the wire crossing in a way that makes it apparent it's a wire-crossing block when exactly one side is connected to a wire. Currently that's not visually distinct. Maybe draw the central cross regardless of how many sides are wired.
* Add animation for the delivery box - animate tiles moving into it, and shrinking, as they're absorbed.

Game feel:
* Try out alternate easing for movements. Maybe define per-block easing.
* Add sounds. On block placement/removal, welding/unwelding. On victory block triggering.

UI:
* Add a selection tool, for selecting a rectangular region of tiles and copying, pasting, moving, and rotating.
* Add a way to save a selected region in a list of saved machines, and import from that. Make it usable for transferring partial machines from one puzzle solution to another.
* Add a way to copy selection to a clipboard, for transferring machines between puzzles.
* When saving an image using the image button, crop out parts of the screen that are over the background, outside the grid, if this can be implemented easily.
* Further compact orientations and charges in the export/import format, possibly storing charges per network instead of per tile. More complex per-tile state (e.g. furnace stored ticks or target/delivery-block configuration) can remain verbose.