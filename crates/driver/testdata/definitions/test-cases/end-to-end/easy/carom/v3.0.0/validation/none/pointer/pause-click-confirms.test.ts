// pointer/pause-click-confirms — a click confirms an item on the pause menu.
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
// The pause menu is posed over an EMPTIED field with `openIsolatedPauseMenu`,
// which sets what specs/ui.md says a `pause` edge sets — `resumeScreen = playing` and
// `menuIndex = 0` — so the key that opens the menu is the pause category's point
// rather than this one's. `RESUME`'s region is read back through `menuItemRect`,
// and the press and the release land in the middle of it: where the build put
// the item is the build's own and is never guessed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  clickItem,
  createHarness,
  openIsolatedPauseMenu,
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

it("resumes the match when a click confirms RESUME", async () => {
  assertEqual(PAUSE_ITEMS[RESUME], "RESUME");
  await openIsolatedPauseMenu(h, { mode: "solo", from: "playing" });
  const paused = await h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.resumeScreen, "playing");

  await clickItem(h, RESUME);
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(resumed.screen, paused.resumeScreen);
});
