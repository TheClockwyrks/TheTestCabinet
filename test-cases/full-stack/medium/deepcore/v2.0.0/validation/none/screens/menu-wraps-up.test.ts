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
import { assertEqual } from "../assert";
import { MODE_ITEMS } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** The last index of the menu the wrap is read on. */
const LAST = MODE_ITEMS.length - 1;

/**
 * The frames the replay is padded with, so the wrap is something a reviewer can
 * WATCH rather than a flicker. The recorder is armed on the posed menu for
 * `RUN_UP` and the wrapped highlight is held for `SETTLE`; neither decides
 * anything.
 */
const RUN_UP = 24;
const SETTLE = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps from the first entry to the last", async () => {
  await h.debug.setAutoStep(false);
  await h.debug.reset();
  await h.debug.setScreen("mode-select");
  await h.debug.setMenuIndex(0);

  let landed = -1;
  await captureReplay(h, "wrap", async () => {
    await h.advance(RUN_UP);
    await h.tap(ACTION_KEY.up);
    landed = (await h.snapshot()).menuIndex;
    await h.advance(SETTLE);
  });

  assertEqual(
    landed,
    LAST,
    "specs/controls.md: up from the first entry wraps to the last",
  );
});
