// instrumentation/clear-structure-empties-the-structure — one call takes the
// members, the ring and the counterweights away together.
//
// `specs/instrumentation.md` § The structure: "`clearStructure` | Empties the
// open site's structure: every member, the ring, and every counterweight go, and
// the undo history is pushed exactly as one edit pushes it." It adds that the
// call "is refused by nothing: removal is always allowed."
//
// THE STRUCTURE CARRIES ALL THREE KINDS BEFORE THE CALL, because the requirement
// names all three: a build that dropped the members and kept the ring, or that
// left the counterweights hanging on nodes no member reaches any more, satisfies
// a check that posed only members. The cost is read with them — `specs/structure.md`
// makes it "the sum of its parts: each member's length times its material's cost
// per unit, plus `RING_COST` for the ring, plus `COUNTERWEIGHT_COST` per
// counterweight" — so an empty structure costs `0`, and a cost left standing
// names a part that did not go.
//
// The crane posed is the four legs of a tower with the ring on top of them, and
// its two counterweights sit on flange nodes of that ring, which are nodes "the
// structure uses" (`specs/structure.md`). It is posed as the sequence of edits
// that builds it, so every part of it stands under the rules a player builds
// under.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
} from "../harness";

/** Four legs, a ring on top of them, and two counterweights on its flange. */
const CRANE: CraneDesign = {
  site: 0,
  name: "Four legs, a ring and two counterweights",
  ring: [0, 2, 0],
  counterweights: [
    [0, 2, 0],
    [2, 2, 2],
  ],
  members: [
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 2], [0, 2, 2], "strut"],
    [[2, 0, 2], [2, 2, 2], "strut"],
  ],
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every member, the ring and every counterweight", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, CRANE);
  const before = await h.snapshot();

  await h.debug.clearStructure();
  const after = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertLength(
    before.structure.members,
    CRANE.members.length,
    "the members standing before the call, which is the scenario this point " +
      "rests on",
  );
  assertNotNull(before.structure.ring, "the ring standing before the call");
  assertLength(
    before.structure.counterweights,
    CRANE.counterweights.length,
    "the counterweights standing before the call",
  );

  assertLength(
    after.structure.members,
    0,
    "the members after clearStructure, which every one of them goes with " +
      "(specs/instrumentation.md)",
  );
  assertNull(
    after.structure.ring,
    "the ring after clearStructure (specs/instrumentation.md)",
  );
  assertLength(
    after.structure.counterweights,
    0,
    "the counterweights after clearStructure (specs/instrumentation.md)",
  );
  assertEqual(
    after.structure.cost,
    0,
    "the cost of an emptied structure, which is the sum of parts that are no " +
      "longer there (specs/structure.md)",
  );
});
