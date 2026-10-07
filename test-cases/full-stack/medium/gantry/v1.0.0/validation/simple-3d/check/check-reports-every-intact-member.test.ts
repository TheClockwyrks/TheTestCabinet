// check/check-reports-every-intact-member — the check reports every intact member
// exactly once.
//
// specs/structure.md § The static check: the check reports "Each intact member's
// force and utilization, in member-id order". Every intact member, so the list is
// one entry per member the crane holds and no more.
//
// THE CRANE CARRIES THE TWO MEMBERS THAT ARE EASIEST TO LEAVE OUT. On top of the
// harness's minimal crane — struts and one rail — two cables are added, and
// neither of them carries any force:
//
//   - `(2, 4, 0)`–`(0, 4, 2)` runs between two TOP-FLANGE nodes, which are the
//     arm solve's supports (specs/statics.md § The two solves). Both ends are
//     held at zero displacement, so `N = (EA / L) * dot(u_q - u_p, n)` is
//     exactly zero however the arm is loaded.
//   - `(0, 0, 2)`–`(2, 2, 0)` runs from an anchor to a bottom-flange node the
//     tower's load pushes toward it, so the cable comes back in compression and
//     goes slack: "every cable whose force comes back negative goes slack,
//     leaves the system entirely, and carries zero force."
//
// A build that reported only the members its solve returned a force for would
// drop both. The assertion is on the IDS as a set, not on the count, so a list
// that repeated a member to reach the right length still fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
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

const SITE = 0;

/** The two cables the solve leaves carrying nothing. */
const FORCELESS: readonly DesignMember[] = [
  [[2, 4, 0], [0, 4, 2], "cable"],
  [[0, 0, 2], [2, 2, 0], "cable"],
];

const WITH_CABLES: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, with two cables that carry nothing",
  members: [...MINIMAL_CRANE.members, ...FORCELESS],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports one entry per member the crane holds, force-carrying or not", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, WITH_CABLES);

  const result = await h.check();
  const { structure } = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "members-ids-structure-members-ids",
    "members ids, structure.members ids.",
  );

  assertDeepEqual(
    [...result.members.map((one) => one.id)].sort((a, b) => a - b),
    [...structure.members.map((one) => one.id)].sort((a, b) => a - b),
    "the member ids the check reports, one per member the crane holds and no " +
      "more (specs/structure.md § The static check)",
  );
});
