// Carom — pointer/matchover-click-confirms: a click confirms an item on the
// match-over screen.
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
// `MENU`'s region is read back through `menuItemRect`, and the press and the
// release land in the middle of it. The click selects as well as confirming
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
  clickItem,
  createHarness,
  openMatchOver,
  openTitle,
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

it("returns to the title when a click confirms MENU", async () => {
  assertEqual(MATCHOVER_ITEMS[MENU], "MENU");
  openTitle(h);
  openMatchOver(h, { winner: "left" });

  const over = h.snapshot();
  assertEqual(over.screen, "matchover");
  assertEqual(over.menuIndex, 0);

  await clickItem(h, MENU);
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title");
});
