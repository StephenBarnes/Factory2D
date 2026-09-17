
# Tutorial puzzles

**Be wary of adding more tutorial puzzles.** Players don't need a separate tutorial for each component, they can figure it out from the inspector's tooltips and examples. Assume they've played Zachtronics games.

Current tutorial puzzles:
* Click to test: no player-modifiable region; they just click the button to test it. Demonstrates basic puzzle testing flow.
* Stone drop: teaches placing blocks, player-modifiable region, palette, gravity. Place one stone block and let it fall into the delivery box. The right half shows exactly what's needed.
* Sand fall: build a ramp for sand to fall diagonally down. Teaches diagonal gravity and welding. Right side of the grid has an example showing how welded parts work and how sand falls.
* Basic runelore: place conduits and an inverter in 3 steps to carry a signal to the output. Instructions on the grid in text boxes. We also enable placing the charge sensor which allows for a shortcut. Reinforces welding mechanics.
* Puzzle infrastructure: place a judgment stone / victory block. Teaches the general concept that a puzzle's win condition is defined on the game board rather than via metadata.

Things we are not teaching yet:
* Gates delay signals by one tick; branches must be time-equalized with delay gates. Necessary for solving the rectifier puzzle, binary crossed channels, and other puzzles we add later.
* Conveyors, pistons, rotators.
* Magnets.
* Transformation machines: furnaces, grinders, assemblers, duplicators.
* Machines that weld and unweld.
* Charge sensors, the fact that they can sense at a distance, and their interaction with glass.

# Current non-tutorial puzzles

Our current set of non-tutorial puzzles is very small: three mechanical puzzles and five circuit puzzles. The puzzle set we ship on first release version will have more focus on mechanical puzzles.

## Mining operations

* First Cart: an Easy puzzle before Geode Extractor. Build a self-propelled cart in a small left-hand bay and reach the fixed sensor on the right. Only stone, channels, fixed charge runes, and conveyors are available; the track and finish circuitry are outside the editable region. The reference solution welds a fixed charge rune above a conveyor and reaches victory in 14 cycles (80-cycle limit). This introduces conveyor reaction forces without adding another tutorial.
* Geode Extractor: requires triggering a duplicator to create geodes, some drills to carve away the stone, and conveyors to move the ruby to the delivery box. There's 2 separate duplicators in different directions, so players can solve it via different layouts, or use both for faster throughput. Most circuit and mechanical components (welder, splitter, rotator, magnet, grinder) are enabled; the reference solution only uses drills and conveyors. More intermediate puzzles could introduce drills before this puzzle.

## Runelore

* Rectifier: requires building rectifier without the rectifier block - requires combiners and multipliers, or other combinations of components.
* Change of Shift: detect increases, decreases, and unchanged values using only conduits, inverters, and combiners. Three cases cover all nine ternary transitions, negative startup, and long steady readings.
* Holding Pattern: stretch each one-tick +1 or -1 pulse into exactly ten ticks of the same sign, then return to zero. Four cases cover both starting signs, back-to-back pulses (including repeated signs), and uneven gaps. Channels, inverters, combiners, delay gates, and delay runes are available. The reference solution uses combiner feedback and a delayed inverted input to end each hold, passing every case in 51 cycles (120-cycle limit).
* Binary crossed channels: requires crossing two signals (only 0 and +1, no -1) without the dedicated crossing block. Can be done with 3 equality gates, plus some details for delaying specific lines and handling initial spurious `0 = 0` equality.
* Ternary crossed channels: similar but with -1 allowed. This is more difficult. Current reference solution has nested rune arrays.

The fixed ROM signal sources in these five runelore puzzles face right and are mirrored, so rear +1 reads the authored spatial grid left-to-right, then top-to-bottom under component-relative carry rules. Reference scenes use the same handedness.

# Ideas for non-tutorial puzzles

* More mining puzzles between First Cart and Geode Extractor: (1) make a vehicle that moves right, then left, to activate two sensors; (2) make a vehicle that does this but also drills away obstacles.
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
* Give an input signal with say 8 values. Require outputting all 8 values to 8 different output ports, at the same time. Requires some basic delays, or potentially a falling charge sensor that feeds into different latches made from delay gates, or similar.
* Cave-in rescue: a dwarf is trapped underneath several bodies made of stone blocks in different shapes. Build a machine to remove all of them without crushing the dwarf, and then move the dwarf to a delivery box.
* Given ore blocks falling from different positions on the ceiling, collect all of them and drop them into one delivery box. Obvious solution is conveyor belts, so disable those.
* Puzzle where you have to output a specific sequence of ternary values, in order. We ban the ROM rune and lookup rune, so it has to be implemented with delay gates, sparks, fixed charges, etc. Kind of like painting a picture with red/blue/black pixels. We could have an entire "art" puzzle group with different variants, like a checkerboard or 3-color checkerboard or square of blue surrounded by black, etc.
* Puzzle where you have to build a vehicle that travels over a chasm, building its own path. Allow duplicator and welder; so you need a moving vehicle that duplicates stone blocks and welds them to the head of the path, then advances.
	* As follow-up, add a harder version where you have dispensers that output e.g. iron ore, and you have to smelt that and use assemblers to make conveyor belts and platform.
