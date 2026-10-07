// Floe — pointer/click-confirms:
// a press and its release inside one region confirm that item.
//
// `specs/ui.md`'s "Pointer and touch" gives a pointer three effects on a menu: a
// pointer moved onto an item's region selects that item, a press and its release
// inside one region confirm it, and two edges falling in different regions
// confirm nothing.
//
// THIS POINT IS THE SECOND OF THE THREE. Both edges land inside
// `HOW TO PLAY`, `TITLE_ITEMS` index `1`, which is the entry a wrong
// reading of the pointer cannot reach by accident.
//
// THE REGION IS THE BUILD'S OWN. "Each menu item occupies a rectangular hit
// region the build lays out", and `specs/instrumentation.md` has the build report
// it: `menuItemRect(index)` answers `{ x, y, w, h }` in logical units for the
// menu the current screen shows. So this asks the build where it put the item and
// aims at the middle of the region it named. Every layout passes; the build that
// fails is the one that reports a region it does not answer on, which is the same
// defect from a player's side as a menu that cannot be clicked.
//
// THE SCREEN IS THE TITLE, and that is deliberate: `CROSS` opens a live
// crossing, so a confirm that should not have happened is loud here rather than
// silent.
//
// THE GESTURE IS A REAL DEVICE. The mouse moves, presses and releases through the
// input pipeline the build's own layer listens on, one driven frame per part, so
// what is graded is the build's handling of a player's hand rather than a pose.
//
// WHAT IS NOT GRADED HERE. That the regions are well formed at all is
// `instrumentation.menu-item-rect`; what confirming `HOW TO PLAY` does is
// `screens.howto-opens`. This point is the pointer's own effect and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  menuRect,
  mousePress,
  mouseRelease,
  rectCenter,
  type Harness,
} from "../harness";

/** The entry the gesture aims at: `HOW TO PLAY`, `TITLE_ITEMS` index `1`. */
const HOWTO_ITEM = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** The entry the title opens on, which the pose leaves highlighted. */
const CROSS_ITEM = TITLE_ITEMS.indexOf("CROSS");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirms the item a press and its release both fall in", async () => {
  h.debug.reset();
  h.debug.setMenuIndex(CROSS_ITEM);

  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the reset opened the title screen");
  assertEqual(
    posed.menuIndex,
    CROSS_ITEM,
    `the pose highlighted ${TITLE_ITEMS[CROSS_ITEM]}, the entry a fresh title opens on`,
  );

  const target = rectCenter(menuRect(h, HOWTO_ITEM));
  await mousePress(h, target.x, target.y);
  await mouseRelease(h);
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    `a press and release inside ${TITLE_ITEMS[HOWTO_ITEM]}'s region confirm it, ` +
      "and confirming it opens the how-to screen (specs/ui.md)",
  );
});
