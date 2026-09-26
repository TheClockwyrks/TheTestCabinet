// Carom — rendering/trail-length: a ball in steady flight leaves a trail behind
// it.
//
// The trail draws the ball's path over the last TRAIL_TIME seconds
// (specs/overview.md), so a ball at a steady speed leaves the lane behind it
// painted. What lands on the canvas is read directly: the field is cleared to the
// one ball this point is about — no obstacle is on it to be drawn across the lane
// — and that ball is flown down an empty lane near the bottom of the field, clear
// of the parked paddles, the net and the HUD. So everything lit in that lane
// behind the ball is the trail and nothing else, read pixel by pixel against the
// same lane read bare before the flight, so a mode label or texture the build
// puts there is never mistaken for trail. How the build keeps the recent path it
// draws from is its own arrangement of the world's game state (specs/state.md),
// so the reading is the pixels alone.
//
// WHAT IS READ IS PRESENCE. How long the streak looks, how it tapers, how it
// glows and what it is coloured are the build's, and the reviewer judges them
// from the still this point captures, so nothing here measures how far the paint
// reaches. What fails is a build that draws no trail at all: its lane behind the
// ball reads exactly as it did bare.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveTrail,
  trailPainted,
  type Harness,
} from "../harness";

/** A steady flight near the cap, where a trail has the most room to be drawn. */
const SPEED = 950;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints the lane behind a ball in flight", async () => {
  const ball = await driveTrail(h, SPEED);
  captureStill(h, "trail");

  assertEqual(trailPainted(h, ball), true);
});
