import { describe, expect, it } from "vitest";
import { HOIST_MAX, HOIST_MIN, HOIST_START, TICK_HZ } from "../constants";
import { SIM_SITES } from "./site";
import { emptyStructure, railTrack } from "./structure";
import {
  advanceRun,
  idleRun,
  playRun,
  runClock,
  startRun,
  type RunState,
} from "./tick";
import type { AxisName, Material, SimSite, Structure, Tape } from "./types";
import type { Vec3 } from "./vec";

const site = SIM_SITES[0];

/**
 * A small crane that stands: a braced 2x2 tower box under a ring at
 * `(0, 2, 0)`, a mast over the top flange, a jib whose seaward chord is the
 * rail, four stays, and a short counter-jib. Its members are in placement
 * order, so a member's index is its id.
 */
function miniCrane(): Structure {
  const m: [Vec3, Vec3, Material][] = [
    // the tower: legs, the top square, a face diagonal each way, a plan brace
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 2], [0, 2, 2], "strut"],
    [[2, 0, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 0], "strut"],
    [[0, 2, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [0, 2, 2], "strut"],
    [[2, 2, 0], [2, 2, 2], "strut"],
    [[0, 0, 0], [2, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 2], "strut"],
    [[2, 0, 2], [0, 2, 2], "strut"],
    [[0, 0, 2], [0, 2, 0], "strut"],
    [[2, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 2], [2, 2, 0], "strut"],
    [[0, 0, 2], [2, 2, 2], "strut"],
    [[0, 0, 0], [0, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 2], "strut"],
    // the mast, over the top flange
    [[0, 4, 0], [0, 8, 0], "strut"],
    [[0, 4, 2], [0, 8, 2], "strut"],
    [[0, 8, 0], [0, 8, 2], "strut"],
    [[0, 4, 0], [0, 8, 2], "strut"],
    [[0, 4, 2], [0, 8, 0], "strut"],
    [[0, 8, 0], [2, 4, 0], "strut"],
    [[0, 8, 0], [2, 4, 2], "strut"],
    [[0, 8, 2], [2, 4, 0], "strut"],
    [[0, 8, 2], [2, 4, 2], "strut"],
    // the jib, carrying the rail out to x = 4
    [[0, 4, 0], [4, 4, 0], "rail"],
    [[0, 4, 2], [4, 4, 2], "strut"],
    [[0, 4, 0], [0, 4, 2], "strut"],
    [[4, 4, 0], [4, 4, 2], "strut"],
    [[0, 4, 0], [4, 4, 2], "strut"],
    // the stays
    [[0, 8, 0], [4, 4, 0], "cable"],
    [[0, 8, 2], [4, 4, 2], "cable"],
    [[0, 8, 0], [4, 4, 2], "cable"],
    [[0, 8, 2], [4, 4, 0], "cable"],
    // the counter-jib and its backstays
    [[0, 4, 0], [-2, 4, 0], "strut"],
    [[0, 4, 2], [-2, 4, 2], "strut"],
    [[-2, 4, 0], [-2, 4, 2], "strut"],
    [[-2, 4, 0], [0, 4, 2], "strut"],
    [[0, 8, 0], [-2, 4, 0], "strut"],
    [[0, 8, 2], [-2, 4, 2], "strut"],
  ];
  return {
    members: m.map(([a, b, material], id) => ({ id, a, b, material })),
    ring: { corner: [0, 2, 0] },
    counterweights: [],
  };
}

/** The same yard with one crate standing exactly under the run-start hook. */
const underTheHook: SimSite = {
  ...site,
  loads: [
    {
      cls: "crate",
      mass: 40,
      from: { pos: [0, 2, 0], yaw: 0 },
      to: { pos: [0, 2, 0], yaw: 0 },
    },
  ],
};

const move = (axis: AxisName, target: number, rate: number): Tape[number] => ({
  kind: "move",
  commands: [{ axis, target, rate }],
});

const run = (ctx: {
  site: SimSite;
  structure: Structure;
  tape: Tape;
}): RunState => {
  const started = startRun(ctx);
  if (started === null) throw new Error("the start was refused");
  return started;
};

