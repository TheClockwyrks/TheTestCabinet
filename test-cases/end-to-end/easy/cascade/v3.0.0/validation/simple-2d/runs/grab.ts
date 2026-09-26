// runs — where to press a card that is fanned in a column, and where to release
// the run it lifts. LOCAL TO THIS GROUP.
//
// WHY THIS IS NOT `pressPoint`. The harness's `pressPoint` aims at a card's
// center, which is the right point on a squared pile and the wrong one in a
// column: specs/table.md fans a column's cards `FACE_UP_OFFSET` (34) apart and
// specs/table.md gives every card a `CARD_H` (140) footprint, so a card's center
// lies 70 units below its own top edge and therefore inside the footprints of the
// two cards fanned below it. specs/controls.md resolves a press to "the lowest of
// the cards whose footprint contains that point", so a press at a middle card's
// center lifts a card two rows lower than the one intended. Only the column's
// lowest card, which nothing is drawn over, is safely pressed at its center.
//
// So a check that grabs a NAMED row aims at the strip of that card nothing else is
// drawn over: from its own top edge down to the top edge of the card fanned below
// it, and the whole card for the lowest one. That strip is where a player sees the
// card, and it is the only region specs/controls.md resolves to it.
//
// THESE AIM; THEY DO NOT GRADE. Every figure here is read out of the harness's own
// geometry, which restates specs/table.md's anchors, offsets and compression rule.
// A check whose REQUIREMENT is the geometry states its own figures and reads what
// the build drew; nothing in this group does.

import { CARD_H, CARD_W, COLUMN_X } from "../constants";
import {
  columnCardTops,
  dropRect,
  facesOf,
  pileOf,
  type CascadeSnapshot,
  type PileKind,
  type Point,
} from "../harness";

/** A press aimed at one card of a column, and where it lies inside that card. */
export interface Grab {
  /** The point to press to lift the card at that row. */
  at: Point;
  /** Where {@link Grab.at} lies inside the pressed card, from its top-left. */
  hold: Point;
}

/**
 * The press that lifts the card at `row` of column `col`.
 *
 * Horizontally the middle of the card, vertically the middle of the strip the fan
 * leaves it showing: half the gap to the card below, or half a card for the lowest
 * one. specs/controls.md resolves that point to this card and to no other.
 */
export function columnGrab(
  snapshot: CascadeSnapshot,
  col: number,
  row: number,
): Grab {
  const tops = columnCardTops(facesOf(pileOf(snapshot, "tableau", col)));
  const top = tops[row];
  const strip = row + 1 < tops.length ? tops[row + 1] - top : CARD_H;
  const hold = { x: CARD_W / 2, y: strip / 2 };
  return { at: { x: COLUMN_X[col] + hold.x, y: top + hold.y }, hold };
}

/**
 * The release that puts the held run's leading card top-left at `target`.
 *
 * specs/controls.md has a held run keep "the offset between the press point and
 * the leading card's top-left", so the pointer has to be carried to the wanted
 * top-left plus that offset.
 */
export function releaseFor(grab: Grab, target: Point): Point {
  return { x: target.x + grab.hold.x, y: target.y + grab.hold.y };
}

/**
 * The release that lands the held run's leading card's CENTER on the center of a
 * pile's drop rectangle, which is well inside it whatever the pile holds.
 *
 * specs/controls.md resolves a drop by that center, so this is the release that
 * offers the run to that pile and to no other.
 */
export function releaseOn(
  snapshot: CascadeSnapshot,
  grab: Grab,
  pile: PileKind,
  index = 0,
): Point {
  const rect = dropRect(snapshot, pile, index);
  return releaseFor(grab, {
    x: rect.x + rect.w / 2 - CARD_W / 2,
    y: rect.y + rect.h / 2 - CARD_H / 2,
  });
}
