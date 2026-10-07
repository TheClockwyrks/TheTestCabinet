// check/check-members-in-id-order — the check reports its members in member-id
// order.
//
// specs/structure.md § The static check: the check reports "Each intact member's
// force and utilization, in member-id order", and specs/instrumentation.md says
// the same of the reading — "`members` is in member-id order".
//
// AN ID IS NOT A POSITION AND NOT A PLACE IN THE CRANE. specs/structure.md fixes
// what an id is: "the next member id climbs with every member placed and falls
// only when the structure is emptied whole", and "a member restored by an undo
// carries the id it was placed with and the member placed after it takes a new
// one". So the way to tell an id-ordered list from a list that merely came out in
// the order the crane was built is to open a hole in the id range and fill it
// with a fresh, higher id.
//
// That is what this does: the minimal crane is posed, one of its TOWER SIDE
// DIAGONALS — a member standing at the very bottom of the crane, and tenth of
// twenty-one in the build order — is removed, and the same member is placed
// again. It takes id `21`, above every member above it in the crane, and a list
// in member-id order must put it last.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertTrue } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

const SITE = 0;

/** A tower side diagonal, low in the crane and mid-range in the id order. */
const REPLACED = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ascends by id, with a member replaced low in the crane reported last", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);

  await h.debug.removeMember(REPLACED);
  const [a, b, material] = MINIMAL_CRANE.members[REPLACED]!;
  await h.debug.addMember(a[0], a[1], a[2], b[0], b[1], b[2], material);

  const result = await h.check();
  const { structure } = await h.snapshot();
  const replacement = structure.nextMemberId - 1;
  await h.advance(1);
  await h.capture(
    "members-ids-in-the-order-reported-structure-mem",
    "members ids in the order reported, structure.members ids.",
  );

  const ids = result.members.map((one) => one.id);
  assertContains(
    ids,
    replacement,
    `the id the replaced member took, which is one below the structure's ` +
      "nextMemberId (specs/instrumentation.md)",
  );
  assertTrue(
    ids.every((id, at) => at === 0 || id > ids[at - 1]!),
    `the member ids to ascend strictly, in member-id order ` +
      `(specs/structure.md § The static check); they read [${ids.join(", ")}]`,
  );
  assertEqual(
    ids[ids.length - 1],
    replacement,
    "the last id reported, which is the replacement's however low in the " +
      "crane it stands (specs/structure.md § The static check)",
  );
});
