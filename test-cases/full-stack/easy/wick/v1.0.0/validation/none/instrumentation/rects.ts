// instrumentation/rects — what the checks about the two rectangle readings
// share: what a reported rectangle must be, and how the position a rectangle
// stands at is told from the item it belongs to.
//
// WHAT A RECTANGLE IS. `specs/instrumentation.md` (`menuRects()`): "each a plain
// object carrying `x`, `y`, `width`, and `height` in stage coordinates, `0` to
// `STAGE_W` across and `0` to `STAGE_H` down, which are the coordinates the
// pointer is read in"; `tabRects()` reports its own "in the same stage
// coordinates". So a rectangle is decided by its four numbers naming an area of
// the stage, and by nothing else: `specs/ui.md` ("Presentation") fixes "no
// palette, no font, no layout, and no styling", so WHERE on the stage a build
// lays its menu out is the build's and no check here reads it.
//
// WHICH ITEM A RECTANGLE BELONGS TO. The specification answers that through the
// pointer and through nothing else: "Each rectangle is the area a hover or a
// click selects that item inside, so what this reading reports is what the
// pointer rules of `specs/controls.md` act on." Those rules read "the rectangle
// at position `i` belongs to the item at `menuIndex` `i`" on `title`,
// `levelup`, `paused`, `fallen` and `dawn`, and "the entry at `menuIndex`
// `almanacScroll + i`" on `almanac`. So the order a reading reports in is read
// by resting the pointer inside a rectangle and reading `menuIndex` back, never
// off where on the stage the rectangle sits.

import { assertEqual, assertTrue, fail } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { centerOf, hoverAt, type Harness, type RectView } from "../harness";

/** "each a plain object carrying `x`, `y`, `width`, and `height`". */
export const RECT_FIELDS = ["x", "y", "width", "height"] as const;

/**
 * How far outside the stage a rectangle's edge may fall, in stage units.
 *
 * The case's own allowance, not the specification's: the bound is `0` to
 * `STAGE_W` across and `0` to `STAGE_H` down, and one unit covers a build that
 * lays a menu flush to an edge and rounds the figure it reports. A rectangle
 * belonging to some other coordinate system — the canvas's CSS pixels, or the
 * page's — misses the stage by far more than a unit at any window size the
 * suite opens.
 */
export const STAGE_EDGE_TOL = 1;

/**
 * The rectangle carries the four documented numbers and names an area of the
 * stage, or the point fails.
 */
export function assertRect(rect: RectView, what: string): void {
  const fields = rect as unknown as Record<string, unknown>;
  for (const field of RECT_FIELDS) {
    const value = fields[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(`${what}: a finite number at ${field}`, value);
    }
  }
  assertTrue(rect.width > 0, `${what}: width above 0`);
  assertTrue(rect.height > 0, `${what}: height above 0`);
  assertTrue(
    rect.x >= -STAGE_EDGE_TOL &&
      rect.x + rect.width <= STAGE_W + STAGE_EDGE_TOL,
    `${what}: x ${rect.x} and width ${rect.width} inside the stage's 0 to ${STAGE_W}`,
  );
  assertTrue(
    rect.y >= -STAGE_EDGE_TOL &&
      rect.y + rect.height <= STAGE_H + STAGE_EDGE_TOL,
    `${what}: y ${rect.y} and height ${rect.height} inside the stage's 0 to ${STAGE_H}`,
  );
}

/** Every rectangle of the list carries the four numbers and stands on the stage. */
export function assertRects(rects: readonly RectView[], what: string): void {
  rects.forEach((rect, index) => assertRect(rect, `${what}[${index}]`));
}

/**
 * Rest the pointer in the middle of `rects[position]` and read back the
 * `menuIndex` it selects, which is the item that rectangle belongs to.
 */
export async function selectedFrom(
  h: Harness,
  rects: readonly RectView[],
  position: number,
): Promise<number> {
  const rect = rects[position];
  if (rect === undefined) {
    fail(`a rectangle at position ${position}`, rects.length);
  }
  return (await hoverAt(h, centerOf(rect))).menuIndex;
}

/**
 * The rectangle at `position` belongs to the item at `menuIndex` `expected`, or
 * the point fails.
 */
export async function assertBelongsTo(
  h: Harness,
  rects: readonly RectView[],
  position: number,
  expected: number,
  what: string,
): Promise<void> {
  assertEqual(await selectedFrom(h, rects, position), expected, what);
}

/**
 * The positions of a menu of `count` items, visited so that every hover moves
 * the highlight off where it stood: `1, 2, ... count - 1, 0`, from a menu that
 * opens at `menuIndex` `0`.
 */
export function movingOrder(count: number): number[] {
  return Array.from({ length: count }, (_, k) => (k + 1) % count);
}
