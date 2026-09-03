// instrumentation/invalid-member-id-fails-loudly — an id no member carries is a
// bad argument, not a removal with nothing to remove.
//
// specs/instrumentation.md § The operations: "An argument outside the domain its
// operation states is invalid, and the call fails loudly rather than guessing
// what was meant. So is an index no site, load, or tape step carries, and an `id`
// no member carries." The same file draws the line this check is about a few
// paragraphs later: "A removal with nothing to remove is a refusal rather than an
// invalid argument, so it is silent" — that is `clearRing` on a ringless crane
// and `removeCounterweight` on a bare node, and `removeMember` on an id nothing
// carries is the other side of it.
//
// The world is three struts and nothing else, so the ids in play are exactly `0`,
// `1` and `2` (specs/instrumentation.md: "`addMember` gives the member the
// structure's `nextMemberId` and advances it by one", and `clearStructure`
// returns that counter to `0`). Two ids outside them are tried: one above the
// top, and a negative one, which is the same edge from the other side.
//
// The members are read back afterwards because a `removeMember` that answered an
// unknown id by removing something else would be exactly the guess the rule
// forbids.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, fail } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
} from "../harness";

/** Three legs off site 1's anchors: short struts, refused by no rule. */
const LEGS = [
  [0, 0, 0, 0, 2, 0],
  [2, 0, 0, 2, 2, 0],
  [0, 0, 2, 0, 2, 2],
] as const;

/** Ids nothing carries: one past the top, and one below the bottom. */
const STRANGERS = [7, -1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fails loudly on an id no member carries, and removes nothing", async () => {
  await openSite(h, 0);
  await clearAll(h);
  for (const [ax, ay, az, bx, by, bz] of LEGS) {
    await h.debug.addMember(ax, ay, az, bx, by, bz, "strut");
  }

  const before = (await h.snapshot()).structure;
  assertLength(before.members, LEGS.length, "the members the scenario stands");
  assertDeepEqual(
    before.members.map((one) => one.id).sort((a, b) => a - b),
    [0, 1, 2],
    "the ids those three members carry (specs/instrumentation.md)",
  );

  for (const id of STRANGERS) {
    let threw = false;
    try {
      await h.debug.removeMember(id);
    } catch {
      threw = true;
    }
    if (!threw) {
      fail(
        `removeMember(${id}) to fail loudly, ${id} being an id no member ` +
          "carries (specs/instrumentation.md)",
        "the call returned instead",
      );
    }
    const after = (await h.snapshot()).structure;
    assertDeepEqual(
      after.members,
      before.members,
      `the structure's members across removeMember(${id})`,
    );
  }

  await h.advance(1);
  await h.capture(
    "member-ids-intact",
    "The three members the two bad removals left standing",
  );
});
