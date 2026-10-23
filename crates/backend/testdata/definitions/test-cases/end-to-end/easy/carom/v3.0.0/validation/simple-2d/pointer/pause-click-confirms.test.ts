// Carom — pointer/pause-click-confirms: a click confirms an item on the pause
// menu.
//
// specs/ui.md, "Pointer and touch": a pointer pressed and released inside one
// item's region confirms that item, and the effect is the one the keyboard table
// gives `confirm` on that screen. On `paused` the first item is `RESUME`, whose
// confirm sets `screen = resumeScreen`, so the screen the click leaves is the
// whole reading.
//
// WHAT THIS GRADES THAT THE TITLE POINTS CANNOT. The pointer handling is one
// piece of code, and `click-confirms` reads it once on the title. What is per
// screen is whether a screen is WIRED to it at all, and a build whose pause menu
// is mouse-dead is a build a player cannot quit with the mouse they started the
// match with.
//
// `RESUME`'s region is read back through `menuItemRect`, and the press and the
// release land in the middle of it: where the build put the item is the build's
// own and is never guessed. Both edges fall inside the one region, which is what
// specs/ui.md requires of a confirm.
//
// The pause menu is POSED over a live match — `enterPlaying` reaches `playing`
// and `openPause` is the three fields specs/ui.md says a `pause` edge sets — so
// the key that OPENS it is `controls-*/escape` and `controls-*/p`'s point rather
// than this one's.
//
// The field is emptied. This point is about a screen transition, so it concerns
// no ball and no obstacle, and a ball that leaked past a broken pause could score
// and take the screen away from the reading. `clearWorld` removes them outright.
// The paddles are the field furniture no operation removes, and nothing here
// takes one. The still is the frame the gesture left.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  clickItem,
  createHarness,
  enterPlaying,
  openPause,
  poseWorld,
  type Harness,
} from "../harness";

/** RESUME, the first pause item (specs/ui.md, `PAUSE_ITEMS`). */
const RESUME = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resumes the match when a click confirms RESUME", async () => {
  assertEqual(PAUSE_ITEMS[RESUME], "RESUME");
  enterPlaying(h, "solo");
  poseWorld(h, { balls: [], obstacles: [] });
  openPause(h, "playing");

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.resumeScreen, "playing");
  assertEqual(paused.menuIndex, RESUME);

  await clickItem(h, RESUME);
  captureStill(h, "resumed");

  assertEqual(h.snapshot().screen, paused.resumeScreen);
});
