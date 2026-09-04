// Floe — screens/pause-menu: the pause menu offers all three of its entries.
//
// `specs/ui.md` fixes the screen's contents in the screens table: `paused` shows
// "The strait, visible and frozen, behind a menu of `PAUSE_ITEMS` (`RESUME`,
// `RESTART`, `QUIT TO MENU`) in that order." Three named strings, all three
// required, and a build that offers two of them has left a player with no way to
// reach the third — the pause menu is the only route to a restart and the only
// route back to the title from inside a run.
//
// WHAT IS READ IS THE FRAME, NOT THE STATE. There is no field of the snapshot
// that says which entries a menu carries; `menuIndex` says only which one is
// highlighted. So the three strings are looked for in the text one rendered frame
// actually drew, exactly as `screens.title-contents` reads the title's four.
//
// THE SCREEN IS POSED, NOT PAUSED WITH A KEY. `setScreen("paused")` reaches the
// subject in one operation, so a build whose pause key is dead loses
// `controls/pause-p` and `controls/pause-escape` and still has its pause menu
// graded here. It is posed over a LIVE CROSSING rather than over a fresh reset,
// because that is the only place `specs/ui.md` puts the screen and a build is
// entitled to draw its pause menu only from a run.
//
// THE MATCH IS A SUBSTRING, PAST THE HUD. A menu entry is commonly set with a
// marker beside it ("> RESUME <"), and casing, font and typography are the
// build's, so each entry is looked for inside the frame's copy rather than as a
// whole run. Only what the build drew over the strait counts, which is what
// `screenCopy` filters to: `specs/ui.md` requires the HUD on `playing` and a
// build is free to keep drawing it under the pause menu.
//
// THE ORDER IS NOT GRADED HERE. `specs/ui.md` fixes it, and the three transition
// items decide it between them: `screens.pause-resume` confirms index `0` and
// requires what `RESUME` names, `screens.pause-restart` index `1`, and
// `screens.pause-quit` index `2`. A build that listed the three in another order
// keeps this point and loses those.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertMatches } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import { frameText, screenCopy, screenRuns } from "./screens";

/** Every string `specs/ui.md` requires the pause menu to carry. */
const REQUIRED_COPY: readonly string[] = PAUSE_ITEMS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws RESUME, RESTART and QUIT TO MENU on the pause menu", async () => {
  startCrossing(h);
  h.debug.setScreen("paused");

  assertEqual(
    h.snapshot().screen,
    "paused",
    "the pose opened the pause menu over a live crossing",
  );

  const spans = await frameText(h);
  captureStill(h, "pause");

  const copy = screenCopy(spans);
  assertGreaterThan(
    screenRuns(spans).length,
    0,
    "the pause menu to draw text over the strait at all (specs/ui.md)",
  );
  for (const required of REQUIRED_COPY) {
    assertMatches(
      copy,
      required.toUpperCase(),
      `the pause menu draws ${JSON.stringify(required)} (specs/ui.md)`,
    );
  }
});
