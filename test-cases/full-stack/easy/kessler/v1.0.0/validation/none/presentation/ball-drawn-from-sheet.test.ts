// presentation/ball-drawn-from-sheet — every ball, the parked ball included,
// is painted with a bitmap rather than a shape drawn in code.
//
// specs/assets.md, on the ball sheet: "Every ball, the parked ball included,
// is drawn from the sheet", and its closing section counts "every ball frame
// on screen" among the produced sprites. What is read is whether an image
// draw's center landed on each ball's center — a parked ball on the deflector
// and a free ball out in the field — because a ball drawn as a path leaves no
// blit there. Which frame of the sheet, and how the frames advance, are the
// spin items; this one decides only that a bitmap paints the ball.
//
// The world is the two balls and the deflector they concern: a parked ball at
// the serve position, and a stationary free ball on an empty radius.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull } from "../assert";
import { PADDLE_START_ANGLE, SERVE_RADIUS } from "../constants";
import {
  captureStill,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { CLEAR_RADIUS, FREE_BALL_THETA, spriteAtPolar } from "./sprites";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints the parked ball and a free ball with image draws", async () => {
  await isolate(h);
  await h.debug.parkBall();
  await spawnBallPolar(h, CLEAR_RADIUS, FREE_BALL_THETA, 0);

  const blits = await h.frameBlits();
  await captureStill(h, "balls");

  assertNotNull(
    spriteAtPolar(h, blits, SERVE_RADIUS, PADDLE_START_ANGLE),
    "the image draw centered on the parked ball",
  );
  assertNotNull(
    spriteAtPolar(h, blits, CLEAR_RADIUS, FREE_BALL_THETA),
    "the image draw centered on the free ball",
  );
});
