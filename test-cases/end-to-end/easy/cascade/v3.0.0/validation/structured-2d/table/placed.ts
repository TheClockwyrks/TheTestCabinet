// Cascade — how the `table` group reads WHERE the build drew. CASE-PROVIDED.
//
// Every point in this group is decided the same way: pose a card somewhere the
// specification fixes a position for, run one frame, and find the CARD-SIZED box
// the frame painted at that position (specs/table.md: "Every card occupies a
// `CARD_W x CARD_H` (`100 x 140`) rectangle. That is its footprint wherever it
// sits"). Nothing here reads the game's state, and nothing here drives a
// pointer: the group's header in the manifest is explicit that a geometry point
// that pressed or released would charge a broken grab rule to the
// `presentation` domain, which does not own it.
//
// WHY A "BOX" AND NOT A CALL. The call a build draws a card with is the build's
// own. The reference fills a plain rectangle; another build rounds the corners
// and draws the same footprint as a path of lines and curves; a third
// pre-renders each face onto an offscreen canvas and blits it. All three put the
// same card in the same place, so all three are read here: `drawnShapes` follows
// the path and reports the box each `fill` or `stroke` covered, `drawnImages`
// reports where a blit landed, and this file is the union of the two, mapped
// back into the stage's logical units by the harness.
//
// NO THRESHOLD LIVES HERE. Every tolerance below is a parameter, stated by the
// check that passes it and derived there from the figure `specs/table.md` fixes.
// This file only counts and sorts.

import { CARD_H, CARD_W, TOP_ROW_Y } from "../../src/constants";
import {
  drawnImages,
  drawnShapes,
  type DrawCall,
  type Harness,
} from "../harness";

/** One thing a frame placed, as the box it covers in the stage's logical units. */
export interface PlacedBox {
  /** How it was placed: the painting call, or `drawImage` for a blit. */
  how: string;
  /** The top-left of the box it covers. */
  x: number;
  y: number;
  /** Its size, always positive. */
  w: number;
  h: number;
}

/** Every box a frame placed, painted or blitted, in the order it was made. */
export function placedBoxes(
  h: Harness,
  calls: readonly DrawCall[],
): PlacedBox[] {
  const boxes: PlacedBox[] = drawnShapes(h, calls).map((shape) => ({
    how: shape.method,
    x: shape.x,
    y: shape.y,
    w: shape.w,
    h: shape.h,
  }));
  for (const image of drawnImages(h, calls)) {
    boxes.push({
      how: "drawImage",
      x: image.x,
      y: image.y,
      w: image.w,
      h: image.h,
    });
  }
  return boxes;
}

/**
 * The boxes whose size is a card's footprint, allowing `sizeTolerance` of each
 * side.
 *
 * `CARD_W x CARD_H` comes from `src/constants.ts`, which is the specification's
 * own figure; how much slack a build gets is the caller's to state, and it is
 * stated as a FRACTION of each side so the allowance is the same proportion
 * across as it is down.
 */
export function cardBoxes(
  h: Harness,
  calls: readonly DrawCall[],
  sizeTolerance: number,
): PlacedBox[] {
  return placedBoxes(h, calls).filter(
    (box) =>
      Math.abs(box.w - CARD_W) <= sizeTolerance * CARD_W &&
      Math.abs(box.h - CARD_H) <= sizeTolerance * CARD_H,
  );
}

/** The boxes whose top-left lies within `tolerance` of `(x, y)`. */
export function boxesAt(
  boxes: readonly PlacedBox[],
  x: number,
  y: number,
  tolerance: number,
): PlacedBox[] {
  return boxes.filter(
    (box) =>
      Math.abs(box.x - x) <= tolerance && Math.abs(box.y - y) <= tolerance,
  );
}

/**
 * The boxes drawn below the top row's own footprint.
 *
 * The specification separates the two rows itself — "The top row's rectangles
 * end at `y = 164` and the columns' begin at `y = 180`" (specs/table.md) — so
 * everything below that line belongs to the tableau. It matters because the
 * stock, the waste and the four foundations stand at six of the seven column
 * positions, and the mark an empty one of them draws is card-sized too.
 */
export function tableauBoxes(boxes: readonly PlacedBox[]): PlacedBox[] {
  return boxes.filter((box) => box.y > TOP_ROW_Y + CARD_H);
}

/**
 * The boxes of the one column a check posed, found WITHOUT assuming which x the
 * build drew it at: the group of boxes sharing a left edge that holds the most
 * of them.
 *
 * A check that poses one column on an otherwise empty table leaves the six other
 * columns showing their empty marks, one box each, so the group holding two or
 * more boxes is the posed column and no other group can outnumber it. Reading it
 * this way is what keeps a column's OFFSETS separate from its ANCHOR: a build
 * that fanned its cards correctly at the wrong x fails `column-anchors` alone,
 * and its gaps are still read here.
 *
 * `tolerance` is how far two boxes' left edges may differ and still be the same
 * column.
 */
export function busiestColumn(
  boxes: readonly PlacedBox[],
  tolerance: number,
): PlacedBox[] {
  const sorted = [...boxes].sort((a, b) => a.x - b.x);
  let best: PlacedBox[] = [];
  let group: PlacedBox[] = [];
  const close = (): void => {
    if (group.length > best.length) best = group;
  };
  for (const box of sorted) {
    if (group.length > 0 && box.x - group[0].x > tolerance) {
      close();
      group = [];
    }
    group.push(box);
  }
  close();
  return best;
}

/** The boxes whose left edge lies within `tolerance` of `x`, at any height. */
export function boxesAtX(
  boxes: readonly PlacedBox[],
  x: number,
  tolerance: number,
): PlacedBox[] {
  return boxes.filter((box) => Math.abs(box.x - x) <= tolerance);
}

/**
 * The distinct top edges among `boxes`, lowest first, merging any two within
 * `tolerance` of each other into one.
 *
 * A column's cards are read as the rows they were drawn at, so a build that
 * fills a card's outline and then strokes the same outline reports one row
 * rather than two. `tolerance` is what counts as the same row, and it is the
 * caller's: a column's gaps are never smaller than `FACE_UP_OFFSET_MIN`.
 */
export function rowTops(
  boxes: readonly PlacedBox[],
  tolerance: number,
): number[] {
  const sorted = boxes.map((box) => box.y).sort((a, b) => a - b);
  const rows: number[] = [];
  let cluster: number[] = [];
  for (const y of sorted) {
    if (cluster.length > 0 && y - cluster[0] > tolerance) {
      rows.push(cluster.reduce((sum, at) => sum + at, 0) / cluster.length);
      cluster = [];
    }
    cluster.push(y);
  }
  if (cluster.length > 0) {
    rows.push(cluster.reduce((sum, at) => sum + at, 0) / cluster.length);
  }
  return rows;
}

/** The gaps between consecutive rows, so `gaps[i]` sits under row `i`. */
export function rowGaps(rows: readonly number[]): number[] {
  return rows.slice(1).map((row, index) => row - rows[index]);
}

/** The top-left corners of `boxes`, rounded, for a failure message. */
export function corners(boxes: readonly PlacedBox[]): string {
  return JSON.stringify(
    boxes.map((box) => [
      Math.round(box.x * 100) / 100,
      Math.round(box.y * 100) / 100,
    ]),
  );
}
