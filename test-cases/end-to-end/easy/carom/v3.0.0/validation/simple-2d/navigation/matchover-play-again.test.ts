// Carom — navigation/matchover-play-again: confirming PLAY AGAIN starts a new
// match in the same mode.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction.
// "Starting a match" is what PLAY AGAIN must run, and the clause says the mode
// comes from the CURRENT mode rather than from the title — so the match-over
// screen is posed over a Versus mode, and what is read afterwards is `countdown`
// in `versus`, both scores `0`, and `winner` null.
//
// The screen is POSED, not won. `openTitle` is `reset`, `setMode` names the mode
// to be carried over, and `openMatchOver` is `setScore`, `setWinner`,
// `setMenuIndex(0)` and `setScreen("matchover")` — four atomic poses that are
// exactly the precondition this point names, with `menuIndex` already on
// `PLAY AGAIN`. Winning a match for real is `ui/state-matchover`'s point, and a
// build whose win rule never fires must fail that point rather than this one.
//
// The field is left exactly as the title state holds it. Nothing advances on
// `matchover` (specs/ui.md), the one frame the confirm costs cannot serve a ball
// out of the countdown it lands on, and the reading is of neither a ball nor an
// obstacle — so there is no bystander to remove, and a screen emptied of the
// furniture it draws behind itself is a screen the specification never describes.
// No paddle is taken: a menu is not driven through one.
//
// The key is a real key event dispatched at the target the runtime listens on,
// so the action is raised by the binding the case declares. The still is the
// frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { MATCHOVER_ITEMS, WIN_SCORE } from "../constants";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
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

it("starts a new match from the first match-over item", async () => {
  assertEqual(MATCHOVER_ITEMS[0], "PLAY AGAIN");
  openTitle(h);
  h.debug.setMode("versus");
  openMatchOver(h, { winner: "left" });

  const over = h.snapshot();
  assertEqual(over.screen, "matchover");
  assertEqual(over.mode, "versus");
  assertEqual(over.menuIndex, 0);
  assertNotNull(over.winner);
  assertDeepEqual(over.score, { p1: WIN_SCORE, p2: 0 });

  await h.tap("Enter");
  captureStill(h, "restarted");

  const again = h.snapshot();
  assertEqual(again.screen, "countdown");
  assertEqual(again.mode, "versus");
  assertDeepEqual(again.score, { p1: 0, p2: 0 });
  assertNull(again.winner);
});
