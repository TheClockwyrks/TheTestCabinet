// simulation/breakage-leaves-the-run-running — a breakage the structure survives
// ends nothing.
//
// `specs/statics.md` § Utilization and breakage: "Breakage that leaves the
// structure standing plays the `break` cue and the run continues without the
// broken members." `specs/state.md` gives the phase and the cause that go with
// that: a run that has not ended is `running` with a cause of `null`.
//
// The crane is built so that ONE member can be lost and nothing else follows.
// The rail node the trolley starts on is stayed twice over: a stiff STRUT from
// the mast head `(0, 6, 0)` — id `45` — and a CABLE from the other head
// `(0, 6, 2)` beside it, id `46`. The strut is much the stiffer of the two, so it
// takes most of the lifted load, and its capacity is the lower: a strut bears
// `STRUT_CAP_TENSION` and a cable `CABLE_CAP_TENSION`. Lift `{LOAD_MASS}` and
// the strut goes; the cable then carries what is left, comfortably, and the run
// carries on.
//
// It is watched for ten more ticks, because a build that ended the run a tick
// late would still read `running` on the breaking tick itself. One reading at the
// end of those ten covers all of them: a run that ended anywhere inside the window
// stops ticking and holds the phase and the cause it ended with
// (`specs/state.md`), so the run clock still reading `11` and the phase still
// reading `running` is what says nothing ended over the whole span.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import {
  addOneLoad,
  createHarness,
  openSite,
  poseCrane,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
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
 * The trolley's track is the single rail `32`, from `(4, 4, 0)` to `(8, 4, 0)`.
 * Its origin is the end nearer the slew axis, `(4, 4, 0)`, so a run starts with
 * the trolley — and anything hanging from it — at that node.
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
  /* 31 */ [[0, 4, 0], [4, 4, 0], "strut"],
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
  name: "Doubly stayed",
  ring: [0, 2, 0],
  counterweights: [],
  members: MEMBERS,
  tape: [],
};

/**
 * The load the tape lifts, posed right under the hook.
 *
 * A run starts with the trolley at the track's origin, `(4, 4, 0)`, and the bob
 * "hangs at rest directly below the pivot" at `HOIST_START` below it
 * (`specs/rigging.md`), so a load whose lift point is `(4, 2, 0)` is under the
 * hook and inside `ATTACH_RADIUS` of it.
 */
const HOOK = { x: 4, y: 2, z: 0, yaw: 0 };

/** Heavy enough to take the strut stay, light enough for the cable to hold. */
const LOAD_MASS = 106;

/** The stay that goes. */
const STAY = 45;

/** Ticks watched past the breaking tick. */
const WATCHED = 10;

/**
 * The tape, appended through the tape editor's own screen, which is where the
 * tape poses apply (`specs/instrumentation.md`). It is left there: `startRun`
 * poses the `run` action, which the program screen carries as well as the build
 * screen.
 */
async function poseTape(harness: Harness): Promise<void> {
  await harness.debug.setScreen("program");
  await harness.debug.addActionStep("attach");
  await harness.debug.addMoveStep("grip", 3600, 45);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries on running after a breakage the structure survives", async () => {
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared — and `addOneLoad` clears the loads itself.
  await openSite(h, 5);
  await h.debug.clearObstacles();
  await poseCrane(h, CRANE);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h);
  const started = await startRun(h);
  assertLength(
    started.program,
    2,
    "the steps the tape took: the attach and the grip move that follows it",
  );

  const broke = await runTicks(h, 1);
  assertDeepEqual(
    broke.run.broken,
    [STAY],
    `the members the breaking tick removed: the strut stay ${STAY} alone`,
  );
  assertEqual(
    broke.run.phase,
    "running",
    "the phase on the breaking tick: a breakage the structure survives ends " +
      "nothing (specs/statics.md)",
  );
  assertNull(broke.run.cause, "the cause on the breaking tick");

  const later = await runTicks(h, WATCHED);
  await h.capture(
    "breakage-leaves-the-run-running",
    "the crane still running ten ticks after its stay broke",
  );

  assertEqual(
    later.run.tick,
    1 + WATCHED,
    `the run clock after ${WATCHED} further ticks: a run that had ended ` +
      "anywhere inside them would have stopped counting (specs/state.md)",
  );
  assertEqual(
    later.run.phase,
    "running",
    `the phase ${WATCHED} ticks past the breakage`,
  );
  assertNull(later.run.cause, `the cause ${WATCHED} ticks past the breakage`);
  assertDeepEqual(
    later.run.broken,
    [STAY],
    `the run's broken members ${WATCHED} ticks past the breakage: the strut ` +
      "stay alone, so nothing followed it",
  );
});
