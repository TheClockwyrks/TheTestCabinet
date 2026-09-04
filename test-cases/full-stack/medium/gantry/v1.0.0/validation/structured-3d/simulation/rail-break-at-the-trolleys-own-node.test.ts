// simulation/rail-break-at-the-trolleys-own-node — the trolley standing exactly
// at the inner end of the rail that breaks is on that rail.
//
// `specs/statics.md` § Utilization and breakage: "A rail member breaking can take
// the track out from under the trolley, which ends the run as `collapse`. It does
// so in two cases: the trolley is on the broken member or beyond it, its position
// AT or past that member's end nearer the track origin". `specs/structure.md`
// settles what "on" means: "The trolley is on a rail member when its position lies
// between that member's two ends along the track, BOTH ENDS INCLUDED, so at a node
// two rail members share it is on both."
//
// So the knife edge is a trolley standing exactly on the node the middle and the
// outer rails share, and this crane is built to sit on it. Its track is three
// rails from `(0, 4, 0)` out to `(10, 4, 0)` — two of two units, then one of six —
// and the outer one is the crane's weakest member by a long way: a rail's
// compression capacity falls with length as `min(1, (BUCKLE_REF / L)^2)`
// (`specs/structure.md`), so at six units it bears under half of what the short
// ones do, while the counterweight on the jib tip drives the whole track's thrust
// through it. It is the only member the first solve finds over `1`.
//
// WHAT MAKES THE READING DECISIVE IS WHAT ELSE DOES NOT BREAK. The run ends on the
// breaking tick, so the passes stop there and the run's broken list holds that rail
// ALONE — "Repeat until a pass breaks nothing or a pass fails." A build that did
// not find the trolley on the broken rail carries on into the next pass instead,
// which on this crane takes several more members with it; its broken list is
// longer, whatever it decides afterwards.
//
// The trolley is posed rather than driven to, since `setAxis` "sets an axis's
// value" and one tick at that value is the whole of the reading.

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
 * A counterbalanced crane whose track is three rails, on site 6 (Heavy Haul) for
 * its nine anchors, its `6000` budget and the reach its envelope allows.
 *
 * Ids run in the order the members are listed, which is the order `poseCrane`
 * places them (`specs/instrumentation.md`).
 *
 *   - `0`-`21`  the tower, braced from every anchor the site gives.
 *   - `22`-`30` the mast: heads at `(0, 6, 0)` and `(0, 6, 2)` tied to all four
 *               top-flange nodes.
 *   - `31`-`33` THE TRACK: `(0, 4, 0)`-`(2, 4, 0)`, `(2, 4, 0)`-`(4, 4, 0)`, and
 *               `(4, 4, 0)`-`(10, 4, 0)`. The middle and the outer share
 *               `(4, 4, 0)`, four units along the track from its origin.
 *   - `34`      a strut beside the two inner rails, so the mast's own thrust has
 *               a path to the flange that is not through them.
 *   - `35`-`68` the jib: its `z = 2` chord, the cross members, and the king posts
 *               at `(4, 8, 0)`, `(6, 6, 0)` and `(8, 6, 0)` that hold the tip up
 *               once the outer rail is gone.
 *   - `69`-`77` the tail, counterbalancing the jib so the mast is nowhere near
 *               its own capacity.
 *   - `78`-`83` the stays.
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
  /* 31 */ [[0, 4, 0], [2, 4, 0], "rail"],
  /* 32 */ [[2, 4, 0], [4, 4, 0], "rail"],
  /* 33 */ [[4, 4, 0], [10, 4, 0], "rail"],
  /* 34 */ [[0, 4, 0], [4, 4, 0], "strut"],
  /* 35 */ [[0, 4, 2], [4, 4, 2], "strut"],
  /* 36 */ [[4, 4, 2], [8, 4, 2], "strut"],
  /* 37 */ [[8, 4, 2], [10, 4, 2], "strut"],
  /* 38 */ [[0, 4, 0], [0, 4, 2], "strut"],
  /* 39 */ [[4, 4, 0], [4, 4, 2], "strut"],
  /* 40 */ [[10, 4, 0], [10, 4, 2], "strut"],
  /* 41 */ [[0, 4, 0], [4, 4, 2], "strut"],
  /* 42 */ [[2, 4, 0], [4, 4, 2], "strut"],
  /* 43 */ [[2, 4, 2], [4, 4, 2], "strut"],
  /* 44 */ [[2, 4, 2], [4, 4, 0], "strut"],
  /* 45 */ [[0, 4, 2], [4, 4, 0], "strut"],
  /* 46 */ [[8, 4, 2], [4, 4, 0], "strut"],
  /* 47 */ [[8, 4, 2], [10, 4, 0], "strut"],
  /* 48 */ [[4, 4, 2], [10, 4, 2], "strut"],
  /* 49 */ [[4, 4, 0], [4, 8, 0], "strut"],
  /* 50 */ [[4, 4, 2], [4, 8, 0], "strut"],
  /* 51 */ [[0, 6, 0], [4, 8, 0], "strut"],
  /* 52 */ [[0, 6, 2], [4, 8, 0], "strut"],
  /* 53 */ [[2, 4, 0], [4, 8, 0], "strut"],
  /* 54 */ [[2, 4, 2], [4, 8, 0], "strut"],
  /* 55 */ [[4, 8, 0], [6, 6, 0], "strut"],
  /* 56 */ [[4, 8, 0], [8, 6, 0], "strut"],
  /* 57 */ [[4, 4, 0], [6, 6, 0], "strut"],
  /* 58 */ [[4, 4, 2], [6, 6, 0], "strut"],
  /* 59 */ [[2, 4, 0], [6, 6, 0], "strut"],
  /* 60 */ [[2, 4, 2], [6, 6, 0], "strut"],
  /* 61 */ [[6, 6, 0], [10, 4, 0], "strut"],
  /* 62 */ [[6, 6, 0], [10, 4, 2], "strut"],
  /* 63 */ [[6, 6, 0], [8, 4, 2], "strut"],
  /* 64 */ [[6, 6, 0], [8, 6, 0], "strut"],
  /* 65 */ [[8, 4, 2], [8, 6, 0], "strut"],
  /* 66 */ [[4, 4, 0], [8, 6, 0], "strut"],
  /* 67 */ [[4, 4, 2], [8, 6, 0], "strut"],
  /* 68 */ [[8, 6, 0], [10, 4, 0], "strut"],
  /* 69 */ [[8, 6, 0], [10, 4, 2], "strut"],
  /* 70 */ [[0, 4, 0], [-4, 4, 0], "strut"],
  /* 71 */ [[0, 4, 2], [-4, 4, 2], "strut"],
  /* 72 */ [[-4, 4, 0], [-4, 4, 2], "strut"],
  /* 73 */ [[0, 4, 0], [-4, 4, 2], "strut"],
  /* 74 */ [[-4, 4, 0], [0, 4, 2], "strut"],
  /* 75 */ [[0, 6, 0], [-4, 4, 0], "strut"],
  /* 76 */ [[0, 6, 2], [-4, 4, 2], "strut"],
  /* 77 */ [[0, 6, 0], [-4, 4, 2], "strut"],
  /* 78 */ [[0, 6, 2], [-4, 4, 0], "strut"],
  /* 79 */ [[0, 6, 2], [4, 4, 2], "strut"],
  /* 80 */ [[0, 6, 0], [6, 6, 0], "cable"],
  /* 81 */ [[0, 6, 2], [6, 6, 0], "cable"],
  /* 82 */ [[4, 8, 0], [10, 4, 0], "cable"],
  /* 83 */ [[4, 8, 0], [10, 4, 2], "cable"],
];

