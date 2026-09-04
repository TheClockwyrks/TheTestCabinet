// Meltdown — screens/pause-opens-on-resume — the pause menu opens with RESUME
// highlighted, whatever row the last menu was left on.
//
// THE RULE. `specs/screens.md`, "What is highlighted on arrival": arriving at
// `paused` from `playing` highlights `RESUME`, row `0`.
//
// WHY IT MATTERS ENOUGH TO CARRY AN ITEM. `RESUME` is the row a player who paused
// by accident wants under the confirm, and the two rows below it are `RESTART` and
// `QUIT TO MENU` — a build that opens the pause menu on a stale highlight can
// throw away a run on one press.
//
// THE SCREEN IS REACHED, NOT POSED, because an arrival highlight is an ENTRY
// EFFECT: `setScreen` "sets that field alone and runs no entry effect" and resets
// no menu index (`specs/instrumentation.md`), so a posed pause screen would carry
// whatever the pose left. The pause is opened the way a player opens it, with the
// key `specs/controls.md` binds `pause` to.
//
// THE HIGHLIGHT IS LEFT SOMEWHERE ELSE FIRST, on a row of the menu the run passed
// through on its way in, so reading `0` afterwards can only have come from the
// transition. A build that carries the highlight through reads that row, and a
// build that clamps it into the pause menu's three rows reads `2`.
//
// WHAT THIS DOES NOT DECIDE. That `pause` opens the screen at all is
// `controls.pause-key`'s, what the menu draws is `screens.pause-menu`'s, and where
// each of its rows leads is `screens.pause-resume`'s, `screens.pause-restart`'s
// and `screens.pause-quit`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MODE_ITEMS, PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  tapAction,
  type Harness,
} from "../harness";

/** The row the pause menu must open on: `RESUME`, the first of the three. */
const RESUME_ROW = PAUSE_ITEMS.indexOf("RESUME");

/**
 * The row the last menu is left on, before the run reaches the pause.
 *
 * A real row of a real menu — the mode list's last — rather than a number
 * nothing could be highlighting, and in range for the pause menu's own three
 * rows only after a clamp, so a build that clamps is caught as well as one that
 * carries the index through untouched.
 */
const STALE_ROW = MODE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens the pause menu on RESUME, whatever the last menu was left on", async () => {
  await startRun(h);
  await h.debug.setScreen("modeselect");
  await h.debug.setMenuIndex(STALE_ROW);
  await h.debug.setScreen("playing");
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "the screen the pause is opened from");
  assertEqual(
    before.menuIndex,
    STALE_ROW,
    "the row the last menu was left on, carried into live play",
  );

  await tapAction(h, "pause");
  await h.advance(1);
  await captureStill(h, "paused");

  const paused = await h.snapshot();
  assertEqual(
    paused.screen,
    "paused",
    "precondition: the pause key opens the pause screen (specs/controls.md)",
  );
  assertEqual(
    paused.menuIndex,
    RESUME_ROW,
    `the row the pause menu opened on, from a run left on row ${STALE_ROW} ` +
      `(specs/screens.md, What is highlighted on arrival)`,
  );
});
