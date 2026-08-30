// screens/menu-wraps — the highlight wraps at both ends of a menu.
//
// specs/controls.md, on a menu screen: "`up`, `down` — Move the highlighted item
// up and down, wrapping at the ends." So `down` from the last entry lands on the
// first and `up` from the first lands on the last, rather than sticking at either
// end.
//
// WHY THE MODE CHOICE. `MODE_ITEMS` is three entries long whatever else is true
// of the session — unlike the title, whose length moves with the save slot — so
// the index each press must land on is fixed before the drive starts, and both
// ends are two presses apart.
//
// ISOLATION. The mode choice reached directly through the surface rather than
// through the title, because a build with a broken title menu and a working
// wrap must pass this and fail that one. Nothing about the expedition is touched.

import { afterEach, beforeEach, it } from "vitest";
import { MODE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** The last index of the menu the wrap is read on. */
const LAST = MODE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps from the last entry to the first and back again", async () => {
  h.debug.reset();
  h.debug.setScreen("mode-select");
  h.debug.setMenuIndex(0);

  const walked: number[] = [];
  await captureReplay(h, "wrap", async () => {
    // Down, once per entry: the last press is the one that has to wrap.
    for (let step = 0; step < MODE_ITEMS.length; step += 1) {
      await h.tap(ACTION_KEY.down);
      walked.push(h.snapshot().menuIndex);
    }
    // And up from the first, which has to wrap the other way.
    await h.tap(ACTION_KEY.up);
    walked.push(h.snapshot().menuIndex);
  });

  for (let step = 0; step < MODE_ITEMS.length; step += 1) {
    assertEqual(
      walked[step],
      (step + 1) % MODE_ITEMS.length,
      `specs/controls.md: down moves the highlight, press ${step + 1} of ${MODE_ITEMS.length}`,
    );
  }
  assertEqual(
    walked[MODE_ITEMS.length - 1],
    0,
    "specs/controls.md: down from the last entry wraps to the first",
  );
  assertEqual(
    walked[MODE_ITEMS.length],
    LAST,
    "specs/controls.md: up from the first entry wraps to the last",
  );
});
