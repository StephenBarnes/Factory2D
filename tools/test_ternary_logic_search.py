from __future__ import annotations

import unittest

from tools.ternary_logic_search import (
    Component,
    EXAMPLES,
    make_problem,
    search,
)


class TernaryLogicSearchTests(unittest.TestCase):
    def test_rectifier_is_one_gate_when_available(self) -> None:
        result = search(
            EXAMPLES["rectifier"],
            frozenset({Component.RECTIFIER}),
            1,
            analyze_all_functions=False,
            max_coverage_functions=0,
        )

        self.assertTrue(result.candidates)
        self.assertEqual(min(candidate.components for candidate in result.candidates), 1)
        self.assertEqual(min(candidate.delay for candidate in result.candidates), 1)
        self.assertIn("g1 = rectifier(x)", result.candidates[0].lines)

    def test_basic_gates_build_rectifier_in_two_components(self) -> None:
        result = search(
            EXAMPLES["rectifier"],
            frozenset({Component.COMBINER, Component.MULTIPLIER}),
            2,
            analyze_all_functions=False,
            max_coverage_functions=0,
        )

        minimum = min(
            result.candidates,
            key=lambda candidate: (candidate.components, candidate.delay),
        )
        self.assertEqual(minimum.components, 2)
        self.assertEqual(minimum.delay, 2)
        self.assertEqual(
            minimum.lines,
            (
                "g1 = multiplier(x, x)",
                "g2 = combiner(x, g1)",
                "out = g2",
            ),
        )

    def test_multiplier_with_no_inputs_is_positive_constant(self) -> None:
        positive_constant = make_problem(
            "Positive constant",
            ("x",),
            ("out",),
            (
                ((-1,), (1,)),
                ((0,), (1,)),
                ((1,), (1,)),
            ),
        )
        result = search(
            positive_constant,
            frozenset({Component.MULTIPLIER}),
            1,
            analyze_all_functions=False,
            max_coverage_functions=0,
        )

        self.assertEqual(result.candidates[0].components, 1)
        self.assertEqual(result.candidates[0].lines[0], "g1 = multiplier()")

    def test_multiple_outputs_share_a_generated_signal(self) -> None:
        duplicate_rectifier = make_problem(
            "Duplicate rectifier outputs",
            ("x",),
            ("left", "right"),
            (
                ((-1,), (0, 0)),
                ((0,), (0, 0)),
                ((1,), (1, 1)),
            ),
        )
        result = search(
            duplicate_rectifier,
            frozenset({Component.RECTIFIER}),
            1,
            analyze_all_functions=False,
            max_coverage_functions=0,
        )

        minimum = min(result.candidates, key=lambda candidate: candidate.components)
        self.assertEqual(minimum.components, 1)
        self.assertEqual(minimum.lines[-2:], ("left = g1", "right = g1"))

    def test_coverage_counts_zero_component_unary_signals(self) -> None:
        result = search(
            EXAMPLES["rectifier"],
            frozenset(),
            0,
            analyze_all_functions=True,
            max_coverage_functions=100,
        )

        self.assertIsNotNone(result.coverage)
        self.assertEqual(len(result.coverage or {}), 2)
        self.assertEqual(result.total_function_count, 27)

    def test_truth_table_rejects_missing_rows(self) -> None:
        with self.assertRaisesRegex(ValueError, "every input exactly once"):
            make_problem(
                "Incomplete",
                ("x",),
                ("out",),
                (((-1,), (0,)), ((0,), (0,))),
            )


if __name__ == "__main__":
    unittest.main()
