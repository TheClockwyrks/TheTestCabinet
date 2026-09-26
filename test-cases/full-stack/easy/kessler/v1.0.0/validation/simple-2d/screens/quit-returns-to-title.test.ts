// screens/quit-returns-to-title — confirming QUIT returns to the title.
//
// specs/screens.md, on `paused`: "`confirm` on `QUIT` discards the session and
// returns to `title`." QUIT is entry `1` of the pause menu.
//
// THE HIGHLIGHT IS POSED ONTO QUIT rather than walked there with the `down` key:
// how the highlight moves is `controls/arrow-down-moves-highlight`'s own point,
// and a build whose only fault is its `down` key must fail there rather than
// here. What is pressed is `confirm`, which is the action this point is about.
// Whether the session was discarded is the states category's point; what is
// decided here is the screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS, PAUSE_ITEMS } from "../constants";
import { captureStill, openHarness, tap, type Harness } from "../harness";
import { posePaused } from "./scenes";

/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = KEYS.confirm[1];
/** Entry 1 of the pause menu: QUIT. */
const QUIT_ENTRY = PAUSE_ITEMS.indexOf("QUIT");

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirm on QUIT sets screen to title", async () => {
  const posed = posePaused(h);
  assertEqual(posed.screen, "paused", "the screen the menu is worked on");

  h.debug.setMenuIndex(QUIT_ENTRY);
  assertEqual(
    h.snapshot().menu.index,
    QUIT_ENTRY,
    "the highlighted entry, QUIT",
  );

  await tap(h, CONFIRM);
  captureStill(h, "title-after-quit");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen confirm on QUIT returned to",
  );
});
