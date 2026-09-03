// check/check-readiness-issue-reports-no-member — a crane with a readiness issue
// reports no member.
//
// specs/structure.md § The static check: "With any readiness issue the structure
// is not solved ... and it reports no member at all: the member list is empty
// exactly when the structure does not stand."
//
// The readiness issue is raised by `clearRing`, which is the one edit that can
// never be refused ("Removing a member, the ring, or a counterweight is always
// allowed") and leaves every member standing. That separation is what this point
// needs: the crane still HOLDS every member, so an empty `members` is the check
// withholding the solve rather than the structure having lost anything —
// `snapshot().structure.members` is read in the same breath to say so.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertGreaterThan } from "../assert";
import {
  MINIMAL_CRANE,
  createHarness,
  emptyYard,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

const SITE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports an empty member list while the crane still holds every member", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);

  const solved = await h.check();
  assertGreaterThan(
    solved.members.length,
    0,
    "the members the check reports before the ring goes, so the empty list " +
      "below is the readiness issue's doing (specs/structure.md)",
  );

  await h.debug.clearRing();
  const refused = await h.check();
  const { structure } = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "issues-members-structure-members",
    "issues, members, structure.members.",
  );

  assertContains(
    refused.issues,
    "no-ring",
    "the readiness issue a crane with no slew ring raises " +
      "(specs/structure.md § Readiness)",
  );
  assertEqual(
    refused.members.length,
    0,
    "the members a check reports for a structure a readiness issue left " +
      "unsolved (specs/structure.md § The static check)",
  );
  assertEqual(
    structure.members.length,
    MINIMAL_CRANE.members.length,
    "the members the crane still holds, which removing the ring did not touch",
  );
});
