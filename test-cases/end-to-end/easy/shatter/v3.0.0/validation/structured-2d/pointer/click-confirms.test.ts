// Shatter — pointer/click-confirms: a press and release inside one entry's region
// confirms it.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A pointer is pressed and released
// inside one entry's region | The highlight becomes that entry, and that entry is
// confirmed", and "the entry every confirm acts on is the highlighted one,
// whichever input raised it, and it does what this file's table for that screen
// says it does". The title's table gives `HOW TO PLAY` one job: "Moves to `howto`".
//
// THE SECOND ENTRY, NOT THE FIRST, is clicked deliberately: the two entries lead
// to two different screens, so a build that hard-wired its click to the first
// entry lands on `playing` rather than on `howto` and the failure names the screen
// it reached.
//
// EVERY EDGE IS A REAL ONE, dispatched at the target the engine listens on as the
// `PointerEvent`-shaped events its input contract reads, each running the frame
// that delivers it. `specs/instrumentation.md` carries no operation that hovers,
// presses or confirms, so the whole path from the device to the screen it reaches
// is the build's.
//
// WHERE THE ENTRY IS DRAWN IS THE BUILD'S: the region comes from `menuItemRect`
// and the mouse is driven at its middle.
//
// WHAT THIS ITEM DOES NOT DECIDE. That a move alone highlights
// (`pointer/hover-selects`), that a press begun elsewhere confirms nothing
// (`pointer/slide-off-cancels`), or what the how-to screen shows
// (`screens/howto-shows-the-controls`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickItem,
  createHarness,
  resetTo,
  type Harness,
} from "../harness";

/** The title's entries, by index (`specs/ui.md`, `TITLE_ITEMS`). */
const PLAY = 0;
const HOW_TO_PLAY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirms the entry a press and its release both land in", async () => {
  assertEqual(
    TITLE_ITEMS[HOW_TO_PLAY],
    "HOW TO PLAY",
    "the title entry the mouse confirms",
  );

  resetTo(h);
  h.debug.setMenuIndex(PLAY);
  assertEqual(h.snapshot().screen, "title", "the screen the click was made on");

  await clickItem(h, HOW_TO_PLAY);
  captureStill(h, "confirmed");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen clicking HOW TO PLAY reached (specs/ui.md)",
  );
});
