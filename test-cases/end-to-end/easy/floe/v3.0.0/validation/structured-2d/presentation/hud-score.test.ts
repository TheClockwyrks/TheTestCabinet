// Floe — presentation/hud-score: the HUD carries the running score, inside the
// bar, and its digits follow the score.
//
// specs/ui.md gives the HUD five readouts, the first of which is the score — "the
// running score" — and requires that "each is inside the bar";
// specs/strait.md puts the bar at `y` in `[0, HUD_H]` (`[0, 80]`). So the point
// has two halves, in the one direction the item states: the score's digits are
// drawn inside the bar, and they CHANGE when the score changes.
//
// WHY BOTH HALVES ARE NEEDED. A build that draws a score readout it never updates
// has a HUD that looks right and tells a player nothing, and a build that updates
// a figure it drew over the strait has put a readout where specs/strait.md says
// play goes. Neither is caught by the other half.
//
// THE FIGURE IS READ AS A NUMBER, NOT AS A STRING. specs/ui.md leaves the HUD's
// "arrangement and styling" to the build, so `SCORE 470`, `470`, `000470` and
// `470 PTS` are all the same readout; `./hud.ts` reads every digit run the bar
// carries and this point asks whether the posed figure is among them. No label,
// no position and no order is required of the score, because the specification
// fixes none.
//
// THE TWO POSED SCORES ARE CHOSEN SO NO OTHER READOUT CAN PRODUCE THEM. With a
// fresh crossing posed at level `1`, the other four readouts carry `3` lives,
// `LEVEL 1 / 8` and a `30`-second timer (specs/progression.md), and the bay
// readout carries marks rather than digits. Neither `470` nor `286` is any of
// those, or a part of any of them, so a bar carrying `470` is a bar whose score
// readout carries it — and after the score moves to `286`, a bar still carrying
// `470` is a readout that did not follow. Both are under a thousand so that a
// build free to group its digits (`1,240`) is read the same as one that does not.
//
// A HALF-SECOND IS RUN AFTER EACH POSE. A build is free to roll its score readout
// up to a new total rather than snapping to it, which is presentation and not a
// rule; half a second is far longer than any such roll and, with
// `startCrossing`'s four gates shut and the strait empty, there is nothing on it
// that can score, so the figure read is the figure posed.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_H } from "../constants";
import { assertContains, assertDeepEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { renderFrame } from "./frame";
import { hudNumbers, hudRuns } from "./hud";

/** The score posed first, and the one it is moved to. */
const FIRST_SCORE = 470;
const SECOND_SCORE = 286;

/** How long a build's own roll of the readout is given to settle, in seconds. */
const SETTLE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The numbers the HUD bar's readouts carry, after `score` has been posed. */
async function readHud(score: number): Promise<number[]> {
  h.debug.setScore(score);
  await h.advance(ticksFor(SETTLE));
  await renderFrame(h);
  assertGreaterThan(
    hudRuns(h).length,
    0,
    `the HUD bar to carry any readout at all at a score of ${score} ` +
      `(specs/ui.md), read as the text runs anchored in y [0, ${HUD_H}] ` +
      `(specs/strait.md)`,
  );
  return hudNumbers(h);
}

it("draws the score inside the HUD bar and changes its digits when the score changes", async () => {
  startCrossing(h);

  const first = await readHud(FIRST_SCORE);
  const second = await readHud(SECOND_SCORE);
  // Before the assertions, so a failing verdict still leaves the readout that
  // produced it.
  captureStill(h, "hud");

  assertContains(
    first,
    FIRST_SCORE,
    `the numbers the HUD bar's readouts carry with the score at ` +
      `${FIRST_SCORE} — the score is drawn inside the bar (specs/ui.md)`,
  );
  assertContains(
    second,
    SECOND_SCORE,
    `the numbers the HUD bar's readouts carry with the score at ` +
      `${SECOND_SCORE} — the digits change when the score changes ` +
      `(specs/ui.md)`,
  );
  assertDeepEqual(
    second.filter((value) => value === FIRST_SCORE),
    [],
    `the readouts still carrying ${FIRST_SCORE} once the score moved to ` +
      `${SECOND_SCORE} — a readout that kept the old figure did not follow ` +
      `the score (specs/ui.md)`,
  );
});
