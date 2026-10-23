// Carom — navigation/matchover-menu: confirming MENU returns to the title.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction.
// "Returning to the title" is what MENU must run, so what is read is that clause:
// `screen` is `title`, `menuIndex` becomes `titleIndex` — `0` here, because the
// screen was posed over a `reset` title — and the match's own fields are back at
// their title values, which the posed 11-0 score and winner are there to prove.
//
// The screen is POSED, not won. `openMatchOver` is `setScore`, `setWinner`,
// `setMenuIndex(0)` and `setScreen("matchover")` — four atomic poses that are
// exactly the precondition this point names — and `setMenuIndex(1)` then puts the
// selection on `MENU`. Pressing down to it would fail this point for a broken
// movement edge, and winning a match for real is `ui/state-matchover`'s point.
//
// The field is left exactly as the title state holds it. Nothing advances on
// `matchover` or on `title` (specs/ui.md) and the reading is of neither a ball nor
// an obstacle, so there is no bystander to remove, and a screen emptied of the
// furniture it draws behind itself is a screen the specification never describes.
// No paddle is taken: a menu is not driven through one.
//
// The key is a real key event dispatched at the target the runtime listens on,
// so the action is raised by the binding the case declares. The still is the
// frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { MATCHOVER_ITEMS, WIN_SCORE } from "../constants";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openMatchOver,
  openTitle,
  type Harness,
} from "../harness";

const MENU = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title from the second match-over item", async () => {
  assertEqual(MATCHOVER_ITEMS[MENU], "MENU");
  openTitle(h);
  openMatchOver(h, { winner: "left" });
  h.debug.setMenuIndex(MENU);

  const over = h.snapshot();
  assertEqual(over.screen, "matchover");
  assertEqual(over.menuIndex, MENU);
  assertEqual(over.winner, "left");
  assertDeepEqual(over.score, { p1: WIN_SCORE, p2: 0 });

  await h.tap("Enter");
  captureStill(h, "title");

  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.menuIndex, 0);
  assertDeepEqual(title.score, { p1: 0, p2: 0 });
  assertNull(title.winner);
});
