// editor/deleting-an-arm-discards-its-tape-and-row — deleting an arm takes its
// tape and its tape-panel row with it, and the rows below move up.
//
// THE RULE. "deleting an arm or wheel discards its tape and its row"
// (`specs/editor.md`, Dragging), of the verb "`part-delete` removes any part".
// What "its row" means is the panel's own rule: "The panel shows one row per arm
// and wheel, in placement order" (The tape panel), and placement order is
// `editor.parts`' order — `specs/instrumentation.md` reports `parts` as "placement
// order; the tape panel's row order", and `specs/formats.md` says the same: "The
// order of `parts` is the machine's placement order, which fixes the tape panel's
// row order." So removing the middle arm's entry removes its row, and the arm
// placed after it becomes the row that follows the first.
//
// HOW THE PANEL IS READ. A row is observed the way a player observes one: by
// pressing its label. "A press inside a row's label points [the cursor] at that
// row, column `0`", and "Visible row `v` ... shows the arm at index `firstRow + v`
// in placement order", with `firstRow` `0` when there is no cursor. So with the
// cursor cleared, a press in visible row `1`'s label points the cursor at whichever
// arm is second in placement order — which is the reading that must change.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and three
// arms placed in a known order through the surface — `(-3, 0)`, then `(0, 0)`,
// then `(3, 0)` — each with its own tape, so the tape that goes is identifiable.
// Nothing else is on the field, so every row of the panel is one of these three.
//
// The middle arm is then selected the player's way, by a press on its hex released
// where it began ("commits no move"), and deleted with `part-delete`.
//
// THE VERDICT. `editor.parts` holds the first and third arms alone, in that order;
// the deleted arm's entry, and with it the tape it carried, is gone; and a press
// in visible row `1`'s label — which pointed at the middle arm before — now points
// at the THIRD arm, which has moved up one place.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { hexCenter, regionCenter, tapeLabel } from "../field";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
  placePart,
  pressAction,
  pressAt,
  releasePointer,
  writeTape,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Point the cursor with a press in visible row `v`'s label, and answer where it lands. */
async function pressLabel(
  v: number,
): Promise<{ part: number; col: number } | null> {
  await h.debug.setCursor(null, 0);
  await pressAt(h, regionCenter(tapeLabel(v)));
  await releasePointer(h);
  return (await h.snapshot()).editor.cursor;
}

it("takes the arm's entry, its tape and its row, moving the rows after it up one place", async () => {
  await openChallengeDocument(h, BARE);
  const first = await placePart(h, "arm", WEST);
  const middle = await placePart(h, "arm", ORIGIN);
  const last = await placePart(h, "arm", EAST);
  await writeTape(h, first, ["grab"]);
  await writeTape(h, middle, ["rotate-cw", "rotate-cw"]);
  await writeTape(h, last, ["drop"]);

  assertDeepEqual(
    await partIds(h),
    [first, middle, last],
    "the three arms stand in the placement order the rows follow",
  );
  assertNotNull(
    partById(await h.snapshot(), middle)?.tape,
    "the arm about to be deleted carries a tape, so there is a tape to discard",
  );
  assertEqual(
    (await pressLabel(1))?.part,
    middle,
    "before the delete, visible row 1 is the middle arm's row",
  );

  await pressAt(h, hexCenter(ORIGIN));
  await releasePointer(h);
  assertEqual(
    (await h.snapshot()).editor.selected,
    middle,
    "the press selected the middle arm, which is what part-delete removes",
  );

  await pressAction(h, "part-delete");
  await h.advance(1);
  await captureStill(h, "rows");
  const after = await h.snapshot();

  assertNull(
    partById(after, middle),
    "the deleted arm's entry is gone from editor.parts, and its tape with it",
  );
  assertDeepEqual(
    after.editor.parts.map((part) => part.id),
    [first, last],
    "the surviving arms keep their placement order, so the third arm is now the second row",
  );
  assertEqual(
    (await pressLabel(1))?.part,
    last,
    "the tape panel lost the deleted arm's row: visible row 1 now points at the arm that was placed after it",
  );
  assertNull(
    await pressLabel(2),
    "there is no third row left, so a press in visible row 2's label lands on no row and leaves the cleared cursor alone",
  );
});
