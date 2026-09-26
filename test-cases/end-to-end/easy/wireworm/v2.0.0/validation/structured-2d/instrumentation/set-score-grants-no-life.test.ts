// Wireworm — instrumentation/set-score-grants-no-life: posing the score across a
// bonus-life boundary grants no life.
//
// specs/instrumentation.md states it as a property of the operation: "`setScore`
// grants no bonus life, whatever boundary it carries the score across: the award
// belongs to the scoring path, and this is a precondition."
//
// IT IS A PRECONDITION, WHICH IS THE WHOLE POINT. Every operation on this surface
// is a setup verb; the outcome is what the real systems produce afterwards. A
// `setScore` that fired the award would hand a free life to every scenario that
// happens to pose a score above `BONUS_LIFE_EVERY` (`12,000`, specs/scoring.md)
// — and a scenario that quietly gained a life is one whose contact, respawn and
// game-over readings are all off by one, under headings about those mechanics
// rather than about this operation.
//
// THE POSE CROSSES TWO BOUNDARIES, SO EVERY WRONG MODEL READS AS A DIFFERENT
// NUMBER. The score is put just under the first boundary and then posed past the
// second: a build that awards once per pose reports one life too many, one that
// awards once per boundary crossed reports two too many, and one that awards per
// thousand reports a dozen. Each is a distinct reading, so a failure names the
// model the build implemented.
//
// AND THE FRAMES AFTER THE POSE ARE RUN. An award deferred to the next update
// would pass a check that read the snapshot at the call, so the board is driven
// on afterwards — on an empty, quiet board, where nothing else can score and
// nothing else can cost a life.
//
// WHAT THIS DOES NOT DECIDE. The other direction: that a score carried across
// the boundary through REAL scoring does grant a life is `scoring/bonus-life`.

import { afterEach, beforeEach, it } from "vitest";
import { BONUS_LIFE_EVERY, START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The score posed first: just under the first bonus-life boundary. */
const BELOW = BONUS_LIFE_EVERY - 50;

/** And the score posed next: past the second boundary. */
const ABOVE = 2 * BONUS_LIFE_EVERY + 500;

/** The lives the scenario is posed with, so a gain of any size is visible. */
const LIVES = START_LIVES;

/** Frames run after the pose, so an award deferred to an update would fire. */
const SETTLE_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the lives alone when a posed score crosses the bonus boundary", async () => {
  startPlaying(h);
  h.debug.setLives(LIVES);
  h.debug.setScore(BELOW);

  const before = h.snapshot();
  assertEqual(
    before.lives,
    LIVES,
    `the lives the scenario was posed with, before the score was carried ` +
      `across the boundary`,
  );

  // The pose under test: from just under BONUS_LIFE_EVERY to past twice it.
  h.debug.setScore(ABOVE);

  await h.advance(SETTLE_TICKS);
  // Before the assertions, so a failing pose still leaves the picture of the
  // posed score and the lives beside it.
  captureStill(h, "posed");

  const after = h.snapshot();
  assertEqual(
    after.score,
    ABOVE,
    `the score snapshot() reports after setScore(${ABOVE}) — without the pose ` +
      `landing, an unchanged life count says nothing`,
  );
  assertEqual(
    after.lives,
    LIVES,
    `the lives left after setScore carried the score from ${BELOW} to ` +
      `${ABOVE}, across both the BONUS_LIFE_EVERY (${BONUS_LIFE_EVERY}) and ` +
      `the ${2 * BONUS_LIFE_EVERY} boundary — a pose is a precondition, and ` +
      `the award belongs to the scoring path (specs/instrumentation.md)`,
  );
});
