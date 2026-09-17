Create a few puzzles that are actually difficult.
Also create a few better tutorial puzzles.
Use the text box component we've added.

# Tutorial puzzles

**Before adding more tutorial puzzles, first figure out a good sequence of tutorials that are actually needed, and write them here.** Figure out what concepts we need to teach - that components are directional and can be rotated, that the possible signals are -1, 0, and +1, that there's a 1-tick delay on gates, etc. We want to avoid excessive trivial tutorial puzzles; cover each topic once only. Be sparing with explanations, let the player figure some of it out for themselves. Assume they've played games like Factorio, Minecraft, Zachtronics games, etc., and know what basic logic gates are or can figure it out from the descriptions given in the inspector.

Current tutorial puzzles:
* First shift: drop one stone block on the delivery box. Teaches gravity, placing blocks, player-modifiable region, testing a solution.
* Sand fall: build a ramp for sand to fall diagonally down. Teaches diagonal gravity, and welding maybe (though they could click-and-drag and not pay attention to welds).
* Puzzle infrastructure: place a judgment stone / victory block, and an inverter. Teaches welding, inverter, charges, directional components, judgement stone, and the general concept that a puzzle's win condition is defined on the game board rather than via metadata.
* Conduits: place channel/wire blocks. Teaches welding, welding at edges of the player-modifiable region, signed ternary charges.
* Opposite charges: place inverter and conduit. Teaches directionality, signed ternary charges. We should maybe remove this if other puzzles teach the same stuff.
* One beat later: place conduit and one delay gate. Teaches delays. We should maybe remove this and add a better puzzle that requires more understanding to solve, specifically ensuring that the player understands that different branches of a computation may require delays to synchronize the branches before values are combined. Maybe replace this with a puzzle that requires adding together the most recent 3 values in a sequence, since that naturally requires delays.

We should move the conduits and opposite charges puzzles to the "basics" section, and rename that section to "tutorial".

Things we are not teaching yet:
* Gates delay signals by one tick; branches must be time-equalized with delay gates. Necessary for solving the rectifier puzzle, binary crossed channels, and other puzzles we add later.
* How to use conveyors, pistons, rotators.
* Magnets.
* Transformation machines: furnaces, grinders, assemblers.
* Machines that weld and unweld.
* Charge sensors.

# Current non-tutorial puzzles

Our current set of non-tutorial puzzles is very small, and only has fairly simple circuit puzzles, no mechanical puzzles (conveyors, pistons, rotators). We just haven't added those yet; the puzzle set we ship on first release version will have more focus on mechanical puzzles.

* Rectifier: requires building rectifier without the rectifier block - requires combiners and multipliers, or other combinations of components.
* Change of Shift: detect increases (+1), decreases (-1), and unchanged values (0) using only conduits, inverters, and combiners. A fixed processing delay is allowed; the checker compares every tick after the first nonzero output. Three cases cover all nine ternary transitions, negative startup, and long steady readings. Includes board annotations and a reference solution verified at 27 cycles per case.
* Binary crossed channels: requires crossing two signals (only 0 and +1, no -1) without the dedicated crossing block. Can be done with 3 equality gates, plus some details for delaying specific lines and handling initial spurious `0 = 0` equality.
* Ternary crossed channels: similar but with -1 allowed. This is more difficult. Current reference solution has nested rune arrays.

# Ideas for non-tutorial puzzles

