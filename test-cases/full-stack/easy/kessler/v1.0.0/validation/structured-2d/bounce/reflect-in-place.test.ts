// bounce/reflect-in-place — the bounce changes velocity only; the ball keeps
// the position its advance gave it this tick.
//
// specs/deflector-and-ball.md, "Reflect in place": "Every reflection in the
// game, the deflector bounce included, changes velocity only. The ball keeps
// the position its advance gave it this tick." The pose is purely radial at
// the wave-1 speed (4 units per tick) from 6 units above the contact radius,
// so the advance's positions are fixed arithmetic: the crossing tick ends the
// ball at radius 192, 2 units INSIDE the contact radius. A build that snaps
// the ball back onto radius 194 (or re-advances it along the new velocity)
// is a couple of units away from that point; a conformant one is at it to
// float noise, so the position check carries a 0.05-unit tolerance only.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR, per isolate(). The outgoing radial
// speed being positive is read first as evidence that the bounce did resolve
// on the expected tick — the position claim is only about a tick that bounced.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import { TICK_DT } from "../constants";
import { captureReplay, openHarness, type Harness } from "../harness";
import { poseRadialApproach, radialSpeedOf, soleBall } from "./pose";

/** The deflector's center angle for the pose. */
const PADDLE_DEG = 90;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the ball where its advance put it, only the velocity turned", async () => {
  const pose = await poseRadialApproach(h, PADDLE_DEG, 0);

  const after = await captureReplay(h, "bounce", async () => {
    const bounced = await h.tick(pose.ticks);
    await h.tick(8); // let the replay show the ball flying back out
    return bounced;
  });

  const ball = soleBall(after);
  assertGreaterThan(
    radialSpeedOf(ball),
    0,
    "the bounce resolved this tick, so the ball heads back out",
  );

  const expected = {
    x: pose.start.x + pose.ticks * pose.velocity.vx * TICK_DT,
    y: pose.start.y + pose.ticks * pose.velocity.vy * TICK_DT,
  };
  assertCloseTo(ball.x, expected.x, 1, "x where this tick's advance ended");
  assertCloseTo(ball.y, expected.y, 1, "y where this tick's advance ended");
});
