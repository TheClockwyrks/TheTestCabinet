// Floe — instrumentation/set-score-grants-no-life: posing the score carries it
// across a bonus-life boundary and grants no life.
//
// `specs/instrumentation.md` fixes the operation's scope in one sentence: "Sets
// the score. It grants no bonus life: a bonus life belongs to the scoring path,
// and a posed score is a precondition." `specs/progression.md` fixes the award
// itself, and fixes it to PLAY: "The score earns a life at every
// `BONUS_LIFE_EVERY` (`10,000`) points it crosses through play: `lives` rises by
// one for each boundary the score passes, so a single award that carries it over
// two boundaries earns two lives."
//
// WITHOUT THIS ITEM HALF THE SUITE CANNOT POSE A SCORE AT ALL. Every check that
// needs a run partway through — one that reads what a crossing pays, or what the
// victory screen reports — poses a score first, and a `setScore` that also paid
// the bonus life would silently change the lives that check was about to read.
// It is graded here so that it is known to be safe there.
//
// THE TWO POSES ARE THE TWO CASES THE PROGRESSION RULE NAMES, and they are read
// in the same direction: neither grants a life.
//
//   - ONE BOUNDARY. `9,990` to `10,010` steps across `10,000` exactly once. A
//     build that ran its scoring path from the pose reads one life more.
//   - TWO BOUNDARIES AT ONCE. `10,010` to `30,010` steps across `20,000` and
//     `30,000` together, which is the case `specs/progression.md` singles out as
//     paying twice. A build that pays per boundary reads two lives more, and a
//     build that pays per award reads one, so the failure names which wrong
//     model was implemented.
//
// THE LIVES ARE POSED AWAY FROM THE START. `START_LIVES` is `3`, so a build that
// merely reset the lives on a score change would read `3` and pass a check that
// had left them there; posed at `2`, the reading is of the lives this scenario
// put on the strait.
//
// AND THE TICKS AFTER EACH POSE ARE RUN, on an empty, quiet strait where nothing
// else can score and nothing else can cost a life, so an award deferred to the
// next update is caught rather than missed by a snapshot taken too early.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BONUS_LIFE_EVERY } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The lives the run is posed with: away from `START_LIVES`, so a reset shows. */
const POSED_LIVES = 2;

/** A score just short of the first boundary, and one just past it. */
const BELOW_ONE = BONUS_LIFE_EVERY - 10;
const ABOVE_ONE = BONUS_LIFE_EVERY + 10;

/** A score two boundaries further on, crossed in a single pose. */
const ABOVE_THREE = 3 * BONUS_LIFE_EVERY + 10;

/** Seconds of stepped game time run after each pose, so a deferred award fires. */
const SETTLE_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("grants no bonus life for a score posed across one boundary or two", async () => {
  await startCrossing(h);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setScore(BELOW_ONE);
  await h.advance(ticksFor(SETTLE_SECONDS));

  const before = await h.snapshot();
  assertEqual(
    before.score,
    BELOW_ONE,
    `the score posed just short of the first boundary, at ${BELOW_ONE}`,
  );
  assertEqual(
    before.lives,
    POSED_LIVES,
    `the lives posed under it — the reading every assertion below is against`,
  );

  await h.debug.setScore(ABOVE_ONE);
  const crossedOne = await h.snapshot();
  await h.advance(ticksFor(SETTLE_SECONDS));
  const settledOne = await h.snapshot();

  await h.debug.setScore(ABOVE_THREE);
  const crossedTwo = await h.snapshot();
  await h.advance(ticksFor(SETTLE_SECONDS));
  const settledTwo = await h.snapshot();
  // Before the assertions, so a build that paid a life still leaves the picture
  // of the HUD it paid it on.
  await captureStill(h, "after");

  assertEqual(
    crossedOne.lives,
    POSED_LIVES,
    `the lives the instant after setScore(${ABOVE_ONE}) carried the score ` +
      `across BONUS_LIFE_EVERY (${BONUS_LIFE_EVERY}) — a pose grants no bonus ` +
      `life (specs/instrumentation.md)`,
  );
  assertEqual(
    settledOne.lives,
    POSED_LIVES,
    `the lives ${SETTLE_SECONDS} s of game time after that pose, so an award ` +
      `deferred to an update is caught too`,
  );

  assertEqual(
    crossedTwo.lives,
    POSED_LIVES,
    `the lives the instant after setScore(${ABOVE_THREE}) carried the score ` +
      `across two boundaries at once, which specs/progression.md makes worth ` +
      `two lives when PLAY pays it`,
  );
  assertEqual(
    settledTwo.lives,
    POSED_LIVES,
    `the lives ${SETTLE_SECONDS} s of game time after the two-boundary pose`,
  );

  // The score really did land where it was posed, so the readings above are of a
  // score that crossed the boundaries rather than of one that never moved.
  assertEqual(
    settledTwo.score,
    ABOVE_THREE,
    `the score after setScore(${ABOVE_THREE})`,
  );
});
