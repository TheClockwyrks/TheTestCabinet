// Deepcore — the pointer, for the checks that are about the pointer. CASE-PROVIDED.
//
// `specs/controls.md` requires every menu item, panel control and status-bar
// control to occupy a rectangular hit region and to answer a pointer pressed and
// released inside it, and `specs/ui.md` requires every panel and menu to be fully
// operable that way. Neither fixes WHERE any of them is drawn: `specs/overview.md`
// hands the layout to the build.
//
// SO THE BUILD REPORTS IT. `specs/instrumentation.md` carries two readings for
// exactly this — `menuItemRect(index)` and `controlRect(control, subject)`, both
// answering `{ x, y, w, h }` in the stage's logical units — and everything here is
// built on them. A check moves the pointer onto the region the build says it drew
// the thing at, and asserts the selection or the effect that follows. Nothing here
// searches the screen: there is no ring of offsets around a text anchor and no
// sweep of a band, because both of those were guesses that a conformant build
// could fail — a build that draws its labels as sprites rather than through
// `fillText`, or whose control box misses a hardcoded offset, or whose bar control
// is narrower than a sweep's step, was never found at all and lost the point for
// it.
//
// A REGION THE BUILD DOES NOT REPORT IS THE BUILD'S FAULT. `menuItemRect` and
// `controlRect` are deliverables like every other operation, so a `null` where the
// specification requires a region fails the point that asked for it, with the
// requirement beside it. That is {@link menuItemRegion} and {@link controlRegion};
// the checks that are ABOUT a control being absent read the raw operation instead.
//
// A PRESS IS THREE EDGES AND EACH RUNS ITS OWN FRAME. The move, the press and the
// release are separately observable, and `specs/controls.md` distinguishes them:
// a pointer that moves onto a menu item highlights it, and a press and a release
// inside one region choose it. A build that latches the edge in its own event
// handler and a build that compares pointer state between frames are both
// conformant, so each edge is delivered, then drained through the page's own loop,
// then given one driven frame — which is the same reasoning the harness's `tap`
// gives for putting a frame between a key's down and its up.

import { fail } from "../assert";
import {
  touchPress,
  touchRelease,
  type ControlName,
  type ControlSubject,
  type Harness,
  type HitRect,
} from "../harness";

/** The middle of a hit region, which is where a press aims at what it holds. */
export function regionCenter(rect: HitRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Let the page's OWN loop see what Chromium just delivered, then run one frame.
 *
 * A pointer event delivered by the browser arrives as a DOM event, and an
 * engineless build is free to act on it in its own frame rather than in the
 * handler. `advance` is not that loop — the game is off its clock, so the build's
 * loop draws and drains its input and steps nothing — so the two animation frames
 * come first and the driven frame, the one the game's own update runs on, comes
 * after.
 */
async function settle(h: Harness): Promise<void> {
  await h.page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }),
  );
  await h.advance(1);
}

/** Move the real pointer onto a logical stage point and let the game see it. */
export async function movePointer(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  const at = h.css(x, y);
  await h.page.mouse.move(at.x, at.y);
  await settle(h);
}

/**
 * Press and release the real pointer at one logical stage point.
 *
 * Both edges land inside whatever region holds the point, which is what
 * `specs/controls.md` requires of a choice: "A choice takes both of its edges
 * inside one region".
 */
export async function clickStage(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  await movePointer(h, x, y);
  await h.page.mouse.down();
  await settle(h);
  await h.page.mouse.up();
  await settle(h);
}

/** Move the pointer onto the middle of a reported region. */
export function hoverRegion(h: Harness, rect: HitRect): Promise<void> {
  const at = regionCenter(rect);
  return movePointer(h, at.x, at.y);
}

/** Press and release inside the middle of a reported region. */
export function clickRegion(h: Harness, rect: HitRect): Promise<void> {
  const at = regionCenter(rect);
  return clickStage(h, at.x, at.y);
}

/**
 * Press inside one reported region and release inside another.
 *
 * `specs/controls.md`: "A choice takes both of its edges inside one region: the
 * press and its release for a pointer... Two edges falling in different regions,
 * and an edge falling outside every region, choose nothing." Each edge runs its
 * own frame, for the reason {@link clickStage} gives.
 */
export async function splitPress(
  h: Harness,
  from: HitRect,
  to: HitRect,
): Promise<void> {
  const down = regionCenter(from);
  const up = regionCenter(to);
  await movePointer(h, down.x, down.y);
  await h.page.mouse.down();
  await settle(h);
  await movePointer(h, up.x, up.y);
  await h.page.mouse.up();
  await settle(h);
}

/**
 * Land a REAL touch contact in the middle of a reported region and lift it there.
 *
 * `specs/controls.md`: "A touch contact lands and lifts inside one menu item's
 * region: that item becomes the highlighted item and is chosen." The two edges
 * are separately observable and each runs its own driven frame, so a build that
 * acts on the landing and a build that acts on the lift are both reached.
 *
 * A finger is not a mouse: it carries `pointerType: "touch"`, it has no hover, and
 * the first the build hears of it is the contact arriving. That is why this is a
 * device gesture rather than a posed pointer.
 */
export async function touchRegion(h: Harness, rect: HitRect): Promise<void> {
  const at = regionCenter(rect);
  await touchPress(h, at.x, at.y);
  await settle(h);
  await touchRelease(h);
  await settle(h);
}

/** What the specification requires of a region a check asked the build for. */
function requireRegion(rect: HitRect | null, what: string): HitRect {
  if (rect === null) {
    fail(
      `${what}, reported as { x, y, w, h } in the stage's logical units ` +
        `(specs/instrumentation.md, Readings)`,
      "null",
    );
  }
  if (!(rect.w > 0) || !(rect.h > 0)) {
    fail(
      `${what}, with a region a pointer can land in`,
      `{ x: ${rect.x}, y: ${rect.y}, w: ${rect.w}, h: ${rect.h} }`,
    );
  }
  return rect;
}

/**
 * Where the build drew menu item `index` on the screen it is showing.
 *
 * Fails the running check when the build reports no region for an item its menu
 * does show: the reading is a deliverable, and a point that cannot be decided is
 * worth less than a point that fails.
 */
export async function menuItemRegion(
  h: Harness,
  index: number,
): Promise<HitRect> {
  const screen = (await h.snapshot()).screen;
  return requireRegion(
    await h.debug.menuItemRect(index),
    `a hit region for menu item ${index} on the ${screen} screen`,
  );
}

/** Where the build drew one on-screen control, failing the check when it reports none. */
export async function controlRegion(
  h: Harness,
  control: ControlName,
  subject: ControlSubject | null = null,
): Promise<HitRect> {
  return requireRegion(
    await h.debug.controlRect(control, subject),
    `a hit region for the ${control} control` +
      (subject === null ? "" : ` on ${subject}`),
  );
}
