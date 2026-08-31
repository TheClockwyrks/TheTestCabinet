// scoring/saucer-scores-200 — a destroyed saucer pays exactly 200.
//
// `specs/scoring.md` fixes the figure: "The saucer is destroyed | `SCORE_SAUCER` |
// `200`", paid once, on the destruction itself, whatever destroyed the body.
// `specs/collision.md` pairs a bullet with the saucer — "Both are removed, and the
// saucer scores" — and this reads the score that pairing pays. It is the one
// scoring event that is not a rock, so a build that pays out of its rock code alone
// reads `0` here and passes every other figure in the group.
//
// THE SAUCER IS POSED WITH ALL THREE FACULTIES OFF. `specs/saucer.md` gives it a
// weave, a turn away from the core and an aimed gun; none of the three is part of
// what this item decides, and each would move the reading — a travelling saucer is
// no longer where the round was aimed, and a firing one puts bullets on the field
// that could reach the ship and end the run mid-scenario. What is left is a body
// standing on quiet ground and one round flown into it, which is exactly the pair
// the figure is paid for.
//
// WHAT IS READ IS THE DELTA, NOT THE SCORE, against a run posed at `POSED_SCORE`
// (`1234`): a build that ASSIGNS the figure reads `200` where a build that adds it
// reads `1434`, and one paying a rock's figure reads `1234` plus that figure.
//
// THE KILL IS CONFIRMED FIRST, because a round that missed would leave the score
// alone too, and this item should say which of the two happened. Whether a bullet
// can destroy the saucer at all is `saucer`'s item; what the destruction PAYS is
// this one.

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_SAUCER } from "../../src/constants";
import { assertEqual, assertNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  POSED_SCORE,
  QUIET_SPOT,
  poseStandingSaucer,
  saucerTarget,
  shootWatching,
} from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the score by exactly SCORE_SAUCER when the saucer is destroyed", async () => {
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  const saucer = poseStandingSaucer(h, QUIET_SPOT.x, QUIET_SPOT.y);
  const before = h.snapshot().score;

  const round = await shootWatching(h, saucerTarget(saucer));
  captureStill(h, "score");

  // The scenario: the round resolved on the saucer it was placed in front of.
  assertTrue(
    round.hit,
    "the round spent on the saucer it was fired into (specs/collision.md)",
  );
  assertNull(
    round.snapshot.saucer,
    "the saucer removed by the bullet that struck it (specs/collision.md)",
  );

  // And the figure it paid.
  assertEqual(
    round.snapshot.score - before,
    SCORE_SAUCER,
    "the figure a destroyed saucer pays (specs/scoring.md)",
  );
});
