// simulation/slack-iteration-repeats — the slack-cable iteration repeats until
// no new cable goes slack.
//
// `specs/statics.md` § Slack cables: "Solve with every candidate cable present;
// every cable whose force comes back negative goes slack, leaves the system
// entirely, and carries zero force; solve again with the remainder. Repeat until a
// solve marks no new cable slack."
//
// One pass is the tempting shortcut, and it is exactly what this catches. The
// crane and its posture are chosen so that the FIRST solve finds only cable `48`
// negative, and cable `52` — the other cross stay, from the same mast head out to
// the jib tip's `z = 2` node — comes back in TENSION on that pass. It is only once
// `48` has left the system and the solve is made again that `52` turns negative
// too. A build that dropped the negatives once and reported would answer `52`'s
// positive first-pass force; the specification says it must answer `0`.
//
// THE POSTURE IS POSED RATHER THAN DRIVEN TO. `specs/instrumentation.md`'s
// `setAxis` "sets an axis's value", and the reading wanted here is one tick's
// solve at a trolley position part way along the track with a load on the hook. So
// the run is started, the trolley is put where the reading is, and exactly one
// tick is advanced: on a run's first tick the bob's acceleration is zero
// (`specs/rigging.md`), so the cable force is the load hanging straight down and
// the solve is the static one this is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/**
 * The reference crane these checks are posed on, built on site 6 (Heavy Haul) for
 * its nine ground anchors and its `6000` budget.
 *
 * Ids are the order the members are listed in, which is the order `poseCrane`
 * places them and therefore the id each one carries in every force readout and
 * every `broken` entry (`specs/instrumentation.md`).
 *
 *   - `0`-`21`  the tower: a leg under each of the ring's four bottom-flange
 *               nodes, the flange square with both its horizontal diagonals, and
 *               inclined braces from every anchor the site gives, so no tower
 *               member is ever the weakest thing in the crane.
 *   - `22`-`30` the mast: two heads at `(0, 6, 0)` and `(0, 6, 2)`, each tied to
 *               all four top-flange nodes, and tied to each other.
 *   - `31`-`44` the jib: two chords out to `x = 8` at `z = 0` and `z = 2`, the
 *               rail among them, and the cross members that make the pair rigid.
 *   - `45`-`52` the stays: at `(4, 4, 0)` and `(4, 4, 2)` a stiff STRUT stay and
 *               a CABLE stay side by side, and four cables out to the jib tip.
 *
 * The trolley's track is the two rails `31` and `32`, running the whole length
 * of the `z = 0` chord from the top-flange node `(0, 4, 0)` out to `(8, 4, 0)`.
 * Its origin is the end nearer the slew axis, `(0, 4, 0)`, so the trolley starts
 * over the ring and a `trolley` command carries it all the way to the tip.
 */
