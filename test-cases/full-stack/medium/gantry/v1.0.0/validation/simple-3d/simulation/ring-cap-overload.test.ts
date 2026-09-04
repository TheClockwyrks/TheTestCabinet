// simulation/ring-cap-overload — a corner force above RING_CAP ends the run as
// `ring-overload`.
//
// specs/statics.md, The two solves: "Each corner carries the reaction at its
// top-flange node down to its bottom-flange node, so the force at a corner's two
// flange connections has one magnitude. That magnitude is checked against
// `RING_CAP` at each of the four corners: it stays at or below it, and a tick on
// which one exceeds it ends the run as `ring-overload`." `specs/structure.md`
// gives the figure: "each of its eight flange connections carries force up to
// `RING_CAP` (`6000`)".
//
// The overload is made out of counterweights hung along the jib, at `x` of 4, 6
// and 8 against a flange square spanning `x` 0 to 2. Weight out on a lever is
// what a ring is for, and three lots of `COUNTERWEIGHT_MASS` that far out drive
// the reaction at the loaded corner comfortably past `6000` while every member of
// the crane is still well inside its own capacity — so the run cannot end for any
// other reason, and the first tick is enough.
//
// The tick reaches the ring check through the arm solve, which is regular here,
// and it never reaches the tower solve or breakage: `specs/statics.md` fixes that
// order, and `ring-overload` is the cause it names.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
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

it("ends the run as ring-overload when a corner exceeds RING_CAP", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await poseCrane(h, RIG);
  for (const node of WEIGHTED) {
    await h.debug.addCounterweight(node[0], node[1], node[2]);
  }
  await poseTape(h, HOLD);

  await startRun(h);
  const s = await runTicks(h, 1);
  await h.capture(
    "ring-overload",
    "the run the overloaded slew ring ended on its first tick",
  );

  assertEqual(
    s.run.phase,
    "failed",
    "the run's phase on the tick a corner exceeded RING_CAP " +
      "(specs/statics.md)",
  );
  assertEqual(
    s.run.cause,
    "ring-overload",
    "the cause the run carries (specs/statics.md)",
  );
});
