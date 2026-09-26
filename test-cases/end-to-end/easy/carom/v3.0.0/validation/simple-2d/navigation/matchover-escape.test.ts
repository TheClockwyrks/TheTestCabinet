// Carom — navigation/matchover-escape: Escape on the match-over screen returns to
// the title.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction:
// `back` on `matchover`, which is a different edge from confirming its `MENU`
// entry and so its own point beside `navigation/matchover-menu`.
//
// The screen is POSED, not won. `openMatchOver` is `setScore`, `setWinner`,
// `setMenuIndex(0)` and `setScreen("matchover")` — four atomic poses that are
// exactly the precondition this point names. Winning a match for real is
// `ui/state-matchover`'s point, and a build whose win rule never fires must fail
// that point rather than this one.
//
// What is read is what "Returning to the title" fixes: `screen` is `title`, and
// `menuIndex` becomes `titleIndex`, which the `reset` behind the pose left at `0`.
//
// The field is left exactly as the title state holds it. Nothing advances on
// `matchover` or on `title` (specs/ui.md) and the reading is of neither a ball nor
// an obstacle, so there is no bystander to remove. No paddle is taken: a menu is
// not driven through one.
//
// `Escape` raises `back` and `pause` together on one frame, and `pause` is not
// read on `matchover` (specs/ui.md), so the build has to resolve the press as the
// `back`. The key is a real key event dispatched at the target the runtime
// listens on. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { WIN_SCORE } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openMatchOver,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title from the match-over screen on Escape", async () => {
  openTitle(h);
  openMatchOver(h, { winner: "left" });

  const over = h.snapshot();
  assertEqual(over.screen, "matchover");
  assertEqual(over.winner, "left");
  assertDeepEqual(over.score, { p1: WIN_SCORE, p2: 0 });

  await h.tap("Escape");
  captureStill(h, "title");

  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.menuIndex, 0);
});
