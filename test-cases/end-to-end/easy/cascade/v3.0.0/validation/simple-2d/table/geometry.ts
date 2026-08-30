// Cascade — reading a drawn column, for the `table` group alone.
//
// Seven of this group's fourteen points ask the same question of a frame: WHERE
// DID THE BUILD PUT THE CARDS OF ONE COLUMN? The offsets, the compression, its
// floor, its uniformity, what it spares, and its relaxation are all differences
// between the top edges of the cards a column drew, so the reading is written
// once here rather than seven times over.
//
// It reads only. Nothing here holds a threshold: every figure a point asserts is
// stated in that point's own file, derived from specs/table.md, because a
// tolerance hidden in a helper is a requirement nobody can see.
//
// It lives in this directory rather than in `harness.ts` because no other group
// reads a column's drawn geometry: the rules groups read the SNAPSHOT, and the
// handling groups read what a gesture decided.
//
// WHY THE BOXES ARE CLUSTERED. A build draws one card with as many calls as it
// likes, and a card commonly gets a filled body and a stroked edge inset a unit
// or two inside it, so ONE card can put several card-sized boxes on the canvas
// within a unit or two of each other. Clustering by top edge collapses those back
// to one card. The cluster's own top edge is the smallest of them, which is the
// footprint's edge; an inset stroke can only sit inside it.

import { COLUMN_X } from "../../src/constants";
import {
  cardBoxes,
  drawnBoxes,
  type DrawCall,
  type DrawnBox,
  type Harness,
} from "../harness";

/**
 * How far a drawn box's left edge may sit from a column's own `x` and still be
 * read as a card of that column, in logical units.
 *
 * The same room `harness.ts` gives a card-sized box for the unit an inset stroke
 * or a rounded corner costs (`CARD_BOX_TOLERANCE`). It is a SEARCH radius, not a
 * position tolerance: whether a column's cards sit at `COLUMN_X[i]` at all is
 * `table/column-anchors`, and the next column's own `x` is `122` away, so nothing
 * within this radius can belong to another column.
 */
export const COLUMN_X_MATCH = 2;

/**
 * How close two card-sized boxes' top edges must be to be read as one card, in
 * logical units.
 *
 * The smallest gap specs/table.md allows between two cards of a column is
 * `FACE_UP_OFFSET_MIN` (`14`), so two boxes within a quarter of that are two
 * calls drawing one card rather than two cards. It is well clear of the unit or
 * two an inset stroke costs.
 */
export const ROW_MATCH = 3.5;

/**
 * The top edge of every card a frame drew in column `col`, from the column's
 * first card down.
 *
 * A cluster of card-sized boxes at that column's `x` is one card, and its top
 * edge is the cluster's own. A column drawing no card answers with an empty
 * list — which is what an empty column's slot mark is, since the mark sits at the
 * column's `x` too and is card-sized; a point that poses cards on the column is
 * the only caller, so what comes back is those cards.
 */
export function drawnColumnTops(
  h: Harness,
  calls: readonly DrawCall[],
  col: number,
): number[] {
  return clusterTops(
    cardBoxes(drawnBoxes(h, calls)).filter(
      (box) => Math.abs(box.x - COLUMN_X[col]) <= COLUMN_X_MATCH,
    ),
  );
}

/**
 * The distinct top edges among a set of card-sized boxes, in ascending order:
 * one entry per card, whatever calls the build drew each card with.
 *
 * Boxes within {@link ROW_MATCH} of one another are one card, and the entry is
 * the smallest of them, which is the footprint's own edge.
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

/** The gap the frame drew under each card of a column but its lowest. */
export function drawnColumnGaps(
  h: Harness,
  calls: readonly DrawCall[],
  col: number,
): number[] {
  const tops = drawnColumnTops(h, calls, col);
  return tops.slice(1).map((top, i) => top - tops[i]);
}

/**
 * The card-sized box the frame drew nearest a point, within `radius`, or `null`.
 *
 * How a point whose requirement is the card's SIZE finds the card without first
 * demanding that it sit exactly on its anchor: the anchors are decided by their
 * own points, and the next pile is `122` units away, so a generous radius still
 * names one pile's card and no other's.
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
 * with: a card drawn in a gap is one whose footprint reaches into it, wherever
 * its own left edge sits.
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
