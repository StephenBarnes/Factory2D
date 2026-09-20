
# Tutorial puzzles

**Be wary of adding more tutorial puzzles.** Players don't need a separate tutorial for each component, they can figure it out from the inspector's tooltips and examples. Assume they've played Zachtronics games.

Current tutorial puzzles:
* Click to test: no player-modifiable region; they just click the button to test it. Demonstrates basic puzzle testing flow.
* Stone drop: teaches placing blocks, player-modifiable region, palette, gravity. Place one stone block and let it fall into the delivery box. The right half shows exactly what's needed.
* Sand fall: build a ramp for sand to fall diagonally down. Teaches diagonal gravity and welding. Right side of the grid has an example showing how welded parts work and how sand falls.
* Basic runelore: place conduits and an inverter in 3 steps to carry a signal to the output. Instructions on the grid in text boxes. We also enable placing the charge sensor which allows for a shortcut. Reinforces welding mechanics.
* Gordian knot: The stated task is impossible; solution requires cheating by welding a fixed +1 charge to the judgment stone. Teaches the general concept that a puzzle's win condition is defined on the game board rather than via metadata, that exploits are possible, and also shows a much larger collection of blocks in the palette than have been seen in previous tutorial puzzles.

Things we are not teaching yet:
* Gates delay signals by one tick; branches must be time-equalized with delay gates. Necessary for solving the rectifier puzzle, binary crossed channels, and other puzzles we add later.
* Conveyors, pistons, rotators.
* Magnets.
* Transformation machines: furnaces, grinders, assemblers, duplicators.
* Machines that weld and unweld.
* Charge sensors, the fact that they can sense at a distance, and their interaction with glass.

# Current non-tutorial puzzles

The puzzle set we ship on first release should focus more on mechanical puzzles.

## Transport

* Vehicle: build a self-propelled vehicle in a small left-hand bay and reach the fixed sensors on the right. This introduces conveyor reaction forces without adding another tutorial.
* Climber: build a vehicle that can climb up 1-high steps to reach the goal. This is harder than the Vehicle puzzle; reference solution uses a back wheel (conveyor belt) plus an elevated front wheel which is pushed down with a piston when a sensor detects a step. Could instead just jostle the front wheel up and down. Other solutions are possible, e.g. creating multiple vehicles and using each as a platform for the one above, abandoning each layer at each step.

## Extraction

* Geode Extractor: requires triggering a duplicator to create geodes, some drills to carve away the stone, and conveyors to move the center ruby block to the delivery box. There's 2 separate duplicators in different directions, so players can solve it via different layouts, or use both for faster throughput. Most circuit and mechanical components (welder, splitter, rotator, magnet, grinder) are enabled; the reference solution uses drills and conveyors. More intermediate puzzles could introduce drills before this puzzle.

## Manufacturing

* Iron Run (Easy): smelt the single supplied iron ore block and deliver one unwelded iron block across a rock ridge. A small motion/furnace/circuit palette excludes ore, finished iron, and duplicators. The protected delivery circuit requires a real delivery. This precedes Iron Plates without adding another tutorial. The reference solution holds the ore beside a furnace, starts an elevated conveyor after a ten-tick delay, and finishes in 32 ticks (200-tick limit).
* Iron Plates: duplicate iron ore, smelt to iron, and weld together 3 of them to make an iron plate; deliver 10 iron plates to the delivery box. There are 2 duplicators, so deciding whether to use one or both and in what amount trades cycles against footprint, cost, and complexity. There are definitely also exploits possible, e.g. using the drill to remove a duplicator and duplicate entire plates.

## Mining

Currently empty. Future puzzles could involve drilling a large block of stone to extract gemstones scattered throughout it.

## Runelore

* Comparer: detect increases, decreases, and unchanged values using only conduits, inverters, and combiners. Three cases cover all nine ternary transitions, negative startup, and long steady readings.
* Holding Pattern: stretch each one-tick +1 or -1 pulse into exactly ten ticks of the same sign, then return to zero. Four cases cover both starting signs, back-to-back pulses (including repeated signs), and uneven gaps. Channels, inverters, combiners, delay gates, and delay runes are available. The reference solution uses combiner feedback and a delayed inverted input to end each hold.
* Rectifier: requires building rectifier without the rectifier block - requires combiners and multipliers, or other combinations of components.
* Binary crossed channels: requires crossing two signals (only 0 and +1, no -1) without the dedicated crossing block. Can be done with 3 equality gates, plus some details for delaying specific lines and handling initial spurious `0 = 0` equality.
* Ternary crossed channels: similar but with -1 allowed. This is more difficult. Current reference solution has nested rune arrays.

