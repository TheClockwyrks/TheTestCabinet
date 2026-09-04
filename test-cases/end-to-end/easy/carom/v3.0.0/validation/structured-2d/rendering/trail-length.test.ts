// Carom — rendering/trail-length: the trail behind a ball in steady flight
// reaches back about `speed * TRAIL_TIME` along its path.
//
// The trail draws the ball's path over the last TRAIL_TIME seconds
// (specs/overview.md), so behind a ball at a steady speed it is a streak of
// about `speed * TRAIL_TIME` units. What lands on the canvas is read directly:
// the field is cleared to the one ball this point is about — no obstacle is on it
// to be drawn across the lane — and that ball is flown down an empty lane near the
// bottom of the field, clear of the parked paddles, the net and the HUD. So
// everything lit in that lane behind the ball is the trail and nothing else, and
// the lit run is measured pixel by pixel against the same lane read bare before
// the flight, so a mode label or texture the build puts there is never mistaken
// for trail. How the build keeps the recent path it draws from is its own
// arrangement of the world's game state (specs/state.md), so the reading is the
// pixels alone.
//
// The bounds are the review item's: between half and one and a half times the
// length TRAIL_TIME gives it, plus up to two ball radii for however the build
// caps, glows or rounds the ends. How the trail is styled is the build's.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_R, TRAIL_TIME } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveTrail,
  trailReach,
  type Harness,
} from "../harness";

/** A steady flight near the cap, where the streak is longest. */
const SPEED = 950;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reaches back about speed * TRAIL_TIME behind the ball", async () => {
  const ball = await driveTrail(h, SPEED);
  captureStill(h, "trail");
  const expected = SPEED * TRAIL_TIME;

  const reach = trailReach(h, ball);
  assertGreaterThanOrEqual(reach, 0.5 * expected);
  assertLessThanOrEqual(reach, 1.5 * expected + 2 * BALL_R);
});
