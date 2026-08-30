import { describe, expect, it } from "vitest";
import { CATCHUP, RECOIL, RECOIL_HOLD, SPACING } from "./constants";
import type { ChargeId } from "./constants";
import { newReport } from "./events";
import { createState } from "./state";
import {
  advanceTrain,
  clamp,
  effectiveFeed,
  findStrike,
  insertCore,
  maximalRun,
  removeCores,
  resegment,
  spaced,
} from "./train";
import type { VoluteState } from "./types";
import { poseRun } from "./harness.test";

/** A state carrying the cores given, at the arc positions given. */
function hall(cores: [number, ChargeId][]): VoluteState {
  const state = createState(1);
  state.screen = "playing";
  state.cores = cores.map(([s, charge]) => ({
    charge,
    s,
    mark: null,
    hold: 0,
  }));
  state.cores.sort((a, b) => b.s - a.s);
  resegment(state);
  return state;
}

describe("segments", () => {
  it("cuts the train wherever the spacing breaks", () => {
    const state = hall([
      [500, "halide"],
      [472, "halide"],
      [444, "halide"],
      [300, "cobalt"],
      [272, "cobalt"],
    ]);
    expect(state.segments.map((segment) => segment.count)).toEqual([3, 2]);
  });

  it("treats a lone core as a segment of one", () => {
    expect(hall([[100, "halide"]]).segments).toEqual([{ count: 1, hold: 0 }]);
  });

  it("reads a segment's hold off its head, and writes it through", () => {
    const state = hall([
      [500, "halide"],
      [472, "halide"],
    ]);
    state.cores[0].hold = 0.25;
    state.cores[1].hold = 0;
    resegment(state);
    expect(state.segments).toEqual([{ count: 2, hold: 0.25 }]);
    expect(state.cores[1].hold).toBe(0.25);
  });

  it("tells two cores one spacing apart from any other pair", () => {
    const at = (s: number) => ({
      charge: "halide" as const,
      s,
      mark: null,
      hold: 0,
    });
    expect(spaced(at(SPACING), at(0))).toBe(true);
    expect(spaced(at(SPACING + 0.5), at(0))).toBe(false);
    expect(spaced(at(SPACING - 1e-9), at(0))).toBe(true);
  });
});

describe("advance", () => {
  it("moves the lead segment at the effective feed speed", () => {
    const state = hall([[1000, "halide"]]);
    for (let i = 0; i < 60; i += 1)
      advanceTrain(state, 1 / 60, newReport(), []);
    expect(state.cores[0].s).toBeCloseTo(1022, 6);
  });

  it("closes a trailing segment at the catch-up speed", () => {
    const state = hall([
      [2000, "halide"],
      [1000, "cobalt"],
    ]);
    for (let i = 0; i < 30; i += 1)
      advanceTrain(state, 1 / 60, newReport(), []);
    expect(state.cores[1].s).toBeCloseTo(1000 + CATCHUP * 0.5, 6);
  });

  it("clamps a catching-up segment one spacing behind the one ahead", () => {
    const state = hall([
      [2000, "halide"],
      [1900, "cobalt"],
    ]);
    for (let i = 0; i < 90; i += 1)
      advanceTrain(state, 1 / 60, newReport(), []);
    expect(state.cores[1].s).toBeCloseTo(state.cores[0].s - SPACING, 6);
    expect(state.segments).toHaveLength(1);
  });

  it("merges on the tick its advance lands ON the position, and extracts", () => {
    const dt = 1 / 60;
    const step = CATCHUP * dt;
    const state = hall([
      [1000, "sulfur"],
      [972, "cobalt"],
      [944, "cobalt"],
      // A hair short of the merge position after this tick's advance — inside the
      // slack `spaced` allows, so the join is made whatever the clamp decides.
      [944 - SPACING - step - 1e-9, "cobalt"],
    ]);
    // The lead segment is held, so the merge position stands still and the pose is
    // exact.
    for (let i = 0; i < 3; i += 1) state.cores[i].hold = RECOIL_HOLD;
    resegment(state);

    advanceTrain(state, dt, newReport(), []);

    expect(state.cores.map((core) => core.charge)).toEqual(["sulfur"]);
    // Three cobalt, at the incremented chain step.
    expect(state.score).toBe(60);
    expect(state.chainStep).toBe(2);
  });

  it("leaves a segment still short of the position a segment of its own", () => {
    const dt = 1 / 60;
    const step = CATCHUP * dt;
    const state = hall([
      [1000, "sulfur"],
      [972, "cobalt"],
      [944, "cobalt"],
      [944 - SPACING - step - 1e-3, "cobalt"],
    ]);
    for (let i = 0; i < 3; i += 1) state.cores[i].hold = RECOIL_HOLD;
    resegment(state);

    advanceTrain(state, dt, newReport(), []);

    expect(state.cores).toHaveLength(4);
    expect(state.segments.map((segment) => segment.count)).toEqual([3, 1]);
    expect(state.score).toBe(0);
  });

  it("rides a merged pair as one, at the feed rather than the catch-up", () => {
    const state = hall([
      [2000, "halide"],
      [1900, "cobalt"],
    ]);
    for (let i = 0; i < 90; i += 1)
      advanceTrain(state, 1 / 60, newReport(), []);
    const before = state.cores[1].s;
    for (let i = 0; i < 60; i += 1)
      advanceTrain(state, 1 / 60, newReport(), []);
    expect(state.cores[1].s - before).toBeCloseTo(22, 3);
  });

  it("holds a segment whose recoil hold has not expired", () => {
    const state = hall([[1000, "halide"]]);
    state.cores[0].hold = 0.4;
    resegment(state);
    advanceTrain(state, 1 / 60, newReport(), []);
    expect(state.cores[0].s).toBe(1000);
  });

  it("drives every core toward the inlet while backflow is active", () => {
    const state = hall([
      [2000, "halide"],
      [1972, "cobalt"],
      [1944, "garnet"],
    ]);
    state.machinery = { kind: "backflow", remaining: 5 };
    for (let i = 0; i < 30; i += 1)
      advanceTrain(state, 1 / 60, newReport(), []);
    expect(state.cores[0].s).toBeCloseTo(1970, 3);
    expect(state.cores[2].s).toBeCloseTo(1914, 3);
  });

  it("packs the train against the inlet and holds it there", () => {
    const state = hall([
      [60, "halide"],
      [32, "cobalt"],
      [4, "garnet"],
    ]);
    state.machinery = { kind: "backflow", remaining: 5 };
    for (let i = 0; i < 120; i += 1)
      advanceTrain(state, 1 / 60, newReport(), []);
    expect(state.cores.map((core) => core.s)).toEqual([56, 28, 0]);
  });

  it("leaves a core standing below the inlet where it stands", () => {
    const state = hall([[-10, "halide"]]);
    state.machinery = { kind: "backflow", remaining: 5 };
    advanceTrain(state, 1 / 60, newReport(), []);
    expect(state.cores[0].s).toBe(-10);
  });
});

