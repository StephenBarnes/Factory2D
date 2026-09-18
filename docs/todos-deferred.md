# Game flow

## Sim test/play flow

* DEFER Maybe add a step-back button to the control panel at the bottom. Requires keeping previous state in memory, or several so we can step back multiple ticks.
* DEFER If we do the "asleep vs active regions" optimization below, or if we store previous state for step-back, then as a follow-up: when testing a solution, check for loops (no active regions, or previous state equals current state) and end the test early.

## New puzzle types

* DEFER Add support for a new puzzle type, where the player starts with a machine that doesn't work. They have to modify as few tiles as possible to make it work. Same scoring rules but we only count modified tiles. Add some way to view what tiles have been modified - maybe color grid lines yellow if their contained cell is modified.
* DEFER After the last set of puzzles is unlocked, also unlock a "full toolbelt" equivalent of every puzzle - a variant where all components are available, with the same list of prices for each. This adds content, lets players compete on more histograms.
* DEFER Add a variant of puzzle pricing, where instead of a price per block, you have a fixed number of each block, shown on the palette. Allow placing more than that, but show warning in bottom-left if puzzle exceeds allowed amount, and don't register success or entirely block testing.

# Storage format, import/export

* DEFER Further compact orientations and charges in the scene and tutorial export/import formats, possibly storing charges per network instead of per tile. More complex per-tile state (e.g. furnace stored ticks or target/delivery-block configuration) can remain verbose. Only include full ASCII grids for fields that aren't empty / default value everywhere.

# Authoring tools, player-created puzzles, histograms

* DEFER For community puzzles, organize them by their set of allowed components. Unlock each community puzzle group after the earliest progression point where all of those components have appeared in that group or an earlier group.

# New non-circuit components

* DEFER Add a press/stamper/crusher. Behaves similarly to the piston, but (1) if piston extension is blocked by another tile, and that tile can't be moved, it instead unwelds and destroys that tile; and (2) we have a list of recipes for transforming the tile that the extended arm touches, on extension.
* DEFER Add an electromagnet, and rework the current magnet block. Positive and negative charges make it switch polarity; opposite sides have opposite polarity. Both nonzero polarities stick to iron. Like sides repel, opposite sides attract, any any side is attracted to neutral magnetic blocks like iron. Maybe add static non-controllable magnets, which are also non-directional.
* DEFER Add a "box" component that has an internal grid of miniature components. Similar to the implemented rune array (reuse its nested `World` state, `WorldRuntime` tree, entering/leaving view, and nested board format), but instead of circuit signal ports, add holes where blocks can fall in/out or be pushed in/out. A miniature block that falls out through a hole becomes a full block on that side of the box; a full block that falls in becomes a miniature block. Similar to Factorio's warehouse mods, or Patrick's Parabox.
* Add a leaf block, and fire blocks. Furnaces should convert leaf blocks to fire blocks. Fire blocks should convert neighboring leaf blocks to fire blocks, and convert themselves to empty blocks.
	* Then add a system that allows trees to grow over time. Should be a deterministic but unpredictable process, e.g. base it on a hash of tick number and coordinate. Trees grow slowly, using simple rules that produce tree-like branching structures: if a leaf block neighbors empty space, and neighbors a wood block which has some welded pathway through wood to a dirt block, then there's a chance for the leaf block to create another leaf block in that empty space, and convert itself to a wood block.

## Lines and rectangles

Add some components that work with beams/lines of cells, and some that interact with enclosed rectangles. For example maybe grid splitter blocks, each facing in one diagonal direction (though we'll model it as 4 orthogonal directions), and when 4 of these grid splitters are oriented correctly and facing inward to create a rectangle, when they receive a charge they split all edges inside that enclosed rectangle.

* Figure out what components are necessary to build a version of the 2D ROM that exists in-world. Given an NxM block of ruby and sapphire blocks, what components are needed to read or duplicate the block at a specific coordinate? Maybe add a light-beam block, and a beam reader block; then the beam reader reads the block in the row in front of it which has the light beam on it. So we have two arms which move to position the intersection at the necessary 2D coordinate. Reading could be by duplicating the block, or comparing it to an adjacent body like the existing body comparer block; or emit a signal based on the block's color (ruby is red so -1, sapphire is blue so +1).
* Figure out what components are necessary to construct an in-world display where each block is one pixel. Maybe a similar beam system to the above, but with a beam transmuter that copies a neighboring block to the point where its beam crosses a separate light beam. It should be possible to have a ROM / lore rune with some pattern of ternary values, and then build a device that will write the ROM rune's values one-by-one to a 2D array of blocks by e.g. setting them to different gemstone types.

## Blocks we could add, but probably shouldn't, rather build from existing tools

* Linear actuator or drive collar. Like a piston that can extend multiple tiles long - we have a rod below and above the drive collar, then a charge causes it to consume from one side and add on the other side. Don't add, because we can build this using a conveyor belt moving the rod.
* Lock gate block - consume body in front and output it on the other side flipped, on receiving a charge. Rather don't add, because we can build this 
* Magic barrier beam block - rather use pistons to create a physical barrier.

# Performance

* Mark some tiles or regions as asleep, if they have no updates. Wake up only regions where things are happening. E.g. a static structure made of only solid no-action blocks doesn't need to be processed every frame, doesn't need to re-check gravity every frame, etc.
* Cache circuit networks instead of rebuilding every tick.
* Compute the next simulation step async, while the last update is still being animated.
* Potential issue later: we may have very large connected bodies. For example a puzzle in a 400x300 map almost entirely filled with welded stone blocks, where the player needs to build a mining machine. Every time they mine one block, that entire welded body changes and may trigger work to update its entire border. We might need to split the body into chunks and make separate paths for their borders, meeting at the chunk boundary, or something like that.

# UI

* Maybe support selections that are a union of rectangles, created by shift-LMB-drag.

## Puzzle briefing screen

* DEFER Add text and art in the puzzle briefing - write a story to explain why the player is solving this puzzle.

# Visuals

* DEFER Add background art for puzzles. Maybe caves, multiple layers, with parallax as player pans.

## Specific block appearance changes

* DEFER Rework magnet artwork alongside the planned electromagnet mechanics.
* DEFER For the rotator component, we should modify rendering to make behavior more obvious. Maybe draw as a welded block with only around a third of the width, on welded side, and then draw the rotator arm separately. Also mark red/blue on the sides of the base to show which charge rotates in which direction.

## Animations

* DEFER Interpolate movement inside a rune array while its contents are displayed and the array itself moved in the same tick: the nested previous world is matched by ID path, which works, but a resized array yields no interpolation source for that tick.

# Larger projects, DEFER to later or never, and break up into tasks:

* DEFER Add hexagonal grids for some puzzles.
* DEFER Add a system of mechanical devices, like our current ternary circuit system (conduits, inverter, etc.) but with different visuals and different mechanics. We're restricted to motion that's legible in our 2D side view. Add chain drives that can rotate clockwise (+1), counterclockwise (-1), or stay still. Add gears that rotate in the inverse direction from a neighbor, and equivalents to other rune/circuit components.
* DEFER Blocks that set specific rules, e.g. what can be smelted to what, or what the assembler recipes are. Allows puzzles in the vein of Baba Is You, and more freedom in puzzle design.
* DEFER Add elf archers with some simple behavior. Add arrows that they can shoot, which arc up for 2 tiles diagonally, then travel to the side and destroy the first block they hit.