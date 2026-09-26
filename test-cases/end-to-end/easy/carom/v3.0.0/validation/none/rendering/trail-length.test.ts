// rendering/trail-length — a ball in steady flight leaves a trail behind it.
//
// specs/overview.md: behind the ball, the build draws its path over the last
// `TRAIL_TIME` seconds of travel. So a ball at a steady speed leaves the lane
// behind it painted, and that is what is read: the lane behind the ball is
// scanned for anything the flight put there, against a reading of the same lane
// taken before the ball entered it (`./trail.ts`).
//
// WHAT IS READ IS PRESENCE. How long the streak looks, how it tapers, how it
// glows and what it is colored are the build's, and the reviewer judges them from
// the still this point captures, so nothing here measures how far the paint
// reaches. What fails is a build that draws no trail at all: its lane behind the
// ball reads exactly as it did bare.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { readTrail } from "./trail";

/** A brisk rally speed, inside the cap, so a trail has room to be drawn. */
const SPEED = 950;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints the lane behind a ball in flight", async () => {
  const trail = await readTrail(h, SPEED);
  await captureStill(h, "trail");

  assertEqual(trail.painted, true);
});