describe("the feed speed", () => {
  it("is the level's rate under pressure and under choke", () => {
    const state = hall([]);
    expect(effectiveFeed(state)).toBeCloseTo(22, 6);
    state.pressure = 50;
    expect(effectiveFeed(state)).toBeCloseTo(33, 6);
    state.machinery = { kind: "choke", remaining: 8 };
    expect(effectiveFeed(state)).toBeCloseTo(13.2, 6);
    state.level = 5;
    state.pressure = 0;
    state.machinery = null;
    expect(effectiveFeed(state)).toBeCloseTo(38, 6);
  });
});

describe("runs", () => {
  it("stops at a different charge and at a break in the spacing", () => {
    const state = hall([
      [500, "halide"],
      [472, "cobalt"],
      [444, "cobalt"],
      [416, "cobalt"],
      [388, "halide"],
      [200, "cobalt"],
    ]);
    expect(maximalRun(state.cores, 2)).toEqual({ from: 1, to: 3 });
    expect(maximalRun(state.cores, 5)).toEqual({ from: 5, to: 5 });
  });
});

describe("removals", () => {
  it("recoils the trailing group and holds it", () => {
    const state = hall([
      [1000, "halide"],
      [972, "halide"],
      [944, "halide"],
      [916, "cobalt"],
      [888, "cobalt"],
    ]);
    removeCores(state, [0, 1, 2], newReport(), []);
    expect(state.cores.map((core) => core.s)).toEqual([
      916 - RECOIL,
      888 - RECOIL,
    ]);
    expect(state.segments).toEqual([{ count: 2, hold: RECOIL_HOLD }]);
  });

  it("clamps a recoil at the inlet", () => {
    const state = hall([
      [84, "halide"],
      [56, "halide"],
      [28, "halide"],
      [0, "cobalt"],
    ]);
    removeCores(state, [0, 1, 2], newReport(), []);
    expect(state.cores[0].s).toBe(0);
  });

  it("gives a group only the room the group behind it leaves", () => {
    // Two trailing groups 50 apart. The front one may fall back only as far as the
    // spacing behind the one behind it — 22 units — while the rear one, with
    // nothing behind it, takes the whole recoil.
    const state = hall([
      [1000, "halide"],
      [900, "cobalt"],
      [850, "garnet"],
    ]);
    removeCores(state, [0], newReport(), []);
    expect(state.cores[0].s).toBe(900 - (900 - 850 - SPACING));
    expect(state.cores[1].s).toBe(850 - RECOIL);
  });

  it("leaves everything ahead of the removal exactly where it stood", () => {
    const state = hall([
      [1000, "halide"],
      [900, "cobalt"],
      [872, "cobalt"],
      [844, "cobalt"],
    ]);
    removeCores(state, [1, 2, 3], newReport(), []);
    expect(state.cores.map((core) => core.s)).toEqual([1000]);
  });

  it("hands back the marks an extraction took, head first", () => {
    const state = hall([
      [1000, "halide"],
      [972, "halide"],
      [944, "halide"],
    ]);
    state.cores[0].mark = "choke";
    state.cores[2].mark = "sightline";
    const grants: { kind: string }[] = [];
    removeCores(state, [0, 1, 2], newReport(), grants as never);
    expect(grants.map((grant) => grant.kind)).toEqual(["choke", "sightline"]);
  });

  it("hands back nothing when the removal grants nothing", () => {
    const state = hall([[1000, "halide"]]);
    state.cores[0].mark = "bore";
    const report = newReport();
    removeCores(state, [0], report, null);
    expect(report.fx.filter((event) => event.kind === "grant")).toHaveLength(0);
  });
});

