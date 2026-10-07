// rocks/health-small-1 — a Small takes one hit from the gun.
//
// `specs/rocks.md` gives a Small `ROCK_HEALTH.small` (1), so the first round is
// already the hit that takes its health to zero and destroys it. It is the floor of
// the armor table and the size the whole wave loop rests on: only destroying a
// Small takes a rock off the field, so a build that armored a Small would leave
// every wave unclearable.
//
// THE ONE DIRECTION THIS CHECKS is that a single round is enough. A build that
// gives a Small two or more hits leaves it standing here and fails; a build with
// the table right passes whatever it does with the larger sizes, which are graded
// by their own items.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  shootRock,
  startPlaying,
  type Harness,
} from "../harness";
import { CHIP_SPOT } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys a Small with a single round", async () => {
  startPlaying(h);
  const id = poseRock(h, "small", CHIP_SPOT.x, CHIP_SPOT.y);

  const round = await shootRock(h, id);
  const after = h.snapshot();
  captureStill(h, "armor");

  assertEqual(round.spent, true, "the round resolved");
  assertUndefined(
    after.rocks.find((rock) => rock.id === id),
    "the Small after one round (specs/rocks.md)",
  );
});
