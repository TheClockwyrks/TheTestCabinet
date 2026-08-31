// Facet — keyboard/confirm-selects: with nothing selected, `confirm` selects
// the cell the cursor is on.
//
// `confirm` is the keyboard's only way onto the board. `specs/controls.md` says
// it "acts on the cursor's cell exactly as a press on that cell does", decided
// by the four press rows read against the cursor's cell — and the FIRST of
// those rows, "Any cell, while nothing is selected — Selects that cell", is
// this point. A build that leaves the selection empty here has a keyboard that
// can move a cursor and never touch a gem; one that selects some other cell
// arms every keyboard swap that follows against the wrong pair.
//
// NOTHING SELECTED IS THE PRECONDITION, NOT A DETAIL. The rows are evaluated in
// order and the first that matches applies, so which row a `confirm` lands on
// depends entirely on what is selected when it is pressed. The selection is
// therefore emptied through the debug surface before each press, and read back
// as empty, so the press that follows can only be answered by the first row.
// What `confirm` does on a cell that IS selected belongs to
// `keyboard/confirm-deselects`, and what it does on a cell beside the selected
// one to `keyboard/confirm-swaps`; neither is read here.
//
// BOTH KEYS, EACH ON ITS OWN. `specs/controls.md` binds `confirm` to `Enter`
// and `Space` and states that each key listed for an action fires that action
// on its own, so each is pressed once — each with nothing selected, and each
// with the cursor on a different cell, so the second press is answered by the
// same first row as the first press rather than by the row below it.
//
// THE WHOLE KEY PATH IS THE BUILD'S. An engineless run is handed no runtime, so
// the listener, the binding table and the press edge are the build's own code —
// `specs/instrumentation.md` puts the keyboard in that layer and gives the
// surface no keyboard operation at all. The keys below are pressed through
// Chromium's own input pipeline, so what arrives is a browser-trusted key event
// on the real page, and every step from a physical key to the reading taken
// afterwards is the build's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { BINDINGS } from "../constants";
import type { CellRef } from "../board";
import {
  captureStill,
  createHarness,
  poseBoardWithEscape,
  type Harness,
} from "../harness";

/**
 * One press per key bound to `confirm`, each on a cell of its own.
 *
 * The keys are read out of the binding table rather than written here, so this
 * presses whatever `specs/controls.md` binds. Both cells are interior and clear
 * of the three cells the quiet filler spends on its escape swap.
 */
const PRESSES: readonly { code: string; cell: CellRef }[] = [
  { code: BINDINGS.confirm[0], cell: { col: 3, row: 3 } },
  { code: BINDINGS.confirm[1], cell: { col: 5, row: 2 } },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the cell the cursor is on when nothing is selected", async () => {
  // A posed board rests exactly as it was written until a swap is accepted on
  // it, and none is requested here, so the cell the selection lands on holds
  // the gem it was posed with throughout.
  const posed = await poseBoardWithEscape(h, []);
  assertEqual(posed.screen, "playing", "the screen confirm is pressed on");

  for (const { code, cell } of PRESSES) {
    await h.debug.clearSelection();
    await h.debug.setCursor(cell.col, cell.row);
    const before = (await h.snapshot());
    assertNull(before.selection, `the selection before ${code}`);
    assertDeepEqual(before.cursor, cell, `the posed cursor before ${code}`);

    await h.tap(code);
    // One frame past the press, so the picture kept below is one drawn with the
    // selection standing rather than the frame that read the key.
    await h.advance(1);

    // The cursor's cell, and no other: a selection at the cell the cursor sat
    // on is what the first press row promises.
    assertDeepEqual((await h.snapshot()).selection, cell, `the cell selected by ${code}`);
  }

  await captureStill(h, "select");
});
