// Facet — appearance/back-control-drawn: the `howto` screen draws the BACK
// control, and the rectangle it reports for that control is not a bare patch of
// the background.
//
// WHAT IS BEING DECIDED. specs/ui.md gives the screen the control outright: "The
// screen carries the `back` pointer target `specs/controls.md` names, drawn as a
// control reading `BACK_LABEL` (`BACK`), so a player with only a pointer can
// leave it." specs/controls.md lists `back` as the one target `howto` carries and
// says it "covers a drawn control reading `BACK_LABEL` (`BACK`) ... legible at
// the stage size", and specs/overview.md states the requirement this decides:
// "Every pointer target `specs/controls.md` names is drawn where it is reported
// ... so a player with only a touchscreen reaches every screen."
//
// WHY IT IS A POINT OF ITS OWN. It is a separate control on a separate screen
// from the pause control, and it is the only way off `howto` for a player with no
// keyboard — specs/controls.md binds `back` to `Escape` and to nothing else — so a
// build that reports the target and draws nothing there leaves that player
// looking for it with the rules page stuck on the screen.
//
// WHY THE READING IS IN TWO HALVES, AND HOW CLOSE THAT GETS. Read exactly as
// `appearance/pause-control-drawn` reads its control, and for the same reasons.
//
//   The copy — `BACK_LABEL` is looked for among the strings the frame drew, in
//   whatever pieces the build drew them, which `showsText` reads.
//
//   The rectangle — the pixels inside the `back` target the same screen reports
//   are read off the canvas and asked to carry more than one color.
//
// The two are not joined into one reading, because a text draw's coordinates
// cannot be compared against the rectangle: a build that translates its context
// before drawing reports the offset coordinates on the call and is entirely
// conformant. A build whose background happens to be busy under an empty
// rectangle answers the second half spuriously, which is a false pass and never a
// false failure.
//
// HOW THE SCREEN IS REACHED. Through the harness's `openHowTo`, which is
// `setMenuIndex(0)` and `setScreen("howto")` — the two single-field poses
// specs/instrumentation.md gives, arranged into what specs/ui.md says choosing
// `HOW TO PLAY` reaches. Reaching it by pressing the menu instead would put the
// title screen's own targets between this point and the thing it decides, and
// those belong to the pointer items.

import { afterEach, beforeEach, it } from "vitest";
import { type TargetRect } from "../board";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { BACK_LABEL } from "../constants";
import {
  captureStill,
  createHarness,
  openHowTo,
  showsText,
  targetById,
  type Harness,
  type Viewport,
} from "../harness";

/**
 * Real milliseconds the produced art is given before the frame is read.
 *
 * specs/assets.md has a build ship its art as produced files decoded off the
 * frame loop, and a frame drawn before they arrive is a frame drawn from
 * placeholders. This spends REAL time only: the simulation stands still through
 * it.
 */
const ART_SETTLE_MS = 250;

/** The target the control carries, from specs/controls.md's table for `howto`. */
const TARGET_ID = "back";

let h: Harness;

/** The logical stage point a device pixel of the canvas stands at. */
function toLogical(
  view: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (x - view.offsetX) / view.scale,
    y: (y - view.offsetY) / view.scale,
  };
}

/**
 * How many distinct colors a reported rectangle holds, counted up to two.
 *
 * Two is the whole of what the reading needs — one color is a flat patch of
 * whatever sits behind the rectangle, and two is something drawn over it — so the
 * verdict stops there. Alpha is read alongside the three channels, because a
 * control drawn as a translucent panel over the background differs from it in
 * alpha as readily as in color.
 *
 * THE PIXELS ARE IN THE PAGE, so the box is cut here and carried across in ONE
 * crossing: the device box is worked out from the canvas the build sized itself,
 * every pixel of it is named back in logical units — which is what
 * {@link Harness.pixels} takes — and the whole box comes back at once. Under the
 * two engines the canvas is in this process and the same box is read straight off
 * a `getImageData`.
 *
 * The box is clamped to the canvas, so a build that reported a rectangle running
 * off the stage is read over whatever part of it is on the stage rather than
 * failing here on a reading error — where it sits is the pointer items' verdict,
 * not this one's.
 */
async function colorsIn(target: TargetRect): Promise<number> {
  const view = h.viewport();
  const canvas = await h.surface();
  const origin = h.device(target.x, target.y);
  const x = Math.max(0, Math.min(canvas.width - 1, origin.x));
  const y = Math.max(0, Math.min(canvas.height - 1, origin.y));
  const width = Math.max(
    1,
    Math.min(canvas.width - x, Math.round(target.w * view.scale)),
  );
  const height = Math.max(
    1,
    Math.min(canvas.height - y, Math.round(target.h * view.scale)),
  );
  const points: { x: number; y: number }[] = [];
  for (let down = 0; down < height; down += 1) {
    for (let across = 0; across < width; across += 1) {
      points.push(toLogical(view, x + across, y + down));
    }
  }
  const seen = new Set<number>();
  for (const [r, g, b, a] of await h.pixels(points)) {
    seen.add(((r * 256 + g) * 256 + b) * 256 + a);
    if (seen.size > 1) return seen.size;
  }
  return seen.size;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the BACK label and puts something inside the back target it reports", async () => {
  await openHowTo(h);
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen the how-to poses reach",
  );
  await h.settle(ART_SETTLE_MS);

  // One frame, and the strings it drew.
  const drawn = await h.frameText();

  // Evidence, and no part of the verdict: the control on the how-to screen.
  await captureStill(h, "control");

  assertTrue(
    showsText(drawn, BACK_LABEL),
    `the ${JSON.stringify(BACK_LABEL)} control drawn on the how-to screen, ` +
      `among ${JSON.stringify(drawn)}`,
  );

  const target = targetById(await h.snapshot(), TARGET_ID);
  assertGreaterThan(
    await colorsIn(target),
    1,
    `distinct colors inside the ${TARGET_ID} target the how-to screen reports, ` +
      `at (${target.x},${target.y}) ${target.w}x${target.h}`,
  );
});
