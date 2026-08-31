// torpedo/picks-the-nearest-in-the-cone — of two candidates, the nearer is taken.
//
// `specs/weapons.md`, "The guidance": "Among the candidates the torpedo takes the
// nearest by shortest wrapped distance." Two rocks are posed inside the cone, `12`
// degrees off the heading on opposite sides and at ranges of `250` and `500`, and
// what is read is which way the torpedo turned.
//
// THE POSE IS BUILT SO EVERY WRONG MODEL READS A DIFFERENT NUMBER. Because the two
// candidates sit on OPPOSITE sides of the heading, the correct rule and each wrong
// one send the heading a different way:
//
//   - the nearest, as the rule says: the heading turns clockwise, toward `+12`;
//   - the farthest: it turns anticlockwise, toward `-12`;
//   - the first in the roster: the far rock is added FIRST, so a build that takes
//     the first candidate it finds turns anticlockwise too, and fails;
//   - the last in the roster: the near rock is added second, so this one passes —
//     which is why the ranges rather than the order are what the message names;
//   - no ranking at all, taking every candidate's average bearing: the two are
//     symmetric about the heading, so it turns barely at all and fails the
//     magnitude below.
//
// TWELVE DEGREES, NOT FOURTEEN. Both rocks are comfortably inside the `TORPEDO_CONE`
// (`15` degrees) half-angle, so this item is not deciding the cone's edge —
// `cone-half-angle` is — and a build whose cone is a degree out still has both
// candidates to choose between.
//
// THE READING IS TAKEN EARLY IN THE TURN, ten ticks in, while the demanded turn is
// still bigger than a tick's worth of it: `TORPEDO_TURN` (`160` degrees per second)
// is `1.33` degrees a tick, so ten ticks carry the heading `13` degrees at most and
// the direction is unambiguous long before either rock is reached. What is asserted
// is the SIGN and a magnitude far above the noise, not the rate — `turn-rate` is the
// item that grades how fast it comes round.
//
// SMALLS, ON THE TOP LANE, AND THAT IS FORCED BY THE FIELD BEING A TORUS. Bearings
// are taken from the shortest wrapped separation, so a body more than `360` units
// DOWN the field is nearer the other way and its bearing points backward — a "far"
// rock posed down a column would be behind the torpedo rather than a candidate it
// declined, and the item would pass on a build that takes the farthest. The shot
// runs along `x`, where the half-width is `640`, so both rocks are candidates by the
// game's own metric (see `scene.ts`). Both stay more than `340` units from the star,
// so the well moves them by a fraction of a unit over the ten ticks read and moves
// the torpedo not at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { DEG } from "../../src/constants";
import { angleBetween, degrees } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  poseTorpedo,
  startPlaying,
  torpedoById,
  type Harness,
} from "../harness";
import { HEADING_RIGHT, TOP_LANE, pointAt } from "./scene";

/** How far off the heading each rock is posed, in degrees: inside the cone, both ways. */
const OFF_AXIS_DEG = 12;

/** The near rock's range, in units. */
const NEAR_RANGE = 250;

/** The far rock's range, in units: twice as far, on the other side. */
const FAR_RANGE = 500;

/** How long the turn is read over, in ticks. */
const READ_TICKS = 10;

/**
 * The least the heading must have turned toward the near rock, in radians.
 *
 * Six degrees: half the `12` the near rock stands off the heading, and four and a
 * half times the `1.33` degrees one tick of `TORPEDO_TURN` is worth, so ten ticks of
 * a conformant turn clear it with room. A build that turned toward the FAR rock
 * reads the same magnitude with the opposite sign and fails; one that split the
 * difference reads about nothing and fails.
 */
const TURN_NEEDED = 6 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns toward the nearer of two rocks in its cone, not the one it found first", async () => {
  startPlaying(h);

  // The far rock FIRST, so roster order and range disagree.
  const farAt = pointAt(TOP_LANE, HEADING_RIGHT - OFF_AXIS_DEG * DEG, FAR_RANGE);
  poseRock(h, "small", farAt.x, farAt.y);
  const nearAt = pointAt(
    TOP_LANE,
    HEADING_RIGHT + OFF_AXIS_DEG * DEG,
    NEAR_RANGE,
  );
  poseRock(h, "small", nearAt.x, nearAt.y);

  const id = poseTorpedo(h, TOP_LANE.x, TOP_LANE.y, HEADING_RIGHT);
  await h.advance(READ_TICKS);
  const turnedTo = torpedoById(
    h.snapshot(),
    id,
    "the torpedo choosing between two rocks in its cone",
  );
  // The torpedo turning onto the nearer of two rocks.
  captureStill(h, "acquired");

  const turned = degrees(angleBetween(HEADING_RIGHT, turnedTo.heading));
  assertGreaterThanOrEqual(
    turned,
    degrees(TURN_NEEDED),
    `the degrees the torpedo turned toward the nearer rock over ${READ_TICKS} ` +
      `ticks, signed: the near rock is ${NEAR_RANGE} units off at ` +
      `+${OFF_AXIS_DEG} degrees and the far one ${FAR_RANGE} units off at ` +
      `-${OFF_AXIS_DEG}, so turning toward the far rock reads negative and ` +
      "splitting the difference reads about zero (specs/weapons.md: among the " +
      "candidates the torpedo takes the nearest by shortest wrapped distance); " +
      `it read ${turned.toFixed(2)}`,
  );
});
