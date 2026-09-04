// pointer/pointing — what the points of this category share: how a rectangle is
// read off the debug surface before a gesture aims at it, how a point inside no
// rectangle is DERIVED rather than guessed, and the click that delivers its
// edge on a frame too short to consume a tick. CASE-PROVIDED.
//
// No review item names this file. Every helper is one reading or one gesture
// stated once, so the twenty points below aim the same way; nothing here poses
// a screen, because each point's pose is the part of it worth reading beside
// its assertion.
//
// WHY A CHECK NEVER NAMES A STAGE POINT. specs/controls.md, The pointer, fixes
// the RELATION between a rectangle and an item — "the rectangle at position `i`
// belongs to the item at `menuIndex` `i`" — and fixes no coordinate for any of
// them, so where a build draws its menu is the build's. The rectangles are read
// back through the debug surface, which "Reports the rectangles of the current
// screen's vertical menu, in menu order ... Each rectangle is the area a hover
// or a click selects that item inside" (specs/instrumentation.md, Menus), and a
// gesture is aimed at the middle of what the build itself reported.
//
// THE ONE POINT THAT IS NOT A RECTANGLE'S. "The pointer inside no rectangle
// changes nothing" needs a point inside none, and the specification fixes no
// place where that is true either. {@link outsidePoint} therefore SEARCHES the
// stage for it: it walks a grid over the whole stage and keeps the candidate
// furthest from every rectangle the surface reported, entry rectangles and tab
// rectangles alike, so the point it hands back is derived from the build under
// test at the moment it is used and is clear of every boundary by a margin.

import { fail } from "../assert";
import { BINDINGS, STAGE_H, STAGE_W, TICK_DT } from "../constants";
import {
  centerOf,
  menuRects,
  tabRects,
  tap,
  type Harness,
  type WickRect,
  type WickSnapshot,
} from "../harness";

/** A logical stage point, the coordinates specs/controls.md reads the pointer in. */
export interface StagePoint {
  x: number;
  y: number;
}

/* -------------------------------------------------------------------------- */
/* Reading a rectangle before aiming at it                                    */
/* -------------------------------------------------------------------------- */

/**
 * The rectangle of the menu item at `position`, with the reading named when the
 * build reported too few.
 *
 * `menuRects` reports "one rectangle per item of the menu they show"
 * (specs/instrumentation.md, Menus), so a screen listing three items reports
 * three; a build that reported fewer has no rectangle for the point to aim at,
 * and the failure says which position was missing rather than dying on an
 * undefined.
 */
export function menuRectAt(
  h: Harness,
  position: number,
  context: string,
): WickRect {
  const rects = menuRects(h);
  const rect = rects[position];
  if (rect === undefined) {
    fail(`a menuRects() rectangle at position ${position} (${context})`, {
      reported: rects.length,
    });
  }
  return rect;
}

/**
 * The rectangle of the almanac tab at `position`, named the same way.
 *
 * `tabRects` reports "the rectangles of the almanac's tab bar on `almanac`, one
 * per tab in `ALMANAC_TABS` order" (specs/instrumentation.md, Menus).
 */
export function tabRectAt(
  h: Harness,
  position: number,
  context: string,
): WickRect {
  const rects = tabRects(h);
  const rect = rects[position];
  if (rect === undefined) {
    fail(`a tabRects() rectangle at position ${position} (${context})`, {
      reported: rects.length,
    });
  }
  return rect;
}

/* -------------------------------------------------------------------------- */
/* A point inside no rectangle                                                */
/* -------------------------------------------------------------------------- */

/**
 * How far apart the candidate points {@link outsidePoint} walks are, in stage
 * units. Fine enough that a stage carrying menus finds its gaps, coarse enough
 * that the walk is a few thousand comparisons.
 */
const OUTSIDE_STEP = 8;

/**
 * How far the chosen point must sit from every rectangle, in stage units.
 *
 * The rule is about a point "inside no rectangle", and a point one unit outside
 * an edge answers it; the margin is honest slack, so a build whose hit test
 * takes its edges inclusively is judged on the rule rather than on a rounding.
 */
export const OUTSIDE_MARGIN = 8;

