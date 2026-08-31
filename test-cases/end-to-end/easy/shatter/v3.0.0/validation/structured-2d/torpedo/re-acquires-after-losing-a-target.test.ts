// torpedo/re-acquires-after-losing-a-target — the guidance runs every tick, so a
// torpedo that loses one target takes the next.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The guidance: "It RE-EVALUATES
// EVERY TICK, so it acquires, loses, and re-acquires targets over its flight",
// and, for the middle of the three: "With no candidate this tick, it flies
// straight on its current heading."
//
// WHY IT IS AN ITEM OF ITS OWN. A build that acquires once and holds the target
// for the rest of the flight passes every other guidance item in this group — the
// cone, its edge, the nearest-of-two rule and the turn rate are all decided on
// the first acquisition — and then flies at a rock that is no longer there. The
// only way to see that is to take its target away mid-flight and give it another.
//
// THREE READINGS, IN ORDER, AND ALL THREE ARE THE ONE REQUIREMENT.
//
//   1. It turns onto the first rock, which is the precondition: a torpedo that
//      never acquired anything cannot lose a target. How far and how fast it
//      turns is `torpedo/turn-rate`'s figure; all that is read here is that the
//      heading moved.
//   2. With the rock removed, the heading holds for a quarter of a second. A
//      build that keeps the last bearing it computed, or that keeps steering at a
//      target it no longer has, bends here.
//   3. A second rock is brought into the cone AS IT THEN STANDS — `10` degrees
//      off the heading the torpedo is now flying, inside `TORPEDO_CONE` (`15`) —
//      and the torpedo comes round onto it.
//
// THE SECOND ROCK IS PLACED FROM THE SNAPSHOT, not from arithmetic done before the
// flight: where the torpedo is and which way it is pointing after the first turn
// is the build's business, and a rock placed relative to a heading this check
// assumed would be inside one build's cone and outside another's. Reading the pose
// off the game is what makes the third phase the same scenario for every build.
//
// THE GROUND IS FLAT AND CLEAR. The whole flight runs along the bottom right of
// the field, no nearer the star's centre than `200` units, so the core absorbs
// nothing; `specs/gravity.md` never pulls a torpedo; each rock's own fall over the
// tenths of a second it is on the field is under a unit; and every separation
// posed is inside half the field on both axes, so the bearings `specs/field.md`
// means are the ones this check posed. `startPlaying` leaves nothing else on the
// field, so the only candidate at any moment is the one the check put there. The
// whole scenario is `62` ticks, a seventh of `TORPEDO_LIFE`.

import { afterEach, beforeEach, it } from "vitest";
import { DEG } from "../../src/constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { angleBetween, bearing } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  requireTorpedo,
  startPlaying,
  type Harness,
} from "../harness";
import { poseTorpedo, standTheShipClear } from "./scenario";

/** Where the torpedo starts, and which way it is going. */
const TORPEDO_X = 300;
const TORPEDO_Y = 660;
const HEADING = 0;

/** The first target: 14 degrees off the heading, at the edge of the cone. */
const FIRST_OFF = -14 * DEG;
const FIRST_RANGE = 400;

/** The second: 10 degrees off the heading the torpedo is left flying on. */
const SECOND_OFF = 10 * DEG;
const SECOND_RANGE = 350;

/** How long each of the three phases runs, in ticks. */
const TURN_TICKS = 12;
const STRAIGHT_TICKS = 30;
const REACQUIRE_TICKS = 20;

/**
 * How far the heading must have moved for a phase to count as a turn, in radians.
 *
 * `5` degrees — a third of the first bearing and half the second, and four times
 * the `1.33` degrees one tick of `TORPEDO_TURN` is worth. It is a PRECONDITION in
 * phase 1 and the READING in phase 3, and in neither is it a measurement of the
 * rate.
 */
const TURN_FLOOR = 5 * DEG;

/**
 * How far the heading may move over the straight phase, in radians.
 *
 * One degree. With no candidate on the field the specification has the torpedo fly
 * straight on its current heading, so a conforming build turns by exactly nothing
 * over those thirty ticks; this is room for arithmetic. A build still steering at
 * the rock it lost would swing `40` degrees in the same span.
 */
const STRAIGHT_TOLERANCE = 1 * DEG;

