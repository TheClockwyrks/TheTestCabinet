// editor/undo-restores-the-previous-structure — undo puts the structure back to
// what it was before the most recent edit.
//
// specs/structure.md: "undo restores the structure to what it was before the most
// recent structure-changing edit, as far back as the site was opened."
// specs/controls.md binds the action to `KeyZ` and says it applies "on the build
// screen", and gives no other way to reach it — the debug surface carries no undo
// operation — so the key press IS the requirement here rather than a detour on the
// way to one.
//
// THE READING IS THE WHOLE STRUCTURE, taken before the edit that is undone and
// compared against the whole structure after the undo, member ids included: the
// specification says the structure is restored, not that a member disappears, and
// a build that dropped the wrong member, renumbered what was left, or forgot to
// give the fourth member's cost back would agree with a bare count and disagree
// here. `nextMemberId` is deliberately not part of the comparison: "An undone
// placement gives no id back", which is a different requirement in the other
// direction.
//
// THE WORLD IS EMPTIED FIRST so the three members compared are the only ones in
// it. They are two-unit struts standing in a column from the anchor `(0, 0, 0)`,
// each inside `STRUT_MAX_LEN` (`6`), inside site 1's envelope, and far inside its
// budget of `3000`, so every one of the four placements lands and the undo has an
// edit of its own to reverse.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type MemberView,
} from "../harness";

/** The column placed before the undo, anchor upward. */
const COLUMN: readonly (readonly [number, number])[] = [
  [0, 2],
  [2, 4],
  [4, 6],
];

/** The fourth placement, the one the undo reverses. */
const FOURTH: readonly [number, number] = [6, 8];

/** The members in id order, so two readings compare as the same list. */
function byId(members: readonly MemberView[]): MemberView[] {
  return [...members].sort((one, other) => one.id - other.id);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores the structure the most recent placement changed", async () => {
  await openSite(h, 0);
  await clearAll(h);
  for (const [from, to] of COLUMN) {
    await h.debug.addMember(0, from, 0, 0, to, 0, "strut");
  }
  const before = (await h.snapshot()).structure;
  assertLength(
    before.members,
    COLUMN.length,
    "the structure the undo has to restore (specs/structure.md)",
  );

  await h.debug.addMember(0, FOURTH[0], 0, 0, FOURTH[1], 0, "strut");
  assertLength(
    (await h.snapshot()).structure.members,
    COLUMN.length + 1,
    "the structure the fourth placement left, which the undo reverses",
  );

  // The `undo` action, on the screen specs/controls.md gives it.
  await h.press("KeyZ");

  await h.advance(1);
  await h.capture("restored", "The structure the undo put back");

  const after = (await h.snapshot()).structure;
  assertDeepEqual(
    byId(after.members),
    byId(before.members),
    "the members standing after the undo, ids and all (specs/structure.md)",
  );
  assertDeepEqual(
    after.ring,
    before.ring,
    "the ring standing after the undo (specs/structure.md)",
  );
  assertDeepEqual(
    after.counterweights,
    before.counterweights,
    "the counterweights standing after the undo (specs/structure.md)",
  );
  assertEqual(
    after.cost,
    before.cost,
    "the cost after the undo (specs/structure.md)",
  );
});
