Tasks that are not actionable yet / lower priority / speculative have been moved to todos-deferred.md, along with notes about features we've decided not to add.

# Authoring tools and player-created puzzles

* Add community puzzle browsing and solution-mode play of downloaded shared puzzles. Published files can currently be downloaded and imported into sandboxes.
* Allow voting community-created puzzles up and down. Assume users aren't malicious; we'll upgrade to a more secure backend if it's ever necessary. Use the existing installation UUID. Browser-level site-data deletion can still create another identity, but the game's clear button preserves it and full player-data import/export transfers it.

# New non-circuit components

* Add a flipper block. It modifies the body of the block it's facing, by flipping that entire body around that block horizontally or vertically, if doing so would not collide/overlap other blocks.
* Add a resonator rune that emits a charge when a bell with matching pitch rings, anywhere on the grid; decide resonator's pitch in the same way by counting its body's number of blocks. This functions as dwarven radio/wireless signaling.
* Hole-puncher block that destroys any blocks moved onto its tile cell, in the same tick they attempt to move onto it. For example, a 5x5 body falling onto one of these blocks, or moved past it by a conveyor, should be cut in half. Once we have the flipper block, also allow flipping bodies onto this block, which destroys the blocks that overlap it. Unclear what behavior we should have when rotating bodies onto it; maybe count it as colliding / preventing rotation onto it, or find all tiles that would intersect the hole-punch's center when rotated through it.
	* As follow-up, add a lava block that behaves the same way, for e.g. puzzles about crossing a lava chasm.
* Add a dwarf block which is breakable - anything falling onto the dwarf block should destroy it. Anything pushing the dwarf block should push it, unless the push is blocked by something on the other side like a wall, in which case that should also crush the dwarf. Use the shattering animation for this.
* Add a swapper block that swaps its front and rear neighbors when it receives a +1 charge on either side. Keep welds the same - if the front block is a stone block with two sides welded, and rear is a lore rune with no sides welded, after the swap, the front block should be a lore rune (with the original rear neighbor's configuration and rotation/mirroring) but with the welds the stone block had, and vice versa. Except if that would break rules (non-weldable blocks, non-weldable sides of e.g. rotator blocks, and weld-protected blocks). Do not allow swapping with immovable or indestructible blocks. Allow swapping with empty blocks.
* Add a gravity stone that changes its welded body's gravity to point in the gravity stone's forward direction, instead of downward.

# Component behaviors

* Modify the assembler to add a pushing force for output: When it has a pending output, but no space to output, attempt to push the blocks away so that it can produce output; failing that, try to push the assembler itself in its forwards direction, so the product can be emitted out the back (at assembler's pre-movement position) in the same tick.
* Modify the duplicator in the same way as assembler above - make it also attempt to push itself away from the output side, if it's trying to duplicate a single-tile body but there's something blocking the output. When duplicating multi-tile bodies, don't do this - require already empty space for the whole body.
* Allow welding blocks to the front face of a rotator block. When it rotates, it should treat the body there the same way it currently treats a non-welded body, rotating it around the rotator itself (unless it's joined to the rotator's own body via some other path, in which case we should prevent rotating).
* Potentially allow configuring the initial state of stateful blocks like the rotator (initial head facing) and piston (whether to start expanded or retracted), maybe using some hotkey to toggle. Would require other changes: for the rotator, once we allow welding to the front/head this initial rotation determines which side can be welded to; for the piston, things like the cost of all placed components is a bit weird; may have to add a special case like piston heads and bodies each having half the price of ordinary retracted body-and-head piston blocks, but still hide body and arm separate blocks from the palette.
* Bug: see `temp/conveyor-blocking-bug.json`. The conveyor is trying to move its own body right, and pushing the body below it left. Both those pushes together would cause an overlap/collision, so they're prevented. However, in this case, we want to still allow the gap to be closed - probably the conveyor block's body should move right and the other body's leftward move should be blocked. Can we have this behavior while still having consistent predictable physics?

# Performance

* Follow the current performance plan `docs/performance-todos.md`: refresh end-to-end browser measurements, investigate active fitted rendering, and measure retained session memory before choosing further optimizations. The original profile and completed optimization log are archived in `performance-history.md`.
* Figure out why our game has high CPU usage currently, and whether we can reduce that (e.g. for battery life on laptop and mobile). The geode bench scene currently uses around 100% CPU while running, on Firefox.

# UI

* Add a volume adjuster in the settings menu. The `tone` function in `src/ui/workshop-sounds.ts:115` has a volume argument, may just need to multiply by the volume set in the settings. Make it logarithmic rather than linear, probably. Also add a separate adjuster for volume of bells specifically, which combines with the master volume to determine bell volume.
* For bell blocks, on mouseover, show the pitch of the bell as a number 1-8, which is determined by its body size. Either as an overlay on the bell block on the canvas (visible on mouseover), or inside the tile inspector.
* Add support for mobile and touch screens. Figure out what changes we need and break this up into more actionable tasks. (For example rotation and configuration currently require keyboard. And in the workshop, the palette panel takes up the entire left half of a vertical screen - move to top of vertical screens, maybe make it collapsible.)
* Implement limited undo/redo in the workshops (when editing puzzle solutions, or editing a sandbox). Probably keep a few previous states in memory. Running/testing should not write to these; it's for undoing modifications. (For sandbox running while editing, it's a bit unclear what the behavior should be. Maybe just advance the ring buffer / list of previous states whenever they edit.) Ideally click-and-drag should count as one action, so can be undone all at once.
* When configuring a ROM / lore rune, adjusting width seems to move around the values. Internally it's a 1D array, and resizing adds zero values at the end of the that 1D array, but that looks wrong because it's displayed as a 2D grid. Instead, we should make increasing the width leave all 2D grid values unchanged, adding an extra empty column on the right, so we should insert zero values at regular intervals in the 1D list. Similarly reducing width should act like removing the rightmost column, so removing width-spaced values in the list.
* When configuring a ROM / lore rune, clicking the up/down buttons to change the height causes the button to jump around because the modal resizes, so trying to click it multiple times is inconvenient. Rather size the `.rom-configuration-grid` for the maximum size of 9x9, and render smaller grids centered in that region, or render them at larger scale so they occupy the same space (though that might behave badly for 1x9 or 9x1 grids). Or do some other layout change that avoids buttons moving around.

# Visuals

## Animations

* Add animation for the delivery box, assembler, duplicator, lock gate. When they consume a body, animate the body shrinking, moving towards the block, and lowering opacity until it vanishes. When they produce a body, animate the opposite.
* Add some kind of animation when a bell rings. Maybe two faint circles radiating away from it.

# Content

Ideas and puzzle list moved to `puzzles.md`. We have enough tutorial puzzles. We need to add more actual puzzles, at a range of difficulty levels. Before adding any puzzles, read that file, and keep it updated with new puzzles added.
