import { describe, expect, it } from "vitest";

import { DEFAULT_SPEED_INDEX, EXTRA_COUNT } from "./constants";
import { createPart } from "./machine";
import {
  OrreryState,
  emptyEditor,
  emptySim,
  lastOf,
  machinesOf,
  markSolved,
  modeLength,
  recordsOf,
  resetState,
  setLastOf,
  solvedOf,
  stashMachine,
  stashedMachine,
} from "./state";

describe("the state at rest (specs/state.md)", () => {
  it("builds every field in one go, at its title-screen value", () => {
    const state = new OrreryState();
    expect(state.screen).toBe("title");
    expect(state.mode).toBe("campaign");
    expect(state.unlockedCount).toBe(1);
    expect(state.challenge).toBeNull();
    expect(state.challengeRef).toBeNull();
    expect(state.sim).toBeNull();
    expect(state.completion).toBe(true);
    expect(state.simTime).toBe(0);
    expect(state.muted).toBe(false);
    expect(state.editor).toEqual(emptyEditor());
  });

  it("sizes each mode's per-challenge arrays to its course length", () => {
    const state = new OrreryState();
    expect(state.extrasRecords).toHaveLength(EXTRA_COUNT);
    expect(state.extrasMachines).toHaveLength(EXTRA_COUNT);
    expect(state.campaignRecords).toHaveLength(modeLength("campaign"));
    expect(state.extrasRecords.every((entry) => entry === null)).toBe(true);
  });

  it("starts a run at the default speed with nothing on the field", () => {
    const sim = emptySim(3);
    expect(sim.speed).toBe(DEFAULT_SPEED_INDEX);
    expect(sim.tallies).toEqual([0, 0, 0]);
    expect(sim.status).toBe("running");
    expect(sim.pending).toBeNull();
  });
});

describe("progress (specs/modes/campaign.md)", () => {
  it("keeps a solved set ascending and free of duplicates", () => {
    const state = new OrreryState();
    markSolved(state, "extras", 4);
    markSolved(state, "extras", 1);
    markSolved(state, "extras", 4);
    expect(solvedOf(state, "extras")).toEqual([1, 4]);
  });

  it("addresses each mode's own arrays", () => {
    const state = new OrreryState();
    setLastOf(state, "extras", 6);
    expect(lastOf(state, "extras")).toBe(6);
    expect(lastOf(state, "campaign")).toBe(0);
    expect(recordsOf(state, "extras")).toBe(state.extrasRecords);
    expect(machinesOf(state, "campaign")).toBe(state.campaignMachines);
  });

  it("stashes a machine by value, so later edits do not reach it", () => {
    const state = new OrreryState();
    const machine = [createPart(1, "arm", 0, 0, 0, { tape: ["grab"] })];
    stashMachine(state, "extras", 2, machine);
    machine[0].tape?.push("drop");
    expect(stashedMachine(state, "extras", 2)[0].tape).toEqual(["grab"]);
    expect(stashedMachine(state, "extras", 3)).toEqual([]);
  });

  it("ignores a stash for an index the mode does not hold", () => {
    const state = new OrreryState();
    stashMachine(state, "extras", 99, []);
    expect(state.extrasMachines).toHaveLength(EXTRA_COUNT);
  });
});

describe("a reset (specs/instrumentation.md)", () => {
  it("restores every declared field, and leaves muting and the clock", () => {
    const state = new OrreryState();
    state.screen = "editor";
    state.mode = "extras";
    state.menuIndex = 2;
    state.selectIndex = 5;
    state.howtoPage = 3;
    state.unlockedCount = 4;
    state.simTime = 12;
    state.completion = false;
    state.muted = true;
    markSolved(state, "extras", 1);
    stashMachine(state, "extras", 1, [createPart(1, "arm", 0, 0, 0)]);
    resetState(state);
    expect(state.screen).toBe("title");
    expect(state.mode).toBe("campaign");
    expect(state.menuIndex).toBe(0);
    expect(state.selectIndex).toBe(0);
    expect(state.howtoPage).toBe(0);
    expect(state.unlockedCount).toBe(1);
    expect(state.simTime).toBe(0);
    expect(state.completion).toBe(true);
    expect(state.extrasSolved).toEqual([]);
    expect(state.extrasMachines.every((entry) => entry === null)).toBe(true);
    expect(state.muted).toBe(true);
  });
});
