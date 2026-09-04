// saucer/bullet-harms-only-the-ship — a saucer's round goes straight over a rock.
//
// THE RULE. `specs/collision.md`, What each pair does: "A saucer bullet and a rock
// | Nothing. The bullet passes over the rock, which is unharmed."
// `specs/saucer.md` gives the round only one thing it can destroy — the ship — so a
// build that lets the saucer clear the field for the player is wrong in a way that
// changes how the game is played.
//
// WHAT IS READ, AND WHY FOUR THINGS. That the rock is still there carrying the
// same id and the same size, that the round is still in flight, that the score has
// not moved, and that the round really did cross the rock's circle. The size is
// what separates "unharmed" from "destroyed": a Large taken by anything leaves two
// Mediums (`specs/rocks.md`). The round's survival is the other half of "passes
// over": a build that removes the round but spares the rock has still resolved a
// pair the specification says does nothing. The score is the reading that catches
// a build which pays the player for the saucer's own shooting (`specs/scoring.md`
// pays only for what the SHIP destroys). And the crossing is what stops the point
// passing vacuously — a round that missed harms nothing either — asserted LAST on
// purpose: a build that spent the round on the rock takes one of the two off the
// field mid-pass, so the tracking stops there, and the verdict a reviewer wants to
// read then names what was destroyed rather than the tracking that could not
// follow it.
//
// THE ROUND IS PLACED ON THE ROCK'S DOORSTEP, ON THE SIDE FACING AWAY FROM THE
// STAR, and fired inward at `SAUCER_BULLET_SPEED`. `aimedRound` does the placing:
// the round is travelling away from the core for its whole flight, so it cannot be
// absorbed on the way (`specs/collision.md`) and a round that vanished would be a
// round the rock took. Driven for two-thirds of a second it covers `200` units —
// through the whole `92`-unit width of a Large and well out the other side — while
// remaining `255` units from a core it touches at `33`, and `1.4` s is its life
// (`specs/saucer.md`), so it is still due to be in flight when the reading is
// taken.
//
// THE PASS IS POSED FAR FROM THE STAR, at `(300, 140)`, `405` units out, where the
// well pulls at `27` units per second squared. Over the two-thirds of a second the
// pass takes, that bends the rock's course by `6` units — a fifteenth of the `49`
// at which the two circles touch — and cannot carry it into the core, which
// recycles a rock that reaches it (`specs/rocks.md`) and would take the reading
// away.
//
// NOTHING ELSE IS ON THE FIELD. `startPlaying` leaves no other rock, no saucer and
// no round of the ship's, sets the score to zero, and shuts the ship's lethal
// contact test — so nothing but the pair under test can move the score or the
// roster.

import { afterEach, beforeEach, it } from "vitest";
import {
  ROCK_RADIUS,
  SAUCER_BULLET_R,
  SAUCER_BULLET_SPEED,
} from "../constants";
import {
  assertDefined,
  assertEqual,
  assertLength,
  assertLessThan,
} from "../assert";
import {
  aimedRound,
  captureStill,
  createHarness,
  enemyBulletById,
  poseEnemyBullet,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { wrappedDistance } from "../geometry";

/** Where the rock stands. See the header for why this far out. */
const ROCK_X = 300;
const ROCK_Y = 140;

/** How long the pass is driven for, in seconds of game time. */
const SPAN = 2 / 3;

/** The distance at which a Large rock's circle and a saucer round's touch. */
const CONTACT = ROCK_RADIUS.large + SAUCER_BULLET_R;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the rock whole, the round in flight and the score where it was", async () => {
  startPlaying(h);
  const rockId = poseRock(h, "large", ROCK_X, ROCK_Y);
  const round = aimedRound(
    { x: ROCK_X, y: ROCK_Y, vx: 0, vy: 0, radius: ROCK_RADIUS.large },
    SAUCER_BULLET_SPEED,
  );
  const roundId = poseEnemyBullet(h, round.x, round.y, round.vx, round.vy);

  let deepest = Infinity;
  for (let tick = 0; tick < ticksFor(SPAN); tick += 1) {
    await h.advance(1);
    const snapshot = h.snapshot();
    const rock = snapshot.rocks.find((entry) => entry.id === rockId);
    const flying = enemyBulletById(snapshot, roundId);
    if (rock === undefined || flying === undefined) break;
    const apart = wrappedDistance(rock, flying);
    if (apart >= deepest) continue;
    deepest = apart;
    // The enemy round passing over an untouched rock.
    captureStill(h, "overlap");
  }

  const after = h.snapshot();

  assertLength(
    after.rocks,
    1,
    "rocks on the field after a saucer round crossed one — a Large that was " +
      "destroyed would leave two Mediums (specs/rocks.md)",
  );
  assertEqual(
    requireRock(after, rockId, "the rock the saucer round crossed").size,
    "large",
    "the size of the rock after the round crossed it — the bullet passes over " +
      "the rock, which is unharmed (specs/collision.md)",
  );
  assertDefined(
    enemyBulletById(after, roundId),
    `saucer round ${roundId} still in flight after crossing the rock — it ` +
      "passes OVER the rock rather than being spent on it " +
      "(specs/collision.md)",
  );
  assertEqual(
    after.score,
    0,
    "the score after a saucer round crossed a rock — nothing was destroyed, " +
      "and the score pays for what the ship destroys (specs/scoring.md)",
  );

  assertLessThan(
    deepest,
    CONTACT,
    `the closest the round's centre came to the rock's over ${SPAN.toFixed(2)} s, ` +
      `against the ${CONTACT} units at which their circles touch ` +
      "(specs/collision.md) — a pass that never overlapped decides nothing",
  );
});
