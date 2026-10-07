// Floe — screens/howto-confirm-returns: the confirm action leaves the how-to
// screen for the title, with the entry that opened it selected.
//
// `specs/ui.md`, the `howto` row of the transitions table: "Confirm, back —
// Returns to `title` with `HOW TO PLAY` selected, `TITLE_ITEMS` index `1`." The
// screen has two ways out and they are two points: `screens.howto-returns` is the
// BACK one and this is the CONFIRM one, because a build that wired one and not
// the other must grade differently from one that wired neither.
//
// THE SELECTION IS HALF THE CLAIM. "Every route back to `title` selects the entry
// it left by", and the entry that opens the how-to screen is `HOW TO PLAY`. So a
// build that lands on the title with `CROSS` highlighted has lost the player's
// place, and the next confirm opens a crossing rather than the screen they were
// reading — which is why the screen and the index are asserted together rather
// than as two points.
//
// THE SCREEN IS POSED, NOT NAVIGATED TO. `setScreen("howto")` puts the game on
// the screen this point is about in one operation, so a build whose title menu
// never reaches the how-to screen still has the way OUT of it graded here and
// loses `screens.howto-opens` instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The title entry the how-to screen is opened from, and returns to. */
const HOWTO_ITEM = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** One frame after the press, so the still shows the screen it returned to. */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title with HOW TO PLAY selected on a confirm", async () => {
  resetTo(h);
  h.debug.setScreen("howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the pose opened the how-to screen",
  );

  await tapAction(h, "confirm");
  await h.advance(SETTLE_TICKS);
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the confirm action on the how-to screen returns to the title (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    HOWTO_ITEM,
    `with ${TITLE_ITEMS[HOWTO_ITEM]} selected, the entry that opened it (specs/ui.md)`,
  );
});