describe("strikes", () => {
  it("finds nothing beyond the strike distance", () => {
    const state = hall([[380, "halide"]]);
    expect(findStrike(state.cores, { x: 420, y: 40 + 29 })).toBeNull();
  });

  it("takes the nearest core of several", () => {
    const state = hall([
      [420, "halide"],
      [378, "cobalt"],
    ]);
    // (400, 40) is 20 from the rear core at x = 418 and 60 from the front at 460.
    const strike = findStrike(state.cores, { x: 400, y: 40 });
    expect(strike?.index).toBe(1);
  });

  it("breaks a tie toward the core with the larger arc position", () => {
    const state = hall([
      [400, "halide"],
      [358, "cobalt"],
    ]);
    // Equidistant from (440, 40) and (398, 40): the perpendicular bisector at x = 419.
    const strike = findStrike(state.cores, { x: 419, y: 50 });
    expect(strike?.index).toBe(0);
  });

  it("reads the side the projectile arrived on from the channel's forward", () => {
    const state = hall([[380, "halide"]]);
    expect(findStrike(state.cores, { x: 430, y: 40 })?.ahead).toBe(true);
    expect(findStrike(state.cores, { x: 410, y: 40 })?.ahead).toBe(false);
    // Exactly zero enters behind.
    expect(findStrike(state.cores, { x: 420, y: 50 })?.ahead).toBe(false);
  });
});

describe("insertion", () => {
  it("seats ahead of the struck core and shifts the train back", () => {
    const state = hall([
      [500, "halide"],
      [472, "halide"],
      [444, "halide"],
    ]);
    insertCore(state, { index: 1, ahead: true }, "cobalt", newReport(), []);
    expect(state.cores.map((core) => core.s)).toEqual([500, 472, 444, 416]);
    expect(state.cores.map((core) => core.charge)).toEqual([
      "halide",
      "cobalt",
      "halide",
      "halide",
    ]);
  });

  it("seats behind the struck core", () => {
    const state = hall([
      [500, "halide"],
      [472, "halide"],
    ]);
    insertCore(state, { index: 0, ahead: false }, "cobalt", newReport(), []);
    expect(state.cores.map((core) => core.charge)).toEqual([
      "halide",
      "cobalt",
      "halide",
    ]);
    expect(state.cores.map((core) => core.s)).toEqual([500, 472, 444]);
  });

  it("never moves the head forward", () => {
    const state = hall([
      [500, "halide"],
      [472, "halide"],
      [444, "halide"],
      [416, "halide"],
      [388, "halide"],
    ]);
    insertCore(state, { index: 2, ahead: false }, "cobalt", newReport(), []);
    expect(state.cores[0].s).toBe(500);
    expect(state.cores[state.cores.length - 1].s).toBe(388 - SPACING);
  });

  it("keeps the segment's recoil hold when the seated core takes its head", () => {
    const state = hall([
      [500, "halide"],
      [472, "halide"],
      [444, "halide"],
    ]);
    for (const core of state.cores) core.hold = RECOIL_HOLD;
    resegment(state);

    insertCore(state, { index: 0, ahead: true }, "cobalt", newReport(), []);

    expect(state.segments).toEqual([{ count: 4, hold: RECOIL_HOLD }]);
    expect(state.cores.map((core) => core.hold)).toEqual([
      RECOIL_HOLD,
      RECOIL_HOLD,
      RECOIL_HOLD,
      RECOIL_HOLD,
    ]);
  });

  it("keeps the segment's recoil hold when the seated core lands inside it", () => {
    const state = hall([
      [500, "halide"],
      [472, "halide"],
      [444, "halide"],
    ]);
    for (const core of state.cores) core.hold = RECOIL_HOLD;
    resegment(state);

    insertCore(state, { index: 1, ahead: true }, "cobalt", newReport(), []);

    expect(state.segments).toEqual([{ count: 4, hold: RECOIL_HOLD }]);
  });

  it("keeps a core carried below the inlet where it stands", () => {
    const state = hall([[10, "halide"]]);
    insertCore(state, { index: 0, ahead: true }, "cobalt", newReport(), []);
    expect(state.cores.map((core) => core.s)).toEqual([10, -18]);
  });
});

describe("clamp", () => {
  it("holds a value inside its range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("poseRun", () => {
  it("lays a run of cores out head first", () => {
    const state = createState(1);
    poseRun(state, 200, ["halide", "cobalt"]);
    expect(state.cores.map((core) => core.s)).toEqual([200, 172]);
  });
});
