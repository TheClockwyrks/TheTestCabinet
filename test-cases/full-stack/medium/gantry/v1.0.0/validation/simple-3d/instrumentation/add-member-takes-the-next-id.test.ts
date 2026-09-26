// instrumentation/add-member-takes-the-next-id — a member that lands takes
// `nextMemberId`, and the counter advances by one.
//
// `specs/instrumentation.md` § The structure: "`addMember` gives the member the
// structure's `nextMemberId` and advances it by one." Its snapshot notes give the
// field the same meaning: "`structure.nextMemberId` is the id the next member
// placed takes".
//
// THREE MEMBERS ARE PLACED, NOT ONE, because the requirement is a counter rather
// than a value: a build that handed out the same id twice, or that numbered by
// the member count, or that advanced by more than one, agrees with a single
// placement and parts from this one. Each is read back the moment it lands — the
// id the new member carries, and the id the next one would take — so a failure
// names the placement that broke the sequence.
//
// The structure is emptied first, so the counter starts at `0`: `clearStructure`
// "empties the structure as opening a site with nothing built leaves it, so the
// next member placed after it takes id `0`". The three struts are two units long,
// on lattice nodes inside site 1's envelope and inside its budget, so nothing
// about them can be refused — a refused placement is silent, and would leave the
// counter untouched for reasons this point is not about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { createHarness, openSite, type Harness } from "../harness";

/** A member placement, as the two lattice nodes `addMember` takes in order. */
type Edge = { a: [number, number, number]; b: [number, number, number] };

/** Three struts the rules accept, each `2` units, sharing no pair of nodes. */
const MEMBERS: readonly Edge[] = [
  { a: [0, 0, 0], b: [0, 2, 0] },
  { a: [2, 0, 0], b: [2, 2, 0] },
  { a: [0, 0, 2], b: [0, 2, 2] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives each member the next id and advances the counter by one", async () => {
  await openSite(h, 0);
  // The precondition is an empty structure and nothing else. A site opened
  // after a reset already carries one (specs/state.md), and `clearStructure`
  // states it rather than leaving it implied; emptying the yard and the tape
  // too would drive surface this requirement does not concern.
  await h.debug.clearStructure();
  const start = (await h.snapshot()).structure.nextMemberId;

  const placed: { ids: number[]; next: number }[] = [];
  for (const member of MEMBERS) {
    await h.debug.addMember(...member.a, ...member.b, "strut");
    const { structure } = await h.snapshot();
    placed.push({
      ids: structure.members.map((one) => one.id),
      next: structure.nextMemberId,
    });
  }

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    start,
    0,
    "the id the next member takes on an emptied structure, which is where " +
      "this check counts from (specs/instrumentation.md)",
  );
  for (const [index, seen] of placed.entries()) {
    assertLength(
      seen.ids,
      index + 1,
      `the members standing after placement ${index + 1}`,
    );
    assertEqual(
      seen.ids[index],
      index,
      `the id member ${index + 1} took, which is the nextMemberId standing ` +
        "when it was placed (specs/instrumentation.md)",
    );
    assertEqual(
      seen.next,
      index + 1,
      `nextMemberId after placement ${index + 1}, which advances by one ` +
        "(specs/instrumentation.md)",
    );
  }
});
