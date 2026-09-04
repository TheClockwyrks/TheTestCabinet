// Cascade — reading a drawn column, for the `table` group alone.
//
// Seven of this group's fourteen points ask the same question of a frame: WHERE
// DID THE BUILD PUT THE CARDS OF ONE COLUMN? The two overlap offsets, the
// compression, its floor, its uniformity, what it spares, and its relaxation are
// all differences between the top edges of the cards a column drew, so the reading
// is written once here rather than seven times over.
//
// It reads only. Nothing here holds a threshold: every figure a point asserts is
// stated in that point's own file, derived from specs/table.md, because a
// tolerance hidden in a helper is a requirement nobody can see.
//
// It lives in this directory rather than in `harness.ts` because no other group
// reads a column's drawn geometry: the rules groups read the SNAPSHOT, and the
// handling groups read what a gesture decided.
//
// IT NAMES NO ANCHOR. The column is found as the place the frame drew the most
// cards, not by looking at `COLUMN_X[i]`, and the points that use it pose exactly
// one column on an otherwise empty table so that place is unambiguous. That is
// deliberate: WHERE the seven columns stand is `table/column-anchors` and where
// their first card starts is `table/tableau-anchor-y`, and a build that puts its
// columns on the wrong pitch should fail those two and still have its overlaps and
// its compression graded on the column it actually drew. A helper that looked the
// column up by its anchor would charge one pitch mistake to nine points.
//
// WHY THE BOXES ARE CLUSTERED. A build draws one card with as many calls as it
// likes, and a card commonly gets a filled body and a stroked edge inset a unit or
// two inside it, so ONE card can put several card-sized boxes on the canvas within
// a unit or two of each other. Clustering collapses those back to one card, on
// each axis. A cluster's own edge is the smallest of them, which is the
// footprint's; an inset stroke can only sit inside it.

import { TOP_ROW_Y } from "../constants";
import {
  cardBoxes,
  drawnBoxes,
  type DrawCall,
  type DrawnBox,
  type Harness,
} from "../harness";

/**
 * How far two card-sized boxes' left edges may differ and still be read as cards
 * of the same column, in logical units.
 *
 * The same room `harness.ts` gives a card-sized box for the unit an inset stroke
 * or a rounded corner costs (`CARD_BOX_TOLERANCE`). Two columns are `122` apart
 * on the pitch specs/table.md fixes, sixty times this, so nothing within it can
 * belong to a neighbouring column.
 */
export const COLUMN_X_MATCH = 2;

/**
 * How far a drawn box's size may sit from the card footprint and still be SEARCHED
 * for as a card, in logical units.
 *
 * One unit wider than the `CARD_BOX_TOLERANCE` `harness.ts` reads a card-sized box
 * with, and only because this is a search rather than a reading: whether a card
 * covers `100 x 140` is `table/card-size`, which asserts the footprint at the
 * tolerance specs/table.md's exactness earns; every other point in this group only
 * has to FIND the card whose position it is about. A build that draws its card as a
 * stroke inset a unit or two inside the footprint hands back `98 x 138` or
 * `97 x 137`, on or just past the reading tolerance's edge, and the fractional top
 * edges compression produces are enough to carry such a box across it — so a search
 * at the same figure could lose a card and report a pile empty or a column short.
 * The nearest thing on the table to a card's size is an empty slot's inset edge at
 * `96 x 136` (specs/table.md gives the mark itself the full footprint), four units
 * out, so this cannot take anything that is not a card.
 */
export const CARD_SEARCH_TOLERANCE = 3;

/**
 * How close two card-sized boxes' top edges must be to be read as one card, in
 * logical units.
 *
 * The smallest gap specs/table.md allows between two cards of a column is
 * `FACE_UP_OFFSET_MIN` (`14`), so two boxes within a quarter of that are two calls
 * drawing one card rather than two cards. It is well clear of the unit or two an
 * inset stroke costs.
 */
export const ROW_MATCH = 3.5;

/**
 * The distinct top edges among a set of card-sized boxes, in ascending order: one
 * entry per card, whatever calls the build drew each card with.
 *
 * Boxes within {@link ROW_MATCH} of one another are one card, and the entry is the
 * smallest of them, which is the footprint's own edge.
 */
