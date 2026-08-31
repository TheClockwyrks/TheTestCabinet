// instrumentation/saucer-travel-gate — with `setSaucerTravel(false)` the
// saucer's centre holds where it stands, while its gun runs on and fires.
//
// THE RULE. `specs/instrumentation.md`, The saucer: "`setSaucerTravel(enabled)`
// Gates the saucer's locomotion alone: its centre holds where it stands. Its
// mind and its gun run on, so a held saucer still rerolls its weave and still
// fires."
//
// BOTH HALVES ARE READ, AND THE SECOND IS WHY THE ITEM IS NOT A ONE-LINER. A
// build that implements the gate by zeroing the saucer's velocity, or by taking
// it off the field's update entirely, holds the centre perfectly and stops the
// gun with it — so "the centre is where it was" alone would pass exactly the
// wrong model. The leg therefore reads the held centre AND a round the held
// saucer fired from it.
//
// THE CENTRE IS COMPARED EXACTLY. The saucer is posed and then not moved, so a
// build honouring the gate reports the same two numbers it was handed; there is
// no integration to leave a remainder. A build that ignores the gate carries it
// `SAUCER_SPEED` (`140`) units in the second the first reading spans
// (`specs/saucer.md`), which is a hundred and forty units of daylight rather
// than a tolerance.
//
// THE MIND IS HELD. The gun is named by the item and the travel gate is its
// requirement; the weave is neither, and a steering saucer draws from the game's
// generator. Held, the crossing is about the two things the rule names.
//
// THE PLACE IS QUIET. `(400, 660)` is `384` units from `(STAR_X, STAR_Y)`, so
// nothing about the star's core can reach the held saucer, and the rounds it
// fires at the ship leave from a place clear of it.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_FIRE_INTERVAL, SAUCER_SPEED } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the saucer is held: quiet ground, well clear of the star. */
const HELD_AT = { x: 400, y: 660 };

/** How long the held centre is read after, in seconds of game time. */
const HOLD_SECONDS = 1;

/** The fraction of a fire interval run past the first shot's boundary. */
const OVERRUN = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the saucer's centre while its gun runs on and fires", async () => {
  startPlaying(h);
  poseSaucer(h, HELD_AT.x, HELD_AT.y);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerTravel(false);

  const posed = requireSaucer(h.snapshot(), "the posed saucer");
  assertEqual(posed.x, HELD_AT.x, "it is posed where the check put it: x");
  assertEqual(posed.y, HELD_AT.y, "it is posed where the check put it: y");
  assertEqual(posed.gun, true, "its gun is running");
  assertLength(h.snapshot().enemyBullets, 0, "it has fired nothing yet");

  // A second on: a build that ignores the gate has carried it SAUCER_SPEED
  // units in x by now.
  await h.advance(ticksFor(HOLD_SECONDS));
  const held = requireSaucer(h.snapshot(), "the held saucer a second on");
  assertEqual(
    held.x,
    HELD_AT.x,
    `with travel off the centre holds: a build that moved it reports ` +
      `${HELD_AT.x + SAUCER_SPEED * HOLD_SECONDS} (specs/instrumentation.md)`,
  );
  assertEqual(held.y, HELD_AT.y, "with travel off the centre holds: y");

  // And the gun runs on: a shot falls one fire interval into the visit.
  await h.advance(
    ticksFor((1 + OVERRUN) * SAUCER_FIRE_INTERVAL - HOLD_SECONDS),
  );

  // The held saucer, still firing from where it stands.
  captureStill(h, "held");

  const firing = h.snapshot();
  assertGreaterThanOrEqual(
    firing.enemyBullets.length,
    1,
    "a held saucer still fires on its own clock (specs/instrumentation.md)",
  );
  const still = requireSaucer(firing, "the held saucer after its shot");
  assertEqual(still.x, HELD_AT.x, "and it is still where it stands: x");
  assertEqual(still.y, HELD_AT.y, "and it is still where it stands: y");
});
