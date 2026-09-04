// armor/non-fatal-hit-scores-nothing — a chipping hit is worth no points.
//
// `specs/rocks.md`, Armor: "While health remains the rock is not destroyed, does
// not split, and scores nothing", and "Only the hit that takes health to `0`
// destroys the rock, at which point it splits and scores as above". This item
// decides the SCORE half of that in one direction: the round that takes a Large
// from `3` to `2` leaves the score exactly where it stood.
//
// WHY IT MATTERS ON ITS OWN. `specs/scoring.md` pays for a rock DESTROYED, and a
// build that pays per hit turns an armored Large into three times its worth
// without breaking a single arithmetic rule anywhere else — every splitting item,
// every wave item and every other armor item would pass it.
//
// THE SCORE IS READ TWICE. Once on the tick the hit landed, and once half a second
// of game time later: a build that banks the hit and credits it on the following
// tick would slip past a reading taken only at the instant, and half a second is
// sixty ticks of the game's own `TICK_HZ` for it to show up in.
//
// THE RUN IS POSED AT ZERO AND NOTHING ELSE CAN PAY INTO IT. `startPlaying` sets
// the score to `0`, empties every roster, and shuts both world gates and the ship's
// contact test, so the only thing on the field that could score is the rock this
// round chips — and it is a Large at full `ROCK_HEALTH.large` (`3`), which the
// round leaves standing. That it survived is the PRECONDITION and is asserted as
// one; what its health then reads is `armor/health-falls-by-one`'s point, so a
// build that takes the wrong number off a hit fails there rather than here as well.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_HEALTH } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { ARMOR_GROUND, chipRock } from "./scene";

/** What `startPlaying` poses the run's score at, and what it must still read. */
const POSED_SCORE = 0;

/** The hits a Large carries, from which one round leaves it standing. */
const FULL = ROCK_HEALTH.large;

/**
 * Ticks the score is watched for after the hit: half a second of game time, room
 * for a build that credits a hit a tick or two late to show itself.
 */
const SETTLE_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the score untouched by a hit that does not destroy the rock", async () => {
  startPlaying(h);
  const rock = poseRock(h, "large", ARMOR_GROUND.x, ARMOR_GROUND.y);

  assertEqual(
    h.snapshot().score,
    POSED_SCORE,
    "the score the scenario is posed at, before any round is fired",
  );

  const chip = await chipRock(h, rock);

  requireRock(
    chip.at,
    rock,
    `the Large, one of its ROCK_HEALTH.large (${FULL}) hits spent and still ` +
      "standing on the tick the round landed, which is what makes this the " +
      "non-fatal case (specs/rocks.md)",
  );

  assertEqual(
    chip.at.score,
    POSED_SCORE,
    "the score on the tick the chipping round landed: specs/rocks.md pays " +
      "nothing for a hit that leaves the rock standing",
  );

  await h.advance(SETTLE_TICKS);
  captureStill(h, "chip");

  assertEqual(
    h.snapshot().score,
    POSED_SCORE,
    "the score half a second of game time after the chipping round landed, " +
      "so a build that credits a hit late is caught too (specs/rocks.md)",
  );
});
