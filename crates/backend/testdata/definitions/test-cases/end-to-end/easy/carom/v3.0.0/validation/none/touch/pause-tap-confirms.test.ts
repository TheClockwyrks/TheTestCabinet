// touch/pause-tap-confirms — a tap confirms an item on the pause menu.
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
// The pause menu is posed over an EMPTIED field with `openIsolatedPauseMenu`,
// which sets what specs/ui.md says a `pause` edge sets — `resumeScreen = playing` and
// `menuIndex = 0` — so the key that opens the menu is the pause category's point
// rather than this one's. `RESUME`'s region is read back through `menuItemRect`,
// and the contact lands and lifts in the middle of it: where the build put the
// item is the build's own and is never guessed.
//
// Both edges are real touch events through Chromium's own input pipeline, and no
// key is pressed, so a build whose keyboard confirm is broken still has its
// finger graded here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openIsolatedPauseMenu,
  tapItem,
  type Harness,
} from "../harness";

/** RESUME, the first pause item (specs/ui.md, `PAUSE_ITEMS`). */
const RESUME = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resumes the match when a tap confirms RESUME", async () => {
  assertEqual(PAUSE_ITEMS[RESUME], "RESUME");
  await openIsolatedPauseMenu(h, { mode: "solo", from: "playing" });
  const paused = await h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.resumeScreen, "playing");

  await tapItem(h, RESUME);
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(resumed.screen, paused.resumeScreen);
});
