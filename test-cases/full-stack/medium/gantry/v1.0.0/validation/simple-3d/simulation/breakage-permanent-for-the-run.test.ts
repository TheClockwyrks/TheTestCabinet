// simulation/breakage-permanent-for-the-run — a broken member stays broken for
// the rest of the run.
//
// `specs/statics.md` § Utilization and breakage: broken members are "removed at
// once, permanently for the rest of the run". So a member that broke under a
// heavy moment must not come back when the moment eases, and it must not come
// back when the load is somewhere else entirely.
//
// The load is moved by SLEWING, which is the one motion that takes the whole arm
// somewhere new without changing what the members are: the crane's stay `45`
// breaks on the first tick under the lift, and the tape then turns the arm a
// quarter of the way round at `10` degrees a second, nine seconds of run clock,
// while the load swings on the end of the cable. Every axis reading, every node
// position, every applied force in the arm solve changes over that turn.
//
// The run is sampled all the way through: at no point may `run.forces` — "the
// latest solve's, in member-id order, over the members still intact"
// (`specs/state.md`) — carry the broken member again, and it stays on the run's
// broken list throughout.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
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
  name: "Slewing after a break",
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

/** The stay that breaks on the first tick. */
const STAY = 45;

/** Attach, then turn a quarter circle, gently enough that the swing stays small. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "action", action: "attach" },
  { kind: "move", commands: [{ axis: "slew", target: 90, rate: 10 }] },
  { kind: "move", commands: [{ axis: "grip", target: 3600, rate: 45 }] },
];

/** How the turn is sampled: this many ticks at a time, this many times. */
const STRIDE = 30;
const SAMPLES = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("never solves over the broken member again, however the arm turns", async () => {
  await openSite(h, 5);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h, TAPE);
  await startRun(h);

  const broke = await runTicks(h, 1);
  assertDeepEqual(
    broke.run.broken,
    [STAY],
    `the members the first tick removed: the strut stay ${STAY}`,
  );

  for (let sample = 1; sample <= SAMPLES; sample += 1) {
    const now = await runTicks(h, STRIDE);
    assertEqual(
      now.run.phase,
      "running",
      `the phase after ${sample * STRIDE} more ticks of the turn`,
    );
    assertEqual(
      now.run.forces.find((one) => one.id === STAY),
      undefined,
      `a force for member ${STAY} at tick ${now.run.tick}, with the arm at ` +
        `${now.run.axes.slew.value.toFixed(1)} degrees: a broken member is ` +
        "removed permanently for the rest of the run (specs/statics.md)",
    );
    assertDeepEqual(
      now.run.broken,
      [STAY],
      `the run's broken members at tick ${now.run.tick}`,
    );
  }

  const end = await h.snapshot();
  await h.capture(
    "breakage-permanent-for-the-run",
    "the crane a quarter turn on, still without the member that broke",
  );
  assertGreaterThan(
    end.run.axes.slew.value,
    45,
    "how far the arm turned while the broken member stayed broken, in degrees " +
      `(the tape drives it to 90 at ${10} of the ${SLEW_MAX_RATE} it may use)`,
  );
});
