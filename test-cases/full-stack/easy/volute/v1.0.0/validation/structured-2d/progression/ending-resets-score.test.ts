// progression/ending-resets-score — a dismissed ending restores the score.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings":
// "dismissing it returns the game to the title screen with every value of a
// fresh run restored", and `specs/state.md`: "On `title` the run's values are
// score `0`, level `1`, `CELLS` cells, level 1's full quota still to emit,
// pressure `0`, chain step `1`, no machinery, an empty channel, no
// projectiles, an aim of `270` degrees, and every timer at `0`." This point's
// value is "score `0`".
//
// ONE VALUE, ONE POINT. `progression/ending.ts` carries the ended run every
// one of these points is read off and says why each figure is moved off its
// fresh-run value first; this file reads the score and nothing else.
//
// WHY IT IS A POINT. A build that returns to the title carrying the ended
// run's score opens its next run part-way through the last one, and the number
// on the HUD is the first thing a player reads.
//
// THE TOLERANCE. None. A score is a count, and the standing tolerances make a
// count exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { ENDED_SCORE, dismissEnding } from "./ending";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the score back to 0 when an ending is dismissed", async () => {
  const dismissal = await dismissEnding(h);
  captureStill(h, "score");

  assertEqual(
    dismissal.posed.score,
    ENDED_SCORE,
    "the score the ended run carried before the press",
  );
  assertEqual(
    dismissal.title.score,
    0,
    "the score a dismissed ending restored",
  );
});
