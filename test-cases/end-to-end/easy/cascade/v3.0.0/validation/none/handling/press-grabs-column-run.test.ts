// handling/press-grabs-column-run — a press on a face-up column card lifts that
// card and every card below it in the column, in order.
//
// `specs/controls.md` fixes the grab: "A press resolves to the card drawn over
// every other card at the press point, which in a column is the lowest of the
// cards whose footprint contains that point", and for "A face-up card in a
// column" what it lifts is "That card and every card below it in the column, as
// the run `specs/tableau.md` defines". It also fixes WHEN: "The run enters the
// hand on the press itself, before the pointer has moved at all", which is what
// makes this readable from `snapshot().drag` with no move in between.
//
// WHAT THE POSE DISTINGUISHES. The column carries a face-down card, then three
// face-up cards in run order, and the press lands on the MIDDLE of the three. So
// every wrong model reads as a different hand: a build that lifts only the
// pressed card holds one, a build that lifts the column's exposed card alone
// holds the wrong card, a build that takes the cards ABOVE the pressed one holds
// the face-down card, and a build that takes the whole column holds four. Only
// "that card and every card below it" holds exactly the two named here, in that
// order.
//
// The press point lies in the band the card below leaves visible, so the lowest
// card whose footprint contains it really is the one this check names.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  card,
  captureStill,
  columnCardTops,
  createHarness,
  faceDown,
  openTable,
  poseColumn,
  runDown,
  type Harness,
} from "../harness";
import { CARD_W, COLUMN_X } from "../constants";

/** The column the scenario poses. Nothing else is on the table. */
const COLUMN = 3;

/** The card the column's face-up run is headed by, and how long that run is. */
const RUN_TOP = "9S";
const RUN_LENGTH = 3;

/** The card buried under the run, face-down, which no press here may lift. */
const COVERED = "2D";

/** The row the press lands on: the middle card of the three face-up ones. */
const PRESSED_ROW = 2;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lifts the pressed card and every card below it, in order", async () => {
  await openTable(h);
  const ids = await poseColumn(h, COLUMN, [
    ...faceDown(COVERED),
    ...runDown(card(RUN_TOP), RUN_LENGTH),
  ]);
  const faces = [false, true, true, true];

  // The band of the pressed card that the card below it leaves visible, which is
  // where "the lowest of the cards whose footprint contains that point" is the
  // card this check names.
  const tops = columnCardTops(faces);
  const pressX = COLUMN_X[COLUMN] + CARD_W / 2;
  const pressY = (tops[PRESSED_ROW] + tops[PRESSED_ROW + 1]) / 2;

  await h.debug.pointerDown(pressX, pressY);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "held");

  const held = (await h.snapshot()).drag;
  assertNotNull(held, "the run in hand on the press");
  assertDeepEqual(
    held?.cards.map((c) => c.id),
    ids.slice(PRESSED_ROW),
    "the cards the press lifted, in the order they lay in the column",
  );
  assertEqual(held?.fromPile, "tableau", "the pile the run was lifted from");
  assertEqual(held?.fromIndex, COLUMN, "the column the run was lifted from");
});
