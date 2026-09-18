Tasks that are not actionable yet / lower priority / speculative have been moved to todos-deferred.md, along with notes about features we've decided not to add.

# Authoring tools, player-created puzzles, histograms

* Add histograms on the puzzle solution result modal. Rate solutions by percentile as coal, iron, gold, mithril. On the puzzle briefing screen, show the player's best score and percentile-mineral rank on each of the 4 metrics - for each metric, take the min/best over all their solutions. Also, if they have 2 or more solutions, the result modal should show their best score and the current solution's score for each metric, on each histogram. The backend already returns each installation's best-ever submitted metric frequencies without double-counting improvements; UI binning and ranks remain to be implemented.
* Add community puzzle browsing and solution-mode play of downloaded shared puzzles. Published files can currently be downloaded and imported into sandboxes.
* Allow voting community-created puzzles up and down. We can assume users aren't malicious, this is a zero-stakes indie game; expect under 10 players per day. Use the existing installation UUID rather than email/auth. Browser-level site-data deletion can still create another identity, but the game's clear button preserves it and full player-data import/export transfers it. If popularity warrants it, upgrade to a more robust system.

# New non-circuit components

* Flipper: attaches to one block, then flips the entire connected/welded group of blocks around that line horizontally or vertically, if it would not collide/overlap other blocks. Similar to Kaizen game's rotation.
* Add a bell block that plays a sound when it moves left/right (but not when moving up/down). Decide pitch by counting the blocks in the bell's body, so larger bells are lower pitch. Add a resonator rune that emits a charge when a bell with matching pitch rings, anywhere on the grid; decide resonator's pitch in the same way by counting its body's number of blocks. Constrain pitch to say one octave. Play audio in the browser when a bell block is triggered, maybe preventing it if sim rate is over 10 ticks per second.
* Hole-puncher block that destroys any blocks moved onto its tile cell, in the same tick they attempt to move onto it. For example, a 5x5 body falling onto one of these blocks, or moved past it by a conveyor, should be cut in half. Once we have the flipper block, also allow flipping bodies onto this block, which destroys the blocks that overlap it. Unclear what behavior we should have when rotating bodies onto it; maybe count it as colliding / preventing rotation onto it, or find all tiles that would intersect the hole-punch's center when rotated through it.
* Add a dwarf block which is breakable - anything falling onto the dwarf block should destroy it. Anything pushing the dwarf block should push it, unless the push is blocked by something on the other side like a wall, in which case that should also crush the dwarf. Use the shattering animation for this.

# Component behaviors

* Modify the assembler to add a pushing force for output: When it has a pending output, but no space to output, attempt to push the blocks away so that it can produce output; failing that, try to push the assembler itself in its forwards direction, so the product can be emitted out the back (at assembler's pre-movement position) in the same tick.
* Modify the duplicator in the same way as assembler above - make it also attempt to push itself away from the output side, if it's trying to duplicate a single-tile body but there's something blocking the output. When duplicating multi-tile bodies, don't do this - require already empty space for the whole body.
* Add flags to ban runtime welding and splitting of certain blocks, such as platforms, indestructible conduits, and delivery boxes. We still allow welding and splitting while creating a solution, or while editing the grid in the sandbox; but the welder, splitter, and laser-splitter blocks should not be able to weld/split any edges where both blocks have these flags set. (If only one has it set, still allow welding/splitting.) This would help to prevent some exploit solutions to puzzles.

# Performance

* Follow the current performance plan `docs/performance-todos.md`: refresh end-to-end browser measurements, investigate active fitted rendering, and measure retained session memory before choosing further optimizations. The original profile and completed optimization log are archived in `performance-history.md`.
* Figure out why our game has high CPU usage currently, and whether we can reduce that (e.g. for battery life on laptop and mobile). The geode bench scene currently uses around 100% CPU while running, on Firefox.

# Circuit network

## New circuit components

* Add a "rune engine" component that's like a programmable gate array. Take 2 inputs and produce 2 outputs. The block should be configurable to determine the I/O relation from some possible set. Details TBD. Could include an internal latch for feedback, like the PGA in Shenzhen IO. Visualize the engine block as a variation on the existing "rune array" component, but with a specific pattern of pre-set runes inside it, which cannot be modified except by toggling them between some specific states on click e.g. conduit vs stone block, or rotating by 90-degree increments.
* Add a stack block with push/pop to store data up to some max size. One input for value to push - always push if it's +1 or -1, but ignore zero. One input to trigger a push on +1, pop on -1. One output for popped value. One input to rotate it forwards or backwards on +1 or -1.
* Add a queue block, similar to the stack block.
* Add a delay block, but instead of advancing 1 space per tick, it advances when an additional input is +1. Maybe also allow -1 to scroll back. Uncertain, this seems similar to the queue block.
* Add a delay block variant that only steps forward if the input is +1 or -1, ignoring zeros. Like the current delay block, on every tick, it outputs the queued value; but we only shift the ring buffer forward and write a value when the back value is +1. Uncertain, seems similar to the queue block.
* Figure out what components are necessary to build a version of the 2D ROM that exists in-world. Given an NxM block of ruby and sapphire blocks, what components are needed to read or duplicate the block at a specific coordinate? Maybe add a light-beam block, and a beam reader block; then the beam reader reads the block in the row in front of it which has the light beam on it. So we have two arms which move to position the intersection at the necessary 2D coordinate. Reading could be by duplicating the block, or comparing it to an adjacent body like the existing body comparer block; or emit a signal based on the block's color (ruby is red so -1, sapphire is blue so +1).
* Figure out what components are necessary to construct an in-world display where each block is one pixel. Maybe a similar beam system to the above, but with a beam transmuter that copies a neighboring block to the point where its beam crosses a separate light beam. It should be possible to have a ROM / lore rune with some pattern of ternary values, and then build a device that will write the ROM rune's values one-by-one to a 2D array of blocks by e.g. setting them to different gemstone types.

# UI

* Implement undo and redo when editing in the sandbox and puzzle solutions.
* Add support for mobile and touch screens. Figure out what changes we need and break this up into more actionable tasks. (For example rotation and configuration currently require keyboard. And in the workshop, the palette panel takes up the entire left half of a vertical screen - move to top of vertical screens, maybe make it collapsible.)

# Visuals

## Animations

* Add animation for the delivery box, assembler, duplicator, lock gate. When they consume a body, animate the body shrinking, moving towards the block, and lowering opacity until it vanishes. When they produce a body, animate the opposite.

# Content

Ideas and puzzle list moved to `puzzles.md`. We need to add both tutorial puzzles to explain the game mechanics, and actual puzzles, at a range of difficulty levels. Before adding any puzzles, read that file, and keep it updated with new puzzles added.
