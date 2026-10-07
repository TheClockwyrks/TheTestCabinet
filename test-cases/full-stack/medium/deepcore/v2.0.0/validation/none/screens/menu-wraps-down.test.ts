// screens/menu-wraps-down — down from the last entry lands on the first.
//
// specs/controls.md, on a menu screen: "`up`, `down` — Move the highlighted item
// up and down, wrapping at the ends." This is the DOWN half of that sentence: a
// press on the last entry puts the highlight back on the first rather than
// sticking at the bottom of the list.
//
// THE OTHER HALF IS ITS OWN POINT. `screens/menu-wraps-up` decides the up
// direction, because a build that wraps downward and stops dead at the top must
// grade differently from one that wraps in neither direction.
//
// WHY THE MODE CHOICE. `MODE_ITEMS` is three entries long whatever else is true
// of the session — unlike the title, whose length moves with the save slot — so
// the index each press must land on is fixed before the drive starts.
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

/**
 * The frames the replay is padded with, so the wrap is something a reviewer can
 * WATCH rather than a flicker.
 *
 * A press is one frame, and three presses recorded back to back are three frames.
 * The recorder is armed on the posed menu for `RUN_UP`, each press is left on
 * screen for `BETWEEN`, and the wrapped highlight is held for `SETTLE`. Nothing
 * here decides anything — the assertions read the indices the presses produced,
 * which the padding does not touch.
 */
const RUN_UP = 24;
const BETWEEN = 15;
const SETTLE = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps from the last entry to the first", async () => {
  await h.debug.setAutoStep(false);
  await h.debug.reset();
  await h.debug.setScreen("mode-select");
  await h.debug.setMenuIndex(0);

  const walked: number[] = [];
  await captureReplay(h, "wrap", async () => {
    await h.advance(RUN_UP);
    // Down, once per entry: the last press is the one that has to wrap.
    for (let step = 0; step < MODE_ITEMS.length; step += 1) {
      await h.tap(ACTION_KEY.down);
      walked.push((await h.snapshot()).menuIndex);
      await h.advance(step === MODE_ITEMS.length - 1 ? SETTLE : BETWEEN);
    }
  });

  for (let step = 0; step < MODE_ITEMS.length - 1; step += 1) {
    assertEqual(
      walked[step],
      step + 1,
      `specs/controls.md: down moves the highlight, press ${step + 1} of ${MODE_ITEMS.length}`,
    );
  }
  assertEqual(
    walked[MODE_ITEMS.length - 1],
    0,
    "specs/controls.md: down from the last entry wraps to the first",
  );
});
