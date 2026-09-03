// check/invalid-rail-not-collinear — rails that run on two different lines raise
// `invalid-rail`.
//
// specs/structure.md § The trolley and the rail, the second track rule: "All
// rail members are collinear, along one line". § Readiness: "`invalid-rail` —
// The crane has a ring and rail members, and they break one of the track rules
// above."
//
// The scenario breaks collinearity and leaves the rest of the rules as sound as
// two rails on two lines can leave them: both rails are horizontal at `y = 4`,
// both are in the arm — each runs between two top-flange nodes of the ring at
// `(0, 2, 0)` — and neither overlaps the other. They simply lie on two parallel
// lines, one at `z = 0` and one at `z = 2`, so there is no single line for them
// to cover and no single track for the trolley to run on.
//
// The tower under the ring is the minimal crane's, which reaches only the bottom
// flange, so nothing is disconnected and no member joins the arm to the tower
// outside the ring.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type Harness,
} from "../harness";

/** The minimal crane's braced tower: every member of it ends at or below `y = 2`. */
const TOWER: readonly DesignMember[] = MINIMAL_CRANE.members.filter(
  ([a, b]) => a[1] <= 2 && b[1] <= 2,
);

/** A ring at `(0, 2, 0)` carrying two rails on the parallel lines `z = 0` and `z = 2`. */
const TWO_LINES: CraneDesign = {
  site: 0,
  name: "Two rail lines",
  ring: [0, 2, 0],
  counterweights: [],
  members: [
    ...TOWER,
    [[0, 4, 0], [2, 4, 0], "rail"],
    [[0, 4, 2], [2, 4, 2], "rail"],
  ],
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises invalid-rail for two rails lying on two different lines", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, TWO_LINES);

  const { issues } = await h.check();

  await h.advance(1);
  await h.capture("state", "two rails lying on two parallel lines");

  assertContains(
    issues,
    "invalid-rail",
    "the issue rails that are not collinear raise (specs/structure.md " +
      "§ The trolley and the rail)",
  );
});
