// Floe — pointer/slide-off-cancels:
// a press and a release in different regions confirm nothing.
//
// `specs/ui.md`'s "Pointer and touch" gives a pointer three effects on a menu: a
// pointer moved onto an item's region selects that item, a press and its release
// inside one region confirm it, and two edges falling in different regions
// confirm nothing.
//
// THIS POINT IS THE THIRD OF THE THREE. The press lands inside
// `HOW TO PLAY` and the release inside `CROSS`, so neither entry is
// confirmed and the title is still showing afterwards.
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
// input pipeline the build's own layer listens on, one driven tick per part, so
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
  mouseGlide,
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

afterEach(async () => {
  await h.dispose();
});

it("confirms nothing when the release lands on a different item", async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(CROSS_ITEM);
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the reset opened the title screen",
  );

  // Pressed inside HOW TO PLAY's region and released inside CROSS's: two edges
  // in two different regions, which specs/ui.md says confirm no item at all.
  const pressed = rectCenter(await menuRect(h, HOWTO_ITEM));
  const released = rectCenter(await menuRect(h, CROSS_ITEM));
  await mousePress(h, pressed.x, pressed.y);
  await mouseGlide(h, released.x, released.y);
  await mouseRelease(h);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "a press and a release in two different regions confirm neither item, so " +
      "neither the how-to screen nor a crossing was opened (specs/ui.md)",
  );
});
