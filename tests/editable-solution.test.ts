import { describe, expect, it } from "vitest";
import { applyEditableSolution } from "../src/game/editable-solution";
import { GridRegion } from "../src/game/grid-region";
import { SignalTraceRecorder } from "../src/game/signal-traces";
import { TileKind } from "../src/simulation/tile";
import { World } from "../src/simulation/world";

describe("fixed puzzle trace ordering", () => {
  it("transfers presentation order through fixed arrays without changing puzzle configuration", () => {
    const fixed = new World(3, 1);
    fixed.place(0, 0, TileKind.Monitor);
    fixed.configureSignalLabel(0, 0, "INPUT", "Signals");
    fixed.place(1, 0, TileKind.RuneArray);
    const inner = fixed.runeArrayWorldAt(1, 0);
    inner.place(0, 0, TileKind.Grapher);
    inner.configureSignalLabel(0, 0, "EXPECTED", "Signals");
    inner.place(1, 0, TileKind.Counter);
    const solution = fixed.clone();
    solution.configureSignalOrder(0, 0, 1);
    const editedInner = solution.runeArrayWorldAt(1, 0);
    editedInner.configureSignalOrder(0, 0, -1);
    editedInner.configureSignalLabel(0, 0, "CHANGED", "Wrong");
    editedInner.place(1, 0, TileKind.Stone);
    solution.place(2, 0, TileKind.Stone);

    applyEditableSolution(fixed, solution, new GridRegion([]));
    const recorder = new SignalTraceRecorder();
    recorder.sync(fixed, 0);
    expect(recorder.lines(fixed).map((line) => line.label)).toEqual([
      `#${fixed.idAt(1, 0)} · EXPECTED`, "INPUT",
    ]);
    expect(inner.kindAt(1, 0)).toBe(TileKind.Counter);
    expect(fixed.kindAt(2, 0)).toBe(TileKind.Empty);
  });
});
