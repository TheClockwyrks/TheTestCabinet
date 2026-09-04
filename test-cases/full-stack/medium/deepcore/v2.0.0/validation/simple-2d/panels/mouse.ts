// Deepcore — the pointer, for the checks that are about the pointer. CASE-PROVIDED.
//
// Not a `.test.ts`, so vitest never collects it.
//
// `specs/controls.md` requires every menu item, panel control and status-bar
// control to occupy a rectangular hit region and to answer a contact pressed and
// released inside it, and `specs/ui.md` requires every panel and menu to be fully
// operable that way. Nothing in either fixes WHERE any of them is drawn:
// `specs/overview.md` hands the layout to the build.
//
// SO THE BUILD REPORTS THE LAYOUT. `specs/instrumentation.md` declares two
// readings for exactly this — `menuItemRect(index)` and `controlRect(control,
// subject)` — each returning `{ x, y, w, h }` in the stage's logical units: "the
// region a pointer or a touch contact drives that item or that control from". A
// check here asks the build where it put the thing, aims at the middle of the
// region it named, and reads the effect the specification states for it. Nothing
// searches the screen, nothing guesses a coordinate, and every layout a
// spec-honoring build chooses is driven the same way.
//
// A REGION THE BUILD WILL NOT NAME IS A FAILURE, not an undecided point. The two
// readings are deliverables of the specification like every other operation, so a
// build that reports no region for a control it is required to draw fails the
// item that needed it, naming what was missing.
//
// A CLICK IS A FRAME. The engine collects pointer events as they arrive and
// closes the input frame at the end of each one it runs, so a press reaches the
// game on the frame that follows it — which is exactly what `Harness.click` does:
// move, press, release, then run one frame. `hoverStage` is the move alone, for
// the rule that a pointer moved onto an item's region selects it without choosing
// it, and `splitPress` puts the two edges in different places, for the rule that
// says such a press chooses nothing.

import { fail } from "../assert";
import type { Harness } from "../harness";
import type { ControlName, ControlSubject, HitRect } from "../surface";

/** The middle of a reported region: the one point inside it whatever its size. */
export function centerOf(rect: HitRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Click a logical stage point, and run the frame that delivers it. */
export function clickStage(h: Harness, x: number, y: number): Promise<void> {
  return h.click(x, y);
}

/** Move the pointer to a logical stage point, and run the frame that reports it. */
export async function hoverStage(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.pointerMove(x, y);
  await h.advance(1);
}

/**
 * Press at one logical stage point and release at another, then run the frame.
 *
 * `specs/controls.md`: "A choice takes both of its edges inside one region... Two
 * edges falling in different regions, and an edge falling outside every region,
 * choose nothing."
 */
export async function splitPress(
  h: Harness,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  h.pointerMove(from.x, from.y);
  h.pointerDown(from.x, from.y);
  h.pointerMove(to.x, to.y);
  h.pointerUp(to.x, to.y);
  await h.advance(1);
}

/** How a control reads in a failure message, subject and all. */
function nameOf(control: ControlName, subject: ControlSubject): string {
  return subject === null ? control : `${control} (${subject})`;
}

/**
 * The region the build reports for menu item `index` on the current screen, or a
 * failure naming the item it would not place.
 */
export function menuItemRegion(h: Harness, index: number): HitRect {
  const rect = h.debug.menuItemRect(index);
  if (rect === null) {
    fail(
      `specs/instrumentation.md: menuItemRect(${index}) reporting the hit region of item ${index} on the ${h.snapshot().screen} menu`,
      null,
    );
  }
  return rect;
}

/**
 * The region the build reports for an on-screen control, or a failure naming the
 * control it would not place.
 */
export function controlRegion(
  h: Harness,
  control: ControlName,
  subject: ControlSubject = null,
): HitRect {
  const rect = h.debug.controlRect(control, subject);
  if (rect === null) {
    fail(
      `specs/instrumentation.md: controlRect reporting the hit region of the ${nameOf(control, subject)} control, which specs/controls.md requires a contact to drive`,
      null,
    );
  }
  return rect;
}

/** Click the middle of a region the build already reported. */
export function clickRegion(h: Harness, rect: HitRect): Promise<void> {
  const at = centerOf(rect);
  return clickStage(h, at.x, at.y);
}

/** Move the pointer onto the middle of the region the build reports for a menu item. */
export async function hoverMenuItem(
  h: Harness,
  index: number,
): Promise<HitRect> {
  const rect = menuItemRegion(h, index);
  const at = centerOf(rect);
  await hoverStage(h, at.x, at.y);
  return rect;
}

/** Click the middle of the region the build reports for a menu item. */
export async function clickMenuItem(
  h: Harness,
  index: number,
): Promise<HitRect> {
  const rect = menuItemRegion(h, index);
  const at = centerOf(rect);
  await clickStage(h, at.x, at.y);
  return rect;
}

/** Click the middle of the region the build reports for an on-screen control. */
export async function clickControl(
  h: Harness,
  control: ControlName,
  subject: ControlSubject = null,
): Promise<HitRect> {
  const rect = controlRegion(h, control, subject);
  const at = centerOf(rect);
  await clickStage(h, at.x, at.y);
  return rect;
}
