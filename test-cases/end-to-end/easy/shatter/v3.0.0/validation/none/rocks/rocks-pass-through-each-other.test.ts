// rocks/rocks-pass-through-each-other — a rock is nothing to another rock.
//
// `specs/collision.md`, What each pair does: "A rock and a rock | Nothing. They
// pass through each other, both keeping their velocities." `specs/rocks.md` says
// the same from the rocks' side: "Rocks pass through one another freely." This item
// decides that pair alone, in one direction: two rocks laid on a collision course
// cross, both survive, and neither is turned by the crossing.
//
// THE PAIR IS POSED HEAD-ON AND NOTHING ELSE IS ON THE FIELD. `startPlaying` empties
// every roster and shuts both world gates, so the only two bodies that can meet are
// the two the check placed. They are Smalls, laid on one row `80` units apart —
// three times the `28` their two radii sum to (`specs/collision.md`) — and given
// `200` units per second toward each other, a speed inside a Small's own base drift
// range (`specs/rocks.md`, `130` to `210`), so nothing about the pose is a state the
// game could not have produced itself.
//
// WHAT "UNCHANGED" CAN HONESTLY MEAN HERE, AND WHERE THE BOUND COMES FROM. A rock is
// a pulled body (`specs/gravity.md`), so its velocity is never constant and an item
// asserting stillness would fail every conforming build. What the well may do over
// the crossing is arithmetic: the pair is laid in the field's lower left, where the
// nearest either of them comes to the star is `556` units and the pull is therefore
// at most `MU / 556^2` = `14.6` units per second squared, and the crossing lasts
// four tenths of a second. Everything above that budget is the build's own doing.
// A build that resolves rock against rock reads far outside it whatever it does with
// the contact: stopping the pair dead costs `200` units per second and bouncing it
// costs `400`, against a budget under eight.
//
// AND THE CROSSING IS PROVED TO HAVE HAPPENED. A pair that never met would keep its
// velocities for a reason that has nothing to do with the rule, so the check reads
// the two rocks back the other way round: the one that started on the left ends on
// the right.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  magnitude,
  pullMagnitude,
  shortestAxis,
  starDistance,
  subtract,
} from "../geometry";
import { FIELD_W } from "../constants";
import {
  captureStill,
  createHarness,
  requireRock,
  secondsFor,
  startPlaying,
  ticksFor,
  velocityOf,
  type Harness,
} from "../harness";
import { poseRockAt } from "./scene";

/** Where the rock coming from the left starts, and where the other one starts. */
const LEFT = { x: 80, y: 640 };
const RIGHT = { x: 160, y: 640 };

/** How fast each closes on the other, in units per second: inside a Small's range. */
const CLOSING_SPEED = 200;

/**
 * How long the pair is followed, in ticks.
 *
 * At `200` units per second each they close `80` units in a fifth of a second, so
 * this carries each of them a full `80` units past the other: the crossing is over
 * and the pair is clear on the far side when the reading is taken.
 */
const CROSSING_TICKS = ticksFor(0.4);

/** The tick the two are on top of one another, where the still is taken. */
const OVERLAP_TICKS = Math.round(CROSSING_TICKS / 2);

/**
 * The nearest either rock comes to the star's centre over the crossing.
 *
 * The four endpoints of the two paths, of which `(160, 640)` is the closest at `556`
 * units. Both rocks also fall about a unit toward the star over the crossing, which
 * moves this by a hundredth of a unit per second squared and is covered by
 * {@link ARITHMETIC_SLACK}.
 */
const NEAREST_STAR = Math.min(
  starDistance(LEFT),
  starDistance(RIGHT),
  starDistance({ x: RIGHT.x, y: LEFT.y }),
  starDistance({ x: LEFT.x, y: RIGHT.y }),
);

/**
 * What the well is entitled to add to either rock's velocity over the crossing, in
 * units per second.
 *
 * `specs/gravity.md` fixes the pull as `MU / d^2` toward the star, so the most it
 * can change a velocity over `t` seconds is the pull at the closest the body comes
 * multiplied by `t`. Every unit per second beyond this is the build's own doing.
 */
const WELL_BUDGET = pullMagnitude(NEAREST_STAR) * secondsFor(CROSSING_TICKS);

/**
 * Room for a build's own arithmetic on top of that budget, in units per second.
 *
 * The well's own strengthening as the pair falls a unit closer over the crossing,
 * and the difference between one integration order and another at `120` ticks a
 * second. It is a fraction of the budget and two orders below what any resolution of
 * a rock against a rock would cost.
 */
const ARITHMETIC_SLACK = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lets two rocks on a collision course cross, both keeping their velocities", async () => {
  await startPlaying(h);
  const left = await poseRockAt(h, "small", LEFT, {
    x: CLOSING_SPEED,
    y: 0,
  });
  const right = await poseRockAt(h, "small", RIGHT, {
    x: -CLOSING_SPEED,
    y: 0,
  });
  const posed = await h.snapshot();

  await h.advance(OVERLAP_TICKS);
  await captureStill(h, "crossing");
  await h.advance(CROSSING_TICKS - OVERLAP_TICKS);
  const after = await h.snapshot();

  // Both survived the crossing...
  const wasLeft = requireRock(
    after,
    left,
    "the rock that came from the left still on the field after the crossing (specs/collision.md)",
  );
  const wasRight = requireRock(
    after,
    right,
    "the rock that came from the right still on the field after the crossing (specs/collision.md)",
  );

  // ...and they really did cross: the left-hand one is now the right-hand one.
  assertGreaterThan(
    shortestAxis(wasRight.x, wasLeft.x, FIELD_W),
    0,
    "units the rock that started on the left now stands to the right of the other (specs/collision.md)",
  );

  // ...each carrying the velocity the well alone accounts for.
  for (const [name, before, now] of [
    [
      "the rock from the left",
      requireRock(posed, left, "the posed pair"),
      wasLeft,
    ],
    [
      "the rock from the right",
      requireRock(posed, right, "the posed pair"),
      wasRight,
    ],
  ] as const) {
    assertLessThanOrEqual(
      magnitude(subtract(velocityOf(now), velocityOf(before))),
      WELL_BUDGET + ARITHMETIC_SLACK,
      `units per second the crossing changed ${name} by, over and above the well (specs/collision.md)`,
    );
  }
});
