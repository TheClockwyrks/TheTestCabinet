// editor/undo-restores-a-removal — undoing a removal puts the removed member back.
//
// specs/structure.md makes undo's subject every structure-changing edit, not
// placements alone: "undo restores the structure to what it was before the most
// recent structure-changing edit", and a removal is such an edit — the same
// paragraph pairs the two, "a delete removes one member, the ring, or one
// counterweight, and undo restores the structure to what it was before the most
// recent structure-changing edit". The same paragraph fixes the id it comes back
// under: "a member restored by an undo carries the id it was placed with". A build
// that pushed only placements onto its history would leave a mis-clicked delete
// irreversible, which is the one edit a player most needs back.
//
// THE MEMBER RESTORED IS READ BY ITS ID, ENDS AND MATERIAL, because that is what
// "the structure it was before" means for the member that went: a build that put a
// member back with a fresh id, or with its ends swapped for the pending node's,
// would satisfy a bare count and fail a player who then deleted "member 1" again.
//
// THE WORLD IS EMPTIED FIRST so the three members are the only ones in it. They are
// two-unit struts standing in a column from the anchor `(0, 0, 0)`, each inside
// `STRUT_MAX_LEN` (`6`), inside site 1's envelope, and far inside its budget of
// `3000`, so every placement lands; the removal takes the middle one, whose absence
// no other rule could have caused.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNotNull } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The column placed before the removal, anchor upward. */
const COLUMN: readonly (readonly [number, number])[] = [
  [0, 2],
  [2, 4],
  [4, 6],
];

/** The member removed and then restored: the middle one of the column. */
const REMOVED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the removed member back under the id it was placed with", async () => {
  await openSite(h, 0);
  await clearAll(h);
  for (const [from, to] of COLUMN) {
    await h.debug.addMember(0, from, 0, 0, to, 0, "strut");
  }
  const before = (await h.snapshot()).structure.members.find(
    (one) => one.id === REMOVED,
  );
  assertNotNull(
    before ?? null,
    `the member carrying id ${REMOVED}, which this check removes`,
  );

  await h.debug.removeMember(REMOVED);
  assertLength(
    (await h.snapshot()).structure.members,
    COLUMN.length - 1,
    "the structure the removal left, which the undo reverses",
  );

  // The `undo` action, on the screen specs/controls.md gives it.
  await h.press("KeyZ");

  await h.advance(1);
  await h.capture("restored", "The member the undo put back");

  const after = (await h.snapshot()).structure.members;
  assertLength(
    after,
    COLUMN.length,
    "the members standing after the undo of a removal (specs/structure.md)",
  );
  assertDeepEqual(
    after.find((one) => one.id === REMOVED),
    before,
    `the member carrying id ${REMOVED} after the undo, with the ends and ` +
      "material it was placed with (specs/structure.md)",
  );
});
