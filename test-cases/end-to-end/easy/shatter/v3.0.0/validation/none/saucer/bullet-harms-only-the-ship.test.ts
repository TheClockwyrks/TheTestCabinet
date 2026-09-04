// Shatter — saucer/bullet-harms-only-the-ship: a saucer's round passes over a rock.
//
// THE RULE. `specs/collision.md` pairs "A saucer bullet and a rock" with "Nothing.
// The bullet passes over the rock, which is unharmed", and `specs/saucer.md` puts
// the same asymmetry in its own words: what harms the saucer is the ship's gun, and
// what a saucer bullet harms is the ship.
//
// THREE READINGS, ONE REQUIREMENT. The rock is still there and still the size it
// was, the round is still in flight, and the score has not moved. All three are the
// same thing — that nothing happened — and taking only one of them would let a
// build that removes the round on contact but leaves the rock whole, or one that
// scores a Large it did not destroy, pass an item whose whole content is that this
// pair resolves to nothing.
//
// THE READING IS TAKEN PAST A REAL OVERLAP. The round is flown through the rock's
// centre and the check first waits for the two circles to be well inside each other
// — a Large's `46` and the round's `3` leave `49` units of overlap — before it
// drives on to the far side and reads. A build that never got the two bodies into
// contact would pass an item about contact by never making any, which is what that
// wait is there to stop.
//
// WHERE IT IS FLOWN. The rock stands at `(320, 620)`, `412` units from the star,
// where the well pulls at about `26` units per second squared; over the half second
// the pass takes, that bends both bodies by a handful of units against `49` of
// overlap, and it bends them the same way. The round is posed rather than fired,
// because `specs/instrumentation.md` gives `addEnemyBullet` for exactly this and the
// saucer that would otherwise have to be standing here is a body the check would
// then have to explain.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertTrue } from "../assert";
import {
  ROCK_RADIUS,
  SAUCER_BULLET_R,
  SAUCER_BULLET_SPEED,
} from "../constants";
import { wrappedDistance } from "../geometry";
import {
  captureStill,
  centreOf,
  createHarness,
  enemyBulletById,
  poseEnemyBullet,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the rock stands: quiet ground, far from the star. */
const STAND = { x: 320, y: 620 };

/** How far to the left of it the round begins. */
const RUN_UP = 120;

/** The size the rock is: the largest, so the overlap is the widest. */
const ROCK_SIZE = "large" as const;

/** How long the pass is driven for: enough to carry the round right across and out. */
const PASS_TICKS = ticksFor((2 * RUN_UP) / SAUCER_BULLET_SPEED);

/** The separation at which the two circles are certainly inside each other. */
const OVERLAP = ROCK_RADIUS[ROCK_SIZE] + SAUCER_BULLET_R;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the rock whole, the round in flight and the score where it was", async () => {
  await startPlaying(h);
  const rockId = await poseRock(h, ROCK_SIZE, STAND.x, STAND.y);
  const round = await poseEnemyBullet(
    h,
    STAND.x - RUN_UP,
    STAND.y,
    SAUCER_BULLET_SPEED,
    0,
  );

  const met = await h.until(
    (snapshot) => {
      const rock = snapshot.rocks.find((entry) => entry.id === rockId);
      const shot = enemyBulletById(snapshot, round);
      if (rock === undefined || shot === undefined) return false;
      return wrappedDistance(centreOf(rock), centreOf(shot)) < OVERLAP;
    },
    { maxTicks: PASS_TICKS },
  );
  await captureStill(h, "overlap");
  assertTrue(
    met.hit,
    "a saucer round driven at a rock reaching an overlap of the two circles",
  );

  await h.advance(PASS_TICKS);
  const after = await h.snapshot();

  assertEqual(
    requireRock(after, rockId, "bullet-harms-only-the-ship").size,
    ROCK_SIZE,
    "the rock the saucer's round passed over, whole and unsplit (specs/collision.md)",
  );
  assertDefined(
    enemyBulletById(after, round),
    "the saucer's round still in flight past the rock it crossed (specs/collision.md)",
  );
  assertEqual(
    after.score,
    0,
    "the score a saucer round crossing a rock paid (specs/collision.md)",
  );
});