const CRANE: CraneDesign = {
  site: 6,
  name: "Three-rail track",
  ring: [0, 2, 0],
  counterweights: [
    [10, 4, 0],
    [-4, 4, 0],
    [-4, 4, 2],
  ],
  members: MEMBERS,
  tape: [],
};

/** The outer rail, and the only member the crane's solve finds over 1. */
const OUTER_RAIL = 33;

/**
 * Where the trolley stands: the distance along the track of `(4, 4, 0)`, the node
 * the middle and the outer rails share, which is the outer rail's end nearer the
 * origin.
 */
const SHARED_NODE = 4;

/** The grip turns and applies no force, so nothing but the solve decides. */
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

it("ends the run as collapse when the rail under the trolley's own node breaks", async () => {
  await openSite(h, 5);
  await clearAll(h);
  await poseCrane(h, CRANE);

  // The outer rail is the one over capacity, and it is the only one.
  const check = await h.check();
  assertTrue(check.stable, "the crane stands, so its members are solved for");
  assertDeepEqual(
    check.members.filter((one) => one.utilization > 1).map((one) => one.id),
    [OUTER_RAIL],
    "the members the solve finds above utilization 1",
  );

  await poseTape(h, GRIP_TAPE);
  await startRun(h);
  await h.debug.setAxis("trolley", SHARED_NODE);
  const after = await runTicks(h, 1);
  await h.capture(
    "rail-break-at-the-trolleys-own-node",
    "the crane whose track broke out from under the trolley",
  );

  assertEqual(
    after.run.axes.trolley.value,
    SHARED_NODE,
    "where the trolley stood: the outer rail's end nearer the track origin, " +
      "which both ends of a rail count as being on (specs/structure.md)",
  );
  assertEqual(after.run.tick, 1, "the ticks the run has taken");
  assertEqual(
    after.run.phase,
    "failed",
    "the phase on the tick the outer rail broke",
  );
  assertEqual(
    after.run.cause,
    "collapse",
    "the cause: the break took the track out from under the trolley " +
      "(specs/statics.md)",
  );
  assertDeepEqual(
    after.run.broken,
    [OUTER_RAIL],
    "the members the tick removed: the outer rail alone, because the run ends " +
      "at that break rather than passing on to another solve",
  );
  assertLength(
    after.run.broken,
    1,
    "the members broken, against the several a further pass would have taken",
  );
});
