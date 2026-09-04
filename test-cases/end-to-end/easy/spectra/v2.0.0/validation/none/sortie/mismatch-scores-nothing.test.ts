// sortie/mismatch-scores-nothing — a mismatched shot adds nothing to the score.
//
// specs/mode.md (Sortie): the wasted shot "adds nothing to the score and nothing
// to the resonance meter". specs/scoring.md agrees from the other side — it lists
// every event that pays, none of which is a shot, and closes with "Nothing else
// adds to the score. A shot that destroys no drone pays nothing."
//
// THE SCORE IS SEEDED AWAY FROM ZERO, at SEEDED_SCORE, and the check reads the
// score back against that number rather than against `0`. That is what makes a
// failure name the wrong model the build shipped: a build that pays a Shard in
// formation reads `SEEDED_SCORE + SCORE_SHARD_FORM`, one that pays a diving Shard
// reads `SEEDED_SCORE + SCORE_SHARD_DIVE`, and one that simply resets the run's
// score on a wasted shot reads `0`. Against a starting score of `0` all three of
// those wrong models are two different readings and one silent pass.
//
// The seed is far below `EXTRA_LIFE_AT` (20000, specs/progression.md), so no
// extra life is in play and nothing but this shot can touch the score.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FORM_CENTER_X } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the target Shard stands. As in `bands/mismatch-spares`. */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the 20-unit contact reach a Shard has against one of the player's
 * bullets (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF` 6), so the bullet starts well
 * clear and climbs into the drone.
 */
const SHOT_BELOW = 140;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet reaches the drone inside 16 frames and, consumed or not, is
 * 88 units past its centre by frame 30 — so the crossing has certainly happened
 * however the build resolves it.
 */
const SHOT_FRAMES = 30;

/**
 * Frames run after the shot has resolved, before the score is read.
 *
 * A tenth of a second, so a build that pays its score a frame or two after the
 * contact is caught rather than read too early. Nothing a conformant build does
 * scores over them: the field holds one inert drone and the wave's gates are shut.
 */
const SETTLE_FRAMES = 10;

/**
 * The score the run is carrying when the shot is fired.
 *
 * Any number will do; this one is not a sum of the figures in specs/scoring.md,
 * is not a multiple of any of them, and is two orders of magnitude below
 * `EXTRA_LIFE_AT` (20000) — so every wrong payment reads as its own number and
 * none of them lands back on the seed by coincidence.
 */
const SEEDED_SCORE = 1234;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("pays nothing for a shot of the band opposite the drone's", async () => {
  await startPosed(harness);
  await harness.debug.setScore(SEEDED_SCORE);
  const target = await poseDrone(harness, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
  });

  const shot = await shootDrone(harness, target, "magenta", {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await harness.advance(SETTLE_FRAMES);
  await captureStill(harness, "score");

  const after = await harness.snapshot();
  assertEqual(
    shot.hit,
    true,
    "the mismatched bullet resolving on the drone inside the frames its climb takes — a mismatched shot is consumed on contact (specs/bands.md), so the bullet leaving the roster is the evidence the shot arrived at all, and without it a build whose bullet never moves would satisfy every unchanged reading below",
  );
  assertEqual(
    after.score,
    SEEDED_SCORE,
    "the score, which a mismatched shot adds nothing to (specs/mode.md)",
  );
});
