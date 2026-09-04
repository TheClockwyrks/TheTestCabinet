// touch/matchover-tap-confirms — a tap confirms an item on the match-over
// screen.
//
// specs/ui.md: "A touch contact lands and lifts inside one item's region" makes
// `menuIndex` that item's index AND confirms it, and the effect of the confirm
// is the one the keyboard table gives `confirm` on that screen. On `matchover`
// the second item is `MENU`, whose confirm returns to the title, so the screen
// the tap leaves is the whole reading.
//
// WHAT THIS GRADES THAT THE TITLE POINTS CANNOT. The contact handling is one
// piece of code, and `tap-confirms` reads it once on the title. What is per
// screen is whether a screen takes a finger AT ALL.
//
// The screen is posed with `openMatchOver`, which sets the winner, the final
// score and `menuIndex = 0`, rather than played out: driving eleven real points
// to grade one tap would fail this point whenever the scoring or the win rule
// was broken, and those are the gameplay checks' business. `MENU`'s region is
// read back through `menuItemRect`, and the contact lands and lifts in the
// middle of it.
//
// The landing selects as well as confirming (specs/ui.md), so `menuIndex` is
// left at 0 and never walked to 1 with an arrow: that arrow is
// `navigation/matchover-down`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MATCHOVER_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openMatchOver,
  tapItem,
  type Harness,
} from "../harness";

/** MENU, the second match-over item (specs/ui.md, `MATCHOVER_ITEMS`). */
const MENU = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when a tap confirms MENU", async () => {
  assertEqual(MATCHOVER_ITEMS[MENU], "MENU");
  await openMatchOver(h, { winner: "left", mode: "versus" });
  const over = await h.snapshot();
  assertEqual(over.screen, "matchover");
  assertEqual(over.menuIndex, 0);

  await tapItem(h, MENU);
  await captureStill(h, "title");

  assertEqual((await h.snapshot()).screen, "title");
});
