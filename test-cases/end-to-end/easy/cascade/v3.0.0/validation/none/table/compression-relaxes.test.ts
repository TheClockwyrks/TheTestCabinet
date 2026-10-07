// table/compression-relaxes — a column that lost cards draws the full 34 again.
//
// THE RULE. `specs/table.md`, closing the long-column paragraph: "The fit is made
// per column and per frame, so a column that compressed and then lost cards draws
// the full `34` offset again." The compression is a consequence of the column's
// length recomputed every frame, not a state a column enters and keeps.
//
// THE POSE, AND WHY IT HAS TO BE A DRIVE. What separates this point from
// `table/face-up-offset` is nothing about the final column — it is the HISTORY
// behind it. A build that computes its fit once and latches it draws exactly the
// same short column as a conformant build if that column was never long, and
// exactly the wrong one if it was. So column 2 — the one column anchor no top-row
// pile shares, so every card-sized shape at `x = 468` is that column's — is posed
// with fifteen face-up cards, well into the compressed case (`796` natural
// against the `676` line, fitted to `25.43`), and its lowest card is then taken
// off one at a time until eleven are left.
//
// AND WHY ELEVEN. Eleven face-up cards is the longest column that needs no
// compression at all: `180 + 34 x 10 + 140 = 660`, inside `COLUMN_BOTTOM_LIMIT`
// (`676`), where twelve would reach `694` and still be fitted, to `32.36`. So the
// column crosses out of the compressed case on the last card taken off, and the
// four lengths before it — `25.43`, `27.38`, `29.67`, `32.36` — are the column
// visibly relaxing on the way, which is what the item's `relaxing` replay shows.
//
// A CARD IS TAKEN OFF THROUGH THE SURFACE, not played off through the rules. What
// the rule is about is the layout a frame derives from the column it is handed;
// how a card comes to leave a column is `handling`'s and `tableau`'s, and routing
// this through a legal move would charge a broken grab or a broken drop to this
// point.
//
// WHAT IS READ, AND IN ONE DIRECTION. The ten gaps of the final, eleven-card
// column, each against `FACE_UP_OFFSET` (`34`). A build that latched the fit it
// first computed draws `25.43` there, eight and a half units under. The compressed
// state on the way in is NOT asserted: a build that never compresses at all draws
// `34` throughout and honestly passes this point, and is docked for not
// compressing at `table/column-compression`, which is the point that owns it.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength } from "../assert";
import {
  CARD_H,
  COLUMN_BOTTOM_LIMIT,
  COLUMN_X,
  FACE_UP_OFFSET,
  TABLEAU_Y,
} from "../constants";
import {
  captureReplay,
  columnOfCards,
  columnRowTops,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";

/** The column posed: the one anchor no top-row pile shares (`468`). */
const COLUMN = 2;

/**
 * Fifteen face-up cards to begin with: a natural extent of `796` against the
 * `676` line, so the column opens squarely in the compressed case, fitted to
 * `25.43`.
 */
const CARDS_AT_FIRST = 15;

/**
 * Eleven face-up cards at the end: the longest column the natural offset already
 * fits above the line, so the column has left the compressed case entirely and
 * `specs/table.md` gives it the full `34`.
 */
const CARDS_AT_LAST = 11;

/** The gaps that column has, one under each card but the lowest. */
const GAPS_AT_LAST = CARDS_AT_LAST - 1;

/**
 * How far a painted shape's size may sit from the card footprint, and its left
 * edge from the column's anchor, to be read as one of that column's cards, in
 * logical units: room for the unit a build loses insetting a stroke, on a
 * footprint `table/card-size` grades. It stays well under the `25.43` the column
 * opens at, so two of its cards are never merged into one row.
 */
const CARD_SIZE_TOLERANCE = 2;

/**
 * How far a gap of the relaxed column may sit from `34`, in logical units.
 *
 * `FACE_UP_OFFSET` is a whole number and an eleven-card column needs no
 * compression, so the offset the specification gives it is exactly `34`; a gap is
 * the difference of two rows, so whatever constant inset a build draws its cards
 * with cancels, and one unit is room for a build that rounds each row's `y`. The
 * value a build that latched its compressed fit would draw, `25.43`, is eight and
 * a half units outside it, and the nearest wrong model of all — a build that
 * recomputes the fit but off by one card, leaving `32.36` — is still `1.64`
 * outside.
 */
const OFFSET_TOLERANCE = 1;

/**
 * Frames each length is held for while the recording runs.
 *
 * Nothing is read from them and no threshold rests on them: every reading is
 * taken from the frame the removal left. At the harness's 240 Hz step this is an
 * eighth of a second per length, which gives a reviewer's player a moment on each
 * one rather than five frames of a flicker.
 */
const HOLD_FRAMES = 30;

/** The gaps between consecutive rows, in order. */
function gapsOf(rows: readonly number[]): number[] {
  return rows.slice(1).map((y, index) => y - rows[index]);
}

/** A gap written out to a hundredth of a unit, for a failure message. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the full 34 offset again once the column has shortened", async () => {
  await openTable(h);
  const ids = await poseColumn(h, COLUMN, columnOfCards(CARDS_AT_FIRST));

  const drive = await captureReplay(h, "relaxing", async () => {
    const seen: { cards: number; rows: number[] }[] = [
      {
        cards: CARDS_AT_FIRST,
        rows: columnRowTops(await h.frameCalls(), COLUMN, CARD_SIZE_TOLERANCE),
      },
    ];
    await h.advance(HOLD_FRAMES);
    for (let held = CARDS_AT_FIRST; held > CARDS_AT_LAST; held -= 1) {
      // The column's lowest card: the last id `poseColumn` handed back, counted
      // down as the column shortens.
      await h.debug.removeCard(ids[held - 1]);
      seen.push({
        cards: held - 1,
        rows: columnRowTops(await h.frameCalls(), COLUMN, CARD_SIZE_TOLERANCE),
      });
      await h.advance(HOLD_FRAMES);
    }
    return seen;
  });

  const last = drive[drive.length - 1];
  assertLength(
    last.rows,
    CARDS_AT_LAST,
    `rows the ${CARDS_AT_LAST} cards left on column ${COLUMN} were drawn on, ` +
      "read as the distinct top edges of the card-sized shapes at x = " +
      `${COLUMN_X[COLUMN]} (specs/table.md)`,
  );

  /** The lengths the column passed through, and the gaps it drew at each. */
  const progression = drive
    .map(
      ({ cards, rows }) =>
        `${cards} cards: ${gapsOf(rows).map(round).join(", ")}`,
    )
    .join("; ");

  const gaps = gapsOf(last.rows);
  for (const [index, gap] of gaps.entries()) {
    assertBetween(
      gap,
      FACE_UP_OFFSET - OFFSET_TOLERANCE,
      FACE_UP_OFFSET + OFFSET_TOLERANCE,
      `the drop from card ${index + 1} to card ${index + 2} of a column that ` +
        `was ${CARDS_AT_FIRST} cards long and compressed, and has since lost ` +
        `${CARDS_AT_FIRST - CARDS_AT_LAST} cards: at ${CARDS_AT_LAST} cards ` +
        `its natural extent is ` +
        `${TABLEAU_Y + FACE_UP_OFFSET * GAPS_AT_LAST + CARD_H}, inside ` +
        `COLUMN_BOTTOM_LIMIT (${COLUMN_BOTTOM_LIMIT}), so the fit made this ` +
        `frame demands no compression and the column draws the full ` +
        `FACE_UP_OFFSET (${FACE_UP_OFFSET}) again (specs/table.md). The gaps ` +
        `it drew as it shortened were — ${progression}`,
    );
  }
});
