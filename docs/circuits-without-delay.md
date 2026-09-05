This was thinking about potentially allowing circuit gates without the 1-tick delay that all current circuit gates have.
The mentioned TODO has since been edited.

# Original request

Could you help me think about this todo that I added?

```
* Reconsider our current circuit/delay model. Currently every gate delays by 1 tick, which makes some design problems difficult; our "sequence checker" block exists in part because of this problem. We could allow multiple ticks of circuit network updates for every 1 tick of physical movement; though that would be confusing too if it's any fixed ratio. Maybe we should continue updating the circuit network until convergence, but also detect any region where convergence fails, and set all of those to zero or arbitrary values or a special "invalid" value. (For example, an inverter with output feeding to its own input.) Then add a separate "1-tick delay" gate for creating latches.
```

Basically I feel like currently our game may demand too much player attention be devoted to micro-managing small delays in circuits, because every circuit component causes a 1-tick delay, so every branch of some combined calculation needs to be synchronized by figuring out exactly how many single-input combiners need to be inserted. I'm wondering if we could instead get rid of all of these delays, except when the player deliberately wants to delay a signal. Our current "sequence checker" block exists specifically so that solution checking can be agnostic to how many ticks of delay a player's solution to a puzzle has, i.e. to avoid issues that wouldn't exist if we didn't have these unintentional delays. But how do we get rid of the delays - what would be the best way of doing that, and what would need to be changed?

# Response

**I would remove implicit delays from combinational gates, keep explicit clocked state, and require every feedback loop to pass through a stateful component.** That solves branch synchronization without introducing a convergence model players have to understand.

This is a real tradeoff: circuit depth stops being a timing puzzle, and unclocked feedback latches become illegal. Given your concern, that sounds like the right tradeoff. Players still design algorithms, layouts, memory, and mechanical timing—not padding on every branch.

## 1. Prefer “instant combinational logic” over “simulate until convergence”

For an acyclic circuit, these give the same final answer:

- Repeatedly update until stable.
- Evaluate gates in dependency order.

The second is simpler and bounded. A gate runs once after all its inputs are known. A ten-gate branch and a two-gate branch then describe the same instant in game time.

The player-facing rule becomes:

> Wires and arithmetic runes transmit within the current tick. Memory and delay runes carry signals between ticks.

No electrical-to-mechanical tick ratio, propagation budget, or visible intermediate glitches.

### Feedback is where convergence becomes problematic

There are three distinct cases:

| Feedback circuit | Problem |
|---|---|
| Multiple stable solutions | Which solution should the game choose? |
| No stable solution | There is nothing to converge to. |
| A unique stable solution | Repeated updates still need not find it. |

Your inverter example has an interesting signed-ternary wrinkle: **zero is a stable solution**, since `-0 = 0`. Starting at `+1`, however, repeated updates alternate between `+1` and `-1`.

I checked small examples exhaustively over the ternary values:

- A self-fed single-input combiner has three fixed points.
- A self-fed inverter has one fixed point, but can oscillate during iteration.
- An equality gate comparing its own output with a connected neutral input has **no** fixed point: zero produces `+1`, and either nonzero value produces zero.

Consequently, “fails to converge” is partly a property of the evaluation algorithm and initialization, not just the circuit.

Starting every tick at zero gives some feedback circuits accidental reset behavior. Starting from the previous tick gives them implicit memory—the very timing behavior you wanted to make explicit. An iteration limit adds another hidden rule.

### Recommended feedback policy

**Reject combinational cycles, including ones that happen to have a stable solution.**

Build a directed dependency graph and find its strongly connected components. Any multi-node cycle or self-loop that does not cross a clocked-state boundary is an error.

Show the offending loop and a message such as:

> Feedback requires a delay or memory rune.

I would pause the tick before committing anything, rather than assign zero, arbitrary values, or a fourth charge:

- Zero is a legitimate signal and can cause legitimate actions.
- Arbitrary values make debugging unpleasant, even if deterministic.
- An invalid charge requires rules for every gate, network sum, actuator, checker, renderer, and saved format.

A separate circuit diagnostic keeps signed ternary genuinely ternary. Detect it during editing where possible, and again when movement or welding changes connections. Merely being blocked by an error should not mark a puzzle as won or lost.

## 2. Give ticks an explicit state boundary

I would define one tick as:

1. **Observe the board and stored component state.**  
   Occupancy sensors read the current geometry; delays expose previously stored values; ROMs expose their current entries.
2. **Evaluate all combinational circuitry.**  
   Resolve the complete root/array circuit graph without changing geometry or stored state.
3. **Sample the resolved signals.**  
   Machines collect actions; delays, counters, ROM cursors, and checkers calculate their next state.
4. **Commit once.**  
   Apply state changes and physical actions. Their consequences are available on the next tick.

In equations:

\[
C_t = \operatorname{evaluate}(B_t,S_t), \qquad
S_{t+1} = \operatorname{update}(S_t,C_t)
\]

Here \(B_t\) is the board geometry, \(S_t\) is explicit memory, and \(C_t\) is the settled circuit.

This changes your current “observe only start-of-tick charges” rule, but preserves its important purpose: **nothing observes a partially committed move or state update.** Electrical evaluation computes from one snapshot; it is not a series of miniature simulation ticks.

