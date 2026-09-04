// simulation/broken-list-in-id-order — the members that break join the run's
// list in ascending member-id order.
//
// `specs/statics.md` § Utilization and breakage: "they join the run's list of
// broken members in ascending member-id order."
//
// A list of three that a build happened to append in the order it found them, or
// in the order they were worst overloaded, would be indistinguishable from the
// required one unless the scenario makes those orders disagree. This crane's three
// over-utilized members are `23`, `27` and `34`, and their utilizations do NOT
// descend with their ids: `27` is the worst of the three, then `23`, then `34`.
// So a build that appended by severity would answer `27, 34, 23`, and a build that
// appended in whatever order its member list happened to reach them would answer
// something else again.
//
// The crane is loaded with counterweights rather than a lifted load, so `check()`
// — which "reports and no more" (`specs/structure.md`) — reads the same solve the
// run's first tick breaks on, and the three can be named before the run starts.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
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
  name: "Three over capacity",
  ring: [0, 2, 0],
  counterweights: [
    [8, 4, 2],
    [4, 4, 0],
    [4, 4, 2],
  ],
  members: MEMBERS,
  tape: [],
};

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

it("lists the members that broke in ascending id order", async () => {
  await openSite(h, 5);
  await clearAll(h);
  await poseCrane(h, CRANE);

  const check = await h.check();
  assertTrue(check.stable, "the crane stands, so its members are solved for");
  const over = check.members
    .filter((one) => one.utilization > 1)
    .sort((a, b) => b.utilization - a.utilization);
  assertLength(over, 3, "the members above utilization 1");

  await poseTape(h, GRIP_TAPE);
  await startRun(h);
  const after = await runTicks(h, 1);
  await h.capture(
    "broken-list-in-id-order",
    "the crane whose three members broke together",
  );

  assertEqual(after.run.tick, 1, "the ticks the run has taken");
  assertDeepEqual(
    after.run.broken,
    [...after.run.broken].sort((a, b) => a - b),
    "the run's broken list, which the specification puts in ascending " +
      "member-id order — and which the severity order " +
      `(${over.map((one) => one.id).join(", ")}) is not`,
  );
  assertLength(after.run.broken, 3, "the members that broke");
});
