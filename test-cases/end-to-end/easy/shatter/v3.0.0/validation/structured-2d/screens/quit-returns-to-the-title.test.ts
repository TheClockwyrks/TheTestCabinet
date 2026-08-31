// screens/quit-returns-to-the-title — QUIT TO MENU leaves the game for the
// title screen.
//
// `specs/ui.md` gives the pause menu's third entry, `QUIT TO MENU`, one effect:
// it "Returns to `title`, with the title's highlight at the first entry." What
// this point decides is the route — the screen the game lands on.
//
// THE ENTRY IS POSED, NOT WALKED TO. `setMenuIndex(2)` puts the highlight on
// `QUIT TO MENU` outright (`specs/instrumentation.md`), so a build with a broken
// menu key loses `controls/menu-*` rather than this point as well.
//
// THE ENTRY IS CONFIRMED THROUGH THE REGISTERED ACTION, because which key
// confirms is `controls/confirm-enter`'s and `controls/confirm-space`'s.
//
// AND THE TITLE IS THE PRESS'S DOING. A quarter second runs on the pause screen
// with nothing down and the screen is read at the end of it, so a build whose
// pause menu wanders back to its title on its own is caught there rather than
// passing here.
//
// THE WORLD IS THE QUIET ONE `startPlaying` LEAVES, so nothing on the field can
// reach the screen while the press is taken.
//
// WHAT THIS DOES NOT DECIDE. What the menu shows
// (`screens/pause-menu-entries`), the other two entries
// (`screens/resume-returns-to-play`, `screens/restart-begins-a-new-game`), and
// what the title screen then draws (`screens/title-*`).

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The entry the highlight is posed on: `QUIT TO MENU`, the third. */
const QUIT = 2;

/** The quiet stretch driven on the pause screen before the press, in ticks. */
const QUIET_TICKS = ticksFor(0.25);

/** Frames driven after the press for the still alone, in ticks. */
const PICTURE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when QUIT TO MENU is confirmed", async () => {
  // The pause menu over the empty, quiet field `startPlaying` leaves, with the
  // highlight posed on the third entry.
  startPlaying(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(QUIT);

  await h.advance(QUIET_TICKS);
  const before = h.snapshot();

  await tapAction(h, "confirm");
  const after = h.snapshot().screen;

  await h.advance(PICTURE_TICKS);
  captureStill(h, "title");

  assertEqual(
    before.screen,
    "paused",
    `the screen after ${String(QUIET_TICKS)} ticks on the pause menu with no ` +
      "key down — a paused game leaves the menu on a confirmed entry " +
      "(specs/ui.md)",
  );
  assertEqual(
    before.menuIndex,
    QUIT,
    "the highlighted entry the press was taken on, posed through " +
      "setMenuIndex (specs/instrumentation.md)",
  );
  assertEqual(
    after,
    "title",
    `the screen on the tick confirm was pressed with the pause menu on entry ` +
      `${String(QUIT)} of ${String(PAUSE_ITEMS.length)}, ` +
      `${JSON.stringify(PAUSE_ITEMS[QUIT])} — that entry returns to title ` +
      "(specs/ui.md)",
  );
});