Examples:

- `sensor → arbitrary arithmetic → piston`: the piston responds to that tick’s observed occupancy.
- `signal → delay(1) → arithmetic`: the arithmetic receives the previous tick’s signal.
- `memory → logic → same memory`: valid feedback; the update becomes visible next tick.

### You already have the delay component

There is no need for a separate one-tick tile unless you want different pricing or presentation. The existing configurable delay supports length 1.

Its contract should become literally:

\[
\operatorname{output}_t = \operatorname{input}_{t-N}
\]

with neutral initial contents. A one-tick delay then serves as a ternary register. A selector feeding a register can choose between loading a new value and retaining the old one.

## 3. Stateful components need deliberate timing decisions

Do not repeatedly run the existing resolver. In `src/simulation/circuit-resolver.ts`, `driveGates()` currently mixes arithmetic with calls that **advance delay buffers, counters, checker cursors, and ROM cursors**. Repeating that pass would advance game state multiple times per physical tick.

I would use this division:

| Component | Proposed timing |
|---|---|
| Inverter, combiner, rectifier, multiplier, subtractor, selector, equality, min/max | Instant combinational function |
| Occupancy sensor | Source derived from current board geometry |
| Charge sensor | Instant dependency on the port it observes, even without a weld |
| Delay | Stored output now; capture current input for a future tick |
| ROM | Current cursor’s value now; input changes cursor for next tick |
| Counter | Sample once; wrap pulse becomes an output next tick |
| Sequence checker | Compare once; updated verdict is available next tick |
| Machine success/completion pulses | Report the previous tick’s committed event |

The last row is important. **An action should not report success through combinational logic that controls that same action.** Otherwise you get algebraic feedback involving machinery, not just gates.

For instance, your welder currently reports whether its collected operation succeeded during the circuit phase. Under the new model, I would register that pulse for the following tick. Furnace activity outputs also need an explicit decision: are they an instantaneous “can bake” predicate, or a report that baking occurred? Those are different contracts.

These are deliberate state/event boundaries, not a delay paid for every arithmetic operation.

## 4. What changes in this codebase

Having read the resolver and runtime phase ordering, this is **more than changing gate reads**, but much of the existing infrastructure remains useful.

### Circuit evaluation

In `src/simulation/circuit-resolver.ts`:

- Keep the cached union-find topology for shared wires, crossings, and rune-array ports.
- Add dependencies between resolved networks and combinational outputs.
- Represent direct gate-to-gate connections too; the existing shared-network nodes do not represent every isolated gate port.
- Include unwelded charge-sensor observations in the dependency graph.
- Detect cycles and cache a topological evaluation order alongside topology.
- Separate pure evaluation from sequential-state updates.

A network with multiple drivers must wait for **all** driver values before applying the existing `sign(sum)` rule. Evaluating after the first driver would create order-dependent results.

Nested arrays must remain part of the same graph. They cannot hide a feedback cycle or introduce an artificial delay at their boundary.

### Tick orchestration and component state

In `src/simulation/simulation.ts`, `world-runtime.ts`, and the relevant resolvers:

- Move circuit-controlled intent collection after combinational evaluation.
- Preserve snapshot-based geometry observation and existing conflict resolution.
- Stage sequential updates rather than mutating state while evaluating.
- Register event outputs where necessary.

Currently duplicator and welder intents are collected before circuit resolution, while motion phases run afterward. Leaving that split untouched would preserve inconsistent control latency.

In `src/simulation/world.ts` and configurable state handling:

- Separate reading current outputs from calculating/committing next state.
- Ensure any newly stored pulses survive cloning, reset, movement, duplication, and serialization.

### Player-facing contracts and content

- Highlight illegal feedback, including loops crossing array boundaries.
- Keep signal traces to one settled sample per game tick—never internal evaluator steps.
- Specify which tick that sample represents relative to committed movement and new state.
- Update component descriptions and simulation documentation.
- Revisit shipped ROM sequences, cycle limits, reference solutions, and timing-dependent tests.
- Treat old confirmed scores as belonging to the old simulation rules, rather than silently preserving their validity.

Verification should specifically exercise unequal-depth branches, exact `delay(N)` timing, once-per-tick state advancement, multi-driver cancellation, charge-sensor dependencies, nested feedback, and cycles created by moving or welding components.

## 5. Keep the sequence checker

Its latency tolerance becomes less necessary for **pure combinational** puzzles, but it is still a useful specification device:

- It describes an expected temporal sequence compactly.
- It checks machines with explicit memory or mechanical startup.
- It separates “produce the correct sequence” from “start on exactly cycle 7.”

For a combinational puzzle, inputs and outputs could instead be compared on the same tick. For a sequential puzzle, retain latency-tolerant checking when startup timing is not part of the challenge. Those are different puzzle objectives, not competing universal rules.

**My recommendation:** adopt instantaneous acyclic logic, explicit clocked memory, and clear feedback diagnostics. Do not make fixed-point convergence part of the game unless constructing unclocked feedback circuits is itself a mechanic you want players to master. That would replace delay bookkeeping with a subtler—and probably harder to explain—kind of bookkeeping.