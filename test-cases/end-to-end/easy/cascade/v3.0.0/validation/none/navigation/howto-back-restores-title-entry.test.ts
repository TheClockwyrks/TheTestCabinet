// navigation/howto-back-restores-title-entry — the how-to screen's BACK returns
// to the title with the entry `titleIndex` names selected.
//
// THE RULE. `specs/screens.md`, Returning to the title: "`BACK` on the how-to
// screen and `MENU` on the HUD both return to `title` with `menuIndex` set to
// `titleIndex`, the title entry last activated. So leaving the how-to screen
// returns to `title` with `HOW TO PLAY` selected, and leaving a game returns with
// the entry that started that game selected."
//
// ONE WAY BACK, ONE POINT. `navigation/hud-menu-restores-title-entry` is the
// other: a build that restores the selection on one route and not on the other
// is a different build from one that restores it on neither.
//
// `titleIndex` IS POSED TO `1`, through `setTitleIndex`
// (`specs/instrumentation.md`), and that is what makes the reading decide
// anything: the naive answer is to select the title's first entry, so a point
// driven with `titleIndex` at `0` would pass on a build that restores nothing.
// `1` is a value only the restoration can produce.
//
// THE SCREEN IS POSED, not reached by activating something else: a check that
// walked here through another control would fail twice for one defect.
// `screens/title-how-to-opens` is the point that grades the route in.
//
// WHAT IT DOES NOT DECIDE. That the how-to screen's BACK reaches the title at
// all, which is `screens/howto-back-returns`'s, nor which entry an ACTIVATION
// writes into `titleIndex`, which is `navigation/title-new-game-remembers`'s and
// `navigation/title-how-to-remembers`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_BACK_ITEM, TITLE_HOW_TO_ITEM } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  menuPoint,
  openHowto,
  type Harness,
} from "../harness";

/** One frame, so the canvas carries the screen the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Activate the item at `index` of the menu the current screen shows. */
async function activate(index: number): Promise<void> {
  const at = await menuPoint(h, index);
  await clickAt(h, at.x, at.y);
  await h.advance(SETTLE_FRAMES);
}

/** The entry the title must come back on, which is not the naive first item. */
const REMEMBERED = TITLE_HOW_TO_ITEM;

it("returns to the title on the entry titleIndex names", async () => {
  await openHowto(h);
  await h.debug.setTitleIndex(REMEMBERED);
  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "howto",
    "posing: the screen the how-to screen's BACK is activated on",
  );
  assertEqual(
    posed.titleIndex,
    REMEMBERED,
    "posing: titleIndex before the return — the value the restoration has to " +
      "carry back, and one the naive answer cannot produce",
  );

  await activate(HOWTO_BACK_ITEM);
  const returned = await h.snapshot();

  // Before the assertions, so a title that came back on the wrong entry still
  // leaves the picture of the menu it drew.
  await captureStill(h, "title");

  assertEqual(
    returned.screen,
    "title",
    "the screen the how-to screen's BACK returned to (specs/screens.md)",
  );
  assertEqual(
    returned.menuIndex,
    REMEMBERED,
    "menuIndex on the title the how-to screen's BACK returned to — it returns with " +
      "menuIndex set to titleIndex, the title entry last activated " +
      "(specs/screens.md)",
  );
});
