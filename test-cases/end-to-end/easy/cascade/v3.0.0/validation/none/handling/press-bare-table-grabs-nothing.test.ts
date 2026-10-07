// handling/press-bare-table-grabs-nothing — a press that lands on no card lifts
// nothing.
//
// `specs/controls.md` fixes it: "A press that lands on no card lifts nothing".
//
// WHERE THE PRESS LANDS, AND WHY THERE. `specs/table.md` fixes the seven columns
// at a pitch of `122`, a `100`-wide card and a `22` gap, and states that "The
// gaps between the columns carry no pile and nothing card-sized is drawn in
// them". The press lands in the middle of the gap immediately beside a column
// that is holding cards, at the height of that column's own cards. So this
// decides something a press on an empty table could not: a build that resolves a
// press to the nearest pile, or that answers a column's whole strip rather than
// its cards' footprints, lifts the neighbouring run and fails, while a build that
// tests the footprint the specification fixes lifts nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  card,
  captureStill,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  runDown,
  type Harness,
} from "../harness";
import { CARD_H, CARD_W, COLUMN_X, TABLEAU_Y } from "../constants";

/** The column that holds cards, and the gap the press lands in beside it. */
const COLUMN = 0;
const RUN_TOP = "KS";
const RUN_LENGTH = 3;

/** The width of the gap between two columns: the pitch, less a card. */
const COLUMN_GAP = COLUMN_X[1] - COLUMN_X[0] - CARD_W;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lifts nothing when the press lands on bare table", async () => {
  await openTable(h);
  const ids = await poseColumn(h, COLUMN, [
    ...runDown(card(RUN_TOP), RUN_LENGTH),
  ]);

  // The middle of the gap to the right of the posed column, at the height of the
  // column's first card.
  const pressX = COLUMN_X[COLUMN] + CARD_W + COLUMN_GAP / 2;
  const pressY = TABLEAU_Y + CARD_H / 2;

  await h.debug.pointerDown(pressX, pressY);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "unheld");

  const after = await h.snapshot();
  assertNull(after.drag, "the hand after a press on the bare table");
  assertEqual(
    pileOf(after, "tableau", COLUMN).length,
    ids.length,
    "the cards the neighbouring column still holds",
  );
});
