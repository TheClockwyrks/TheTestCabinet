// tape/range-read-from-the-intact-rails — a step's trolley target is judged
// against the track the rail members STILL INTACT form when that step starts.
//
// specs/program.md § The tape: "A `trolley` target that was inside the range
// while an earlier step ran is out of range when its own step starts if the
// track has since fallen short of it... Both checks read the track the rail
// members still intact form at the moment the check is made, so a rail breaking
// on one tick has shortened the range by the top of the next."
//
// THE TWO STEPS ARE TIMED SO THE SECOND STARTS ON THE TICK AFTER THE BREAK.
// The crane below breaks its outboard rail on the run's first tick, under the
// specification's own arithmetic, leaving a track of 4 where 10 was authored.
// The tape's first step commands the hoist to `HOIST_START`, the value it
// already holds: "A command whose target is the axis's current value therefore
// has `s` of `0`... so the command is done on the tick it is issued", which puts
// the second step's start at the top of tick 2 — the first tick whose range
// check reads the shortened track.
//
// THE TARGET IS CHOSEN TO SIT BETWEEN THE TWO TRACKS: `6` is inside the `10` the
// authored rails form, so it was in range while the first step ran and a build
// that judged it against the crane as authored would accept it, and it is beyond
// the `4` the intact rail leaves, so the check the specification asks for
// refuses it. A run that carried on, or that ended for any other cause or on any
// other tick, is not the reading this sentence fixes.
//
// The loads and the obstacles go first, so nothing but the crane, the tape and
// the trolley's own range takes part in the run.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START, TROLLEY_MAX_RATE } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
} from "../harness";

/**
 * A crane whose OUTBOARD RAIL BREAKS ON THE RUN'S FIRST TICK, leaving a shorter
 * track and a structure that stands.
 *
 * The track is two rails on the line `y = 4, z = 0`: `(0, 4, 0)` to `(4, 4, 0)`
 * and `(4, 4, 0)` to `(10, 4, 0)`, so it is `10` long at the run's start and `4`
 * long once the outboard one has gone. The trolley starts at the origin end
 * (`specs/structure.md`), which is inboard of the break, so the break shortens
 * the track rather than taking it out from under the trolley
 * (`specs/statics.md`).
 *
 * WHY THE OUTBOARD RAIL BREAKS AND NOTHING ELSE DOES, from the specification's
 * own arithmetic. A counterweight (`COUNTERWEIGHT_MASS`, `80`) hangs at the
 * track's far node. Its weight is carried by two shallow cables to the mast top
 * at `y = 8`, and the horizontal component of that pull is what the members in
 * the `y = 4` plane resist: the outboard rail and the four horizontal outriggers
 * to `(6, 4, +/-2)` and `(8, 4, +/-2)`. The rail is `6` units long, so its
 * compression capacity is length-reduced to
 * `RAIL_CAP_COMPRESSION * (BUCKLE_REF / 6)^2`, `1067`
 * (`specs/structure.md`), while every outrigger is shorter and holds more. The
 * rail's share of that thrust passes its reduced capacity and no other member's
 * passes its own, so the first solve breaks the rail alone
 * (`specs/statics.md` § Utilization and breakage), and the pass that follows,
 * over the members that remain, breaks nothing.
 *
 * The counter-jib at `-x` carries two more counterweights, which balance the
 * overturning moment the tip's counterweight makes so the tower's legs stay well
 * inside their capacity both before the break and after it.
 */
