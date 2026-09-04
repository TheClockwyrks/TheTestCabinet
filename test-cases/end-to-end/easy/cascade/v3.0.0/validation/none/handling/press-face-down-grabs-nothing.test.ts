// handling/press-face-down-grabs-nothing — a press on a face-down card lifts
// nothing.
//
// `specs/controls.md` fixes it: "A face-down card" lifts "Nothing".
// `specs/tableau.md` states the same rule from the move's side: "A move whose
// taken card is face-down is refused", and "A face-down card is never moved and
// is never read. It becomes playable only once it has been turned this way."
//
// WHAT THE POSE DISTINGUISHES. The column is the shape a real deal leaves: two
// face-down cards with one face-up card below them. The press lands on the band
// of the LOWER face-down card, which is the card drawn over every other card at
// that point (`specs/controls.md`) and which sits directly above a face-up card
// a press one band lower would lift. So a build that ignores the face and takes
// the pressed card holds one card, a build that resolves the press to the
// column's exposed card holds the face-up one, and a build that hands over the
// whole column holds three. Only the stated rule leaves the hand empty.
//
// The automatic flip is left ON at its reset default, because a lift turns
// nothing in any case (`specs/tableau.md`) and the gate is
// `instrumentation/auto-flip-gate`'s to grade.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  cards,
  captureStill,
  columnCardTops,
  createHarness,
  faceDown,
  openTable,
  pileOf,
  poseColumn,
  type Harness,
} from "../harness";
import { CARD_W, COLUMN_X } from "../constants";

/** The column the scenario poses. Nothing else is on the table. */
const COLUMN = 5;

/** The two face-down cards, highest on the table first. */
const COVERED = ["KS", "7D"] as const;

/** The one face-up card, drawn lowest, which this press must NOT reach. */
const EXPOSED = "9S";

/** The row the press lands on: the lower of the two face-down cards. */
const PRESSED_ROW = 1;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lifts nothing when the press lands on a face-down card", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, [...faceDown(...COVERED), ...cards(EXPOSED)]);
  const faces = [false, false, true];

  // The band the card below leaves visible, so the lowest card whose footprint
  // holds the press point is the face-down one this check names.
  const tops = columnCardTops(faces);
  const pressX = COLUMN_X[COLUMN] + CARD_W / 2;
  const pressY = (tops[PRESSED_ROW] + tops[PRESSED_ROW + 1]) / 2;

  await h.debug.pointerDown(pressX, pressY);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "unheld");

  const after = await h.snapshot();
  assertNull(after.drag, "the hand after a press on a face-down card");
  assertEqual(
    pileOf(after, "tableau", COLUMN).length,
    faces.length,
    "the cards the column still holds",
  );
});