export function clusterTops(boxes: readonly DrawnBox[]): number[] {
  const tops = boxes.map((box) => box.y).sort((a, b) => a - b);
  const rows: number[] = [];
  for (const top of tops) {
    if (rows.length === 0 || top - rows[rows.length - 1] > ROW_MATCH) {
      rows.push(top);
    }
  }
  return rows;
}

/**
 * The top edge of every card of the fanned column the frame drew, from its first
 * card down.
 *
 * WHICH COLUMN IT ANSWERS FOR. The one with the most cards in it. Every point that
 * calls this poses ONE column on a table `openTable` has emptied, so the twelve
 * other piles hold no cards and draw a single card-sized slot mark each
 * (specs/table.md): the posed column is the only place on the table where more
 * than two cards stand one above another, and it wins whatever `x` the build drew
 * it at. A build that drew none of the column's cards answers with a slot mark's
 * lone edge, and the caller's own count assertion names that.
 *
 * THE TOP ROW IS SET ASIDE FIRST, by its own top edge, `TOP_ROW_Y` (`24`), which
 * specs/table.md fixes for the whole row and which is `156` above `TABLEAU_Y`.
 * Five of the seven columns stand under a top-row pile — the stock and the waste
 * over columns `0` and `1`, the four foundations over columns `3` to `6` — so that
 * pile's own mark shares their `x` and would otherwise be counted into them.
 */
export function drawnColumnTops(
  h: Harness,
  calls: readonly DrawCall[],
): number[] {
  const boxes = cardBoxes(drawnBoxes(h, calls), CARD_SEARCH_TOLERANCE).filter(
    (box) => Math.abs(box.y - TOP_ROW_Y) > ROW_MATCH,
  );

  let longest: number[] = [];
  for (const column of groupByLeftEdge(boxes)) {
    const tops = clusterTops(column);
    if (tops.length > longest.length) longest = tops;
  }
  return longest;
}

/** The gap the frame drew under each card of that column but its lowest. */
export function drawnColumnGaps(
  h: Harness,
  calls: readonly DrawCall[],
): number[] {
  const tops = drawnColumnTops(h, calls);
  return tops.slice(1).map((top, i) => top - tops[i]);
}

/** The boxes, gathered into the columns their left edges put them in. */
function groupByLeftEdge(boxes: readonly DrawnBox[]): DrawnBox[][] {
  const sorted = [...boxes].sort((a, b) => a.x - b.x);
  const columns: DrawnBox[][] = [];
  let edge = Number.NEGATIVE_INFINITY;
  for (const box of sorted) {
    if (box.x - edge > COLUMN_X_MATCH) {
      columns.push([]);
      edge = box.x;
    }
    columns[columns.length - 1].push(box);
  }
  return columns;
}

/**
 * The box the frame drew nearest a point, within `radius`, or `null`.
 *
 * How a point whose requirement is the card's SIZE finds the card without first
 * demanding a card-sized box, which would be the question it is asking. The
 * nearest pile is `122` units away, so a generous radius still names one pile's
 * card and no other's.
 */
export function boxNear(
  boxes: readonly DrawnBox[],
  x: number,
  y: number,
  radius: number,
): DrawnBox | null {
  let best: DrawnBox | null = null;
  let bestDistance = radius;
  for (const box of boxes) {
    const distance = Math.hypot(box.x - x, box.y - y);
    if (distance <= bestDistance) {
      best = box;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Whether a drawn box overlaps the vertical band `[left, right]` of the table.
 *
 * What `table/column-anchors` reads the twenty-two-unit gaps between the columns
 * with: a card drawn in a gap is one whose footprint reaches into it, wherever its
 * own left edge sits.
 */
export function overlapsBand(
  box: DrawnBox,
  left: number,
  right: number,
  slack: number,
): boolean {
  return box.x + box.w > left + slack && box.x < right - slack;
}

/**
 * Every card-sized box's top-left, rounded, as the `Actual` of a failed anchor.
 *
 * A point that looked for a card at an anchor and found none has to say what the
 * frame DID draw, or the failure names only the absence.
 */
export function cardCorners(boxes: readonly DrawnBox[]): string[] {
  return boxes.map(
    (box) => `(${Math.round(box.x * 10) / 10}, ${Math.round(box.y * 10) / 10})`,
  );
}
