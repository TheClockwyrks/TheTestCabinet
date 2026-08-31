// presentation/sprites-drawn-at-native-size — each sprite covers exactly its
// authored canvas in logical units.
//
// specs/assets.md: "Every sprite is authored at the canvas size its table row
// states and drawn at that size in logical units, centered on the object it
// depicts, so nothing is scaled at draw time" — the planet at 160 x 160, a pod
// and a ball frame at 24 x 24, and the item restates the same figures. The
// window is the stage's own size, where a logical unit is a device pixel, so a
// blit's recorded rectangle IS the drawn size in logical units and a sprite
// drawn through a scale reads a different rectangle.
//
// The world is one of each: the planet (always in the field), one falling
// pod, and one parked ball, each attributed by its center. The HUD is free to
// REUSE a sprite at another size elsewhere (specs/assets.md offers the pod
// sprites as its indicators), which attribution by object center leaves out of
// the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import {
  BALL_SPRITE_SIZE,
  DEFLECTOR_BALL_CONTACT_RADIUS,
  DEFLECTOR_START_ANGLE_DEG,
  PLANET_SPRITE_SIZE,
  POD_FALL_SPEED,
  POD_SPRITE_SIZE,
  STAGE_CX,
  STAGE_CY,
  TICK_DT,
} from "../constants";
import {
  blitsNear,
  captureStill,
  isolate,
  openHarness,
  polarToXy,
  spawnPodPolar,
  type Blit,
  type Harness,
} from "../harness";
import { CLEAR_RADIUS, SPRITE_ATTRIBUTION_UNITS } from "./sprites";

/** Rounding to device pixels: half a pixel each side. */
const SIZE_DIGITS = 0;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * The blit that IS the object: the last one centered on it, which under the
 * painter's order is the topmost — the object itself, over anything a build
 * layered beneath it.
 */
function sizeOf(blits: Blit[], what: string): Blit {
  assertGreaterThan(blits.length, 0, `image draws centered on the ${what}`);
  return blits[blits.length - 1];
}

it("draws the planet at 160 and a pod and a ball frame at 24", async () => {
  isolate(h);
  h.debug.parkBall();
  spawnPodPolar(h, "widen", CLEAR_RADIUS, 0);

  const blits = await h.frameBlits();
  captureStill(h, "native");

  const planet = sizeOf(
    blitsNear(h, blits, STAGE_CX, STAGE_CY, SPRITE_ATTRIBUTION_UNITS),
    "planet",
  );
  assertCloseTo(
    planet.w,
    PLANET_SPRITE_SIZE,
    SIZE_DIGITS,
    "the planet blit's width",
  );
  assertCloseTo(
    planet.h,
    PLANET_SPRITE_SIZE,
    SIZE_DIGITS,
    "the planet blit's height",
  );

  const podAt = polarToXy(CLEAR_RADIUS - POD_FALL_SPEED * TICK_DT, 0);
  const pod = sizeOf(
    blitsNear(h, blits, podAt.x, podAt.y, SPRITE_ATTRIBUTION_UNITS),
    "falling pod",
  );
  assertCloseTo(pod.w, POD_SPRITE_SIZE, SIZE_DIGITS, "the pod blit's width");
  assertCloseTo(pod.h, POD_SPRITE_SIZE, SIZE_DIGITS, "the pod blit's height");

  const ballAt = polarToXy(
    DEFLECTOR_BALL_CONTACT_RADIUS,
    DEFLECTOR_START_ANGLE_DEG,
  );
  const ball = sizeOf(
    blitsNear(h, blits, ballAt.x, ballAt.y, SPRITE_ATTRIBUTION_UNITS),
    "parked ball",
  );
  assertCloseTo(ball.w, BALL_SPRITE_SIZE, SIZE_DIGITS, "the ball blit's width");
  assertCloseTo(
    ball.h,
    BALL_SPRITE_SIZE,
    SIZE_DIGITS,
    "the ball blit's height",
  );
});
