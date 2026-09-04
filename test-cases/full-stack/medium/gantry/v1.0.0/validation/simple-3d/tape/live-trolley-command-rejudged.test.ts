// tape/live-trolley-command-rejudged — a trolley command already running is
// judged again at the top of every tick, and the first tick that finds the track
// no longer reaching its target ends the run.
//
// specs/program.md § The tape: "a `trolley` command already running is judged
// again the same way at the top of every tick: the first tick that finds the
// track no longer reaching its target ends the run as `command-out-of-range`,
// before any axis moves. Both checks read the track the rail members still
// intact form at the moment the check is made, so a rail breaking on one tick
// has shortened the range by the top of the next."
//
// THE SCENARIO IS THE ONE THE SENTENCE DESCRIBES, and the only one that can
// exercise it: the track's length is the one bound that moves during a run, and
// it moves only when a rail member breaks (specs/statics.md § Utilization and
// breakage). So the crane below is built to break its outboard rail on the run's
// first tick, under the specification's own arithmetic and nothing posed, while
// the trolley stands inboard of the break.
//
// The tape is one move commanding the trolley to the far end of the authored
// track. That target is inside the range when the step starts on tick 1 — the
// track is still whole at the top of that tick, before the solve that breaks the
// rail runs — so the step is taken and the command goes live. The verdict this
// item decides therefore cannot come from the check a step makes when it starts:
// it can only come from the live command being judged again at the top of tick 2.
//
// The loads and the obstacles go first, so nothing but the crane, the tape and
// the trolley's own range takes part in the run.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLessThan } from "../assert";
import { TROLLEY_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run out of range on the tick after the track fell short of a live trolley command", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, BREAKING_CRANE);
  await poseTape(h, [
    {
      kind: "move",
      commands: [
        { axis: "trolley", target: AUTHORED_TRACK, rate: TROLLEY_MAX_RATE },
      ],
    },
  ]);
  await startRun(h);

  const first = await runTicks(h, 1);
  const second = await runTicks(h, 1);

  await h.capture(
    "state",
    "The run ended out of range, the tick after the rail broke",
  );

  // The scenario, read back before the verdict is: the rail broke on tick 1,
  // the run carried on past that tick, and the trolley never left the rail it
  // started on.
  assertContains(
    first.run.broken,
    OUTBOARD_RAIL,
    `the members broken on tick 1: the outboard rail, whose utilization the ` +
      `counterweight at the track's far end takes past its length-reduced ` +
      `compression capacity (specs/statics.md)`,
  );
  assertEqual(
    first.run.phase,
    "running",
    "the run on tick 1: the break shortens the track and the run carries on, " +
      "since the trolley stands inboard of the broken rail (specs/statics.md)",
  );
  assertLessThan(
    first.run.axes.trolley.value,
    SHORTENED_TRACK,
    "the trolley's position after tick 1, which stays on the rail that " +
      "remains, so the track shortened under a live command rather than " +
      "falling out from under the trolley (specs/statics.md)",
  );

  assertEqual(
    second.run.phase,
    "failed",
    `the run at the top of tick 2, when the live trolley command's target of ` +
      `${AUTHORED_TRACK} is judged again against the ${SHORTENED_TRACK} the ` +
      "intact rail now forms (specs/program.md)",
  );
  assertEqual(
    second.run.cause,
    "command-out-of-range",
    "the cause the run ends with when a live trolley command's target is no " +
      "longer reached by the track (specs/program.md)",
  );
  assertEqual(
    second.run.tick,
    2,
    "the tick the run ends on: the first one whose top finds the track short " +
      "of the live command's target, which is the tick after the break " +
      "(specs/program.md)",
  );
});
