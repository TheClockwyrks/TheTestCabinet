// Driving a REAL touch contact across a driven frame.
//
// The mouse counterpart is {@link ./pointer}, and the reason a check drives a
// real device rather than posing the pointer through the surface is the same
// one: a pose tells the build where a contact is, and it does not make the
// build's own input layer see a contact arrive, travel and lift the way a
// finger does.
//
// WHAT A TOUCH IS THAT A MOUSE IS NOT. A touch contact carries
// `pointerType: "touch"`, it has no hover — the first the build hears of it is
// the contact landing — and it exists only on a context that reports a
// touchscreen. That context is opt-in per case (`hasTouch` in the case's
// config), because it changes the device a build believes it is running on, so
// a case that does not ask for touch keeps exactly the context its baselines
// were recorded against. A touch gesture driven on a context without a
// touchscreen throws rather than silently arriving as a mouse.
//
// A GESTURE IS THREE PARTS AND EACH RUNS ITS OWN FRAME, as with the mouse: a
// contact that ran no frame would never reach a build that reads its input once
// per frame, so each of the three drives exactly one frame and a caller counting
// frames can add them up.
//
// THE MAPPING IS {@link Harness.css}, NOT {@link Harness.cssPoint}, for the
// reason the mouse module gives: `css` answers the CSS position of the pixel a
// logical point lands on, which is where a contact has to land to hit the thing
// drawn there.

import type { CDPSession, Page } from "playwright";

import type { Harness } from "./harness";

/** As much of a harness as a real touch gesture needs. */
export type TouchDriver = Pick<
  Harness<unknown, object>,
  "page" | "css" | "advance"
>;

/**
 * The contact identifier every gesture below drives.
 *
 * One contact is all a menu needs, and fixing the id keeps a press, its travel
 * and its lift recognizable to the build as the same finger.
 */
const CONTACT_ID = 1;

/**
 * The CDP session a page's contacts are driven through, opened once and HELD.
 *
 * Chromium tracks the live contacts per CDP client, so a session opened for the
 * landing and detached again takes the contact with it: the travel that follows
 * is refused outright ("Must send a TouchStart first to start a new touch"), and
 * a gesture is three events. The session therefore has to outlive the whole
 * gesture, and the page closing is what closes it — which is what ends a
 * harness.
 *
 * Keyed by the page rather than by the harness, because the contact belongs to
 * the page: two drivers over one page are one finger.
 */
const sessions = new WeakMap<Page, Promise<CDPSession>>();

/** The held session for `page`, opening it on the first contact it drives. */
function sessionFor(page: Page): Promise<CDPSession> {
  const open = sessions.get(page);
  if (open !== undefined) return open;
  const opening = page.context().newCDPSession(page);
  sessions.set(page, opening);
  return opening;
}

/**
 * Dispatch one raw touch event through CDP.
 *
 * Playwright's own `page.touchscreen` carries `tap` alone, which is a press and
 * a lift with no frame between them, so a check that needs the contact HELD
 * across a frame cannot express itself through it. The Chrome DevTools Protocol
 * is the level that can, and it is what `page.touchscreen.tap` is itself built
 * on.
 */
async function dispatch(
  h: TouchDriver,
  type: "touchStart" | "touchMove" | "touchEnd",
  point: { x: number; y: number } | null,
): Promise<void> {
  const session = await sessionFor(h.page);
  await session.send("Input.dispatchTouchEvent", {
    type,
    touchPoints:
      point === null ? [] : [{ x: point.x, y: point.y, id: CONTACT_ID }],
  });
}

/** Land a real touch contact at a logical stage point, and run the frame that reads it. */
export async function touchPress(
  h: TouchDriver,
  x: number,
  y: number,
): Promise<void> {
  await dispatch(h, "touchStart", h.css(x, y));
  await h.advance(1);
}

/** Travel the held contact to a logical stage point, and run the frame that reads it. */
export async function touchGlide(
  h: TouchDriver,
  x: number,
  y: number,
): Promise<void> {
  await dispatch(h, "touchMove", h.css(x, y));
  await h.advance(1);
}

/** Lift the contact, and run the frame that reads it. */
export async function touchRelease(h: TouchDriver): Promise<void> {
  await dispatch(h, "touchEnd", null);
  await h.advance(1);
}

/**
 * Tap a logical stage point: land the contact, then lift it.
 *
 * Two driven frames, because the press and the lift are separately observable —
 * a build that acts on the lift and a build that acts on the press are both
 * conformant unless a case's specification says which, and a tap that ran one
 * frame would hide the difference.
 */
export async function touchTap(
  h: TouchDriver,
  x: number,
  y: number,
): Promise<void> {
  await touchPress(h, x, y);
  await touchRelease(h);
}
