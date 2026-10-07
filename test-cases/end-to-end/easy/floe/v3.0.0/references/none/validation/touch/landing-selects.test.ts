// Floe — touch/landing-selects:
// a touch contact selects the item it lands on.
//
// `specs/ui.md`'s "Pointer and touch" gives a touch contact two effects on a
// menu: a contact landing inside an item's region, or travelling onto one,
// selects that item, and a contact that lands and lifts inside one region
// selects and confirms it. A confirm requires both of its edges inside one region,
// so a contact that lifts somewhere else confirms nothing.
//
// A CONTACT IS NOT A MOUSE. It has no hover: the first the build hears of it is
// the LANDING, and the landing is what selects.
//
// THIS POINT IS THE LANDING'S OWN EFFECT, so the contact is left DOWN
// and nothing here can be what a lift did. The entry aimed at is
// `HOW TO PLAY`, `TITLE_ITEMS` index `1`.
//
// THE REGION IS THE BUILD'S OWN. "Each menu item occupies a rectangular hit
// region the build lays out", and `specs/instrumentation.md` has the build report
// it: `menuItemRect(index)` answers `{ x, y, w, h }` in logical units for the
// menu the current screen shows. So this asks the build where it put the item and
// aims at the middle of the region it named. Every layout passes; the build that
// fails is the one that reports a region it does not answer on.
//
// THE SCREEN IS THE TITLE, and that is deliberate: `CROSS` opens a live
// crossing, so a confirm that should not have happened is loud here rather than
// silent.
//
// WHAT IS NOT GRADED HERE. That the regions are well formed at all is
// `instrumentation.menu-item-rect`; what confirming `HOW TO PLAY` does is
// `screens.howto-opens`. This point is the contact's own effect and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  menuRect,
  rectCenter,
  touchPress,
  type Harness,
} from "../harness";

/** The entry the contact aims at: `HOW TO PLAY`, `TITLE_ITEMS` index `1`. */
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

it("selects the item a touch contact lands on, before it lifts", async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(CROSS_ITEM);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the reset opened the title screen");
  assertEqual(
    posed.menuIndex,
    CROSS_ITEM,
    `the pose highlighted ${TITLE_ITEMS[CROSS_ITEM]}, the entry a fresh title opens on`,
  );

  // The contact is LEFT DOWN, so nothing here can be the effect of a lift: what
  // is read is what the landing alone did.
  const target = rectCenter(await menuRect(h, HOWTO_ITEM));
  await touchPress(h, target.x, target.y);
  await captureStill(h, "selected");

  const after = await h.snapshot();
  assertEqual(
    after.menuIndex,
    HOWTO_ITEM,
    `a contact landing inside ${TITLE_ITEMS[HOWTO_ITEM]}'s region selects it (specs/ui.md)`,
  );
  assertEqual(
    after.screen,
    "title",
    "and selects it rather than confirming it: a confirm takes the lift as well",
  );
});
