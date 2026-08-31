// Meltdown — screens/title-to-mode-select: PLAY opens mode select.
//
// THE RULE. `specs/screens.md`, on the `title` screen's two rows: `PLAY` leads to
// `modeselect`, and "It starts no game of its own." The row is the first of
// `TITLE_ITEMS`, and "`confirm` takes the highlighted row".
//
// WHY THIS ITEM IS CAPPED `broken` AND NAMES EVERY FUNCTIONAL DOMAIN. This is the
// first of the three doors between the title screen and a live run. A build whose
// PLAY row leads nowhere opens on its title screen and stays there, so its heat
// model, its defence, its run and its presentation are all unreachable — and since
// a run's functional rating is the worst across the domains in play, an item
// naming presentation alone would leave such a build carrying a flawless heat,
// defence and run rating.
//
// THE ROW IS POSED, NOT WALKED. `setMenuIndex` sets the highlighted row outright
// (`specs/instrumentation.md`), so a build whose arrow keys are broken still gets a
// fair reading of where its PLAY row leads — those keys are `controls.menu-down`
// and `controls.menu-up`. Row `0` is `PLAY`.
//
// HOW THIS DIFFERS FROM `controls.confirm-key`. That item reads that the `confirm`
// KEY reaches the action at all; this one reads the DESTINATION the row leads to.
// The two overlap on purpose: a build that answers no confirm key fails both, and
// one whose confirm works but whose PLAY row leads somewhere odd fails only this
// one.
//
// "RATHER THAN STARTING A GAME" IS READ IN THE SAME NUMBER. The screen is one
// value, so a build that started a run instead of opening the list reads
// `playing` here and fails, and one that jumped straight to the difficulty list
// reads `difficultyselect`. Every wrong destination is a different reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `PLAY`, the first of the two `TITLE_ITEMS`. */
const PLAY_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens mode select when PLAY is confirmed on the title screen", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setScreen("title");
  await debug.setMenuIndex(PLAY_ROW);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen the scenario is posed on");
  assertEqual(posed.menuIndex, PLAY_ROW, "the row the scenario is posed on");

  await tapAction(h, "confirm");
  await h.advance(1);
  await captureStill(h, "modeselect");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "modeselect",
    `the screen confirming ${TITLE_ITEMS[PLAY_ROW]}, row ${PLAY_ROW} of the title menu, leads to`,
  );
});