const BREAKING_CRANE: CraneDesign = {
  site: 4,
  name: "Two-rail track with a breaking outboard rail",
  ring: [0, 2, 0],
  counterweights: [
    [10, 4, 0],
    [-4, 4, 0],
    [-4, 4, 2],
  ],
  members: [
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 2], [0, 2, 2], "strut"],
    [[2, 0, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 0], "strut"],
    [[0, 2, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [0, 2, 2], "strut"],
    [[2, 2, 0], [2, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 2], "strut"],
    [[2, 2, 0], [0, 2, 2], "strut"],
    [[0, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 0], [0, 2, 2], "strut"],
    [[0, 0, 0], [2, 2, 2], "strut"],
    [[2, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 2], "strut"],
    [[2, 0, 0], [0, 2, 2], "strut"],
    [[0, 0, 2], [0, 2, 0], "strut"],
    [[0, 0, 2], [2, 2, 2], "strut"],
    [[0, 0, 2], [2, 2, 0], "strut"],
    [[2, 0, 2], [2, 2, 0], "strut"],
    [[2, 0, 2], [0, 2, 2], "strut"],
    [[2, 0, 2], [0, 2, 0], "strut"],
    [[0, 4, 0], [0, 6, 0], "strut"],
    [[2, 4, 0], [2, 6, 0], "strut"],
    [[0, 4, 2], [0, 6, 2], "strut"],
    [[2, 4, 2], [2, 6, 2], "strut"],
    [[0, 6, 0], [2, 6, 0], "strut"],
    [[0, 6, 2], [2, 6, 2], "strut"],
    [[0, 6, 0], [0, 6, 2], "strut"],
    [[2, 6, 0], [2, 6, 2], "strut"],
    [[0, 6, 0], [2, 6, 2], "strut"],
    [[2, 6, 0], [0, 6, 2], "strut"],
    [[0, 4, 0], [2, 6, 0], "strut"],
    [[2, 4, 0], [0, 6, 0], "strut"],
    [[0, 4, 2], [2, 6, 2], "strut"],
    [[2, 4, 2], [0, 6, 2], "strut"],
    [[0, 4, 0], [0, 6, 2], "strut"],
    [[0, 4, 2], [0, 6, 0], "strut"],
    [[2, 4, 0], [2, 6, 2], "strut"],
    [[2, 4, 2], [2, 6, 0], "strut"],
    [[0, 6, 0], [0, 8, 0], "strut"],
    [[2, 6, 0], [2, 8, 0], "strut"],
    [[0, 6, 2], [0, 8, 2], "strut"],
    [[2, 6, 2], [2, 8, 2], "strut"],
    [[0, 8, 0], [2, 8, 0], "strut"],
    [[0, 8, 2], [2, 8, 2], "strut"],
    [[0, 8, 0], [0, 8, 2], "strut"],
    [[2, 8, 0], [2, 8, 2], "strut"],
    [[0, 8, 0], [2, 8, 2], "strut"],
    [[2, 8, 0], [0, 8, 2], "strut"],
    [[0, 6, 0], [2, 8, 0], "strut"],
    [[2, 6, 0], [0, 8, 0], "strut"],
    [[0, 6, 2], [2, 8, 2], "strut"],
    [[2, 6, 2], [0, 8, 2], "strut"],
    [[0, 6, 0], [0, 8, 2], "strut"],
    [[0, 6, 2], [0, 8, 0], "strut"],
    [[2, 6, 0], [2, 8, 2], "strut"],
    [[2, 6, 2], [2, 8, 0], "strut"],
    [[0, 4, 0], [4, 4, 0], "rail"],
    [[4, 4, 0], [10, 4, 0], "rail"],
    [[4, 4, 0], [2, 4, 2], "strut"],
    [[4, 4, 0], [0, 4, 2], "strut"],
    [[4, 4, 0], [2, 6, 0], "strut"],
    [[4, 4, 0], [0, 6, 0], "strut"],
    [[4, 4, 0], [2, 6, 2], "strut"],
    [[6, 4, 2], [2, 4, 2], "strut"],
    [[6, 4, 2], [4, 4, 0], "strut"],
    [[6, 4, 2], [2, 6, 2], "strut"],
    [[6, 4, 2], [2, 6, 0], "strut"],
    [[6, 4, -2], [2, 4, 0], "strut"],
    [[6, 4, -2], [4, 4, 0], "strut"],
    [[6, 4, -2], [2, 6, 0], "strut"],
    [[6, 4, -2], [2, 6, 2], "strut"],
    [[8, 4, 2], [6, 4, 2], "strut"],
    [[8, 4, 2], [4, 4, 0], "strut"],
    [[8, 4, 2], [2, 6, 2], "cable"],
    [[8, 4, -2], [6, 4, -2], "strut"],
    [[8, 4, -2], [4, 4, 0], "strut"],
    [[8, 4, -2], [2, 6, 0], "cable"],
    [[10, 4, 0], [6, 4, 2], "strut"],
    [[10, 4, 0], [6, 4, -2], "strut"],
    [[10, 4, 0], [8, 4, 2], "strut"],
    [[10, 4, 0], [8, 4, -2], "strut"],
    [[10, 4, 0], [0, 8, 0], "cable"],
    [[10, 4, 0], [0, 8, 2], "cable"],
    [[-4, 4, 0], [0, 4, 0], "strut"],
    [[-4, 4, 0], [0, 4, 2], "strut"],
    [[-4, 4, 0], [0, 6, 0], "strut"],
    [[-4, 4, 0], [0, 8, 0], "strut"],
    [[-4, 4, 2], [0, 4, 2], "strut"],
    [[-4, 4, 2], [0, 4, 0], "strut"],
    [[-4, 4, 2], [0, 6, 2], "strut"],
    [[-4, 4, 2], [0, 8, 2], "strut"],
    [[-4, 4, 0], [-4, 4, 2], "strut"],
  ],
  tape: [],
};

