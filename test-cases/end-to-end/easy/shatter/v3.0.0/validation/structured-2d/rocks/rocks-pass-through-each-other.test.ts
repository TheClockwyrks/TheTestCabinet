// rocks/rocks-pass-through-each-other — rocks do not collide with one another.
//
// `specs/collision.md` pairs a rock with a rock and resolves it as "Nothing. They
// pass through each other, both keeping their velocities." It is one of the rules a
// build is most likely to get wrong by getting something else right: a collision
// pass written as a loop over every pair on the field bounces rocks off each other
// for free, and a field of drifting rocks then clumps and scatters in a way the
// specification never asked for.
//
// TWO ROCKS ARE POSED HEAD ON AND THE FIELD HOLDS NOTHING ELSE. `startPlaying`
// clears every rock, round and saucer and shuts the wave loop and the saucer's
// arrival off, so the only two bodies that can act on each other are the two this
// check put there — and the ship, whose lethal contact is off and which stands 300
// units away at the safe point.
//
// THE CROSSING IS ASSERTED, NOT ASSUMED. The two rocks are driven for a stretch that
// carries them through one another, and the closest their centres came is read off
// every tick of it: unless that closest approach is INSIDE the sum of their radii,
// the pair never overlapped and the check would be passing on a scenario that never
// posed the question. `specs/collision.md` makes collision swept, so a build that
// collides rocks resolves it on the tick their paths cross whatever the stride.
//
// THE TOLERANCE IS THE WELL AND NOTHING ELSE. `specs/gravity.md` pulls every rock
// every tick, so "velocities unchanged" cannot mean unchanged to the last decimal:
// over the 0.3 seconds of the crossing the well at this placement — about 26 units
// per second squared, 412 units out — adds some 8 units per second to each rock,
// and the bound below is that with half again for the path curving inward. The
// wrong model it is set against reverses a 210-unit-per-second rock, a change of
// 420, so nothing rests on where between the two the line falls.
//
// SMALLS AT THEIR TOP DRIFT SPEED, closing at 420 units per second, are what keep
// that window short: the pair goes from clear, through each other, to clear again
// inside a third of a second, so the well has the least possible time to act.
//
// WHAT THIS DOES NOT DECIDE. That a rock and the ship DO collide, which is
// `lives/rock-costs-a-life`'s; that a saucer passes through a rock, which is
// `saucer/passes-through-rocks`'s; and that a saucer bullet does, which is
// `saucer/bullet-harms-only-the-ship`'s.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, ROCK_SPEED_MAX } from "../../src/constants";
import {
  assertEqual,
  assertLength,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import { QUIET_CORNER, QUIET_PULL } from "../fixtures";
import { STAR, bearing, wrappedDistance } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  sampleEvery,
  seconds,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { lengthOf } from "./scenario";

/** How long the pair is driven: from clear, through each other, to clear again. */
const CROSSING_TICKS = ticksFor(0.3);

/** The speed each rock is given: a Small's fastest legal drift (specs/rocks.md). */
const CLOSING_SPEED = ROCK_SPEED_MAX.small;

/** How far either side of the meeting point each rock starts, in units. */
const STANDOFF = 30;

/** The separation at which two Smalls touch: the sum of their radii. */
const CONTACT = 2 * ROCK_RADIUS.small;

/**
 * How much either rock's velocity may change over the crossing, in units per
 * second.
 *
 * The well's own work and nothing else: `QUIET_PULL` (about 26 units per second
 * squared at the meeting point, from `specs/gravity.md`'s law) over the 0.3 seconds
 * the pair is driven, with half again for the rocks falling a little closer to the
 * star as they go. A build that bounced them apart reads twice `CLOSING_SPEED`, 420.
 */
const WELL_BUDGET = 1.5 * QUIET_PULL * seconds(CROSSING_TICKS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lets two rocks on a collision course cross, both intact and still on course", async () => {
  startPlaying(h);

  // The pair meets at the quiet ground, on the line ACROSS the direction of the
  // star, so both rocks are the same distance out and the well acts on the two of
  // them as nearly alike as the field allows.
  const along = bearing(QUIET_CORNER, STAR) + Math.PI / 2;
  const step = { x: Math.cos(along), y: Math.sin(along) };

  const firstId = poseRock(
    h,
    "small",
    QUIET_CORNER.x - step.x * STANDOFF,
    QUIET_CORNER.y - step.y * STANDOFF,
    step.x * CLOSING_SPEED,
    step.y * CLOSING_SPEED,
  );
  const secondId = poseRock(
    h,
    "small",
    QUIET_CORNER.x + step.x * STANDOFF,
    QUIET_CORNER.y + step.y * STANDOFF,
    -step.x * CLOSING_SPEED,
    -step.y * CLOSING_SPEED,
  );

  const posed = h.snapshot();
  const before = [
    requireRock(posed, firstId, "the first rock, as it was posed"),
    requireRock(posed, secondId, "the second rock, as it was posed"),
  ];

  // Every tick of the crossing, so the closest approach is read off the whole of
  // it rather than off whichever tick a stride happened to land on.
  const path = await sampleEvery(h, CROSSING_TICKS, 1, (snapshot) => snapshot);
  const closest = path.reduce((least, snapshot) => {
    const one = snapshot.rocks.find((rock) => rock.id === firstId);
    const other = snapshot.rocks.find((rock) => rock.id === secondId);
    if (one === undefined || other === undefined) return least;
    return Math.min(least, wrappedDistance(one, other));
  }, Infinity);

  captureStill(h, "crossing");

  const after = path[path.length - 1];
  assertLength(
    after.rocks,
    2,
    "rocks on the field after the crossing: the two posed, neither destroyed " +
      "by the other (specs/collision.md)",
  );
  assertLessThan(
    closest,
    CONTACT,
    "the closest the two centres came, in units, against the " +
      `${CONTACT} at which two Smalls touch — the crossing this item is about ` +
      "happened only if they overlapped (specs/collision.md)",
  );

  for (const [index, was] of before.entries()) {
    const now = requireRock(
      after,
      was.id,
      `rock ${index + 1} still on the field after passing through the other`,
    );
    assertEqual(
      now.size,
      was.size,
      `rock ${index + 1}: its size after the crossing — a rock meeting a rock ` +
        "resolves as nothing at all (specs/collision.md)",
    );
    assertLessThanOrEqual(
      lengthOf({ x: now.vx - was.vx, y: now.vy - was.vy }),
      WELL_BUDGET,
      `rock ${index + 1}: units per second its velocity changed over the ` +
        "crossing, against what the well alone can account for — two rocks " +
        "pass through each other, both keeping their velocities " +
        "(specs/collision.md)",
    );
  }
});
