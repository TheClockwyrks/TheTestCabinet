// rocks/recycling-resets-speed-not-health — one is reset and the other is not.
//
// `specs/rocks.md` says both halves in one sentence: a recycled rock re-enters "at
// a fresh base drift speed drawn from its size's range", and "Its speed is reset
// and its health is not." The pair is the requirement — a build that resets both
// has re-spawned the rock, and one that resets neither has merely teleported it —
// so both are read off the same re-entry, on the tick it happened.
//
// THE SPEED WINDOW IS THE SPECIFICATION'S. A Large's base drift speed range is
// `ROCK_SPEED_MIN.large` to `ROCK_SPEED_MAX.large` (60 to 110), and the rock is
// dropped into the core carrying far more than that — it arrives moving several
// hundred units per second — so a build that carried the incoming velocity across
// reads far above the window and a build that re-entered at rest reads far below
// it. Neither can be mistaken for a fresh draw.
//
// THE TOLERANCE, AND WHERE IT COMES FROM. The reading is taken on the tick the rock
// re-entered, by which time the well may already have acted on it once. A recycled
// rock stands on an edge of the field, and the nearest point of any edge to the
// star is 360 units out, where `specs/gravity.md` pulls at `MU / 360^2` = 34.7
// units per second squared — under 0.3 units of speed in a tick. One unit either
// side of the window covers that with room to spare and admits nothing a build
// could pass on by mistake.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { ROCK_SPEED_MAX, ROCK_SPEED_MIN } from "../constants";
import { magnitude } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  velocityOf,
  type Harness,
} from "../harness";
import {
  FALL_FROM,
  FALL_SPEED,
  healthOf,
  slingIntoTheStar,
  theOneRock,
} from "./scene";

/** The damage the rock carries into the star: one hit left of its three. */
const CHIPPED = 1;

/**
 * How far outside the base-speed window the reading is allowed to sit.
 *
 * One tick of the well's pull at the closest an edge comes to the star is under
 * 0.3 units per second; this is that, rounded up with room for a build that closes
 * its tick a step later.
 */
const WELL_SLACK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("re-enters at a fresh base drift speed while still carrying its damage", async () => {
  await startPlaying(h);
  const id = await poseRock(
    h,
    "large",
    FALL_FROM.x,
    FALL_FROM.y,
    0,
    FALL_SPEED,
  );
  await h.debug.setRockHealth(id, CHIPPED);

  const recycle = await slingIntoTheStar(h);
  await captureStill(h, "recycle");

  // The rock is proved to have been travelling FASTER than any base drift speed on
  // its way in, so a re-entry inside the size's range can only be a reset and not a
  // speed the scenario happened to leave it at.
  const arriving = theOneRock(
    recycle.before,
    "the Large on its way into the core",
  );
  assertGreaterThan(
    magnitude(velocityOf(arriving)),
    ROCK_SPEED_MAX.large,
    `the speed the Large carried into the star, dropped at FALL_SPEED ` +
      `(${FALL_SPEED}) and only added to by the well (specs/gravity.md) — ` +
      "so a re-entry inside the size's range can only be a reset",
  );

  const rock = theOneRock(recycle.at, "the recycled rock");
  // The speed is drawn afresh from the size's range...
  assertBetween(
    magnitude(velocityOf(rock)),
    ROCK_SPEED_MIN.large - WELL_SLACK,
    ROCK_SPEED_MAX.large + WELL_SLACK,
    "the base drift speed a recycled Large re-enters at (specs/rocks.md)",
  );
  // ...and the health is not.
  assertEqual(
    healthOf(rock, "the recycled rock"),
    CHIPPED,
    "the health a recycled rock keeps while its speed is reset (specs/rocks.md)",
  );
});
