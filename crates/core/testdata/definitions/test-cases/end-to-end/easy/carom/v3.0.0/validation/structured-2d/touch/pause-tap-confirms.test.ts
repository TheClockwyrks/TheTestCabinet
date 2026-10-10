// Carom — touch/pause-tap-confirms: a tap confirms an item on the pause menu.
//
// specs/ui.md: "A touch contact lands and lifts inside one item's region" makes
// `menuIndex` that item's index AND confirms it, and the effect of the confirm
// is the one the keyboard table gives `confirm` on that screen. On `paused` the
// first item is `RESUME`, whose confirm sets `screen = resumeScreen`, so the
// screen the tap leaves is the whole reading.
//
// WHAT THIS GRADES THAT THE TITLE POINTS CANNOT. The contact handling is one
// piece of code, and `tap-confirms` reads it once on the title. What is per
// screen is whether a screen takes a finger AT ALL, and a build that reaches its
// pause menu only through a key is a build a player on a tablet cannot leave.
//
// `RESUME`'s region is read back through `menuItemRect`, and the contact lands
// and lifts in the middle of it. The contact carries `pointerType: "touch"`, so
// a build that reads the device sees a finger rather than a mouse, and no key is
// pressed — a build whose keyboard confirm is broken still has its finger graded
// here.
//
// The pause menu is POSED by `openIsolatedPaused`, so the key that OPENS it is
// `controls-*/escape` and `controls-*/p`'s point rather than this one's, and the
// field behind the menu holds the one ball live play needs and no obstacles —
// nothing there can bank a shot into a goal and move the screen this point is
// reading. Neither paddle is taken from the player. The still is the frame the
// gesture left.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openIsolatedPaused,
  touchMenuItem,
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

it("resumes the match when a tap confirms RESUME", async () => {
  assertEqual(PAUSE_ITEMS[RESUME], "RESUME");
  const live = await openIsolatedPaused(h, { mode: "solo" });
  assertEqual(live.hit, true);

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.resumeScreen, "playing");
  assertEqual(paused.menuIndex, RESUME);

  await touchMenuItem(h, RESUME);
  captureStill(h, "resumed");

  assertEqual(h.snapshot().screen, paused.resumeScreen);
});
