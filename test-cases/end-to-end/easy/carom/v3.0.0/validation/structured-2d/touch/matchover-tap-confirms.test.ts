// Carom — touch/matchover-tap-confirms: a tap confirms an item on the match-over
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
// `MENU`'s region is read back through `menuItemRect`, and the contact lands and
// lifts in the middle of it. The landing selects as well as confirming
// (specs/ui.md), so `menuIndex` is left at 0 and never walked to 1 with an
// arrow: that arrow is `navigation/matchover-down`'s point.
//
// The screen is POSED — `openMatchOver` sets the winner, the final score,
// `menuIndex` at 0 and the screen — rather than played out: driving eleven real
// points to grade one gesture would fail this point whenever the serve, the
// physics, the scoring or the win rule was broken, and each of those is another
// point's. `gameplay/match-win` is the point that does drive a real match to its
// end.
//
// Nothing advances on `matchover` (specs/ui.md), so no bystander is posed away
// and no paddle is taken. The still is the frame the gesture left.

import { afterEach, beforeEach, it } from "vitest";
import { MATCHOVER_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openMatchOver,
  touchMenuItem,
  type Harness,
} from "../harness";

/** MENU, the second match-over item (specs/ui.md, `MATCHOVER_ITEMS`). */
const MENU = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when a tap confirms MENU", async () => {
  assertEqual(MATCHOVER_ITEMS[MENU], "MENU");
  await openMatchOver(h, { winner: "left" });

  const over = h.snapshot();
  assertEqual(over.screen, "matchover");
  assertEqual(over.menuIndex, 0);

  await touchMenuItem(h, MENU);
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title");
});
