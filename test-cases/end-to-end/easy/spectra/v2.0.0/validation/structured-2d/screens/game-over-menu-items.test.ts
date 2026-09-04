// Spectra — screens/game-over-menu-items: the game-over screen lists its entries.
//
// THE RULE. `specs/ui.md` gives the `gameOver` screen one menu, `GAME_OVER_ITEMS`:
// `PLAY AGAIN`, then `MENU`. Both are the specification's own copy, so both are
// assertable exactly as written; where they sit, at what size and in what colour is
// the build's and nothing here reads it.
//
// THE SCREEN IS REACHED DIRECTLY. `setScreen` puts the game on `gameOver` without
// losing three lives to get there, so a build whose contact or life rules are broken
// loses the `progression` group's points and still gets a fair reading of what this
// screen draws. `startPosed` empties the four rosters and shuts the three world gates
// first, so nothing a wave does can draw copy of its own into the reading.
//
// SUBSTRING, IGNORING CASE. How a build presents an entry is its own — a marker beside
// the words, padding around them, a longer line they sit inside — so requiring the
// exact run would fail a screen showing precisely the right words.
//
// WHAT IS NOT ASSERTED. What `PLAY AGAIN` does is `screens/game-over-play-again`'s.
// The final score and the stage the screen also reports are drawn from the run's own
// figures, whose readouts `screens/hud-score` and `screens/hud-stage` decide; this
// point reads the two menu entries. Which entry is drawn as highlighted is
// `screens/title-menu-selection`'s question, decided on the title menu.

import { afterEach, beforeEach, it } from "vitest";
import { GAME_OVER_ITEMS } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drewText,
  startPosed,
  type Harness,
} from "../harness";
import { drawFrame } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every GAME_OVER_ITEMS entry on the game-over screen", async () => {
  startPosed(h);
  h.debug.setScreen("gameOver");
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "gameOver",
    "the game is on the game-over screen (specs/instrumentation.md)",
  );

  const calls = await drawFrame(h);
  captureStill(h, "menu");

  for (const item of GAME_OVER_ITEMS) {
    assertTrue(
      drewText(calls, item),
      `the game-over screen drawing the GAME_OVER_ITEMS entry ${item} ` +
        "(specs/ui.md)",
    );
  }
});
