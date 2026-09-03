// instrumentation/empty-clear-structure-still-resets-the-id-counter —
// `clearStructure` returns `nextMemberId` to `0` even when nothing went.
//
// `specs/instrumentation.md` § The structure, of `clearStructure`: "On a
// structure that is already empty it removes nothing and pushes no history, like
// every other removal with nothing to remove, and `nextMemberId` goes back to `0`
// whether or not anything went." The last clause is the requirement this decides:
// the reset is unconditional, so a build that only rewinds the counter when it
// actually removed something is wrong.
//
// THE SCENARIO HAS TO EMPTY THE STRUCTURE THE OTHER WAY FIRST. The counter can
// only be seen standing above `0` over an empty structure if the members were
// taken out one at a time — `specs/structure.md` says the id "climbs with every
// member placed and falls only when the structure is emptied whole" — so two
// members are placed and then removed, which is the one arrangement that makes
// this `clearStructure` a clear over nothing that still has a counter to reset.
//
// The world is emptied first and carries nothing but the two members: a yard, a
// ring or a counterweight would be other things for the clear to remove, and this
// point is about the clear that removes nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns nextMemberId to 0 on a clearStructure that removes nothing", async () => {
  await openSite(h, 0);
  // The YARD AND THE STRUCTURE, rather than the whole world: a site opens with an
  // empty tape (`specs/state.md`) and nothing here poses one, so the tape needs no
  // clearing and the program screen is never visited.
  await emptyYard(h);
  await h.debug.clearStructure();

  // Two members, taking ids 0 and 1, then both removed: the structure is empty
  // and the counter stands at 2.
  await h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
  await h.debug.addMember(2, 0, 0, 2, 2, 0, "strut");
  await h.debug.removeMember(0);
  await h.debug.removeMember(1);
  const emptied = await h.snapshot();

  await h.debug.clearStructure();
  const cleared = await h.snapshot();

  // And the counter the clear reset is the one the next placement reads.
  await h.debug.addMember(0, 0, 0, 0, 2, 0, "strut");
  const rebuilt = await h.snapshot();

  await h.capture("state", "the structure a clear over nothing left");

  assertLength(
    emptied.structure.members,
    0,
    "the members two removals leave, so the clear below removes nothing",
  );
  assertEqual(
    emptied.structure.nextMemberId,
    2,
    "nextMemberId over the emptied structure: a removal gives no id back " +
      "(specs/structure.md)",
  );
  assertEqual(
    cleared.structure.nextMemberId,
    0,
    "nextMemberId after a clearStructure that removed nothing " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    rebuilt.structure.members[0]?.id,
    0,
    "the id the member placed after that clear takes",
  );
});
