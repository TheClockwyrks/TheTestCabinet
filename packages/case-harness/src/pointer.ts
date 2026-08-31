// Driving the REAL mouse across a driven frame.
//
// WHY A CHECK WOULD DO THIS RATHER THAN POSE THE POINTER THROUGH THE SURFACE.
// A pose is instant and tells the build where the pointer is; it does not make
// the build's own input layer see a press, a drag and a release the way a
// player's hand does. A build is free to sample the pointer from its own event
// handlers and act on the frame the event happens on — which is what a case's
// UI spec permits — so a check whose subject is what a FRAME did with a player's
// gesture (a cue sounding on it, a segment appearing in a replay) drives
// Chromium's real mouse instead, one driven frame per sample, and reads the
// result off the frame that consumed it.
//
// A GESTURE IS THREE PARTS AND EACH RUNS ITS OWN FRAME. A press that ran no frame
// would never reach a build that reads its input once per frame; a press released
// before a frame ran would be invisible to a build that compares held state
// between frames. So each of the three drives exactly one frame, and a caller
// counting frames can add them up.
//
// THE MAPPING IS {@link Harness.css}, NOT {@link Harness.cssPoint}. `css` takes
// the logical point through the DEVICE mapping and back, so it answers the CSS
// position of the pixel the point lands on — which is where a click has to land
// to hit the thing drawn there. The two agree wherever the device point is
// already whole, which is every shape a check runs at bar the ones that are about
// the fit. {@link Harness.clickPointer} and {@link Harness.movePointer} are the
// harness's own, unrounded pair, for the case that measures the fit itself.

import type { Harness } from "./harness";

/** As much of a harness as a real mouse gesture needs. */
export type MouseDriver = Pick<
  Harness<unknown, object>,
  "page" | "css" | "advance"
>;

/** Press the real mouse at a logical stage point, and run the frame that reads it. */
export async function mousePress(
  h: MouseDriver,
  x: number,
  y: number,
): Promise<void> {
  const at = h.css(x, y);
  await h.page.mouse.move(at.x, at.y);
  await h.page.mouse.down();
  await h.advance(1);
}

/** Move the held mouse to a logical stage point, and run the frame that reads it. */
export async function mouseGlide(
  h: MouseDriver,
  x: number,
  y: number,
): Promise<void> {
  const at = h.css(x, y);
  await h.page.mouse.move(at.x, at.y);
  await h.advance(1);
}

/** Release the real mouse, and run the frame that reads it. */
export async function mouseRelease(h: MouseDriver): Promise<void> {
  await h.page.mouse.up();
  await h.advance(1);
}
