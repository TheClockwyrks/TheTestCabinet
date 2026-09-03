// simulation/ring-cap-not-checked-by-the-static-check — the static check's verdict
// is whether both solves are regular; the ring check belongs to the run.
//
// specs/structure.md, The static check: "the two solves of `specs/statics.md` run
// at the run-start posture... and the structure stands when both solves are
// regular", and "Nothing breaks and nothing fails during a check: a utilization
// above `1` is reported and no more." `specs/statics.md` puts the ring check
// inside the tick pipeline instead, between the arm solve and the tower solve.
//
// The crane is the one the ring-overload item uses: counterweights hung along the
// jib far enough out to drive one corner's reaction past `RING_CAP`. The check
// must be untroubled by it — no issue, the structure stands, and every intact
// member reported — and the run started straight afterwards must fail as
// `ring-overload`, which is what shows the corner really was over the cap while
// the check was reporting that the crane stands.
//
// Reading both is the requirement: without the run the check's silence could mean
// the corner was never over the cap at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  emptyYard,
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

/** The jib nodes the counterweights hang on. */
const WEIGHTED = [
  [4, 6, 0],
  [6, 6, 0],
  [8, 6, 0],
] as const;

/** A tape with one step, which the first tick takes and finds arrived. */
const HOLD: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports that a crane whose corner is over RING_CAP stands", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await emptyYard(h);
  await poseCrane(h, RIG);
  for (const node of WEIGHTED) {
    await h.debug.addCounterweight(node[0], node[1], node[2]);
  }
  await poseTape(h, HOLD);

  const result = await h.check();
  await h.capture(
    "check-over-the-cap",
    "the static check of a crane whose ring corner is over RING_CAP",
  );
  assertLength(
    result.issues,
    0,
    "the issues of a ready crane with a tape (specs/structure.md)",
  );
  assertTrue(
    result.stable,
    "the crane to stand: the check's verdict is whether both solves are " +
      "regular, and the ring check is the run's (specs/structure.md)",
  );
  assertLength(
    result.members,
    RIG.members.length,
    "the members a standing structure reports (specs/structure.md)",
  );

  // And the corner really was over the cap: the run says so on its first tick.
  await startRun(h);
  const s = await runTicks(h, 1);
  assertEqual(
    s.run.phase,
    "failed",
    "the phase of the run started on that same crane (specs/statics.md)",
  );
  assertEqual(
    s.run.cause,
    "ring-overload",
    "the cause the run carries, which is what the check did not test " +
      "(specs/statics.md)",
  );
});
