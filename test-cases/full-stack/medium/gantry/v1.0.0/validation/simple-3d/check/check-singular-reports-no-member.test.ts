// check/check-singular-reports-no-member — a ready crane whose solve went
// singular reports no member.
//
// specs/structure.md § The static check: "A structure that is not solved does not
// stand, whether a readiness issue refused the solve or a solve went singular,
// and it reports no member at all". This point is the second half of that
// sentence — the half a readiness issue cannot reach.
//
// THE CRANE IS READY AND IS A MECHANISM. It is the harness's minimal crane less
// its last member, the strut from the mast top `(0, 8, 0)` to the rail tip
// `(4, 4, 0)`. That tie is the one member at the tip with a vertical component;
// without it every member reaching `(4, 4, 0)` — the rail from `(0, 4, 0)` and
// the two struts from `(0, 4, 2)` and `(2, 4, 2)` — lies in the `y = 4` plane, so
// the tip has no stiffness against falling and the arm solve is exactly the case
// specs/statics.md § Singularity names: "a flat frame with nothing resisting
// out-of-plane motion is a mechanism even though every member is sound."
//
// Removing it breaks no readiness rule: the ring stands, the single rail is
// untouched, and every member still has a path to a flange node. So `issues`
// carries no readiness issue at all and the empty member list can only be the
// singular solve.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
} from "../harness";

const SITE = 0;

/** The minimal crane less the one tie that holds the rail tip out of plane. */
const FLAT_TIP: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, less the rail tip's out-of-plane tie",
  members: MINIMAL_CRANE.members.slice(0, MINIMAL_CRANE.members.length - 1),
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports no member for a ready crane whose arm solve is singular", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, FLAT_TIP);

  const result = await h.check();
  const { structure } = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "issues-stable-members-structure-members",
    "issues, stable, members, structure.members.",
  );

  assertLength(
    result.issues.filter((issue) => issue !== "empty-program"),
    0,
    "the readiness issues of this crane, which has a ring, one valid rail, " +
      "and no disconnected member (specs/structure.md § Readiness)",
  );
  assertTrue(
    !result.stable,
    "the verdict on a mechanism, whose arm solve goes singular " +
      "(specs/statics.md § Singularity)",
  );
  assertLength(
    result.members,
    0,
    "the members a check reports for a structure a singular solve left " +
      "unsolved (specs/structure.md § The static check)",
  );
  assertEqual(
    structure.members.length,
    FLAT_TIP.members.length,
    "the members the crane still holds, none of which the solve removed",
  );
});
