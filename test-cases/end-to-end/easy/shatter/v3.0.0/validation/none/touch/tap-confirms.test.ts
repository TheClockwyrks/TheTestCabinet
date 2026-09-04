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
// THE PAGE REPORTS A TOUCHSCREEN, asked for by this check alone, and the two edges
// are real ones driven through the browser at the middle of the region
// `menuItemRect` reports. `specs/instrumentation.md` carries no operation that
// taps or confirms, so the whole path from the finger to the screen it reaches is
// the build's.
//
// WHAT THIS ITEM DOES NOT DECIDE. That a landing alone highlights
// (`touch/landing-selects`), that a lift elsewhere confirms nothing
// (`touch/drag-cancels`), or what the how-to screen shows
// (`screens/howto-shows-the-controls`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, tapItem, type Harness } from "../harness";
import { SETTLE_TICKS } from "../screens/screens";

/** The title's entries, by index (`specs/ui.md`, `TITLE_ITEMS`). */
const PLAY = 0;
const HOW_TO_PLAY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("confirms the entry a contact lands and lifts in", async () => {
  assertEqual(
    TITLE_ITEMS[HOW_TO_PLAY],
    "HOW TO PLAY",
    "the title entry the contact confirms",
  );

  await h.debug.reset();
  await h.debug.setMenuIndex(PLAY);
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the tap was made on",
  );

  await tapItem(h, HOW_TO_PLAY);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "confirmed");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen tapping HOW TO PLAY reached (specs/ui.md)",
  );
});
