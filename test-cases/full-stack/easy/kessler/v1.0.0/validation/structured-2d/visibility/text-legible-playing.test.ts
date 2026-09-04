// visibility/text-legible-playing — every run of text the playing screen draws
// contrasts with what sits behind it.
//
// `specs/screens.md`: "Every piece of text a screen shows is legible against
// whatever sits behind it at the logical stage size of `1000 x 1000`." Each of
// the six screens is its own point, because a build whose title reads and whose
// HUD does not must grade differently from one where none of them does. How a
// run is found and how its contrast is read is `legible.ts`.
//
// THE SCORE IS POSED TO FIVE DIGITS, so the readout `specs/screens.md` requires
// of the HUD is a real run of text rather than a single character.

import { afterEach, beforeEach, it } from "vitest";
import { isolate, openHarness, type Harness } from "../harness";
import { POSED_SCORE, assertRunsLegible, screenRuns } from "./legible";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the playing screen's HUD text legibly", async () => {
  isolate(h);
  h.debug.setScore(POSED_SCORE);
  await assertRunsLegible(h, "playing", "playing", await screenRuns(h));
});
