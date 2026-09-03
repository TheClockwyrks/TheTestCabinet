// simulation/solve-order-ring-before-tower — a ring overload is reported before
// a tower collapse.
//
// `specs/statics.md` § The two solves: "the arm solve, whose singularity is a
// `collapse`; then the ring check on the arm's reactions, whose excess is a
// `ring-overload`; then the tower solve, whose singularity is a `collapse`."
//
// The middle of those three is what this decides, so the crane has to fail at
// both the ring check and the tower solve and the check has to establish each of
// them from the build. The tower here is stripped of every inclined anchor brace:
// what is left is four vertical legs and a flange square, which carries no
// horizontal stiffness at all, so the tower is a mechanism however light the
// crane is. That is read off the build first — the same crane with nothing on the
// jib ends its first tick as `collapse`. Loading the jib with four counterweights
// then takes a ring corner past `RING_CAP`, and NOTHING about the tower changes:
// the ring reactions come from the arm solve alone, which the tower's bracing
// never enters.
//
// So the second run must read `ring-overload`. A build that ran the tower solve
// first, or that checked the ring after it, reads `collapse` instead.

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

/**
 * The tower's inclined anchor braces, ids `10` through `21` of the list above.
 * A tower without them stands on four vertical legs and a flange square: every
 * member at a bottom-flange node is either vertical or horizontal, so nothing
 * resists the square sliding sideways and the tower solve is singular.
 */
const ANCHOR_BRACES = (index: number): boolean => index >= 10 && index <= 21;

const UNDER_BRACED: CraneDesign["members"] = MEMBERS.filter(
  (_, index) => !ANCHOR_BRACES(index),
);

const BARE: CraneDesign = {
  site: 6,
  name: "Under-braced tower",
  ring: [0, 2, 0],
  counterweights: [],
  members: UNDER_BRACED,
  tape: [],
};

const LOADED: CraneDesign = {
  ...BARE,
  name: "Under-braced tower, loaded jib",
  counterweights: [
    [8, 4, 0],
    [8, 4, 2],
    [4, 4, 0],
    [4, 4, 2],
  ],
};

/** The grip turns and applies no force, so nothing but the solves decides. */
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

it("ends as ring-overload when the tower is also a mechanism", async () => {
  await openSite(h, 5);
  await clearAll(h);

  // What the tower does on its own, read off the build: a mechanism, and a
  // collapse, with nothing on the jib to trouble the ring.
  await poseCrane(h, BARE);
  await poseTape(h, GRIP_TAPE);
  await startRun(h);
  const bare = await runTicks(h, 1);
  assertEqual(
    bare.run.cause,
    "collapse",
    "the cause with the jib unloaded: the tower solve is singular",
  );

  // Now load the jib. The tower is untouched — it is still that same mechanism —
  // and the arm's reactions now exceed RING_CAP at a corner.
  // Opening the site again puts the run back to its idle placeholder.
  await openSite(h, 5);
  await clearAll(h);
  await poseCrane(h, LOADED);
  await poseTape(h, GRIP_TAPE);
  await startRun(h);
  const loaded = await runTicks(h, 1);
  await h.capture(
    "solve-order-ring-before-tower",
    "the crane whose ring gave way before its tower was solved",
  );

  assertEqual(
    loaded.run.phase,
    "failed",
    "the phase after one tick of the loaded crane",
  );
  assertEqual(
    loaded.run.cause,
    "ring-overload",
    "the cause: the ring check on the arm's reactions runs before the tower " +
      "solve, so the overload is reported and the tower is never reached " +
      "(specs/statics.md)",
  );
});
