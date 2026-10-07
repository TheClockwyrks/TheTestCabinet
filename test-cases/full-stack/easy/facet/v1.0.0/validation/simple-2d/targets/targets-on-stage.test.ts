// Facet — targets/targets-on-stage: every target lies wholly on the stage.
//
// The third row of specs/controls.md's requirements table: "Placement — wholly
// within the stage." The stage is the fixed `STAGE_W x STAGE_H` (`1280 x 720`)
// design surface specs/overview.md gives, origin at the top left, so a target
// lies on it when its left and top edges are at or past the origin and its right
// and bottom edges are at or before the far corner.
//
// A TARGET HANGING OFF THE STAGE IS A CONTROL A PLAYER CANNOT REACH, in whole or
// in part, however the stage is letterboxed onto the surface the game is drawn
// on. And it is SEPARATE from the size requirement, because a build can meet both
// minimums generously and still place a rectangle past the right-hand edge —
// centring a wide menu item on a stage narrower than the item, say. Neither
// point implies the other, so each is read on its own.
//
// ALL FOUR EDGES, rather than the corner the rectangle is stated by: a rectangle
// whose top-left corner is on the stage can still run off it, which is exactly
// the case a check reading the corner alone would miss.
//
// EVERY SCREEN, because the requirement is stated of every target on every
// screen and a build lays its screens out one at a time.

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
import { SCREENS, STAGE_H, STAGE_W, type Screen } from "../constants";
import { targetIsOnStage } from "../board";
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

it("reports every target wholly inside the stage", async () => {
  for (const screen of SCREENS) {
    const reading = await reachScreen(h, screen);
    assertGreaterThanOrEqual(
      reading.targets.length,
      1,
      `the targets the ${screen} screen reports, of which every one is read`,
    );

    for (const target of reading.targets) {
      assertTrue(
        targetIsOnStage(target),
        `target ${target.id} on ${screen} runs from (${target.x},${target.y}) ` +
          `to (${target.x + target.w},${target.y + target.h}), against the ` +
          `${STAGE_W}x${STAGE_H} stage`,
      );
    }

    if (screen === PICTURED) {
      // One frame, so the picture is of the screen the rectangles were read on.
      await h.advance(1);
      captureStill(h, "targets");
    }
  }
});
