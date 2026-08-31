// instrumentation/saucer-travel-gate — `setSaucerTravel(false)` really does hold the
// saucer where it stands, and its gun runs on from there.
//
// WHAT THE FACULTY COVERS. `specs/instrumentation.md` scopes it to "the saucer's
// locomotion alone: its centre holds where it stands. Its mind and its gun run on,
// so a held saucer still rerolls its weave and still fires." Both halves are
// graded here, because the second is what makes the faculty a GATE rather than a
// removal: a build that answered `setSaucerTravel(false)` by taking the craft off
// the field, or by shutting it down entirely, holds its centre perfectly and is
// wrong.
//
// SO THE GUN IS THE HALF THAT PROVES IT IS STILL THERE. `specs/saucer.md` puts a
// shot every `SAUCER_FIRE_INTERVAL` (1.6 seconds), aimed at the ship, and the ship
// is where `startPlaying` left it — so a held saucer that is still running has put
// a round on the enemy-bullet roster inside two intervals, from a centre that has
// not moved.
//
// THE MIND IS SHUT, so the only faculty besides the gun is the one under test:
// nothing the craft decides can move a centre that the gate is supposed to be
// holding, and a build whose weave writes a velocity the travel gate then ignores
// is graded on the centre it kept rather than on the number it stored.
//
// AND THE CENTRE IS READ TWICE. Once a second in, which is the reading the review
// item names, and again after the shot, so a build that holds the craft still until
// something else happens is caught by the later of the two.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThanOrEqual, assertTrue } from "../assert";
import { SAUCER_FIRE_INTERVAL } from "../constants";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the saucer is held: near the top of the field, well clear of the star. */
const PLACE = { x: 300, y: 130 } as const;

/** The game time the held centre is first read after, in seconds. */
const FIRST_READ = 1;

/**
 * The game time a held saucer is given to take a shot, in seconds.
 *
 * Two fire intervals from the pose. `specs/saucer.md` fixes the interval but not
 * the phase within it, and `addSaucer` starts the fire clock at one full interval,
 * so two covers a build that counts the clock down and one that counts it up.
 */
const SHOT_DEADLINE = 2 * SAUCER_FIRE_INTERVAL;

/**
 * The decimal places a held centre is read back to.
 *
 * Four. `specs/instrumentation.md` says the centre "holds where it stands", so a
 * conforming build reports the number it was posed at and nothing but floating-point
 * rounding sits between the two readings. A single tick of the cruise
 * `specs/saucer.md` fixes would move it by more than a unit, which is ten thousand
 * times this bound.
 */
const HELD_DIGITS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the saucer's centre while its gun runs on and fires", async () => {
  await startPlaying(h);
  await poseSaucer(h, PLACE.x, PLACE.y, {
    mind: false,
    gun: true,
    travel: false,
  });

  await h.advance(ticksFor(FIRST_READ));
  const held = requireSaucer(
    await h.snapshot(),
    `the saucer ${FIRST_READ}s on`,
  );
  assertCloseTo(held.x, PLACE.x, HELD_DIGITS, "the held centre x");
  assertCloseTo(held.y, PLACE.y, HELD_DIGITS, "and its y");

  // And it is held rather than shut down: the gun runs on from where it stands.
  const fired = await h.until((s) => s.enemyBullets.length > 0, {
    maxTicks: ticksFor(SHOT_DEADLINE - FIRST_READ),
    poll: 4,
  });
  await captureStill(h, "held");
  assertTrue(
    fired.hit,
    `the held saucer fired within ${SHOT_DEADLINE}s with setSaucerTravel(false)`,
  );
  assertGreaterThanOrEqual(
    fired.snapshot.enemyBullets.length,
    1,
    "the rounds the held saucer put up",
  );

  const still = requireSaucer(fired.snapshot, "the saucer at the shot");
  assertCloseTo(still.x, PLACE.x, HELD_DIGITS, "the centre it fired from, x");
  assertCloseTo(still.y, PLACE.y, HELD_DIGITS, "and its y");
});
