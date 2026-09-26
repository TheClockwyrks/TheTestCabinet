// simulation/fallen-member-reports-zero-force — a member joined to neither solve
// is still listed, and reports zero force and zero utilization.
//
// specs/statics.md, The two solves: "A node that no intact member ends at and no
// flange puts there belongs to neither solve: a counterweight left on such a node
// applies nothing, and a member joined to neither the arm nor the tower carries
// no force and no weight. Both have fallen with what held it. Such a member is
// still intact, and it reports zero force and zero utilization wherever member
// forces are reported."
//
// A member ends up joined to neither solve only by breakage, and only when
// EVERYTHING holding its two nodes goes at once: a node an intact member still
// reaches is a node of its solve, and one holding fewer than three members leaves
// that solve singular. So the assembly below is a pair of nodes propped on six
// struts that are all past capacity on the same tick, which `specs/statics.md`
// removes together. The strut between the two nodes is not, so it survives the
// fall — intact, and joined to nothing.
//
// The reading is `run.forces` a few ticks after the fall. The member must still
// be there: `specs/state.md` reports the forces "over the members still intact",
// and this one is intact. It must report zero force and zero utilization, and it
// must not be among the run's broken members, which are the six props alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertTrue, fail } from "../assert";
import { HOIST_MAX_RATE } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/**
 * The rig every reading below is taken on, and why it is shaped this way.
 *
 * It is a plain crane, built under the rules of `specs/structure.md` alone, but
 * three of its nodes are arranged so that one member's force is fixed by a single
 * equation rather than by the whole solve, which is what lets a reading be
 * compared against a figure the specification states:
 *
 *   - The tower is the braced box from the four anchors to the ring's bottom
 *     flange at `(0, 4, 0)`. The bottom-flange corner `(0, 4, 0)` is reached by
 *     its vertical leg (id 0) and by horizontals alone, so vertical equilibrium
 *     there reads `N = F.y` on that leg and on nothing else.
 *   - The arm is a mast head at `(2, 10, 0)` tied to all four top-flange nodes, a
 *     spur node at `(4, 6, 2)`, and the track `(4, 6, 0)-(6, 6, 0)-(8, 6, 0)`.
 *   - Each of the three track nodes is hung from the mast by ONE cable — the only
 *     member at that node with a `y` component — and braced sideways by
 *     horizontals, one of which is the only member there with a `z` component. So
 *     the cable carries the whole vertical load lumped at its node, `V / |n.y|`,
 *     and the sideways brace the whole `z` load.
 *   - The track origin is `(4, 6, 0)`, the end nearer the slew axis, and it is an
 *     ordinary arm node carrying exactly one rail — so the rail's force follows
 *     from that node's `x` equilibrium once the other two are known.
 *
 * Every node lies inside the envelope of the site each reading opens, the crane
 * costs well under that site's budget, and `check` reports no issue and a
 * structure that stands.
 */
const RIG: CraneDesign = {
  site: 1,
  name: "Reference rig",
  ring: [0, 4, 0],
  counterweights: [],
  members: [
    // The tower: four legs, the bottom-flange square and one diagonal across it,
    // and one diagonal on each of the box's four sides.
    [[0, 0, 0], [0, 4, 0], "strut"],
    [[2, 0, 0], [2, 4, 0], "strut"],
    [[0, 0, 2], [0, 4, 2], "strut"],
    [[2, 0, 2], [2, 4, 2], "strut"],
    [[0, 4, 0], [2, 4, 0], "strut"],
    [[0, 4, 2], [2, 4, 2], "strut"],
    [[0, 4, 0], [0, 4, 2], "strut"],
    [[2, 4, 0], [2, 4, 2], "strut"],
    [[0, 4, 0], [2, 4, 2], "strut"],
    [[0, 0, 0], [2, 4, 0], "strut"],
    [[0, 0, 0], [0, 4, 2], "strut"],
    [[2, 0, 0], [2, 4, 2], "strut"],
    [[0, 0, 2], [2, 4, 2], "strut"],
    // The mast head, tied to all four top-flange nodes.
    [[2, 6, 0], [2, 10, 0], "strut"],
    [[0, 6, 0], [2, 10, 0], "strut"],
    [[2, 6, 2], [2, 10, 0], "strut"],
    [[0, 6, 2], [2, 10, 0], "strut"],
    // The spur node the outboard sideways braces run back to.
    [[2, 6, 2], [4, 6, 2], "strut"],
    [[2, 6, 0], [4, 6, 2], "strut"],
    [[2, 10, 0], [4, 6, 2], "strut"],
    // The track, and the cable and the sideways brace at each of its nodes.
    [[4, 6, 0], [6, 6, 0], "rail"],
    [[6, 6, 0], [8, 6, 0], "rail"],
    [[2, 10, 0], [4, 6, 0], "cable"],
    [[2, 6, 2], [4, 6, 0], "strut"],
    [[2, 10, 0], [6, 6, 0], "cable"],
    [[2, 6, 2], [6, 6, 0], "strut"],
    [[2, 10, 0], [8, 6, 0], "cable"],
    [[4, 6, 2], [8, 6, 0], "strut"],
    [[4, 6, 2], [6, 6, 0], "strut"],
  ],
  tape: [],
};