/** The site the crane is authored for, counted from 0: Long Reach. */
const SITE = 3;

/** The outboard rail's member id: its index in the design's ordered members. */
const OUTBOARD_RAIL = 59;

/** The track the two rails form, and what the intact rail leaves after tick 1. */
const AUTHORED_TRACK = 10;
const SHORTENED_TRACK = 4;

/** Inside the authored track of 10, beyond the 4 the intact rail leaves. */
const TARGET = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("judges a step's trolley target against the track the intact rails form when it starts", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await poseCrane(h, BREAKING_CRANE);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
    },
    {
      kind: "move",
      commands: [{ axis: "trolley", target: TARGET, rate: TROLLEY_MAX_RATE }],
    },
  ]);
  await startRun(h);

  const first = await runTicks(h, 1);
  const second = await runTicks(h, 1);

  await h.capture(
    "state",
    "The run refused a trolley target the broken rail put out of reach",
  );

  // The scenario, read back before the verdict: the rail broke on tick 1 and
  // the run carried on, so the step under test starts on tick 2 against a track
  // that is shorter than the one the tape was written over.
  assertContains(
    first.run.broken,
    OUTBOARD_RAIL,
    "the members broken on tick 1: the outboard rail, whose utilization the " +
      "counterweight at the track's far node takes past its length-reduced " +
      "compression capacity (specs/statics.md)",
  );
  assertEqual(
    first.run.phase,
    "running",
    `the run on tick 1: the target of ${TARGET} is inside the ` +
      `${AUTHORED_TRACK} the authored rails form, so nothing about it is out ` +
      "of range while the first step runs (specs/program.md)",
  );

  assertEqual(
    second.run.phase,
    "failed",
    `the run at the top of tick 2, the tick that takes the trolley step: its ` +
      `target of ${TARGET} is beyond the ${SHORTENED_TRACK} the intact rail ` +
      "now forms (specs/program.md)",
  );
  assertEqual(
    second.run.cause,
    "command-out-of-range",
    "the cause a step whose command targets a value outside its axis's range " +
      "at that moment ends the run with (specs/program.md)",
  );
  assertEqual(
    second.run.tick,
    2,
    "the tick the run ends on: the range shortened by the top of the tick " +
      "after the break, not a tick later (specs/program.md)",
  );
});
