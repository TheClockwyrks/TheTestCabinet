// paddle/inside-inward-not-saved — a ball posed inside the contact radius and
// moving inward is never saved.
//
// specs/deflector-and-ball.md: "The deflector's one ball contact is a crossing
// event. In a tick where a ball's center radius moves from above `194` to `194`
// or below…" — so a ball that BEGINS at or below 194 makes no such crossing, and
// no other deflector contact exists for it to make. The companion rule, that a
// ball crossing 194 OUTWARD is untouched, is
// `inside-outward-crosses-untouched`: two motions, two requirements, so a build
// that saves one and not the other is told apart.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR at its start angle, over an isolated
// field with no target, no pod, and no shield, so an altered velocity could only
// be a deflector contact that must not exist. The pose sits dead on the span's
// center, and the drive stops well clear of the burn-up radius, whose
// consequences are other items'.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThan } from "../assert";
import { ballSpeedAtWave } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { ballRadial } from "./readings";

/** Posed inside the contact radius, over the deflector track itself. */
const START_RADIUS = 180;

/** The deflector's start angle: dead center of the span. */
const POSED_ANGLE = 90;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves an inward ball's velocity untouched from inside the radius", async () => {
  isolate(h);
  spawnBallPolar(h, START_RADIUS, POSED_ANGLE, -ballSpeedAtWave(1), 0);
  const posed = h.snapshot().balls[0];

  // Four ticks at 4 units per tick: 180 down to 164, well above burn-up.
  const after = await captureReplay(h, "inside-inward", () => h.tick(4));

  assertEqual(after.balls.length, 1, "the field's balls after the drive");
  const ball = after.balls[0];
  assertLessThan(ballRadial(ball).vr, 0, "the radial velocity, still inward");
  assertCloseTo(ball.vx, posed.vx, 6, "vx across the drive, untouched");
  assertCloseTo(ball.vy, posed.vy, 6, "vy across the drive, untouched");
});
