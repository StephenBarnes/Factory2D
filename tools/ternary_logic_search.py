#!/usr/bin/env python3
"""Exhaustive small-circuit search for Factory 2D signed-ternary runes.

Edit the CONFIGURATION section near the bottom, then run:

    python3 tools/ternary_logic_search.py

The search models a circuit as a straight-line program (a DAG): primary inputs
and every earlier rune output may feed any later input, signals may fan out, and
there are no layout, conduit, crossing, or planarity costs. Every logic rune
adds one tick of delay; fixed charge is available without a logic-tick delay.
Disconnected inputs are neutral, including the multiplier's special empty-input
product of +1.

Circuits with the same set of available truth tables and the same per-signal
delays are equivalent for all future wiring. The search retains one canonical
witness for each such state. This keeps realizability, minimum component count,
and minimum delay exhaustive within MAX_COMPONENTS while collapsing mere
rewirings and equivalent subcircuits. Printed candidates are the distinct
canonical witnesses found, not every physically equivalent drawing.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache
from itertools import combinations_with_replacement, product
from typing import Iterable, Iterator, Sequence

Charge = int
TruthCode = int
TRITS: tuple[Charge, ...] = (-1, 0, 1)


class Component(str, Enum):
    FIXED_CHARGE = "fixed charge"
    INVERTER = "inverter"
    COMBINER = "combiner"
    RECTIFIER = "rectifier"
    MULTIPLIER = "multiplier"
    SUBTRACTOR = "subtractor"
    SELECTOR = "selector"


COMPONENT_ORDER: tuple[Component, ...] = tuple(Component)
SYMMETRIC_COMPONENTS = frozenset(
    {
        Component.INVERTER,
        Component.COMBINER,
        Component.RECTIFIER,
        Component.MULTIPLIER,
    }
)


@dataclass(frozen=True)
class Problem:
    name: str
    input_names: tuple[str, ...]
    output_names: tuple[str, ...]
    rows: tuple[tuple[tuple[Charge, ...], tuple[Charge, ...]], ...]


@dataclass(frozen=True)
class Ref:
    kind: str
    index: int


@dataclass(frozen=True)
class Signal:
    code: TruthCode
    delay: int
    ref: Ref


@dataclass(frozen=True)
class Node:
    component: Component
    inputs: tuple[Ref | None, ...]
    delay: int


@dataclass(frozen=True)
class CircuitState:
    signals: tuple[Signal, ...]
    nodes: tuple[Node, ...]


@dataclass(frozen=True)
class Candidate:
    components: int
    delay: int
    component_counts: tuple[tuple[Component, int], ...]
    lines: tuple[str, ...]
    key: tuple[object, ...]


@dataclass
class CoverageMetric:
    minimum_components: int
    minimum_delay: int


@dataclass
class SearchResult:
    candidates: list[Candidate]
    states_per_component_count: list[int]
    coverage: dict[tuple[TruthCode, ...], CoverageMetric] | None
    total_function_count: int


def make_problem(
    name: str,
    input_names: Sequence[str],
    output_names: Sequence[str],
    rows: Sequence[tuple[Sequence[Charge], Sequence[Charge]]],
) -> Problem:
    """Build and strictly validate a directly specified truth-table problem."""

    inputs = tuple(input_names)
    outputs = tuple(output_names)
    expected_inputs = tuple(product(TRITS, repeat=len(inputs)))
    supplied: dict[tuple[Charge, ...], tuple[Charge, ...]] = {}

    if not outputs:
        raise ValueError("A problem must have at least one output")
    if len(set(inputs)) != len(inputs) or len(set(outputs)) != len(outputs):
        raise ValueError("Input and output names must be unique")

    for raw_inputs, raw_outputs in rows:
        input_values = tuple(raw_inputs)
        output_values = tuple(raw_outputs)
        if input_values in supplied:
            raise ValueError(f"Duplicate truth-table row for {input_values}")
        if len(input_values) != len(inputs):
            raise ValueError(f"Wrong input width in row {input_values}")
        if len(output_values) != len(outputs):
            raise ValueError(f"Wrong output width in row {input_values}")
        if any(value not in TRITS for value in input_values + output_values):
            raise ValueError(f"Non-ternary value in row {input_values}")
        supplied[input_values] = output_values

    missing = [values for values in expected_inputs if values not in supplied]
    extras = [values for values in supplied if values not in expected_inputs]
    if missing or extras:
        raise ValueError(
            f"Truth table must contain every input exactly once; missing={missing}, extras={extras}"
        )

    ordered_rows = tuple((values, supplied[values]) for values in expected_inputs)
    return Problem(name, inputs, outputs, ordered_rows)


def encode_table(values: Iterable[Charge]) -> TruthCode:
    code = 0
    multiplier = 1
    for value in values:
        code += (value + 1) * multiplier
        multiplier *= 3
    return code


@lru_cache(maxsize=None)
def decode_table(code: TruthCode, row_count: int) -> tuple[Charge, ...]:
    values: list[Charge] = []
    remaining = code
    for _ in range(row_count):
        values.append(remaining % 3 - 1)
        remaining //= 3
    if remaining:
        raise ValueError(f"Truth-table code {code} exceeds {row_count} rows")
    return tuple(values)


def sign(value: int) -> Charge:
    return 1 if value > 0 else -1 if value < 0 else 0


@lru_cache(maxsize=None)
def evaluate_component(
    component: Component,
    input_codes: tuple[TruthCode | None, ...],
    row_count: int,
) -> TruthCode:
    decoded = tuple(
        None if code is None else decode_table(code, row_count) for code in input_codes
    )
    output: list[Charge] = []

    for row in range(row_count):
        values = tuple(0 if table is None else table[row] for table in decoded)
        if component is Component.INVERTER:
            value = sign(-sum(values))
        elif component is Component.COMBINER:
            value = sign(sum(values))
        elif component is Component.RECTIFIER:
            value = 1 if sum(values) > 0 else 0
        elif component is Component.MULTIPLIER:
            connected_values = tuple(
                table[row] for table in decoded if table is not None
            )
            value = sign(product_of(connected_values))
        elif component is Component.SUBTRACTOR:
            rear, left, right = values
            value = sign(rear - left - right)
        elif component is Component.SELECTOR:
            rear, left, right = values
            value = left if rear == 1 else right if rear == -1 else 0
        else:
            raise ValueError(f"{component.value} is not a logic gate")
        output.append(value)

    return encode_table(output)


def product_of(values: Iterable[Charge]) -> int:
    result = 1
    for value in values:
        result *= value
    return result


def target_codes(problem: Problem) -> tuple[TruthCode, ...]:
    return tuple(
        encode_table(outputs[index] for _, outputs in problem.rows)
        for index in range(len(problem.output_names))
    )


def initial_state(problem: Problem) -> CircuitState:
    row_count = len(problem.rows)
    zero_code = encode_table(0 for _ in range(row_count))
    signals: dict[TruthCode, Signal] = {
        zero_code: Signal(zero_code, 0, Ref("zero", 0))
    }
    for input_index in range(len(problem.input_names)):
        code = encode_table(values[input_index] for values, _ in problem.rows)
        signals.setdefault(code, Signal(code, 0, Ref("input", input_index)))
    return CircuitState(tuple(sorted(signals.values(), key=lambda signal: signal.code)), ())


def state_key(state: CircuitState) -> tuple[tuple[TruthCode, int], ...]:
    return tuple((signal.code, signal.delay) for signal in state.signals)


def gate_applications(
    component: Component,
    signals: tuple[Signal, ...],
    row_count: int,
) -> Iterator[tuple[tuple[Signal | None, ...], TruthCode, int]]:
    if component is Component.FIXED_CHARGE:
        one_code = encode_table(1 for _ in range(row_count))
        yield (), one_code, 0
        return

    zero_code = encode_table(0 for _ in range(row_count))
    nonzero_signals = tuple(signal for signal in signals if signal.code != zero_code)

    if component in SYMMETRIC_COMPONENTS:
        minimum_arity = 0 if component is Component.MULTIPLIER else 1
        for arity in range(minimum_arity, 4):
            for selected in combinations_with_replacement(nonzero_signals, arity):
                codes = tuple(signal.code for signal in selected)
                output_code = evaluate_component(component, codes, row_count)
                delay = 1 + max((signal.delay for signal in selected), default=0)
                yield selected, output_code, delay
        return

    choices: tuple[Signal | None, ...] = (None, *nonzero_signals)
    for selected in product(choices, repeat=3):
        if all(signal is None for signal in selected):
            continue
        codes = tuple(None if signal is None else signal.code for signal in selected)
        output_code = evaluate_component(component, codes, row_count)
        delay = 1 + max(
            (signal.delay for signal in selected if signal is not None), default=0
        )
        yield selected, output_code, delay


def append_node(
    state: CircuitState,
    component: Component,
    selected: tuple[Signal | None, ...],
    output_code: TruthCode,
    delay: int,
    *,
    force_output_ref: bool = False,
) -> CircuitState | None:
    node = Node(
        component,
        tuple(None if signal is None else signal.ref for signal in selected),
        delay,
    )
    node_ref = Ref("node", len(state.nodes))
    signal_map = {signal.code: signal for signal in state.signals}
    previous = signal_map.get(output_code)
    if not force_output_ref and previous is not None and previous.delay <= delay:
        return None
    signal_map[output_code] = Signal(output_code, delay, node_ref)
    return CircuitState(
        tuple(sorted(signal_map.values(), key=lambda signal: signal.code)),
        (*state.nodes, node),
    )


def output_signals(
    state: CircuitState, required_codes: tuple[TruthCode, ...]
) -> tuple[Signal, ...] | None:
    by_code = {signal.code: signal for signal in state.signals}
    if any(code not in by_code for code in required_codes):
        return None
    return tuple(by_code[code] for code in required_codes)


def make_candidate(
    state: CircuitState,
    outputs: tuple[Signal, ...],
    problem: Problem,
) -> Candidate:
    live_nodes: set[int] = set()

    def visit(ref: Ref) -> None:
        if ref.kind != "node" or ref.index in live_nodes:
            return
        live_nodes.add(ref.index)
        for input_ref in state.nodes[ref.index].inputs:
            if input_ref is not None:
                visit(input_ref)

    for signal in outputs:
        visit(signal.ref)

    ordered_nodes = sorted(live_nodes)
    display_number = {node_index: index + 1 for index, node_index in enumerate(ordered_nodes)}

    def format_ref(ref: Ref | None) -> str:
        if ref is None:
            return "-"
        if ref.kind == "zero":
            return "0"
        if ref.kind == "input":
            return problem.input_names[ref.index]
        return f"g{display_number[ref.index]}"

    lines: list[str] = []
    canonical_nodes: list[object] = []
    counts: Counter[Component] = Counter()
    for node_index in ordered_nodes:
        node = state.nodes[node_index]
        counts[node.component] += 1
        references = tuple(format_ref(ref) for ref in node.inputs)
        if node.component is Component.FIXED_CHARGE:
            call = "fixed_charge()"
        elif node.component is Component.SUBTRACTOR:
            rear, left, right = references
            call = f"subtractor(rear={rear}, left={left}, right={right})"
        elif node.component is Component.SELECTOR:
            rear, left, right = references
            call = f"selector(rear={rear}, left={left}, right={right})"
        else:
            call = f"{node.component.value.replace(' ', '_')}({', '.join(references)})"
        lines.append(f"g{display_number[node_index]} = {call}")
        canonical_nodes.append((node.component.value, references))

    output_references = tuple(format_ref(signal.ref) for signal in outputs)
    for name, reference in zip(problem.output_names, output_references, strict=True):
        lines.append(f"{name} = {reference}")

    return Candidate(
        components=len(ordered_nodes),
        delay=max((signal.delay for signal in outputs), default=0),
        component_counts=tuple(
            (component, counts[component])
            for component in COMPONENT_ORDER
            if counts[component]
        ),
        lines=tuple(lines),
        key=(*canonical_nodes, ("outputs", output_references)),
    )


def update_coverage(
    coverage: dict[tuple[TruthCode, ...], CoverageMetric],
    state: CircuitState,
    output_count: int,
    component_count: int,
) -> None:
    for selected in product(state.signals, repeat=output_count):
        function = tuple(signal.code for signal in selected)
        delay = max(signal.delay for signal in selected)
        metric = coverage.get(function)
        if metric is None:
            coverage[function] = CoverageMetric(component_count, delay)
        else:
            metric.minimum_components = min(metric.minimum_components, component_count)
            metric.minimum_delay = min(metric.minimum_delay, delay)


def search(
    problem: Problem,
    allowed_components: frozenset[Component],
    max_components: int,
    *,
    analyze_all_functions: bool,
    max_coverage_functions: int,
) -> SearchResult:
    """Enumerate canonical circuit states through the given component bound."""

    if max_components < 0:
        raise ValueError("max_components must be nonnegative")
    row_count = len(problem.rows)
    required_codes = target_codes(problem)
    total_function_count = 3 ** (row_count * len(problem.output_names))
    coverage_enabled = analyze_all_functions and total_function_count <= max_coverage_functions
    coverage: dict[tuple[TruthCode, ...], CoverageMetric] | None = (
        {} if coverage_enabled else None
    )

    first_state = initial_state(problem)
    current_states = {state_key(first_state): first_state}
    seen_keys = set(current_states)
    states_per_component_count = [1]
    candidates: dict[tuple[object, ...], Candidate] = {}

    initial_outputs = output_signals(first_state, required_codes)
    if initial_outputs is not None:
        candidate = make_candidate(first_state, initial_outputs, problem)
        candidates[candidate.key] = candidate
    if coverage is not None:
        update_coverage(coverage, first_state, len(problem.output_names), 0)

    ordered_components = tuple(
        component for component in COMPONENT_ORDER if component in allowed_components
    )
    for component_count in range(1, max_components + 1):
        next_states: dict[tuple[tuple[TruthCode, int], ...], CircuitState] = {}
        for state in current_states.values():
            for component in ordered_components:
                for selected, output_code, delay in gate_applications(
                    component, state.signals, row_count
                ):
                    if output_code in required_codes:
                        candidate_state = append_node(
                            state,
                            component,
                            selected,
                            output_code,
                            delay,
                            force_output_ref=True,
                        )
                        assert candidate_state is not None
                        candidate_outputs = output_signals(candidate_state, required_codes)
                        if candidate_outputs is not None:
                            candidate = make_candidate(
                                candidate_state, candidate_outputs, problem
                            )
                            candidates.setdefault(candidate.key, candidate)

                    next_state = append_node(
                        state, component, selected, output_code, delay
                    )
                    if next_state is None:
                        continue
                    key = state_key(next_state)
                    if key in seen_keys or key in next_states:
                        continue
                    next_states[key] = next_state

        current_states = next_states
        seen_keys.update(next_states)
        states_per_component_count.append(len(next_states))
        if coverage is not None:
            for state in next_states.values():
                update_coverage(
                    coverage, state, len(problem.output_names), component_count
                )
        if not current_states:
            states_per_component_count.extend(
                0 for _ in range(component_count + 1, max_components + 1)
            )
            break

    ordered_candidates = sorted(
        candidates.values(),
        key=lambda candidate: (candidate.components, candidate.delay, candidate.lines),
    )
    return SearchResult(
        ordered_candidates,
        states_per_component_count,
        coverage,
        total_function_count,
    )


def format_truth_table(problem: Problem, output_codes: tuple[TruthCode, ...]) -> str:
    decoded = tuple(decode_table(code, len(problem.rows)) for code in output_codes)
    lines = []
    for row_index, (inputs, _) in enumerate(problem.rows):
        outputs = tuple(table[row_index] for table in decoded)
        lines.append(f"{inputs} -> {outputs}")
    return "; ".join(lines)


def pareto_candidates(candidates: Sequence[Candidate]) -> list[Candidate]:
    """Keep circuits not beaten on both component count and delay."""

    return [
        candidate
        for candidate in candidates
        if not any(
            other.components <= candidate.components
            and other.delay <= candidate.delay
            and (
                other.components < candidate.components
                or other.delay < candidate.delay
            )
            for other in candidates
        )
    ]


def print_result(
    problem: Problem,
    set_name: str,
    allowed_components: frozenset[Component],
    result: SearchResult,
    max_components: int,
    max_printed_candidates: int | None,
    print_only_pareto_candidates: bool,
    analyze_all_functions: bool,
    max_coverage_functions: int,
) -> None:
    component_names = ", ".join(component.value for component in COMPONENT_ORDER if component in allowed_components)
    print(f"\n=== {set_name} ===")
    print(f"Components: {component_names or '(none)'}")
    print(
        "Canonical states by component count: "
        + ", ".join(
            f"{count}:{states}" for count, states in enumerate(result.states_per_component_count)
        )
    )

    if result.candidates:
        minimum_components = min(candidate.components for candidate in result.candidates)
        minimum_delay = min(candidate.delay for candidate in result.candidates)
        print(
            f"Target realizable with <= {max_components} components: yes; "
            f"minimum components={minimum_components}; minimum delay={minimum_delay} tick(s)"
        )
        printable = (
            pareto_candidates(result.candidates)
            if print_only_pareto_candidates
            else result.candidates
        )
        shown = printable
        if max_printed_candidates is not None:
            shown = shown[:max_printed_candidates]
        for index, candidate in enumerate(shown, start=1):
            inventory = ", ".join(
                f"{component.value} x{count}"
                for component, count in candidate.component_counts
            ) or "no components"
            print(
                f"\nCandidate {index}: {candidate.components} component(s), "
                f"delay {candidate.delay}, {inventory}"
            )
            for line in candidate.lines:
                print(f"  {line}")
        hidden = len(printable) - len(shown)
        if hidden:
            print(f"\n... {hidden} additional printable candidate(s) not shown")
        if print_only_pareto_candidates:
            dominated = len(result.candidates) - len(printable)
            print(
                f"\nCollapsed {dominated} dominated canonical candidate(s); "
                "set PRINT_ONLY_PARETO_CANDIDATES=False to include them"
            )
    else:
        print(f"Target realizable with <= {max_components} components: no")

    if not analyze_all_functions:
        return
    if result.coverage is None:
        print(
            f"Function coverage skipped: {result.total_function_count:,} possible mappings "
            f"exceed MAX_COVERAGE_FUNCTIONS={max_coverage_functions:,}"
        )
        return

    realized = len(result.coverage)
    print(
        f"Function coverage: {realized:,}/{result.total_function_count:,} mappings "
        f"({100 * realized / result.total_function_count:.2f}%)"
    )
    if realized == result.total_function_count:
        worst_components = max(
            metric.minimum_components for metric in result.coverage.values()
        )
        worst_delay = max(metric.minimum_delay for metric in result.coverage.values())
        print(
            f"All functions are realizable; worst minimum component count={worst_components}; "
            f"worst minimum delay={worst_delay} tick(s)"
        )
        return

    all_codes = range(3 ** len(problem.rows))
    missing: list[tuple[TruthCode, ...]] = []
    for function in product(all_codes, repeat=len(problem.output_names)):
        if function not in result.coverage:
            missing.append(function)
            if len(missing) == 3:
                break
    for index, function in enumerate(missing, start=1):
        print(f"Missing example {index}: {format_truth_table(problem, function)}")


# ---------------------------------------------------------------------------
# CONFIGURATION: edit this section when investigating a puzzle.
# Rows are ordered automatically; spell out every signed-ternary input row.
# ---------------------------------------------------------------------------

EXAMPLES = {
    "rectifier": make_problem(
        "Rectifier",
        ("x",),
        ("out",),
        (
            ((-1,), (0,)),
            ((0,), (0,)),
            ((1,), (1,)),
        ),
    ),
    "both_positive": make_problem(
        "Both inputs are +1",
        ("x", "y"),
        ("out",),
        (
            ((-1, -1), (0,)), ((-1, 0), (0,)), ((-1, 1), (0,)),
            ((0, -1), (0,)), ((0, 0), (0,)), ((0, 1), (0,)),
            ((1, -1), (0,)), ((1, 0), (0,)), ((1, 1), (1,)),
        ),
    ),
    "maximum": make_problem(
        "Maximum of two inputs",
        ("x", "y"),
        ("out",),
        (
            ((-1, -1), (-1,)), ((-1, 0), (0,)), ((-1, 1), (1,)),
            ((0, -1), (0,)), ((0, 0), (0,)), ((0, 1), (1,)),
            ((1, -1), (1,)), ((1, 0), (1,)), ((1, 1), (1,)),
        ),
    ),
    "minimum": make_problem(
        "Minimum of two inputs",
        ("x", "y"),
        ("out",),
        (
            ((-1, -1), (-1,)), ((-1, 0), (-1,)), ((-1, 1), (-1,)),
            ((0, -1), (-1,)), ((0, 0), (0,)), ((0, 1), (0,)),
            ((1, -1), (-1,)), ((1, 0), (0,)), ((1, 1), (1,)),
        ),
    ),
    "equal": make_problem(
        "Inputs are equal",
        ("x", "y"),
        ("out",),
        (
            ((-1, -1), (1,)), ((-1, 0), (0,)), ((-1, 1), (0,)),
            ((0, -1), (0,)), ((0, 0), (1,)), ((0, 1), (0,)),
            ((1, -1), (0,)), ((1, 0), (0,)), ((1, 1), (1,)),
        ),
    ),
    "either_positive": make_problem(
        "Either input is +1",
        ("x", "y"),
        ("out",),
        (
            ((-1, -1), (0,)), ((-1, 0), (0,)), ((-1, 1), (1,)),
            ((0, -1), (0,)), ((0, 0), (0,)), ((0, 1), (1,)),
            ((1, -1), (1,)), ((1, 0), (1,)), ((1, 1), (1,)),
        ),
    ),
    "is_zero": make_problem(
        "Input is 0",
        ("x"),
        ("out",),
        (
            ((-1,), (0,)),
            ((0,), (1,)),
            ((1,), (0,)),
        ),
    ),
}

PROBLEM = EXAMPLES["minimum"]
MAX_COMPONENTS = 3
COMPONENT_SETS = {
    "All current combinational runes": frozenset(Component),
    "Basic puzzle set": frozenset(
        {
            Component.FIXED_CHARGE,
            Component.INVERTER,
            Component.COMBINER,
            Component.MULTIPLIER,
        }
    ),
}
ANALYZE_ALL_FUNCTIONS = False
MAX_COVERAGE_FUNCTIONS = 1_000_000
PRINT_ONLY_PARETO_CANDIDATES = True
MAX_PRINTED_CANDIDATES: int | None = 50


def main() -> None:
    print(f"Problem: {PROBLEM.name}")
    print(
        f"Inputs={PROBLEM.input_names}; outputs={PROBLEM.output_names}; "
        f"component bound={MAX_COMPONENTS}"
    )
    for set_name, allowed_components in COMPONENT_SETS.items():
        result = search(
            PROBLEM,
            allowed_components,
            MAX_COMPONENTS,
            analyze_all_functions=ANALYZE_ALL_FUNCTIONS,
            max_coverage_functions=MAX_COVERAGE_FUNCTIONS,
        )
        print_result(
            PROBLEM,
            set_name,
            allowed_components,
            result,
            MAX_COMPONENTS,
            MAX_PRINTED_CANDIDATES,
            PRINT_ONLY_PARETO_CANDIDATES,
            ANALYZE_ALL_FUNCTIONS,
            MAX_COVERAGE_FUNCTIONS,
        )


if __name__ == "__main__":
    main()
