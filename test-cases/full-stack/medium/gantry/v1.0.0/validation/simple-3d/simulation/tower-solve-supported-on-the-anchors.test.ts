// simulation/tower-solve-supported-on-the-anchors — the tower solve stands on
// the anchors, and they take whatever they are given.
//
// `specs/statics.md` § The two solves: "The tower solve. Nodes: the tower's, at
// their lattice positions. Supports: the anchor nodes." Nothing anywhere in the
// specification puts a limit on what a support may carry. The ring is the one
// connection in the crane that does have one — `RING_CAP` (`6000`) per flange
// connection — and that is what makes this readable: load the arm until the build
// itself says a ring corner is past its cap, and then ask whether the tower solve,
// carrying that same reaction down to the anchors, is regular.
//
// The two readings, both off the build:
//
//   1. One tick of a run ends as `ring-overload`. `specs/statics.md` gives that
//      cause exactly one meaning — "A ring connection exceeded `RING_CAP`" — so a
//      corner is carrying more than `6000`, and by "Each corner carries the
//      reaction at its top-flange node down to its bottom-flange node" the whole
//      of it is applied to the tower.
//   2. The static check of `specs/structure.md`, where "Nothing breaks and
//      nothing fails during a check", runs both solves over that same crane and
//      reports it STANDS. That verdict is the tower solve's as much as the arm's:
//      "the structure stands when both solves are regular". No cap, no failure,
//      no cause — the anchors simply take it.
//
// The four legs are read as the evidence that the load really did reach them: the
// compression and tension they carry between them comes to more than `RING_CAP`,
// which is more than any one connection in the crane is allowed to bear.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { RING_CAP } from "../constants";
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

const CRANE: CraneDesign = {
  site: 6,
  name: "Heavily loaded jib",
  ring: [0, 2, 0],
  counterweights: [
    [8, 4, 0],
    [8, 4, 2],
    [4, 4, 0],
    [4, 4, 2],
  ],
  members: MEMBERS,
  tape: [],
};

/** The four legs under the ring's bottom flange: ids `0` through `3`. */
const LEGS = [0, 1, 2, 3];

/** The grip turns and applies no force, so the run is the static crane ticking. */
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

it("solves the tower on its anchors under a reaction past every stated cap", async () => {
  await openSite(h, 5);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await poseTape(h, GRIP_TAPE);

  // How big the reaction crossing the ring is, in the build's own words.
  await startRun(h);
  const first = await runTicks(h, 1);
  assertEqual(
    first.run.cause,
    "ring-overload",
    `the cause after one tick: a ring connection past RING_CAP (${RING_CAP}), ` +
      "which is the whole of what that cause means (specs/statics.md)",
  );

  // The same crane read statically, where the ring cap is not a failure. Both
  // solves run, and the structure stands: the tower solve, supported on the
  // anchor nodes, is regular carrying that reaction to the ground.
  await openSite(h, 5);
  await clearAll(h);
  await poseCrane(h, CRANE);
  const check = await h.check();
  await h.capture(
    "tower-solve-supported-on-the-anchors",
    "the crane whose anchors carry more than the ring itself may",
  );

  assertLength(
    check.issues.filter((one) => one !== "empty-program"),
    0,
    "the crane's readiness issues",
  );
  assertTrue(
    check.stable,
    "the crane stands: both solves are regular, so the tower solve — supported " +
      "on the anchor nodes — carried the arm's reaction without limit " +
      "(specs/statics.md)",
  );
  assertLength(
    check.members,
    MEMBERS.length,
    "the members a standing structure reports a force for",
  );

  const carried = LEGS.reduce((total, id) => {
    const member = check.members.find((one) => one.id === id);
    if (member === undefined) {
      throw new Error(`gantry: check() reported no member ${id}`);
    }
    return total + Math.abs(member.force);
  }, 0);
  assertGreaterThan(
    carried,
    RING_CAP,
    "the force the four legs carry down to the anchors between them, against " +
      `RING_CAP (${RING_CAP}), the only support limit the specification states`,
  );
});
