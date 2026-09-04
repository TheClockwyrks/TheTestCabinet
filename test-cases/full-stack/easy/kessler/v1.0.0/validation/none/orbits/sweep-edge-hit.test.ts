// orbits/sweep-edge-hit — a moving ring's own rotation sweeps an edge hit onto
// a ball whose angle never changes.
//
// specs/rings.md, on the edge crossing: "in a tick where the ball's center
// radius lies between a ring's inner and outer contact radii, and the ball's
// center angle crosses into a live target's arc, the ball scores an edge hit
// on that target. The crossing is relative: the ball's motion, the ring's
// rotation, or both may produce it." So a ball drifting purely radially inside
// ring 2's contact band, its center angle fixed, is hit when the rotating
// arc's boundary sweeps across that angle — the rotation alone produces the
// crossing. The arc starts 9.5 degrees short of the ball and closes at 5
// degrees per tick, so the hit lands about two ticks in and never on a posed
// boundary equality.
//
// THE WORLD IS ONE TARGET AND ONE BALL. Ring 2, slot 0, full hit points; the
// ball inside the band at 90 degrees, drifting slowly inward so its own motion
// crosses nothing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertCloseTo,
  assertEqual,
  assertTrue,
} from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import {
  ballPolar,
  ringContactBand,
  slotZeroHp,
  spawnBallRadial,
} from "./rings";

/** The posed orbit: 5 degrees per tick toward the ball's angle. */
const RING_DEG_PER_SEC = 300;

/** The ball: mid-band, fixed angle, a slow radial drift. */
const BALL_R = 380;
const BALL_THETA = 90;
const BALL_DRIFT = -30;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("scores an edge hit when the rotation carries the arc across the ball", async () => {
  await isolate(h);
  await h.debug.spawnTarget(2, 0, 2);
  // At 60 the slot-0 arc is [62, 80.5], short of the ball's 90 by 9.5.
  await h.debug.setRingAngle(2, 60);
  await h.debug.setRingSpeed(2, RING_DEG_PER_SEC);
  await spawnBallRadial(h, BALL_R, BALL_THETA, BALL_DRIFT);

  const swept = await captureReplay(h, "sweep", () =>
    h.until((s) => slotZeroHp(s, 2) < 2, { maxTicks: 10 }),
  );

  assertTrue(swept.hit, "an edge hit within ten ticks of the sweep");
  assertEqual(
    slotZeroHp(swept.snapshot, 2),
    1,
    "slot 0's hit points: the swept crossing is one edge hit",
  );
  // The crossing was the ring's: the ball still stands on its posed angle,
  // inside the contact band, its own motion having crossed nothing.
  const at = ballPolar(swept.snapshot.balls[0]);
  assertCloseTo(at.theta, BALL_THETA, 3, "the ball's center angle at the hit");
  const band = ringContactBand(2);
  assertBetween(
    at.r,
    band.inner,
    band.outer,
    "the ball's center radius at the hit, inside the contact band",
  );
});
