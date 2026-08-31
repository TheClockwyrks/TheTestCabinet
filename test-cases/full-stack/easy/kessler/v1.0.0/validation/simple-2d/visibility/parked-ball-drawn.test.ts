// visibility/parked-ball-drawn — the parked ball is on screen at the serve
// point, and it is a ball.
//
// WHAT THE SPECIFICATION FIXES. `specs/deflector-and-ball.md`: "A parked ball
// sits at radius `194` at the deflector's center angle and follows the
// deflector as it moves. ... A parked ball is live: it counts toward the ball
// cap and is drawn like any other ball." Two readable halves, read here in
// turn: the parked ball SHOWS at the serve point, and it shows AS a ball —
// not a ghost, a dimmed marker, or nothing.
//
// THE WORLD THIS POSES. An isolated `playing` field, one ball parked through
// the surface's `parkBall`, and one ordinary ball spawned at rest over open
// field in the same posed moment — so both were spawned on the same tick and
// the six-frame spin sheet (`specs/assets.md`) shows both the same frame. The
// deflector stands at its start angle `90`, so the serve point is radius 194
// at angle 90. One tick renders both.
//
// WHERE IT SAMPLES. Five points inside each ball's 8-unit disc. Presence:
// the parked ball's disc against the open field just beyond the deflector at
// nearby angles, clearly apart (`DISTINCT_MIN`). Likeness: the parked disc
// against the free ball's disc, point for corresponding point, whose MEDIAN
// stays within that same figure — "drawn like any other ball" read with the
// same tolerance the category tells different things apart by, so an
// antialiased edge on one or two points cannot decide it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  DEFLECTOR_BALL_CONTACT_RADIUS,
  DEFLECTOR_START_ANGLE_DEG,
} from "../constants";
import {
  captureStill,
  isolate,
  openHarness,
  polarToXy,
  spawnBallPolar,
  type Harness,
} from "../harness";
import {
  ballGrid,
  DISTINCT_MIN,
  medianCorresponding,
  polarGrid,
  polarPoints,
  samplePoints,
  separation,
} from "./distinct";

/** Where the free ball rests: open field between the track and ring 1. */
const FREE_R = 240;
const FREE_THETA = 0;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the parked ball at the serve point, like any other ball", async () => {
  isolate(h);
  h.debug.parkBall();
  spawnBallPolar(h, FREE_R, FREE_THETA, 0);
  await h.tick(1);
  captureStill(h, "scene");

  const parked = samplePoints(
    h,
    ballGrid(
      polarToXy(DEFLECTOR_BALL_CONTACT_RADIUS, DEFLECTOR_START_ANGLE_DEG),
    ),
  );
  const free = samplePoints(h, ballGrid(polarToXy(FREE_R, FREE_THETA)));
  const field = samplePoints(
    h,
    polarPoints(
      polarGrid(
        [250],
        [DEFLECTOR_START_ANGLE_DEG - 15, DEFLECTOR_START_ANGLE_DEG + 15],
      ),
    ),
  );

  assertGreaterThan(
    separation(parked, field),
    DISTINCT_MIN,
    "the RGB separation of the parked ball at the serve point from the " +
      "field beyond the deflector",
  );
  assertLessThan(
    medianCorresponding(parked, free),
    DISTINCT_MIN,
    "the median RGB distance between the parked ball's disc and a " +
      "free-flying ball's, same spawn tick",
  );
});
