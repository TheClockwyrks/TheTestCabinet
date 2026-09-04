// instrumentation/rects — what a reported rectangle has to be, and how a check
// in this directory finds out WHICH item a rectangle belongs to.
//
// Nothing here asserts a claim of its own; it is the shape test and the
// identification the `menuRects` and `tabRects` checks share.
//
// WHAT A RECTANGLE IS. `specs/instrumentation.md`, "Menus": each is "a plain
// object carrying `x`, `y`, `width`, and `height` in stage coordinates, `0` to
// `STAGE_W` across and `0` to `STAGE_H` down, which are the coordinates the
// pointer is read in". So the four fields are numbers, the extent is real, and
// the area sits where a pointer can reach it. `specs/controls.md`, The
// pointer, adds "no two of a screen's rectangles overlap".
//
// HOW A RECTANGLE IS IDENTIFIED. By what the build DRAWS at it.
// `specs/controls.md`, The pointer: "Each item the menu currently shows
// occupies a rectangle on the stage", and `specs/ui.md` draws every one of
// those items under a name it fixes exactly — `TITLE_ITEMS`, `PAUSE_ITEMS`,
// `END_ITEMS`, the offer names, the almanac's entry names, and `ALMANAC_TABS`.
// The item that occupies a rectangle is therefore the one whose name the frame
// drew there, and that reading is what decides the ORDER a list of rectangles
// is reported in.
//
// HOW CLOSE "THERE" IS. Neither specification says the glyphs of a name sit
// within the edges of the rectangle that selects it: `specs/instrumentation.md`
// gives a rectangle as "the area a hover or a click selects that item inside"
// and fixes nothing about the type set over it. So the reading is deliberately
// slack. Across the stage a run's whole EXTENT is taken, from its anchor, its
// measured width and its alignment, and an extent that shares any span with
// the rectangle reads as that rectangle's: a name written from the rectangle's
// left edge, centered in it, or written back to its right edge all read the
// same. Down the stage an anchor within the rectangle's own bounds is that
// rectangle's, and an anchor outside EVERY rectangle is read as the one it
// lies within the drawn type's own pixel size of, which carries a rectangle
// cut to the cap height of its glyphs and a baseline set above a highlight
// plate. That slack never takes a run another rectangle already holds, so two
// rows stacked one under the other still answer for their own names alone.
//
// WHY NOT THE GEOMETRY, AND WHY NOT THE POINTER. `specs/ui.md` leaves every
// layout to the build, so an order read off where the rectangles sit would be
// asserting a placement no specification fixes. An order read by pointing at a
// rectangle and reading the selection back decides nothing either: a build
// that hit-tests the pointer against the very list it reports answers
// consistently whatever order that list is in, so the reading can never
// disagree with it. What the frame drew is outside that circle.

import {
  assertFalse,
  assertGreaterThan,
  assertHasProperty,
  assertTrue,
  assertTypeOf,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  centerOf,
  type Harness,
  type TextDraw,
  type WickRect,
} from "../harness";

/** The four fields `specs/instrumentation.md` gives every reported rectangle. */
const RECT_FIELDS = ["x", "y", "width", "height"] as const;

/** A stage coordinate falls inside `0` to `span`, the range the pointer is read in. */
function assertInStage(value: number, span: number, context: string): void {
  assertGreaterThan(value, 0, context);
  assertGreaterThan(span, value, context);
}

/**
 * A rectangle carries the four documented fields as numbers, covers a real
 * area, and lies where the pointer is read.
 *
 * The area is checked through the rectangle's own center, the one point every
 * build agrees is inside it, rather than by holding its edges to the stage
 * bounds: a row that runs to the very edge of the stage is as legal as one
 * that does not, and the specification fixes neither.
 */
export function assertRectShape(rect: WickRect, context: string): void {
  for (const field of RECT_FIELDS) {
    assertHasProperty(rect, field, context);
    assertTypeOf(rect[field], "number", `${context}.${field}`);
  }
  assertGreaterThan(rect.width, 0, `${context}.width covers a real area`);
  assertGreaterThan(rect.height, 0, `${context}.height covers a real area`);
  const at = centerOf(rect);
  assertInStage(at.x, STAGE_W, `${context} sits across the stage`);
  assertInStage(at.y, STAGE_H, `${context} sits down the stage`);
}

