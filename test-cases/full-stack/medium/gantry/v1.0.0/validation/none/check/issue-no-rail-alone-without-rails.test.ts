// check/issue-no-rail-alone-without-rails — a ringed crane with no rails raises
// `no-rail` and not `invalid-rail`.
//
// specs/structure.md § The trolley and the rail states this in as many words: "A
// crane that has a ring and no rail members raises `no-rail` alone, for the same
// reason from the other side: with no rails there is no track to judge, so no
// track rule is broken." § Readiness gives the two rows the sentence names:
// "`no-rail` — The crane has no rail members" and "`invalid-rail` — The crane
// has a ring and rail members, and they break one of the track rules above."
//
// The scenario is a crane with a ring and an arm that carries no rail at all:
// the minimal crane's braced tower, the ring on top of it, and the mast tied to
// all four top-flange nodes. There is an arm, so the crane is not a bare tower
// and a build that judged the track off the arm's members would have members to
// judge — and there are no rails, so it has no track. Nothing is disconnected,
// so the reading is about the two rail rows alone.

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

/** The mast, tied to all four top-flange nodes: an arm made entirely of struts. */
const MAST: readonly DesignMember[] = [
  [[0, 4, 0], [0, 8, 0], "strut"],
  [[2, 4, 0], [0, 8, 0], "strut"],
  [[0, 4, 2], [0, 8, 0], "strut"],
  [[2, 4, 2], [0, 8, 0], "strut"],
];

/** A ring, a tower, and an arm — and not one rail member anywhere. */
const RAILLESS: CraneDesign = {
  site: 0,
  name: "Railless",
  ring: [0, 2, 0],
  counterweights: [],
  members: [...TOWER, ...MAST],
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises no-rail without invalid-rail when there is no track to judge", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, RAILLESS);

  const { issues } = await h.check();

  await h.advance(1);
  await h.capture("state", "a ringed crane whose arm carries no rail member");

  assertContains(
    issues,
    "no-rail",
    "the issue a crane with no rail members raises (specs/structure.md " +
      "§ Readiness)",
  );
  assertTrue(
    !issues.includes("invalid-rail"),
    "invalid-rail absent, there being no track to judge and so no track rule " +
      "broken (specs/structure.md § The trolley and the rail)",
  );
});
