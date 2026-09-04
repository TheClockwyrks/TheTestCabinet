// screens/menu-wraps-up — up from the first entry lands on the last.
//
// specs/controls.md, on a menu screen: "`up`, `down` — Move the highlighted item
// up and down, wrapping at the ends." This is the UP half of that sentence: a
// press on the first entry puts the highlight on the last rather than sticking at
// the top of the list.
//
// THE OTHER HALF IS ITS OWN POINT. `screens/menu-wraps-down` decides the down
// direction, because a build that wraps downward and stops dead at the top must
// grade differently from one that wraps in neither direction.
//
// WHY THE MODE CHOICE. `MODE_ITEMS` is three entries long whatever else is true
// of the session — unlike the title, whose length moves with the save slot — so
// the index the press must land on is fixed before the drive starts.
//
// ISOLATION. The mode choice reached directly through the surface rather than
// through the title, because a build with a broken title menu and a working
// wrap must pass this and fail that one. Nothing about the expedition is touched.

import { afterEach, beforeEach, it } from "vitest";
import { MODE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** The last index of the menu the wrap is read on. */
const LAST = MODE_ITEMS.length - 1;

/**
 * Frames the recording holds still either side of the press, so the wrap is
 * something a reviewer can watch rather than a flicker. Neither figure decides
 * anything.
 */
const RUN_UP_FRAMES = 10;
const SETTLE_FRAMES = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps from the first entry to the last", async () => {
  h.debug.reset();
  h.debug.setScreen("mode-select");
  h.debug.setMenuIndex(0);

  let landed = -1;
  await captureReplay(h, "wrap", async () => {
    // The menu at rest on its first entry, before anything is pressed.
    await h.advance(RUN_UP_FRAMES);
    await h.tap(ACTION_KEY.up);
    landed = h.snapshot().menuIndex;
    await h.advance(SETTLE_FRAMES);
  });

  assertEqual(
    landed,
    LAST,
    "specs/controls.md: up from the first entry wraps to the last",
  );
});
