// rocks/non-fatal-hit-spends-the-bullet — the round that chips a rock is gone.
//
// `specs/rocks.md`: "A bullet that hits a rock lowers that rock's health by exactly
// 1, and the bullet is removed." `specs/collision.md` says the same in its pair
// table. The removal is unconditional — it is not the destruction that spends the
// round, it is the hit — so a build that only removes a bullet when the rock comes
// apart leaves a round travelling on through a chipped Large and can chip it again
// on the next tick, and again after that.
//
// THE READING IS TAKEN ON THE TICK THE HIT LANDS, found by watching the ROCK rather
// than the bullet: `chipTheRock` stops on the tick the Large's health first moves,
// and the bullet roster is read there. Reading it the other way round — sweeping
// until the bullet is gone and then observing that it is gone — would assert
// nothing at all, which is why this check does not use the harness's `shootRock`.
//
// The round is placed on the rock's doorstep, on the side facing away from the star
// so the core cannot absorb it, and the whole flight is that standoff, so a bullet
// that has left the roster on this tick left it by hitting.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_HEALTH } from "../../src/constants";
import { assertEqual, assertLessThan, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  type Harness,
} from "../harness";
import { CHIP_SPOT, chipTheRock, chippedRock, healthOf } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("has spent the bullet on the tick a chipping hit lands", async () => {
  startPlaying(h);
  const id = poseRock(h, "large", CHIP_SPOT.x, CHIP_SPOT.y);

  const landed = await chipTheRock(h, id);
  captureStill(h, "chip");

  assertEqual(landed.hit, true, "the round landed on the Large");
  // The hit chipped rather than destroyed, which is the scenario this decides in.
  const chipped = chippedRock(landed.snapshot, id, "the chipping round");
  assertLessThan(
    healthOf(chipped, "the chipped Large"),
    ROCK_HEALTH.large,
    "the health the hit took off (specs/rocks.md)",
  );
  // And the round that did it is off the bullet roster on that same tick.
  assertUndefined(
    landed.snapshot.bullets.find((bullet) => bullet.id === landed.bullet),
    "the round spent on the chipping hit (specs/rocks.md)",
  );
});
