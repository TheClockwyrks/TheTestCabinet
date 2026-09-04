// instrumentation/set-score-grants-no-life — posing the score grants no extra
// ship, whatever multiple of `EXTRA_LIFE_STEP` it carries the score across.
//
// THE RULE. `specs/instrumentation.md`, The screen and the run: "`setScore`
// grants no extra ship, whatever multiple of `EXTRA_LIFE_STEP` it carries the
// score across." The award itself belongs to the scoring path
// (`specs/scoring.md`: "One extra ship is granted each time the score crosses a
// multiple of `EXTRA_LIFE_STEP` (`10 000`) THROUGH PLAY"), and a pose is a
// precondition rather than a kill.
//
// WHY IT MATTERS BEYOND THE OPERATION. Half the scenarios in this suite that
// care about lives begin by posing a score, and every scenario in `scoring/`
// that measures an award poses one under the boundary first. A build that paid a
// ship for a posed score would hand each of those a life count nobody asked for,
// and the item that failed would be the one measuring the award rather than the
// one that broke.
//
// BOTH KINDS OF CROSSING ARE POSED, in their own legs, because they are
// different wrong models. A build that awards on any crossing fails the first;
// a build that awards per multiple crossed fails the second by two ships rather
// than one, so the failure names which it did.
//
// THE POSE IS READ BACK FIRST. Without that, a build whose `setScore` does
// nothing at all would pass this item vacuously — it grants no ship because it
// never crossed anything.
//
// A SECOND OF GAME TIME RUNS AFTER EACH POSE, because an award a build defers to
// its next update is still an award. The field is empty and quiet, so nothing
// else in that second can score or cost anything.

import { afterEach, beforeEach, it } from "vitest";
import { EXTRA_LIFE_STEP, START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** How far under the boundary the score is posed before it is carried across. */
const UNDER = EXTRA_LIFE_STEP - 50;

/** How far over it lands. */
const OVER = EXTRA_LIFE_STEP + 50;

/** A single pose across two whole multiples at once. */
const FAR_OVER = EXTRA_LIFE_STEP * 2.5;

/** How long the game is run after each pose, in seconds of game time. */
const SETTLE_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("posing across one multiple leaves the ship count exactly as it was", async () => {
  startPlaying(h);
  h.debug.setLives(START_LIVES);

  h.debug.setScore(UNDER);
  assertEqual(h.snapshot().score, UNDER, "the score under the boundary");
  await h.advance(ticksFor(SETTLE_SECONDS));
  assertEqual(
    h.snapshot().lives,
    START_LIVES,
    "no ship is granted for a score posed under the boundary",
  );

  h.debug.setScore(OVER);
  assertEqual(h.snapshot().score, OVER, "the score posed across the boundary");
  await h.advance(ticksFor(SETTLE_SECONDS));

  // The posed score with the ship count unchanged.
  captureStill(h, "posed");

  assertEqual(
    h.snapshot().lives,
    START_LIVES,
    `setScore across ${EXTRA_LIFE_STEP} grants no extra ship: the award ` +
      "belongs to the scoring path (specs/instrumentation.md)",
  );
});

it("posing across two multiples at once grants no ship either", async () => {
  startPlaying(h);
  h.debug.setLives(START_LIVES);

  h.debug.setScore(FAR_OVER);
  assertEqual(
    h.snapshot().score,
    FAR_OVER,
    "the score posed across two whole multiples",
  );
  await h.advance(ticksFor(SETTLE_SECONDS));

  assertEqual(
    h.snapshot().lives,
    START_LIVES,
    `setScore across two multiples of ${EXTRA_LIFE_STEP} grants no ship — a ` +
      `build paying per multiple crossed reports ${START_LIVES + 2}`,
  );
});
