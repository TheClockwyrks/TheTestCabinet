// visibility/parked-ball-drawn — the parked ball is on screen at the serve
// point.
//
// WHAT THE SPECIFICATION FIXES. `specs/deflector-and-ball.md`: "A parked ball
// sits at radius `194` at the deflector's center angle and follows the
// deflector as it moves. ... A parked ball is live: it counts toward the ball
// cap and is drawn like any other ball." What is read here is that it SHOWS at
// the serve point — a parked ball drawn as nothing is not drawn like any other
// ball. How it looks beside a free ball is the reviewer's.
//
// THE WORLD THIS POSES. An isolated `playing` field and one ball parked through
// the surface's `parkBall`. The deflector stands at its start angle `90`, so
// the serve point is radius 194 at angle 90. One tick renders it; `clearBalls`,
// which "removes every ball, parked included", and a second tick render the
// same place without it.
//
// WHERE IT SAMPLES. Five points inside the parked ball's 8-unit disc, all of
// them well inside the 24-pixel sprite a ball is drawn from, so a ball drawn at
// all moves them.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  DEFLECTOR_BALL_CONTACT_RADIUS,
  DEFLECTOR_START_ANGLE_DEG,
} from "../constants";
import {
  captureStill,
  isolate,
  openHarness,
  polarToXy,
  type Harness,
} from "../harness";
import { BALL_POINTS, ballGrid, movedCount, samplePoints } from "./sampling";

/** Most of the disc: a drawn ball moves all five points, a hollow one four. */
const SHOWS_MIN = BALL_POINTS.length - 2;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the parked ball at the serve point", async () => {
  isolate(h);
  h.debug.parkBall();
  await h.tick(1);
  captureStill(h, "scene");

  const disc = ballGrid(
    polarToXy(DEFLECTOR_BALL_CONTACT_RADIUS, DEFLECTOR_START_ANGLE_DEG),
  );
  const parked = samplePoints(h, disc);

  h.debug.clearBalls();
  await h.tick(1);
  const bare = samplePoints(h, disc);

  assertGreaterThanOrEqual(
    movedCount(parked, bare),
    SHOWS_MIN,
    "the points of the parked ball's disc at the serve point the ball was " +
      "drawn on",
  );
});
