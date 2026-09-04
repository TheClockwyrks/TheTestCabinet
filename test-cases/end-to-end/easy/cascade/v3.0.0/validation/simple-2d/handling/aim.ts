// handling — aiming a press and a release. GROUP-LOCAL.
//
// `harness.ts` aims the two easy cases: {@link pressPoint} presses a card at its
// CENTER, and {@link releasePoint} releases over a pile's drop rectangle at that
// rectangle's center, and the pairing of the two carries a run's leading card onto
// the target's center because pressing at the center makes the offset between the
// pointer and that center zero.
//
// Two of this group's items cannot use that pairing, because the offset is the
// thing they are about:
//
//   - A press on a card that is not its column's lowest lands on the strip that card
//     leaves uncovered, not on its center: specs/controls.md resolves a press to
//     "the lowest of the cards whose footprint contains that point", so a press at
//     the center of a fanned-over card resolves to a card BELOW it and the check
//     would grade a scenario it never posed.
//   - A release is resolved against the center of the run's LEADING CARD
//     (specs/controls.md), which sits wherever the press offset put it. A check whose
//     requirement is that rule presses off-center on purpose, so a build reading the
//     pointer's own position instead reads a different pile.
//
// Both of these are geometry, not thresholds: they name where a gesture is aimed,
// and every figure a check asserts is stated in the check itself.

import { CARD_H, CARD_W, COLUMN_X } from "../constants";
import {
  cardCenter,
  columnCardTops,
  facesOf,
  pileOf,
  type CascadeSnapshot,
  type Point,
} from "../harness";

/**
 * A point on the strip the card at `row` of a column leaves uncovered, which is
 * where a press resolves to THAT card.
 *
 * A column fans downward, so the card at `row` is overdrawn from the top edge of the
 * card at `row + 1` (specs/table.md), and the band between the two tops is the only
 * part of it drawn over every other card. The point returned is the middle of that
 * band, horizontally centered on the card. A column's lowest card is covered by
 * nothing, so its whole footprint answers and the point is its center.
 *
 * A `row` no card sits at is a fault in the check rather than in the build, so it
 * throws a plain error: a validator that pressed a card that is not there has not
 * decided anything about the game.
 */
export function exposedPressPoint(
  snapshot: CascadeSnapshot,
  col: number,
  row: number,
): Point {
  const faces = facesOf(pileOf(snapshot, "tableau", col));
  if (row < 0 || row >= faces.length) {
    throw new Error(
      `cascade: column ${col} holds ${faces.length} cards, so there is no ` +
        `card at row ${row} to press`,
    );
  }
  const tops = columnCardTops(faces);
  const bottom = tops[row + 1] ?? tops[row] + CARD_H;
  return { x: COLUMN_X[col] + CARD_W / 2, y: (tops[row] + bottom) / 2 };
}

/**
 * The point to release at so the held run's leading card's CENTER lands on `at`.
 *
 * A held run keeps the offset between the press point and the leading card's
 * top-left and travels exactly as far as the pointer does (specs/controls.md), so
 * the vector from the pointer to that card's center is whatever it was on the press
 * and stays that way for the whole gesture. Releasing at `at` less that vector puts
 * the center exactly on `at`.
 *
 * `press` is the point the gesture pressed at, and `leadTopLeft` the top-left the
 * leading card was drawn at when it was pressed.
 */
export function releaseForCenter(
  at: Point,
  press: Point,
  leadTopLeft: Point,
): Point {
  const lead = cardCenter(leadTopLeft.x, leadTopLeft.y);
  return { x: at.x - (lead.x - press.x), y: at.y - (lead.y - press.y) };
}
