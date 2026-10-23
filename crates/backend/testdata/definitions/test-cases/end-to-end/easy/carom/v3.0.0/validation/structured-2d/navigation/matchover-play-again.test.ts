// Carom — navigation/matchover-play-again: confirming PLAY AGAIN starts a new match in the same mode.
//
// One transition of the menu state machine specs/ui.md fixes. The match-over
// screen is POSED with PLAY AGAIN highlighted, which is where reaching it leaves
// the selection: `openMatchOver` sets the winner, the final score and
// `menuIndex`, which is what specs/balls.md says reaching the screen leaves
// behind. Playing a match out to reach it would put the serve, the physics, the
// scoring and the win rule between this check and the one transition it decides,
// and each of those is another point's. So the ONE press this check makes is the
// confirm.
//
// The point that DOES drive a real match to its end is `gameplay/match-win`,
// which is where a broken win rule belongs.
//
// The key is a real key event dispatched at the target the engine listens on, so
// the action is raised by the binding the case declares, and the result is read
// back off the game's own state. The still is the frame the press left.
//
// Nothing on the field is posed or removed. specs/ui.md advances nothing on the
// match-over screen, and what the new match puts on the field is the build's own
// "Starting a match" arrangement, which is the very thing this confirm is read
// for.

import { afterEach, beforeEach, it } from "vitest";
import { MATCHOVER_ITEMS, WIN_SCORE } from "../constants";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openMatchOver,
  type Harness,
} from "../harness";

/** PLAY AGAIN, the first match-over item (specs/ui.md, `MATCHOVER_ITEMS`). */
const PLAY_AGAIN = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts a new match from the first match-over item", async () => {
  assertEqual(MATCHOVER_ITEMS[PLAY_AGAIN], "PLAY AGAIN");
  await openMatchOver(h, { winner: "left" });

  const over = h.snapshot();
  assertEqual(over.screen, "matchover");
  assertEqual(over.winner, "left");
  assertEqual(over.menuIndex, PLAY_AGAIN);
  assertDeepEqual(over.score, { p1: WIN_SCORE, p2: 0 });

  await h.tap("Enter");
  captureStill(h, "restarted");

  const again = h.snapshot();
  assertEqual(again.screen, "countdown");
  assertEqual(again.mode, "versus");
  assertDeepEqual(again.score, { p1: 0, p2: 0 });
  assertNull(again.winner);
});
