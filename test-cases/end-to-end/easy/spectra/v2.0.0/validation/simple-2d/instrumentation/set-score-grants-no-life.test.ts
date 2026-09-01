// instrumentation/set-score-grants-no-life — posing the score across the
// extra-life boundary grants no life.
//
// specs/instrumentation.md states it as a property of the operation: "`setScore`
// grants no extra life, whatever boundary it carries the score across: the award
// belongs to the scoring path, and this is a precondition. It also leaves
// `extraLifeAwarded` exactly as it stands, so posing the score down and back up
// does not re-arm the award."
//
// IT IS A PRECONDITION, WHICH IS THE WHOLE POINT. Every operation on this surface
// is a setup verb; the outcome is what the real systems produce afterwards. A
// `setScore` that fired the award would hand a free life to every scenario that
// happens to pose a score at or above `EXTRA_LIFE_AT` (`20000`,
// specs/progression.md) — and a scenario that quietly gained a life is one whose
// contact, ready-phase and game-over readings are all off by one, under headings
// about those mechanics rather than about this operation.
//
// THE SCORE IS POSED TWICE, AND THE TWO POSES SEPARATE TWO WRONG MODELS. The first
// lands just under the boundary: a build that awards a life on any `setScore` at
// all is caught there, before the boundary has been crossed. The second carries
// the score well past it: a build that awards whenever the score is carried across
// the boundary — which is the scoring path's rule, applied in the wrong place — is
// caught there. Each reads as a different life count, so a failure names the model
// the build implemented.
//
// THE LATCH IS READ BESIDE THE LIVES, because it is the other half of the same
// sentence. A build that left the lives alone but set `extraLifeAwarded` would
// have spent the run's one extra life without paying it, and every later scenario
// that scored across the boundary would silently get nothing.
//
// AND THE FRAMES AFTER THE POSE ARE RUN. An award deferred to the next update
// would pass a check that read the snapshot with no frame between, so the field is
// driven on afterwards — an empty, quiet one, where nothing else can score and
// nothing else can cost a life.
//
// WHAT THIS DOES NOT DECIDE. The other direction: that a score carried across the
// boundary through REAL scoring does pay a life, and pays it once, are
// `progression/extra-life-awarded` and `progression/extra-life-once`.

import { afterEach, beforeEach, it } from "vitest";
import { EXTRA_LIFE_AT, START_LIVES } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The score posed first: just under the extra-life boundary.
 *
 * Fifty short of `EXTRA_LIFE_AT`, which is exactly the `SCORE_SHARD_FORM` (`50`) a
 * single kill pays, so nothing about this pose reaches the boundary.
 */
const BELOW = EXTRA_LIFE_AT - 50;

/** And the score posed next: well past it, so the crossing is unmistakable. */
const ABOVE = EXTRA_LIFE_AT + 25000;

/**
 * Seconds of play run after the pose.
 *
 * A third of a second, so an award a build deferred to its next update — or to the
 * next handful of them — has fired by the time the reading is taken.
 */
const SETTLE_SECONDS = 0.3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the lives and the latch alone when a posed score crosses EXTRA_LIFE_AT", async () => {
  // An empty, quiet, live wave at START_LIVES with the latch down.
  startPosed(h);

  h.debug.setScore(BELOW);
  const under = h.snapshot();
  assertEqual(
    under.lives,
    START_LIVES,
    `the lives left after setScore(${String(BELOW)}), which is short of ` +
      `EXTRA_LIFE_AT (${String(EXTRA_LIFE_AT)}) — a build that pays a life on ` +
      "any pose is caught here, before the boundary is anywhere near",
  );
  assertEqual(
    under.extraLifeAwarded,
    false,
    "the extra-life latch after that same pose, from the false the wave was " +
      "posed with",
  );

  // The pose under test: from just under EXTRA_LIFE_AT to well past it.
  h.debug.setScore(ABOVE);

  await h.advance(ticksFor(SETTLE_SECONDS));
  // Before the assertions, so a failing pose still leaves the picture of the posed
  // score and the lives beside it.
  captureStill(h, "posed");

  const after = h.snapshot();
  assertEqual(
    after.score,
    ABOVE,
    `the score snapshot() reports after setScore(${String(ABOVE)}) — without ` +
      "the pose landing, an unchanged life count says nothing",
  );
  assertEqual(
    after.lives,
    START_LIVES,
    `the lives left ${String(SETTLE_SECONDS)} s after setScore carried the ` +
      `score from ${String(BELOW)} to ${String(ABOVE)}, across EXTRA_LIFE_AT ` +
      `(${String(EXTRA_LIFE_AT)}) — a pose is a precondition, and the award ` +
      "belongs to the scoring path (specs/instrumentation.md)",
  );
  assertEqual(
    after.extraLifeAwarded,
    false,
    'the extra-life latch after that same crossing — setScore "leaves ' +
      'extraLifeAwarded exactly as it stands", and it stood at false ' +
      "(specs/instrumentation.md)",
  );
});
