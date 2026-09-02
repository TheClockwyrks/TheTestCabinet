// Wick — instrumentation/menu-rects-reported: `menuRects()` reports one
// rectangle per item of the menu the screen shows, in menu order, each
// carrying `x`, `y`, `width`, and `height` in stage coordinates.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Menus", `menuRects()`: "Reports the rectangles of the current screen's
// vertical menu, in menu order, each a plain object carrying `x`, `y`,
// `width`, and `height` in stage coordinates ... `title`, `levelup`, `paused`,
// `fallen`, and `dawn` report one rectangle per item of the menu they show."
// `specs/controls.md`, The pointer: "Each item the menu currently shows
// occupies a rectangle on the stage, and no two of a screen's rectangles
// overlap." The menus are `specs/ui.md`'s: `TITLE_ITEMS` on `title`, "the
// offers in `offers`" under the names the offer table gives them on `levelup`,
// `PAUSE_ITEMS` on `paused`, and `END_ITEMS` on `fallen` and `dawn`.
//
// WHAT IS READ, AND WHY. The count, the four fields of every rectangle, that
// no two of them overlap, and which item each rectangle belongs to. Belonging
// is read off the frame: the item that "occupies" a rectangle is the one whose
// name the frame drew inside it, and the names of one menu are distinct, so a
// list reported in any other order puts the wrong name in the wrong rectangle.
// Neither the geometry nor the pointer decides it — `specs/ui.md` fixes no
// layout, and a build hit-testing the pointer against the list it reports
// agrees with itself whatever order that list is in.
//
// THE DRIVE. Each of the five screens in turn, then one frame read for its
// text: `reset` for `title`; an isolated run with `setNextOffers` naming
// Ember, Tallow, and Pin and the one tick that opens the overlay for
// `levelup`, so the three names on it are known rather than drawn at random;
// `setScreen("paused")` for `paused`; and the real endings for `fallen` and
// `dawn`.
//
// THE TOLERANCE. Each name is matched as a substring, ignoring case, so a
// build that writes a marker, a tag, or a level beside it reads the same. The
// counts are the lengths of the menus `specs/ui.md` names.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  END_ITEMS,
  PASSIVES,
  PAUSE_ITEMS,
  TITLE_ITEMS,
  WEAPON_NAMES,
  type OfferId,
} from "../constants";
import {
  captureStill,
  createHarness,
  endDawn,
  endFallen,
  isolate,
  menuRects,
  openLevelUp,
  poseScreen,
  textDraws,
  type Harness,
  type Screen,
} from "../harness";
import {
  assertDisjoint,
  assertLabelledInOrder,
  assertRectShape,
} from "./rects";

/** The overlay's offers, queued so the three names it lists are known. */
const OFFERS: readonly OfferId[] = ["ember", "tallow", "pin"];

/** The names `specs/ui.md`'s offer table lists those three under. */
const OFFER_NAMES: readonly string[] = [
  WEAPON_NAMES.ember,
  PASSIVES.tallow.name,
  WEAPON_NAMES.pin,
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/**
 * One screen's menu: the rectangles number `labels.length`, each is a stage
 * rectangle, none of them overlaps another, and rectangle `i` is the area the
 * item at `menuIndex` `i` is drawn in.
 */
async function checkMenu(
  screen: Screen,
  labels: readonly string[],
): Promise<void> {
  assertEqual(h.snapshot().screen, screen, `screen reached for ${screen}`);
  const rects = menuRects(h);
  assertLength(rects, labels.length, `menuRects() on ${screen}`);
  rects.forEach((rect, i) => {
    assertRectShape(rect, `menuRects() on ${screen}, rectangle ${i}`);
  });
  assertDisjoint(rects, `menuRects() on ${screen}`);
  const drawn = await h.frameDraw();
  assertLabelledInOrder(
    h,
    textDraws(drawn.calls),
    rects,
    labels,
    `menuRects() on ${screen} reports the menu's rectangles in menu order`,
  );
}

it("reports one rectangle per menu item, in menu order, on all five menu screens", async () => {
  h.reset();
  await checkMenu("title", TITLE_ITEMS);

  isolate(h);
  h.debug.setNextOffers(OFFERS);
  const overlay = await openLevelUp(h, 1);
  assertLength(
    overlay.run.offers,
    OFFERS.length,
    "the queued offers presented",
  );
  await checkMenu("levelup", OFFER_NAMES);

  isolate(h);
  poseScreen(h, "paused");
  await checkMenu("paused", PAUSE_ITEMS);

  isolate(h);
  await endFallen(h);
  await checkMenu("fallen", END_ITEMS);

  isolate(h);
  await endDawn(h);
  await checkMenu("dawn", END_ITEMS);
  captureStill(h, "rects");
});
