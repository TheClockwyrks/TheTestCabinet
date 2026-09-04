// screens/howto-reachable — confirming HOW TO PLAY on the title opens the
// how-to screen.
//
// `specs/ui.md` gives the title menu's second entry, `HOW TO PLAY`, one effect:
// it "Moves to `howto`." That is the whole of this point — one route between two
// of the five screens.
//
// THE ENTRY IS POSED, NOT WALKED TO. `setMenuIndex` "Sets the highlighted entry
// of whatever menu the current screen shows, counted from `0`"
// (`specs/instrumentation.md`), so the highlight is put on entry `1` outright
// rather than driven there with a menu key. Driving it would fold
// `controls/menu-down-arrow`'s requirement into this one, and a build with a
// broken down key would then lose two points for one fault.
//
// THE ENTRY IS CONFIRMED THROUGH THE REGISTERED ACTION, because which KEY
// confirms is `controls/confirm-enter`'s and `controls/confirm-space`'s.
//
// AND THE SCREEN IS THE PRESS'S DOING. A quarter second runs on the title with
// nothing down and the screen is read at the end of it, so a build that wanders
// off its own title screen on a timer is caught there rather than passing here.
//
// WHAT THIS DOES NOT DECIDE. What the how-to screen says
// (`screens/howto-shows-the-controls`), the way back from it
// (`screens/howto-returns`), and the first entry
// (`screens/play-starts-a-game`).

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The entry the highlight is posed on: `HOW TO PLAY`, the second. */
const HOW_TO_PLAY = 1;

/** The quiet stretch driven on the title before the press, in ticks. */
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

it("moves to the howto screen when HOW TO PLAY is confirmed", async () => {
  // The title `reset` restores, with the highlight posed on the second entry.
  resetTo(h);
  h.debug.setMenuIndex(HOW_TO_PLAY);

  await h.advance(QUIET_TICKS);
  const before = h.snapshot();

  await tapAction(h, "confirm");
  const after = h.snapshot().screen;

  await h.advance(PICTURE_TICKS);
  captureStill(h, "howto");

  assertEqual(
    before.screen,
    "title",
    `the screen after ${String(QUIET_TICKS)} ticks on the title with no key ` +
      "down — the game opens on the title and leaves it on a confirmed entry " +
      "(specs/ui.md)",
  );
  assertEqual(
    before.menuIndex,
    HOW_TO_PLAY,
    "the highlighted entry the press was taken on, posed through " +
      "setMenuIndex (specs/instrumentation.md)",
  );
  assertEqual(
    after,
    "howto",
    `the screen on the tick confirm was pressed with the title menu on entry ` +
      `${String(HOW_TO_PLAY)} of ${String(TITLE_ITEMS.length)}, ` +
      `${JSON.stringify(TITLE_ITEMS[HOW_TO_PLAY])} — that entry moves to ` +
      "howto (specs/ui.md)",
  );
});
