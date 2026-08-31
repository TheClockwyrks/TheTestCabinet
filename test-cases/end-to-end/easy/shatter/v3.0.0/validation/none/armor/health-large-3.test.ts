// rocks/health-large-3 — a Large takes three hits from the gun.
//
// `specs/rocks.md` gives a Large `ROCK_HEALTH.large` (3) and rules that a bullet
// lowers a rock's health by exactly one, that the rock is not destroyed while
// health remains, and that only the hit taking health to zero destroys it. So the
// count is three: two rounds leave it standing at health 1, and the third takes it.
//
// THE ROUNDS ARE REAL. Each one is placed on the rock's own doorstep by the
// harness, on the side facing away from the star so the core cannot absorb it, and
// carries the rock's velocity so a drifting rock is not missed; what resolves each
// hit is the build's own collision pass. Nothing here poses health: the rock enters
// at full health for its size, which is what `addRock` is specified to give it.
//
// A WRONG MODEL READS AS A DIFFERENT NUMBER. A build that destroys on every hit
// fails on the first round; one that takes two hits fails on the second; one that
// takes four or more is still standing after the third.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { ROCK_HEALTH } from "../constants";
import {
  captureStill,
  createHarness,
  poseRock,
  rockById,
  shootRock,
  startPlaying,
  type Harness,
} from "../harness";
import { CHIP_SPOT, chippedRock, healthOf } from "./scene";

/** What a Large has left after `n` rounds, while any is left: `3 - n`. */
const AFTER_TWO = ROCK_HEALTH.large - 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a Large standing at health 1 after two rounds and destroys it on the third", async () => {
  await startPlaying(h);
  const id = await poseRock(h, "large", CHIP_SPOT.x, CHIP_SPOT.y);

  const first = await shootRock(h, id);
  assertEqual(first.hit, true, "the first round resolved");
  chippedRock(first.snapshot, id, "the first round");

  const second = await shootRock(h, id);
  assertEqual(second.hit, true, "the second round resolved");
  const chipped = chippedRock(second.snapshot, id, "the second round");

  const third = await shootRock(h, id);
  assertEqual(third.hit, true, "the third round resolved");
  await captureStill(h, "armor");

  // Two rounds leave it standing, with one hit left of the three its size carries.
  assertEqual(
    healthOf(chipped, "after two rounds"),
    AFTER_TWO,
    "the health a Large has left after two rounds (specs/rocks.md)",
  );
  // And the third takes it off the field.
  assertUndefined(
    rockById(third.snapshot, id),
    "the Large after the third round (specs/rocks.md)",
  );
});
