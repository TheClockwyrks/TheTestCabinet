// instrumentation/clear-structure-pushes-one-history-entry — emptying the
// structure costs the undo history exactly one entry.
//
// `specs/instrumentation.md` § The structure: "`clearStructure` | Empties the
// open site's structure: every member, the ring, and every counterweight go, and
// the undo history is pushed exactly as one edit pushes it." An edit pushes one
// entry — "Each edit that lands pushes the undo history exactly as a click would"
// — and the snapshot reports the stack's height as `historyDepth`, "edits the
// open site can still undo".
//
// SO THE REQUIREMENT IS READ AT BOTH ENDS OF THE ONE ENTRY: the depth rises by
// exactly one, and one `undo` puts back everything the call removed.
// `specs/structure.md` fixes what an undo does — "undo restores the structure to
// what it was before the most recent structure-changing edit" — so a build that
// pushed one entry per member removed would need three undos to restore three
// members, and a build that pushed none would undo the placement before the
// clear.
//
// THE UNDO IS DRIVEN BY THE KEY THE PLAYER PRESSES, because the surface carries
// no undo of its own: `specs/controls.md` binds `undo` to `KeyZ` on the build
// screen, which is the screen the structure poses apply on and the screen this
// check already stands on, so nothing is driven on the way to it.
//
// Three struts stand first, each two units, on lattice nodes inside site 1's
// envelope and inside its budget, so each of the three placements lands and the
// depth this check counts from is a placement count it knows.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** A member placement, as the two lattice nodes `addMember` takes in order. */
type Edge = { a: [number, number, number]; b: [number, number, number] };

/** Three struts the rules accept, each `2` units, sharing no pair of nodes. */
const MEMBERS: readonly Edge[] = [
  { a: [0, 0, 0], b: [0, 2, 0] },
  { a: [2, 0, 0], b: [2, 2, 0] },
  { a: [0, 0, 2], b: [0, 2, 2] },
];

/** The key `specs/controls.md` binds `undo` to, on the build screen. */
const UNDO_KEY = BINDINGS.undo[0] as string;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pushes one history entry, so one undo restores everything it removed", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  for (const member of MEMBERS) {
    await h.debug.addMember(...member.a, ...member.b, "strut");
  }
  const built = await h.snapshot();

  await h.debug.clearStructure();
  const emptied = await h.snapshot();

  await h.press(UNDO_KEY);
  const undone = await h.snapshot();

  await h.capture("state", "The driven state this point decides");

  assertLength(
    built.structure.members,
    MEMBERS.length,
    "the members standing before the call, which is the scenario this point " +
      "rests on",
  );
  assertEqual(
    emptied.historyDepth,
    built.historyDepth + 1,
    "the undo history after clearStructure, which pushes it exactly as one " +
      "edit pushes it (specs/instrumentation.md)",
  );
  assertEqual(
    JSON.stringify(undone.structure.members),
    JSON.stringify(built.structure.members),
    "the members one undo puts back, which is everything the call removed " +
      "(specs/structure.md)",
  );
});
