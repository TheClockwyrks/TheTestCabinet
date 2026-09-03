// instrumentation/clear-ring-with-no-ring-is-silent — removing a ring that is not
// there is a refusal, not an invalid argument.
//
// `specs/instrumentation.md` § The structure: "A removal with nothing to remove
// is a refusal rather than an invalid argument, so it is silent: `clearRing` on a
// crane carrying no ring and `removeCounterweight` on a lattice node carrying
// none both leave the structure exactly as it stands and push no history."
//
// THE CRANE IS RINGLESS AND NOT EMPTY. Two struts stand, so the readings the call
// must leave alone are real figures: a structure carrying members, a cost, and
// two entries of undo history. A build that emptied the structure, or that pushed
// an entry for a removal that removed nothing, parts from every one of them; a
// build that raised instead of refusing parts from the first reading of all.
//
// The history is what the last assertion is really about. `undo` "restores the
// structure to what it was before the most recent structure-changing edit"
// (`specs/structure.md`), so an entry pushed here would cost the player an undo
// that puts nothing back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** A member placement, as the two lattice nodes `addMember` takes in order. */
type Edge = { a: [number, number, number]; b: [number, number, number] };

/** Two struts the rules accept: a crane that stands, carrying no ring. */
const MEMBERS: readonly Edge[] = [
  { a: [0, 0, 0], b: [0, 2, 0] },
  { a: [2, 0, 0], b: [2, 2, 0] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises nothing, removes nothing and pushes no history on a ringless crane", async () => {
  await openSite(h, 0);
  await clearAll(h);
  for (const member of MEMBERS) {
    await h.debug.addMember(...member.a, ...member.b, "strut");
  }
  const before = await h.snapshot();

  let raised: string | null = null;
  try {
    await h.debug.clearRing();
  } catch (error) {
    raised = error instanceof Error ? error.message : String(error);
  }
  const after = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertNull(
    before.structure.ring,
    "the ring the crane carries before the call, which is none: the scenario " +
      "this point rests on",
  );
  assertNull(
    raised,
    "clearRing on a crane carrying no ring to raise nothing, since a removal " +
      "with nothing to remove is a refusal (specs/instrumentation.md)",
  );
  assertNull(
    after.structure.ring,
    "the ring after the call (specs/instrumentation.md)",
  );
  assertEqual(
    JSON.stringify(after.structure.members),
    JSON.stringify(before.structure.members),
    "the members after clearRing on a ringless crane, which leaves the " +
      "structure exactly as it stands (specs/instrumentation.md)",
  );
  assertEqual(
    after.historyDepth,
    before.historyDepth,
    "the undo history after clearRing on a ringless crane, which pushes none " +
      "(specs/instrumentation.md)",
  );
});
