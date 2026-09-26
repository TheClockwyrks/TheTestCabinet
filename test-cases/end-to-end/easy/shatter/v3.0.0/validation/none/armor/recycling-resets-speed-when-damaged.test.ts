// rocks/recycling-resets-speed-when-damaged — damage does not divert the recycle
// path off its fresh drift speed.
//
// THE RULE, AND THE ONE THING THIS ITEM DECIDES. `specs/rocks.md` says both halves
// in one sentence: a recycled rock re-enters "at a fresh base drift speed drawn
// from its size's range", and, under this variant, "Its speed is reset and its
// health is not." Each half is already owned. `rocks/recycle-resets-speed` decides
// the reset itself, on a whole rock; `armor/recycling-preserves-health` decides
// that the damage survives. What neither of them takes is the recycle path with a
// DAMAGED rock on it, and that is the whole of this item: a build that branches on
// health — re-placing a chipped rock at the speed it arrived with, or at rest,
// rather than drawing it a fresh one — passes both owners and fails here alone.
//
// SO THE HEALTH IS A PRECONDITION HERE AND NOT A VERDICT. It is posed and read back
// BEFORE the fall, so a build that cannot pose a health fails
// `armor/set-rock-health-reads-back` by name rather than being misread as a
// recycling fault. Nothing is read off the health after the re-entry: that reading
// is `armor/recycling-preserves-health`'s, taken in an identical world.
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
  requireRock,
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

it("returns a chipped Large at a Large's own drift speed", async () => {
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
  // A SETUP GUARD, not the verdict: the damage the recycle path is asked to carry
  // has to be really on the rock before it falls, and a build that cannot pose one
  // is failed by `armor/set-rock-health-reads-back` under its own name.
  assertEqual(
    healthOf(
      requireRock(await h.snapshot(), id, "the chipped Large"),
      "the chipped Large",
    ),
    CHIPPED,
    "the health the rock carried into the star (specs/instrumentation.md)",
  );

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
  assertBetween(
    magnitude(velocityOf(rock)),
    ROCK_SPEED_MIN.large - WELL_SLACK,
    ROCK_SPEED_MAX.large + WELL_SLACK,
    "the base drift speed a recycled Large re-enters at, with the damage it " +
      "went in with (specs/rocks.md)",
  );
});
