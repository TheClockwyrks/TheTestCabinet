// The working copy a frame builds the next state in: that thawing and freezing
// round-trip, and that the segments a state carries are exactly the ones the arc
// positions imply.

import { describe, expect, it } from "vitest";
import { RECOIL_HOLD, SPACING } from "./constants";
import {
  clamp,
  freeze,
  resegment,
  segmentsOf,
  spaced,
  thaw,
  type Draft,
  type DraftCore,
} from "./draft";
import { createDraft } from "./level";

function coresAt(positions: readonly number[], hold = 0): DraftCore[] {
  return positions.map((s) => ({ charge: "halide", s, mark: null, hold }));
}

describe("clamp", () => {
  it("holds a value inside its range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("spaced", () => {
  it("reads two cores exactly one spacing apart as one segment", () => {
    expect(spaced({ s: 100 }, { s: 100 - SPACING })).toBe(true);
    expect(spaced({ s: 100 }, { s: 100 - SPACING - 0.001 })).toBe(false);
    // Wide enough for the last few bits an added delta costs.
    expect(spaced({ s: 100 }, { s: 100 - SPACING - 1e-9 })).toBe(true);
  });
});

describe("segmentsOf", () => {
  it("partitions the train in order, the lead segment first", () => {
    const cores = coresAt([300, 272, 244, 100, 72, 40]);
    expect(segmentsOf(cores)).toEqual([
      { count: 3, hold: 0 },
      { count: 2, hold: 0 },
      { count: 1, hold: 0 },
    ]);
    expect(segmentsOf([])).toEqual([]);
  });

  it("reads a segment's hold off its head core", () => {
    const cores = coresAt([300, 272]);
    cores[0].hold = RECOIL_HOLD;
    expect(segmentsOf(cores)[0].hold).toBe(RECOIL_HOLD);
  });
});

describe("resegment", () => {
  it("writes each segment's head hold over the rest of that segment", () => {
    const draft: Draft = { ...createDraft(), cores: coresAt([300, 272, 100]) };
    draft.cores[0].hold = 0.25;
    draft.cores[2].hold = 0.4;
    resegment(draft);
    expect(draft.cores.map((core) => core.hold)).toEqual([0.25, 0.25, 0.4]);
  });
});

describe("thaw and freeze", () => {
  it("round-trip a state, spreading and re-reading the segment holds", () => {
    const draft: Draft = {
      ...createDraft(),
      screen: "playing",
      cores: coresAt([300, 272, 100]),
      projectiles: [{ charge: "cobalt", x: 1, y: 2, angle: 90 }],
    };
    draft.cores[0].hold = RECOIL_HOLD;
    const state = freeze(draft);

    expect(state.segments).toEqual([
      { count: 2, hold: RECOIL_HOLD },
      { count: 1, hold: 0 },
    ]);
    // The frozen cores carry exactly what specs/state.md declares.
    expect(Object.keys(state.cores[0]).sort()).toEqual(["charge", "mark", "s"]);

    const again = thaw(state);
    expect(again.cores.map((core) => core.hold)).toEqual([
      RECOIL_HOLD,
      RECOIL_HOLD,
      0,
    ]);
    expect(freeze(again)).toEqual(state);
  });

  it("normalizes a state whose segments disagree with its arc positions", () => {
    const state = {
      ...freeze(createDraft()),
      cores: [
        { charge: "halide" as const, s: 300, mark: null },
        { charge: "halide" as const, s: 272, mark: null },
      ],
      // One segment too many, and a hold on the second.
      segments: [
        { count: 1, hold: 0 },
        { count: 1, hold: 0.4 },
      ],
    };
    const draft = thaw(state);
    // The spacing says one segment, so the head's hold is the segment's.
    expect(segmentsOf(draft.cores)).toEqual([{ count: 2, hold: 0 }]);
  });

  it("leaves the state it was handed alone", () => {
    const state = freeze({
      ...createDraft(),
      cores: coresAt([300, 272]),
    });
    const before = JSON.stringify(state);
    const draft = thaw(state);
    draft.cores[0].s = 9999;
    draft.score = 500;
    expect(JSON.stringify(state)).toBe(before);
  });
});