describe("starting a run", () => {
  it("is refused when the structure has a readiness issue", () => {
    expect(
      startRun({
        site,
        structure: emptyStructure(),
        tape: [move("grip", 0, 45)],
      }),
    ).toBeNull();
  });

  it("is refused on an empty tape", () => {
    expect(startRun({ site, structure: miniCrane(), tape: [] })).toBeNull();
    expect(playRun({ site, structure: miniCrane(), tape: [] })).toBeNull();
  });

  it("leaves the run-start posture, the pivot at the track origin, and the bob below it", () => {
    const structure = miniCrane();
    const started = run({ site, structure, tape: [move("grip", 0, 45)] });
    const track = railTrack(structure, site.anchors);
    expect(track.ok).toBe(true);
    if (!track.ok) return;
    expect(started.tick).toBe(0);
    expect(started.stepIndex).toBe(0);
    expect(started.stepLive).toBe(false);
    expect(started.axes.hoist.value).toBe(HOIST_START);
    expect(started.pivot).toEqual(track.origin);
    expect(started.previousPivot).toEqual(track.origin);
    expect(started.bob.pos).toEqual([
      track.origin[0],
      track.origin[1] - HOIST_START,
      track.origin[2],
    ]);
    expect(started.bob.vel).toEqual([0, 0, 0]);
    expect(started.loads).toEqual([
      {
        phase: "waiting",
        pos: site.loads[0].from.pos,
        yaw: site.loads[0].from.yaw,
      },
    ]);
    expect(started.broken).toEqual([]);
    expect(started.forces).toEqual([]);
    expect(started.intact).toHaveLength(structure.members.length);
  });

  it("stands every load waiting at the pose it stands at", () => {
    const started = run({
      site: underTheHook,
      structure: miniCrane(),
      tape: [move("grip", 0, 45)],
    });
    expect(started.loads).toEqual([
      { phase: "waiting", pos: [0, 2, 0], yaw: 0 },
    ]);
  });
});

describe("the tick pipeline", () => {
  const structure = miniCrane();

  it("takes one step per tick, and ends at the top of the tick that finds none left", () => {
    // A move whose target is the axis's current value is done on the tick it is
    // issued, so each of these occupies exactly one tick.
    const ctx = {
      site,
      structure,
      tape: [move("grip", 0, 45), move("grip", 0, 45)],
    };
    const ended = playRun(ctx) as RunState;
    expect(ended.tick).toBe(3);
    expect(ended.phase).toBe("failed");
    expect(ended.cause).toBe("loads-unplaced");
    expect(runClock(ended.tick)).toBeCloseTo(3 / TICK_HZ, 12);
  });

  it("clears the site when every load is placed", () => {
    const ctx = {
      site: underTheHook,
      structure,
      tape: [
        { kind: "action", action: "attach" },
        { kind: "action", action: "release" },
      ] as Tape,
    };
    const ended = playRun(ctx) as RunState;
    expect(ended.phase).toBe("cleared");
    expect(ended.cause).toBeNull();
    // An action is taken, executed and complete on one tick, so two in a row
    // occupy two ticks and the run ends on the third.
    expect(ended.tick).toBe(3);
    expect(ended.loads[0]).toEqual({ phase: "placed", pos: [0, 2, 0], yaw: 0 });
  });

  it("hangs the attached load on the hook and reads its yaw off the grip", () => {
    const ctx = {
      site: underTheHook,
      structure,
      tape: [{ kind: "action", action: "attach" }] as Tape,
    };
    let state = run(ctx);
    state = advanceRun(state, ctx);
    expect(state.attached).toBe(0);
    expect(state.loads[0].phase).toBe("attached");
    expect(state.loads[0].pos).toEqual(state.bob.pos);
  });

  it("ends as attach-missed with nothing within reach", () => {
    const ctx = {
      site,
      structure,
      tape: [{ kind: "action", action: "attach" }] as Tape,
    };
    const ended = playRun(ctx) as RunState;
    expect(ended.phase).toBe("failed");
    expect(ended.cause).toBe("attach-missed");
    expect(ended.tick).toBe(1);
  });

  it("ends as release-misplaced with nothing attached", () => {
    const ctx = {
      site,
      structure,
      tape: [{ kind: "action", action: "release" }] as Tape,
    };
    const ended = playRun(ctx) as RunState;
    expect(ended.cause).toBe("release-misplaced");
  });

  it("reports the latest solve's force and utilization per intact member", () => {
    const ctx = { site, structure, tape: [move("hoist", 6, 4)] };
    let state = run(ctx);
    state = advanceRun(state, ctx);
    expect(state.forces).toHaveLength(structure.members.length);
    expect(state.forces.map((f) => f.id)).toEqual(
      structure.members.map((m) => m.id),
    );
    expect(state.peakRingReaction).toBeGreaterThan(0);
  });

  it("leaves a run that has ended exactly as it ended", () => {
    const ctx = { site, structure, tape: [move("grip", 0, 45)] };
    const ended = playRun(ctx) as RunState;
    expect(advanceRun(ended, ctx)).toBe(ended);
  });
});

