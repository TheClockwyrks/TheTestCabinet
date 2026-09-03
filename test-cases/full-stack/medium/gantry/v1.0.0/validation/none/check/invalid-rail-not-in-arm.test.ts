// check/invalid-rail-not-in-arm — a track hung off the tower raises
// `invalid-rail`.
//
// specs/structure.md § The trolley and the rail, the third track rule: "Every
// rail member is in the arm." § The slew ring says which half of the crane that
// is: "Everything connected through intact members to the top flange is the arm
// and turns with the slew angle; everything connected to the bottom flange or to
// an anchor is the tower." § Readiness: "`invalid-rail` — The crane has a ring
// and rail members, and they break one of the track rules above."
//
// The scenario satisfies every other track rule and hangs the track off the
// TOWER. Two rails run end to end along `y = 2, z = 0` from the bottom-flange
// node `(2, 2, 0)` out to `(6, 2, 0)`: horizontal, collinear, meeting at the one
// node they share with no overlap and no gap, over three nodes, and with their
// two ends at `sqrt(2)` and `sqrt(26)` from the slew axis through `(1, ·, 1)`.
// The one thing wrong with them is which side of the ring they are on.
//
// The reading is taken in both directions on the one issue that could be
// confused with this one: `no-rail` is the row for "The crane has no rail
// members" (§ Readiness), and this crane has two, so a build that answered a
// track in the tower by reporting no track at all would be reporting something
// the crane does not say.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertTrue } from "../assert";
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

/** A ring at `(0, 2, 0)` with a sound two-rail track hung off its BOTTOM flange. */
const TRACK_IN_THE_TOWER: CraneDesign = {
  site: 0,
  name: "Track in the tower",
  ring: [0, 2, 0],
  counterweights: [],
  members: [
    ...TOWER,
    [[2, 2, 0], [4, 2, 0], "rail"],
    [[4, 2, 0], [6, 2, 0], "rail"],
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

it("raises invalid-rail for a sound track that hangs off the tower", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, TRACK_IN_THE_TOWER);

  const { issues } = await h.check();

  await h.advance(1);
  await h.capture(
    "issues-the-rail-members-ends-the-ring-corner",
    "a track hung off the ring's bottom flange rather than its top",
  );

  assertContains(
    issues,
    "invalid-rail",
    "the issue a rail member outside the arm raises (specs/structure.md " +
      "§ The trolley and the rail)",
  );
  assertTrue(
    !issues.includes("no-rail"),
    "no-rail absent, the crane carrying two rail members " +
      "(specs/structure.md § Readiness)",
  );
});
