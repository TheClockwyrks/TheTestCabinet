// cascade/floor-bounce-damps — a bounce keeps 0.80 of the vertical speed.
//
// specs/victory.md's third step of every frame: `vy = -vy * BOUNCE_DAMP`, with
// `BOUNCE_DAMP` being `0.80`. The `vy` the rule multiplies is the one the frame's
// FIRST step left, so the incoming speed is the velocity read at the end of the
// previous frame plus that frame's `GRAVITY * dt` — which is how the expected
// figure below is built.
//
// WHY GRAVITY APPEARS IN A DAMPING CHECK. There is no way to read the velocity
// between the frame's first and third steps, so the one frame of acceleration
// has to be modelled. It is worth `7.5` units per second against an incoming
// speed of about `1039`, so a build whose gravity is wrong is mis-modelled by
// well under a tenth of the tolerance here and is docked for it in `gravity`
// alone.
//
// The card is dropped from rest three hundred units up, which is a hard enough
// landing that the damping is a large number rather than a small one: `0.80`
// leaves `831` where `1.00` would leave `1039` and `0.50` would leave `520`,
// all far outside the two percent below. Nothing is launching and the card has no
// horizontal drift, so the flight is one card and one bounce.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertTrue } from "../assert";
import { BOUNCE_DAMP, FLOOR_Y, GRAVITY } from "../constants";
import {
  type Harness,
  captureReplay,
  createHarness,
  framesFor,
  poseFlyer,
  seconds,
} from "../harness";
import { frameSamples, openFlight } from "./flight";

/** A card dropped from rest, 300 units above the floor. */
const DROP = { x: 400, y: FLOOR_Y - 300, vx: 0, vy: 0 };

/**
 * How far the drive runs, in frames.
 *
 * The fall takes `0.577` s at the acceleration `specs/victory.md` fixes, so this
 * covers it with room to spare and stops well before the second bounce.
 */
const DRIVE_FRAMES = framesFor(0.8);

/** The frame the incoming speed is carried across, in seconds. */
const FRAME = seconds(1);

/**
 * Two percent of the outgoing speed.
 *
 * The rule is one multiplication, so the only slack the reading needs is
 * rounding and the single frame of acceleration modelled above. Two percent of
 * `831` is `16.6`, against the `208` that separates `0.80` from `1.00`.
 */
const DAMP_TOLERANCE = 0.02;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("leaves the floor with BOUNCE_DAMP of the speed it arrived with", async () => {
  await openFlight(harness);
  const id = await poseFlyer(harness, DROP);

  const samples = await captureReplay(harness, "bounce", () =>
    frameSamples(harness, DRIVE_FRAMES),
  );

  const flights = samples.map((s) => s.flyers.find((f) => f.id === id));
  const bounce = flights.findIndex((f) => f !== undefined && f.vy < 0);
  assertTrue(
    bounce > 0,
    `the dropped card to meet the floor and leave it ascending within ${DRIVE_FRAMES} frames`,
  );

  const arriving = flights[bounce - 1]?.vy ?? DROP.vy;
  const leaving = flights[bounce]?.vy ?? 0;
  // The frame's own acceleration, applied before the bounce reads `vy`.
  const incoming = arriving + GRAVITY * FRAME;
  const expected = BOUNCE_DAMP * incoming;

  assertLessThanOrEqual(
    Math.abs(Math.abs(leaving) - expected),
    expected * DAMP_TOLERANCE,
    `the outgoing speed to be BOUNCE_DAMP (${BOUNCE_DAMP}) of the incoming ${incoming}, which is ${expected}, and it was ${Math.abs(leaving)}`,
  );
});
