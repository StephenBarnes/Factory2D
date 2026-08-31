import { describe, expect, it } from "vitest";

import { WorkshopEditingState } from "../src/game/workshop-editing-state";

describe("workshop editing state", () => {
  it("locks puzzle editing after simulation starts until reset", () => {
    const state = new WorkshopEditingState(true);

    expect(state.editable).toBe(true);
    state.beginSimulation();
    expect(state.editable).toBe(false);
    state.resetSimulation();
    expect(state.editable).toBe(true);
  });

  it("keeps sandbox editing available after simulation starts", () => {
    const state = new WorkshopEditingState(false);

    state.beginSimulation();

    expect(state.editable).toBe(true);
  });
});
