// torpedo/holds-speed-while-turning — a turn costs a torpedo none of its speed.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The flight, the Speed row:
// "`TORPEDO_SPEED` (`420`), HELD CONSTANT WHETHER OR NOT IT IS TURNING", and the
// guidance section says it again from the other side: "the torpedo turns its
// heading toward that target's current position at up to `TORPEDO_TURN` ...,
// KEEPING ITS SPEED."
//
// IT IS A DIFFERENT ITEM FROM `torpedo/speed` because a whole class of builds gets
// one and not the other: a build that steers by ADDING a lateral correction to its
// velocity rather than by rotating it flies a straight second at exactly
// `TORPEDO_SPEED` and speeds up the moment it turns. A build that rotates a unit
// heading and multiplies by the speed passes both.
//
// WHAT IS MEASURED, AND WHY BOTH. The velocity the snapshot reports on every tick
// of the turn, and the distance the torpedo actually covered between consecutive
// ticks. The first catches a build whose steering changes the velocity's
// magnitude; the second catches a build that reports a constant speed and moves by
// something else.
//
// THE TARGET IS INSIDE THE CONE AND OFF THE HEADING, at `10` degrees — a bearing
// `specs/weapons.md` makes a candidate (`TORPEDO_CONE` is `15`) and far enough off
// the heading to require a real turn. A build that never acquires it never turns,
// and the check says so rather than passing on a straight flight: whether the
// acquisition itself is right is `torpedo/cone-half-angle`'s and
// `torpedo/picks-the-nearest-in-the-cone`'s business, but a torpedo that did not
// turn cannot decide THIS item either way.
//
// THE SPAN IS FOUR FIFTHS OF A SECOND, and it is long deliberately. A build that
// gets this wrong usually gets it wrong a LITTLE per tick, so the longer the
// pursuit the further its speed has drifted by the end: over these `96` ticks the
// heading swings about `18` degrees in all — the initial `10` onto the target, and
// the rest tracking it as the well carries it in — where the first tenth of a
// second alone is worth only two. It stops `35` ticks short of the impact, which
// lands at about tick `131`, so nothing is destroyed under the reading.
//
// THE PAIR STANDS IN THE BOTTOM OF THE FIELD; the torpedo's own path never comes
// within `280` units of the star's centre, and `specs/gravity.md` never pulls a
// torpedo, so the speed this check reads is the speed the build's own steering
// left.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, TORPEDO_SPEED, TICK_DT } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { angleBetween, speedOf, wrappedDistance } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  sampleEvery,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseTorpedo, standTheShipClear } from "./scenario";

/** Where the torpedo starts, and which way it is going. */
const TORPEDO_X = 200;
const TORPEDO_Y = 640;
const HEADING = 0;

/** Where the target stands: 507 units out at 10 degrees off the heading. */
const TARGET_OFF = -10 * DEG;
const TARGET_RANGE = 507;
const TARGET_X = TORPEDO_X + Math.cos(HEADING + TARGET_OFF) * TARGET_RANGE;
const TARGET_Y = TORPEDO_Y + Math.sin(HEADING + TARGET_OFF) * TARGET_RANGE;

/** How long the turn is watched, and how often it is read: every tick. */
const WATCH_TICKS = ticksFor(0.8);
const SAMPLE_EVERY = 1;

/** What one tick of travel is worth at the specified speed, in units. */
const TICK_TRAVEL = TORPEDO_SPEED * TICK_DT;

/**
 * How far the speed may fall from `TORPEDO_SPEED` at any point of the turn, in
 * units per second.
 *
 * 3 percent, the figure the review item states — `12.6` units per second. The
 * rule is a constant, so a conforming build has no latitude on it beyond the
 * arithmetic of composing a velocity from a heading and a magnitude.
 *
 * The wrong model it is really aimed at is a build that TRADES SPEED FOR TURN —
 * the commonest way to write a guided munition, and the one `specs/weapons.md`
 * rules out in as many words by holding the speed "whether or not it is turning".
 * Such a build reads well under `420` for every tick the turn is saturated, tens
 * of units per second out. The other, a build that composes its velocity by adding
 * a steering impulse and never brings the magnitude back, drifts by a little each
 * tick rather than a lot on one, which is why the span this is read over is `96`
 * ticks rather than the dozen a single turn takes.
 */
const SPEED_TOLERANCE = 0.03 * TORPEDO_SPEED;

/** The same allowance on one tick of travel, in units. */
const TRAVEL_TOLERANCE = 0.03 * TICK_TRAVEL;

/**
 * How far the heading must have moved for the span to be a turn at all, in
 * radians.
 *
 * `5` degrees, half the bearing the target was posed at. It is a PRECONDITION and
 * not a measurement: it says the build acquired the target and started turning, so
 * that the speeds below were read through a turn rather than through a straight
 * run. How fast it turns is `torpedo/turn-rate`'s figure.
 */
const TURN_FLOOR = 5 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds a torpedo at TORPEDO_SPEED through a turn onto an off-axis target", async () => {
  startPlaying(h);
  standTheShipClear(h);
  poseRock(h, "large", TARGET_X, TARGET_Y);
  const id = poseTorpedo(h, TORPEDO_X, TORPEDO_Y, HEADING);

  const samples = await sampleEvery(h, WATCH_TICKS, SAMPLE_EVERY, (s) =>
    s.torpedoes?.find((torpedo) => torpedo.id === id),
  );
  // The torpedo holding its speed through the turn.
  captureStill(h, "turn");

  const flown = samples.filter((sample) => sample !== undefined);
  assertEqual(
    flown.length,
    samples.length,
    "the torpedo in flight for every one of the samples taken over the half " +
      "second of the turn — its target is a further third of a second's " +
      "travel on from where this span ends, and nothing else is on the field " +
      "(specs/weapons.md)",
  );

  const turned = angleBetween(flown[flown.length - 1].heading, HEADING);
  assertGreaterThan(
    turned,
    TURN_FLOOR,
    `the torpedo to have turned toward a rock posed ` +
      `${Math.abs(TARGET_OFF / DEG).toFixed(0)} degrees off its heading and ` +
      "well inside TORPEDO_CONE (15 degrees), so what follows is read through " +
      `a turn (specs/weapons.md); it turned ${(turned / DEG).toFixed(2)} degrees`,
  );

  for (const [index, sample] of flown.entries()) {
    const speed = speedOf(sample);
    assertLessThanOrEqual(
      Math.abs(speed - TORPEDO_SPEED),
      SPEED_TOLERANCE,
      `the torpedo's speed to stay TORPEDO_SPEED (${TORPEDO_SPEED}) through ` +
        `the turn, within ${SPEED_TOLERANCE.toFixed(1)} units per second — it ` +
        "is held constant whether or not the torpedo is turning " +
        `(specs/weapons.md); at tick ${index} it read ${speed.toFixed(1)}`,
    );
    if (index === 0) continue;
    const travelled = wrappedDistance(flown[index - 1], sample);
    assertLessThanOrEqual(
      Math.abs(travelled - TICK_TRAVEL),
      TRAVEL_TOLERANCE,
      `the torpedo to cover ${TICK_TRAVEL.toFixed(2)} units in each tick of ` +
        `the turn — TORPEDO_SPEED (${TORPEDO_SPEED}) held constant — within ` +
        `${TRAVEL_TOLERANCE.toFixed(2)} (specs/weapons.md); between ticks ` +
        `${index - 1} and ${index} it covered ${travelled.toFixed(2)}`,
    );
  }
});