describe("a command out of its axis's range", () => {
  const structure = miniCrane();

  it("judges the trolley's target against the track's length when the step starts", () => {
    const track = railTrack(structure, site.anchors);
    expect(track.ok).toBe(true);
    if (!track.ok) return;
    expect(track.length).toBe(4);
    const tooFar = playRun({
      site,
      structure,
      tape: [move("trolley", 5, 4)],
    }) as RunState;
    expect(tooFar.cause).toBe("command-out-of-range");
    expect(tooFar.tick).toBe(1);
    // The track's own length is inside the range.
    const justFar = playRun({
      site,
      structure,
      tape: [move("trolley", 4, 4)],
    }) as RunState;
    expect(justFar.cause).toBe("loads-unplaced");
  });

  it("judges the hoist's target against HOIST_MIN and HOIST_MAX", () => {
    const low = playRun({
      site,
      structure,
      tape: [move("hoist", HOIST_MIN - 1e-9, 4)],
    }) as RunState;
    expect(low.cause).toBe("command-out-of-range");
    const high = playRun({
      site,
      structure,
      tape: [move("hoist", HOIST_MAX + 1e-9, 4)],
    }) as RunState;
    expect(high.cause).toBe("command-out-of-range");
  });

  it("judges a live trolley command again at the top of every tick, before any axis moves", () => {
    const ctx = { site, structure, tape: [move("trolley", 4, 4)] };
    let state = run(ctx);
    state = advanceRun(state, ctx);
    expect(state.phase).toBe("running");
    expect(state.axes.trolley.command).not.toBeNull();
    // The rails no longer reach the target: the check comes before the geometry
    // stage, so this is command-out-of-range and not collapse.
    state.intact = state.intact.filter((m) => m.material !== "rail");
    const next = advanceRun(state, ctx);
    expect(next.cause).toBe("command-out-of-range");
    expect(next.axes.trolley.value).toBe(state.axes.trolley.value);
  });

  it("ends as collapse when the rails leave no track and nothing is commanded on the trolley", () => {
    const ctx = { site, structure, tape: [move("hoist", 10, 4)] };
    let state = run(ctx);
    state = advanceRun(state, ctx);
    state.intact = state.intact.filter((m) => m.material !== "rail");
    expect(advanceRun(state, ctx).cause).toBe("collapse");
  });
});

describe("the idle placeholder", () => {
  it("is what a site carries before its first run", () => {
    const idle = idleRun();
    expect(idle.phase).toBe("idle");
    expect(idle.cause).toBeNull();
    expect(idle.tick).toBe(0);
    expect(idle.pivot).toEqual([0, 0, 0]);
    expect(idle.bob).toEqual({ pos: [0, 0, 0], vel: [0, 0, 0] });
    expect(idle.loads).toEqual([]);
    expect(idle.forces).toEqual([]);
    expect(idle.broken).toEqual([]);
    expect(idle.axes.hoist.value).toBe(HOIST_START);
  });
});