* Count up to N pulses from two separate sources and decide which source gave more pulses in total. One solution idea: use a counter block, with an inverter on one of the two inputs, and then check whether final value is positive or negative? But wrap-arounds are possible, so maybe use spark blocks to initialize it to N. Also we can't read the value of the counter block directly, would need to decrement it until it reaches zero and compare number of decrements to initial value; but that seems like almost the same problem we started with?
* A suite of basic circuit problems, where you only have: conduit, combiner, inverter, and fixed source. Add puzzles to build most of the more advanced circuit components out of these. The combiner is effectively a sum or vote/majority rune. Combiner also gives a 1-tick delay, so you can chain them to make a machine that acts like a delay rune with arbitrary memory size. Combiner with duplicate inputs, one delayed and inverted, gives edge detection. Spark is fixed value plus edge detection. For the rectifier/diode, we have a puzzle and reference solution, which needs two combiners and a multiplier. Rectifier could also be built using two combiners, fixed source, and inverter: use fixed source and inverter to get -1, then compute `Combiner(x, x, -1)` which takes (-1, 0, 1) to (-1, -1, 1), and then combine that with +1.
* Physically reverse a list: The player's machine receives ruby blocks and sapphire blocks in some order; they must be output in reverse order. Requires building a physical contraption that behaves like a push/pop stack, or maybe putting them in a box and physically rotating it. The player presses a button to receive the next block, and we drop a stone block (or pulse a signal) to indicate the end of the sequence. (How do we build the infra to test? Maybe a delivery box, swapping which block is below it. Or maybe use block-comparer to produce +1 and -1 charge for each one received, and then compare sequences omitting zeros. Or maybe put the entire sequence we expect on a conveyor belt below the delivery box.)
* Physical subtraction: Receive some number of stone blocks and some number of iron blocks; output a number of blocks equal to the absolute value of the difference, then press a button to validate answer.
* Puzzle: Given a supply of sand blocks, and a conduit that pulses N times, move N sand blocks to the output, and the rest to a different output. Alternatively, provide the requested amount via a clock that pulses every N ticks; or via a few separate buttons for requesting different amounts (say 1, 2, 3, 5; or ternary -3, -1, +1, +3, +5, and if multiple are on, they must output the sum).
* Puzzle: ROM implemented in-world with basic components. Given an NxM rectangle of ruby and sapphire blocks, and circuit impulses on a given column or row, read the ruby/sapphire state at that specific 2-dimensional index. Repeat for several lookups in the same NxM rectangle.
* Receive N signals in order on the left, must be output in reverse order on right, no rune crossing blocks allowed. Reverse order meaning vertically flipped; not time reversal. We've implemented puzzles for the N = 2 case; greater N can be done by repeating solutions to those. Could have variants, e.g. inner block gives signals and outer ring must receive them after some permutation.
* Puzzle: given N circuit inputs, output the most common one among them. As a variant, give them one signal with +1 and -1 over different ticks, and they must output the modal value / sign of the sum.
* Look at other puzzle games (The Witness, various Zachtronics games, Roody:2d) for inspiration. Add any components necessary to allow implementing similar puzzles in our game. For example, we could make Witness-style mazes by letting the player place only conduits, and they have to link a fixed charge to the victory block; but how could we implement other constraints from Witness's puzzles?
* Various straightforward mechanical manipulation puzzles, e.g. given stone blocks, weld them into 1x2 bodies, or 2x2, or one of each tetromino, or shapes made of different block types in specific configurations.
	* As additional puzzles, could add various constraints, e.g. use lock gate pattern to enforce creating some intermediate, then unwelding that and reassembling into a different shape.
	* Or give them a large top region to assemble one tetromino (chosen by a circuit input, different one each test case), but then it has to pass through a 2-wide gap to reach the delivery box. Or through a 1-wide gap to a small region that can do only a small amount of additional welding.
* Given rotator blocks and various circuit blocks, carry stone blocks from a low starting position to a high delivery block, by rotating them repeatedly.
* Puzzle: build a lock gate that allows through only bodies matching a specific shape.
* Puzzle: build a gantry that grabs bodies and moves them over a wall.
* Crossing a gap by building a flying machine. (Uncertain if this is even possible, unless we allow components that trivialize it, like horizontal sliders.)
* Kaizen-style puzzles: Given dispensers (duplicators with buttons) providing any number of welded 2x2 and 3x4 iron blocks, assemble iron helmets, which are some complex shape made of iron blocks. The player must decide how to drill and weld/unweld blocks to make up the helmet shape, and implement that in machinery.
* Slider block puzzles, like Rush Hour: Given some complex arrangement of welded pieces, each with a slider block preventing horizontal or vertical movement, build a device that will untangle them and extract one gem in the center.
* Puzzle: geode shelling. You're given geodes, must remove the shells, output the internal gems, either as wholes or as single tiles.
* Puzzle: You have 1 gemstone. Must show the gemstone at port 1, then port 2, then port 3, etc., corresponding to requests on the back wall. Requires moving it around according to commands.
* Route sand falling from above to different outputs on the right side. Some potential for tiny machinery plus long chutes, relying on sand falling rather than transporting all the way.
* Puzzle where you have to push a hanging piece up a ladder; it slots into the rungs. Maybe your entire contraption also needs to go back into a hole periodically to avoid walls that sweep across.
* Puzzle where a gemstone is entangled in differently-shaped stone pieces; must build pistons to shift the pieces in a specific way so the gemstone can drop down into a delivery box.
* Puzzle where you receive one stone block and must move it to one of N different output chutes depending on which one has a +1 signal nearby. Each test case only expects one single stone block delivered. As a follow-up, add a variant where the board has a complex shape, e.g. an S-shaped empty region surrounded by stone, with various delivery spots along the S.
* Add some puzzles in the style of very hard minimal puzzle games like Magicube, Jelly No Puzzle, Snakebird, Baba Is You - specifically minimal puzzles that seem impossible at first glance. Minimal meaning the puzzle is small, the player-modifiable region is small, and the set of allowed components is small.
