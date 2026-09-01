// Spectra — screens/pause-menu-items: the pause menu lists its entries.
//
// THE RULE. `specs/ui.md` gives the `paused` screen one menu, `PAUSE_ITEMS`:
// `RESUME`, `RESTART`, `QUIT TO MENU`. All three are the specification's own copy,
// so all three are assertable exactly as written; where they sit, at what size and
// in what colour is the build's and nothing here reads it.
//
// THE SCREEN IS REACHED DIRECTLY. `setScreen` puts the game on `paused` over a field
// `startPosed` has emptied and quieted, so a build whose pause KEY is broken loses
// `controls/pause-escape` and `controls/pause-p` and still gets a fair reading of
// what the screen draws. The field behind it is empty because `specs/ui.md` says the
// field stays visible behind the menu, and an empty one cannot draw copy of its own
// into the reading.
//
// SUBSTRING, IGNORING CASE. How a build presents an entry is its own — a marker
// beside the words, padding around them, a longer line they sit inside — so
// requiring the exact run would fail a menu showing precisely the right words.
//
// WHAT IS NOT ASSERTED. What each entry DOES is `screens/pause-restart`'s,
// `screens/pause-quit`'s and `controls/pause-resumes`'s; which one is drawn as
// highlighted is `screens/title-menu-selection`'s question, decided on the title
// menu; that the field behind is frozen is `screens/pause-freezes`'s.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drewText,
  startPosed,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every PAUSE_ITEMS entry on the paused screen", async () => {
  startPosed(h);
  h.debug.setScreen("paused");
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the game is on the paused screen (specs/instrumentation.md)",
  );

  const calls = await drawFrame(h);
  captureStill(h, "menu");

  for (const item of PAUSE_ITEMS) {
    assertTrue(
      drewText(calls, item),
      `the paused screen drawing the PAUSE_ITEMS entry ${item} (specs/ui.md)`,
    );
  }
});
