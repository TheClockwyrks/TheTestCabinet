// handling/release-on-illegal-returns — a release over a pile that refuses the
// held run puts the whole run back in the column it was lifted from, in order.
//
// `specs/controls.md` fixes it: where the leading card's centre lies "In the
// rectangle of a pile that refuses the run" the result is "The run returns to the
// pile it was lifted from". `specs/tableau.md` states what returning means: "A
// refused move changes nothing. Every card it carried returns to the pile it was
// taken from, in the order it left, with every face as it was, and the target
// keeps what it held."
//
// WHAT THE POSE DISTINGUISHES. Three cards are carried, so ORDER is observable:
// a build that returns the run reversed, or that returns only its leading card,
// or that drops the run onto the refusing column anyway, all read differently
// from the rule. The target's lowest card is the same RANK as the run's leading
// card and the opposite colour, so a build that checks only the colour accepts
// the run and fails.
//
// The release is carried far past `DRAG_THRESHOLD` (`5`), so it is a drop rather
// than a click; `handling/short-gesture-is-a-click` and `handling/long-gesture-is-a-drop` grade
// that boundary.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  card,
  captureStill,
  columnCardTops,
  createHarness,
  dragRunTo,
  dropRect,
  openTable,
  pileOf,
  poseColumn,
  rectCenter,
  runDown,
  type Harness,
} from "../harness";
import { CARD_W, COLUMN_X } from "../constants";

/** Where the run is lifted from: three cards in run order, headed by a nine. */
const SOURCE = 0;
const RUN_TOP = "9S";
const RUN_LENGTH = 3;

/** The column it is released over: a red nine, which refuses a black nine. */
const TARGET = 4;
const TARGET_CARD = "9D";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the whole run to its source column, in order", async () => {
  await openTable(h);
  const ids = await poseColumn(h, SOURCE, [
    ...runDown(card(RUN_TOP), RUN_LENGTH),
  ]);
  const [targetId] = await poseColumn(h, TARGET, [card(TARGET_CARD)]);

  // The press lands on the band the second card leaves visible, so it lifts the
  // run's heading card and both cards below it.
  const tops = columnCardTops([true, true, true]);
  const pressX = COLUMN_X[SOURCE] + CARD_W / 2;
  const pressY = (tops[0] + tops[1]) / 2;
  const landing = rectCenter(dropRect("tableau", TARGET, [true]));

  await dragRunTo(h, pressX, pressY, landing.x, landing.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "returned");

  const after = await h.snapshot();
  assertDeepEqual(
    pileOf(after, "tableau", SOURCE).map((c) => c.id),
    ids,
    "the source column after the refused release",
  );
  assertDeepEqual(
    pileOf(after, "tableau", SOURCE).map((c) => c.faceUp),
    ids.map(() => true),
    "the faces of the returned run",
  );
  assertDeepEqual(
    pileOf(after, "tableau", TARGET).map((c) => c.id),
    [targetId],
    "the column that refused the run, which keeps what it held",
  );
});