const MEMBERS: CraneDesign["members"] = [
  /*  0 */ [[0, 0, 0], [0, 2, 0], "strut"],
  /*  1 */ [[2, 0, 0], [2, 2, 0], "strut"],
  /*  2 */ [[0, 0, 2], [0, 2, 2], "strut"],
  /*  3 */ [[2, 0, 2], [2, 2, 2], "strut"],
  /*  4 */ [[0, 2, 0], [2, 2, 0], "strut"],
  /*  5 */ [[0, 2, 2], [2, 2, 2], "strut"],
  /*  6 */ [[0, 2, 0], [0, 2, 2], "strut"],
  /*  7 */ [[2, 2, 0], [2, 2, 2], "strut"],
  /*  8 */ [[0, 2, 0], [2, 2, 2], "strut"],
  /*  9 */ [[2, 2, 0], [0, 2, 2], "strut"],
  /* 10 */ [[2, 0, 0], [0, 2, 0], "strut"],
  /* 11 */ [[0, 0, 2], [0, 2, 0], "strut"],
  /* 12 */ [[0, 0, 0], [2, 2, 0], "strut"],
  /* 13 */ [[2, 0, 2], [2, 2, 0], "strut"],
  /* 14 */ [[4, 0, 0], [2, 2, 0], "strut"],
  /* 15 */ [[4, 0, 2], [2, 2, 2], "strut"],
  /* 16 */ [[0, 0, 4], [0, 2, 2], "strut"],
  /* 17 */ [[2, 0, 4], [2, 2, 2], "strut"],
  /* 18 */ [[4, 0, 4], [2, 2, 2], "strut"],
  /* 19 */ [[4, 0, 0], [2, 2, 2], "strut"],
  /* 20 */ [[0, 0, 4], [2, 2, 2], "strut"],
  /* 21 */ [[4, 0, 2], [2, 2, 0], "strut"],
  /* 22 */ [[0, 4, 0], [0, 6, 0], "strut"],
  /* 23 */ [[2, 4, 0], [0, 6, 0], "strut"],
  /* 24 */ [[0, 4, 2], [0, 6, 0], "strut"],
  /* 25 */ [[2, 4, 2], [0, 6, 0], "strut"],
  /* 26 */ [[0, 4, 2], [0, 6, 2], "strut"],
  /* 27 */ [[2, 4, 2], [0, 6, 2], "strut"],
  /* 28 */ [[0, 4, 0], [0, 6, 2], "strut"],
  /* 29 */ [[2, 4, 0], [0, 6, 2], "strut"],
  /* 30 */ [[0, 6, 0], [0, 6, 2], "strut"],
  /* 31 */ [[0, 4, 0], [4, 4, 0], "rail"],
  /* 32 */ [[4, 4, 0], [8, 4, 0], "rail"],
  /* 33 */ [[0, 4, 2], [4, 4, 2], "strut"],
  /* 34 */ [[4, 4, 2], [8, 4, 2], "strut"],
  /* 35 */ [[0, 4, 0], [0, 4, 2], "strut"],
  /* 36 */ [[4, 4, 0], [4, 4, 2], "strut"],
  /* 37 */ [[8, 4, 0], [8, 4, 2], "strut"],
  /* 38 */ [[0, 4, 0], [4, 4, 2], "strut"],
  /* 39 */ [[4, 4, 2], [8, 4, 0], "strut"],
  /* 40 */ [[2, 4, 0], [4, 4, 0], "strut"],
  /* 41 */ [[2, 4, 2], [4, 4, 0], "strut"],
  /* 42 */ [[0, 4, 2], [4, 4, 0], "strut"],
  /* 43 */ [[2, 4, 0], [4, 4, 2], "strut"],
  /* 44 */ [[2, 4, 2], [4, 4, 2], "strut"],
  /* 45 */ [[0, 6, 0], [4, 4, 0], "strut"],
  /* 46 */ [[0, 6, 2], [4, 4, 0], "cable"],
  /* 47 */ [[0, 6, 2], [4, 4, 2], "strut"],
  /* 48 */ [[0, 6, 0], [4, 4, 2], "cable"],
  /* 49 */ [[0, 6, 0], [8, 4, 0], "cable"],
  /* 50 */ [[0, 6, 2], [8, 4, 2], "cable"],
  /* 51 */ [[0, 6, 2], [8, 4, 0], "cable"],
  /* 52 */ [[0, 6, 0], [8, 4, 2], "cable"],
];

const CRANE: CraneDesign = {
  site: 6,
  name: "Two cross stays",
  ring: [0, 2, 0],
  counterweights: [],
  members: MEMBERS,
  tape: [],
};

/** The cable the first solve finds negative. */
const FIRST = 48;

/** The cable the solve after it finds negative, and only then. */
const SECOND = 52;

/** The load, posed under the hook at the run-start posture. */
const HOOK = { x: 0, y: 2, z: 0, yaw: 0 };
const LOAD_MASS = 107;

/** Where the trolley is posed: part way along the second rail. */
const TROLLEY_AT = 4.5;

const TAPE: readonly TapeStepSpec[] = [
  { kind: "action", action: "attach" },
  { kind: "move", commands: [{ axis: "grip", target: 3600, rate: 45 }] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps solving until a pass marks no new cable slack", async () => {
  await openSite(h, 5);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h, TAPE);
  await startRun(h);

  await h.debug.setAxis("trolley", TROLLEY_AT);
  const solved = await runTicks(h, 1);
  await h.capture(
    "slack-iteration-repeats",
    "the crane whose second solve slackened a second cable",
  );

  assertEqual(solved.run.phase, "running", "the phase after the tick");
  assertNull(solved.run.cause, "the cause after the tick");
  assertEqual(
    solved.run.axes.trolley.value,
    TROLLEY_AT,
    "where the trolley stands for the solve",
  );
  assertEqual(
    solved.run.broken.length,
    0,
    "the members that broke, which would have changed what was solved",
  );

  assertEqual(
    solved.run.forces.find((one) => one.id === FIRST)?.force,
    0,
    `cable ${FIRST}, which the first solve of this tick found negative`,
  );
  assertEqual(
    solved.run.forces.find((one) => one.id === SECOND)?.force,
    0,
    `cable ${SECOND}: it came back in tension while ${FIRST} was still in the ` +
      `system, and only the solve made after ${FIRST} left it finds it ` +
      "negative — so a build that stopped after one pass reports its tension " +
      "here instead of 0 (specs/statics.md)",
  );
});
