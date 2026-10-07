// instrumentation/rects — what the two rectangle readings of the debug surface
// are checked against, shared by the four points that read them.
// CASE-PROVIDED.
//
// No review item names this file. Everything here is a restatement of a
// sentence the specification already carries: the shape of a `WickRect`, the
// stage the rectangles are reported in, and the rule that no two of a screen's
// rectangles overlap.

import {
  assertEqual,
  assertFalse,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { centerOf, type WickRect } from "../harness";

/**
 * One rectangle carries the four documented fields, each a finite number, and
 * covers ground: "each a plain object carrying `x`, `y`, `width`, and `height`
 * in stage coordinates" (specs/instrumentation.md, Menus), and a rectangle a
 * hover or a click selects an item inside has to have an inside.
 */
export function assertRectShape(rect: WickRect, context: string): void {
  for (const field of ["x", "y", "width", "height"] as const) {
    assertEqual(typeof rect[field], "number", `${context}.${field}`);
    assertTrue(Number.isFinite(rect[field]), `${context}.${field} is finite`);
  }
  assertGreaterThan(rect.width, 0, `${context}.width`);
  assertGreaterThan(rect.height, 0, `${context}.height`);
}

/**
 * The rectangle's middle lands on the stage, "`0` to `STAGE_W` across and `0`
 * to `STAGE_H` down, which are the coordinates the pointer is read in"
 * (specs/instrumentation.md, Menus). The middle rather than the whole box,
 * because where a build sets the edges of a row band is the build's; a
 * rectangle whose middle is off the stage is one no pointer can reach.
 */
export function assertRectOnStage(rect: WickRect, context: string): void {
  const at = centerOf(rect);
  assertTrue(
    at.x >= 0 && at.x <= STAGE_W && at.y >= 0 && at.y <= STAGE_H,
    `${context} lies on the stage: its middle is (${at.x}, ${at.y})`,
  );
}

/** Whether two rectangles share any ground. */
function overlaps(a: WickRect, b: WickRect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * "no two of a screen's rectangles overlap" (specs/controls.md, The pointer),
 * which is what makes the item a point falls in unambiguous.
 */
export function assertDisjoint(
  rects: readonly WickRect[],
  context: string,
): void {
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      assertFalse(
        overlaps(rects[i], rects[j]),
        `${context}: rectangles ${i} and ${j} overlap`,
      );
    }
  }
}

/**
 * The rectangles are reported in the order the menu stacks its items: each
 * one's middle sits below the last. specs/ui.md stacks every vertical menu in
 * the order its constant lists it, the title menu's "items are stacked one
 * above the next", the level-up overlay's offers are "listed vertically in that
 * order", and the pause and end menus carry their two items "in that order".
 */
export function assertStackedDownward(
  rects: readonly WickRect[],
  context: string,
): void {
  for (let i = 1; i < rects.length; i += 1) {
    assertGreaterThan(
      centerOf(rects[i]).y,
      centerOf(rects[i - 1]).y,
      `${context}: rectangle ${i} sits below rectangle ${i - 1}`,
    );
  }
}

/** Every rectangle of one reading, checked for shape, stage, and disjointness. */
export function assertRects(
  rects: readonly WickRect[],
  count: number,
  context: string,
): void {
  assertLength(rects, count, context);
  for (const [i, rect] of rects.entries()) {
    assertRectShape(rect, `${context}[${i}]`);
    assertRectOnStage(rect, `${context}[${i}]`);
  }
  assertDisjoint(rects, context);
}
