// Carom — navigation/matchover-down: one ArrowDown on the match-over screen
// moves the selection down one.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction:
// on `matchover`, `p1-down` and `p2-down` move `menuIndex` down one, exactly as
// they do on the title and on the pause menu. The screen is POSED —
// `openMatchOver` sets the winner, the final score, `menuIndex` at 0 and the
// screen, which is what reaching it leaves behind — rather than played out:
// driving eleven real points to grade one arrow press would fail this point
// whenever the serve, the physics, the scoring or the win rule was broken, and
// each of those is another point's. `gameplay/match-win` is the point that does
// drive a real match to its end.
//
// `screen` is read back as well as `menuIndex`: a build that treated the arrow
// as a confirm would leave `matchover` for the title or for a fresh countdown,
// and reading both is what tells that apart from an arrow that did nothing.
//
// The two-item match-over screen carries no wrap point of its own: the title's
// two cover both ends of a wrapping menu.
//
// Nothing advances on `matchover` (specs/ui.md), so no bystander is posed away
// and no paddle is taken. The key is a real key event dispatched at the target
// the runtime listens on. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { MATCHOVER_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
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

it("moves the match-over selection from the first item to the second", async () => {
  assertEqual(MATCHOVER_ITEMS[MENU], "MENU");
  openTitle(h);
  openMatchOver(h, { winner: "left" });

  const over = h.snapshot();
  assertEqual(over.screen, "matchover");
  assertEqual(over.menuIndex, 0);

  await h.tap("ArrowDown");
  captureStill(h, "menu");

  const moved = h.snapshot();
  assertEqual(moved.screen, "matchover");
  assertEqual(moved.menuIndex, MENU);
});
