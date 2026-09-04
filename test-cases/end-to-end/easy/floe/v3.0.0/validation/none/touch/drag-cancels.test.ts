// Floe — touch/drag-cancels:
// a contact that lifts on a different item confirms nothing.
//
// `specs/ui.md`'s "Pointer and touch" gives a touch contact two effects on a
// menu: a contact landing inside an item's region, or travelling onto one,
// selects that item, and a contact that lands and lifts inside one region
// selects and confirms it. A confirm takes both of its edges inside one region,
// so a contact that lifts somewhere else confirms nothing.
//
// A CONTACT IS NOT A MOUSE. It has no hover: the first the build hears of it is
// the LANDING, and the landing is what selects.
//
// THIS POINT IS THE TWO EDGES FALLING IN DIFFERENT REGIONS. The
// contact lands on `CROSS`, travels onto `HOW TO PLAY` and lifts
// there, so the travel still selects and neither entry is confirmed.
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
  touchGlide,
  touchPress,
  touchRelease,
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

it("selects what it travelled onto and confirms nothing", async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(CROSS_ITEM);
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the reset opened the title screen",
  );

  // Landed inside CROSS's region and lifted inside HOW TO PLAY's: two edges in
  // two different regions, which specs/ui.md says confirm no item at all. The
  // travel still SELECTS, because a contact travelling onto a region selects it.
  const landed = rectCenter(await menuRect(h, CROSS_ITEM));
  const lifted = rectCenter(await menuRect(h, HOWTO_ITEM));
  await touchPress(h, landed.x, landed.y);
  await touchGlide(h, lifted.x, lifted.y);
  await touchRelease(h);
  await captureStill(h, "title");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "a contact that lands on one item and lifts on another confirms neither, " +
      "so neither a crossing nor the how-to screen was opened (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    HOWTO_ITEM,
    `and the travel onto ${TITLE_ITEMS[HOWTO_ITEM]}'s region still selects it`,
  );
});
