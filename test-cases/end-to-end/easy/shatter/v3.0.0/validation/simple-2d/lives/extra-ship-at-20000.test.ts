// lives/extra-ship-at-20000 — the award repeats at the next multiple.
//
// THE RULE. `specs/scoring.md`: one extra ship "each time the score crosses a
// multiple of `EXTRA_LIFE_STEP` (`10 000`) through play, so at `10 000`, at
// `20 000`, and on each multiple after that". `extra-ship-at-10000` reads the
// first award; what this item reads is that the SECOND one happens — that the
// award is a standing rule rather than a one-off.
//
// SO THE RUN CROSSES TEN THOUSAND FOR REAL BEFORE IT CROSSES TWENTY. That is the
// whole design of this check, and the thing a simpler one gets wrong. A check that
// posed `19 900` and shot one Small would pass on a build that grants its extra
// ship exactly once, because that build's single award would never have been spent
// — it never crossed `10 000` in play. So the first crossing is driven for real,
// through the same kill `extra-ship-at-10000` grades, and only then is the score
// posed onto the doorstep of the second multiple. Posing it is safe and is what
// `setScore` is for: it grants no extra ship whatever boundary it crosses
// (`specs/instrumentation.md`), so the ship this item reads can only have come
// from the second kill.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build that awards on every
// multiple reads one more ship after the second kill than before it. A build that
// awards once ever reads the same count it had. A build that awards on every
// payment once the score is past ten thousand reads more than one.
//
// WHAT IS NOT ASSERTED HERE. The first award, which is `extra-ship-at-10000`'s
// point: the first kill is this check's PRECONDITION, and the count it is measured
// against is the one standing after it, so a build that missed the first award and
// caught the second still passes this item and fails that one.

import { afterEach, beforeEach, it } from "vitest";
import { EXTRA_LIFE_STEP, SCORE_SMALL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  shootRock,
  startPlaying,
  type Harness,
} from "../harness";
import { KILL_SPOT } from "./scene";

/** One Small short of the first multiple, which the first kill crosses for real. */
const FIRST_SCORE = EXTRA_LIFE_STEP - SCORE_SMALL;

/** One Small short of the second, posed once the first crossing has happened. */
const SECOND_SCORE = 2 * EXTRA_LIFE_STEP - SCORE_SMALL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("grants another ship for the kill that carries the score to 20,000", async () => {
  startPlaying(h);

  // The first crossing, driven for real, so a build that grants one ship EVER has
  // already spent it by the time the reading below is taken.
  h.debug.setScore(FIRST_SCORE);
  const firstTarget = poseRock(h, "small", KILL_SPOT.x, KILL_SPOT.y);
  const first = await shootRock(h, firstTarget);
  const afterFirst = h.snapshot();
  assertEqual(
    first.destroyed,
    true,
    `one round placed on a Small's doorstep destroying it, so the first ` +
      `crossing this item rests on actually happened (specs/collision.md)`,
  );
  assertEqual(
    afterFirst.score,
    EXTRA_LIFE_STEP,
    `the score the first kill left, from the ${FIRST_SCORE} posed before it ` +
      `(specs/scoring.md)`,
  );

  // And the second, from the count the first one left.
  h.debug.setScore(SECOND_SCORE);
  const before = h.snapshot().lives;
  const secondTarget = poseRock(h, "small", KILL_SPOT.x, KILL_SPOT.y);
  const second = await shootRock(h, secondTarget);
  const afterSecond = h.snapshot();
  captureStill(h, "award");

  assertEqual(
    second.destroyed,
    true,
    `one round placed on a Small's doorstep destroying it, so the second ` +
      `crossing this item reads actually happened (specs/collision.md)`,
  );
  assertEqual(
    afterSecond.score,
    2 * EXTRA_LIFE_STEP,
    `the score the second kill left, from the ${SECOND_SCORE} posed before it ` +
      `(specs/scoring.md)`,
  );
  assertEqual(
    afterSecond.lives,
    before + 1,
    `the ships left after a kill carried the score across ` +
      `${2 * EXTRA_LIFE_STEP}, from the ${before} standing after the first ` +
      `crossing — the award is granted at EACH multiple rather than once ` +
      `(specs/scoring.md)`,
  );
});