/**
 * How far the heading may sit from the bearing to the second rock once it has come
 * round, in radians: `3` degrees, a tick of `TORPEDO_TURN` and a little slack, the
 * same reading `torpedo/picks-the-nearest-in-the-cone` takes.
 */
const AIM_TOLERANCE = 3 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flies straight when its target is taken away and turns onto the next one", async () => {
  startPlaying(h);
  standTheShipClear(h);
  const firstId = poseRock(
    h,
    "large",
    TORPEDO_X + Math.cos(HEADING + FIRST_OFF) * FIRST_RANGE,
    TORPEDO_Y + Math.sin(HEADING + FIRST_OFF) * FIRST_RANGE,
  );
  const torpedoId = poseTorpedo(h, TORPEDO_X, TORPEDO_Y, HEADING);

  // 1. It turns onto the first rock.
  await h.advance(TURN_TICKS);
  const acquired = requireTorpedo(
    h.snapshot(),
    torpedoId,
    "the torpedo still in flight after twelve ticks of turning, well short of " +
      "its first target (specs/weapons.md)",
  );
  assertGreaterThan(
    angleBetween(acquired.heading, HEADING),
    TURN_FLOOR,
    `the torpedo to have turned toward a rock posed ` +
      `${Math.abs(FIRST_OFF / DEG).toFixed(0)} degrees off its heading and ` +
      "inside TORPEDO_CONE (15 degrees), so that there is a target for the " +
      "next phase to take away (specs/weapons.md)",
  );

  // 2. Its target is removed, and it flies straight.
  h.debug.removeRock(firstId);
  await h.advance(STRAIGHT_TICKS);
  const coasting = requireTorpedo(
    h.snapshot(),
    torpedoId,
    "the torpedo still in flight a quarter of a second after its target was " +
      "removed — an empty field holds nothing for it to hit (specs/weapons.md)",
  );
  const drifted = angleBetween(coasting.heading, acquired.heading);
  assertLessThanOrEqual(
    drifted,
    STRAIGHT_TOLERANCE,
    `the torpedo's heading held over the ${STRAIGHT_TICKS} ticks after its ` +
      "target was removed, within " +
      `${(STRAIGHT_TOLERANCE / DEG).toFixed(0)} degree — with no candidate ` +
      "this tick it flies straight on its current heading (specs/weapons.md); " +
      `it swung ${(drifted / DEG).toFixed(2)} degrees`,
  );

  // 3. A second rock is brought into the cone as it now stands.
  const aim = coasting.heading + SECOND_OFF;
  const secondId = poseRock(
    h,
    "large",
    coasting.x + Math.cos(aim) * SECOND_RANGE,
    coasting.y + Math.sin(aim) * SECOND_RANGE,
  );
  await h.advance(REACQUIRE_TICKS);
  const after = h.snapshot();
  // The torpedo turning onto its second target.
  captureStill(h, "reacquired");

  const reacquired = requireTorpedo(
    after,
    torpedoId,
    "the torpedo still in flight twenty ticks after the second rock arrived, " +
      "which stands a further two thirds of a second's travel on " +
      "(specs/weapons.md)",
  );
  const second = requireRock(after, secondId, "the second target");

  const swung = angleBetween(reacquired.heading, coasting.heading);
  assertGreaterThan(
    swung,
    TURN_FLOOR,
    "the torpedo to have turned again once a second rock entered its cone — " +
      "the guidance re-evaluates every tick, so it acquires, loses and " +
      `re-acquires over its flight (specs/weapons.md); it swung ` +
      `${(swung / DEG).toFixed(2)} degrees from the heading it was coasting on`,
  );

  const off = angleBetween(reacquired.heading, bearing(reacquired, second));
  assertLessThanOrEqual(
    off,
    AIM_TOLERANCE,
    "the torpedo's heading to be on the bearing to the second rock, within " +
      `${(AIM_TOLERANCE / DEG).toFixed(0)} degrees, ${REACQUIRE_TICKS} ticks ` +
      `after it was brought ${(SECOND_OFF / DEG).toFixed(0)} degrees off the ` +
      "heading it was coasting on (specs/weapons.md); it sat " +
      `${(off / DEG).toFixed(2)} degrees off that bearing`,
  );
});
