// check/check-solves-with-an-empty-tape — a ready structure is solved whether or
// not it has a tape.
//
// specs/structure.md § The static check: "A ready structure is solved whether or
// not it has a tape, so `empty-program` on its own still reports the forces and
// the verdict."
//
// So the scenario is the one place `empty-program` stands alone: a crane with no
// readiness issue at all and an empty tape. The check must not treat that lone
// issue as a reason to withhold the solve — `empty-program` is not a readiness
// issue (specs/structure.md § Readiness lists the four, and `empty-program` is
// not among them), and only a readiness issue refuses the solve.
//
// `members` is read against `snapshot().structure.members` rather than against a
// count of the design: the requirement is that the forces are reported for the
// crane that stands, and the build's own structure reading is what says how many
// members that is.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
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

it("reports the forces and the verdict with empty-program standing alone", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);

  const result = await h.check();
  const { structure } = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertDeepEqual(
    result.issues,
    ["empty-program"],
    "the issues of a ready crane with an empty tape (specs/structure.md)",
  );
  assertTrue(
    result.stable,
    "the verdict a ready structure is still given with an empty tape " +
      "(specs/structure.md § The static check)",
  );
  assertEqual(
    result.members.length,
    structure.members.length,
    "the members whose forces the check reports, one per member the crane " +
      "holds (specs/structure.md § The static check)",
  );
});