The fixed ROM signal sources in these five runelore puzzles face right and are mirrored, so rear +1 reads the authored spatial grid left-to-right, then top-to-bottom under component-relative carry rules. Reference scenes use the same handedness.

# Ideas for non-tutorial puzzles

* Puzzle between Vehicle and Climber that introduces pistons.
* Count up to N pulses from two separate sources and decide which source gave more pulses in total. One solution idea: use a counter block, with an inverter on one of the two inputs, and then check whether final value is positive or negative? But wrap-arounds are possible, so maybe use spark blocks to initialize it to N. Also we can't read the value of the counter block directly, would need to decrement it until it reaches zero and compare number of decrements to initial value; but that seems like almost the same problem we started with?
* A set of basic circuit problems, where you only have: conduit, combiner, inverter, and fixed source. Add puzzles to build most of the more advanced circuit components out of these. The combiner is effectively a sum or vote/majority rune. Combiner also gives a 1-tick delay, so you can chain them to make a machine that acts like a delay rune with arbitrary memory size. Combiner with duplicate inputs, one delayed and inverted, gives edge detection. Spark is fixed value plus edge detection. For the rectifier/diode, we have a puzzle and reference solution, which needs two combiners and a multiplier. Rectifier could also be built using two combiners, fixed source, and inverter: use fixed source and inverter to get -1, then compute `Combiner(x, x, -1)` which takes (-1, 0, 1) to (-1, -1, 1), and then combine that with +1.
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
* Carry a 1-trit signal from a top chamber to a bottom chamber, through a 1-wide chute. The top and bottom chambers are player-modifiable but the chute is not. So they probably need to choose one block to drop based on the trit, then interpret that signal at the bottom.
* Simpler manufacturing puzzles before the current iron plates puzzle:
	* Weld together two stone blocks into 1x2 bodies, and deliver that.
* Puzzle where there's 3 circuit inputs; in each test case, one is +1 while the rest are zero. The player must manufacture one specific item dependent on the signal, and get it to a delivery box (which accepts a different item in each test case, matching the circuit input). The 3 possible products are similar, made from mostly the same blocks but with slightly different configurations - maybe pickaxes, hammers, and swords. So the key to keeping footprint small is reusing as much of the production system as possible between the 3 possibilities.
	* Add variants: different sets of products, different degree of overlap, different number of options.
	* Variant with 2-dimensional signals, e.g. "make a {gold, silver, copper} ring with a {ruby, diamond, sapphire, nothing} on top".
* Multidirectional vehicle. Player's vehicle starts in the center; must travel in a direction given by circuit signal (one signal for each test case). Travel left/right on ground, up (by reaching up to a hanging ladder), or down (via digging or fitting through a small hole). To ensure they don't just build 4 separate small vehicles, we let them start with one diamond gemstone in the center, and this must be delivered to the endpoint.
* Puzzle that requires picking up a component and integrating it into a machine. For example, there's 1 duplicator lying on the ground, and the player cannot place duplicators; solution needs to produce N gemstones, by connecting to the duplicator and using it to duplicate a gemstone repeatedly.
* Race track: there's a central floating body with beam block type sensors checking for diamonds in 4 cardinal directions. Around that there's a ring of empty space, then around that a solid border. The player must build a vehicle around a single diamond block. Then the vehicle must activate all 4 sensors, by travelling around the entire ring. Requires building a multi-purpose vehicle that can travel right, upward (similar to Chasm Climber puzzle), left, and then fall down past the last sensor.
	* Could have arbitrary race-track shapes with beam block sensors checking they visit all checkpoints.
	* Could have a relay race variant - partway through the track there's a 1-wide window through which they have to pass the diamond to a separate vehicle which does the rest of the race.
* Converting unary to decimal. The player gets N stone blocks for N at most 99. They must output N mod 10 into one output chute, and N integer-divide 10 into another.
* Reading decimal digits. We give the player a stone polyomino representing a digit 0-9, and they must output that many stone blocks into a chute.
	* Also the reverse - construct decimal digit to represent a number.
* Carving up arbitrary input shapes into individual blocks. The player is given a polyomino fitting inside a 5x5 box. They must chop it up into individual blocks and deliver those. Each test case has a different input shape.
* Polyomino packing: set up sensors to detect various polyominoes inside the player-modifiable region. Victory iff all of them are detected. Entirely ignores 90% of our game mechanics, but might still be fun.
	* Then a follow-up puzzle that gives them too little space to actually fit all the shapes; so they have to build a machine that creates all necessary shapes in sequence, by welding and unwelding, etc. over multiple ticks.
