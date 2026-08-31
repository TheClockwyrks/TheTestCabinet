// saucer/passes-through-rocks — a rock and the saucer share the same space and
// neither is harmed.
//
// THE RULE. `specs/collision.md`, What each pair does: "The saucer and a rock |
// Nothing. They pass through each other." `specs/saucer.md` says the same from the
// saucer's side: "A rock passes through the saucer and neither is harmed."
//
// WHAT IS READ, AND WHY THREE THINGS. That the saucer is still up carrying the
// same id, that the rock is still on the field carrying the same id and the same
// size, and that the overlap HAPPENED. The size is what separates "unharmed" from
// "destroyed and replaced": a Large taken by anything leaves two Mediums
// (`specs/rocks.md`), which is a different roster carrying different ids. The
// overlap is what stops the point passing vacuously — a rock that never reached
// the craft harms nothing either — and it is asserted LAST on purpose: a build
// that destroyed one of the two takes it off the field mid-pass, so the tracking
// stops there, and the verdict a reviewer wants to read then names the destruction
// rather than the tracking that could not follow it.
//
// THE ROCK IS THE THING THAT MOVES. `setSaucerTravel(false)` holds the craft's
// centre, so the pass is one body crossing a stationary one and the overlap is
// arranged rather than hoped for; the craft's mind and gun are shut too, since
// neither has anything to do with what a rock does to it. The rock is posed at
// rest and given a course of its own with `setRockVelocity`, which is the
// specification's own way to put a rock on a course
// (`specs/instrumentation.md`).
//
// THE PASS IS POSED FAR FROM THE STAR, in the top-left of the field. At `(60, 120)`
// the well pulls the rock at `11` units per second squared (`specs/gravity.md`), so
// over the two-thirds of a second the pass takes it bends the rock's course by
// under three units — a twentieth of the `64` units at which the two circles touch
// — and the pass is the arrangement rather than something gravity did. The star is
// `500` units away throughout, so the core cannot recycle the rock mid-pass
// (`specs/rocks.md`) and take the reading away.
//
// NOTHING ELSE IS ON THE FIELD. `startPlaying` leaves no other rock and no round,
// shuts the wave loop and the game's own saucer arrival, and shuts the ship's
// lethal contact test, so the only interaction available is the one under test.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, SAUCER_R } from "../../src/constants";
import {
  assertEqual,
  assertLength,
  assertLessThan,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  poseSaucer,
  requireRock,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { wrappedDistance } from "../geometry";

/** Where the craft is held, and the lane the rock crosses it on. */
const SAUCER_X = 200;
const LANE_Y = 120;

/** Where the rock starts, and the speed it crosses at. */
const ROCK_X = 60;
const ROCK_SPEED = 200;

/** How long the pass is driven for, in seconds of game time. */
const SPAN = 1;

/** The distance at which a Large rock's circle and the saucer's touch. */
const CONTACT = ROCK_RADIUS.large + SAUCER_R;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves both the saucer and the rock exactly as they were after the rock crosses it", async () => {
  startPlaying(h);
  const saucerId = poseSaucer(h, SAUCER_X, LANE_Y);
  h.debug.setSaucerTravel(false);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(false);
  const rockId = poseRock(h, "large", ROCK_X, LANE_Y, ROCK_SPEED, 0);

  let deepest = Infinity;
  for (let tick = 0; tick < ticksFor(SPAN); tick += 1) {
    await h.advance(1);
    const snapshot = h.snapshot();
    const saucer = snapshot.saucer;
    const rock = snapshot.rocks.find((entry) => entry.id === rockId);
    if (saucer === null || rock === undefined) break;
    const apart = wrappedDistance(saucer, rock);
    if (apart >= deepest) continue;
    deepest = apart;
    // The rock passing over the saucer, both intact.
    captureStill(h, "overlap");
  }

  const after = h.snapshot();

  assertNotNull(
    after.saucer,
    "the saucer slot after a Large rock crossed the craft — a rock passes " +
      "through the saucer and neither is harmed (specs/saucer.md)",
  );
  assertEqual(
    requireSaucer(after, "the saucer after the pass").id,
    saucerId,
    "the id of the saucer left on the field after the pass — the same visit, " +
      "not a fresh arrival (specs/instrumentation.md, Identity)",
  );
  assertLength(
    after.rocks,
    1,
    "rocks on the field after the pass — a Large that was destroyed would " +
      "leave two Mediums (specs/rocks.md)",
  );
  assertEqual(
    requireRock(after, rockId, "the rock that crossed the saucer").size,
    "large",
    "the size of the rock after it crossed the saucer — nothing happens to " +
      "either of them (specs/collision.md)",
  );

  assertLessThan(
    deepest,
    CONTACT,
    `the closest the rock's centre came to the saucer's over ${SPAN} s, ` +
      `against the ${CONTACT} units at which their circles touch ` +
      "(specs/collision.md) — a pass that never overlapped decides nothing",
  );
});
