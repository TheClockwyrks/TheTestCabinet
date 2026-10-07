// simulation/slack-is-per-solve — a cable marked slack is a candidate again at
// the next solve.
//
// `specs/statics.md` § Slack cables: "A cable marked slack stays out for the rest
// of that solve's iteration but is a candidate again at the next solve, so a cable
// is slack per solve, never permanently."
//
// The cable is `48`, from the mast head `(0, 6, 0)` across to the `z = 2` chord's
// mid node `(4, 4, 2)`. It is one of the crane's two cross stays, and what it does
// depends on where the lifted load sits along the track: with the load near the
// ring it is pulled, in the middle of the track the crane leans the other way and
// it can only push, and out at the tip it is pulled again.
//
// So the tape drives the trolley along the track with a load on the hook and the
// check watches that one cable. It must read a positive force early, exactly `0`
// through the middle, and a positive force again afterwards. A build that took a
// slack cable out and left it out reads `0` for the rest of the run.
//
// THE TRAVERSE IS DRIVEN AND NOT POSED, because the traverse is the scenario
// rather than the route to it: `setAxis` puts the trolley where it is asked for
// and leaves the bob where it was, and the cable between them is then longer than
// the hoist says, which the run ends as `cable-snap` on the next tick. What the
// pendulum is hanging from has to arrive under the run's own rules.
//
// WHAT IS TRIMMED IS THE SAMPLING AND THE DISTANCE. The stay is read every
// `SAMPLE` ticks rather than on every one of them: the slack stretch is some
// fifty ticks wide, so a sample every eighth tick lands inside it half a dozen
// times, and a sample that missed it would fail this check loudly rather than
// pass it quietly. And the traverse stops as soon as the stay is carrying again
// — the reading is "positive, then `0`, then positive", and the ticks past the
// one that answers it decide nothing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  fail,
} from "../assert";
import { TROLLEY_MAX_RATE } from "../constants";
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
  name: "Cross-stayed jib",
  ring: [0, 2, 0],
  counterweights: [],
  members: MEMBERS,
  tape: [],
};

/** The cross stay this check watches. */
const CABLE = 48;

/** The load, posed under the hook at the run-start posture. */
const HOOK = { x: 0, y: 2, z: 0, yaw: 0 };
const LOAD_MASS = 55;

/** The track's length, from `(0, 4, 0)` to `(8, 4, 0)`. */
const TRACK = 8;

/**
 * How far along the trolley is driven before the reading is judged.
 *
 * Past the stretch the stay cannot pull in, with the stay carrying again for
 * several samples before the traverse stops. The far end of the track is `8`, and
 * driving to it adds ticks to a reading that is already answered.
 */
const WATCHED_TO = 7;

/**
 * Ticks between readings of the stay.
 *
 * The traverse is one continuous move, so every sample is a solve the build ran
 * under a trolley position of its own; what the spacing changes is how many of
 * them are read, not how many happen.
 */
const SAMPLE = 8;

/** Samples the traverse is given to reach {@link WATCHED_TO}: 320 ticks. */
const MAX_SAMPLES = 40;

const TAPE: readonly TapeStepSpec[] = [
  { kind: "action", action: "attach" },
  {
    kind: "move",
    commands: [{ axis: "trolley", target: TRACK, rate: TROLLEY_MAX_RATE }],
  },
  { kind: "move", commands: [{ axis: "grip", target: 3600, rate: 45 }] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lets a cable that went slack carry tension again later in the run", async () => {
  await openSite(h, 5);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h, TAPE);
  await startRun(h);

  /** The cable's force at every sampled tick of the traverse, in order. */
  const seen: { tick: number; force: number }[] = [];
  let arrived = false;
  for (let taken = 0; taken < MAX_SAMPLES && !arrived; taken += 1) {
    const snapshot = await runTicks(h, SAMPLE);
    const force = snapshot.run.forces.find((one) => one.id === CABLE);
    if (force !== undefined) {
      seen.push({ tick: snapshot.run.tick, force: force.force });
    }
    if (snapshot.run.phase !== "running") {
      fail(
        "the run to still be running while the trolley traverses the track, " +
          "so every reading below is a solve of the crane this point is about",
        `it is "${snapshot.run.phase}"` +
          (snapshot.run.cause === null ? "" : ` (${snapshot.run.cause})`) +
          ` at tick ${snapshot.run.tick}`,
      );
    }
    arrived = snapshot.run.axes.trolley.value >= WATCHED_TO;
  }
  await h.capture(
    "slack-is-per-solve",
    "the crane with the trolley out at the tip, its cross stay taut again",
  );

  if (!arrived) {
    fail(
      `the trolley to reach ${WATCHED_TO} along the track within ` +
        `${MAX_SAMPLES * SAMPLE} ticks`,
      `it never did: the traverse is the scenario this point reads`,
    );
  }

  const firstSlack = seen.findIndex((one) => one.force === 0);
  assertGreaterThan(
    firstSlack,
    0,
    `the sample index at which cable ${CABLE} first reports 0: it goes slack ` +
      "somewhere in the traverse (specs/statics.md)",
  );
  assertGreaterThan(
    seen[0]?.force ?? 0,
    0,
    `cable ${CABLE}'s force on the first sample, before it goes slack`,
  );

  const lastSlack =
    seen.length - 1 - [...seen].reverse().findIndex((one) => one.force === 0);
  const after = seen.slice(lastSlack + 1);
  assertGreaterThan(
    after.length,
    0,
    `the samples taken after cable ${CABLE} was last read slack`,
  );
  assertGreaterThan(
    after[after.length - 1]?.force ?? 0,
    0,
    `cable ${CABLE}'s force once the trolley has carried the load past it: a ` +
      "cable marked slack is a candidate again at the next solve, so it is " +
      "taut again (specs/statics.md)",
  );
  assertEqual(
    after.filter((one) => one.force < 0).length,
    0,
    "samples on which the cable reported a compression, which a cable never does",
  );
  assertLessThan(
    seen[firstSlack]?.tick ?? 0,
    after[after.length - 1]?.tick ?? 0,
    "the tick it went slack against the tick it was taut again on",
  );
});