/** Whether two rectangles share any area at all. */
export function overlap(a: WickRect, b: WickRect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** No two of the rectangles overlap: `specs/controls.md`, The pointer. */
export function assertDisjoint(
  rects: readonly WickRect[],
  context: string,
): void {
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      assertFalse(
        overlap(rects[i], rects[j]),
        `${context}: rectangles ${i} and ${j} do not overlap`,
      );
    }
  }
}

/**
 * The span a run of text covers across the stage, from the anchor it was drawn
 * at and the alignment that places the run about that anchor: `left` and
 * `start` put the anchor at the run's beginning, `center` at its middle, and
 * `right` and `end` at its end.
 */
function span(draw: TextDraw): { left: number; right: number } {
  const align = draw.textAlign;
  const left =
    align === "center"
      ? draw.x - draw.width / 2
      : align === "right" || align === "end"
        ? draw.x - draw.width
        : draw.x;
  return { left, right: left + draw.width };
}

/** A stage rectangle in the device pixels a frame's anchors are read in. */
interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** `rect` carried through the fit the frame's anchors were mapped by. */
function boundsOf(h: Harness, rect: WickRect): Bounds {
  const from = h.stageDevice(rect.x, rect.y);
  const to = h.stageDevice(rect.x + rect.width, rect.y + rect.height);
  return { left: from.x, top: from.y, right: to.x, bottom: to.y };
}

/**
 * Whether a run's extent shares any span with `box` across the stage and its
 * anchor sits within `slack` of `box` down the stage. Every bound is
 * inclusive, so a run that just touches an edge reads as held.
 */
function holds(box: Bounds, draw: TextDraw, slack: number): boolean {
  const run = span(draw);
  return (
    run.right >= box.left &&
    run.left <= box.right &&
    draw.y >= box.top - slack &&
    draw.y <= box.bottom + slack
  );
}

/**
 * The runs of text a frame drew at rectangle `at` of `rects`, as the header's
 * "HOW CLOSE 'THERE' IS" states.
 *
 * A run whose anchor sits within the rectangle's own bounds is that
 * rectangle's. A run whose anchor sits outside every rectangle is also read as
 * this one's when it lies within the drawn type's own pixel size of it, which
 * is what carries a baseline set below a rectangle cut to the cap height of
 * its glyphs, or above a highlight plate. The slack reaches no run that some
 * other rectangle already holds, so two rows drawn one under the other never
 * answer for each other's names.
 */
function textAt(
  h: Harness,
  draws: readonly TextDraw[],
  rects: readonly WickRect[],
  at: number,
): TextDraw[] {
  const boxes = rects.map((rect) => boundsOf(h, rect));
  return draws.filter((draw) => {
    if (holds(boxes[at], draw, 0)) return true;
    if (!holds(boxes[at], draw, draw.fontSize)) return false;
    return !boxes.some((box, i) => i !== at && holds(box, draw, 0));
  });
}

/**
 * Rectangle `i` is the area the item named `labels[i]` is drawn at, which is
 * the reading that decides the order a list of rectangles is reported in.
 *
 * A name is matched as a substring, ignoring case, so a build that writes a
 * marker, a tag, or a level beside the name reads the same. The names
 * `specs/ui.md` fixes for one menu are distinct from each other, so a list
 * reported in any other order puts the wrong name in the wrong rectangle.
 */
export function assertLabelledInOrder(
  h: Harness,
  draws: readonly TextDraw[],
  rects: readonly WickRect[],
  labels: readonly string[],
  context: string,
): void {
  rects.forEach((_rect, i) => {
    const wanted = labels[i].trim().toLowerCase();
    assertTrue(
      textAt(h, draws, rects, i).some((draw) =>
        draw.text.toLowerCase().includes(wanted),
      ),
      `${context}: rectangle ${i} is the area ${JSON.stringify(labels[i])} is drawn at`,
    );
  });
}
