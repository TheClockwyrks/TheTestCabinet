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
// than the bullet: the sweep stops on the tick the Large's health first moves, and
// the bullet roster is read there. Reading it the other way round — sweeping until
// the bullet is gone and then observing that it is gone — would assert nothing at
// all.
//
// The round is placed on the rock's doorstep by the harness, on the side facing
// away from the star so the core cannot absorb it, and the whole flight is the
// standoff, so a bullet that has left the roster on this tick left it by hitting.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertUndefined } from "../assert";
import { ROCK_HEALTH } from "../constants";
import {
  bulletById,
  captureStill,
  createHarness,
  fireAt,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { CHIP_SPOT, chippedRock, healthOf } from "./scene";

/**
 * How long the round is followed for.
 *
 * Its whole flight is the harness's standoff — under a tenth of a second at
 * `MUZZLE_SPEED` — so a second is a wide margin, and a round that has not landed by
 * then never will.
 */
const FLIGHT_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("has spent the bullet on the tick a chipping hit lands", async () => {
  await startPlaying(h);
  const id = await poseRock(h, "large", CHIP_SPOT.x, CHIP_SPOT.y);
  const rock = requireRock(await h.snapshot(), id, "the posed Large");
  const bullet = await fireAt(h, rock);

  const landed = await h.until(
    (snapshot) => {
      const struck = snapshot.rocks.find((entry) => entry.id === id);
      return (
        struck === undefined ||
        (struck.health ?? ROCK_HEALTH.large) < ROCK_HEALTH.large
      );
    },
    { maxTicks: FLIGHT_TICKS, poll: 1 },
  );
  await captureStill(h, "chip");

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
    bulletById(landed.snapshot, bullet),
    "the round spent on the chipping hit (specs/rocks.md)",
  );
});
