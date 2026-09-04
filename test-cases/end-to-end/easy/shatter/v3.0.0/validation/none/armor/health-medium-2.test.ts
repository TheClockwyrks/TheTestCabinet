// rocks/health-medium-2 — a Medium takes two hits from the gun.
//
// `specs/rocks.md` gives a Medium `ROCK_HEALTH.medium` (2), under the same three
// rules a Large is graded by next door: a bullet costs exactly one health, health
// remaining means no destruction, and only the hit that takes health to zero
// destroys. So one round leaves it standing at health 1 and the second takes it.
//
// IT IS ITS OWN CHECK because it is its own figure. A build that gave every size
// three hits passes `health-large-3` and fails here, and a failed grade then names
// the size whose armor is wrong rather than "armor".
//
// The Medium is put on the field directly rather than split out of a Large, so
// nothing about splitting, scoring or fragment health can move this reading:
// `addRock` is specified to place a rock at full health for its size.

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

/** What a Medium has left after one round: `2 - 1`. */
const AFTER_ONE = ROCK_HEALTH.medium - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a Medium standing at health 1 after one round and destroys it on the second", async () => {
  await startPlaying(h);
  const id = await poseRock(h, "medium", CHIP_SPOT.x, CHIP_SPOT.y);

  const first = await shootRock(h, id);
  assertEqual(first.hit, true, "the first round resolved");
  const chipped = chippedRock(first.snapshot, id, "the first round");

  const second = await shootRock(h, id);
  assertEqual(second.hit, true, "the second round resolved");
  await captureStill(h, "armor");

  assertEqual(
    healthOf(chipped, "after one round"),
    AFTER_ONE,
    "the health a Medium has left after one round (specs/rocks.md)",
  );
  assertUndefined(
    rockById(second.snapshot, id),
    "the Medium after the second round (specs/rocks.md)",
  );
});
