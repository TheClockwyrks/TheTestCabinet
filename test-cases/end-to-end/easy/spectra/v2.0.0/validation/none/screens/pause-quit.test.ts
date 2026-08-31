// Spectra — screens/pause-quit: QUIT TO MENU returns to the title.
//
// THE RULE. `specs/ui.md`, on the `paused` menu's third entry: "`QUIT TO MENU`
// Returns to `title`, with the title's highlight at the first item." This point
// decides the screen that entry reaches.
//
// EVERY WRONG MODEL READS AS A DIFFERENT SCREEN. A confirm wired to nothing leaves
// the game on `paused`; a confirm that ignores the highlight and takes `RESUME`
// reaches `inWave`; one that takes `RESTART` reaches `stageIntro`; and only the
// route `specs/ui.md` states reaches `title`. That is what makes the third entry
// the right one to pose: the two wrong entries and the wrong key all land
// somewhere else, each somewhere different.
//
// THE HIGHLIGHT IS PLACED, NOT WALKED TO. `setMenuIndex` is what
// `specs/instrumentation.md` provides for posing the highlighted item of whatever
// menu the current screen shows, so the menu keys cannot fail this point. Which
// index `QUIT TO MENU` is, is read off `PAUSE_ITEMS`, whose order `specs/ui.md`
// fixes.
//
// WHAT IS NOT ASSERTED. Where the title's highlight rests on arriving, which
// `controls/back-escape` reads on the route out of the how-to screen; that `Enter`
// is one of `confirm`'s keys, which is `controls/confirm-enter`'s; what the paused
// screen draws, which is `screens/pause-menu-items`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/** Which entry of `PAUSE_ITEMS` is confirmed, and the copy it must be. */
const QUIT_INDEX = 2;
const QUIT_ITEM = "QUIT TO MENU";

/** The key `specs/controls.md` binds `confirm` to. */
const CONFIRM_KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the game to the title when QUIT TO MENU is confirmed", async () => {
  await startPosed(h);
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(QUIT_INDEX);
  await h.advance(1);

  assertEqual(
    PAUSE_ITEMS[QUIT_INDEX],
    QUIT_ITEM,
    "the third PAUSE_ITEMS entry is QUIT TO MENU (specs/ui.md)",
  );
  const before = await h.snapshot();
  assertEqual(before.screen, "paused", "the game is on the paused screen");
  assertEqual(
    before.menuIndex,
    QUIT_INDEX,
    "with QUIT TO MENU highlighted before the press",
  );

  await h.tap(CONFIRM_KEY);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    `confirming the highlighted ${QUIT_ITEM} entry returning the game to the ` +
      "title screen (specs/ui.md)",
  );
});
