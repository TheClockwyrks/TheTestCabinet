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
import { MODE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/**
 * Frames the recording holds still on either side of the walk, and between the
 * presses.
 *
 * A press and the frame that delivers it is one frame of motion, so a recording
 * of the bare presses is three frames — a flicker rather than something a
 * reviewer can watch. The highlight is left to rest on each entry long enough to
 * read, with the menu on screen before the first press and after the last, which
 * is what makes the wrap visible as a wrap.
 */
const DWELL_FRAMES = 8;
const RUN_UP_FRAMES = 10;
const SETTLE_FRAMES = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps from the last entry to the first", async () => {
  h.debug.reset();
  h.debug.setScreen("mode-select");
  h.debug.setMenuIndex(0);

  const walked: number[] = [];
  await captureReplay(h, "wrap", async () => {
    // The menu at rest on its first entry, before anything is pressed.
    await h.advance(RUN_UP_FRAMES);
    // Down, once per entry: the last press is the one that has to wrap.
    for (let step = 0; step < MODE_ITEMS.length; step += 1) {
      await h.tap(ACTION_KEY.down);
      walked.push(h.snapshot().menuIndex);
      await h.advance(
        step === MODE_ITEMS.length - 1 ? SETTLE_FRAMES : DWELL_FRAMES,
      );
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
