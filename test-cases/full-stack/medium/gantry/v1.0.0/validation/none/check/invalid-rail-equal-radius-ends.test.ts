// check/invalid-rail-equal-radius-ends — a track whose two ends stand the same
// distance from the slew axis raises `invalid-rail`.
//
// specs/structure.md § The trolley and the rail, the last of the four track
// rules: "The track's two end nodes lie at distinct horizontal distances from
// the slew axis." The rule exists because of the sentence after it — "The end
// nearer the slew axis is the track's origin" — so a track with no nearer end
// has no origin for the trolley to start at. § Readiness: "`invalid-rail` — The
// crane has a ring and rail members, and they break one of the track rules
// above."
//
// The scenario breaks THAT rule and no other. The ring's base corner is
// `(0, 2, 0)`, so its slew axis is the vertical line through `(1, ·, 1)`
// (§ The slew ring: "the vertical line through the flange square's center,
// `(x + LATTICE_PITCH / 2, y, z + LATTICE_PITCH / 2)`"). Three rails then run
// along the line `y = 4, z = 0` from `(-2, 4, 0)` to `(4, 4, 0)`, over the two
// top-flange nodes between them. Every other rule holds: all three are
// horizontal, all three are collinear, they meet end to end over four nodes with
// no overlap and no gap, and every one of them is in the arm, two of their nodes
// being top-flange nodes and the rest reached through the rails themselves. Only
// the ends are equidistant — `sqrt((-2 - 1)^2 + (0 - 1)^2)` and
// `sqrt((4 - 1)^2 + (0 - 1)^2)` are both `sqrt(10)`.
//
// The tower under the ring is the minimal crane's, which reaches only the bottom
// flange, so nothing here is disconnected and no member joins the arm to the
// tower outside the ring.

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

/**
 * A ring at `(0, 2, 0)` — slew axis through `(1, ·, 1)` — and a three-rail track
 * along `y = 4, z = 0` from `x = -2` to `x = 4`, symmetric about the axis.
 */
const SYMMETRIC_TRACK: CraneDesign = {
  site: 0,
  name: "Symmetric track",
  ring: [0, 2, 0],
  counterweights: [],
  members: [
    ...TOWER,
    [[-2, 4, 0], [0, 4, 0], "rail"],
    [[0, 4, 0], [2, 4, 0], "rail"],
    [[2, 4, 0], [4, 4, 0], "rail"],
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

it("raises invalid-rail for a track laid symmetrically across the slew axis", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, SYMMETRIC_TRACK);

  const { issues } = await h.check();

  await h.advance(1);
  await h.capture(
    "state",
    "a track whose two ends stand the same distance from the slew axis",
  );

  assertContains(
    issues,
    "invalid-rail",
    "the issue a track whose two end nodes lie at equal horizontal distances " +
      "from the slew axis raises (specs/structure.md § The trolley and the rail)",
  );
});