/** The distance from `point` to `rect`, and `0` for a point inside it. */
export function distanceToRect(point: StagePoint, rect: WickRect): number {
  const dx = Math.max(rect.x - point.x, point.x - (rect.x + rect.width), 0);
  const dy = Math.max(rect.y - point.y, point.y - (rect.y + rect.height), 0);
  return Math.hypot(dx, dy);
}

/**
 * A stage point inside none of the rectangles the current screen reports,
 * derived from those rectangles at the moment of the call.
 *
 * Both readings are taken, because "On `almanac` each tab of the tab bar
 * occupies a rectangle as well" (specs/controls.md, The pointer) and a point
 * that answered no entry but landed in a tab would be inside a rectangle after
 * all. The whole stage is walked, "`0` to `STAGE_W` across and `0` to `STAGE_H`
 * down", and the candidate furthest from every rectangle wins, so the point is
 * as far from a boundary as the build's own layout allows.
 */
export function outsidePoint(h: Harness): StagePoint {
  const rects = [...menuRects(h), ...tabRects(h)];
  let best: StagePoint = { x: 0, y: 0 };
  let bestClearance = -1;
  for (let y = 0; y <= STAGE_H; y += OUTSIDE_STEP) {
    for (let x = 0; x <= STAGE_W; x += OUTSIDE_STEP) {
      const candidate = { x, y };
      const clearance = rects.reduce(
        (least, rect) => Math.min(least, distanceToRect(candidate, rect)),
        Number.POSITIVE_INFINITY,
      );
      if (clearance > bestClearance) {
        bestClearance = clearance;
        best = candidate;
      }
    }
  }
  if (bestClearance < OUTSIDE_MARGIN) {
    fail(
      `a stage point at least ${OUTSIDE_MARGIN} units outside every reported rectangle`,
      { clearance: bestClearance, rectangles: rects.length },
    );
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* A click whose frame consumes no tick                                       */
/* -------------------------------------------------------------------------- */

/**
 * Click a logical stage point and deliver its press edge on a frame too short
 * to consume a tick.
 *
 * The mirror of the harness's `tapWithoutTick`, for the same reason: "The
 * frame's update then runs on the screen the edges left: a frame whose press
 * enters `playing` ... runs that frame's ticks" (specs/controls.md), so a whole
 * frame would leave a run the click started or resumed one tick old, and a
 * point that reads the run the transition itself handed back could not tell it
 * from an advanced one. A frame of half a tick delivers the same pointer press
 * and consumes none, since "A tick is consumed while the accumulator is at
 * least `TICK_DT − TICK_EPSILON`" (specs/instrumentation.md).
 *
 * The move, the press, and the release all land before the frame, exactly as
 * the harness's `clickAt` delivers them, so the frame sees the pointer at the
 * point with its primary press edge armed there and no contact left open.
 */
export function clickAtWithoutTick(
  h: Harness,
  x: number,
  y: number,
): Promise<WickSnapshot> {
  h.movePointer(x, y);
  h.pressPointer(x, y);
  h.releasePointer(x, y);
  return h.frameOf(TICK_DT / 2);
}

/** Click the middle of a reported rectangle on a frame that consumes no tick. */
export function clickRectWithoutTick(
  h: Harness,
  rect: WickRect,
): Promise<WickSnapshot> {
  const at = centerOf(rect);
  return clickAtWithoutTick(h, at.x, at.y);
}

/* -------------------------------------------------------------------------- */
/* Posing a highlight the surface poses no other way                          */
/* -------------------------------------------------------------------------- */

/**
 * Move a menu highlight down `steps` items with the menu's own key.
 *
 * `menuIndex` is `0` on entering every screen (specs/controls.md, What each
 * screen reads) and the debug surface carries no operation that sets it, so a
 * point that needs the highlight anywhere else presses `down` for it: on
 * `almanac` "`up` and `down` move `menuIndex` by one over the tab's entries and
 * wrap at both ends" (specs/ui.md). `down` is bound to `ArrowDown` and `KeyS`
 * (specs/controls.md), and one press edge is one move, so `steps` presses are
 * `steps` moves.
 */
export async function moveHighlightDown(
  h: Harness,
  steps: number,
): Promise<WickSnapshot> {
  let after = h.snapshot();
  for (let press = 0; press < steps; press += 1) {
    after = await tap(h, BINDINGS.down[0]);
  }
  return after;
}