/**
 * A pair of outrigger nodes the crane sheds on its first tick, and the member
 * between them that survives the fall.
 *
 * Each node carries a counterweight and is propped on three struts down to three
 * of the site's anchors. Those three directions resolve the node's weight — one
 * `COUNTERWEIGHT_MASS` and its members' halves — into forces two and a half to
 * three times what a strut of that length bears, so all six props are past their
 * capacity on the first solve and `specs/statics.md` removes "all of them at
 * once". What is left is two nodes no intact member ends at, and the strut
 * between them, joined to neither the arm nor the tower.
 *
 * `(6, 2, -2)` is `(4, 2, -2)` moved by `(2, 0, 0)`, and so are its three
 * anchors, so the two nodes stand in identical surroundings under identical load
 * and the strut between them lies along the offset that relates them.
 *
 * The whole assembly meets the crane only at anchor nodes, which the tower solve
 * holds at zero displacement, so nothing it does reaches the crane's own members
 * either before the fall or after it. That is what lets a reading after the fall
 * be compared against the same crane with the assembly never built.
 */
const OUTRIGGER: readonly DesignMember[] = [
  [[0, 0, 0], [4, 2, -2], "strut"],
  [[0, 0, 2], [4, 2, -2], "strut"],
  [[2, 0, 2], [4, 2, -2], "strut"],
  [[2, 0, 0], [6, 2, -2], "strut"],
  [[2, 0, 2], [6, 2, -2], "strut"],
  [[4, 0, 2], [6, 2, -2], "strut"],
  [[4, 2, -2], [6, 2, -2], "strut"],
];

/** The rig with the outrigger built on it, and a counterweight on each node. */
const RIGGED: CraneDesign = {
  ...RIG,
  name: "Reference rig with the outrigger",
  counterweights: [
    [4, 2, -2],
    [6, 2, -2],
  ],
  members: [...RIG.members, ...OUTRIGGER],
};

/** The six props that hold the two nodes up. */
const PROPS = [29, 30, 31, 32, 33, 34];

/**
 * Heavy Haul, whose nine anchors carry the outrigger.
 *
 * The pair needs an anchor set that survives being moved by `(2, 0, 0)`, which
 * the three-by-three grid `specs/sites.md` gives this site and no other does.
 * The rig itself stands on the same four anchors it stands on anywhere.
 */
const SITE = 5;

/** A tape long enough that the run is still going when the reading is taken. */
const LIFT: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: 6, rate: HOIST_MAX_RATE }],
  },
];

/** The tick each reading is taken on, comfortably past the fall. */
const READING_TICK = 5;

/** The member between the two nodes, the one thing the fall leaves standing. */
const BETWEEN = 35;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lists a member joined to neither solve at zero force and zero utilization", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await poseCrane(h, RIGGED);
  await poseTape(h, LIFT);

  await startRun(h);
  const s = await runTicks(h, READING_TICK);
  await h.capture(
    "after-the-fall",
    "the run carrying on after the outrigger fell off it",
  );

  assertEqual(
    s.run.phase,
    "running",
    "the run's phase after the fall, which the crane it fell off survives " +
      "(specs/statics.md)",
  );
  for (const id of PROPS) {
    assertContains(
      s.run.broken,
      id,
      "the props the first tick broke, all of them past capacity together " +
        "(specs/statics.md)",
    );
  }
  assertTrue(
    !s.run.broken.includes(BETWEEN),
    "the member between the two fallen nodes to be among the broken: it never " +
      "exceeded its capacity (specs/statics.md)",
  );

  const fallen = s.run.forces.find((one) => one.id === BETWEEN);
  if (fallen === undefined) {
    fail(
      "the fallen member to be reported: it is still intact, so it stays in " +
        "the member list (specs/statics.md)",
      `run.forces carries ${s.run.forces.length} members and not this one`,
    );
  }
  assertEqual(
    fallen.force,
    0,
    "the force a member joined to neither solve reports (specs/statics.md)",
  );
  assertEqual(
    fallen.utilization,
    0,
    "the utilization it reports (specs/statics.md)",
  );
});
