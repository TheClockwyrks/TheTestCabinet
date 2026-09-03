// instrumentation/removal-gives-no-member-id-back — a removal gives no member id
// back.
//
// `specs/instrumentation.md` § The structure: "`addMember` gives the member the
// structure's `nextMemberId` and advances it by one", and `clearStructure` is the
// one thing that returns that counter to `0`. `specs/structure.md` states the same
// rule from the editor's side: "the next member id climbs with every member placed
// and falls only when the structure is emptied whole", so a removal leaves the
// counter where it stands and the member placed after it takes a fresh id rather
// than the removed one.
//
// THE MIDDLE MEMBER IS THE ONE REMOVED, so the ids the structure carries afterwards
// are not a run of consecutive numbers: a build that renumbered on removal, or that
// handed the freed id to the next placement, would report ids 0, 1, 2 here and this
// check reads 0, 2, 3.
//
// Four members between anchor nodes and the nodes above them, on an emptied world:
// nothing else is built, so every id in the reading was issued by this check.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives the member placed after a removal a fresh id, not the removed one", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.clearStructure();

  await h.debug.addMember(0, 0, 0, 0, 2, 0, "strut"); // id 0
  await h.debug.addMember(2, 0, 0, 2, 2, 0, "strut"); // id 1
  await h.debug.addMember(0, 0, 2, 0, 2, 2, "strut"); // id 2
  await h.debug.removeMember(1);
  await h.debug.addMember(2, 0, 2, 2, 2, 2, "strut"); // id 3, never 1

  const { structure } = await h.snapshot();
  await h.capture("state", "the ids three placements and a removal left");

  assertLength(
    structure.members,
    3,
    "the members standing: three placed, one removed, one more placed",
  );
  assertDeepEqual(
    structure.members.map((one) => one.id).sort((a, b) => a - b),
    [0, 2, 3],
    "the ids the structure carries, the fourth member taking 3 rather than " +
      "the removed 1 (specs/instrumentation.md)",
  );
  assertEqual(
    structure.nextMemberId,
    4,
    "nextMemberId after four placements and one removal: it climbs with every " +
      "placement and falls only on a clear (specs/structure.md)",
  );
});
