// instrumentation/clear-structure-resets-the-id-counter — emptying the structure
// returns `nextMemberId` to `0`.
//
// `specs/instrumentation.md` § The structure: "`clearStructure` empties the
// structure as opening a site with nothing built leaves it, so the next member
// placed after it takes id `0` and a posed crane's ids run upward in the order its
// members were added. … `nextMemberId` goes back to `0` whether or not anything
// went." Its snapshot notes repeat the field's rule: "`structure.nextMemberId` is
// the id the next member placed takes, which `clearStructure` returns to `0` and
// which no removal gives back."
//
// THE COUNTER IS READ, AND THEN SPENT. `nextMemberId` reading `0` is the field's
// half of the requirement; the member placed afterwards carrying id `0` is the
// half a player can see, and the two are one requirement read at its two ends. A
// build that reported the counter reset and went on numbering from where it left
// off fails the second, and one that renumbered nothing fails both.
//
// FOUR MEMBERS STAND FIRST, so the counter has somewhere to fall from: `4` is a
// value no fresh structure holds, and `specs/structure.md` warns that the counter
// "climbs with every member placed and falls only when the structure is emptied
// whole". The four struts are two units long, on lattice nodes inside site 1's
// envelope and well inside its budget, so nothing about them is refused.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** A member placement, as the two lattice nodes `addMember` takes in order. */
type Edge = { a: [number, number, number]; b: [number, number, number] };

/** Four struts the rules accept, each `2` units, sharing no pair of nodes. */
const MEMBERS: readonly Edge[] = [
  { a: [0, 0, 0], b: [0, 2, 0] },
  { a: [2, 0, 0], b: [2, 2, 0] },
  { a: [0, 0, 2], b: [0, 2, 2] },
  { a: [2, 0, 2], b: [2, 2, 2] },
];

/** The one placed after the call, on nodes none of the four used. */
const AFTER = { a: [4, 0, 0], b: [4, 2, 0] } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the id counter to 0, so the next member placed takes id 0", async () => {
  await openSite(h, 0);
  await clearAll(h);
  for (const member of MEMBERS) {
    await h.debug.addMember(...member.a, ...member.b, "strut");
  }
  const built = (await h.snapshot()).structure.nextMemberId;

  await h.debug.clearStructure();
  const emptied = (await h.snapshot()).structure.nextMemberId;

  await h.debug.addMember(...AFTER.a, ...AFTER.b, "strut");
  const { structure } = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    built,
    MEMBERS.length,
    `the id counter after ${MEMBERS.length} placements, which is the scenario ` +
      "this point rests on (specs/instrumentation.md)",
  );
  assertEqual(
    emptied,
    0,
    "nextMemberId after clearStructure, which returns it to 0 " +
      "(specs/instrumentation.md)",
  );
  assertLength(
    structure.members,
    1,
    "the members standing after the placement that follows the call",
  );
  assertEqual(
    structure.members[0]?.id,
    0,
    "the id the next member placed takes after clearStructure " +
      "(specs/instrumentation.md)",
  );
});
