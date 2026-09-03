// check/issue-no-disconnected-on-an-empty-structure — an empty crane raises no
// `disconnected-members`.
//
// specs/structure.md § Readiness states the issue as a fact about a member:
// "`disconnected-members` — Some member belongs to neither the tower nor the arm:
// it has no member path to an anchor or to a flange node." A structure with no
// members at all has no such member, so the issue cannot be raised — and with no
// ring and no rails the only readiness rows left are `no-ring` and `no-rail`.
// `invalid-rail` is out for the reason § The trolley and the rail gives from the
// other side: "with no ring the track rules go unchecked and `invalid-rail` is
// not raised".
//
// The scenario is the empty structure itself, reached with `clearStructure`,
// which specs/instrumentation.md says "empties the structure as opening a site
// with nothing built leaves it" and is "refused by nothing". The yard is emptied
// with it so nothing else is standing, and the reading is compared as a SET so
// this decides which issues an empty crane raises rather than the order
// specs/instrumentation.md fixes for reporting them.
//
// `empty-program` is set aside before the comparison: it is specs/program.md's
// row about the tape, not a readiness row, and this point is about the
// readiness table.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises no-ring and no-rail and nothing else from the readiness table", async () => {
  await openSite(h, 0);
  await clearAll(h);

  const { issues } = await h.check();
  const readiness = issues
    .filter((one) => one !== "empty-program")
    .slice()
    .sort();

  await h.advance(1);
  await h.capture(
    "issues-structure-members-length-cost",
    "the check of a structure with no members at all",
  );

  assertDeepEqual(
    readiness,
    ["no-rail", "no-ring"],
    "the readiness issues an empty structure raises, so neither " +
      "disconnected-members nor invalid-rail is among them " +
      "(specs/structure.md § Readiness)",
  );
});
