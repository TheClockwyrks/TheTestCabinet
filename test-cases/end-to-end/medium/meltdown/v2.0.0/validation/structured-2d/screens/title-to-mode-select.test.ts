// Meltdown — screens/title-to-mode-select: confirming PLAY opens the mode list.
//
// THE RULE. specs/screens.md, `title`: of the two rows of `TITLE_ITEMS`, `PLAY`
// leads to `modeselect`, and "It starts no game of its own." specs/controls.md
// gives `confirm` the effect "Takes the highlighted row".
//
// THE DESTINATION IS THE POINT, and it is read twice over: the screen must be
// `modeselect`, and it must NOT be `playing`. The second reading is the half the
// specification puts in a sentence of its own — a build that treats PLAY as
// "start a game" reaches a live run rather than the list, and the mode it starts
// is one the player never chose. Both readings come off the one snapshot after
// the press.
//
// WHY THE CAP IS `broken` AND EVERY DOMAIN IS NAMED. Every route into a run passes
// through this row: a build that cannot leave its title screen has no reachable
// heat model, defence or run at all, and a run's functional rating is the worst
// across the domains in play.
//
// THE ROW IS POSED, NOT WALKED. `setMenuIndex` sets the highlighted row outright
// (specs/instrumentation.md), so a build whose arrow keys are broken still gets a
// fair reading of where its first row leads — those keys are `controls.menu-down`
// and `controls.menu-up`. That the confirm KEY reaches the action at all is
// `controls.confirm-key`; this item reads where the row goes.
//
// THE ACTION, NOT THE KEY. The press is made through the `confirm` action's own
// binding out of the case-fixed `BINDINGS` table, so this check names a
// destination rather than a keyboard.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `PLAY`, the first of the two `TITLE_ITEMS`. */
const PLAY_ROW = TITLE_ITEMS.indexOf("PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens mode select, and starts no game, when PLAY is confirmed", async () => {
  resetTo(h);
  h.debug.setScreen("title");
  h.debug.setMenuIndex(PLAY_ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the scenario is posed on");
  assertEqual(before.menuIndex, PLAY_ROW, "the row the scenario is posed on");

  await tapAction(h, "confirm");
  captureStill(h, "modeselect");

  const after = h.snapshot();
  assertNotEqual(
    after.screen,
    "playing",
    "PLAY starts no game of its own (specs/screens.md, `title`)",
  );
  assertEqual(
    after.screen,
    "modeselect",
    `the screen confirming row ${PLAY_ROW} of the title menu leads to`,
  );
});
