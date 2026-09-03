// tape/track-origin-is-the-end-nearer-the-slew-axis — the trolley measures from
// the end of the track nearer the slew axis, whichever order the rails went down
// in.
//
// `specs/structure.md` § The trolley and the rail: "The end nearer the slew axis
// is the track's origin. The trolley's position is its distance along the track
// from that origin, from `0` to the track's length, and the trolley begins every
// run at `0`." `specs/program.md` § The axes gives the `trolley` row the same
// value: "distance along the track from its origin".
//
// THE READING IS THE PIVOT. `specs/rigging.md`: "The hoist cable hangs from the
// pivot: the trolley point, on the rail track at the trolley's position, rotated
// with the arm", and `specs/state.md` has a run's start leave `pivot` at "the
// trolley point that posture puts under the cable". At slew `0` the arm stands at
// its lattice positions, so the pivot a run starts with is the track's origin node
// itself and the reading needs no tick and no tolerance beyond arithmetic.
//
// THE TRACK IS TWO RAILS, POSED BOTH WAYS ROUND. The origin is a fact about the
// geometry and not about the editor's history, so the same track is built outer
// rail first and then inner rail first, and both must answer the same end. A build
// that took the first rail placed, or the first end node it stored, for the origin
// passes one order and fails the other.
//
// THE CRANE IS THE HARNESS'S MINIMAL ONE WITH ITS SINGLE RAIL SPLIT IN TWO at the
// top-flange node between its ends, so the track runs `(0, 4, 0)` to `(4, 4, 0)`
// over two rails meeting at `(2, 4, 0)`. With the ring's base corner at
// `(0, 2, 0)` the slew axis stands at `x = 1, z = 1` (`specs/structure.md`), so the
// two ends lie `sqrt(2)` and `sqrt(10)` from it: distinct, as the track rules
// require, and the nearer of them is `(0, 4, 0)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertVec3Near, assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
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

/** The two rails the minimal crane's single rail is split into. */
const INNER: DesignMember = [[0, 4, 0], [2, 4, 0], "rail"];
const OUTER: DesignMember = [[2, 4, 0], [4, 4, 0], "rail"];

/** The track's two end nodes, and the one nearer the slew axis at (1, ., 1). */
const ORIGIN_END = { x: 0, y: 4, z: 0 };
const FAR_END = { x: 4, y: 4, z: 0 };

/** The track's length: the two rails end to end. */
const TRACK_LENGTH = 4;

/** Lattice arithmetic, so the pivot is the node itself; this is slack. */
const TOL = 1e-6;

/** A hoist move, so a run has a tape to start on. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

/** The minimal crane with its rail replaced by the two, in the order given. */
function splitRail(rails: readonly DesignMember[]): CraneDesign {
  const rest = MINIMAL_CRANE.members.filter(
    ([, , material]) => material !== "rail",
  );
  return { ...MINIMAL_CRANE, members: [...rest, ...rails] };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("measures the trolley from the end nearer the slew axis, either rail order", async () => {
  for (const [order, rails] of [
    ["outer rail first", [OUTER, INNER]],
    ["inner rail first", [INNER, OUTER]],
  ] as const) {
    await openSite(h, 0);
    await clearAll(h);
    await poseCrane(h, splitRail(rails));
    await poseTape(h, TAPE);

    const started = await startRun(h);
    assertEqual(
      started.run.axes.trolley.value,
      0,
      `${order}: the trolley's value a run starts at (specs/program.md)`,
    );
    assertVec3Near(
      started.run.pivot,
      ORIGIN_END,
      TOL,
      `${order}: the pivot at trolley 0, which stands at the track's origin, ` +
        "the end nearer the slew axis (specs/structure.md)",
    );

    if (order === "outer rail first") {
      await h.advance(1);
      await h.capture("origin-end", "The trolley at position 0");
    }

    await h.debug.setAxis("trolley", TRACK_LENGTH);
    const moved = await runTicks(h, 1);
    assertVec3Near(
      moved.run.pivot,
      FAR_END,
      TOL,
      `${order}: the pivot at trolley ${TRACK_LENGTH}, the track's length, ` +
        "which stands at its far end (specs/structure.md)",
    );

    await h.debug.abortRun();
  }
});
