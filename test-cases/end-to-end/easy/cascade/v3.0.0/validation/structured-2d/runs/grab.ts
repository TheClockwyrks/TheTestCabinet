// runs — where to press a card fanned in a column, and where to release the run
// it lifts. GROUP-LOCAL.
//
// The harness already knows WHERE to press: `grabPoint` returns the point
// specs/controls.md resolves to the card at a given row, which in a column is the
// band between that card's own top edge and the top edge of the card fanned below
// it, because "a press resolves to the card drawn over every other card at the
// press point". What the harness does not carry is the other half of a GESTURE:
// where the pointer has to end up for the run it lifted to be offered to a
// particular pile.
//
// specs/controls.md fixes both halves of that. A held run "keeps the offset
// between the press point and the leading card's top-left", so carrying the run
// to a wanted top-left means carrying the POINTER to that top-left plus the
// offset; and a drop "resolves to the pile whose drop rectangle contains the
// center of the run's leading card", so the release that offers the run to a pile
// and to no other is the one that puts that center inside that pile's rectangle.
//
// THESE AIM; THEY DO NOT GRADE. Every figure here is read out of the harness's
// own geometry, which restates specs/table.md's anchors, offsets and compression
// rule. A check whose REQUIREMENT is the geometry states its own figures and
// reads what the build drew; nothing in this group does.

import { CARD_H, CARD_W } from "../../src/constants";
import {
  cardTopLeft,
  dropRectIn,
  grabPoint,
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
 * The press that lifts the card at `row` of column `col`, and the offset the
 * held run keeps from it (specs/controls.md).
 *
 * Both are read off the column as it stands, so a column drawn at a compressed
 * face-up offset is pressed where its cards really are.
 */
export function columnGrab(
  snapshot: CascadeSnapshot,
  col: number,
  row: number,
): Grab {
  const at = grabPoint(snapshot, col, row);
  const topLeft = cardTopLeft(snapshot, "tableau", col, row);
  return { at, hold: { x: at.x - topLeft.x, y: at.y - topLeft.y } };
}

/**
 * The release that puts the held run's leading card's top-left at `target`.
 *
 * The run keeps the offset the press gave it (specs/controls.md), so the pointer
 * has to be carried to the wanted top-left plus that offset.
 */
export function releaseFor(grab: Grab, target: Point): Point {
  return { x: target.x + grab.hold.x, y: target.y + grab.hold.y };
}

/**
 * The release that lands the held run's leading card's CENTER on the center of a
 * pile's drop rectangle, which is well inside it whatever the pile holds.
 *
 * specs/controls.md resolves a drop by that center, and specs/table.md has the
 * thirteen rectangles never overlap, so this is the release that offers the run
 * to that pile and to no other.
 */
export function releaseOn(
  snapshot: CascadeSnapshot,
  grab: Grab,
  pile: PileKind,
  index = 0,
): Point {
  const rect = dropRectIn(snapshot, pile, index);
  return releaseFor(grab, {
    x: rect.x + rect.w / 2 - CARD_W / 2,
    y: rect.y + rect.h / 2 - CARD_H / 2,
  });
}
