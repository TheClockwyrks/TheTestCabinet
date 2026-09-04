// hud/touch-targets — every control the panel reports is at least 32 by 32
// logical units and lies inside the panel's strip.
//
// THE RULE. specs/hud.md, Touch targets: "Every control the panel carries is at
// least `MIN_TOUCH_TARGET` (`32`) by `32` logical units and lies inside the
// panel's strip." The strip is specs/floor.md's: the build panel is "`x` in
// `[PANEL_X, 1280]` (`[986, 1280]`), `PANEL_W` (`294`) wide, full height".
//
// EVERY CONTROL MEANS EVERY ONE, so the point is read from two poses rather than
// one. Four of the twelve rectangles are conditional: Rotate and Cancel are
// "drawn only while a preview is held, and neither is drawn with nothing armed",
// and Upgrade and Sell are the inspector's, reported as `null` when no tower is
// selected. So one pose holds a preview and one selects a tower, and each is
// checked for the rectangles it makes the panel report. Nothing here requires a
// build to allow both at once.
//
// THE CONDITIONAL FOUR ARE ALSO REQUIRED TO BE THERE. A panel that reported no
// Rotate rectangle while a preview was held would otherwise pass this point
// vacuously — every rectangle it reported being large enough — so each pose
// asserts the rectangles it should have brought with it.
//
// WHY THE SIZE IS READ OFF `controls` RATHER THAN OFF THE PICTURE. The rectangle
// the panel reports is the control's HIT area, which is what a finger has to land
// in and what a scripted scenario taps; that is the thing specs/hud.md's
// `MIN_TOUCH_TARGET` is about. What the build draws inside it is its own
// business.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import { MIN_TOUCH_TARGET, PANEL_X, STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type ControlRect,
  type Harness,
} from "../harness";
import { controlOf } from "./panel";
import { FREE_SITE } from "./sites";

/** The type armed and the type placed: the arrangement, not the subject. */
const HELD = "arc" as const;

/** Money enough that arming and selecting are both plainly available. */
const PURSE = 1000;

/** Every rectangle is held to both sides of `MIN_TOUCH_TARGET` and to the strip. */
function assertTappable(rect: ControlRect, name: string): void {
  assertGreaterThanOrEqual(
    rect.w,
    MIN_TOUCH_TARGET,
    `the width of the ${name} control (specs/hud.md)`,
  );
  assertGreaterThanOrEqual(
    rect.h,
    MIN_TOUCH_TARGET,
    `the height of the ${name} control (specs/hud.md)`,
  );
  assertGreaterThanOrEqual(
    rect.x,
    PANEL_X,
    `the left edge of the ${name} control, inside the panel's strip ` +
      `(specs/floor.md)`,
  );
  assertLessThanOrEqual(
    rect.x + rect.w,
    STAGE_W,
    `the right edge of the ${name} control`,
  );
  assertGreaterThanOrEqual(rect.y, 0, `the top edge of the ${name} control`);
  assertLessThanOrEqual(
    rect.y + rect.h,
    STAGE_H,
    `the bottom edge of the ${name} control`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every control at least 32 by 32 and inside the panel's strip", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  // With a preview held: the shop, the wave controls, Rotate and Cancel.
  h.debug.setArmed(HELD);
  h.debug.setPreview(FREE_SITE.col, FREE_SITE.row);
  await h.advance(1);
  captureStill(h, "targets");
  const armed = h.snapshot().controls;

  assertNotNull(
    armed.rotate,
    "the panel to report a Rotate control while a preview is held " +
      "(specs/hud.md)",
  );
  assertNotNull(
    armed.cancel,
    "the panel to report a Cancel control while a preview is held " +
      "(specs/hud.md)",
  );
  for (const entry of armed.shop) {
    assertTappable(entry, `${entry.type} shop entry`);
  }
  assertTappable(controlOf(armed.rotate, "Rotate"), "Rotate");
  assertTappable(controlOf(armed.cancel, "Cancel"), "Cancel");
  assertTappable(armed.send, "Send");
  assertTappable(armed.speed, "Speed");
  assertTappable(armed.pause, "Pause");
  assertTappable(armed.mute, "Mute");

  // With a tower selected: Upgrade and Sell.
  h.debug.setArmed(null);
  const id = poseTower(h, HELD, FREE_SITE.col, FREE_SITE.row);
  h.debug.setSelected(id);
  await h.advance(1);
  const selected = h.snapshot().controls;

  assertNotNull(
    selected.upgrade,
    "the panel to report an Upgrade control while a tower is selected " +
      "(specs/hud.md)",
  );
  assertNotNull(
    selected.sell,
    "the panel to report a Sell control while a tower is selected " +
      "(specs/hud.md)",
  );
  assertTappable(controlOf(selected.upgrade, "Upgrade"), "Upgrade");
  assertTappable(controlOf(selected.sell, "Sell"), "Sell");
});
