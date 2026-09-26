// Shatter — touch/tap-confirms: a contact landing and lifting inside one entry's
// region confirms it.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A touch contact lands and lifts
// inside one entry's region | The highlight becomes that entry, and that entry is
// confirmed", with the effect this file's table gives that screen. The title's
// table gives `HOW TO PLAY` one job: "Moves to `howto`".
//
// THE SECOND ENTRY, NOT THE FIRST, is tapped deliberately: the two entries lead to
// two different screens, so a build that hard-wired its tap to the first entry
// lands on `playing` and the failure names the screen it reached.
//
// THE CONTACT REPORTS ITSELF AS A FINGER, with `pointerType: "touch"` and an id of
// its own, and both edges run the frame that delivers them.
// `specs/instrumentation.md` carries no operation that taps or confirms, so the
// whole path from the finger to the screen it reaches is the build's.
//
// WHAT THIS ITEM DOES NOT DECIDE. That a landing alone highlights
// (`touch/landing-selects`), that a lift elsewhere confirms nothing
// (`touch/drag-cancels`), or what the how-to screen shows
// (`screens/howto-shows-the-controls`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  tapItem,
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

it("confirms the entry a contact lands and lifts in", async () => {
  assertEqual(
    TITLE_ITEMS[HOW_TO_PLAY],
    "HOW TO PLAY",
    "the title entry the contact confirms",
  );

  resetTo(h);
  h.debug.setMenuIndex(PLAY);
  assertEqual(h.snapshot().screen, "title", "the screen the tap was made on");

  await tapItem(h, HOW_TO_PLAY);
  captureStill(h, "confirmed");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen tapping HOW TO PLAY reached (specs/ui.md)",
  );
});
