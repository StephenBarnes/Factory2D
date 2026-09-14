Tasks that are not actionable yet / lower priority / speculative have been moved to todos-deferred.md, along with notes about features we've decided not to add.

# Authoring tools, player-created puzzles, histograms

* Write code for back-end server and database. Probably Cloudflare Workers + D1 + R2. Then make the game request histogram data and (later) shared puzzles, and allow submitting scores and shared puzzles. Use `crypto.randomUUID()` to assign each install an ID.
	* Follow-up: Allow voting community-created puzzles up and down. We can assume users aren't malicious, this is a zero-stakes indie game; expect under 10 players per day. We want to avoid setting up a whole auth system or requiring email addresses, etc. Using a simple unique ID allows exploits (e.g. clear browser data and double-vote) but we'll assume nobody does that. Version the database and roll back manually if needed. If the game becomes popular enough to need more than that, upgrade to a more robust system. Also, when using the "clear all player data" button, do not erase the UUID. Transfer the UUID on import/export of full player data.
	* Follow-up: Add histograms on the puzzle solution result modal. Rate solutions by percentile as coal, iron, gold, mithril. On the puzzle briefing screen, show the player's best score and percentile-mineral rank on each of the 4 metrics - for each metric, take the min/best over all their solutions. Also, if they have 2 or more solutions, the result modal should show their best score and the current solution's score for each metric, on each histogram. The histograms for each metric should use data from each player's best solution on each metric to that puzzle - so we'll need to remove the old value and add the new value.

# New non-circuit components

* Flipper: attaches to one block, then flips the entire connected/welded group of blocks around that line horizontally or vertically, if it would not collide/overlap other blocks. Similar to Kaizen game's rotation.
* Add a bell block that plays a sound when it moves left/right (but not when moving up/down). Decide pitch by counting the blocks in the bell's body, so larger bells are lower pitch. Add a resonator rune that emits a charge when a bell with matching pitch rings, anywhere on the grid; decide resonator's pitch in the same way by counting its body's number of blocks. Constrain pitch to say one octave. Play audio in the browser when a bell block is triggered, maybe preventing it if sim rate is over 10 ticks per second.
* Hole-puncher block that destroys any blocks moved onto its tile cell, in the same tick they attempt to move onto it. For example, a 5x5 body falling onto one of these blocks, or moved past it by a conveyor, should be cut in half. Once we have the flipper block, also allow flipping bodies onto this block, which destroys the blocks that overlap it. Unclear what behavior we should have when rotating bodies onto it; maybe count it as colliding / preventing rotation onto it, or find all tiles that would intersect the hole-punch's center when rotated through it.
* Add a magic link block. Whenever two link blocks are in the same row or column, they count as part of the same welded body for all physics/sim purposes. These allow creating single bodies that have holes in them through which things can fall.

# New component behaviors

* Fully support mirrored components. We have tools to reflect a copy-pasted group, but they don't actually mirror components. Later we also want to add machine blocks that can flip bodies. Currently, flipping horizontally, a left/right-pointing selector rune is currently rotated 180 degrees, and up/down-pointing ones are not rotated, which is correct for some components like a combiner or inverter that have bilateral symmetry. But components like selectors, ROMs, and laser splitters are not symmetric under reflection around the front-to-back line. Components that are bilaterally symmetric, or fully symmetric (like stone blocks) may not need to store mirroring.
	* As a follow-up, modify rendering for some components to match this - e.g. the indicator dots on selector runes and rotators.
* Modify the assembler to add reaction force: When it has a pending output, but no space to output, shift the assembler in its forwards direction, emitting the product out the back (at assembler's pre-movement position). Allow this motion to push other blocks that are in front of the assembler.
* Modify the duplicator in the same way as assembler above - make it also attempt to push itself away from the output side, if it's trying to duplicate a single-tile body but there's something blocking the output. When duplicating multi-tile bodies, don't do this - require already empty space for the whole body.
* Audit components that can move blocks for behavior when multiple are linked together. For pistons, we added dependency-ordered substeps to allow a tower of linked pistons to resolve in one tick. But rotators and maybe other components may need similar changes.

# Performance

* Potential optimizations noted in `docs/performance-todos.md` - some have been completed and greatly improved performance.
* Profile again at some point during/after doing those performance tasks, to determine whether / what should be optimized further.

# Circuit network

## New circuit components

* Add a "rune engine" component that's like a programmable gate array. Take 2 inputs and produce 2 outputs. The block should be configurable to determine the I/O relation from some possible set. Details TBD. Could include an internal latch for feedback, like the PGA in Shenzhen IO. Visualize the engine block as a variation on the existing "rune array" component, but with a specific pattern of pre-set runes inside it, which cannot be modified except by toggling them between some specific states on click e.g. conduit vs stone block, or rotating by 90-degree increments.
* Add a stack block with push/pop to store data up to some max size. One input for value to push - always push if it's +1 or -1, but ignore zero. One input to trigger a push on +1, pop on -1. One output for popped value. One input to rotate it forwards or backwards on +1 or -1.
* Add a queue block, similar to the stack block.
* Add a delay block, but instead of advancing 1 space per tick, it advances when an additional input is +1. Maybe also allow -1 to scroll back. Uncertain, this seems similar to the queue block.
* Add a delay block variant that only steps forward if the input is +1 or -1, ignoring zeros. Like the current delay block, on every tick, it outputs the queued value; but we only shift the ring buffer forward and write a value when the back value is +1. Uncertain, seems similar to the queue block.
* Figure out what components are necessary to build a version of the 2D ROM that exists in-world. Given an NxM block of ruby and sapphire blocks, what components are needed to read or duplicate the block at a specific coordinate? Maybe add a light-beam block, and a beam reader block; then the beam reader reads the block in the row in front of it which has the light beam on it. So we have two arms which move to position the intersection at the necessary 2D coordinate. Reading could be by duplicating the block, or comparing it to an adjacent body like the existing body comparer block; or emit a signal based on the block's color (ruby is red so -1, sapphire is blue so +1).

# UI

* Implement undo and redo when editing in the sandbox and puzzle solutions.
* Allow mirroring components with some hotkey. (Rotation currently uses WASD, Q picks blocks, E configures. Could use E when not over a block, or R.) Depends on the other change to store blocks' mirroring alongside rotation.
* Add support for mobile and touch screens. Figure out what changes we need and break this up into more actionable tasks. (For example rotation and configuration currently require keyboard. And in the workshop, the palette panel takes up the entire left half of a vertical screen - move to top of vertical screens, maybe make it collapsible.)

# Visuals

## Animations

* Add animation for the delivery box, assembler, duplicator, lock gate. When they consume a body, animate the body shrinking, moving towards the block, and lowering opacity until it vanishes. When they produce a body, animate the opposite.

# Content

Ideas moved to `puzzle-ideas.md`. We need to add both tutorial puzzles to explain the game mechanics, and actual puzzles, at a range of difficulty levels.
