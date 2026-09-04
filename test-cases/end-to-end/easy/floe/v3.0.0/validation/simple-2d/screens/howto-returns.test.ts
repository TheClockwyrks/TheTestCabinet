// Floe — screens/howto-returns: the back action leaves the how-to screen for the
// title.
//
// `specs/ui.md`, the `howto` row of the transitions table: "Confirm, back —
// Returns to `title` with `menuIndex` at `0`." `specs/controls.md` binds back to
// `Escape` and reads it as a press edge on every screen, and settles the one
// ambiguity that key carries: "`Escape` drives both pause and back. On the
// `playing` screen it pauses; on every other screen it goes back." The how-to
// screen is every other screen, so one `Escape` there must land on the title.
//
// THE SCREEN IS POSED, NOT NAVIGATED TO. `setScreen("howto")` puts the game on the
// screen this point is about in one operation, so a build whose title menu never
// reaches the how-to screen still has the way OUT of it graded here and loses
// `screens.howto-opens` instead. A longer route through the title menu would make
// one defect cost two points and would tell a reviewer less about which of the two
// the build got wrong.
//
// THE BACK KEY, AND ONLY IT. `specs/ui.md` gives the how-to screen two ways out,
// confirm and back, and this point is the back one; there is no separate
// `controls.back-escape`, because `Escape` is the only key bound to back and
// grading it twice would cap the same defect twice.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/**
 * One frame after the press, so the still shows the screen the back key returned
 * to. Nothing is measured across it.
 */
const SETTLE_TICKS = 1;

/**
 * The title entry the how-to screen is opened from, and returns to
 * (`specs/ui.md`).
 */
const HOWTO_ITEM = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when Escape is pressed on the how-to screen", async () => {
  h.debug.reset();
  h.debug.setScreen("howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the pose opened the how-to screen",
  );

  await h.tap(BINDINGS.back[0]);
  await h.advance(SETTLE_TICKS);
  captureStill(h, "title");

  const landed = h.snapshot();
  assertEqual(
    landed.screen,
    "title",
    "the back action on the how-to screen returns to the title (specs/ui.md)",
  );
  assertEqual(
    landed.menuIndex,
    HOWTO_ITEM,
    `with ${TITLE_ITEMS[HOWTO_ITEM]} selected, the entry that opened it ` +
      `(specs/ui.md)`,
  );
});
