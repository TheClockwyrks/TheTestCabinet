// table/compression-floor — the compressed offset stops at 14 and goes no lower.
//
// THE RULE. specs/table.md floors the fit: "The reduced offset never falls below
// `FACE_UP_OFFSET_MIN` (`14`), and a column long enough to demand less than `14`
// draws `14`." So past a certain length the column stops shrinking and is allowed
// to pass `COLUMN_BOTTOM_LIMIT` instead — the floor is what keeps a card's rank
// and suit readable where a fit taken to its conclusion would hide them.
//
// THE SCENARIO POSES THE DISTINGUISHING LENGTH. Thirty face-up cards leave the fit
// `676 - 140 - 180 = 356` units for twenty-nine gaps, so the value the column
// DEMANDS is `356 / 29 = 12.28`. A build that honours the floor draws `14`; a
// build that reduces without one draws `12.28`. The two read as different numbers
// `1.72` apart, so the failure names which of the two models the build implemented
// rather than reporting a column merely wrong.
//
// A column this long overruns the bottom limit, at `180 + 29 x 14 + 140 = 726`,
// and specs/table.md means it to: the floor is stated as an exception to the fit,
// so `table/column-compression`'s line is not what this point reads and a build
// that clamps the column back onto `676` fails here, which is the requirement.
//
// EVERY GAP IS READ, not just one, because "draws `14`" is a statement about the
// whole column: a build that floors the first gaps and lets the rest run under
// the floor is named here.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength } from "../assert";
import { FACE_UP_OFFSET_MIN } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { drawnColumnGaps } from "./geometry";

/**
 * How far a drawn gap may sit from `FACE_UP_OFFSET_MIN`, in logical units.
 *
 * `14` is exact in specs/table.md. This is tighter than the two units the rest of
 * this group allows a stroke, and deliberately: the value this column demands
 * WITHOUT the floor is `12.28`, only `1.72` away, so a two-unit window would admit
 * the very build the point exists to catch. One unit is still ample for a build
 * that lays its cards on whole logical units, which turns `14` into `14`.
 */
const OFFSET_TOLERANCE = 1;

/** The column the run is posed on. */
const COLUMN = 1;

/**
 * How many cards the column holds.
 *
 * Chosen so the column demands `356 / 29 = 12.28`, comfortably under the floor and
 * well clear of {@link OFFSET_TOLERANCE}, while staying a pile of ordinary cards
 * rather than an extreme: thirty is well inside one fifty-two card deck.
 */
const COUNT = 30;

/** Thirty face-up cards. Which cards they are decides nothing here. */
const CARDS = Array.from({ length: COUNT }, (_, i) => `${(i % 9) + 2}D`);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("draws the minimum offset for a column that demands less", async () => {
  openTable(harness);
  poseColumn(harness, COLUMN, CARDS);

  const calls = await drawFrame(harness);
  captureStill(harness, "floored");

  const gaps = drawnColumnGaps(harness, calls);
  assertLength(
    gaps,
    COUNT - 1,
    `gaps drawn in the column, which was posed with ${COUNT} cards`,
  );

  for (let row = 0; row < gaps.length; row += 1) {
    assertBetween(
      gaps[row],
      FACE_UP_OFFSET_MIN - OFFSET_TOLERANCE,
      FACE_UP_OFFSET_MIN + OFFSET_TOLERANCE,
      `the drawn gap under the card at row ${row} of a ${COUNT}-card column, ` +
        `which demands 12.28 and so draws FACE_UP_OFFSET_MIN (specs/table.md)`,
    );
  }
});
