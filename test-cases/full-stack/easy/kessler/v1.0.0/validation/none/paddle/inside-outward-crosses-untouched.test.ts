// paddle/inside-outward-crosses-untouched — a ball posed inside the contact
// radius and moving outward crosses 194 untouched.
//
// specs/deflector-and-ball.md gives the deflector one ball contact, and it is
// the INWARD crossing: "In a tick where a ball's center radius moves from above
// `194` to `194` or below, with inward radial velocity (`v . n < 0`)…". A ball
// travelling the other way therefore makes no contact at all. The companion
// rule, that a ball already inside and heading in is never saved, is
// `inside-inward-not-saved`: two motions, two requirements, so a build that
// invents an outward contact is told from one that saves an inward ball.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR at its start angle, over an isolated
// field with no target, no pod, and no shield, so an altered velocity could only
// be a deflector contact that must not exist. The pose sits dead on the span's
// center, and the drive stops well clear of the containment field.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { ballSpeed, PADDLE_CONTACT_RADIUS } from "../constants";
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

afterEach(async () => {
  await h.dispose();
});

it("carries an outward ball through 194 with its velocity untouched", async () => {
  await isolate(h);
  await spawnBallPolar(h, START_RADIUS, POSED_ANGLE, ballSpeed(1), 0);
  const posed = (await h.snapshot()).balls[0];

  // Six ticks at 4 units per tick: 180 up through 194 (192 before the
  // crossing tick, 196 after — never on the boundary) to 204.
  const after = await captureReplay(h, "inside-outward", () => h.tick(6));

  assertEqual(after.balls.length, 1, "the field's balls after the crossing");
  const ball = after.balls[0];
  const { r, vr } = ballRadial(ball);
  assertGreaterThan(r, PADDLE_CONTACT_RADIUS, "the radius past the contact");
  assertGreaterThan(vr, 0, "the radial velocity, still outward");
  assertCloseTo(ball.vx, posed.vx, 6, "vx across the crossing, untouched");
  assertCloseTo(ball.vy, posed.vy, 6, "vy across the crossing, untouched");
});
