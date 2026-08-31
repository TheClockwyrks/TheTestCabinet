// rocks/non-fatal-hit-scores-nothing — a chipping hit pays nothing.
//
// `specs/rocks.md`: "While health remains the rock is not destroyed, does not
// split, and scores nothing." `specs/scoring.md` says it from the other side: a hit
// that chips a rock's health without taking it to zero pays nothing either. So the
// score a build that pays per HIT rather than per KILL reports is three times what
// a Large is worth by the time it comes apart, and the whole ladder above it moves.
//
// THE FIELD IS POSED AT A KNOWN SCORE. `startPlaying` opens the run at zero with
// both world gates off, and the field holds nothing else that could pay: no saucer,
// no second rock, no wave arriving behind the scenario. So the score read on the
// tick the round resolves is what that round paid and nothing else.
//
// The chip is confirmed first, because a round that missed would also leave the
// score alone.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_HEALTH } from "../../src/constants";
import { assertEqual, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  shootRock,
  startPlaying,
  type Harness,
} from "../harness";
import { CHIP_SPOT, chippedRock, healthOf } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the score unchanged when a hit only chips the rock", async () => {
  startPlaying(h);
  const id = poseRock(h, "large", CHIP_SPOT.x, CHIP_SPOT.y);
  const before = h.snapshot().score;

  const round = await shootRock(h, id);
  const after = h.snapshot();
  captureStill(h, "chip");
  assertEqual(round.spent, true, "the round resolved");

  // The scenario: the hit landed and left health behind.
  const chipped = chippedRock(after, id, "the chipping round");
  assertLessThan(
    healthOf(chipped, "the chipped Large"),
    ROCK_HEALTH.large,
    "the health the hit took off (specs/rocks.md)",
  );

  // And it paid nothing.
  assertEqual(
    after.score,
    before,
    "the score after a hit that destroyed nothing (specs/scoring.md)",
  );
});
