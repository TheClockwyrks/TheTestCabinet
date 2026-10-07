// Facet — targets/targets-min-size: every target is big enough for a fingertip.
//
// specs/controls.md states it as two rows of the requirements table every target
// on every screen satisfies: "Width — at least `TARGET_MIN_W` (`96`)" and
// "Height — at least `TARGET_MIN_H` (`72`)", and says why: "The width and the
// height are what a fingertip needs, so every target is worked by touch as
// readily as by a mouse."
//
// A FLOOR, NEVER A SIZE. A target of exactly those dimensions conforms and so
// does one twice as large — where a target sits and how big it is beyond the
// floor is the build's design, and this case fixes not one rectangle. So the
// reading is a comparison against the two minimums and never an equality with
// them.
//
// THE FAULT THIS POINT EXISTS FOR is a build whose menu items are hit-tested as
// the bounds of their drawn TEXT. Such a build passes every behavior point in
// this category — the presses there aim at each target's own center, and a text
// bound has a center — and is unusable with a finger, which covers far more of a
// touchscreen than a cursor covers of a monitor. That is a fault no other point
// can see, which is what makes it a point.
//
// EVERY SCREEN, because the requirement is stated of every target on every
// screen and a build lays its screens out one at a time. The two on-screen
// controls are the likeliest to be drawn small, since each carries one short
// word.

//
// HOW EACH SCREEN IS REACHED. Through `reachScreen`, the harness's own sequence
// of the atomic poses specs/instrumentation.md gives: a `reset`, a posed board
// under the four screens specs/ui.md draws one behind, and `setScreen`. Nothing
// here depends on a menu's ordering, on a key binding, or on the level and end
// conditions that raise `levelclear` and `gameover` in play — those are other
// items' requirements, and a route through them would put their failures on this
// point. `setScreen` shows a screen and changes nothing else, and the screen
// behaves from there exactly as it does when a player reaches it, so the targets
// read here are the targets a player sees.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertTrue } from "../assert";
import { SCREENS, TARGET_MIN_H, TARGET_MIN_W, type Screen } from "../constants";
import { targetIsBigEnough } from "../board";
import {
  captureStill,
  createHarness,
  reachScreen,
  type Harness,
} from "../harness";

/** The screen the kept picture is taken on. */
const PICTURED: Screen = "title";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every target at least TARGET_MIN_W by TARGET_MIN_H", async () => {
  for (const screen of SCREENS) {
    const reading = await reachScreen(h, screen);
    assertGreaterThanOrEqual(
      reading.targets.length,
      1,
      `the targets the ${screen} screen reports, of which every one is read`,
    );

    for (const target of reading.targets) {
      assertTrue(
        targetIsBigEnough(target),
        `target ${target.id} on ${screen} measures ${target.w}x${target.h}, ` +
          `against the ${TARGET_MIN_W}x${TARGET_MIN_H} a fingertip needs`,
      );
    }

    if (screen === PICTURED) {
      // One frame, so the picture is of the screen the rectangles were read on.
      await h.advance(1);
      captureStill(h, "targets");
    }
  }
});
