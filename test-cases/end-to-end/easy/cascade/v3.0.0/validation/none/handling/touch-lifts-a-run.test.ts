// handling/touch-lifts-a-run — a finger touching down on a column's lowest
// face-up card lifts that card and the cards below it, exactly as a mouse press
// does.
//
// THE RULE. `specs/controls.md`, How input reaches the game: "A mouse and a
// touchscreen stand on the same footing. A press is a mouse button going down or
// a finger touching down ... Every control the game carries answers those three,
// so the game is complete on a touch device with no mouse attached." The grab
// itself is that file's press table: "A face-up card in a column | That card and
// every card below it in the column", entering the hand "on the press itself,
// before the pointer has moved at all".
//
// SCOPED TO THIS ENGINE, because under the other two the engine hands the game
// abstracted pointer samples that have already resolved a finger into a press, a
// move and a release: there is nothing left for the build to get wrong and the
// point would pass vacuously. Here the build owns the whole input path, so
// answering a real touch contact is its work.
//
// THE CONTACT IS A REAL CHROMIUM TOUCH on a context that reports a touchscreen,
// so it arrives as `pointerType: "touch"` with `navigator.maxTouchPoints`
// non-zero — the device a build offering touch controls has to believe it is on.
// A build that listens for `mousedown` alone lifts nothing here and passes every
// mouse point beside it.
//
// THE CONTACT IS NOT LIFTED, and that is the whole of the reading: the run enters
// the hand on the press itself, so what is read is `drag` with the finger still
// down. `handling/touch-completes-a-drop` is the point that drives the lift.
//
// WHAT THE POSE DISTINGUISHES. The column carries a face-down card under two
// face-up cards in run order, and the contact lands on the upper of the two, so a
// build that lifts one card holds one, one that takes the whole column holds
// three, and one that answers nothing holds none.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  card,
  captureStill,
  columnCardTops,
  createHarness,
  openTable,
  poseColumn,
  touchPress,
  type Harness,
} from "../harness";
import { CARD_W, COLUMN_X } from "../constants";

/** The column the scenario poses. Nothing else is on the table. */
const COLUMN = 3;

/**
 * The column, bottom card first: a face-down card under a run of two.
 *
 * The black eight over the red nine is a run `specs/tableau.md` accepts, so the
 * two travel together and a build that lifted only one of them reads as a
 * different hand.
 */
const CARDS = [card("4S", false), card("9H"), card("8C")] as const;

/** The row the contact lands on: the upper of the two face-up cards. */
const GRAB_ROW = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lifts the run under a finger that has touched down", async () => {
  await openTable(h);
  const ids = await poseColumn(h, COLUMN, [...CARDS]);

  // The band of the grabbed card that the card below it leaves visible, which is
  // where "the lowest of the cards whose footprint contains that point" is the
  // card this point names (`specs/controls.md`).
  const faces = CARDS.map((c) => c.faceUp ?? true);
  const tops = columnCardTops(faces);
  const pressX = COLUMN_X[COLUMN] + CARD_W / 2;
  const pressY = (tops[GRAB_ROW] + tops[GRAB_ROW + 1]) / 2;

  await touchPress(h, pressX, pressY);
  const held = (await h.snapshot()).drag;

  // Before the assertions, so a contact the build ignored still leaves the
  // picture of the column it left alone.
  await captureStill(h, "lifted");

  assertEqual(
    held === null,
    false,
    `whether a touch contact landing on column ${COLUMN}'s row ${GRAB_ROW} ` +
      `lifted anything — a press is a mouse button going down OR A FINGER ` +
      `TOUCHING DOWN, and the run enters the hand on the press itself ` +
      `(specs/controls.md)`,
  );
  assertDeepEqual(
    (held?.cards ?? []).map((c) => c.id),
    ids.slice(GRAB_ROW),
    `the cards the contact lifted, grabbed card first — a press on a ` +
      `face-up column card lifts that card and every card below it in the ` +
      `column (specs/controls.md)`,
  );
});
