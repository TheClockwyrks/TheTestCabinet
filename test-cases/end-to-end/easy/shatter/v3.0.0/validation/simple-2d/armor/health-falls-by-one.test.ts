// rocks/health-falls-by-one — each hit costs exactly one health.
//
// `specs/rocks.md`: "A bullet that hits a rock lowers that rock's health by exactly
// 1." That is the arithmetic under the whole armor table, and it is a different
// requirement from how much health a size carries: a build could give a Large the
// right three hits by taking its health from 3 to 0 in one step and refusing to
// destroy it until the third round, and a build could decrement correctly from a
// wrong starting figure.
//
// SO THE DELTA IS WHAT IS READ, not the absolute number. The Large's health is
// taken as the build reports it on the tick it was posed, and each round is
// required to lower it by exactly one from there. A build whose Large carries five
// hits fails `health-large-3`, which is the item that owns that figure, and passes
// here — which is what makes a failed grade name the rule that is actually broken.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. Two rounds leave `h0 - 2` on a
// correct build, `h0` on one that never decrements, `h0 - 4` on one that costs two
// a hit, and `h0 - 1` on one that only counts the first hit of a life.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lowers a Large's health by exactly one for each round that lands", async () => {
  startPlaying(h);
  const id = poseRock(h, "large", CHIP_SPOT.x, CHIP_SPOT.y);
  const posed = healthOf(
    rockById(h.snapshot(), id, "the posed Large"),
    "the posed Large",
  );

  const first = await shootRock(h, id);
  assertEqual(first.spent, true, "the first round resolved");
  const once = chippedRock(h.snapshot(), id, "the first round");

  const second = await shootRock(h, id);
  assertEqual(second.spent, true, "the second round resolved");
  const twice = chippedRock(h.snapshot(), id, "the second round");
  captureStill(h, "armor");

  assertEqual(
    healthOf(once, "after one round"),
    posed - 1,
    "the health left after one round (specs/rocks.md)",
  );
  assertEqual(
    healthOf(twice, "after two rounds"),
    posed - 2,
    "the health left after two rounds (specs/rocks.md)",
  );
});
