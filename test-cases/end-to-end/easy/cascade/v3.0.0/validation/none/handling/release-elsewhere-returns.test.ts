// handling/release-elsewhere-returns — a release whose leading card's centre
// lies in no pile's drop rectangle puts the whole run back in the column it was
// lifted from.
//
// `specs/controls.md` fixes it: where the leading card's centre lies "In no
// pile's rectangle" the result is "The run returns to the pile it was lifted
// from". `specs/table.md` fixes which points those are: the thirteen rectangles
// are card footprints in the top row and column-wide strips beneath it, "no two
// of the thirteen rectangles overlap and a point lies in at most one of them. A
// point in none of them lies on no pile."
//
// WHERE THE RUN IS RELEASED, AND WHY THERE. The centre is carried into the middle
// of the `22`-unit gap between two columns, at the height of the columns
// themselves. `specs/table.md` states that "The gaps between the columns carry no
// pile", so this is a point in none of the thirteen rectangles that is
// nonetheless surrounded by them. A build that resolves a release to the nearest
// pile, or that widens a column's rectangle to its pitch rather than to `CARD_W`,
// lands the run on a column and fails; a build that resolves against the stated
// rectangles returns it.
//
// WHAT THE POSE DISTINGUISHES. The run is headed by a KING and the two columns
// flanking the release point are both EMPTY, which `specs/tableau.md` says is
// exactly the run an empty column accepts. So a build that resolves the release
// to a neighbouring column really does land the run there, and reads as a
// different board rather than being clamped back into the right answer by a
// refusal it would have made anyway. Three cards are carried, so the order of the
// return is observable too.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  card,
  captureStill,
  columnCardTops,
  createHarness,
  dragRunTo,
  openTable,
  pileOf,
  poseColumn,
  runDown,
  type Harness,
} from "../harness";
import { CARD_H, CARD_W, COLUMN_X, TABLEAU_Y } from "../constants";

/** Where the run is lifted from: three cards in run order, headed by a King. */
const SOURCE = 0;
const RUN_TOP = "KS";
const RUN_LENGTH = 3;

/** The two columns the release point falls between, both of them empty. */
const LEFT_OF_GAP = 1;
const RIGHT_OF_GAP = 2;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the run when the release lands on no pile at all", async () => {
  await openTable(h);
  const ids = await poseColumn(h, SOURCE, [
    ...runDown(card(RUN_TOP), RUN_LENGTH),
  ]);

  // The press lands on the band the second card leaves visible, so it lifts the
  // run's heading card and both cards below it.
  const tops = columnCardTops([true, true, true]);
  const pressX = COLUMN_X[SOURCE] + CARD_W / 2;
  const pressY = (tops[0] + tops[1]) / 2;

  // The middle of the gap between two columns, at the height of a column's first
  // card: inside no rectangle `specs/table.md` fixes.
  const landingX =
    (COLUMN_X[LEFT_OF_GAP] + CARD_W + COLUMN_X[RIGHT_OF_GAP]) / 2;
  const landingY = TABLEAU_Y + CARD_H / 2;

  await dragRunTo(h, pressX, pressY, landingX, landingY);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "returned");

  const after = await h.snapshot();
  assertDeepEqual(
    pileOf(after, "tableau", SOURCE).map((c) => c.id),
    ids,
    "the source column after the release onto no pile",
  );
  assertLength(
    pileOf(after, "tableau", LEFT_OF_GAP),
    0,
    "the column to the left of the release point",
  );
  assertLength(
    pileOf(after, "tableau", RIGHT_OF_GAP),
    0,
    "the column to the right of the release point",
  );
});
