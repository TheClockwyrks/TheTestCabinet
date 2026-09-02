// table/compression-relaxes — a column that lost cards draws the full 34 again.
//
// THE RULE. specs/table.md makes the fit a per-frame decision rather than a
// property a column acquires: "The fit is made per column and per frame, so a
// column that compressed and then lost cards draws the full `34` offset again."
// The failure it rules out is a build that computes its offset once — when the
// column is built, or when a card is added — and keeps drawing it after the column
// has shrunk back inside the table.
//
// THE SCENARIO IS ONE COLUMN THAT CROSSES THE LINE FROM ABOVE. Thirteen face-up
// cards reach `180 + 12 x 34 + 140 = 728` at the natural offset, so the column is
// fitted and draws `29.67`. Two cards are then taken off it, and eleven reach
// `180 + 10 x 34 + 140 = 660`, sixteen units clear of `COLUMN_BOTTOM_LIMIT`
// (`676`), so the specification's own arithmetic gives the shortened column the
// full `34` — while a build that cached its fit still draws `29.67`. The two
// models read as different numbers, `4.33` apart.
//
// THE CARDS ARE TAKEN OFF THROUGH `removeCard`, one at a time, rather than by
// playing them. A drag onto a foundation would charge a broken grab or a broken
// drop resolution to this point, which `handling.press-grabs-column-run` and
// `handling.release-on-legal-completes` own; every card in the column is face-up
// already, so nothing turns as they go and `autoFlip` never enters into it.
//
// WHAT IS ASSERTED IS THE SHORTENED COLUMN'S GAPS. Whether the thirteen-card
// column was fitted in the first place is `table/column-compression`; a build that
// never compresses passes here because it does draw `34` after the removals, and
// its fault is named there.
//
// THE REPLAY IS THE SHRINKING ITSELF, a handful of frames on each of the three
// lengths, so a reviewer sees the fan open out as the cards come off rather than
// two still pictures.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength } from "../assert";
import { FACE_UP_OFFSET } from "../constants";
import {
  captureReplay,
  createHarness,
  drawFrame,
  openTable,
  poseColumn,
  RANK_LABELS,
  type Harness,
} from "../harness";
import { drawnColumnGaps } from "./geometry";

/**
 * How far a drawn gap may sit from `FACE_UP_OFFSET`, in logical units.
 *
 * `34` is exact in specs/table.md; this is the unit a build may lose insetting a
 * stroke inside the footprint it draws, the same room `harness.ts` reads a
 * card-sized box with (`CARD_BOX_TOLERANCE`). A build still drawing the fit the
 * longer column demanded reads `29.67`, more than twice this away.
 */
const OFFSET_TOLERANCE = 2;

/** Frames held on each length, so the replay shows the column at rest. */
const FRAMES_PER_LENGTH = 12;

/** The column the run is posed on. */
const COLUMN = 4;

/** Thirteen face-up clubs, King down to Ace: long enough to be fitted. */
const CARDS = [...RANK_LABELS].reverse().map((label) => `${label}C`);

/** How many are taken off, leaving a column that fits at the full offset. */
const REMOVED = 2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("returns a shortened column to the full face-up offset", async () => {
  openTable(harness);
  const ids = poseColumn(harness, COLUMN, CARDS);

  await captureReplay(harness, "relaxing", async () => {
    await harness.advance(FRAMES_PER_LENGTH);
    for (let taken = 0; taken < REMOVED; taken += 1) {
      harness.debug.removeCard(ids[ids.length - 1 - taken]);
      await harness.advance(FRAMES_PER_LENGTH);
    }
  });

  const remaining = CARDS.length - REMOVED;
  const calls = await drawFrame(harness);
  const gaps = drawnColumnGaps(harness, calls);
  assertLength(
    gaps,
    remaining - 1,
    `gaps drawn in the column after ${REMOVED} of its ${CARDS.length} cards ` +
      `were taken off`,
  );

  for (let row = 0; row < gaps.length; row += 1) {
    assertBetween(
      gaps[row],
      FACE_UP_OFFSET - OFFSET_TOLERANCE,
      FACE_UP_OFFSET + OFFSET_TOLERANCE,
      `the drawn gap under the card at row ${row} of a column that was ` +
        `compressed at ${CARDS.length} cards and now holds ${remaining}, ` +
        `which fits at the full FACE_UP_OFFSET (specs/table.md)`,
    );
  }
});
