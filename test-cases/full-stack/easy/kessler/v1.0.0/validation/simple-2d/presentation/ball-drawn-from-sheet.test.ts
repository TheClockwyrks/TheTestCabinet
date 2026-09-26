// presentation/ball-drawn-from-sheet — every ball, the parked ball included,
// is painted from the produced ball sheet rather than a shape drawn in code.
//
// specs/assets.md, on the ball sheet: "Every ball, the parked ball included,
// is drawn from the sheet", six produced files `sprites/ball/0.png` through
// `5.png`. Under this engine a blit's id is the served asset path, so each
// ball — a parked ball on the deflector and a free ball out in the field — is
// read for an image draw centered on it that carries one of the sheet's six
// files. Which frame, and how the frames advance, are the spin items.
//
// The world is the two balls and the deflector they concern: a parked ball at
// the serve position, and a stationary free ball on an empty radius.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertTrue } from "../assert";
import {
  BALL_SPRITES,
  DEFLECTOR_BALL_CONTACT_RADIUS,
  DEFLECTOR_START_ANGLE_DEG,
} from "../constants";
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

afterEach(() => {
  h?.dispose();
});

/** Whether the id is one of the sheet's six produced files. */
function fromSheet(id: string | null): boolean {
  return id !== null && BALL_SPRITES.some((file) => id.endsWith(file));
}

it("paints the parked ball and a free ball from the produced sheet", async () => {
  isolate(h);
  h.debug.parkBall();
  spawnBallPolar(h, CLEAR_RADIUS, FREE_BALL_THETA, 0, 0);

  const blits = await h.frameBlits();
  captureStill(h, "balls");

  const parked = spriteAtPolar(
    h,
    blits,
    DEFLECTOR_BALL_CONTACT_RADIUS,
    DEFLECTOR_START_ANGLE_DEG,
  );
  assertNotNull(parked, "the image draw centered on the parked ball");
  assertTrue(
    fromSheet(parked),
    `the image on the parked ball is a sheet frame; saw ${String(parked)}`,
  );

  const free = spriteAtPolar(h, blits, CLEAR_RADIUS, FREE_BALL_THETA);
  assertNotNull(free, "the image draw centered on the free ball");
  assertTrue(
    fromSheet(free),
    `the image on the free ball is a sheet frame; saw ${String(free)}`,
  );
});
