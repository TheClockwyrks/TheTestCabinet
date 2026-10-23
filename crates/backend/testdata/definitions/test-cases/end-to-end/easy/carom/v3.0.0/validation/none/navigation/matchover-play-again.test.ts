// navigation/matchover-play-again — confirming PLAY AGAIN on the match-over
// screen starts a new match in the same mode.
//
// specs/ui.md: on `matchover`, `confirm` on `PLAY AGAIN` starts a match in the
// current mode, which sets `screen = countdown`, both scores 0 and `winner`
// null. Reaching the screen sets `menuIndex = 0` (specs/balls.md), so the first
// entry is the one a fresh match-over screen confirms, and the confirm is a real
// `Enter`.
//
// The finished match is POSED — a winner, the final score, and `menuIndex` at 0.
// Driving eleven real points to grade one menu transition would fail this point
// whenever the scoring or the win rule was broken, and both are graded elsewhere;
// `ui/state-matchover` is the point that drives a real match to its end.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { MATCHOVER_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachMatchover } from "./screens";

/** The match-over menu's first entry (specs/ui.md, `MATCHOVER_ITEMS`). */
const PLAY_AGAIN = MATCHOVER_ITEMS.indexOf("PLAY AGAIN");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a new match in the same mode on PLAY AGAIN", async () => {
  await reachMatchover(h, "versus");
  assertEqual((await h.snapshot()).menuIndex, PLAY_AGAIN);

  await h.tap("Enter");
  await captureStill(h, "restarted");

  const restarted = await h.snapshot();
  assertEqual(restarted.screen, "countdown");
  assertEqual(restarted.mode, "versus");
  assertDeepEqual(restarted.score, { p1: 0, p2: 0 });
  assertNull(restarted.winner);
});
