// simulation/solve-order-arm-before-ring — a collapse in the arm is reported
// before a ring overload.
//
// `specs/statics.md` § The two solves fixes the order and what it settles: "The
// two solves and the ring check run in a fixed order, and the first of them to
// fail ends the run: the arm solve, whose singularity is a `collapse`; then the
// ring check on the arm's reactions, whose excess is a `ring-overload`; then the
// tower solve, whose singularity is a `collapse`."
//
// So the scenario has to be a crane that would fail BOTH ways, and the check has
// to establish the ring half of that from the build itself rather than from this
// file's arithmetic. It does it with two poses of one crane:
//
//   1. The crane as designed, its arm rigid and four counterweights out on the
//      jib. One tick ends the run as `ring-overload`: this build, solving this
//      arm under this loading, finds a corner past `RING_CAP`.
//   2. The same crane with three members gone — `(8, 4, 0)`-`(8, 4, 2)`,
//      `(4, 4, 2)`-`(8, 4, 0)` and the cross stay to `(8, 4, 0)` — which leaves
//      the jib tip held by members lying in one plane and free to swing out of
//      it. That is a mechanism, "a flat frame with nothing resisting
//      out-of-plane motion", and the arm solve is singular.
//
// The three members carry a few tens of mass units between them against the four
// counterweights' `320`, so the loading the ring corners see is the same loading
// to within a percent. The arm solve runs first, so the verdict is `collapse`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

/** Four counterweights out on the jib: enough to take a ring corner past its cap. */
const COUNTERWEIGHTS: CraneDesign["counterweights"] = [
  [8, 4, 0],
  [8, 4, 2],
  [4, 4, 0],
  [4, 4, 2],
];

/**
 * The tip's out-of-plane bracing: the cross member to its `z = 2` partner, the
 * horizontal diagonal that reaches it, and the cross stay from the far mast head.
 * Without them every member at `(8, 4, 0)` lies in the `z = 0` plane.
 */
const TIP_BRACING = new Set([37, 39, 51]);

const BRACED: CraneDesign = {
  site: 6,
  name: "Loaded jib",
  ring: [0, 2, 0],
  counterweights: COUNTERWEIGHTS,
  members: MEMBERS,
  tape: [],
};

const UNBRACED: CraneDesign = {
  ...BRACED,
  name: "Loaded jib, tip unbraced",
  members: MEMBERS.filter((_, index) => !TIP_BRACING.has(index)),
};

/**
 * A tape that turns the grip and nothing else.
 *
 * `specs/rigging.md`: "Turning the grip applies no force to anything." So the
 * crane stands exactly as the static check reads it, tick after tick, and the
 * only thing that decides the run is the pair of solves.
 */
const GRIP_TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 3600, rate: 45 }] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends as collapse when the arm is a mechanism a ring overload would also fail", async () => {
  await openSite(h, 5);
  await clearAll(h);

  // What the ring does under this loading, read off the build.
  await poseCrane(h, BRACED);
  await poseTape(h, GRIP_TAPE);
  await startRun(h);
  const braced = await runTicks(h, 1);
  assertEqual(
    braced.run.cause,
    "ring-overload",
    "the cause of the crane whose arm is rigid: a ring corner past RING_CAP",
  );

  // The same crane, its jib tip left to swing out of plane.
  // Opening the site again puts the run back to its idle placeholder, so the
  // second crane starts from the same standing state the first one did.
  await openSite(h, 5);
  await clearAll(h);
  await poseCrane(h, UNBRACED);
  await poseTape(h, GRIP_TAPE);
  await startRun(h);
  const unbraced = await runTicks(h, 1);
  await h.capture(
    "solve-order-arm-before-ring",
    "the crane whose arm went singular before the ring was checked",
  );

  assertEqual(
    unbraced.run.phase,
    "failed",
    "the phase after one tick of the crane whose arm is a mechanism",
  );
  assertEqual(
    unbraced.run.cause,
    "collapse",
    "the cause: the arm solve runs before the ring check, so its singularity " +
      "ends the run first (specs/statics.md)",
  );
});
