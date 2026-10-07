// rocks/non-fatal-hit-does-not-split — a chipping hit leaves the rock whole.
//
// `specs/rocks.md`: "While health remains the rock is not destroyed, does not
// split, and scores nothing." Splitting is the visible half of that: a Large that
// came apart on its first hit would put two Mediums on a field that held one Large,
// and the wave the player is flying would inflate rather than fall.
//
// THE COUNT IS THE READING. The field is posed empty and holds exactly the one
// Large, so the rock roster is a bare count of what the hit did to it: `1` if the
// rock survived whole, `2` if it split, `0` if it was destroyed outright. The
// reading is taken on the tick the round resolves — the tick a split would happen
// on — and the same rock is looked for by its id, so a build that replaced the rock
// with two Mediums of its own fails even if it happened to leave one behind.
//
// The chip is confirmed first: a round that missed would leave the count at one
// too, and this check would then be asserting nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertLessThan } from "../assert";
import { ROCK_HEALTH } from "../constants";
import {
  captureStill,
  createHarness,
  poseRock,
  shootRock,
  startPlaying,
  type Harness,
} from "../harness";
import { CHIP_SPOT, chippedRock, healthOf } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the rock count unchanged when a hit only chips the rock", async () => {
  await startPlaying(h);
  const id = await poseRock(h, "large", CHIP_SPOT.x, CHIP_SPOT.y);

  const round = await shootRock(h, id);
  await captureStill(h, "chip");
  assertEqual(round.hit, true, "the round resolved");

  // The scenario: the hit landed and left health behind.
  const chipped = chippedRock(round.snapshot, id, "the chipping round");
  assertLessThan(
    healthOf(chipped, "the chipped Large"),
    ROCK_HEALTH.large,
    "the health the hit took off (specs/rocks.md)",
  );

  // And nothing came apart: the one Large posed is still the whole roster.
  assertEqual(
    chipped.size,
    "large",
    "the size of the rock the hit chipped (specs/rocks.md)",
  );
  assertLength(
    round.snapshot.rocks,
    1,
    "the rocks on the field after a chipping hit (specs/rocks.md)",
  );
});
