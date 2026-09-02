// lives/extra-ship-at-10000 — crossing ten thousand points earns a ship.
//
// THE RULE. `specs/scoring.md`: "One extra ship is granted each time the score
// crosses a multiple of `EXTRA_LIFE_STEP` (`10 000`) THROUGH PLAY, so at
// `10 000`, at `20 000`, and on each multiple after that." This item reads the
// first of those multiples; `extra-ship-at-20000` reads that the award repeats.
//
// THE CROSSING IS A REAL KILL, WHICH IS THE HALF THAT CANNOT BE POSED.
// `specs/instrumentation.md` states that `setScore` "grants no extra ship,
// whatever boundary it crosses", so the pose puts the run ON the doorstep of the
// multiple and a bullet the check places carries it over: one Small destroyed,
// `SCORE_SMALL` (`100`) paid by the build's own scoring path, `9900` to exactly
// `10 000`.
//
// AND EXACTLY ON THE MULTIPLE IS THE FIGURE THE SPECIFICATION NAMES. It says the
// award happens "at `10 000`", so a build that waits for the score to pass the
// multiple rather than reach it reads no award and fails — which is the rule
// rather than a boundary this check invented.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. From three ships, a correct build
// reads `4`; a build that grants nothing reads `3`; a build that grants a ship for
// every payment reads `4` here and would read `4` after any kill, which
// `scoring`'s items and this one's own precondition — the score is required to
// have landed on the multiple — separate.
//
// A SMALL IS THE TARGET BECAUSE IT LEAVES NOTHING BEHIND. `specs/rocks.md` gives a
// Small no fragments, so the kill pays once and the field is empty afterwards; a
// Large would pay `20` and leave two Mediums whose own kills would pay again.
// `startPlaying` shuts the wave loop, so the emptied field raises no banner and
// spawns nothing.

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

/** The score posed before the kill: one Small short of the first multiple. */
const POSED_SCORE = EXTRA_LIFE_STEP - SCORE_SMALL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("grants exactly one extra ship for the kill that carries the score to 10,000", async () => {
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  const before = h.snapshot().lives;

  const target = poseRock(h, "small", KILL_SPOT.x, KILL_SPOT.y);
  const kill = await shootRock(h, target);
  const after = h.snapshot();
  captureStill(h, "award");

  assertEqual(
    kill.destroyed,
    true,
    `one round placed on a Small's doorstep destroying it, so the kill this ` +
      `item reads actually happened — a bullet and a rock removes the bullet ` +
      `and destroys the rock (specs/collision.md)`,
  );
  assertEqual(
    after.score,
    EXTRA_LIFE_STEP,
    `the score the kill left, from the ${POSED_SCORE} posed before it — ` +
      `destroying a Small pays SCORE_SMALL (${SCORE_SMALL}), which is what ` +
      `carries the run onto the multiple this item is about (specs/scoring.md)`,
  );
  assertEqual(
    after.lives,
    before + 1,
    `the ships left after a kill carried the score across ${EXTRA_LIFE_STEP}, ` +
      `from the ${before} it stood at — one extra ship is granted each time the ` +
      `score crosses a multiple of EXTRA_LIFE_STEP through play ` +
      `(specs/scoring.md)`,
  );
});
