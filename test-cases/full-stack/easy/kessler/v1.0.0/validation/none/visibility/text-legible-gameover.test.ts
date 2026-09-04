// visibility/text-legible-gameover — every run of text the gameover screen draws
// contrasts with what sits behind it.
//
// `specs/screens.md`: "Every piece of text a screen shows is legible against
// whatever sits behind it at the logical stage size of `1000 x 1000`", and the
// `gameover` screen "Shows the heading `GAME OVER`, the final score, and the
// wave the session reached." Each of the six screens is its own point. How a run
// is found and how its contrast is read is `legible.ts`.
//
// THE SCORE IS POSED TO FIVE DIGITS, so the final score the screen shows is a
// real run of text rather than a single character.

import { afterEach, beforeEach, it } from "vitest";
import { openHarness, type Harness } from "../harness";
import { assertRunsLegible, POSED_SCORE, screenRuns } from "./legible";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the gameover screen's text legibly", async () => {
  await h.reset();
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setScreen("gameover");
  await assertRunsLegible(h, "gameover", "gameover", await screenRuns(h));
});
