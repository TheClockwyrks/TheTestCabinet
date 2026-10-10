// pointer/matchover-click-confirms — a click confirms an item on the match-over
// screen.
//
// specs/ui.md, "Pointer and touch": a pointer pressed and released inside one
// item's region confirms that item, and the effect is the one the keyboard table
// gives `confirm` on that screen. On `matchover` the second item is `MENU`,
// whose confirm returns to the title, so the screen the click leaves is the
// whole reading.
//
// WHAT THIS GRADES THAT THE TITLE POINTS CANNOT. The pointer handling is one
// piece of code, and `click-confirms` reads it once on the title. What is per
// screen is whether a screen is WIRED to it at all.
//
// The screen is posed with `openMatchOver`, which sets the winner, the final
// score and `menuIndex = 0`, rather than played out: driving eleven real points
// to grade one click would fail this point whenever the scoring or the win rule
// was broken, and those are the gameplay checks' business. `MENU`'s region is
// read back through `menuItemRect`, and the press and the release land in the
// middle of it — where the build put the item is the build's own and is never
// guessed.
//
// The click selects as well as confirms (specs/ui.md), so `menuIndex` is left at
// 0 and never walked to 1 with an arrow: that arrow is
// `navigation/matchover-down`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MATCHOVER_ITEMS } from "../constants";
import {
  captureStill,
  clickItem,
  createHarness,
  openMatchOver,
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

it("returns to the title when a click confirms MENU", async () => {
  assertEqual(MATCHOVER_ITEMS[MENU], "MENU");
  await openMatchOver(h, { winner: "left", mode: "versus" });
  const over = await h.snapshot();
  assertEqual(over.screen, "matchover");
  assertEqual(over.menuIndex, 0);

  await clickItem(h, MENU);
  await captureStill(h, "title");

  assertEqual((await h.snapshot()).screen, "title");
});
